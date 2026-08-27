import { act, renderHook } from "@testing-library/react";
import { asContentVersion, type BlockId } from "@repo/editor-core/kernel";
import { contentSelection } from "@repo/editor-core/selection";
import {
  createEditorLogicalSelectionPoint,
  createEditorSelectionTextAnchor,
  createSelectionController,
  readEditorBlockSelectionTarget,
  type EditorSelectionGraphReader,
  type EditorSelectionTextAnchorResolver,
  type SelectionController,
} from "@repo/editor-react/selection";
import { describe, expect, it, vi } from "vitest";
import type { EditorWebContentRuntime } from "../../../runtime/content/content-runtime.ts";
import type { EditableEditorRuntimePort } from "../../../runtime/document/render-port.ts";
import type { EditorBlockDomRegistryReader } from "../../blocks/block-dom-registry.ts";
import * as pointerHitTesting from "../hit-testing/dom-selection-hit-testing.ts";
import { useGlobalSelectionGestures } from "./global-selection-gestures.ts";
import { useNativeSelectionSynchronization } from "./native-selection-synchronization.ts";
import { createEditorTextGestureArbitration } from "./text-gesture-arbitration.tsx";

describe("global selection gesture ownership", () => {
  it("settles Control+A once at the canonical rich-content end across blocks", () => {
    const firstId = "first" as BlockId;
    const secondId = "second" as BlockId;
    const contents = new Map([
      [
        firstId,
        {
          type: "doc" as const,
          content: [
            {
              type: "textBlock" as const,
              content: [{ type: "text", text: "ASCII" }],
            },
          ],
        },
      ],
      [
        secondId,
        {
          type: "doc" as const,
          content: [
            {
              type: "textBlock" as const,
              content: [
                { type: "hard_break" as const },
                {
                  type: "text",
                  text: "\ud83d\ude42e\u0301\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d\udc66",
                },
                {
                  type: "mention",
                  metadata: { label: "rendered label longer than one unit" },
                },
                { type: "hard_break" as const },
              ],
            },
          ],
        },
      ],
    ]);
    const graph: EditorSelectionGraphReader = {
      getBlock: (blockId) =>
        contents.has(blockId)
          ? {
              id: blockId,
              type: "textBlock",
              parentId: null,
              tombstone: null,
              metadataVersion: "1",
              contentVersion: asContentVersion("1"),
            }
          : null,
      getParentId: () => null,
      getRootBlockIds: () => [firstId, secondId],
      getChildBlockIds: () => [],
      readBlockSelectionModel: () => contentSelection(),
    };
    const list = document.createElement("div");
    list.className = "editor-web-block-list";
    list.dataset.editorBlockListRoot = "true";
    list.tabIndex = 0;
    document.body.append(list);
    const requestPresentation = vi.fn();
    const editor = {
      ...documentInputRuntimeStub(),
      ...graph,
      editable: true,
      definition: { blocks: { textBlock: { kind: "text" } } },
      getSelectionGraphRevision: () => 9,
      requestTextPresentation: requestPresentation,
      blurEditor: vi.fn(),
    } as unknown as EditableEditorRuntimePort;
    const contentRuntime = {
      readBlockProjection: (blockId: BlockId) => contents.get(blockId) ?? null,
      acquireBlockContent: (
        blockId: BlockId,
        blockType: "textBlock",
        reason: "canonical-transaction",
      ) => ({
        blockId,
        blockType,
        reason,
        release: vi.fn(),
      }),
      createTextAnchorInContext: (
        _lease: unknown,
        input: { readonly textOffset: number },
      ) => ({
        ok: true,
        codec: "select-all-test",
        payload: { encoded: btoa(String(input.textOffset)), assoc: 0 },
        textOffset: input.textOffset,
      }),
    } as unknown as EditorWebContentRuntime;
    const controller = createSelectionController();
    Object.assign(editor, { selectionController: controller });
    const publications = vi.fn();
    controller.subscribeStandaloneSettlements(publications);
    const beforeContents = structuredClone([...contents.entries()]);
    const documentRevision = 7;
    const semanticTransactions: unknown[] = [];
    const hook = renderHook(() =>
      useGlobalSelectionGestures({
        listElement: list,
        blockDom: {} as EditorBlockDomRegistryReader,
        editor,
        contentRuntime,
        selectionController: controller,
        captureStructuralSelection: vi.fn(() => null),
        documentLayerKeyboard: unhandledDocumentLayerKeyboard,
        textGestureArbitration: createEditorTextGestureArbitration(),
        onTransientPointerPaintChange: vi.fn(),
      }),
    );
    const nativeRange = document.createRange();
    nativeRange.selectNodeContents(list);
    nativeRange.collapse(false);
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(nativeRange);
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "a",
      ctrlKey: true,
    });

    act(() => list.dispatchEvent(event));

    const committed = controller.getCommittedSnapshot();
    expect(committed).not.toBeNull();
    expect(committed).toMatchObject({
      direction: "forward",
      endpoints: {
        anchor: { blockId: firstId, textOffset: 0 },
        head: { blockId: secondId, textOffset: 13 },
      },
    });
    expect(publications).toHaveBeenCalledOnce();
    expect(controller.getPresentationSnapshot().settlement).toMatchObject({
      publication: { kind: "standalone-local" },
      cause: "keyboard",
    });
    expect(requestPresentation).toHaveBeenCalledOnce();
    expect(requestPresentation).toHaveBeenCalledWith(secondId, {
      offset: 13,
      canonicalSelectionRevision: 1,
      preventScroll: true,
    });
    expect(document.getSelection()?.isCollapsed).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(structuredClone([...contents.entries()])).toEqual(beforeContents);
    expect(documentRevision).toBe(7);
    expect(semanticTransactions).toEqual([]);

    hook.unmount();
    controller.dispose();
    list.remove();
  });

  it("claims an accepted text pointer without settling and settles it once on pointerup", () => {
    const fixture = pointerGestureFixture();
    const publications = vi.fn();
    fixture.options.selectionController.subscribeStandaloneSettlements(
      publications,
    );
    const endpointBeforePointerDown =
      fixture.options.selectionController.endpoint.getSnapshot();
    const paintBeforePointerDown =
      fixture.options.selectionController.localPaint.getSnapshot();
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));

    const down = pointerEvent("pointerdown", {
      pointerId: 9,
      clientX: 10,
      clientY: 10,
    });
    act(() => fixture.text.dispatchEvent(down));

    expect(down.defaultPrevented).toBe(true);
    expect(fixture.setPointerCapture).not.toHaveBeenCalled();
    expect(
      fixture.options.selectionController.getPresentationSnapshot()
        .nativeSelectionPaintMode,
    ).toBe("hidden-for-global-selection");
    expect(fixture.extendSelection).not.toHaveBeenCalled();
    expect(fixture.commitSelectionPoint).not.toHaveBeenCalled();
    expect(fixture.options.selectionController.getCanonicalSnapshot()).toEqual({
      kind: "none",
      revision: 0,
    });
    expect(fixture.options.selectionController.endpoint.getSnapshot()).toBe(
      endpointBeforePointerDown,
    );
    expect(fixture.options.selectionController.localPaint.getSnapshot()).toBe(
      paintBeforePointerDown,
    );
    expect(fixture.transientPaintChanged).not.toHaveBeenCalled();
    expect(publications).not.toHaveBeenCalled();
    expect(fixture.requestPresentation).not.toHaveBeenCalled();
    expect(fixture.nativeFocus).not.toHaveBeenCalled();
    expect(fixture.acquireBlockContent).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(fixture.text);

    const mouseDown = new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    act(() => fixture.text.dispatchEvent(mouseDown));
    expect(mouseDown.defaultPrevented).toBe(true);

    const up = pointerEvent("pointerup", {
      pointerId: 9,
      clientX: 10,
      clientY: 10,
    });
    act(() => document.dispatchEvent(up));

    expect(fixture.extendSelection).toHaveBeenCalledOnce();
    expect(fixture.commitSelectionPoint).not.toHaveBeenCalled();
    expect(fixture.requestPresentation).toHaveBeenCalledOnce();
    expect(publications).toHaveBeenCalledOnce();
    expect(fixture.acquireBlockContent).toHaveBeenCalledOnce();
    expect(fixture.createTextAnchorInContext).toHaveBeenCalledOnce();
    expect(fixture.releaseSettlementLease).toHaveBeenCalledOnce();
    expect(
      fixture.requestPresentation.mock.invocationCallOrder[0],
    ).toBeLessThan(fixture.releaseSettlementLease.mock.invocationCallOrder[0]!);
    expect(fixture.releasePointerCapture).not.toHaveBeenCalled();
    expect(
      fixture.options.selectionController.getPresentationSnapshot()
        .nativeSelectionPaintMode,
    ).toBe("visible");

    const click = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      clientX: 10,
      clientY: 10,
    });
    act(() => fixture.text.dispatchEvent(click));

    expect(fixture.requestPresentation).toHaveBeenCalledOnce();
    expect(fixture.requestPresentation).toHaveBeenCalledWith("text", {
      offset: 0,
      canonicalSelectionRevision: 1,
      preventScroll: true,
    });
    hook.unmount();
    fixture.dispose();
  });

  it("replaces an existing canonical selection without an intermediate none publication", () => {
    const fixture = pointerGestureFixture();
    const priorAnchor = createEditorSelectionTextAnchor({
      codec: "pointer-test",
      payload: { encoded: "MQ==", assoc: 0 },
    });
    if (!priorAnchor.ok) throw new Error(priorAnchor.message);
    const prior = createEditorLogicalSelectionPoint({
      graph: fixture.options.editor,
      blockId: "text" as BlockId,
      textOffset: 1,
      textAnchor: priorAnchor.textAnchor,
    });
    if (!prior) throw new Error("Prior pointer point is invalid");
    fixture.options.selectionController.commitSelectionPoint(
      prior,
      fixture.options.editor,
      1,
      { publication: { kind: "silent" }, cause: "focus" },
    );
    const publications = vi.fn();
    fixture.options.selectionController.subscribeStandaloneSettlements(
      publications,
    );
    const clearSelection = vi.spyOn(
      fixture.options.selectionController,
      "clearSelection",
    );
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));

    act(() => {
      fixture.text.dispatchEvent(
        pointerEvent("pointerdown", {
          pointerId: 10,
          clientX: 10,
          clientY: 10,
        }),
      );
      document.dispatchEvent(
        pointerEvent("pointerup", {
          pointerId: 10,
          clientX: 10,
          clientY: 10,
        }),
      );
    });

    expect(clearSelection).not.toHaveBeenCalled();
    expect(publications).toHaveBeenCalledOnce();
    expect(
      fixture.options.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({
      kind: "document",
      snapshot: {
        documentSelection: { focus: { blockId: "text", textOffset: 0 } },
      },
    });
    hook.unmount();
    fixture.dispose();
  });

  it("retargets a pending click from the final pointerup hit before its only settlement", () => {
    const fixture = pointerGestureFixture();
    const finalPoint = {
      ...fixture.point,
      textOffset: 1,
    };
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));

    act(() =>
      fixture.text.dispatchEvent(
        pointerEvent("pointerdown", {
          pointerId: 91,
          clientX: 10,
          clientY: 10,
        }),
      ),
    );
    fixture.resolvePointerHit.mockReturnValueOnce({
      shell: fixture.shell,
      target: fixture.target,
      textOffset: finalPoint.textOffset,
      affinity: finalPoint.affinity,
    });
    act(() =>
      document.dispatchEvent(
        pointerEvent("pointerup", {
          pointerId: 91,
          clientX: 15,
          clientY: 10,
        }),
      ),
    );

    expect(fixture.extendSelection).toHaveBeenCalledWith(
      expect.objectContaining({ textOffset: 1 }),
      expect.objectContaining({ textOffset: 1 }),
      expect.anything(),
      1,
      expect.objectContaining({ cause: "pointer" }),
    );
    expect(fixture.requestPresentation).toHaveBeenCalledOnce();
    expect(fixture.requestPresentation).toHaveBeenCalledWith("text", {
      offset: 1,
      canonicalSelectionRevision: 1,
      preventScroll: true,
    });
    hook.unmount();
    fixture.dispose();
  });

  it("commits and presents pointer affinity once for completed clicks and drag endpoints", () => {
    const clickFixture = pointerGestureFixture("backward");
    const clickPublications = vi.fn();
    clickFixture.options.selectionController.subscribeStandaloneSettlements(
      clickPublications,
    );
    const clickHook = renderHook(() =>
      useGlobalSelectionGestures(clickFixture.options),
    );
    act(() => {
      clickFixture.text.dispatchEvent(
        pointerEvent("pointerdown", {
          pointerId: 80,
          clientX: 10,
          clientY: 10,
        }),
      );
      document.dispatchEvent(
        pointerEvent("pointerup", {
          pointerId: 80,
          clientX: 10,
          clientY: 10,
        }),
      );
    });

    expect(
      clickFixture.options.selectionController.getCommittedSnapshot()?.endpoints
        .head?.affinity,
    ).toBe("backward");
    expect(clickPublications).toHaveBeenCalledOnce();
    expect(clickFixture.requestPresentation).toHaveBeenCalledOnce();
    expect(clickFixture.requestPresentation).toHaveBeenCalledWith("text", {
      offset: 0,
      canonicalSelectionRevision: 1,
      affinity: "backward",
      preventScroll: true,
    });
    clickHook.unmount();
    clickFixture.dispose();

    const dragFixture = pointerGestureFixture("forward");
    const dragPublications = vi.fn();
    dragFixture.options.selectionController.subscribeStandaloneSettlements(
      dragPublications,
    );
    const dragHook = renderHook(() =>
      useGlobalSelectionGestures(dragFixture.options),
    );
    beginFixtureDrag(dragFixture, 90);
    act(() =>
      document.dispatchEvent(
        pointerEvent("pointerup", {
          pointerId: 90,
          clientX: 20,
          clientY: 10,
        }),
      ),
    );

    expect(
      dragFixture.options.selectionController.getCommittedSnapshot()?.endpoints
        .head?.affinity,
    ).toBe("forward");
    expect(dragPublications).toHaveBeenCalledOnce();
    expect(dragFixture.requestPresentation).toHaveBeenCalledOnce();
    expect(dragFixture.requestPresentation).toHaveBeenCalledWith("text", {
      offset: 0,
      canonicalSelectionRevision: 1,
      affinity: "forward",
      preventScroll: true,
    });
    dragHook.unmount();
    dragFixture.dispose();
  });

  it("owns native presentation from accepted pointer-down through range settlement", () => {
    const fixture = pointerGestureFixture();
    fixture.text.setAttribute("contenteditable", "true");
    fixture.text.focus();
    fixture.text.removeAttribute("contenteditable");
    const nativeText = fixture.text.firstChild;
    if (!(nativeText instanceof Text)) throw new Error("Missing fixture text");
    installCollapsedNativeSelection(nativeText, 0);
    fixture.options.selectionController.commitSelectionPoint(
      fixture.point,
      fixture.options.editor,
      1,
      { publication: { kind: "silent" }, cause: "focus" },
    );
    const order: string[] = [];
    fixture.setPointerCapture.mockImplementation(() => {
      expect(
        fixture.options.selectionController.getPresentationSnapshot()
          .nativeSelectionPaintMode,
      ).toBe("hidden-for-global-selection");
      order.push("capture");
    });
    const modes: string[] = [];
    fixture.options.selectionController.presentation.subscribe(() => {
      modes.push(
        fixture.options.selectionController.getPresentationSnapshot()
          .nativeSelectionPaintMode,
      );
    });
    const hook = renderHook(() => {
      useNativeSelectionSynchronization({
        listElement: fixture.list,
        editor: fixture.options.editor,
        contentRuntime: fixture.options.contentRuntime,
        selectionController: fixture.options.selectionController,
        presentation:
          fixture.options.selectionController.getPresentationSnapshot(),
        textAnchorResolver: passthroughTextAnchorResolver,
      });
      useGlobalSelectionGestures(fixture.options);
    });

    act(() =>
      fixture.text.dispatchEvent(
        pointerEvent("pointerdown", {
          pointerId: 10,
          clientX: 10,
          clientY: 10,
        }),
      ),
    );
    expect(document.activeElement).toBe(fixture.text);
    expect(document.getSelection()?.isCollapsed).toBe(true);
    expect(nativePresentationMode(fixture.list)).toBe(
      "hidden-for-global-selection",
    );
    expect(modes).toEqual(["hidden-for-global-selection"]);
    expect(fixture.transientPaintChanged).not.toHaveBeenCalledWith(
      expect.objectContaining({ primitives: expect.any(Array) }),
    );
    fixture.resolvePointerHit.mockReturnValue({
      shell: fixture.shell,
      target: fixture.target,
      textOffset: 1,
      affinity: fixture.point.affinity,
    });
    act(() =>
      document.dispatchEvent(
        pointerEvent("pointermove", {
          pointerId: 10,
          clientX: 20,
          clientY: 10,
        }),
      ),
    );

    expect(order).toEqual(["capture"]);
    expect(document.activeElement).toBe(fixture.text);
    expect(document.getSelection()?.isCollapsed).toBe(true);
    expect(
      fixture.options.selectionController.getPresentationSnapshot()
        .nativeSelectionPaintMode,
    ).toBe("hidden-for-global-selection");
    expect(modes).toEqual(["hidden-for-global-selection"]);
    expect(fixture.transientPaintChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ primitives: expect.any(Array) }),
    );
    expect(
      fixture.options.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({
      kind: "document",
      snapshot: {
        documentSelection: {
          anchor: { textOffset: 0 },
          focus: { textOffset: 0 },
        },
      },
    });
    expect(
      fixture.options.selectionController.localPaint.getSnapshot(),
    ).toEqual({
      kind: "none",
    });
    expect(fixture.requestPresentation).not.toHaveBeenCalled();

    act(() =>
      document.dispatchEvent(
        pointerEvent("pointerup", {
          pointerId: 10,
          clientX: 20,
          clientY: 10,
        }),
      ),
    );

    expect(fixture.requestPresentation).toHaveBeenCalledOnce();
    expect(fixture.transientPaintChanged).toHaveBeenLastCalledWith(null);
    expect(
      fixture.options.selectionController.getPresentationSnapshot()
        .nativeSelectionPaintMode,
    ).toBe("hidden-for-global-selection");
    expect(
      fixture.options.selectionController.localPaint.getSnapshot(),
    ).toMatchObject({ kind: "range" });
    expect(modes).toEqual([
      "hidden-for-global-selection",
      "hidden-for-global-selection",
    ]);
    hook.unmount();
    fixture.dispose();
  });

  it("ignores descendant capture loss and cancels list-owned loss once", () => {
    const fixture = pointerGestureFixture();
    const descendant = document.createElement("span");
    fixture.list.append(descendant);
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));
    beginFixtureDrag(fixture, 16);

    act(() =>
      descendant.dispatchEvent(
        pointerEvent("lostpointercapture", {
          pointerId: 16,
          clientX: 20,
          clientY: 10,
        }),
      ),
    );

    expect(fixture.extendSelection).not.toHaveBeenCalled();
    expect(fixture.releasePointerCapture).not.toHaveBeenCalled();

    act(() =>
      fixture.list.dispatchEvent(
        pointerEvent("lostpointercapture", {
          pointerId: 16,
          clientX: 20,
          clientY: 10,
        }),
      ),
    );

    expect(fixture.extendSelection).not.toHaveBeenCalled();
    expect(fixture.releasePointerCapture).toHaveBeenCalledTimes(1);
    hook.unmount();
    fixture.dispose();
  });

  it("settles and focuses the last valid drag endpoint when pointerup is outside geometry", () => {
    const fixture = pointerGestureFixture();
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));
    beginFixtureDrag(fixture, 17);
    fixture.resolvePointerHit.mockReturnValueOnce(null);

    act(() =>
      document.dispatchEvent(
        pointerEvent("pointerup", {
          pointerId: 17,
          clientX: 20,
          clientY: 1_000,
        }),
      ),
    );

    expect(fixture.extendSelection).toHaveBeenCalledOnce();
    expect(fixture.requestPresentation).toHaveBeenCalledWith("text", {
      offset: 0,
      canonicalSelectionRevision: 1,
      preventScroll: true,
    });
    hook.unmount();
    fixture.dispose();
  });

  it("retains an active drag across temporarily unresolved geometry", () => {
    const fixture = pointerGestureFixture();
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));
    beginFixtureDrag(fixture, 18);
    fixture.resolvePointerHit.mockReturnValueOnce(null);

    act(() =>
      document.dispatchEvent(
        pointerEvent("pointermove", {
          pointerId: 18,
          clientX: 20,
          clientY: 1_000,
        }),
      ),
    );

    expect(fixture.extendSelection).not.toHaveBeenCalled();
    expect(fixture.releasePointerCapture).not.toHaveBeenCalled();

    act(() =>
      document.dispatchEvent(
        pointerEvent("pointerup", {
          pointerId: 18,
          clientX: 20,
          clientY: 10,
        }),
      ),
    );

    expect(fixture.extendSelection).toHaveBeenCalledOnce();
    expect(fixture.requestPresentation).toHaveBeenCalledOnce();
    hook.unmount();
    fixture.dispose();
  });

  it("keeps sub-threshold movement pending", () => {
    const fixture = pointerGestureFixture();
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));
    let down!: PointerEvent;
    let move!: PointerEvent;
    act(() => {
      down = pointerEvent("pointerdown", {
        pointerId: 11,
        clientX: 10,
        clientY: 10,
      });
      fixture.text.dispatchEvent(down);
    });
    act(() => {
      move = pointerEvent("pointermove", {
        pointerId: 11,
        clientX: 12,
        clientY: 11,
      });
      document.dispatchEvent(move);
    });

    expect(down.defaultPrevented).toBe(true);
    expect(move.defaultPrevented).toBe(true);
    expect(fixture.setPointerCapture).not.toHaveBeenCalled();
    expect(fixture.extendSelection).not.toHaveBeenCalled();
    expect(
      fixture.options.selectionController.getPresentationSnapshot()
        .nativeSelectionPaintMode,
    ).toBe("hidden-for-global-selection");
    hook.unmount();
    fixture.dispose();
  });

  it("publishes semantic selection-drag snapshots only after the threshold", () => {
    const fixture = pointerGestureFixture();
    const onSelectionDragStart = vi.fn();
    const onSelectionDragUpdate = vi.fn();
    const onSelectionDragEnd = vi.fn();
    const hook = renderHook(() =>
      useGlobalSelectionGestures({
        ...fixture.options,
        onSelectionDragStart,
        onSelectionDragUpdate,
        onSelectionDragEnd,
      }),
    );

    act(() =>
      fixture.text.dispatchEvent(
        pointerEvent("pointerdown", {
          pointerId: 211,
          clientX: 10,
          clientY: 10,
        }),
      ),
    );
    act(() =>
      document.dispatchEvent(
        pointerEvent("pointermove", {
          pointerId: 211,
          clientX: 12,
          clientY: 11,
        }),
      ),
    );
    expect(onSelectionDragStart).not.toHaveBeenCalled();
    expect(onSelectionDragUpdate).not.toHaveBeenCalled();
    expect(onSelectionDragEnd).not.toHaveBeenCalled();

    act(() =>
      document.dispatchEvent(
        pointerEvent("pointermove", {
          pointerId: 211,
          clientX: 20,
          clientY: 10,
        }),
      ),
    );
    expect(onSelectionDragStart).toHaveBeenCalledOnce();
    expect(onSelectionDragStart).toHaveBeenLastCalledWith({
      selection: expect.objectContaining({
        direction: "forward",
        anchor: expect.objectContaining({ blockId: "text" }),
        focus: expect.objectContaining({ blockId: "text" }),
      }),
      anchor: expect.objectContaining({ blockId: "text" }),
      focus: expect.objectContaining({ blockId: "text" }),
      pointer: { clientX: 20, clientY: 10 },
    });

    act(() =>
      document.dispatchEvent(
        pointerEvent("pointermove", {
          pointerId: 211,
          clientX: 24,
          clientY: 14,
        }),
      ),
    );
    expect(onSelectionDragUpdate).toHaveBeenLastCalledWith(
      expect.objectContaining({ pointer: { clientX: 24, clientY: 14 } }),
    );

    act(() =>
      document.dispatchEvent(
        pointerEvent("pointerup", {
          pointerId: 211,
          clientX: 25,
          clientY: 15,
        }),
      ),
    );
    expect(onSelectionDragStart).toHaveBeenCalledOnce();
    expect(onSelectionDragEnd).toHaveBeenCalledOnce();
    expect(onSelectionDragEnd).toHaveBeenLastCalledWith(
      expect.objectContaining({ pointer: { clientX: 25, clientY: 15 } }),
    );
    hook.unmount();
    fixture.dispose();
  });

  it("does not publish a drag lifecycle for a click", () => {
    const fixture = pointerGestureFixture();
    const claimPresentation = vi.spyOn(
      fixture.options.selectionController,
      "claimTextPointerGesturePresentation",
    );
    const onSelectionDragStart = vi.fn();
    const onSelectionDragEnd = vi.fn();
    const modes: string[] = [];
    fixture.options.selectionController.presentation.subscribe(() => {
      modes.push(
        fixture.options.selectionController.getPresentationSnapshot()
          .nativeSelectionPaintMode,
      );
    });
    const hook = renderHook(() =>
      useGlobalSelectionGestures({
        ...fixture.options,
        onSelectionDragStart,
        onSelectionDragEnd,
      }),
    );

    act(() => {
      fixture.text.dispatchEvent(
        pointerEvent("pointerdown", {
          pointerId: 212,
          clientX: 10,
          clientY: 10,
        }),
      );
      document.dispatchEvent(
        pointerEvent("pointerup", {
          pointerId: 212,
          clientX: 10,
          clientY: 10,
        }),
      );
    });

    expect(onSelectionDragStart).not.toHaveBeenCalled();
    expect(onSelectionDragEnd).not.toHaveBeenCalled();
    expect(claimPresentation).toHaveBeenCalledOnce();
    expect(
      fixture.options.selectionController.getPresentationSnapshot()
        .nativeSelectionPaintMode,
    ).toBe("visible");
    expect(modes).toEqual([
      "hidden-for-global-selection",
      "hidden-for-global-selection",
      "visible",
    ]);
    expect(fixture.transientPaintChanged).toHaveBeenLastCalledWith(null);
    hook.unmount();
    fixture.dispose();
  });

  it("refreshes a stationary drag point when an external ancestor scrolls", () => {
    const fixture = pointerGestureFixture();
    const scrollContainer = document.createElement("div");
    scrollContainer.dataset.editorInteractionScope = "true";
    fixture.list.before(scrollContainer);
    scrollContainer.append(fixture.list);
    const onSelectionDragUpdate = vi.fn();
    const hook = renderHook(() =>
      useGlobalSelectionGestures({
        ...fixture.options,
        onSelectionDragStart: vi.fn(),
        onSelectionDragUpdate,
      }),
    );
    beginFixtureDrag(fixture, 214);
    onSelectionDragUpdate.mockClear();

    act(() => scrollContainer.dispatchEvent(new Event("scroll")));

    expect(onSelectionDragUpdate).toHaveBeenCalledOnce();
    expect(onSelectionDragUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ pointer: { clientX: 20, clientY: 10 } }),
    );
    hook.unmount();
    fixture.dispose();
    scrollContainer.remove();
  });

  it.each(["pointercancel", "lostpointercapture", "unmount"])(
    "ends a started selection drag once on %s",
    (terminal) => {
      const fixture = pointerGestureFixture();
      const onSelectionDragStart = vi.fn();
      const onSelectionDragEnd = vi.fn();
      const hook = renderHook(() =>
        useGlobalSelectionGestures({
          ...fixture.options,
          onSelectionDragStart,
          onSelectionDragEnd,
        }),
      );
      beginFixtureDrag(fixture, 213);

      act(() => {
        if (terminal === "pointercancel") {
          document.dispatchEvent(
            pointerEvent("pointercancel", { pointerId: 213 }),
          );
        } else if (terminal === "lostpointercapture") {
          fixture.list.dispatchEvent(
            pointerEvent("lostpointercapture", { pointerId: 213 }),
          );
        } else {
          hook.unmount();
        }
      });

      expect(onSelectionDragStart).toHaveBeenCalledOnce();
      expect(onSelectionDragEnd).toHaveBeenCalledOnce();
      if (terminal !== "unmount") hook.unmount();
      fixture.dispose();
    },
  );

  it("prevents native selection from the first claimed pointer event while preserving canonical affinity", () => {
    const fixture = pointerGestureFixture("backward");
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));
    const down = pointerEvent("pointerdown", {
      pointerId: 111,
      clientX: 10,
      clientY: 10,
    });

    act(() => fixture.text.dispatchEvent(down));

    expect(down.defaultPrevented).toBe(true);
    expect(fixture.extendSelection).not.toHaveBeenCalled();
    expect(fixture.commitSelectionPoint).not.toHaveBeenCalled();
    expect(fixture.options.selectionController.getCanonicalSnapshot()).toEqual({
      kind: "none",
      revision: 0,
    });
    expect(fixture.requestPresentation).not.toHaveBeenCalled();
    hook.unmount();
    fixture.dispose();
  });

  it("releases a registered nested-text session when activation rejects", () => {
    const fixture = pointerGestureFixture();
    const releasePresentation = vi.fn();
    const claimPresentation =
      fixture.options.selectionController.claimTextPointerGesturePresentation;
    vi.spyOn(
      fixture.options.selectionController,
      "claimTextPointerGesturePresentation",
    ).mockImplementation(() => {
      const claim = claimPresentation();
      return {
        release: () => {
          releasePresentation();
          claim.release();
        },
      };
    });
    fixture.shell.dataset.editorBlockInternalSelectionHost = "true";
    const cancel = vi.fn();
    const unregister = fixture.options.textGestureArbitration.register(
      fixture.shell,
      {
        begin: () => ({
          shouldTransfer: () => false,
          transfer: () => null,
          cancel,
        }),
      },
    );
    fixture.focusText.mockReturnValueOnce({
      status: "rejected",
      reason: "native-focus-failed",
    });
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));
    const down = pointerEvent("pointerdown", {
      pointerId: 211,
      clientX: 10,
      clientY: 10,
    });

    act(() => fixture.text.dispatchEvent(down));

    expect(down.defaultPrevented).toBe(true);
    expect(fixture.focusText).toHaveBeenCalledWith("text", {
      offset: 0,
      affinity: null,
      preventScroll: true,
    });
    expect(cancel).toHaveBeenCalledOnce();
    expect(
      fixture.list.dataset.editorNativeCaretPointerPending,
    ).toBeUndefined();
    expect(nativePresentationMode(fixture.list)).toBe("visible");
    expect(releasePresentation).toHaveBeenCalledOnce();
    expect(fixture.options.selectionController.getCanonicalSnapshot()).toEqual({
      kind: "none",
      revision: 0,
    });
    unregister();
    hook.unmount();
    fixture.dispose();
  });

  it.each([
    "pointercancel",
    "Escape",
    "lost pointer capture",
    "window blur",
    "page hide",
    "hidden page",
    "invalidated target",
    "unmount",
  ])("leaves canonical selection and focus unchanged after %s", (terminal) => {
    const fixture = pointerGestureFixture();
    const releasePresentation = vi.fn();
    const claimPresentation =
      fixture.options.selectionController.claimTextPointerGesturePresentation;
    vi.spyOn(
      fixture.options.selectionController,
      "claimTextPointerGesturePresentation",
    ).mockImplementation(() => {
      const claim = claimPresentation();
      return {
        release: () => {
          releasePresentation();
          claim.release();
        },
      };
    });
    const modes: string[] = [];
    fixture.options.selectionController.presentation.subscribe(() => {
      modes.push(
        fixture.options.selectionController.getPresentationSnapshot()
          .nativeSelectionPaintMode,
      );
    });
    const publications = vi.fn();
    fixture.options.selectionController.subscribeStandaloneSettlements(
      publications,
    );
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));
    const before = fixture.options.selectionController.getCanonicalSnapshot();

    if (terminal === "lost pointer capture") beginFixtureDrag(fixture, 112);
    else {
      act(() =>
        fixture.text.dispatchEvent(
          pointerEvent("pointerdown", {
            pointerId: 112,
            clientX: 10,
            clientY: 10,
          }),
        ),
      );
    }

    act(() => {
      if (terminal === "pointercancel") {
        document.dispatchEvent(
          pointerEvent("pointercancel", { pointerId: 112 }),
        );
      } else if (terminal === "Escape") {
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Escape",
          }),
        );
      } else if (terminal === "lost pointer capture") {
        fixture.list.dispatchEvent(
          pointerEvent("lostpointercapture", { pointerId: 112 }),
        );
      } else if (terminal === "window blur") {
        window.dispatchEvent(new Event("blur"));
      } else if (terminal === "page hide") {
        window.dispatchEvent(new Event("pagehide"));
      } else if (terminal === "hidden page") {
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "hidden",
        });
        document.dispatchEvent(new Event("visibilitychange"));
        Object.defineProperty(document, "visibilityState", {
          configurable: true,
          value: "visible",
        });
      } else if (terminal === "invalidated target") {
        fixture.resolvePointerHit.mockReturnValueOnce(null);
        document.dispatchEvent(
          pointerEvent("pointerup", {
            pointerId: 112,
            clientX: 20,
            clientY: 10,
          }),
        );
      } else {
        hook.unmount();
      }
    });

    expect(fixture.options.selectionController.getCanonicalSnapshot()).toEqual(
      before,
    );
    expect(publications).not.toHaveBeenCalled();
    expect(fixture.requestPresentation).not.toHaveBeenCalled();
    expect(fixture.nativeFocus).not.toHaveBeenCalled();
    expect(fixture.acquireBlockContent).not.toHaveBeenCalled();
    expect(fixture.extendSelection).not.toHaveBeenCalled();
    expect(releasePresentation).toHaveBeenCalledOnce();
    expect(modes).toEqual(["hidden-for-global-selection", "visible"]);
    if (terminal !== "unmount") hook.unmount();
    fixture.dispose();
  });

  it.each([
    "pointerup",
    "pointercancel",
    "lostpointercapture",
    "Escape",
    "window blur",
    "graph invalidation",
    "unmount",
  ])(
    "releases capture before handing transient presentation back on %s",
    (terminal) => {
      const fixture = pointerGestureFixture();
      fixture.releasePointerCapture.mockImplementation(() => {
        expect(
          fixture.options.selectionController.getPresentationSnapshot()
            .nativeSelectionPaintMode,
        ).toBe("hidden-for-global-selection");
      });
      const hook = renderHook(() =>
        useGlobalSelectionGestures(fixture.options),
      );
      beginFixtureDrag(fixture, 12);

      act(() => {
        if (terminal === "Escape") {
          document.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              key: "Escape",
            }),
          );
        } else if (terminal === "window blur") {
          window.dispatchEvent(new Event("blur"));
        } else if (terminal === "graph invalidation") {
          (
            fixture.options.editor as unknown as {
              getSelectionGraphRevision: () => number;
            }
          ).getSelectionGraphRevision = () => 2;
          document.dispatchEvent(
            pointerEvent("pointerup", {
              pointerId: 12,
              clientX: 20,
              clientY: 10,
            }),
          );
        } else if (terminal === "lostpointercapture") {
          fixture.list.dispatchEvent(
            pointerEvent("lostpointercapture", {
              pointerId: 12,
              clientX: 20,
              clientY: 10,
            }),
          );
        } else if (terminal === "unmount") {
          hook.unmount();
        } else {
          document.dispatchEvent(
            pointerEvent(terminal, {
              pointerId: 12,
              clientX: 20,
              clientY: 10,
            }),
          );
        }
      });

      expect(fixture.releasePointerCapture).toHaveBeenCalledOnce();
      expect(
        fixture.options.selectionController.getPresentationSnapshot()
          .nativeSelectionPaintMode,
      ).toBe("visible");
      expect(nativePresentationMode(fixture.list)).toBe("visible");
      expect(fixture.list.dataset.editorSelectionPaintVisible).toBeUndefined();
      expect(fixture.transientPaintChanged).toHaveBeenLastCalledWith(null);
      if (terminal !== "pointerup")
        expect(fixture.extendSelection).not.toHaveBeenCalled();
      if (terminal !== "unmount") hook.unmount();
      fixture.dispose();
    },
  );

  it("cancels the pending gesture when explicit capture fails", () => {
    const fixture = pointerGestureFixture();
    const releasePresentation = vi.fn();
    const claimPresentation =
      fixture.options.selectionController.claimTextPointerGesturePresentation;
    vi.spyOn(
      fixture.options.selectionController,
      "claimTextPointerGesturePresentation",
    ).mockImplementation(() => {
      const claim = claimPresentation();
      return {
        release: () => {
          releasePresentation();
          claim.release();
        },
      };
    });
    fixture.setPointerCapture.mockImplementation(() => {
      throw new DOMException("Pointer is no longer active");
    });
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));

    beginFixtureDrag(fixture, 13);

    expect(fixture.extendSelection).not.toHaveBeenCalled();
    expect(fixture.releasePointerCapture).not.toHaveBeenCalled();
    expect(
      fixture.options.selectionController.getPresentationSnapshot()
        .nativeSelectionPaintMode,
    ).toBe("visible");
    expect(nativePresentationMode(fixture.list)).toBe("visible");
    expect(fixture.list.dataset.editorSelectionPaintVisible).toBeUndefined();
    expect(releasePresentation).toHaveBeenCalledOnce();
    hook.unmount();
    fixture.dispose();
  });

  it("starts a drag from current coordinates after the pointerdown target is replaced", () => {
    const fixture = pointerGestureFixture();
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));
    act(() =>
      fixture.text.dispatchEvent(
        pointerEvent("pointerdown", {
          pointerId: 14,
          clientX: 10,
          clientY: 10,
        }),
      ),
    );
    const replacement = document.createElement("div");
    replacement.className = "editor-web-text";
    fixture.text.replaceWith(replacement);
    fixture.resolvePointerHit.mockReturnValueOnce({
      shell: fixture.shell,
      target: fixture.target,
      textOffset: 1,
      affinity: fixture.point.affinity,
    });

    act(() =>
      document.dispatchEvent(
        pointerEvent("pointermove", {
          pointerId: 14,
          clientX: 20,
          clientY: 10,
        }),
      ),
    );

    expect(fixture.setPointerCapture).toHaveBeenCalledWith(14);
    expect(fixture.transientPaintChanged).toHaveBeenLastCalledWith(
      expect.objectContaining({ primitives: expect.any(Array) }),
    );
    expect(
      fixture.options.selectionController.getPresentationSnapshot()
        .nativeSelectionPaintMode,
    ).toBe("hidden-for-global-selection");
    hook.unmount();
    fixture.dispose();
  });

  it.each([
    ["button", {}],
    ["input", {}],
    ["object control", { editorObjectUi: "true" }],
    ["resize handle", { editorUi: "true" }],
  ])(
    "clears selection without claiming pointer selection from a %s",
    (_name, dataset) => {
      const fixture = pointerGestureFixture();
      fixture.options.selectionController.commitSelectionPoint(
        fixture.point,
        fixture.options.editor,
        1,
        { publication: { kind: "silent" }, cause: "focus" },
      );
      const publications = vi.fn();
      fixture.options.selectionController.subscribeStandaloneSettlements(
        publications,
      );
      const control = document.createElement(
        _name === "input" ? "input" : _name === "button" ? "button" : "div",
      );
      Object.assign(control.dataset, dataset);
      fixture.text.append(control);
      const hook = renderHook(() =>
        useGlobalSelectionGestures(fixture.options),
      );

      const down = pointerEvent("pointerdown", {
        pointerId: 15,
        clientX: 10,
        clientY: 10,
      });
      act(() => control.dispatchEvent(down));
      act(() =>
        control.dispatchEvent(
          new MouseEvent("click", {
            bubbles: true,
            cancelable: true,
            button: 0,
            clientX: 10,
            clientY: 10,
          }),
        ),
      );

      expect(down.defaultPrevented).toBe(false);
      expect(fixture.setPointerCapture).not.toHaveBeenCalled();
      expect(fixture.extendSelection).not.toHaveBeenCalled();
      expect(fixture.requestPresentation).not.toHaveBeenCalled();
      expect(nativePresentationMode(fixture.list)).toBe("visible");
      expect(
        fixture.options.selectionController.getCanonicalSnapshot(),
      ).toEqual(expect.objectContaining({ kind: "none" }));
      expect(publications).toHaveBeenCalledOnce();
      hook.unmount();
      fixture.dispose();
    },
  );

  it.each([
    ["block-internal host", { editorBlockInternalSelectionHost: "true" }],
    ["selection consumer", { editorPreserveSelection: "true" }],
  ])(
    "delegates pointer ownership to a %s without clearing",
    (_name, dataset) => {
      const fixture = pointerGestureFixture();
      const clearSelection = vi.spyOn(
        fixture.options.selectionController,
        "clearSelection",
      );
      const control = document.createElement("div");
      Object.assign(control.dataset, dataset);
      fixture.text.append(control);
      const hook = renderHook(() =>
        useGlobalSelectionGestures(fixture.options),
      );

      act(() =>
        control.dispatchEvent(
          pointerEvent("pointerdown", {
            pointerId: 16,
            clientX: 10,
            clientY: 10,
          }),
        ),
      );

      expect(clearSelection).not.toHaveBeenCalled();
      expect(fixture.extendSelection).not.toHaveBeenCalled();
      hook.unmount();
      fixture.dispose();
    },
  );

  it("clears selection on block-list whitespace and failed start hit testing", () => {
    const fixture = pointerGestureFixture();
    fixture.options.selectionController.commitSelectionPoint(
      fixture.point,
      fixture.options.editor,
      1,
      { publication: { kind: "silent" }, cause: "focus" },
    );
    fixture.resolvePointerHit.mockReturnValueOnce(null);
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));

    act(() =>
      fixture.list.dispatchEvent(
        pointerEvent("pointerdown", {
          pointerId: 17,
          clientX: 100,
          clientY: 100,
        }),
      ),
    );

    expect(fixture.options.selectionController.getCanonicalSnapshot()).toEqual(
      expect.objectContaining({ kind: "none" }),
    );
    expect(fixture.extendSelection).not.toHaveBeenCalled();
    hook.unmount();
    fixture.dispose();
  });

  it("clears selection inside the interaction scope but outside the block list", () => {
    const fixture = pointerGestureFixture();
    const scope = document.createElement("section");
    scope.dataset.editorInteractionScope = "true";
    const surface = document.createElement("div");
    scope.append(fixture.list, surface);
    document.body.append(scope);
    fixture.options.selectionController.commitSelectionPoint(
      fixture.point,
      fixture.options.editor,
      1,
      { publication: { kind: "silent" }, cause: "focus" },
    );
    const publications = vi.fn();
    fixture.options.selectionController.subscribeStandaloneSettlements(
      publications,
    );
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));

    act(() => {
      surface.dispatchEvent(
        pointerEvent("pointerdown", {
          pointerId: 18,
          clientX: 100,
          clientY: 100,
        }),
      );
      surface.dispatchEvent(
        pointerEvent("pointerdown", {
          pointerId: 19,
          clientX: 100,
          clientY: 100,
        }),
      );
    });

    expect(fixture.options.selectionController.getCanonicalSnapshot()).toEqual(
      expect.objectContaining({ kind: "none" }),
    );
    expect(publications).toHaveBeenCalledOnce();
    expect(fixture.options.editor.blurEditor).toHaveBeenCalledTimes(2);
    hook.unmount();
    scope.remove();
    fixture.dispose();
  });

  it("lets active composition own Escape", () => {
    const fixture = gestureFixture({ composition: { revision: 1 } });
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });

    act(() => fixture.options.listElement.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(fixture.cancel).not.toHaveBeenCalled();
    hook.unmount();
    fixture.dispose();
  });

  it("cancels a committed selection when no composition or gesture owns Escape", () => {
    const fixture = gestureFixture({ composition: null });
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });

    act(() => fixture.options.listElement.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(fixture.cancel).toHaveBeenCalledOnce();
    hook.unmount();
    fixture.dispose();
  });

  it("clears canonical selection before releasing native focus on outside pointer-down", () => {
    const fixture = gestureFixture({ composition: null });
    const outside = document.createElement("button");
    const selectedText = document.createTextNode("selected");
    fixture.options.listElement.append(selectedText);
    document.body.append(outside);
    const nativeSelection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(selectedText);
    nativeSelection?.addRange(range);
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));

    act(() =>
      fixture.options.listElement.dispatchEvent(
        new KeyboardEvent("keydown", { key: "x", bubbles: true }),
      ),
    );

    act(() =>
      outside.dispatchEvent(
        pointerEvent("pointerdown", {
          pointerId: 19,
          clientX: 1,
          clientY: 1,
        }),
      ),
    );

    expect(fixture.blurEditor).toHaveBeenCalledOnce();
    expect(fixture.cancel).toHaveBeenCalledOnce();
    expect(fixture.cancel).toHaveBeenCalledWith({
      publication: { kind: "standalone-local" },
      cause: "pointer",
    });
    expect(nativeSelection?.rangeCount).toBe(0);
    hook.unmount();
    outside.remove();
    fixture.dispose();
  });

  it("rejects a native caret relocated into the editor after an external pointerdown", () => {
    const fixture = pointerGestureFixture();
    const outside = document.createElement("button");
    document.body.append(outside);
    const hook = renderHook(() => {
      useNativeSelectionSynchronization({
        listElement: fixture.list,
        editor: fixture.options.editor,
        contentRuntime: fixture.options.contentRuntime,
        selectionController: fixture.options.selectionController,
        presentation:
          fixture.options.selectionController.getPresentationSnapshot(),
        textAnchorResolver: passthroughTextAnchorResolver,
      });
      useGlobalSelectionGestures(fixture.options);
    });

    act(() => {
      fixture.text.dispatchEvent(
        pointerEvent("pointerdown", {
          pointerId: 70,
          clientX: 10,
          clientY: 10,
        }),
      );
      document.dispatchEvent(
        pointerEvent("pointerup", {
          pointerId: 70,
          clientX: 10,
          clientY: 10,
        }),
      );
    });
    const textNode = fixture.text.firstChild;
    if (!(textNode instanceof Text)) throw new Error("Missing fixture text");
    installCollapsedNativeSelection(textNode, 0);
    const publications = vi.fn();
    fixture.options.selectionController.subscribeStandaloneSettlements(
      publications,
    );

    const outsideDown = pointerEvent("pointerdown", {
      pointerId: 71,
      clientX: 900,
      clientY: 500,
    });
    act(() => outside.dispatchEvent(outsideDown));

    expect(outsideDown.defaultPrevented).toBe(false);
    expect(
      fixture.options.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({ kind: "none" });
    expect(publications).toHaveBeenCalledOnce();
    expect(publications).toHaveBeenLastCalledWith({ kind: "none" });

    act(() => {
      installCollapsedNativeSelection(textNode, 4);
      document.dispatchEvent(new Event("selectionchange"));
    });

    expect(
      fixture.options.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({ kind: "none" });
    expect(publications).toHaveBeenCalledOnce();

    const secondOutsideDown = pointerEvent("pointerdown", {
      pointerId: 73,
      clientX: 20,
      clientY: 700,
    });
    act(() => {
      outside.dispatchEvent(secondOutsideDown);
      installCollapsedNativeSelection(textNode, 8);
      document.dispatchEvent(new Event("selectionchange"));
    });

    expect(secondOutsideDown.defaultPrevented).toBe(false);
    expect(
      fixture.options.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({ kind: "none" });
    expect(publications).toHaveBeenCalledOnce();

    act(() => {
      fixture.text.dispatchEvent(
        pointerEvent("pointerdown", {
          pointerId: 72,
          clientX: 10,
          clientY: 10,
        }),
      );
      document.dispatchEvent(
        pointerEvent("pointerup", {
          pointerId: 72,
          clientX: 10,
          clientY: 10,
        }),
      );
    });

    expect(
      fixture.options.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({
      kind: "document",
      snapshot: {
        documentSelection: { focus: { blockId: "text", textOffset: 0 } },
      },
    });
    expect(publications).toHaveBeenCalledTimes(2);
    expect(publications.mock.calls[1]?.[0]).toMatchObject({
      kind: "selection",
    });

    act(() =>
      outside.dispatchEvent(
        pointerEvent("pointerdown", {
          pointerId: 74,
          clientX: 900,
          clientY: 100,
        }),
      ),
    );
    expect(publications).toHaveBeenCalledTimes(3);
    expect(publications).toHaveBeenLastCalledWith({ kind: "none" });

    fixture.list.tabIndex = 0;
    fixture.list.focus();
    act(() => {
      fixture.text.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "Shift",
        }),
      );
      installCollapsedNativeSelection(textNode, 6);
      document.dispatchEvent(new Event("selectionchange"));
    });

    expect(document.activeElement).toBe(fixture.list);
    expect(
      fixture.options.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({
      kind: "document",
      snapshot: {
        documentSelection: { focus: { blockId: "text", textOffset: 6 } },
      },
    });
    expect(publications).toHaveBeenCalledTimes(4);
    expect(publications).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "selection" }),
    );

    hook.unmount();
    document.getSelection()?.removeAllRanges();
    outside.remove();
    fixture.dispose();
  });

  it("keeps gesture ownership when React replaces the target during pointer-down", () => {
    const fixture = gestureFixture({ composition: null });
    const target = document.createElement("span");
    fixture.options.listElement.append(target);
    const replaceTarget = () => target.remove();
    document.addEventListener("pointerdown", replaceTarget, {
      capture: true,
      once: true,
    });
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));

    act(() =>
      target.dispatchEvent(
        new Event("pointerdown", { bubbles: true, cancelable: true }),
      ),
    );

    expect(fixture.blurEditor).not.toHaveBeenCalled();
    expect(fixture.cancel).not.toHaveBeenCalled();
    hook.unmount();
    fixture.dispose();
  });

  it("retains a committed document selection when object input takes focus", () => {
    const fixture = gestureFixture({ composition: null });
    const input = document.createElement("input");
    input.dataset.editorObjectFocusTarget = "true";
    fixture.options.listElement.append(input);
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));

    act(() => input.focus());

    expect(fixture.blurEditor).not.toHaveBeenCalled();
    expect(fixture.cancel).not.toHaveBeenCalled();
    hook.unmount();
    fixture.dispose();
  });

  it("leaves Backspace in an active editable text projection to ProseMirror", () => {
    const fixture = gestureFixture({ composition: null });
    const editable = document.createElement("div");
    editable.dataset.editorTextRoot = "true";
    editable.setAttribute("contenteditable", "true");
    fixture.options.listElement.append(editable);
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Backspace",
    });

    act(() => editable.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(fixture.captureStructuralSelection).not.toHaveBeenCalled();
    hook.unmount();
    fixture.dispose();
  });

  it.each(["Delete", "Backspace"])(
    "owns cross-block %s even when the structural transaction rejects",
    (key) => {
      const fixture = gestureFixture({ composition: null });
      const firstId = "first" as BlockId;
      const secondId = "second" as BlockId;
      vi.spyOn(
        fixture.options.selectionController,
        "getCommittedSnapshot",
      ).mockReturnValue({
        revision: 2,
        endpoints: {
          anchor: { blockId: firstId, textOffset: 1 },
          head: { blockId: secondId, textOffset: 2 },
        },
      } as never);
      fixture.captureStructuralSelection.mockReturnValue({
        isCurrent: () => true,
        range: {
          graphRevision: 1,
          selectionRevision: 2,
          blocks: [],
          start: { kind: "text", blockId: firstId, offset: 1 },
          end: { kind: "text", blockId: secondId, offset: 2 },
        },
      } as never);
      const executeStructuralRangeDeletion = vi.fn(() => ({
        ok: false,
        reason: "content-operations-rejected",
        contentResult: { ok: false, applied: 0, failures: [] },
      }));
      Object.assign(fixture.options.editor, {
        definition: { blocks: {} },
        executeStructuralRangeDeletion,
      });
      const hook = renderHook(() =>
        useGlobalSelectionGestures(fixture.options),
      );
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
      });

      act(() => fixture.options.listElement.dispatchEvent(event));

      expect(event.defaultPrevented).toBe(true);
      expect(executeStructuralRangeDeletion).toHaveBeenCalledOnce();
      hook.unmount();
      fixture.dispose();
    },
  );

  it("leaves a noncollapsed same-block text deletion to ProseMirror", () => {
    const fixture = gestureFixture({ composition: null });
    const blockId = "text" as BlockId;
    vi.spyOn(
      fixture.options.selectionController,
      "getCommittedSnapshot",
    ).mockReturnValue({
      revision: 2,
      endpoints: {
        anchor: { blockId, textOffset: 1 },
        head: { blockId, textOffset: 3 },
      },
    } as never);
    fixture.captureStructuralSelection.mockReturnValue({
      isCurrent: () => true,
      range: {
        graphRevision: 1,
        selectionRevision: 2,
        blocks: [],
        start: { kind: "text", blockId, offset: 1 },
        end: { kind: "text", blockId, offset: 3 },
      },
    } as never);
    const executeStructuralRangeDeletion = vi.fn();
    Object.assign(fixture.options.editor, {
      definition: { blocks: {} },
      executeStructuralRangeDeletion,
    });
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Delete",
    });

    act(() => fixture.options.listElement.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(executeStructuralRangeDeletion).not.toHaveBeenCalled();
    hook.unmount();
    fixture.dispose();
  });

  it("uses the same vertical movement result for Shift extension", () => {
    const firstId = "vertical-first" as BlockId;
    const secondId = "vertical-second" as BlockId;
    const roots = [firstId, secondId];
    const graph: EditorSelectionGraphReader = {
      getBlock: (blockId) =>
        roots.includes(blockId)
          ? {
              id: blockId,
              type: "textBlock",
              parentId: null,
              tombstone: null,
              metadataVersion: "1",
              contentVersion: asContentVersion("1"),
            }
          : null,
      getParentId: () => null,
      getRootBlockIds: () => roots,
      getChildBlockIds: () => [],
      readBlockSelectionModel: () => contentSelection(),
    };
    const makeAnchor = (offset: number) =>
      createEditorSelectionTextAnchor({
        codec: "vertical-test",
        payload: { encoded: btoa(String(offset)), assoc: 0 },
      });
    const initialAnchor = makeAnchor(2);
    if (!initialAnchor.ok) throw new Error(initialAnchor.message);
    const initial = createEditorLogicalSelectionPoint({
      graph,
      blockId: firstId,
      textOffset: 2,
      textAnchor: initialAnchor.textAnchor,
    });
    if (!initial) throw new Error("Vertical fixture point is invalid.");
    const list = document.createElement("div");
    list.className = "editor-web-block-list";
    list.dataset.editorBlockListRoot = "true";
    const shell = document.createElement("div");
    shell.className = "editor-web-block";
    shell.dataset.editorBlockShell = "true";
    shell.dataset.editorBlockId = firstId;
    const editable = document.createElement("div");
    editable.className = "editor-web-text";
    editable.dataset.editorTextRoot = "true";
    editable.setAttribute("contenteditable", "true");
    shell.append(editable);
    list.append(shell);
    document.body.append(list);
    const moveTextVertically = vi.fn(() => ({
      kind: "boundary" as const,
      preferredX: 44,
    }));
    const mapTextToVisualRow = vi.fn(() => ({
      kind: "mapped" as const,
      offset: 3,
    }));
    const requestPresentation = vi.fn();
    const editor = {
      ...documentInputRuntimeStub(),
      ...graph,
      editable: true,
      getSelectionGraphRevision: () => 1,
      requestTextPresentation: requestPresentation,
      blurEditor: vi.fn(),
      readTextSelectionOffset: () => 2,
      geometry: {
        moveTextVertically,
        mapTextToVisualRow,
        readTextVisualRowBoundary: vi.fn(),
      },
    } as unknown as EditableEditorRuntimePort;
    const contentRuntime = {
      readBlockProjection: (blockId: BlockId) => ({
        type: "doc" as const,
        content: [
          {
            type: "textBlock" as const,
            content: [
              {
                type: "text" as const,
                text: blockId === firstId ? "alpha" : "bravo",
              },
            ],
          },
        ],
      }),
      acquireBlockContent: (
        blockId: BlockId,
        blockType: "textBlock",
        reason: "canonical-transaction",
      ) => ({
        blockId,
        blockType,
        reason,
        release: vi.fn(),
      }),
      createTextAnchorInContext: (
        _lease: unknown,
        input: { readonly textOffset: number },
      ) => ({
        ok: true as const,
        codec: "vertical-test",
        payload: { encoded: btoa(String(input.textOffset)), assoc: 0 as const },
        textOffset: input.textOffset,
      }),
    } as unknown as EditorWebContentRuntime;
    const controller = createSelectionController();
    Object.assign(editor, { selectionController: controller });
    controller.commitSelectionPoint(initial, graph, 1, {
      publication: { kind: "silent" },
      cause: "focus",
    });
    const publications = vi.fn();
    controller.subscribeStandaloneSettlements(publications);
    const hook = renderHook(() =>
      useGlobalSelectionGestures({
        listElement: list,
        blockDom: { getBlockShell: () => shell },
        editor,
        contentRuntime,
        selectionController: controller,
        captureStructuralSelection: vi.fn(() => null),
        documentLayerKeyboard: unhandledDocumentLayerKeyboard,
        textGestureArbitration: createEditorTextGestureArbitration(),
        onTransientPointerPaintChange: vi.fn(),
      }),
    );
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowDown",
      shiftKey: true,
    });

    act(() => {
      editable.focus();
      editable.dispatchEvent(event);
    });

    expect(controller.getCommittedSnapshot()).toMatchObject({
      endpoints: {
        anchor: { blockId: firstId, textOffset: 2 },
        head: { blockId: secondId, textOffset: 3 },
      },
    });
    expect(moveTextVertically).toHaveBeenCalledOnce();
    expect(mapTextToVisualRow).toHaveBeenCalledWith(secondId, "first", 44);
    expect(publications).toHaveBeenCalledOnce();
    expect(requestPresentation).toHaveBeenCalledWith(secondId, {
      offset: 3,
      canonicalSelectionRevision: 2,
      preventScroll: true,
    });
    expect(event.defaultPrevented).toBe(true);

    hook.unmount();
    controller.dispose();
    list.remove();
  });

  it("leaves caret navigation to the text projection without canonical selection", () => {
    const fixture = gestureFixture({ composition: null });
    const editable = document.createElement("div");
    editable.dataset.editorTextRoot = "true";
    editable.setAttribute("contenteditable", "true");
    fixture.options.listElement.append(editable);
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowLeft",
    });

    act(() => editable.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(fixture.getEndpointSnapshot).toHaveBeenCalledOnce();
    expect(fixture.blurEditor).not.toHaveBeenCalled();
    expect(fixture.cancel).not.toHaveBeenCalled();
    hook.unmount();
    fixture.dispose();
  });

  it("leaves Shift+Arrow to the text projection without canonical selection", () => {
    const fixture = gestureFixture({ composition: null });
    const editable = document.createElement("div");
    editable.dataset.editorTextRoot = "true";
    editable.setAttribute("contenteditable", "true");
    fixture.options.listElement.append(editable);
    const hook = renderHook(() => useGlobalSelectionGestures(fixture.options));
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowRight",
      shiftKey: true,
    });

    act(() => editable.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(fixture.getEndpointSnapshot).toHaveBeenCalledOnce();
    expect(fixture.blurEditor).not.toHaveBeenCalled();
    expect(fixture.cancel).not.toHaveBeenCalled();
    hook.unmount();
    fixture.dispose();
  });
});

function pointerGestureFixture(affinity: "backward" | "forward" | null = null) {
  const list = document.createElement("div");
  list.className = "editor-web-block-list";
  list.dataset.editorBlockListRoot = "true";
  const shell = document.createElement("div");
  shell.className = "editor-web-block";
  shell.dataset.editorBlockShell = "true";
  shell.dataset.editorBlockId = "text";
  const text = document.createElement("div");
  text.className = "editor-web-text";
  text.dataset.editorTextRoot = "true";
  text.textContent = "hello world";
  shell.append(text);
  list.append(shell);
  document.body.append(list);

  const graph: EditorSelectionGraphReader = {
    getBlock: (blockId) =>
      blockId === ("text" as BlockId)
        ? {
            id: "text" as BlockId,
            type: "textBlock",
            parentId: null,
            tombstone: null,
            metadataVersion: "1",
            contentVersion: asContentVersion("1"),
          }
        : null,
    getParentId: () => null,
    getRootBlockIds: () => ["text" as BlockId],
    getChildBlockIds: () => [],
    readBlockSelectionModel: () => contentSelection(),
  };
  const stableAnchor = createEditorSelectionTextAnchor({
    codec: "pointer-test",
    payload: { encoded: "MA==", assoc: 0 },
  });
  if (!stableAnchor.ok) throw new Error(stableAnchor.message);
  const point = createEditorLogicalSelectionPoint({
    graph,
    blockId: "text" as BlockId,
    textOffset: 0,
    textAnchor: stableAnchor.textAnchor,
    affinity,
  });
  const target = readEditorBlockSelectionTarget(graph, "text" as BlockId);
  if (!point || !target) throw new Error("Pointer fixture target is invalid");
  const resolvePointerHit = vi
    .spyOn(pointerHitTesting, "resolveEditorSelectionPointerHit")
    .mockReturnValue({
      shell,
      target,
      textOffset: point.textOffset,
      affinity: point.affinity,
    });
  const nativeFocus = vi.spyOn(text, "focus");
  const transientPaintChanged = vi.fn();

  const controller = createSelectionController();
  const commitSelectionPoint = vi.spyOn(controller, "commitSelectionPoint");
  const extendSelection = vi.spyOn(controller, "extendSelection");
  const setPointerCapture = vi.fn();
  const releasePointerCapture = vi.fn();
  Object.defineProperties(list, {
    setPointerCapture: { configurable: true, value: setPointerCapture },
    hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
    releasePointerCapture: {
      configurable: true,
      value: releasePointerCapture,
    },
  });
  const requestPresentation = vi.fn(() => true);
  const focusText = vi.fn(
    () =>
      ({ status: "focused" }) as
        | { readonly status: "focused" }
        | {
            readonly status: "rejected";
            readonly reason: "native-focus-failed";
          },
  );
  const releaseSettlementLease = vi.fn();
  const acquireBlockContent = vi.fn(
    (
      blockId: BlockId,
      blockType: "textBlock",
      reason: "canonical-transaction",
    ) => ({ blockId, blockType, reason, release: releaseSettlementLease }),
  );
  const createTextAnchorInContext = vi.fn(
    (_lease: unknown, input: { readonly textOffset: number }) => ({
      ok: true as const,
      codec: "pointer-test",
      payload: { encoded: btoa(String(input.textOffset)), assoc: 0 as const },
      textOffset: input.textOffset,
    }),
  );
  const contentRuntime = {
    acquireBlockContent,
    createTextAnchorInContext,
  } as unknown as EditorWebContentRuntime;
  const editor = {
    ...documentInputRuntimeStub(),
    ...graph,
    editable: true,
    definition: { blocks: { textBlock: { kind: "text" } } },
    getSelectionGraphRevision: () => 1,
    requestTextPresentation: requestPresentation,
    focusText,
    blurEditor: vi.fn(),
    selectionController: controller,
  } as unknown as EditableEditorRuntimePort;

  return {
    list,
    text,
    setPointerCapture,
    releasePointerCapture,
    commitSelectionPoint,
    extendSelection,
    requestPresentation,
    focusText,
    acquireBlockContent,
    createTextAnchorInContext,
    releaseSettlementLease,
    nativeFocus,
    resolvePointerHit,
    transientPaintChanged,
    point,
    shell,
    target,
    options: {
      listElement: list,
      blockDom: {} as EditorBlockDomRegistryReader,
      editor,
      contentRuntime,
      selectionController: controller,
      captureStructuralSelection: vi.fn(() => null),
      documentLayerKeyboard: unhandledDocumentLayerKeyboard,
      textGestureArbitration: createEditorTextGestureArbitration(),
      onTransientPointerPaintChange: transientPaintChanged,
    },
    dispose: () => {
      resolvePointerHit.mockRestore();
      list.remove();
    },
  };
}

function installCollapsedNativeSelection(text: Text, offset: number): void {
  const selection = document.getSelection();
  const range = document.createRange();
  range.setStart(text, offset);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function nativePresentationMode(list: HTMLElement) {
  return list.dataset.editorNativeSelectionPaintMode ?? "visible";
}

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

function beginFixtureDrag(
  fixture: ReturnType<typeof pointerGestureFixture>,
  pointerId: number,
): void {
  act(() =>
    fixture.text.dispatchEvent(
      pointerEvent("pointerdown", {
        pointerId,
        clientX: 10,
        clientY: 10,
      }),
    ),
  );
  act(() =>
    document.dispatchEvent(
      pointerEvent("pointermove", {
        pointerId,
        clientX: 20,
        clientY: 10,
      }),
    ),
  );
}

function pointerEvent(
  type: string,
  init: MouseEventInit & { readonly pointerId: number },
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  Object.defineProperty(event, "pointerId", { value: init.pointerId });
  return event as PointerEvent;
}

function gestureFixture({
  composition,
}: {
  readonly composition: object | null;
}) {
  const list = document.createElement("div");
  list.dataset.editorBlockListRoot = "true";
  document.body.append(list);
  const cancel = vi.fn();
  const resetKeyboardNavigation = vi.fn();
  const getEndpointSnapshot = vi.fn(() => ({
    phase: "idle" as const,
    anchor: null,
    focus: null,
  }));
  const captureStructuralSelection = vi.fn(() => null);
  const selectionController = {
    endpoint: { getSnapshot: getEndpointSnapshot },
    getCanonicalSnapshot: () => ({ kind: "none", revision: 0 }),
    getPresentationSnapshot: () => ({ composition }),
    getCommittedSnapshot: () => ({ revision: 2 }),
    readKeyboardNavigation: () => null,
    setKeyboardNavigation: vi.fn(),
    resetKeyboardNavigation,
    clearSelection: cancel,
  } as unknown as SelectionController;
  const blurEditor = vi.fn();
  const transientPaintChanged = vi.fn();
  const editor = {
    ...documentInputRuntimeStub(),
    editable: true,
    blurEditor,
    selectionController,
  } as unknown as EditableEditorRuntimePort;

  return {
    cancel,
    blurEditor,
    getEndpointSnapshot,
    options: {
      listElement: list,
      blockDom: {} as EditorBlockDomRegistryReader,
      editor,
      contentRuntime: {} as EditorWebContentRuntime,
      selectionController,
      captureStructuralSelection,
      documentLayerKeyboard: unhandledDocumentLayerKeyboard,
      textGestureArbitration: createEditorTextGestureArbitration(),
      onTransientPointerPaintChange: transientPaintChanged,
    },
    captureStructuralSelection,
    dispose: () => list.remove(),
  };
}

function documentInputRuntimeStub() {
  return {
    resolveNativeFocusTarget: (target: EventTarget | null) =>
      ({
        kind: "text" as const,
        blockId: (target instanceof HTMLElement
          ? (target.closest<HTMLElement>("[data-editor-block-id]")?.dataset
              .editorBlockId ?? "test-block")
          : "test-block") as BlockId,
        registeredTarget:
          target instanceof HTMLElement ? target : document.body,
      }),
    requestTextPresentation: vi.fn(),
    blurEditor: vi.fn(),
    commands: new Map(),
    keybindings: { block: new Map(), document: new Map() },
    selection: {
      getSnapshot: () => ({ kind: "none" as const, revision: 0 }),
    },
    store: {
      getSnapshot: () => ({
        overlay: { active: false, id: null, blockId: null, anchor: null },
      }),
    },
  };
}

const unhandledDocumentLayerKeyboard = {
  dispatchKeydown: () => "unhandled" as const,
};
