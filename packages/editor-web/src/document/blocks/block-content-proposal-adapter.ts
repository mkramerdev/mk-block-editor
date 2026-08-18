import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  AppliedContentCommit,
  EditorLocalMutationProvenance,
  EditorPreparedContentSelection,
} from "@repo/editor-react/editor";
import {
  applyFinalizedContentOperations,
  createBlockLocalProseMirrorState,
  deriveProseMirrorOperations,
  isEditorOwnedDeletionTransaction,
  materializeCanonicalBlockLocalProseMirrorDocument,
  proposalChangesDocument,
  type ProseMirrorProposalAdapter,
  type ProseMirrorProposalDisposition,
  type ProseMirrorStateProposal,
} from "@repo/editor-dom/block-editor";
import {
  TextSelection,
  type EditorState,
  type EditorView,
} from "@repo/editor-dom/prosemirror";
import type { BlockLocalDocumentMappingOptions } from "@repo/editor-dom/schema";
import { blockTextCoordinateCodec } from "@repo/editor-dom/caret";
import type { EditorContentRuntime } from "../../runtime/content/content-runtime.ts";
import type { EditorRuntimePort } from "../../runtime/document/render-port.ts";

export interface CreateActiveProseMirrorProposalAdapterOptions {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly editor: EditorRuntimePort;
  readonly contentRuntime: EditorContentRuntime;
  readonly documentMapping?: BlockLocalDocumentMappingOptions;
  readonly consumeLocalMutationProvenance:
    | (() => EditorLocalMutationProvenance | null)
    | null;
}

/**
 * Owns the block-local ProseMirror proposal boundary and the publication-only
 * projection boundary. Projection never dispatches.
 */
export class ActiveProseMirrorProposalAdapter
  implements ProseMirrorProposalAdapter
{
  private evaluatingProposal = false;
  private projectingFinalizedContent = false;
  private disposed = false;
  private readonly projectionOrigin = Object.freeze({});
  private compositionDraft: {
    readonly revision: number;
    readonly baselineText: string;
    readonly state: EditorState;
  } | null = null;

  constructor(
    private readonly options: CreateActiveProseMirrorProposalAdapterOptions,
  ) {}

  isProjectingFinalizedContent(): boolean {
    return this.projectingFinalizedContent;
  }

  readContentBaseToken() {
    const { blockId, blockType, contentRuntime, editor } = this.options;
    return contentRuntime.readContentBaseToken(
      blockId,
      blockType,
      editor.getSelectionGraphRevision(),
    );
  }

  evaluateProposal(
    proposal: ProseMirrorStateProposal,
    view: EditorView,
  ): ProseMirrorProposalDisposition {
    if (this.disposed || this.evaluatingProposal) {
      return {
        kind: "rejected",
        state: this.projectCommittedState(view),
      };
    }
    this.evaluatingProposal = true;
    try {
      const composition =
        this.options.editor.selectionController.getPresentationSnapshot()
          .composition;
      if (
        composition?.hostBlockId === this.options.blockId &&
        proposalChangesDocument(proposal)
      ) {
        const baselineText =
          this.compositionDraft?.revision === composition.revision
            ? this.compositionDraft.baselineText
            : proposal.previousState.doc.textContent;
        this.compositionDraft = {
          revision: composition.revision,
          baselineText,
          state: proposal.proposedState,
        };
        this.options.editor.selectionController.updateCompositionSession({
          revision: composition.revision,
          latestText: deriveReplacementText(
            baselineText,
            proposal.proposedState.doc.textContent,
          ),
        });
        return { kind: "view-only", state: proposal.proposedState };
      }
      if (composition?.hostBlockId === this.options.blockId) {
        return { kind: "view-only", state: proposal.proposedState };
      }
      if (proposalChangesDocument(proposal)) {
        return this.evaluateContentProposal(proposal, view);
      }
      if (proposal.previousState.selection.eq(proposal.proposedState.selection)) {
        return { kind: "view-only", state: proposal.proposedState };
      }
      return this.evaluateSelectionProposal(proposal, view);
    } finally {
      this.evaluatingProposal = false;
    }
  }

  projectFinalizedContent(
    view: EditorView,
    commit?: AppliedContentCommit,
  ): void {
    if (this.disposed || view.isDestroyed || this.evaluatingProposal) return;
    const composition =
      this.options.editor.selectionController.getPresentationSnapshot()
        .composition;
    if (composition?.hostBlockId === this.options.blockId) return;
    this.projectingFinalizedContent = true;
    try {
      const finalizedBlock = commit?.blocks.find(
        (block) => block.blockId === this.options.blockId,
      );
      const incremental = finalizedBlock?.contentOperations.length
        ? applyFinalizedContentOperations(
            view.state,
            finalizedBlock.contentOperations,
          )
        : null;
      view.updateState(
        incremental
          ? this.projectCanonicalSelection(incremental)
          : this.projectCommittedState(view),
      );
      this.compositionDraft = null;
    } catch {
      // The manifest publication following this finalized content release will
      // unmount a deleted or type-changed block. Disable editing in the gap.
      view.setProps({ editable: () => false });
    } finally {
      this.projectingFinalizedContent = false;
    }
  }

  reconcileFinalizedBlock(view: EditorView): void {
    if (this.disposed || view.isDestroyed) return;
    const { blockId, blockType, editor } = this.options;
    const block = editor.getBlock(blockId);
    if (!block || block.tombstone || block.type !== blockType) {
      view.setProps({ editable: () => false });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.compositionDraft = null;
  }

  restoreCommittedProjectionAfterComposition(view: EditorView): void {
    this.compositionDraft = null;
    if (this.disposed || view.isDestroyed) return;
    this.projectingFinalizedContent = true;
    try {
      view.updateState(this.projectCommittedState(view));
    } finally {
      this.projectingFinalizedContent = false;
    }
  }

  private evaluateContentProposal(
    proposal: ProseMirrorStateProposal,
    view: EditorView,
  ): ProseMirrorProposalDisposition {
    const { blockId, blockType, editor } = this.options;
    const provenance = this.options.consumeLocalMutationProvenance?.() ?? null;
    const derived = deriveProseMirrorOperations({
      proposal,
      blockId,
      blockType,
    });
    const selectionAfter = this.readPreparedProseMirrorSelection(
      proposal.proposedState,
    );
    if (!derived.ok || !selectionAfter) {
      return { kind: "rejected", state: this.projectCommittedState(view) };
    }
    const focused =
      !view.isDestroyed && view.dom.isConnected && view.hasFocus();
    const selectionPresentation = focused
      ? proposal.transactions.some(isEditorOwnedDeletionTransaction)
        ? "installed-by-proposed-state"
        : "native-already-established"
      : "restore-native";
    const accepted = editor.acceptContentOperationProposal(
      {
        base: proposal.base,
        operations: derived.operations,
        selectionAfter,
      },
      {
        origin: "prosemirror-proposal",
        selectionPresentation,
        provenance,
        releaseAfterProposedStateInstalled: true,
        contentCommitOrigin: this.projectionOrigin,
      },
    );
    if (!accepted.ok) {
      return { kind: "rejected", state: this.projectCommittedState(view) };
    }

    return {
      kind: "accepted",
      state: proposal.proposedState,
      ...(accepted.release
        ? { afterStateInstalled: accepted.release }
        : {}),
    };
  }

  private evaluateSelectionProposal(
    proposal: ProseMirrorStateProposal,
    view: EditorView,
  ): ProseMirrorProposalDisposition {
    const { blockId, editor } = this.options;
    const selection = this.readPreparedProseMirrorSelection(
      proposal.proposedState,
    );
    const anchor = editor.createSelectionTextPoint(
      blockId,
      selection.anchor.textOffset,
      null,
    );
    const focus = editor.createSelectionTextPoint(
      blockId,
      selection.focus.textOffset,
      null,
    );
    if (!anchor || !focus) {
      return { kind: "rejected", state: this.projectCommittedState(view) };
    }
    const context = {
      publication: { kind: "standalone-local" as const },
      cause: "keyboard" as const,
    };
    const settlement =
      selection.anchor.textOffset === selection.focus.textOffset
        ? editor.selectionController.commitSelectionPoint(
            focus,
            editor,
            editor.getSelectionGraphRevision(),
            context,
          )
        : editor.selectionController.extendSelection(
            anchor,
            focus,
            editor,
            editor.getSelectionGraphRevision(),
            context,
            null,
          );
    return settlement.kind === "rejected"
      ? { kind: "rejected", state: this.projectCommittedState(view) }
      : { kind: "accepted", state: proposal.proposedState };
  }

  ownsContentCommitOrigin(origin: unknown): boolean {
    return origin === this.projectionOrigin;
  }

  private readPreparedProseMirrorSelection(
    state: EditorState,
  ): EditorPreparedContentSelection {
    const anchorOffset =
      blockTextCoordinateCodec.proseMirrorPositionToCanonicalOffset(
        state.selection.anchor,
        state,
      );
    const { blockId, blockType } = this.options;
    const anchor = {
      blockId,
      blockType,
      textOffset: anchorOffset,
      affinity: null,
    } as const;
    if (state.selection.empty) {
      return {
        direction: "forward",
        anchor,
        focus: anchor,
      };
    }
    const focusOffset =
      blockTextCoordinateCodec.proseMirrorPositionToCanonicalOffset(
        state.selection.head,
        state,
      );
    return {
      direction:
        state.selection.anchor <= state.selection.head ? "forward" : "backward",
      anchor,
      focus: {
        blockId,
        blockType,
        textOffset: focusOffset,
        affinity: null,
      },
    };
  }

  private projectCommittedState(view: EditorView): EditorState {
    const { blockId, blockType, contentRuntime } = this.options;
    const content = contentRuntime.readBlockProjection(blockId, blockType);
    if (!content) throw new Error(`Block ${blockId} has no committed content`);
    return this.createProjectedState(view, content);
  }

  private createProjectedState(
    view: EditorView,
    content: NonNullable<ReturnType<EditorContentRuntime["readBlockProjection"]>>,
  ): EditorState {
    const { blockId, blockType, documentMapping } = this.options;
    const state = createBlockLocalProseMirrorState({
      blockId,
      blockType,
      doc: materializeCanonicalBlockLocalProseMirrorDocument(
        content,
        blockType,
        view.state.schema,
        documentMapping,
      ),
      schema: view.state.schema,
      plugins: view.state.plugins,
    });
    return this.projectCanonicalSelection(state);
  }

  private projectCanonicalSelection(state: EditorState): EditorState {
    const canonical =
      this.options.editor.selectionController.canonical.getSnapshot();
    if (canonical.kind === "none") return state;
    const selection = canonical.snapshot.documentSelection;
    const anchor = selection.anchor;
    const focus = selection.focus;
    const { blockId } = this.options;
    if (
      !anchor ||
      !focus ||
      anchor.blockId !== blockId ||
      focus.blockId !== blockId
    ) {
      return state;
    }
    try {
      const anchorPosition =
        blockTextCoordinateCodec.canonicalOffsetToProseMirrorPosition(
          anchor.textOffset,
          state,
        );
      const focusPosition =
        blockTextCoordinateCodec.canonicalOffsetToProseMirrorPosition(
          focus.textOffset,
          state,
        );
      state = state.apply(
        state.tr.setSelection(
          TextSelection.create(state.doc, anchorPosition, focusPosition),
        ),
      );
    } catch {
      // Invalid endpoints cannot escape the canonical projection boundary.
    }
    return state;
  }

}

function deriveReplacementText(before: string, after: string): string {
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before.charCodeAt(prefix) === after.charCodeAt(prefix)
  ) {
    prefix += 1;
  }
  let beforeSuffix = before.length;
  let afterSuffix = after.length;
  while (
    beforeSuffix > prefix &&
    afterSuffix > prefix &&
    before.charCodeAt(beforeSuffix - 1) === after.charCodeAt(afterSuffix - 1)
  ) {
    beforeSuffix -= 1;
    afterSuffix -= 1;
  }
  return after.slice(prefix, afterSuffix);
}
