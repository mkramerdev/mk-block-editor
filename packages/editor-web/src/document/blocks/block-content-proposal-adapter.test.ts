import { afterEach, describe, expect, it, vi } from "vitest";
import { asBlockId } from "@repo/editor-core/kernel";
import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import { removeBlocks } from "@repo/editor-core/editing";
import {
  createBlockLocalProseMirrorState,
  createBlockLocalProseMirrorView,
  type ProseMirrorStateProposal,
} from "@repo/editor-dom/block-editor";
import { TextSelection, type EditorView } from "@repo/editor-dom/prosemirror";
import type { EditorSemanticChange } from "../../runtime/document/contracts.ts";
import type { EditableEditorRuntimePort } from "../../runtime/document/render-port.ts";
import { createTestEditorSnapshot } from "../../tests/editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import { initializeTestEditableEditor } from "../../tests/test-editor-initializers.ts";
import { createTestContentOperationUpdate } from "../../tests/editor-web-test-helpers.ts";
import { ActiveProseMirrorProposalAdapter } from "./block-content-proposal-adapter.ts";
import type { EditableEditorDefinition } from "../../runtime/definition/contracts.ts";
import type { EditorLocalMutationProvenance } from "@repo/editor-react/editor";
import { createEditorLogicalSelectionPoint } from "@repo/editor-react/selection";
import {
  createWebSelectionTextAnchorAtOffset,
  resolveWebSelectionTextAnchorPoint,
} from "../selection/anchors/text-anchor.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000000901");
const liveViews: EditorView[] = [];
const liveEditors: EditableEditorRuntimePort[] = [];
const liveContentLeases: Array<{ release(): void }> = [];

function expectCollapsedCanonicalOffset(
  editor: EditableEditorRuntimePort,
  offset: number,
): void {
  expect(editor.selectionController.canonical.getSnapshot()).toMatchObject({
    kind: "document",
    snapshot: {
      endpoints: {
        anchor: { blockId, textOffset: offset },
        head: { blockId, textOffset: offset },
      },
    },
  });
}

afterEach(() => {
  for (const view of liveViews.splice(0)) view.destroy();
  for (const lease of liveContentLeases.splice(0)) lease.release();
  for (const editor of liveEditors.splice(0)) editor.dispose();
  document.body.replaceChildren();
});

describe("ActiveProseMirrorProposalAdapter", () => {
  it("opens a headless session only when an accepted proposal carries a typing edge", () => {
    const definition: EditableEditorDefinition = {
      ...testEditableEditorDefinition,
      typingTriggers: [{ id: "mention", trigger: "@" }],
    };
    const { editor, view, captureProvenance } = createMountedEditor(
      "",
      definition,
    );

    view.dispatch(view.state.tr.insertText("@", 1));
    expect(editor.getTypingTriggerSession()).toBeNull();
    expect(editor.undo()).toEqual({ status: "applied" });

    captureProvenance({ kind: "typing", text: "@", inputType: "text" });
    view.dispatch(view.state.tr.insertText("@", 1));
    expect(editor.getTypingTriggerSession()).toMatchObject({
      triggerId: "mention",
      trigger: "@",
      range: { from: 0, to: 1 },
      query: "",
    });
  });

  it("retains beforeinput provenance until a native DOM proposal microtask", async () => {
    const definition: EditableEditorDefinition = {
      ...testEditableEditorDefinition,
      typingTriggers: [{ id: "mention", trigger: "@" }],
    };
    const { editor, view, captureProvenance } = createMountedEditor(
      "",
      definition,
    );

    captureProvenance({ kind: "typing", text: "@", inputType: "text" });
    await Promise.resolve();
    view.dispatch(view.state.tr.insertText("@", 1));

    expect(editor.getTypingTriggerSession()).toMatchObject({
      triggerId: "mention",
      query: "",
    });
  });

  it("commits typing, settles selection before publication, and installs the exact proposal", () => {
    const order: string[] = [];
    const changes: EditorSemanticChange[] = [];
    const standalone = vi.fn();
    const { editor, view, adapter } = createMountedEditor(
      "abc",
      testEditableEditorDefinition,
      (transaction) => {
        changes.push(transaction as EditorSemanticChange);
        order.push("semantic");
      },
    );
    const unsubscribeStandalone =
      editor.subscribeStandaloneSelectionSettlements(standalone);
    editor.selectionController.canonical.subscribe(() =>
      order.push("selection"),
    );
    editor.contentRuntime.subscribeBlockProjection(blockId, () =>
      order.push("content"),
    );
    const evaluateProposal = vi.spyOn(adapter, "evaluateProposal");
    const updateState = vi.spyOn(view, "updateState");
    const acceptProposal = vi.spyOn(editor, "acceptContentOperationProposal");
    const focusText = vi.spyOn(editor, "focusText");
    view.focus();
    const nativeFocus = vi.spyOn(view.dom, "focus");
    updateState.mockClear();

    const transaction = view.state.tr.insertText("X", 2);
    transaction.setSelection(TextSelection.create(transaction.doc, 3));
    view.dispatch(transaction);

    const proposedState = evaluateProposal.mock.calls.find(
      ([proposal]) =>
        !proposal.proposedState.doc.eq(proposal.previousState.doc),
    )?.[0].proposedState;
    expect(editor.readBlockPlainText(blockId, "textBlock")).toBe("aXbc");
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      selectionBefore: { kind: "none" },
      selectionAfter: {
        kind: "selection",
        selection: {
          kind: "document",
          anchor: { kind: "text", blockId },
          focus: { kind: "text", blockId },
        },
      },
    });
    expect(standalone).not.toHaveBeenCalled();
    unsubscribeStandalone();
    expect(view.state).toBe(proposedState);
    expect(updateState).toHaveBeenCalledOnce();
    expect(updateState).toHaveBeenCalledWith(proposedState);
    expect(order.indexOf("selection")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("semantic")).toBeGreaterThan(
      order.indexOf("selection"),
    );
    expect(order.indexOf("content")).toBeGreaterThan(order.indexOf("semantic"));
    expect(acceptProposal).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        origin: "prosemirror-proposal",
        selectionPresentation: "native-already-established",
        provenance: null,
        releaseAfterProposedStateInstalled: true,
      }),
    );
    expect(focusText).not.toHaveBeenCalled();
    expect(nativeFocus).not.toHaveBeenCalled();
    expectCollapsedCanonicalOffset(editor, 2);
    expect(editor.canUndo).toBe(true);
  });

  it("keeps consecutive focused native proposals free of focusText calls", () => {
    const { editor, view } = createMountedEditor("");
    const focusText = vi.spyOn(editor, "focusText");
    view.focus();
    const nativeFocus = vi.spyOn(view.dom, "focus");

    view.dispatch(view.state.tr.insertText("a", 1));
    view.dispatch(view.state.tr.insertText("b", 2));
    view.dispatch(view.state.tr.insertText("c", 3));

    expect(editor.readBlockPlainText(blockId, "textBlock")).toBe("abc");
    expect(focusText).not.toHaveBeenCalled();
    expect(nativeFocus).not.toHaveBeenCalled();
    expectCollapsedCanonicalOffset(editor, 3);
  });

  it("installs an editor-owned beforeinput selection from the accepted proposed state", () => {
    const { editor, view } = createMountedEditor("abc");
    const acceptProposal = vi.spyOn(editor, "acceptContentOperationProposal");
    view.focus();
    view.dispatch(
      view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)),
    );
    acceptProposal.mockClear();
    const text = view.dom.querySelector("[data-block-node]")?.firstChild;
    if (!text) throw new Error("Expected mounted block-local text");
    const event = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward",
    });
    Object.defineProperty(event, "getTargetRanges", {
      value: () => [
        new StaticRange({
          startContainer: text,
          startOffset: 2,
          endContainer: text,
          endOffset: 3,
        }),
      ],
    });

    view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(editor.readBlockPlainText(blockId, "textBlock")).toBe("ab");
    expect(acceptProposal).toHaveBeenCalledWith(
      expect.objectContaining({
        selectionAfter: expect.objectContaining({
          anchor: expect.any(Object),
          focus: expect.any(Object),
        }),
      }),
      expect.objectContaining({
        selectionPresentation: "installed-by-proposed-state",
        releaseAfterProposedStateInstalled: true,
      }),
    );
    const selectionAfter = acceptProposal.mock.calls[0]?.[0].selectionAfter;
    expect(selectionAfter?.anchor).toBe(selectionAfter?.focus);
  });

  it("restores canonical selection without invoking the public focus action", () => {
    const { editor, view } = createMountedEditor("abc");
    const acceptProposal = vi.spyOn(editor, "acceptContentOperationProposal");
    const focusText = vi.spyOn(editor, "focusText");

    const transaction = view.state.tr.insertText("X", 2);
    transaction.setSelection(TextSelection.create(transaction.doc, 3));
    view.dispatch(transaction);

    expect(acceptProposal).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        origin: "prosemirror-proposal",
        selectionPresentation: "restore-native",
        provenance: null,
        releaseAfterProposedStateInstalled: true,
      }),
    );
    expect(focusText).not.toHaveBeenCalled();
    expectCollapsedCanonicalOffset(editor, 2);
  });

  it("collapses selectionAfter from a content proposal at its input head", () => {
    const { editor, view } = createMountedEditor("abcd");
    const focusText = vi.spyOn(editor, "focusText");
    view.focus();
    const transaction = view.state.tr.insertText("X", 2, 3);
    transaction.setSelection(TextSelection.create(transaction.doc, 4, 2));

    view.dispatch(transaction);

    const canonical = editor.selectionController.canonical.getSnapshot();
    expect(canonical.kind).toBe("document");
    expect(
      canonical.kind === "document"
        ? canonical.snapshot.documentSelection
        : null,
    ).toMatchObject({
      direction: "backward",
      anchor: { blockId, textOffset: 3, affinity: null },
      focus: { blockId, textOffset: 1, affinity: null },
    });
    expect(view.state.selection).toMatchObject({ anchor: 4, head: 2 });
    expect(focusText).not.toHaveBeenCalled();
  });

  it("settles a no-content PM selection transaction through canonical selection without history", () => {
    const { editor, view } = createMountedEditor("abc");
    const focusText = vi.spyOn(editor, "focusText");
    view.focus();
    const before = editor.contentRuntime.readContentBaseToken(
      blockId,
      "textBlock",
      editor.getSelectionGraphRevision(),
    );
    const contentPublication = vi.fn();
    editor.contentRuntime.subscribeBlockProjection(blockId, contentPublication);

    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
    );

    const canonical = editor.selectionController.canonical.getSnapshot();
    expect(canonical).toMatchObject({
      kind: "document",
      snapshot: {
        documentSelection: {
          anchor: { blockId, textOffset: 2, affinity: null },
          focus: { blockId, textOffset: 2, affinity: null },
        },
      },
    });
    expect(editor.canUndo).toBe(false);
    expect(contentPublication).not.toHaveBeenCalled();
    expect(focusText).not.toHaveBeenCalled();
    expect(
      editor.contentRuntime.readContentBaseToken(
        blockId,
        "textBlock",
        editor.getSelectionGraphRevision(),
      ).contentRevision,
    ).toBe(before.contentRevision);
    expect(view.state.selection).toMatchObject({ anchor: 3, head: 3 });
  });

  it("settles a ProseMirror-owned text range through the same canonical path inside an internal host", () => {
    const { editor, view } = createMountedEditor("abc");
    commitCanonicalTextSelection(editor, 1, 3);
    view.dom.parentElement?.setAttribute(
      "data-editor-block-internal-selection-host",
      "true",
    );
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 4)),
    );

    expect(view.state.selection).toMatchObject({ anchor: 2, head: 4 });
    expect(editor.selectionController.getCanonicalSnapshot()).toMatchObject({
      kind: "document",
      snapshot: {
        documentSelection: {
          anchor: { blockId, textOffset: 1 },
          focus: { blockId, textOffset: 3 },
        },
      },
    });
    expect(editor.canUndo).toBe(false);
  });

  it("does not let the block-internal range exception affect an ordinary text root", () => {
    const { editor, view, adapter } = createMountedEditor("abc");
    commitCanonicalTextSelection(editor, 1, 3);
    const authoritative = editor.selectionController.getCanonicalSnapshot();

    adapter.projectFinalizedContent(view);

    expect(view.state.selection).toMatchObject({ anchor: 2, head: 4 });
    expect(editor.selectionController.getCanonicalSnapshot()).toBe(
      authoritative,
    );
    expect(editor.canUndo).toBe(false);
  });

  it("accepts a same-caret ProseMirror acknowledgement without replacing or republishing canonical selection", () => {
    const { editor, view } = createMountedEditor("abc");
    view.focus();
    view.dispatch(view.state.tr.insertText("X"));
    const authoritative = editor.selectionController.getCanonicalSnapshot();
    const settlement =
      editor.selectionController.getPresentationSnapshot().settlement;
    const publication = vi.fn();
    editor.selectionController.canonical.subscribe(publication);

    view.dispatch(view.state.tr.setSelection(view.state.selection));

    expect(editor.selectionController.getCanonicalSnapshot()).toBe(
      authoritative,
    );
    expect(
      editor.selectionController.getPresentationSnapshot().settlement,
    ).toBe(settlement);
    expect(publication).not.toHaveBeenCalled();
    expect(view.state.selection.empty).toBe(true);
  });

  it("installs a view/plugin-only state without an editor operation", () => {
    const { editor, view } = createMountedEditor("abc");
    const acceptProposal = vi.spyOn(editor, "acceptContentOperationProposal");
    const previousState = view.state;

    view.dispatch(view.state.tr.setMeta("test-plugin-state", { open: true }));

    expect(view.state).not.toBe(previousState);
    expect(view.state.doc).toBe(previousState.doc);
    expect(acceptProposal).not.toHaveBeenCalled();
    expect(editor.canUndo).toBe(false);
  });

  it("rejects a stale proposal and returns the latest committed projection", () => {
    const { editor, view, adapter } = createMountedEditor("abc");
    view.dispatch(
      view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)),
    );
    const authoritativeSelection =
      editor.selectionController.canonical.getSnapshot();
    const previousState = view.state;
    const base = adapter.readContentBaseToken();
    const applied = previousState.applyTransaction(
      previousState.tr.insertText("X", 2),
    );
    const proposal: ProseMirrorStateProposal = {
      previousState,
      proposedState: applied.state,
      transactions: applied.transactions,
      base,
    };
    editor.contentRuntime.applyExternalContentUpdate({
      blockGraphVersion: editor.getSelectionGraphRevision(),
      blockId,
      blockType: "textBlock",
      update: createTestContentOperationUpdate(editor.contentRuntime),
      readProjection: documentWithText("remote"),
      revision: 1,
    });

    const disposition = adapter.evaluateProposal(proposal, view);
    view.updateState(disposition.state);

    expect(disposition.kind).toBe("rejected");
    expect(view.state.doc.textContent).toBe("remote");
    expect(editor.readBlockPlainText(blockId, "textBlock")).toBe("remote");
    expect(editor.canUndo).toBe(false);
    expect(editor.selectionController.canonical.getSnapshot()).toBe(
      authoritativeSelection,
    );
  });

  it("installs one committed state when canonical acceptance rejects", () => {
    const { editor, view } = createMountedEditor("abc");
    const updateState = vi.spyOn(view, "updateState");
    vi.spyOn(editor, "acceptContentOperationProposal").mockReturnValue({
      ok: false,
      reason: "invalid-operation",
      message: "rejected for test",
    });

    view.dispatch(view.state.tr.insertText("X", 2));

    expect(view.state.doc.textContent).toBe("abc");
    expect(updateState).toHaveBeenCalledOnce();
  });

  it("consumes a typing edge once even when canonical acceptance rejects", () => {
    const definition: EditableEditorDefinition = {
      ...testEditableEditorDefinition,
      typingTriggers: [{ id: "mention", trigger: "@" }],
    };
    const { editor, view, captureProvenance } = createMountedEditor(
      "",
      definition,
    );
    const accept = vi.spyOn(editor, "acceptContentOperationProposal");
    accept.mockReturnValueOnce({
      ok: false,
      reason: "invalid-operation",
      message: "rejected for test",
    });
    captureProvenance({ kind: "typing", text: "@", inputType: "text" });

    view.dispatch(view.state.tr.insertText("@", 1));
    view.dispatch(view.state.tr.insertText("@", 1));

    expect(editor.readBlockPlainText(blockId, "textBlock")).toBe("@");
    expect(editor.getTypingTriggerSession()).toBeNull();
    expect(accept.mock.calls.map(([, context]) => context.provenance)).toEqual([
      { kind: "typing", text: "@", inputType: "text" },
      null,
    ]);
  });

  it.each([
    ["graph revision", { graphRevision: 99 }],
    ["block type", { blockType: "alternateTextBlock" as const }],
  ])("rejects a stale %s base before content application", (_label, patch) => {
    const { editor, view, adapter } = createMountedEditor("abc");
    const previousState = view.state;
    const applied = previousState.applyTransaction(
      previousState.tr.insertText("X", 2),
    );

    const disposition = adapter.evaluateProposal(
      {
        previousState,
        proposedState: applied.state,
        transactions: applied.transactions,
        base: { ...adapter.readContentBaseToken(), ...patch },
      },
      view,
    );

    expect(disposition.kind).toBe("rejected");
    expect(editor.readBlockPlainText(blockId, "textBlock")).toBe("abc");
    expect(editor.canUndo).toBe(false);
  });

  it("projects finalized external and undo changes without proposal feedback", () => {
    const { editor, view, adapter } = createMountedEditor("abc");
    const acceptProposal = vi.spyOn(editor, "acceptContentOperationProposal");
    const projectFinalized = vi.spyOn(adapter, "projectFinalizedContent");

    editor.contentRuntime.applyExternalContentUpdate({
      blockGraphVersion: editor.getSelectionGraphRevision(),
      blockId,
      blockType: "textBlock",
      update: createTestContentOperationUpdate(editor.contentRuntime),
      readProjection: documentWithText("external"),
      revision: 1,
    });

    expect(view.state.doc.textContent).toBe("external");
    expect(acceptProposal).not.toHaveBeenCalled();
    expect(projectFinalized).toHaveBeenCalledOnce();

    view.dispatch(view.state.tr.insertText("!", 9));
    expect(acceptProposal).toHaveBeenCalledTimes(1);
    expect(projectFinalized).toHaveBeenCalledOnce();
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(view.state.doc.textContent).toBe("external");
    expect(acceptProposal).toHaveBeenCalledTimes(1);
    expect(projectFinalized).toHaveBeenCalledTimes(2);
  });

  it("keeps a canonical range authoritative while finalized content is reprojected", () => {
    const { editor, view, adapter } = createMountedEditor("abcdef");
    commitCanonicalTextSelection(editor, 1, 5);
    const canonical = editor.selectionController.getCanonicalSnapshot();
    const revision =
      editor.selectionController.canonical.getSnapshot().revision;
    const publication = vi.fn();
    editor.selectionController.canonical.subscribe(publication);

    adapter.projectFinalizedContent(view);
    expect(view.state.selection.empty).toBe(false);
    expect(view.state.selection).toMatchObject({ anchor: 2, head: 6 });

    editor.contentRuntime.applyExternalContentUpdate({
      blockGraphVersion: editor.getSelectionGraphRevision(),
      blockId,
      blockType: "textBlock",
      update: createTestContentOperationUpdate(editor.contentRuntime),
      readProjection: documentWithText("Xabcdef"),
      revision: 1,
    });
    adapter.projectFinalizedContent(view);
    expect(view.state.doc.textContent).toBe("Xabcdef");
    expect(view.state.selection).toMatchObject({ anchor: 2, head: 6 });
    expect(editor.selectionController.getCanonicalSnapshot()).toBe(canonical);
    expect(editor.selectionController.canonical.getSnapshot().revision).toBe(
      revision,
    );
    expect(publication).not.toHaveBeenCalled();
    expect(editor.canUndo).toBe(false);
  });

  it("keeps ProseMirror collapsed when undo and redo reproject finalized content", () => {
    const { editor, view } = createMountedEditor("abcdef");
    view.dispatch(view.state.tr.insertText("!", 7));
    expect(editor.readBlockPlainText(blockId, "textBlock")).toBe("abcdef!");
    commitCanonicalTextSelection(editor, 1, 5);

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(view.state.doc.textContent).toBe("abcdef");
    expect(view.state.selection.empty).toBe(true);

    expect(editor.redo()).toEqual({ status: "applied" });
    expect(view.state.doc.textContent).toBe("abcdef!");
    expect(view.state.selection.empty).toBe(true);
  });

  it("invalidates a mounted view when its finalized block is deleted", () => {
    const { editor, view, adapter } = createMountedEditor("abc");

    const result = editor.executeStructuralTransaction({
      origin: "test:block-deletion",
      operations: [
        removeBlocks({ blockIds: [blockId], includeDescendants: true }),
      ],
    });

    expect(result).toMatchObject({ ok: true, operationResult: { ok: true } });
    adapter.reconcileFinalizedBlock(view);
    expect(view.editable).toBe(false);
  });

  it("keeps composition text as an unpublished host draft until one semantic completion", () => {
    const { editor, view, adapter } = createMountedEditor("abc");
    commitCanonicalTextSelection(editor, 0, 2);
    const frozen = editor.selectionController.getCommittedSnapshot();
    expect(frozen).not.toBeNull();
    const base = editor.contentRuntime.readContentBaseToken(
      blockId,
      "textBlock",
      editor.getSelectionGraphRevision(),
    );
    const session = editor.selectionController.beginCompositionSession({
      frozenSelection: frozen!,
      graphRevision: editor.getSelectionGraphRevision(),
      baseTokens: [base],
      hostBlockId: blockId,
    });
    expect(session).not.toBeNull();
    const accept = vi.spyOn(editor, "acceptContentOperationProposal");

    view.dispatch(view.state.tr.insertText("X", 1, 3));
    adapter.projectFinalizedContent(view);

    expect(view.state.doc.textContent).toBe("Xc");
    expect(editor.readBlockPlainText(blockId, "textBlock")).toBe("abc");
    expect(editor.canUndo).toBe(false);
    expect(accept).not.toHaveBeenCalled();
    expect(
      editor.selectionController.getPresentationSnapshot().composition
        ?.latestText,
    ).toBe("X");

    editor.selectionController.cancelCompositionSession(session!.revision);
    adapter.restoreCommittedProjectionAfterComposition(view);
    expect(view.state.doc.textContent).toBe("abc");
  });
});

function createMountedEditor(
  text: string,
  definition: EditableEditorDefinition = testEditableEditorDefinition,
  onChange?: (transaction: unknown) => void,
): {
  readonly editor: EditableEditorRuntimePort;
  readonly view: EditorView;
  readonly adapter: ActiveProseMirrorProposalAdapter;
  readonly captureProvenance: (
    provenance: EditorLocalMutationProvenance,
  ) => void;
} {
  const editor = initializeTestEditableEditor({
    definition,
    snapshot: createTestEditorSnapshot([
      { id: blockId, type: "textBlock", text },
    ]),
    onChange,
  }) as EditableEditorRuntimePort;
  liveEditors.push(editor);
  liveContentLeases.push(
    editor.contentRuntime.acquireBlockContent(
      blockId,
      "textBlock",
      "active-editing",
    ),
  );
  const content = editor.contentRuntime.readBlockProjection(
    blockId,
    "textBlock",
  );
  if (!content) throw new Error("The mounted test block has no content.");
  const state = createBlockLocalProseMirrorState({
    doc: content,
    blockId,
    blockType: "textBlock",
    schema: editor.contentResources.proseMirrorSchema,
  });
  let pendingProvenance: EditorLocalMutationProvenance | null = null;
  const triggerEnabled = (definition.typingTriggers?.length ?? 0) > 0;
  const adapter = new ActiveProseMirrorProposalAdapter({
    blockId,
    blockType: "textBlock",
    editor,
    contentRuntime: editor.contentRuntime,
    consumeLocalMutationProvenance: triggerEnabled
      ? () => {
          const provenance = pendingProvenance;
          pendingProvenance = null;
          return provenance;
        }
      : null,
  });
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  const view = createBlockLocalProseMirrorView({
    mount,
    blockId,
    blockType: "textBlock",
    state,
    schema: editor.contentResources.proseMirrorSchema,
    proposalAdapter: adapter,
  });
  liveViews.push(view);
  editor.contentRuntime.subscribeBlockProjection(blockId, (commit) => {
    if (commit && adapter.ownsContentCommitOrigin(commit.origin)) return;
    adapter.projectFinalizedContent(view, commit);
  });
  return {
    editor,
    view,
    adapter,
    captureProvenance: (provenance) => {
      pendingProvenance = provenance;
    },
  };
}

function commitCanonicalTextSelection(
  editor: EditableEditorRuntimePort,
  anchorOffset: number,
  focusOffset: number,
): void {
  const lease = editor.contentRuntime.acquireBlockContent(
    blockId,
    "textBlock",
    "canonical-transaction",
  );
  const point = (offset: number) => {
    const anchor = createWebSelectionTextAnchorAtOffset({
      contentRuntime: editor.contentRuntime,
      contentLease: lease,
      blockId,
      blockType: "textBlock",
      textOffset: offset,
    });
    if (!anchor.ok) throw new Error(anchor.message);
    const logical = createEditorLogicalSelectionPoint({
      graph: editor,
      blockId,
      textOffset: anchor.textOffset,
      textAnchor: anchor.textAnchor,
    });
    if (!logical) throw new Error("Expected canonical text point");
    return logical;
  };
  const result = editor.selectionController.commitCanonicalSelection(
    {
      direction: anchorOffset <= focusOffset ? "forward" : "backward",
      anchor: point(anchorOffset),
      focus: point(focusOffset),
    },
    editor,
    editor.getSelectionGraphRevision(),
    {
      publication: { kind: "standalone-local" },
      cause: "keyboard",
    },
    {
      resolveTextAnchor: (point) =>
        resolveWebSelectionTextAnchorPoint(
          point,
          editor,
          editor.contentRuntime,
        ),
    },
  );
  lease.release();
  if (result.kind === "rejected") throw new Error("Selection was rejected");
}

function documentWithText(text: string): RichTextDocumentNodeJson {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        ...(text ? { content: [{ type: "text", text }] } : {}),
      },
    ],
  };
}
