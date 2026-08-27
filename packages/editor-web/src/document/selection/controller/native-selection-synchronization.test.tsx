import { act, renderHook } from "@testing-library/react";
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
import type { EditableEditorRuntimePort } from "../../../runtime/document/render-port.ts";
import { useNativeSelectionSynchronization } from "./native-selection-synchronization.ts";

describe("native selection synchronization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reflects pointer presentation synchronously without deleting the native input caret", () => {
    const removeAllRanges = vi.fn();
    vi.spyOn(document, "getSelection").mockReturnValue({
      removeAllRanges,
    } as unknown as Selection);
    const list = document.createElement("div");
    document.body.append(list);
    const selectionController = createSelectionController();
    const hook = renderHook(() =>
      useNativeSelectionSynchronization({
        listElement: list,
        editor: {} as EditableEditorRuntimePort,
        contentRuntime: {} as EditorWebContentRuntime,
        selectionController,
        presentation: selectionController.getPresentationSnapshot(),
        textAnchorResolver: passthroughTextAnchorResolver,
      }),
    );

    expect(list.dataset.editorNativeSelectionPaintMode).toBe("visible");
    expect(removeAllRanges).not.toHaveBeenCalled();

    let claim!: ReturnType<
      typeof selectionController.claimTextPointerGesturePresentation
    >;
    act(() => {
      claim = selectionController.claimTextPointerGesturePresentation();
      expect(list.dataset.editorNativeSelectionPaintMode).toBe(
        "hidden-for-global-selection",
      );
    });
    expect(removeAllRanges).not.toHaveBeenCalled();

    act(() => {
      claim.release();
      expect(list.dataset.editorNativeSelectionPaintMode).toBe("visible");
    });

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
        editor: {} as EditableEditorRuntimePort,
        contentRuntime: {} as EditorWebContentRuntime,
        selectionController,
        presentation: selectionController.getPresentationSnapshot(),
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
    textRoot.tabIndex = -1;
    textRoot.append(document.createTextNode("hello"));
    shell.append(textRoot);
    const objectUi = document.createElement("form");
    objectUi.dataset.editorUi = "true";
    const input = document.createElement("input");
    input.value = "https://editor-example.test/path";
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
          resolveNativeFocusTarget: resolvedTestNativeFocus,
          nativeSelectionSynchronization: { reconcileTextSelection },
        } as unknown as EditableEditorRuntimePort,
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
        editor: {} as EditableEditorRuntimePort,
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
          resolveNativeFocusTarget: resolvedTestNativeFocus,
        } as unknown as EditableEditorRuntimePort,
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
    textRoot.focus();

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
    textRoot.tabIndex = -1;
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
    textRoot.focus();
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
      resolveNativeFocusTarget: resolvedTestNativeFocus,
    } as unknown as EditableEditorRuntimePort;
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
    {
      label: "forward",
      anchorBlockId: "first",
      anchorOffset: 1,
      focusBlockId: "second",
      focusOffset: 4,
      direction: "forward",
    },
    {
      label: "backward",
      anchorBlockId: "second",
      anchorOffset: 4,
      focusBlockId: "first",
      focusOffset: 1,
      direction: "backward",
    },
  ] as const)(
    "preserves a $label cross-block range across repeated projected-caret selectionchange events",
    ({
      anchorBlockId,
      anchorOffset,
      focusBlockId,
      focusOffset,
      direction,
    }) => {
      const selectionController = createSelectionController();
      const fixture = createCrossBlockTextFixture(selectionController);
      const anchor = fixture.createPoint(anchorBlockId, anchorOffset);
      const focus = fixture.createPoint(focusBlockId, focusOffset);
      expect(
        selectionController.commitCanonicalSelection(
          { direction, anchor, focus },
          fixture.editor,
          1,
          {
            publication: { kind: "standalone-local" },
            cause: "pointer",
          },
          passthroughTextAnchorResolver,
        ),
      ).toMatchObject({ kind: "changed" });
      const authoritative = selectionController.getCanonicalSnapshot();
      const settlement = selectionController.getPresentationSnapshot().settlement;
      const canonicalSubscriber = vi.fn();
      const standaloneSubscriber = vi.fn();
      selectionController.canonical.subscribe(canonicalSubscriber);
      selectionController.subscribeStandaloneSettlements(standaloneSubscriber);
      fixture.expectedProjection = {
        blockId: focusBlockId,
        root: fixture.roots[focusBlockId],
        textOffset: focusOffset,
        node: fixture.texts[focusBlockId],
        nodeOffset: focusOffset,
      };
      installNativeSelection(
        fixture.texts[focusBlockId],
        focusOffset,
        focusOffset,
      );
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

      for (let eventIndex = 0; eventIndex < 2; eventIndex += 1) {
        document.dispatchEvent(new Event("selectionchange"));
        expect(selectionController.getCanonicalSnapshot()).toBe(authoritative);
        expect(selectionController.getCanonicalSnapshot().revision).toBe(
          authoritative.revision,
        );
        expect(authoritative).toMatchObject({
          kind: "document",
          snapshot: {
            documentSelection: {
              direction,
              anchor: { blockId: anchorBlockId, textOffset: anchorOffset },
              focus: { blockId: focusBlockId, textOffset: focusOffset },
            },
          },
        });
        expect(selectionController.localPaint.getSnapshot()).toMatchObject({
          kind: "range",
          sourceRevision: authoritative.revision,
        });
        expect(selectionController.getPresentationSnapshot().settlement).toBe(
          settlement,
        );
        expect(canonicalSubscriber).not.toHaveBeenCalled();
        expect(standaloneSubscriber).not.toHaveBeenCalled();
        expect(fixture.createTextAnchor).not.toHaveBeenCalled();
      }
      expect(fixture.acknowledgeTextActivation).toHaveBeenCalledTimes(2);
      expect(fixture.acknowledgeTextActivation).toHaveBeenLastCalledWith(
        focusBlockId,
        fixture.roots[focusBlockId],
        focusOffset,
        fixture.texts[focusBlockId],
        focusOffset,
      );

      hook.unmount();
      document.getSelection()?.removeAllRanges();
      fixture.list.remove();
    },
  );

  it("preserves an ordinary same-block native range", () => {
    const selectionController = createSelectionController();
    const fixture = createCrossBlockTextFixture(selectionController);
    const anchor = fixture.createPoint("first", 1);
    const focus = fixture.createPoint("first", 4);
    expect(
      selectionController.commitCanonicalSelection(
        { direction: "forward", anchor, focus },
        fixture.editor,
        1,
        {
          publication: { kind: "standalone-local" },
          cause: "pointer",
        },
        passthroughTextAnchorResolver,
      ),
    ).toMatchObject({ kind: "changed" });
    const authoritative = selectionController.getCanonicalSnapshot();
    const canonicalSubscriber = vi.fn();
    selectionController.canonical.subscribe(canonicalSubscriber);
    fixture.expectedProjection = {
      blockId: "first",
      root: fixture.roots.first,
      textOffset: 4,
      node: fixture.texts.first,
      nodeOffset: 4,
    };
    installNativeSelection(fixture.texts.first, 1, 4);
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

    document.dispatchEvent(new Event("selectionchange"));

    expect(selectionController.getCanonicalSnapshot()).toBe(authoritative);
    expect(selectionController.localPaint.getSnapshot()).toMatchObject({
      kind: "range",
      sourceRevision: authoritative.revision,
    });
    expect(canonicalSubscriber).not.toHaveBeenCalled();
    expect(fixture.createTextAnchor).not.toHaveBeenCalled();

    hook.unmount();
    document.getSelection()?.removeAllRanges();
    fixture.list.remove();
  });

  it("does not suppress a genuine native caret change beside a projected cross-block focus", () => {
    const selectionController = createSelectionController();
    const fixture = createCrossBlockTextFixture(selectionController);
    const anchor = fixture.createPoint("first", 1);
    const focus = fixture.createPoint("second", 4);
    expect(
      selectionController.commitCanonicalSelection(
        { direction: "forward", anchor, focus },
        fixture.editor,
        1,
        {
          publication: { kind: "standalone-local" },
          cause: "pointer",
        },
        passthroughTextAnchorResolver,
      ),
    ).toMatchObject({ kind: "changed" });
    const authoritativeRevision =
      selectionController.getCanonicalSnapshot().revision;
    const canonicalSubscriber = vi.fn();
    const standaloneSubscriber = vi.fn();
    selectionController.canonical.subscribe(canonicalSubscriber);
    selectionController.subscribeStandaloneSettlements(standaloneSubscriber);
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

    installNativeSelection(fixture.texts.second, 2, 2);
    document.dispatchEvent(new Event("selectionchange"));

    expect(fixture.acknowledgeTextActivation).not.toHaveBeenCalled();
    expect(fixture.createTextAnchor).toHaveBeenCalledOnce();
    expect(selectionController.getCanonicalSnapshot()).toMatchObject({
      kind: "document",
      revision: authoritativeRevision + 1,
      snapshot: {
        documentSelection: {
          anchor: { blockId: "second", textOffset: 2 },
          focus: { blockId: "second", textOffset: 2 },
        },
      },
    });
    expect(selectionController.localPaint.getSnapshot()).toEqual({
      kind: "none",
    });
    expect(canonicalSubscriber).toHaveBeenCalledOnce();
    expect(standaloneSubscriber).toHaveBeenCalledOnce();

    hook.unmount();
    document.getSelection()?.removeAllRanges();
    fixture.list.remove();
  });

  it.each([
    "stale canonical revision",
    "stale activation identity",
    "replaced host or projection identity",
    "unexpected native node identity",
  ])(
    "does not accept the focus caret when activation verification reports %s",
    () => {
      const selectionController = createSelectionController();
      const fixture = createCrossBlockTextFixture(selectionController);
      const anchor = fixture.createPoint("first", 1);
      const focus = fixture.createPoint("second", 4);
      expect(
        selectionController.commitCanonicalSelection(
          { direction: "forward", anchor, focus },
          fixture.editor,
          1,
          {
            publication: { kind: "standalone-local" },
            cause: "pointer",
          },
          passthroughTextAnchorResolver,
        ),
      ).toMatchObject({ kind: "changed" });
      const authoritativeRevision =
        selectionController.getCanonicalSnapshot().revision;
      const standaloneSubscriber = vi.fn();
      selectionController.subscribeStandaloneSettlements(standaloneSubscriber);
      installNativeSelection(fixture.texts.second, 4, 4);
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

      document.dispatchEvent(new Event("selectionchange"));

      expect(fixture.acknowledgeTextActivation).toHaveBeenCalledOnce();
      expect(fixture.acknowledgeTextActivation).toHaveReturnedWith(false);
      expect(selectionController.getCanonicalSnapshot()).toMatchObject({
        kind: "document",
        revision: authoritativeRevision + 1,
        snapshot: {
          documentSelection: {
            anchor: { blockId: "second", textOffset: 4 },
            focus: { blockId: "second", textOffset: 4 },
          },
        },
      });
      expect(standaloneSubscriber).toHaveBeenCalledOnce();

      hook.unmount();
      document.getSelection()?.removeAllRanges();
      fixture.list.remove();
    },
  );

  it("mirrors a collapsed caret inside nested editable text", () => {
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

    installNativeSelection(fixture.text, 3, 3);
    document.dispatchEvent(new Event("selectionchange"));

    const canonical = selectionController.getCanonicalSnapshot();
    expect(canonical.kind).toBe("document");
    if (canonical.kind !== "document") {
      throw new Error("Expected a canonical document selection");
    }
    expect(canonical.snapshot.documentSelection).toMatchObject({
      direction: "forward",
      anchor: { blockId: "cell", textOffset: 3 },
      focus: { blockId: "cell", textOffset: 3 },
    });
    expect(canonicalSubscriber).toHaveBeenCalledOnce();
    expect(fixture.editor.requestTextPresentation).not.toHaveBeenCalled();

    hook.unmount();
    document.getSelection()?.removeAllRanges();
    fixture.list.remove();
  });

  it.each([
    { label: "forward", anchor: 1, focus: 7 },
    { label: "backward", anchor: 7, focus: 1 },
  ] as const)(
    "rejects an unprojected native $label range inside an internal host",
    ({ anchor, focus }) => {
      const selectionController = createSelectionController();
      const fixture = createInternalHostTextFixture(selectionController);
      const canonicalSubscriber = vi.fn();
      selectionController.canonical.subscribe(canonicalSubscriber);
      const revision = selectionController.getCanonicalSnapshot().revision;
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

      expect(selectionController.getCanonicalSnapshot()).toEqual({
        kind: "none",
        revision,
      });
      expect(canonicalSubscriber).not.toHaveBeenCalled();
      expect(document.getSelection()?.isCollapsed).toBe(true);
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
        editor: {} as EditableEditorRuntimePort,
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

  it("does not recreate canonical selection while pointer clear owns the native boundary", () => {
    const selectionController = createSelectionController();
    const fixture = createInternalHostTextFixture(selectionController);
    installNativeSelection(fixture.text, 1, 4);
    fixture.list.dataset.editorCanonicalSelectionClearPending = "true";
    const hook = renderHook(() =>
      useNativeSelectionSynchronization({
        listElement: fixture.list,
        editor: fixture.editor,
        contentRuntime: fixture.contentRuntime,
        selectionController,
        presentation: presentation(null),
        textAnchorResolver: passthroughTextAnchorResolver,
      }),
    );

    document.dispatchEvent(new Event("selectionchange"));

    expect(selectionController.getCanonicalSnapshot()).toMatchObject({
      kind: "none",
    });
    hook.unmount();
    delete fixture.list.dataset.editorCanonicalSelectionClearPending;
    document.getSelection()?.removeAllRanges();
    fixture.list.remove();
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
      ? {
          id: blockId,
          type: "textbox",
          parentId: null,
          tombstone: null,
          metadataVersion: "1",
          contentVersion: null,
        }
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
        ? { id: "cell", type: "cellWrapper", tombstone: false }
        : null,
    readBlockSelectionModel: () => contentSelection(),
    getRootBlockIds: () => ["cell" as BlockId],
    getParentId: () => null,
    getChildBlockIds: () => [],
    requestTextPresentation: vi.fn(),
    resolveNativeFocusTarget: resolvedTestNativeFocus,
    selectionController,
  } as unknown as EditableEditorRuntimePort & {
    readonly requestTextPresentation: ReturnType<typeof vi.fn>;
  };
  const contentRuntime = {
    acquireBlockContent: (
      blockId: BlockId,
      blockType: "cellWrapper",
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

function createCrossBlockTextFixture(
  selectionController: ReturnType<typeof createSelectionController>,
) {
  const list = document.createElement("div");
  const roots = {} as Record<"first" | "second", HTMLElement>;
  const texts = {} as Record<"first" | "second", Text>;
  for (const blockId of ["first", "second"] as const) {
    const shell = document.createElement("div");
    shell.dataset.editorBlockShell = "true";
    shell.dataset.editorBlockId = blockId;
    const textRoot = document.createElement("div");
    textRoot.dataset.editorTextRoot = "true";
    textRoot.setAttribute("contenteditable", "true");
    const text = document.createTextNode(`${blockId} text`);
    textRoot.append(text);
    shell.append(textRoot);
    list.append(shell);
    roots[blockId] = textRoot;
    texts[blockId] = text;
  }
  document.body.append(list);
  type ExpectedProjection = {
    readonly blockId: "first" | "second";
    readonly root: HTMLElement;
    readonly textOffset: number;
    readonly node: Node;
    readonly nodeOffset: number;
  };
  const fixtureState: { expectedProjection: ExpectedProjection | null } = {
    expectedProjection: null,
  };
  const acknowledgeTextActivation = vi.fn(
    (
      blockId: string,
      root: HTMLElement,
      textOffset: number,
      node: Node,
      nodeOffset: number,
    ) => {
      const expected = fixtureState.expectedProjection;
      return Boolean(
        expected &&
        expected.blockId === blockId &&
        expected.root === root &&
        expected.textOffset === textOffset &&
        expected.node === node &&
        expected.nodeOffset === nodeOffset,
      );
    },
  );
  const editor = {
    editable: true,
    selectionController,
    getSelectionGraphRevision: () => 1,
    getBlock: (blockId: string) =>
      blockId === "first" || blockId === "second"
        ? {
            id: blockId,
            type: "textBlock",
            parentId: null,
            tombstone: null,
            metadataVersion: "1",
            contentVersion: "1",
          }
        : null,
    readBlockSelectionModel: () => contentSelection(),
    getRootBlockIds: () => ["first" as BlockId, "second" as BlockId],
    getParentId: () => null,
    getChildBlockIds: () => [],
    acknowledgeTextActivation,
    resolveNativeFocusTarget: resolvedTestNativeFocus,
    nativeSelectionSynchronization: {
      reconcileTextSelection: vi.fn(),
    },
  } as unknown as EditableEditorRuntimePort;
  const createTextAnchor = vi.fn(
    (_lease: unknown, input: { readonly textOffset: number }) => ({
      ok: true,
      codec: "test",
      payload: { encoded: btoa(String(input.textOffset)), assoc: 0 },
      textOffset: input.textOffset,
    }),
  );
  const contentRuntime = {
    acquireBlockContent: (
      blockId: BlockId,
      blockType: string,
      reason: "canonical-transaction",
    ) => ({
      blockId,
      blockType,
      reason,
      context: { blockId },
      release: vi.fn(),
    }),
    createTextAnchorInContext: createTextAnchor,
  } as unknown as EditorWebContentRuntime;
  const createPoint = (
    blockId: "first" | "second",
    textOffset: number,
  ) => {
    const anchor = createEditorSelectionTextAnchor({
      codec: "test",
      payload: { encoded: btoa(`${blockId}:${textOffset}`), assoc: 0 },
    });
    if (!anchor.ok) throw new Error(anchor.message);
    const point = createEditorLogicalSelectionPoint({
      graph: editor,
      blockId: blockId as BlockId,
      textOffset,
      textAnchor: anchor.textAnchor,
      affinity: "forward",
    });
    if (!point) throw new Error(`Expected a selection point for ${blockId}`);
    return point;
  };
  return {
    list,
    roots,
    texts,
    editor,
    contentRuntime,
    createTextAnchor,
    acknowledgeTextActivation,
    createPoint,
    get expectedProjection() {
      return fixtureState.expectedProjection;
    },
    set expectedProjection(value: ExpectedProjection | null) {
      fixtureState.expectedProjection = value;
    },
  };
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

function resolvedTestNativeFocus(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return null;
  const textRoot = target.closest<HTMLElement>(
    "[data-editor-text-root='true']",
  );
  const blockId = textRoot?.closest<HTMLElement>("[data-editor-block-id]")
    ?.dataset.editorBlockId;
  return textRoot && blockId
    ? {
        kind: "text" as const,
        blockId: blockId as BlockId,
        registeredTarget: textRoot,
      }
    : null;
}
