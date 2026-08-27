import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { EditorDocument } from "@repo/editor-web/document-runtime";
import {
  createFirstDraftViewStateStore,
  FirstDraftViewStateProvider,
} from "../view-state.tsx";
import { FirstDraftBlockHoverProvider } from "../../block-controls/index.ts";
import { createFirstDraftEditorDefinition } from "../../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../../first-draft-fixture.ts";
import { initializeTestEditableEditor as initializeEditableEditor } from "../../test-editor.ts";
import {
  createFirstDraftTableActionMenuStore,
  FirstDraftTableActionMenuProvider,
} from "../../table-action-menu/index.ts";

const cellA = "fd-table-cell-1-1" as BlockId;
const cellB = "fd-table-cell-1-2" as BlockId;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("First Draft real table pointer and paint ownership", () => {
  it("routes native table copy, cut, and paste through the mounted internal host", () => {
    const copyFixture = renderTable();
    commitTableRange(copyFixture, 101);
    const copied = new TableClipboardData();
    const copy = tableClipboardEvent("copy", copied);
    act(() => internalSelectionHost(copyFixture).dispatchEvent(copy));
    expect(copy.defaultPrevented).toBe(true);
    expect(copied.values.get("text/plain")).toBeTruthy();
    expect(copied.values.get("text/html")).toContain("<table");
    expect(copyFixture.changes).not.toHaveBeenCalled();
    copyFixture.dispose();

    const cutFixture = renderTable();
    commitTableRange(cutFixture, 102);
    const cutData = new TableClipboardData();
    const cut = tableClipboardEvent("cut", cutData);
    act(() => internalSelectionHost(cutFixture).dispatchEvent(cut));
    expect(cut.defaultPrevented).toBe(true);
    expect(cutData.values.get("text/html")).toContain("<table");
    expect(cutFixture.changes).toHaveBeenCalledOnce();
    cutFixture.dispose();

    const pasteFixture = renderTable();
    commitTableRange(pasteFixture, 103);
    const pasteData = new TableClipboardData();
    pasteData.setData("text/plain", "replacement one\treplacement two");
    const paste = tableClipboardEvent("paste", pasteData);
    act(() => internalSelectionHost(pasteFixture).dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(true);
    expect(pasteData.getDataCalls).toEqual(["text/plain"]);
    expect(pasteFixture.changes).toHaveBeenCalledOnce();
    pasteFixture.dispose();
  });

  it("activates an inactive cell on pointer-down and leaves one native caret on click", () => {
    const fixture = renderTable();
    const modes: string[] = [];
    fixture.editor.selectionController.presentation.subscribe(() => {
      modes.push(
        fixture.editor.selectionController.getPresentationSnapshot()
          .nativeSelectionPaintMode,
      );
    });
    expect(editableRoots(fixture.container)).toHaveLength(0);
    const historyBefore = fixture.editor.canUndo;

    const down = pointerDown(fixture, cellA, 1, "start");

    expect(down.defaultPrevented).toBe(true);
    expect(editableRoots(fixture.container)).toHaveLength(1);
    expect(activeCellId(fixture.container)).toBe(cellA);
    expect(canonical(fixture).snapshot.documentSelection).toMatchObject({
      anchor: { blockId: cellA, textOffset: 0 },
      focus: { blockId: cellA, textOffset: 0 },
    });
    expect(document.getSelection()?.isCollapsed).toBe(true);
    expect(blockList(fixture).dataset.editorNativeSelectionPaintMode).toBe(
      "hidden-for-global-selection",
    );
    expect(
      fixture.container.querySelector(
        '[data-editor-selection-paint="text-fragment"]',
      ),
    ).toBeNull();
    expect(tableRange(fixture.container)).toBeNull();

    pointerUp(fixture, cellA, 1, "start");

    expect(editableRoots(fixture.container)).toHaveLength(1);
    expect(blockList(fixture).dataset.editorNativeSelectionPaintMode).toBe(
      "visible",
    );
    expect(document.activeElement).toBe(editableRoots(fixture.container)[0]);
    expect(fixture.changes).not.toHaveBeenCalled();
    expect(fixture.editor.canUndo).toBe(historyBefore);
    expect(modes).toEqual([
      "hidden-for-global-selection",
      "hidden-for-global-selection",
      "visible",
    ]);
    fixture.dispose();
  });

  it.each([
    { label: "forward", start: "start", end: "end", direction: "forward" },
    { label: "backward", start: "end", end: "start", direction: "backward" },
  ] as const)(
    "settles an inactive-cell $label drag through generic document selection",
    ({ start, end, direction }) => {
      const fixture = renderTable();
      const length = fixture.editor.readBlockPlainText(
        cellA,
        "tableCell",
      ).length;
      const expectedAnchor = start === "start" ? 0 : length;
      const expectedFocus = end === "start" ? 0 : length;

      pointerDown(fixture, cellA, 2, start);
      expect(activeCellId(fixture.container)).toBe(cellA);
      pointerMove(fixture, cellA, 2, end);

      expect(
        fixture.editor.selectionController.getPresentationSnapshot()
          .nativeSelectionPaintMode,
      ).toBe("hidden-for-global-selection");
      expect(blockList(fixture).dataset.editorNativeSelectionPaintMode).toBe(
        "hidden-for-global-selection",
      );
      expect(document.activeElement).toBe(editableRoots(fixture.container)[0]);
      expect(document.getSelection()?.isCollapsed).toBe(true);
      expect(
        fixture.container.querySelectorAll(
          '[data-editor-selection-paint="text-fragment"]',
        ),
      ).toHaveLength(1);
      expect(
        fixture.editor.selectionController.getCanonicalSnapshot().kind,
      ).toBe("document");
      expect(tableRange(fixture.container)).toBeNull();

      pointerUp(fixture, cellA, 2, end);

      const selection = canonical(fixture).snapshot.documentSelection;
      expect(selection).toMatchObject({
        direction,
        anchor: { blockId: cellA, textOffset: expectedAnchor },
        focus: { blockId: cellA, textOffset: expectedFocus },
      });
      expect(
        fixture.editor.selectionController.getPresentationSnapshot()
          .nativeSelectionPaintMode,
      ).toBe("hidden-for-global-selection");
      expect(
        fixture.editor.selectionController.localPaint.getSnapshot(),
      ).toMatchObject({ kind: "range" });
      expect(tableRange(fixture.container)).toBeNull();
      expect(fixture.changes).not.toHaveBeenCalled();
      expect(fixture.editor.canUndo).toBe(false);
      fixture.dispose();
    },
  );

  it("keeps one pointer presentation owner through pending, active drag, and settlement", () => {
    const fixture = renderTable();
    const modes: string[] = [];
    fixture.editor.selectionController.presentation.subscribe(() => {
      modes.push(
        fixture.editor.selectionController.getPresentationSnapshot()
          .nativeSelectionPaintMode,
      );
    });
    pointerDown(fixture, cellA, 20, "start");
    const list = blockList(fixture);

    expect(list.dataset.editorNativeCaretPointerPending).toBe("true");
    expect(list.dataset.editorNativeSelectionPaintMode).toBe(
      "hidden-for-global-selection",
    );
    expect(document.activeElement).toBe(editableRoots(fixture.container)[0]);
    expect(document.getSelection()?.isCollapsed).toBe(true);
    expect(
      fixture.container.querySelector("[data-editor-selection-paint]"),
    ).toBeNull();

    dispatchPointer(
      textRoot(fixture.container, cellA),
      "pointermove",
      20,
      2,
      0,
    );
    expect(list.dataset.editorNativeCaretPointerPending).toBe("true");
    expect(list.dataset.editorNativeSelectionPaintMode).toBe(
      "hidden-for-global-selection",
    );
    expect(
      fixture.container.querySelector("[data-editor-selection-paint]"),
    ).toBeNull();

    pointerMove(fixture, cellA, 20, "end");
    expect(list.dataset.editorNativeSelectionPaintMode).toBe(
      "hidden-for-global-selection",
    );
    expect(list.dataset.editorSelectionPaintVisible).toBe("true");
    expect(document.activeElement).toBe(editableRoots(fixture.container)[0]);
    expect(document.getSelection()?.isCollapsed).toBe(true);
    expect(
      fixture.container.querySelectorAll(
        '[data-editor-selection-paint="text-fragment"]',
      ),
    ).toHaveLength(1);
    expect(tableRange(fixture.container)).toBeNull();

    pointerUp(fixture, cellA, 20, "end");
    expect(list.dataset.editorNativeCaretPointerPending).toBeUndefined();
    expect(list.dataset.editorNativeSelectionPaintMode).toBe(
      "hidden-for-global-selection",
    );
    expect(
      fixture.container.querySelectorAll(
        '[data-editor-selection-paint="text-fragment"]',
      ),
    ).toHaveLength(1);
    expect(
      fixture.editor.selectionController.getPresentationSnapshot()
        .nativeSelectionPaintMode,
    ).toBe("hidden-for-global-selection");
    expect(modes).toEqual([
      "hidden-for-global-selection",
      "hidden-for-global-selection",
      "hidden-for-global-selection",
    ]);
    fixture.dispose();
  });

  it.each([
    { label: "forward", start: "start", end: "end", direction: "forward" },
    { label: "backward", start: "end", end: "start", direction: "backward" },
  ] as const)(
    "uses the same generic $label drag path when the cell is already active",
    ({ start, end, direction }) => {
      const fixture = renderTable();
      pointerClick(fixture, cellA, 3, start);
      const sharedView = editableRoots(fixture.container)[0];

      pointerDown(fixture, cellA, 4, start);
      pointerMove(fixture, cellA, 4, end);
      expect(blockList(fixture).dataset.editorNativeSelectionPaintMode).toBe(
        "hidden-for-global-selection",
      );
      expect(document.activeElement).toBe(sharedView);
      expect(document.getSelection()?.isCollapsed).toBe(true);
      pointerUp(fixture, cellA, 4, end);

      expect(editableRoots(fixture.container)).toEqual([sharedView]);
      expect(canonical(fixture).snapshot.documentSelection).toMatchObject({
        direction,
        anchor: { blockId: cellA },
        focus: { blockId: cellA },
      });
      expect(
        fixture.editor.selectionController.localPaint.getSnapshot(),
      ).toMatchObject({ kind: "range" });
      expect(tableRange(fixture.container)).toBeNull();
      fixture.dispose();
    },
  );

  it("moves the one shared view to an inactive cell without losing the anchor", () => {
    const fixture = renderTable();
    pointerClick(fixture, cellA, 5, "start");
    const sharedView = editableRoots(fixture.container)[0];

    pointerDown(fixture, cellB, 6, "start");
    expect(editableRoots(fixture.container)).toEqual([sharedView]);
    expect(activeCellId(fixture.container)).toBe(cellB);
    expect(permanentTextRoot(fixture.container, cellA)).not.toBeNull();
    pointerMove(fixture, cellB, 6, "end");
    pointerUp(fixture, cellB, 6, "end");

    expect(canonical(fixture).snapshot.documentSelection).toMatchObject({
      direction: "forward",
      anchor: { blockId: cellB, textOffset: 0 },
      focus: { blockId: cellB },
    });
    expect(editableRoots(fixture.container)).toEqual([sharedView]);
    fixture.dispose();
  });

  it("promotes once to table ownership and cannot restore canceled text paint", () => {
    const fixture = renderTable();
    const modes: string[] = [];
    fixture.editor.selectionController.presentation.subscribe(() => {
      modes.push(
        fixture.editor.selectionController.getPresentationSnapshot()
          .nativeSelectionPaintMode,
      );
    });
    pointerDown(fixture, cellA, 7, "start");
    pointerMove(fixture, cellA, 7, "end");
    expect(blockList(fixture).dataset.editorNativeSelectionPaintMode).toBe(
      "hidden-for-global-selection",
    );

    pointerMove(fixture, cellB, 7, "start");

    expect(fixture.editor.selectionController.getCanonicalSnapshot().kind).toBe(
      "block-internal",
    );
    expect(
      fixture.container.querySelector(
        '[data-editor-selection-paint="text-fragment"]',
      ),
    ).toBeNull();
    expect(
      document.getSelection()?.rangeCount === 0 ||
        document.getSelection()?.isCollapsed,
    ).toBe(true);
    expect(tableRange(fixture.container)).not.toBeNull();
    expect(modes).toEqual([
      "hidden-for-global-selection",
      "hidden-for-global-selection",
      "hidden-for-global-selection",
    ]);
    expect(
      fixture.editor.selectionController.getPresentationSnapshot()
        .nativeSelectionPaintMode,
    ).toBe("hidden-for-global-selection");
    expect(document.activeElement).not.toBe(
      editableRoots(fixture.container)[0],
    );
    expect(
      fixture.container.querySelectorAll('[data-table-selection-kind="local"]')
        .length,
    ).toBeGreaterThan(0);

    pointerMove(fixture, cellA, 7, "start");
    pointerMove(fixture, cellB, 7, "start");
    pointerUp(fixture, cellB, 7, "start");

    expect(fixture.editor.selectionController.getCanonicalSnapshot().kind).toBe(
      "block-internal",
    );
    expect(
      fixture.container.querySelector(
        '[data-editor-selection-paint="text-fragment"]',
      ),
    ).toBeNull();
    expect(tableRange(fixture.container)).not.toBeNull();
    fixture.dispose();
  });

  it("rejects a divergent native range without canonical revision churn", () => {
    const fixture = renderTable();
    pointerClick(fixture, cellA, 8, "start");
    const before = fixture.editor.selectionController.getCanonicalSnapshot();
    const publications = vi.fn();
    fixture.editor.selectionController.subscribeStandaloneSettlements(
      publications,
    );
    const root = editableRoots(fixture.container)[0]!;
    const text = firstText(root);
    if (!text) throw new Error("Missing active cell text");
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, Math.min(2, text.length));
    document.getSelection()?.removeAllRanges();
    document.getSelection()?.addRange(range);

    act(() => document.dispatchEvent(new Event("selectionchange")));

    expect(fixture.editor.selectionController.getCanonicalSnapshot()).toBe(
      before,
    );
    expect(publications).not.toHaveBeenCalled();
    expect(document.getSelection()?.isCollapsed).toBe(true);
    fixture.dispose();
  });

  it("acknowledges the editor-projected native range without a second settlement", () => {
    const fixture = renderTable();
    pointerDown(fixture, cellA, 21, "start");
    pointerMove(fixture, cellA, 21, "end");
    pointerUp(fixture, cellA, 21, "end");
    const before = fixture.editor.selectionController.getCanonicalSnapshot();
    const publications = vi.fn();
    fixture.editor.selectionController.subscribeStandaloneSettlements(
      publications,
    );

    act(() => document.dispatchEvent(new Event("selectionchange")));

    expect(fixture.editor.selectionController.getCanonicalSnapshot()).toBe(
      before,
    );
    expect(publications).not.toHaveBeenCalled();
    expect(
      fixture.container.querySelectorAll(
        '[data-editor-selection-paint="text-fragment"]',
      ),
    ).toHaveLength(1);
    expect(tableRange(fixture.container)).toBeNull();
    fixture.dispose();
  });

  it.each(["pointercancel", "Escape", "lostpointercapture", "unmount"])(
    "releases pending table text resources on %s",
    (terminal) => {
      const fixture = renderTable();
      pointerDown(fixture, cellA, 22, "start");
      pointerMove(fixture, cellA, 22, "end");
      const list = blockList(fixture);
      expect(list.dataset.editorNativeSelectionPaintMode).toBe(
        "hidden-for-global-selection",
      );

      act(() => {
        if (terminal === "pointercancel") {
          document.dispatchEvent(pointerEvent("pointercancel", 22, "end"));
        } else if (terminal === "Escape") {
          editableRoots(fixture.container)[0]!.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              key: "Escape",
            }),
          );
        } else if (terminal === "lostpointercapture") {
          list.dispatchEvent(pointerEvent("lostpointercapture", 22, "end"));
        } else {
          fixture.unmount();
        }
      });

      expect(list.dataset.editorNativeSelectionPaintMode).not.toBe(
        "hidden-for-global-selection",
      );
      expect(list.dataset.editorSelectionPaintVisible).toBeUndefined();
      if (terminal !== "unmount") {
        expect(list.dataset.editorNativeCaretPointerPending).toBeUndefined();
        expect(document.activeElement).toBe(
          editableRoots(fixture.container)[0],
        );
        expect(document.getSelection()?.isCollapsed).toBe(true);
        expect(
          fixture.container.querySelector("[data-editor-selection-paint]"),
        ).toBeNull();
      }
      fixture.dispose();
    },
  );

  it("leaves the collapsed caret and composition native-owned, then transfers Shift range paint", () => {
    const fixture = renderTable();
    pointerClick(fixture, cellA, 9, "start");
    const root = editableRoots(fixture.container)[0]!;

    const arrow = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowRight",
    });
    act(() => root.dispatchEvent(arrow));
    expect(fixture.editor.selectionController.localPaint.getSnapshot()).toEqual(
      { kind: "none" },
    );
    const caretAfterArrow = canonical(fixture).snapshot.documentSelection.focus;
    if (!caretAfterArrow) throw new Error("Missing native caret mirror");
    expect(canonical(fixture).snapshot.documentSelection.anchor).toMatchObject({
      blockId: cellA,
      textOffset: caretAfterArrow.textOffset,
    });

    const compositionStart = new CompositionEvent("compositionstart", {
      bubbles: true,
      cancelable: true,
    });
    act(() => root.dispatchEvent(compositionStart));
    expect(
      fixture.editor.selectionController.getPresentationSnapshot().composition,
    ).not.toBeNull();
    expect(tableRange(fixture.container)).toBeNull();
    expect(
      fixture.container.querySelector("[data-editor-selection-paint]"),
    ).toBeNull();
    act(() =>
      root.dispatchEvent(
        new CompositionEvent("compositionend", {
          bubbles: true,
          cancelable: true,
        }),
      ),
    );

    expect(fireEvent.keyDown(root, { key: "ArrowRight", shiftKey: true })).toBe(
      false,
    );
    expect(canonical(fixture).snapshot.documentSelection).toMatchObject({
      anchor: { blockId: cellA, textOffset: caretAfterArrow.textOffset },
      focus: { blockId: cellA, textOffset: caretAfterArrow.textOffset + 1 },
    });
    expect(
      fixture.editor.selectionController.localPaint.getSnapshot(),
    ).toMatchObject({ kind: "range" });
    expect(tableRange(fixture.container)).toBeNull();
    fixture.dispose();
  });
});

function renderTable() {
  const changes = vi.fn();
  const viewState = createFirstDraftViewStateStore();
  const editor = initializeEditableEditor({
    definition: createFirstDraftEditorDefinition(viewState),
    snapshot: createFirstDraftSnapshot(),
    onChange: changes,
  });
  const rendered = render(
    <FirstDraftViewStateProvider store={viewState}>
      <FirstDraftTableActionMenuProvider
        store={createFirstDraftTableActionMenuStore()}
      >
        <FirstDraftBlockHoverProvider enabled>
          <EditorDocument editor={editor} />
        </FirstDraftBlockHoverProvider>
      </FirstDraftTableActionMenuProvider>
    </FirstDraftViewStateProvider>,
  );
  const list = rendered.container.querySelector<HTMLElement>(
    '[data-editor-block-list-root="true"]',
  );
  const grid =
    rendered.container.querySelector<HTMLElement>("[data-table-grid]");
  if (!list || !grid) throw new Error("Missing table pointer surface");
  installPointerCapture(list);
  installPointerCapture(grid);
  for (const cellId of [cellA, cellB])
    installCellGeometry(rendered.container, cellId);
  const originalRects = Object.getOwnPropertyDescriptor(
    Range.prototype,
    "getClientRects",
  );
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: vi.fn(() => [rect(0, 10, 100, 20)]),
  });
  return {
    ...rendered,
    editor,
    changes,
    dispose() {
      if (originalRects)
        Object.defineProperty(Range.prototype, "getClientRects", originalRects);
      else Reflect.deleteProperty(Range.prototype, "getClientRects");
      rendered.unmount();
      editor.dispose();
    },
  };
}

type Fixture = ReturnType<typeof renderTable>;
type Edge = "start" | "end";

function pointerDown(
  fixture: Fixture,
  cellId: BlockId,
  pointerId: number,
  edge: Edge,
) {
  const target = textRoot(fixture.container, cellId);
  const event = pointerEvent("pointerdown", pointerId, edge);
  act(() => target.dispatchEvent(event));
  installCellGeometry(fixture.container, cellId);
  return event;
}

function pointerMove(
  fixture: Fixture,
  cellId: BlockId,
  pointerId: number,
  edge: Edge,
) {
  const target = textRoot(fixture.container, cellId);
  act(() => target.dispatchEvent(pointerEvent("pointermove", pointerId, edge)));
}

function pointerUp(
  fixture: Fixture,
  cellId: BlockId,
  pointerId: number,
  edge: Edge,
) {
  const target = textRoot(fixture.container, cellId);
  act(() => target.dispatchEvent(pointerEvent("pointerup", pointerId, edge)));
}

function pointerClick(
  fixture: Fixture,
  cellId: BlockId,
  pointerId: number,
  edge: Edge,
) {
  pointerDown(fixture, cellId, pointerId, edge);
  pointerUp(fixture, cellId, pointerId, edge);
}

function pointerEvent(type: string, pointerId: number, edge: Edge) {
  return pointerEventAt(
    type,
    pointerId,
    edge === "start" ? 0 : 20,
    edge === "start" ? 0 : 40,
  );
}

function pointerEventAt(
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    buttons: { value: type === "pointerup" ? 0 : 1 },
  });
  return event as PointerEvent;
}

function dispatchPointer(
  target: HTMLElement,
  type: string,
  pointerId: number,
  clientX: number,
  clientY: number,
) {
  act(() =>
    target.dispatchEvent(pointerEventAt(type, pointerId, clientX, clientY)),
  );
}

function installPointerCapture(element: HTMLElement) {
  let captured: number | null = null;
  Object.defineProperties(element, {
    setPointerCapture: {
      configurable: true,
      value: vi.fn((pointerId: number) => {
        captured = pointerId;
      }),
    },
    hasPointerCapture: {
      configurable: true,
      value: vi.fn((pointerId: number) => captured === pointerId),
    },
    releasePointerCapture: {
      configurable: true,
      value: vi.fn((pointerId: number) => {
        if (captured === pointerId) captured = null;
      }),
    },
  });
}

function installCellGeometry(container: HTMLElement, cellId: BlockId) {
  const cell = cellElement(container, cellId);
  const bounds = rect(0, 10, 100, 20);
  cell.getBoundingClientRect = () => bounds;
  for (const root of cell.querySelectorAll<HTMLElement>(
    '[data-editor-text-root="true"]',
  ))
    root.getBoundingClientRect = () => bounds;
}

function rect(left: number, top: number, width: number, height: number) {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect;
}

function cellElement(container: HTMLElement, cellId: BlockId) {
  const cell = container.querySelector<HTMLElement>(
    `[data-table-cell-id="${cellId}"]`,
  );
  if (!cell) throw new Error(`Missing table cell ${cellId}`);
  return cell;
}

function textRoot(container: HTMLElement, cellId: BlockId) {
  const root = cellElement(container, cellId).querySelector<HTMLElement>(
    '[data-editor-text-root="true"]',
  );
  if (!root) throw new Error(`Missing text root ${cellId}`);
  return root;
}

function permanentTextRoot(container: HTMLElement, cellId: BlockId) {
  return cellElement(container, cellId).querySelector<HTMLElement>(
    '[data-editor-text-root="true"]:not([contenteditable="true"])',
  );
}

function editableRoots(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(".ProseMirror")];
}

function activeCellId(container: HTMLElement) {
  return editableRoots(container)[0]
    ?.closest<HTMLElement>("[data-table-cell-id]")
    ?.getAttribute("data-table-cell-id");
}

function blockList(fixture: Fixture) {
  return fixture.container.querySelector<HTMLElement>(
    '[data-editor-block-list-root="true"]',
  )!;
}

function canonical(fixture: Fixture) {
  const selection = fixture.editor.selectionController.getCanonicalSnapshot();
  if (selection.kind !== "document")
    throw new Error("Expected canonical document selection");
  return selection;
}

function tableRange(container: HTMLElement) {
  return container.querySelector('[data-table-selection-type="cell-range"]');
}

function commitTableRange(fixture: Fixture, pointerId: number): void {
  pointerDown(fixture, cellA, pointerId, "start");
  pointerMove(fixture, cellA, pointerId, "end");
  pointerMove(fixture, cellB, pointerId, "start");
  pointerUp(fixture, cellB, pointerId, "start");
  expect(
    fixture.editor.selectionController.getCanonicalSnapshot().kind,
  ).toBe("block-internal");
}

function internalSelectionHost(fixture: Fixture): HTMLElement {
  const host = fixture.container.querySelector<HTMLElement>(
    '[data-editor-block-internal-selection-host="true"]',
  );
  if (!host) throw new Error("Missing mounted table internal selection host");
  return host;
}

class TableClipboardData {
  readonly values = new Map<string, string>();
  readonly getDataCalls: string[] = [];

  setData(format: string, value: string): void {
    this.values.set(format, value);
  }

  getData(format: string): string {
    this.getDataCalls.push(format);
    return this.values.get(format) ?? "";
  }
}

function tableClipboardEvent(
  type: "copy" | "cut" | "paste",
  clipboardData: TableClipboardData,
): ClipboardEvent {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, "clipboardData", { value: clipboardData });
  return event as ClipboardEvent;
}

function firstText(root: HTMLElement): Text | null {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
  );
  return walker.nextNode() as Text | null;
}
