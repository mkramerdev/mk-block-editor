import { renderHook } from "@testing-library/react";
import { contentSelection } from "@repo/editor-core/selection";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  createEditorLogicalSelectionPoint,
  createEditorSelectionTextAnchor,
  createSelectionController,
  type EditorLogicalSelectionPoint,
  type EditorSelectionGraphReader,
  type EditorSelectionTextAnchorResolver,
  type SelectionPresentationSnapshot,
} from "@repo/editor-react/selection";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorWebContentRuntime } from "../../../runtime/content/content-runtime.ts";
import type { EditorRuntimePort } from "../../../runtime/document/render-port.ts";
import { useNativeSelectionSynchronization } from "./native-selection-synchronization.ts";

describe("native selection synchronization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reflects custom selection paint without deleting the native input caret", () => {
    const removeAllRanges = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({
      removeAllRanges,
    } as unknown as Selection);
    const list = document.createElement("div");
    document.body.append(list);
    const hook = renderHook(() =>
      useNativeSelectionSynchronization({
        listElement: list,
        editor: {} as EditorRuntimePort,
        contentRuntime: {} as EditorWebContentRuntime,
        selectionController: createSelectionController(),
        presentation: presentation(null),
        textAnchorResolver: passthroughTextAnchorResolver,
      }),
    );

    expect(list.dataset.editorNativeSelectionPaintMode).toBe(
      "hidden-for-global-selection",
    );
    expect(removeAllRanges).not.toHaveBeenCalled();

    hook.unmount();
    expect(list.dataset.editorNativeSelectionPaintMode).toBeUndefined();
    list.remove();
  });

  it("preserves native selection while composition owns browser paint", () => {
    const removeAllRanges = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({
      removeAllRanges,
    } as unknown as Selection);
    const list = document.createElement("div");
    document.body.append(list);
    const selectionController = createSelectionController();
    expect(
      selectionController.commitSelectionPoint(
        testSelectionPoint(),
        selectionGraph,
        1,
        { publication: { kind: "silent" }, cause: "focus" },
      ),
    ).toMatchObject({ kind: "changed" });
    const frozenSelection = selectionController.getCommittedSnapshot();
    if (!frozenSelection) throw new Error("Expected a committed selection");
    expect(
      selectionController.beginCompositionSession({
        frozenSelection,
        graphRevision: 1,
        baseTokens: [],
        hostBlockId: "source" as BlockId,
      }),
    ).not.toBeNull();
    const hook = renderHook(() =>
      useNativeSelectionSynchronization({
        listElement: list,
        editor: {} as EditorRuntimePort,
        contentRuntime: {} as EditorWebContentRuntime,
        selectionController,
        presentation: presentation(null),
        textAnchorResolver: passthroughTextAnchorResolver,
      }),
    );

    expect(removeAllRanges).not.toHaveBeenCalled();
    hook.unmount();
    list.remove();
  });

  it("preserves native input selection while an editor-owned UI control owns focus", () => {
    const removeAllRanges = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({
      removeAllRanges,
    } as unknown as Selection);
    const list = document.createElement("div");
    const shell = document.createElement("div");
    shell.dataset.editorBlockShell = "true";
    shell.dataset.editorBlockId = "source";
    const textRoot = document.createElement("div");
    textRoot.dataset.editorTextRoot = "true";
    textRoot.setAttribute("contenteditable", "true");
    textRoot.append(document.createTextNode("hello"));
    shell.append(textRoot);
    const objectUi = document.createElement("form");
    objectUi.dataset.editorUi = "true";
    const input = document.createElement("input");
    input.value = "https://first-draft.test/path";
    objectUi.append(input);
    list.append(shell, objectUi);
    document.body.append(list);
    input.focus();
    input.setSelectionRange(8, 19);
    const selectionController = createSelectionController();
    expect(
      selectionController.commitSelectionPoint(
        testSelectionPoint(),
        selectionGraph,
        1,
        { publication: { kind: "silent" }, cause: "focus" },
      ),
    ).toMatchObject({ kind: "changed" });
    const reconcileTextSelection = vi.fn();

    const hook = renderHook(() =>
      useNativeSelectionSynchronization({
        listElement: list,
        editor: {
          editable: true,
          ownsActiveTextTarget: () => true,
          nativeSelectionSynchronization: { reconcileTextSelection },
        } as unknown as EditorRuntimePort,
        contentRuntime: {} as EditorWebContentRuntime,
        selectionController,
        presentation: presentation(null),
        textAnchorResolver: passthroughTextAnchorResolver,
      }),
    );

    expect(removeAllRanges).not.toHaveBeenCalled();
    expect(reconcileTextSelection).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(8);
    expect(input.selectionEnd).toBe(19);

    textRoot.focus();
    expect(reconcileTextSelection).toHaveBeenCalledOnce();
    expect(reconcileTextSelection).toHaveBeenCalledWith("source", 0, 0);
    hook.unmount();
    list.remove();
  });

  it("does not project a stale native caret over a keyboard extension", () => {
    const list = document.createElement("div");
    const text = document.createElement("div");
    text.textContent = "first";
    list.append(text);
    document.body.append(list);
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(text);
    range.collapse(false);
    const selectionController = createSelectionController();
    selectionController.setKeyboardNavigation({
      preferredX: null,
    });
    const initialRevision = selectionController.getCanonicalSnapshot().revision;
    const hook = renderHook(() =>
      useNativeSelectionSynchronization({
        listElement: list,
        editor: {} as EditorRuntimePort,
        contentRuntime: {} as EditorWebContentRuntime,
        selectionController,
        presentation: presentation(null),
        textAnchorResolver: passthroughTextAnchorResolver,
      }),
    );

    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    expect(selectionController.getCanonicalSnapshot().revision).toBe(
      initialRevision,
    );
    hook.unmount();
    list.remove();
  });

  it("synchronously collapses an ordinary browser range during canonical pointer ownership", () => {
    const list = document.createElement("div");
    list.dataset.editorNativeCaretPointerPending = "true";
    const shell = document.createElement("div");
    shell.dataset.editorBlockShell = "true";
    shell.dataset.editorBlockId = "source";
    const textRoot = document.createElement("div");
    textRoot.dataset.editorTextRoot = "true";
    textRoot.setAttribute("contenteditable", "true");
    const text = document.createTextNode("hello world");
    textRoot.append(text);
    shell.append(textRoot);
    list.append(shell);
    document.body.append(list);
    const selectionController = createSelectionController();
    expect(
      selectionController.commitSelectionPoint(
        testSelectionPoint(),
        selectionGraph,
        1,
        { publication: { kind: "silent" }, cause: "focus" },
      ),
    ).toMatchObject({ kind: "changed" });
    const authoritative = selectionController.getCanonicalSnapshot();
    const reconcileTextSelection = vi.fn();
    const hook = renderHook(() =>
      useNativeSelectionSynchronization({
        listElement: list,
        editor: {
          editable: true,
          nativeSelectionSynchronization: { reconcileTextSelection },
          ownsActiveTextTarget: () => true,
        } as unknown as EditorRuntimePort,
        contentRuntime: {} as EditorWebContentRuntime,
        selectionController,
        presentation: selectionController.getPresentationSnapshot(),
        textAnchorResolver: passthroughTextAnchorResolver,
      }),
    );
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 5);
    const native = document.getSelection();
    native?.removeAllRanges();
    native?.addRange(range);

    document.dispatchEvent(new Event("selectionchange"));

    expect(reconcileTextSelection).toHaveBeenCalledOnce();
    expect(reconcileTextSelection).toHaveBeenCalledWith("source", 0, 0);
    expect(selectionController.getCanonicalSnapshot()).toBe(authoritative);
    hook.unmount();
    native?.removeAllRanges();
    list.remove();
  });

  it("acknowledges the projected caret and restores an unexpected native range", () => {
    const list = document.createElement("div");
    const shell = document.createElement("div");
    shell.dataset.editorBlockShell = "true";
    shell.dataset.editorBlockId = "source";
    const textRoot = document.createElement("div");
    textRoot.dataset.editorTextRoot = "true";
    textRoot.setAttribute("contenteditable", "true");
    const text = document.createTextNode("hello world");
    textRoot.append(text);
    shell.append(textRoot);
    list.append(shell);
    document.body.append(list);
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(text, 5);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const selectionController = createSelectionController();
    const acknowledgeTextActivation = vi.fn(() => true);
    const reconcileTextSelection = vi.fn();
    const editor = {
      editable: true,
      selectionController,
      getSelectionGraphRevision: () => 1,
      getBlock: (blockId: string) =>
        blockId === "source"
          ? { id: "source", type: "textbox", tombstone: false }
          : null,
      readBlockSelectionModel: () => contentSelection(),
      getRootBlockIds: () => ["source" as BlockId],
      getParentId: () => null,
      getChildBlockIds: () => [],
      acknowledgeTextActivation,
      nativeSelectionSynchronization: { reconcileTextSelection },
      ownsActiveTextTarget: () => true,
    } as unknown as EditorRuntimePort;
    const createTextAnchor = vi.fn(
      (input: { readonly textOffset: number }) => ({
        ok: true,
        codec: "test",
        payload: { encoded: btoa(String(input.textOffset)), assoc: 0 },
        textOffset: input.textOffset,
      }),
    );
    const contentRuntime = {
      tryCreateTextAnchorInLiveContext: createTextAnchor,
    } as unknown as EditorWebContentRuntime;
    const authoritativeAnchor = createEditorSelectionTextAnchor({
      codec: "test",
      payload: { encoded: btoa("authoritative"), assoc: 1 },
    });
    if (!authoritativeAnchor.ok) throw new Error(authoritativeAnchor.message);
    const authoritativePoint = createEditorLogicalSelectionPoint({
      graph: editor,
      blockId: "source" as BlockId,
      textOffset: 5,
      textAnchor: authoritativeAnchor.textAnchor,
      affinity: "forward",
    });
    if (!authoritativePoint) throw new Error("Expected authoritative point");
    expect(
      selectionController.commitCanonicalSelection(
        {
          direction: "forward",
          anchor: authoritativePoint,
          focus: authoritativePoint,
        },
        editor,
        1,
        {
          publication: { kind: "transaction", transactionId: "tx-2" },
          cause: "undo",
        },
        passthroughTextAnchorResolver,
      ),
    ).toMatchObject({ kind: "changed" });
    const authoritative = selectionController.getCanonicalSnapshot();
    const transactionMarker =
      selectionController.getPresentationSnapshot().settlement;
    const canonicalSubscriber = vi.fn();
    const presentationSubscriber = vi.fn();
    selectionController.canonical.subscribe(canonicalSubscriber);
    selectionController.presentation.subscribe(presentationSubscriber);
    const hook = renderHook(() =>
      useNativeSelectionSynchronization({
        listElement: list,
        editor,
        contentRuntime,
        selectionController,
        presentation: selectionController.getPresentationSnapshot(),
        textAnchorResolver: passthroughTextAnchorResolver,
      }),
    );

    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selection?.anchorNode).toBe(text);
    document.dispatchEvent(new Event("selectionchange"));

    expect(createTextAnchor).not.toHaveBeenCalled();
    expect(selectionController.getCanonicalSnapshot()).toBe(authoritative);
    expect(selectionController.getCanonicalSnapshot().revision).toBe(
      authoritative.revision,
    );
    expect(selectionController.getPresentationSnapshot().settlement).toBe(
      transactionMarker,
    );
    expect(canonicalSubscriber).not.toHaveBeenCalled();
    expect(presentationSubscriber).not.toHaveBeenCalled();
    expect(acknowledgeTextActivation).toHaveBeenCalledWith(
      "source",
      textRoot,
      5,
      text,
      5,
    );

    const changedRange = document.createRange();
    changedRange.setStart(text, 0);
    changedRange.setEnd(text, 5);
    selection?.removeAllRanges();
    selection?.addRange(changedRange);
    document.dispatchEvent(new Event("selectionchange"));

    expect(createTextAnchor).not.toHaveBeenCalled();
    expect(selectionController.getCanonicalSnapshot()).toBe(authoritative);
    expect(selectionController.getCanonicalSnapshot().revision).toBe(
      authoritative.revision,
    );
    expect(selectionController.getPresentationSnapshot().settlement).toBe(
      transactionMarker,
    );
    expect(
      selectionController.getPresentationSnapshot().nativeSelectionPaintMode,
    ).toBe("visible");
    expect(reconcileTextSelection).toHaveBeenCalledWith("source", 5, 5);
    expect(canonicalSubscriber).not.toHaveBeenCalled();
    expect(presentationSubscriber).not.toHaveBeenCalled();
    hook.unmount();
    selection?.removeAllRanges();
    list.remove();
  });

  it.each([
    { label: "collapsed caret", anchor: 3, focus: 3, direction: "forward" },
    { label: "forward range", anchor: 1, focus: 7, direction: "forward" },
    { label: "backward range", anchor: 7, focus: 1, direction: "backward" },
  ] as const)(
    "publishes a same-cell native $label inside an editable internal-selection host",
    ({ anchor, focus, direction }) => {
      const selectionController = createSelectionController();
      const fixture = createInternalHostTextFixture(selectionController);
      const canonicalSubscriber = vi.fn();
      selectionController.canonical.subscribe(canonicalSubscriber);
      const hook = renderHook(() =>
        useNativeSelectionSynchronization({
          listElement: fixture.list,
          editor: fixture.editor,
          contentRuntime: fixture.contentRuntime,
          selectionController,
          presentation: selectionController.getPresentationSnapshot(),
          textAnchorResolver: passthroughTextAnchorResolver,
        }),
      );

      installNativeSelection(fixture.text, anchor, focus);
      document.dispatchEvent(new Event("selectionchange"));

      const canonical = selectionController.getCanonicalSnapshot();
      expect(canonical.kind).toBe("document");
      if (canonical.kind !== "document") {
        throw new Error("Expected a canonical document selection");
      }
      expect(canonical.snapshot.documentSelection).toMatchObject({
        direction,
        anchor: { blockId: "cell", textOffset: anchor },
        focus: { blockId: "cell", textOffset: focus },
      });
      expect(canonicalSubscriber).toHaveBeenCalledOnce();
      expect(fixture.editor.requestTextPresentation).not.toHaveBeenCalled();

      hook.unmount();
      document.getSelection()?.removeAllRanges();
      fixture.list.remove();
    },
  );

  it("does not project native selection while canonical global paint owns selection", () => {
    const list = document.createElement("div");
    const text = document.createTextNode("first");
    list.append(text);
    document.body.append(list);
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(text);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const selectionController = createSelectionController();
    const initialRevision = selectionController.getCanonicalSnapshot().revision;
    const hook = renderHook(() =>
      useNativeSelectionSynchronization({
        listElement: list,
        editor: {} as EditorRuntimePort,
        contentRuntime: {} as EditorWebContentRuntime,
        selectionController,
        presentation: presentation(null),
        textAnchorResolver: passthroughTextAnchorResolver,
      }),
    );

    document.dispatchEvent(new Event("selectionchange"));

    expect(selectionController.getCanonicalSnapshot().revision).toBe(
      initialRevision,
    );
    hook.unmount();
    list.remove();
  });

  it("does not restore an editor selection after an outside pointer takes ownership", () => {
    const list = document.createElement("div");
    const text = document.createTextNode("first");
    const outside = document.createElement("button");
    list.append(text);
    document.body.append(list, outside);
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(text);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const selectionController = createSelectionController();
    const initialRevision = selectionController.getCanonicalSnapshot().revision;
    const hook = renderHook(() =>
      useNativeSelectionSynchronization({
        listElement: list,
        editor: {} as EditorRuntimePort,
        contentRuntime: {} as EditorWebContentRuntime,
        selectionController,
        presentation: presentation(null),
        textAnchorResolver: passthroughTextAnchorResolver,
      }),
    );

    outside.dispatchEvent(
      new Event("pointerdown", { bubbles: true, cancelable: true }),
    );
    document.dispatchEvent(new Event("selectionchange"));

    expect(selectionController.getCanonicalSnapshot().revision).toBe(
      initialRevision,
    );
    hook.unmount();
    list.remove();
    outside.remove();
  });
});

const passthroughTextAnchorResolver: EditorSelectionTextAnchorResolver = {
  resolveTextAnchor: (point) =>
    point.textAnchor
      ? {
          ok: true,
          blockId: point.blockId,
          textAnchor: point.textAnchor,
          textOffset: point.textOffset,
          affinity: point.affinity,
        }
      : { ok: false, reason: "invalid", blockId: point.blockId },
};

function presentation(composition: null): SelectionPresentationSnapshot {
  return {
    ...createSelectionController().getPresentationSnapshot(),
    composition,
    nativeSelectionPaintMode: "hidden-for-global-selection",
  };
}

const selectionGraph: EditorSelectionGraphReader = {
  getBlock: (blockId) =>
    blockId === ("source" as BlockId)
      ? { id: blockId, type: "textbox", tombstone: false }
      : null,
  readBlockSelectionModel: () => contentSelection(),
  getRootBlockIds: () => ["source" as BlockId],
  getParentId: () => null,
  getChildBlockIds: () => [],
};

function testSelectionPoint(): EditorLogicalSelectionPoint {
  const anchor = createEditorSelectionTextAnchor({
    codec: "test",
    payload: { encoded: btoa("0"), assoc: 0 },
  });
  if (!anchor.ok) throw new Error(anchor.message);
  const point = createEditorLogicalSelectionPoint({
    graph: selectionGraph,
    blockId: "source" as BlockId,
    textOffset: 0,
    textAnchor: anchor.textAnchor,
    affinity: "forward",
  });
  if (!point) throw new Error("Expected a test selection point");
  return point;
}

function createInternalHostTextFixture(
  selectionController: ReturnType<typeof createSelectionController>,
) {
  const list = document.createElement("div");
  const object = document.createElement("div");
  object.dataset.editorObjectRoot = "true";
  const host = document.createElement("div");
  host.dataset.editorBlockInternalSelectionHost = "true";
  const shell = document.createElement("div");
  shell.dataset.editorBlockShell = "true";
  shell.dataset.editorBlockId = "cell";
  const textRoot = document.createElement("div");
  textRoot.dataset.editorTextRoot = "true";
  textRoot.setAttribute("contenteditable", "true");
  const text = document.createTextNode("hello world");
  textRoot.append(text);
  shell.append(textRoot);
  host.append(shell);
  object.append(host);
  list.append(object);
  document.body.append(list);
  const editor = {
    editable: true,
    getSelectionGraphRevision: () => 1,
    getBlock: (blockId: string) =>
      blockId === "cell"
        ? { id: "cell", type: "tableCell", tombstone: false }
        : null,
    readBlockSelectionModel: () => contentSelection(),
    getRootBlockIds: () => ["cell" as BlockId],
    getParentId: () => null,
    getChildBlockIds: () => [],
    requestTextPresentation: vi.fn(),
    ownsActiveTextTarget: () => true,
    selectionController,
  } as unknown as EditorRuntimePort & {
    readonly requestTextPresentation: ReturnType<typeof vi.fn>;
  };
  const contentRuntime = {
    acquireBlockContent: (
      blockId: BlockId,
      blockType: "tableCell",
      reason: "canonical-transaction",
    ) => ({
      blockId,
      blockType,
      reason,
      context: { blockId },
      release: vi.fn(),
    }),
    createTextAnchorInContext: (
      _lease: unknown,
      input: { readonly textOffset: number },
    ) => ({
      ok: true,
      codec: "test",
      payload: { encoded: btoa(String(input.textOffset)), assoc: 0 },
      textOffset: input.textOffset,
    }),
  } as unknown as EditorWebContentRuntime;
  return { list, text, editor, contentRuntime };
}

function installNativeSelection(
  text: Text,
  anchor: number,
  focus: number,
): void {
  const selection = document.getSelection();
  selection?.removeAllRanges();
  if (!selection) return;
  if (typeof selection.setBaseAndExtent === "function") {
    selection.setBaseAndExtent(text, anchor, text, focus);
    return;
  }
  const range = document.createRange();
  range.setStart(text, Math.min(anchor, focus));
  range.setEnd(text, Math.max(anchor, focus));
  selection.addRange(range);
  if (anchor > focus) selection.extend(text, focus);
}
