import type { EditorBlockCommandRequest } from "@repo/editor-react/editor";
import type { VersionedBlock } from "@repo/editor-core/document";
import type {
  BlockDomKeyBehaviorEvent,
  TextPlaceholder,
} from "@repo/editor-dom/block-editor";
import type { BlockLocalDocumentMappingOptions } from "@repo/editor-dom/schema";
import { normalizeHeadingLevel } from "@repo/editor-core/document";
import {
  createBlockLocalDomPlugins,
  createBlockLocalProseMirrorState,
  createBlockLocalProseMirrorView,
  createBlockLocalProseMirrorViewProps,
  materializeCanonicalBlockLocalProseMirrorDocument,
} from "@repo/editor-dom/block-editor";
import { blockTextCoordinateCodec } from "@repo/editor-dom/caret";
import {
  TextSelection,
  type EditorState,
  type EditorView,
  type Plugin,
} from "@repo/editor-dom/prosemirror";
import type { EditorRuntimePort } from "./render-port.ts";
import {
  createCollapsedCaretSelection,
  readEditorViewContentSize,
} from "../../document/inline/editor-view-inline-formatting.ts";
import { resolveRegisteredEditorCommand } from "../commands/command-routing.ts";
import { createEditorKeybindingPlugin } from "../keybindings/block-keybinding-plugin.ts";
import { executeCoreBlockKeyBehavior } from "./execute-core-block-key-behavior.ts";
import {
  projectNativeCaret,
  type NativeCaretProjectionResult,
} from "../../document/selection/native-caret-projection.ts";
import { ActiveProseMirrorProposalAdapter } from "../../document/blocks/block-content-proposal-adapter.ts";
import type { TextActivationObligation } from "./text-activation.ts";
import { LocalTypingProvenanceBridge } from "../typing-triggers/local-typing-provenance-bridge.ts";
import { createBlockPresentationDocumentMapping } from "./block-local-document-mapping.ts";

export interface SharedTextEditorHost {
  readonly blockId: VersionedBlock["id"];
  readonly shell: HTMLElement;
  readonly projection: HTMLElement;
  readonly slot: HTMLElement;
  readonly projectionIdentity: symbol;
  readonly className: string;
  readonly placeholder?: TextPlaceholder;
}

interface ActiveBlockBinding {
  readonly block: VersionedBlock;
  readonly host: SharedTextEditorHost;
  readonly proposalAdapter: ActiveProseMirrorProposalAdapter;
  readonly documentMapping: BlockLocalDocumentMappingOptions;
  readonly contentLease: ReturnType<
    EditorRuntimePort["contentRuntime"]["acquireBlockContent"]
  >;
  readonly triggerProvenanceBridge: LocalTypingProvenanceBridge | null;
  readonly captureBeforeInput: ((event: InputEvent) => void) | null;
  beforeInputTarget: HTMLElement | null;
  readonly unsubscribeContent: () => void;
  readonly unsubscribeBlock: () => void;
  placeholder?: TextPlaceholder;
  installedActivation: TextActivationObligation | null;
}

/** Owns one movable EditorView and exactly one active block binding. */
export class SharedTextEditor {
  private view: EditorView | null = null;
  private active: ActiveBlockBinding | null = null;
  private disposed = false;
  private readonly plugins: readonly Plugin[];

  constructor(private readonly editor: EditorRuntimePort) {
    const activePlaceholder = () => this.active?.placeholder;
    const activeBlock = () => {
      const block = this.active?.block;
      if (!block) throw new Error("Shared text editor has no active block");
      return block;
    };
    this.plugins = createBlockLocalDomPlugins({
      get blockId() {
        return activeBlock().id;
      },
      get blockType() {
        return activeBlock().type;
      },
      get placeholder() {
        return activePlaceholder();
      },
      editable: true,
      additionalPlugins: [
        createEditorKeybindingPlugin({
          definition: editor.definition,
          store: editor.store,
          editor,
          get blockId() {
            return activeBlock().id;
          },
          get blockType() {
            return activeBlock().type;
          },
        }),
      ],
      emitBlockKeyBehavior: (event: BlockDomKeyBehaviorEvent) => {
        const block = activeBlock();
        return executeCoreBlockKeyBehavior({
          editor,
          blockId: block.id,
          blockType: block.type,
          key: event.key,
          cursorOffset: event.cursorOffset,
          ...(event.selectionRange === undefined
            ? {}
            : { selectionRange: event.selectionRange }),
          ...(event.isComposing === undefined
            ? {}
            : { isComposing: event.isComposing }),
        });
      },
    });
  }

  readView(): EditorView | null {
    return this.disposed || this.view?.isDestroyed ? null : this.view;
  }

  readActiveBlockId(): VersionedBlock["id"] | null {
    return this.active?.block.id ?? null;
  }

  activate(
    block: VersionedBlock,
    host: SharedTextEditorHost,
    obligation: TextActivationObligation,
  ): NativeCaretProjectionResult {
    if (this.disposed || !host.slot.isConnected) return { status: "rejected" };
    if (this.active?.block.id !== block.id) {
      this.detachActiveBlock();
      this.active = this.createActiveBinding(block, host);
      this.active.installedActivation = obligation;
      this.installActiveState(this.active);
    } else if (this.active.host.slot !== host.slot) {
      this.active.host.projection.hidden = false;
      this.active = { ...this.active, host };
    }

    const active = this.active;
    const view = this.readView();
    if (!active || !view) return { status: "rejected" };
    active.installedActivation = obligation;
    if (!active.host.projection.hidden) active.host.projection.hidden = true;
    if (active.host.projection.getAttribute("aria-hidden") !== "true")
      active.host.projection.setAttribute("aria-hidden", "true");
    if (active.host.projection.hasAttribute("data-editor-text-root"))
      active.host.projection.removeAttribute("data-editor-text-root");
    if (view.dom.dataset.editorInputOwner !== "true")
      view.dom.dataset.editorInputOwner = "true";
    this.attachViewToHost(view, active.host.slot);
    const canonicalRange = readActivationCanonicalRange(
      this.editor,
      obligation,
    );
    // Install the final canonical selection while the shared view is still
    // unfocused. Focusing first makes the browser expose the view's previous
    // selection and then replace it, performing two native caret settlements.
    if (canonicalRange) {
      installViewSelection(
        view,
        canonicalRange.anchorOffset,
        canonicalRange.focusOffset,
      );
    } else {
      installViewCaret(view, obligation.canonicalTextOffset);
    }
    const wasFocused = view.hasFocus();
    const projectedBeforeFocus =
      !wasFocused && !canonicalRange
        ? projectActivationNativeCaret(view.dom, obligation)
        : { status: "rejected" as const };
    if (!wasFocused)
      view.dom.focus({ preventScroll: obligation.preventScroll });
    if (
      projectedBeforeFocus.status === "projected" &&
      view.dom.ownerDocument.activeElement === view.dom &&
      nativeSelectionMatches(
        view.dom.ownerDocument,
        projectedBeforeFocus.nativePoint,
      )
    ) {
      return projectedBeforeFocus;
    }
    const installed = readInstalledNativeFocus(
      view,
      obligation.canonicalTextOffset,
    );
    if (installed.status === "projected" && obligation.affinity === null) {
      return installed;
    }
    const projected = canonicalRange
      ? installed
      : projectActivationNativeCaret(view.dom, obligation);
    return projected;
  }

  deactivate(): void {
    this.detachActiveBlock();
  }

  prepareHostReattachment(blockId: VersionedBlock["id"]): void {
    const active = this.active;
    const view = this.readView();
    if (!active || active.block.id !== blockId || !view) return;
    active.host.projection.hidden = false;
    active.host.projection.removeAttribute("aria-hidden");
    active.host.projection.dataset.editorTextRoot = "true";
  }

  updateHostOptions(
    host: SharedTextEditorHost,
    placeholder?: TextPlaceholder,
  ): void {
    const active = this.active;
    if (!active || active.block.id !== host.blockId) return;
    if (samePlaceholder(active.placeholder, placeholder)) return;
    this.active = { ...active, host, placeholder };
    this.rebuildActiveState(true);
  }

  restoreNativeSelection(
    canonicalOffset: number,
    affinity: TextActivationObligation["affinity"],
  ): NativeCaretProjectionResult {
    const active = this.active;
    const view = this.readView();
    return active?.installedActivation && view
      ? projectActivationNativeCaret(view.dom, {
          ...active.installedActivation,
          canonicalTextOffset: canonicalOffset,
          affinity,
          focusMode: "adopt",
        })
      : { status: "rejected" };
  }

  projectSelection(anchorOffset: number, focusOffset: number): void {
    const view = this.readView();
    if (view && this.active)
      installViewSelection(view, anchorOffset, focusOffset);
  }

  reconcileNativeSelectionRange(
    anchorOffset: number,
    focusOffset: number,
  ): boolean {
    const view = this.readView();
    if (!view || !this.active) return false;
    const selection = createViewTextSelection(view, anchorOffset, focusOffset);
    if (!selection.eq(view.state.selection)) {
      view.updateState(view.state.apply(view.state.tr.setSelection(selection)));
    }
    return projectNativeViewSelection(view, selection);
  }

  clearNativeSelection(): void {
    const view = this.readView();
    if (view) clearRootNativeSelection(view.dom);
  }

  readSelectionOffset(): number | null {
    const view = this.readView();
    return view && this.active ? readEditorViewSelectionOffset(view) : null;
  }

  readPlainText(): string | null {
    const view = this.readView();
    return view && this.active ? readEditorViewPlainText(view) : null;
  }

  executeCommand(request: EditorBlockCommandRequest): boolean {
    const active = this.active;
    const view = this.readView();
    if (!active || !view) return false;
    const command = resolveRegisteredEditorCommand(
      this.editor.commands,
      request.commandId,
    );
    if (!command || command.scope !== "block") return false;
    const context = {
      definition: this.editor.definition,
      store: this.editor.store,
      editor: this.editor,
      blockId: active.block.id,
      blockType: active.block.type,
      view,
      textSelection: {
        from: blockTextCoordinateCodec.proseMirrorPositionToCanonicalOffset(
          view.state.selection.from,
          view.state,
        ),
        to: blockTextCoordinateCodec.proseMirrorPositionToCanonicalOffset(
          view.state.selection.to,
          view.state,
        ),
      },
      executeStructuralTransaction: (
        plan: Parameters<typeof this.editor.executeStructuralTransaction>[0],
      ) => this.editor.executeStructuralTransaction(plan),
      dispatchProseMirrorTransaction: (
        transaction: Parameters<EditorView["dispatch"]>[0],
      ) => view.dispatch(transaction),
      request,
    };
    if (command.isEnabled?.(context) === false) return false;
    return command.execute(context);
  }

  setCompositionPinned(pinned: boolean): void {
    const active = this.active;
    if (!active) return;
    const view = this.readView();
    if (!view) return;
    if (pinned) view.dom.dataset.editorCompositionPinned = "true";
    else delete view.dom.dataset.editorCompositionPinned;
  }

  restoreCommittedProjectionAfterComposition(): void {
    const active = this.active;
    const view = this.readView();
    if (active && view) {
      active.proposalAdapter.restoreCommittedProjectionAfterComposition(view);
    }
  }

  projectFinalizedContent(): void {
    const active = this.active;
    const view = this.readView();
    if (active && view) active.proposalAdapter.projectFinalizedContent(view);
  }

  destroy(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.releaseView();
  }

  releaseView(): void {
    this.detachActiveBlock();
    const view = this.view;
    this.view = null;
    if (view && !view.isDestroyed) view.destroy();
  }

  private createActiveBinding(
    block: VersionedBlock,
    host: SharedTextEditorHost,
  ): ActiveBlockBinding {
    const triggerProvenanceBridge =
      this.editor.compiledDefinition.typingTriggers.definitions.length > 0
        ? new LocalTypingProvenanceBridge()
        : null;
    const documentMapping = createBlockPresentationDocumentMapping(
      () => this.editor.getBlock(block.id) ?? block,
    );
    const proposalAdapter = new ActiveProseMirrorProposalAdapter({
      blockId: block.id,
      blockType: block.type,
      editor: this.editor,
      contentRuntime: this.editor.contentRuntime,
      documentMapping,
      consumeLocalMutationProvenance: triggerProvenanceBridge
        ? () => triggerProvenanceBridge.consume()
        : null,
    });
    const contentLease = this.editor.contentRuntime.acquireBlockContent(
      block.id,
      block.type,
      "active-editing",
    );
    const captureBeforeInput = triggerProvenanceBridge
      ? (event: InputEvent) => triggerProvenanceBridge.captureBeforeInput(event)
      : null;
    const unsubscribeContent =
      this.editor.contentRuntime.subscribeBlockProjection(
        block.id,
        (commit) => {
          const active = this.active;
          const view = this.readView();
          if (
            !active ||
            active.block.id !== block.id ||
            !view ||
            (commit && proposalAdapter.ownsContentCommitOrigin(commit.origin))
          ) {
            return;
          }
          proposalAdapter.projectFinalizedContent(view, commit);
        },
      );
    const unsubscribeBlock = this.editor.subscribeBlock(block.id, () => {
      const active = this.active;
      const view = this.readView();
      if (active?.block.id === block.id && view) {
        proposalAdapter.reconcileFinalizedBlock(view);
        const latest = this.editor.getBlock(block.id);
        if (latest && !latest.tombstone && latest.type === block.type) {
          const headingLevelChanged =
            block.type === "heading" &&
            normalizeHeadingLevel(active.block.metadata?.level) !==
              normalizeHeadingLevel(latest.metadata?.level);
          this.active = { ...active, block: latest };
          if (headingLevelChanged) this.rebuildActiveState(true);
        }
      }
    });
    return {
      block,
      host,
      proposalAdapter,
      documentMapping,
      contentLease,
      triggerProvenanceBridge,
      captureBeforeInput,
      beforeInputTarget: null,
      unsubscribeContent,
      unsubscribeBlock,
      placeholder: host.placeholder,
      installedActivation: null,
    };
  }

  private installActiveState(active: ActiveBlockBinding): void {
    const options = this.createViewOptions(active);
    if (!this.view) {
      this.view = createBlockLocalProseMirrorView(options);
      this.attachViewToHost(this.view, active.host.slot);
    } else {
      this.attachViewToHost(this.view, active.host.slot);
      this.view.setProps(createBlockLocalProseMirrorViewProps(options));
    }
    if (
      active.captureBeforeInput &&
      active.beforeInputTarget !== this.view.dom
    ) {
      if (active.beforeInputTarget) {
        active.beforeInputTarget.removeEventListener(
          "beforeinput",
          active.captureBeforeInput,
          true,
        );
      }
      this.view.dom.addEventListener(
        "beforeinput",
        active.captureBeforeInput,
        true,
      );
      active.beforeInputTarget = this.view.dom;
    }
    if (active.placeholder) {
      this.view.dom.dataset.editorPlaceholderVisibility =
        active.placeholder.visibility;
    }
  }

  private createViewOptions(active: ActiveBlockBinding) {
    const block = active.block;
    const pluginOptions = {
      placeholder: active.placeholder,
      editable: true,
      accessibilityLabel: `${block.type} block`,
      emitBlockKeyBehavior: (event: BlockDomKeyBehaviorEvent) =>
        executeCoreBlockKeyBehavior({
          editor: this.editor,
          blockId: block.id,
          blockType: block.type,
          key: event.key,
          cursorOffset: event.cursorOffset,
          ...(event.selectionRange === undefined
            ? {}
            : { selectionRange: event.selectionRange }),
          ...(event.isComposing === undefined
            ? {}
            : { isComposing: event.isComposing }),
        }),
    };
    const doc = materializeCanonicalBlockLocalProseMirrorDocument(
      this.editor.contentRuntime.readBlockProjection(block.id, block.type),
      block.type,
      this.editor.contentResources.proseMirrorSchema,
      active.documentMapping,
    );
    const state = createBlockLocalProseMirrorState({
      blockId: block.id,
      blockType: block.type,
      doc,
      plugins: this.plugins,
      schema: this.editor.contentResources.proseMirrorSchema,
      ...(active.installedActivation
        ? {
            selection: {
              canonicalOffset: active.installedActivation.canonicalTextOffset,
            },
          }
        : {}),
    });
    const mount =
      this.view?.dom ?? active.host.slot.ownerDocument.createElement("div");
    return {
      mount,
      blockId: block.id,
      blockType: block.type,
      state,
      schema: this.editor.contentResources.proseMirrorSchema,
      nodeViews: this.editor.contentResources.inlineNodeViews,
      proposalAdapter: active.proposalAdapter,
      pluginOptions: {
        ...pluginOptions,
        ...(block.type === "heading"
          ? { headingLevel: normalizeHeadingLevel(block.metadata?.level) }
          : {}),
      },
      attributes: {
        class: active.host.className,
        "data-editor-text-root": "true",
        "data-editor-shared-text-view": "true",
      },
    };
  }

  private rebuildActiveState(preserveSelection: boolean): void {
    const active = this.active;
    const view = this.readView();
    if (!active || !view) return;
    const anchorOffset =
      blockTextCoordinateCodec.proseMirrorPositionToCanonicalOffset(
        view.state.selection.anchor,
        view.state,
      );
    const focusOffset =
      blockTextCoordinateCodec.proseMirrorPositionToCanonicalOffset(
        view.state.selection.head,
        view.state,
      );
    view.setProps(
      createBlockLocalProseMirrorViewProps(this.createViewOptions(active)),
    );
    if (preserveSelection)
      installViewSelection(view, anchorOffset, focusOffset);
    if (active.placeholder) {
      view.dom.dataset.editorPlaceholderVisibility =
        active.placeholder.visibility;
    } else {
      delete view.dom.dataset.editorPlaceholderVisibility;
    }
  }

  private attachViewToHost(view: EditorView, host: HTMLElement): void {
    if (view.dom.parentElement !== host) host.append(view.dom);
    view.updateRoot();
  }

  private detachActiveBlock(): void {
    const active = this.active;
    if (!active) return;
    this.active = null;
    active.unsubscribeBlock();
    active.unsubscribeContent();
    if (active.captureBeforeInput && active.beforeInputTarget) {
      active.beforeInputTarget.removeEventListener(
        "beforeinput",
        active.captureBeforeInput,
        true,
      );
      active.beforeInputTarget = null;
    }
    active.triggerProvenanceBridge?.dispose();
    active.proposalAdapter.dispose();
    active.contentLease.release();
    if (this.view) delete this.view.dom.dataset.editorInputOwner;
    if (this.view) delete this.view.dom.dataset.editorCompositionPinned;
    const view = this.readView();
    if (view) {
      clearRootNativeSelection(view.dom);
      view.dom.remove();
    }
    if (active.host.projection.hidden) active.host.projection.hidden = false;
    if (active.host.projection.hasAttribute("aria-hidden"))
      active.host.projection.removeAttribute("aria-hidden");
    if (active.host.projection.dataset.editorTextRoot !== "true")
      active.host.projection.dataset.editorTextRoot = "true";
  }
}

function nativeSelectionMatches(
  document: Document,
  point: { readonly node: Node; readonly offset: number },
): boolean {
  const selection = document.getSelection();
  return Boolean(
    selection?.isCollapsed &&
    selection.focusNode === point.node &&
    selection.focusOffset === point.offset,
  );
}

function samePlaceholder(
  left: TextPlaceholder | undefined,
  right: TextPlaceholder | undefined,
): boolean {
  return left?.text === right?.text && left?.visibility === right?.visibility;
}

function installViewCaret(view: EditorView, canonicalOffset: number): void {
  const offset = Math.min(
    Math.max(0, Math.trunc(canonicalOffset)),
    readEditorViewContentSize(view),
  );
  const selection = createCollapsedCaretSelection(view, offset);
  if (!selection.eq(view.state.selection)) {
    view.updateState(view.state.apply(view.state.tr.setSelection(selection)));
  }
}

function installViewSelection(
  view: EditorView,
  canonicalAnchorOffset: number,
  canonicalFocusOffset: number,
): void {
  const selection = createViewTextSelection(
    view,
    canonicalAnchorOffset,
    canonicalFocusOffset,
  );
  if (!selection.eq(view.state.selection)) {
    view.updateState(view.state.apply(view.state.tr.setSelection(selection)));
  }
}

function createViewTextSelection(
  view: EditorView,
  canonicalAnchorOffset: number,
  canonicalFocusOffset: number,
): TextSelection {
  const contentSize = readEditorViewContentSize(view);
  const anchorOffset = Math.min(
    Math.max(0, canonicalAnchorOffset),
    contentSize,
  );
  const focusOffset = Math.min(Math.max(0, canonicalFocusOffset), contentSize);
  const anchor = blockTextCoordinateCodec.canonicalOffsetToProseMirrorPosition(
    anchorOffset,
    view.state,
  );
  const focus = blockTextCoordinateCodec.canonicalOffsetToProseMirrorPosition(
    focusOffset,
    view.state,
  );
  return TextSelection.create(view.state.doc, anchor, focus);
}

function projectNativeViewSelection(
  view: EditorView,
  selection: TextSelection,
): boolean {
  const native = view.dom.ownerDocument.getSelection();
  if (!native) return false;
  const anchor = view.domAtPos(selection.anchor);
  const focus = view.domAtPos(selection.head);
  if (
    native.anchorNode === anchor.node &&
    native.anchorOffset === anchor.offset &&
    native.focusNode === focus.node &&
    native.focusOffset === focus.offset
  ) {
    return true;
  }
  try {
    if (selection.anchor <= selection.head) {
      const range = view.dom.ownerDocument.createRange();
      range.setStart(anchor.node, anchor.offset);
      range.setEnd(focus.node, focus.offset);
      native.removeAllRanges();
      native.addRange(range);
    } else {
      const range = view.dom.ownerDocument.createRange();
      range.setStart(anchor.node, anchor.offset);
      range.collapse(true);
      native.removeAllRanges();
      native.addRange(range);
      native.extend(focus.node, focus.offset);
    }
    return (
      native.anchorNode === anchor.node &&
      native.anchorOffset === anchor.offset &&
      native.focusNode === focus.node &&
      native.focusOffset === focus.offset
    );
  } catch {
    return false;
  }
}

function readActivationCanonicalRange(
  editor: EditorRuntimePort,
  activation: TextActivationObligation,
): { readonly anchorOffset: number; readonly focusOffset: number } | null {
  const canonical = editor.selectionController.getCanonicalSnapshot();
  if (
    canonical.kind !== "document" ||
    canonical.revision !== activation.canonicalSelectionRevision
  ) {
    return null;
  }
  const selection = canonical.snapshot.documentSelection;
  const anchor = selection.anchor;
  const focus = selection.focus;
  return anchor &&
    focus &&
    anchor.blockId === activation.blockId &&
    focus.blockId === activation.blockId &&
    anchor.textOffset !== focus.textOffset
    ? { anchorOffset: anchor.textOffset, focusOffset: focus.textOffset }
    : null;
}

function readInstalledNativeFocus(
  view: EditorView,
  canonicalFocusOffset: number,
): NativeCaretProjectionResult {
  const selection = view.dom.ownerDocument.getSelection();
  const focusNode = selection?.focusNode ?? null;
  if (!selection || !focusNode || !view.dom.contains(focusNode)) {
    return { status: "rejected" };
  }
  const offset = blockTextCoordinateCodec.domPointToCanonicalOffset(
    view,
    focusNode,
    selection.focusOffset,
  );
  return offset === canonicalFocusOffset
    ? {
        status: "projected",
        nativePoint: { node: focusNode, offset: selection.focusOffset },
      }
    : { status: "rejected" };
}

function collapsedSelectionOffset(state: EditorState): number | null {
  if (!state.selection.empty) return null;
  return blockTextCoordinateCodec.proseMirrorPositionToCanonicalOffset(
    state.selection.head,
    state,
  );
}

export function readEditorViewSelectionOffset(view: EditorView): number | null {
  if (view.isDestroyed || !view.dom.isConnected) return null;
  const selection = view.dom.ownerDocument.getSelection();
  const anchorNode = selection?.anchorNode ?? null;
  if (selection?.isCollapsed && anchorNode && view.dom.contains(anchorNode)) {
    const offset = blockTextCoordinateCodec.domPointToCanonicalOffset(
      view,
      anchorNode,
      selection.anchorOffset,
    );
    if (offset !== null) {
      return Math.min(Math.max(0, offset), readEditorViewContentSize(view));
    }
  }
  const offset = collapsedSelectionOffset(view.state);
  return offset === null
    ? null
    : Math.min(Math.max(0, offset), readEditorViewContentSize(view));
}

export function readEditorViewPlainText(view: EditorView): string {
  return view.state.doc.textBetween(0, view.state.doc.content.size, "\n", "\n");
}

function projectActivationNativeCaret(
  root: HTMLElement,
  activation: TextActivationObligation,
): NativeCaretProjectionResult {
  return projectNativeCaret({
    root,
    blockId: activation.blockId,
    canonicalSelectionRevision: activation.canonicalSelectionRevision,
    canonicalTextOffset: activation.canonicalTextOffset,
    affinity: activation.affinity,
    activationIdentity: activation.identity,
    focusMode: activation.focusMode,
  });
}

function clearRootNativeSelection(root: HTMLElement): void {
  const selection = root.ownerDocument.getSelection();
  if (
    selection?.anchorNode &&
    (selection.anchorNode === root || root.contains(selection.anchorNode))
  ) {
    selection.removeAllRanges();
  }
}
