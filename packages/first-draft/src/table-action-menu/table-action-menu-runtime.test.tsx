import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { domPointerDragActiveAttribute } from "@mk-drag-and-drop/react";
import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import type { EditorStableSelection } from "@repo/editor-web/document-runtime";
import type { EditorSemanticChange } from "@repo/editor-web/editor";
import { EditorDocument } from "@repo/editor-web/document-runtime";
import { FirstDraftBlockHoverProvider } from "../block-controls/index.ts";
import { createFirstDraftEditorDefinition } from "../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../first-draft-fixture.ts";
import {
  initializeTestEditableEditor as initializeEditableEditor,
  type FirstDraftTestEditor,
} from "../test-editor.ts";
import {
  createFirstDraftViewStateStore,
  FirstDraftViewStateProvider,
} from "../blocks/view-state.tsx";
import {
  resolveFirstDraftTableColumnIds,
  TABLE_COLUMN_IDS_FIELD,
  TABLE_COLUMN_WIDTHS_FIELD,
} from "../blocks/table/model.ts";
import {
  deleteFirstDraftTableColumn,
  deleteFirstDraftTableRow,
  insertFirstDraftTableColumn,
  insertFirstDraftTableRow,
  moveFirstDraftTableColumn,
  moveFirstDraftTableRow,
} from "../blocks/table/mutations.ts";
import {
  EDITOR_BLOCK_DND_GROUP,
  captureFirstDraftDocumentBlockDragSession,
  createFirstDraftBlockPlacementRegistry,
} from "../block-drag-and-drop/index.ts";
import {
  TABLE_COLUMN_DND_GROUP,
  TABLE_ROW_DND_GROUP,
  createFirstDraftTableDragStore,
} from "../table-drag-and-drop/index.ts";
import {
  createFirstDraftTableActionMenuStore,
  FirstDraftTableActionMenuProvider,
} from "./store.tsx";
import { FirstDraftTableActionMenuLayer } from "./table-action-menu-layer.tsx";
import { dispatchFirstDraftTableAction } from "./dispatch.ts";
import { attachFirstDraftPresence } from "../transport/presence-client.ts";
import type { FirstDraftMessageDispatcher } from "../transport/collaboration-connection.ts";
import {
  decodeFirstDraftMessage,
  type FirstDraftServerMessage,
} from "../transport/message-protocol.ts";
import { convertEditorTransactionToTransport } from "../transport/editor-transaction-to-transport.ts";
import { createFirstDraftOutboundPublisher } from "../transport/outbound-publisher.ts";

const tableId = "fd-table" as BlockId;
const rowId = "fd-table-row-1" as BlockId;
const cellId = "fd-table-cell-1-1" as BlockId;
const defaultTableTrackWidths = [208, 208, 208] as const;
const defaultGridWidth = defaultTableTrackWidths.reduce(
  (total, width) => total + width,
  0,
);

let animationFrames: FrameRequestCallback[];
let rowTriggerLeft: number;
let objectBounds: DOMRect;
let scrollBounds: DOMRect;
let gridBounds: DOMRect;
let rowBounds: Map<string, DOMRect>;
let documentScrollBounds: DOMRect;
let elementBounds: WeakMap<HTMLElement, DOMRect>;
let menuBounds: DOMRect;

beforeEach(() => {
  animationFrames = [];
  rowTriggerLeft = 76;
  objectBounds = domRect(0, 0, 800, 260);
  scrollBounds = domRect(0, 0, 800, 220);
  gridBounds = domRect(100, 40, defaultGridWidth, 160);
  rowBounds = new Map();
  documentScrollBounds = domRect(0, 0, 800, 600);
  elementBounds = new WeakMap();
  menuBounds = domRect(0, 0, 208, 150);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const bounds = elementBounds.get(this);
      if (bounds) return bounds;
      if (this.classList.contains("first-draft-example__document-scroll")) {
        return documentScrollBounds;
      }
      if (this.classList.contains("table-block__object")) {
        return objectBounds;
      }
      if (this.classList.contains("table-block__scroll")) {
        return scrollBounds;
      }
      if (this.classList.contains("table-block__chrome-anchor")) {
        const scroll = this.parentElement?.classList.contains(
          "table-block__scroll",
        )
          ? this.parentElement
          : null;
        return domRect(
          gridBounds.left - (scroll?.scrollLeft ?? 0),
          objectBounds.top + 8,
          renderedGridWidth(this, gridBounds.width),
          scrollBounds.height,
        );
      }
      if (this.classList.contains("first-draft-block-controls")) {
        const anchorRect = this.parentElement?.getBoundingClientRect();
        const blockOffset = Number.parseFloat(
          this.style.getPropertyValue(
            "--first-draft-block-controls-inset-block-start",
          ),
        );
        return domRect(
          (anchorRect?.left ?? 0) - 56,
          (anchorRect?.top ?? 0) +
            (Number.isFinite(blockOffset) ? blockOffset : 0),
          56,
          28,
        );
      }
      if (this.classList.contains("table-block__grid")) {
        return domRect(
          gridBounds.left,
          gridBounds.top,
          renderedGridWidth(this, gridBounds.width),
          gridBounds.height,
        );
      }
      if (this.classList.contains("table-block__row")) {
        const currentRowId = this.dataset.tableRowId ?? "";
        const visualRows = [
          ...(this.closest(".table-block__grid")?.querySelectorAll<HTMLElement>(
            ".table-block__row",
          ) ?? []),
        ];
        const visualIndex = Math.max(0, visualRows.indexOf(this));
        return (
          rowBounds.get(currentRowId) ??
          domRect(
            gridBounds.left,
            gridBounds.top + visualIndex * 40,
            renderedGridWidth(this, gridBounds.width),
            40,
          )
        );
      }
      if (this.classList.contains("table-block__cell")) {
        const row = this.closest<HTMLElement>(".table-block__row");
        const rowRect = row?.getBoundingClientRect() ?? gridBounds;
        const columnIndex = Number(this.dataset.tableColumnIndex ?? 0);
        const widths = renderedTrackWidths(this);
        const width = widths[columnIndex] ?? defaultTableTrackWidths[0];
        const left =
          gridBounds.left +
          widths
            .slice(0, columnIndex)
            .reduce((total, current) => total + current, 0);
        return domRect(left, rowRect.top, width, rowRect.height);
      }
      if (this.dataset.tableRowCarrier) {
        const lane = this.parentElement;
        const laneLeft = Number.parseFloat(lane?.style.left ?? "");
        const laneTop = Number.parseFloat(lane?.style.top ?? "");
        const width = Number.parseFloat(this.style.width);
        const height = Number.parseFloat(this.style.height);
        let precedingHeight = 0;
        for (const sibling of [...(lane?.children ?? [])]) {
          if (sibling === this) break;
          precedingHeight += Number.parseFloat(
            (sibling as HTMLElement).style.height,
          );
        }
        return domRect(
          objectBounds.left +
            (Number.isFinite(laneLeft)
              ? laneLeft
              : gridBounds.left - objectBounds.left),
          objectBounds.top +
            (Number.isFinite(laneTop)
              ? laneTop
              : gridBounds.top - objectBounds.top) +
            precedingHeight,
          Number.isFinite(width)
            ? width
            : renderedGridWidth(this, gridBounds.width),
          Number.isFinite(height) ? height : 40,
        );
      }
      if (this.dataset.tableColumnCarrier) {
        const lane = this.parentElement;
        const laneLeft = Number.parseFloat(lane?.style.left ?? "");
        const laneTop = Number.parseFloat(lane?.style.top ?? "");
        const width = Number.parseFloat(this.style.width);
        const height = Number.parseFloat(this.style.height);
        let precedingWidth = 0;
        for (const sibling of [...(lane?.children ?? [])]) {
          if (sibling === this) break;
          precedingWidth += Number.parseFloat(
            (sibling as HTMLElement).style.width,
          );
        }
        return domRect(
          objectBounds.left +
            (Number.isFinite(laneLeft)
              ? laneLeft
              : gridBounds.left - objectBounds.left) +
            precedingWidth,
          objectBounds.top +
            (Number.isFinite(laneTop)
              ? laneTop
              : gridBounds.top - objectBounds.top),
          Number.isFinite(width) ? width : 176,
          Number.isFinite(height) ? height : gridBounds.height,
        );
      }
      if (this.classList.contains("first-draft-table-action-menu")) {
        return menuBounds;
      }
      if (
        this.classList.contains("table-block__row-drag-overlay") ||
        this.classList.contains("table-block__column-drag-overlay")
      ) {
        const wrapper = this.parentElement;
        const [translateX, translateY] = readTranslate3d(
          wrapper?.style.transform ?? "",
        );
        const left = Number.parseFloat(wrapper?.style.left ?? "0");
        const top = Number.parseFloat(wrapper?.style.top ?? "0");
        return domRect(
          (Number.isFinite(left) ? left : 0) + translateX,
          (Number.isFinite(top) ? top : 0) + translateY,
          Number.parseFloat(this.style.width),
          Number.parseFloat(this.style.height),
        );
      }
      if (
        this.classList.contains("table-block__row-drag-overlay-body") ||
        this.classList.contains("table-block__column-drag-overlay-body")
      ) {
        return this.parentElement?.getBoundingClientRect() ?? domRect(0, 0, 0, 0);
      }
      if (this.classList.contains("table-block__row-drag-overlay-trigger")) {
        const overlay = this.parentElement?.getBoundingClientRect();
        return domRect(
          (overlay?.left ?? 0) - 20,
          overlay?.top ?? 0,
          16,
          overlay?.height ?? 0,
        );
      }
      if (
        this.classList.contains("table-block__column-drag-overlay-trigger")
      ) {
        const overlay = this.parentElement?.getBoundingClientRect();
        return domRect(
          overlay?.left ?? 0,
          (overlay?.top ?? 0) - 20,
          overlay?.width ?? 0,
          16,
        );
      }
      if (this.dataset.tableActionTriggerAxis === "row") {
        const zone = this.parentElement;
        const carrierRect = zone?.parentElement?.getBoundingClientRect();
        const top = Number.parseFloat(zone?.style.top ?? "");
        const height = Number.parseFloat(zone?.style.height ?? "");
        return domRect(
          rowTriggerLeft,
          (carrierRect?.top ?? 0) + (Number.isFinite(top) ? top : 0),
          16,
          Number.isFinite(height) ? height : 40,
        );
      }
      if (this.dataset.tableActionTriggerAxis === "column") {
        const zone = this.parentElement;
        const carrier = zone?.parentElement;
        const carrierRect = carrier?.getBoundingClientRect();
        const left = Number.parseFloat(zone?.style.left ?? "");
        const top = Number.parseFloat(zone?.style.top ?? "");
        const width = Number.parseFloat(zone?.style.width ?? "");
        return domRect(
          (carrierRect?.left ?? 0) + (Number.isFinite(left) ? left : 0),
          (carrierRect?.top ?? 0) + (Number.isFinite(top) ? top : 0),
          Number.isFinite(width) ? width : 208,
          16,
        );
      }
      return domRect(0, 0, 0, 0);
    },
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("First Draft table action controls in the real editable runtime", () => {
  it("keeps one stable inner table scroller beside the projected control overlay", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const rootShell = fixture.container.querySelector<HTMLElement>(
      '.editor-web-block-list > .editor-web-block[data-editor-root-layout="full"][data-editor-block-type="table"]',
    );
    if (!rootShell) throw new Error("Missing root table block shell");
    const tableScrolls = rootShell.querySelectorAll<HTMLElement>(
      ".table-block__scroll",
    );
    expect(tableScrolls).toHaveLength(1);
    const tableScroll = tableScrolls[0]!;
    const object = rootShell.querySelector<HTMLElement>(
      ".table-block__object",
    )!;
    fireEvent.pointerMove(object);
    const chromeAnchor = tableScroll.querySelector<HTMLElement>(
      ":scope > .table-block__chrome-anchor",
    )!;
    const frame = tableScroll.querySelector<HTMLElement>(
      ":scope > .table-block__frame",
    )!;
    const blockControls = chromeAnchor.querySelector<HTMLElement>(
      ".first-draft-block-controls",
    )!;
    const addBlock = blockControls.querySelector<HTMLButtonElement>(
      'button[aria-label="Add block below"]',
    )!;
    const blockDragHandle = blockControls.querySelector<HTMLButtonElement>(
      'button[aria-label="Drag block or open block actions"]',
    )!;
    const overlay = object.querySelector<HTMLElement>(
      ":scope > .table-block__action-control-overlay",
    )!;
    const rowLane = overlay.querySelector<HTMLElement>(
      ".table-block__row-carrier-lane",
    )!;
    const columnLane = overlay.querySelector<HTMLElement>(
      ".table-block__column-carrier-lane",
    )!;

    expect(rootShell.dataset.editorRootLayout).toBe("full");
    expect(rootShell.dataset.editorBlockType).toBe("table");
    expect(tableScroll.parentElement).toBe(object);
    expect(chromeAnchor.parentElement).toBe(tableScroll);
    expect(frame.parentElement).toBe(tableScroll);
    expect(frame.contains(chromeAnchor)).toBe(false);
    expect(chromeAnchor.closest(".table-block__grid")).toBeNull();
    expect(chromeAnchor.closest(".table-block__row")).toBeNull();
    expect(chromeAnchor.closest(".table-block__cell")).toBeNull();
    expect(chromeAnchor.closest(".table-block__action-control-overlay")).toBeNull();
    expect(chromeAnchor.closest("[data-table-row-carrier]")).toBeNull();
    expect(chromeAnchor.closest("[data-table-column-carrier]")).toBeNull();
    expect(blockControls.querySelectorAll("button")).toHaveLength(2);
    expect(blockDragHandle.dataset.firstDraftDraggableBlockId).toBe(tableId);
    expect(overlay.parentElement).toBe(object);
    expect(overlay.contains(tableScroll)).toBe(false);
    expect(rowLane.parentElement).toBe(overlay);
    expect(columnLane.parentElement).toBe(overlay);
    expect(overlay.querySelectorAll("[data-table-row-carrier]")).toHaveLength(
      fixture.editor.getChildBlockIds(tableId).length,
    );
    expect(
      overlay.querySelectorAll("[data-table-column-carrier]"),
    ).toHaveLength(resolveColumnIds(fixture.editor).length);

    const initialControlsRect = blockControls.getBoundingClientRect();
    tableScroll.scrollLeft = 96;
    fireEvent.scroll(tableScroll);
    flushAnimationFrames();
    const scrolledControlsRect = blockControls.getBoundingClientRect();
    expect(scrolledControlsRect.left).toBe(initialControlsRect.left - 96);
    expect(scrolledControlsRect.top).toBe(initialControlsRect.top);
    expect(chromeAnchor.isConnected).toBe(true);
    expect(blockControls.isConnected).toBe(true);
    expect(addBlock.isConnected).toBe(true);
    expect(blockDragHandle.isConnected).toBe(true);
    expect(rootShell.scrollLeft).toBe(0);
    expect(fixture.onChange).not.toHaveBeenCalled();

    tableScroll.scrollLeft = 0;
    fireEvent.scroll(tableScroll);
    flushAnimationFrames();
    expect(blockControls.getBoundingClientRect()).toMatchObject({
      left: initialControlsRect.left,
      top: initialControlsRect.top,
    });

    const source = trigger(fixture.container, "column", 0);
    fireEvent(source, tablePointerEvent("pointerdown", 30, 110));
    fireEvent(window, tablePointerEvent("pointermove", 30, 520));
    flushAnimationFrames();

    expect(
      fixture.container.querySelector(
        '.editor-web-block-list > .editor-web-block[data-editor-root-layout="full"][data-editor-block-type="table"]',
      ),
    ).toBe(rootShell);
    expect(rootShell.querySelector(".table-block__scroll")).toBe(tableScroll);
    expect(tableScroll.querySelector(":scope > .table-block__chrome-anchor")).toBe(
      chromeAnchor,
    );
    expect(chromeAnchor.querySelector(".first-draft-block-controls")).toBe(
      blockControls,
    );
    expect(blockControls.querySelector('button[aria-label="Add block below"]')).toBe(
      addBlock,
    );
    expect(blockControls.querySelector('button[aria-label="Drag block or open block actions"]')).toBe(
      blockDragHandle,
    );
    expect(
      object.querySelector(":scope > .table-block__action-control-overlay"),
    ).toBe(overlay);
    expect(overlay.querySelector(".table-block__row-carrier-lane")).toBe(
      rowLane,
    );
    expect(overlay.querySelector(".table-block__column-carrier-lane")).toBe(
      columnLane,
    );

    fireEvent(window, tablePointerEvent("pointercancel", 30, 520));

    tableScroll.scrollLeft = 32;
    fireEvent.scroll(tableScroll);
    flushAnimationFrames();
    const boundary = activeDragBoundary(fixture.container);
    fireEvent(blockDragHandle, tablePointerEvent("pointerdown", 20, 20));
    fireEvent(window, tablePointerEvent("pointerup", 20, 20));
    expect(boundary.hasAttribute("data-first-draft-active-drag-group")).toBe(
      false,
    );
    fireEvent(blockDragHandle, tablePointerEvent("pointerdown", 20, 20));
    fireEvent(window, tablePointerEvent("pointermove", 20, 26));
    expect(boundary.dataset.firstDraftActiveDragGroup).toBe(
      EDITOR_BLOCK_DND_GROUP,
    );
    expect(blockDragHandle.dataset.firstDraftDraggableBlockId).toBe(tableId);
    expect(addBlock.isConnected).toBe(true);
    expect(blockDragHandle.isConnected).toBe(true);
    expect(fixture.onChange).not.toHaveBeenCalled();
    fireEvent(window, tablePointerEvent("pointercancel", 20, 26));
    expect(boundary.hasAttribute("data-first-draft-active-drag-group")).toBe(
      false,
    );
    fixture.dispose();
  });

  it("keeps column and row handle centers inside autoscroll cross-axis bounds", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const columnTrigger = fixture.container.querySelector<HTMLElement>(
      '[data-table-action-trigger-axis="column"]',
    )!;
    const rowTrigger = fixture.container.querySelector<HTMLElement>(
      '[data-table-action-trigger-axis="row"]',
    )!;
    const tableScroll = fixture.container.querySelector<HTMLElement>(
      ".table-block__scroll",
    )!;
    const documentScroll = fixture.container.querySelector<HTMLElement>(
      ".first-draft-example__document-scroll",
    )!;
    const columnRect = columnTrigger.getBoundingClientRect();
    const tableRect = tableScroll.getBoundingClientRect();
    const rowRect = rowTrigger.getBoundingClientRect();
    const documentRect = documentScroll.getBoundingClientRect();
    const columnCenterY = columnRect.top + columnRect.height / 2;
    const rowCenterX = rowRect.left + rowRect.width / 2;
    expect(columnCenterY).toBeGreaterThanOrEqual(tableRect.top);
    expect(columnCenterY).toBeLessThanOrEqual(tableRect.bottom);
    expect(rowCenterX).toBeGreaterThanOrEqual(documentRect.left);
    expect(rowCenterX).toBeLessThanOrEqual(documentRect.right);
  });

  it("mounts one normal-flow full-height carrier for every logical row", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const canonicalRows = fixture.editor.getChildBlockIds(tableId);
    const carriers = [
      ...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-row-carrier]",
      ),
    ];
    expect(carriers.map((carrier) => carrier.dataset.tableRowCarrier)).toEqual(
      canonicalRows,
    );
    expect(carriers.map((carrier) => carrier.style.height)).toEqual(
      canonicalRows.map(() => "40px"),
    );
    expect(carriers.map((carrier) => carrier.style.width)).toEqual(
      canonicalRows.map(() => "624px"),
    );
    expect(carriers.every((carrier) => carrier.style.top === "")).toBe(true);
    for (const [index, carrier] of carriers.entries()) {
      expect(carrier.classList.contains("table-block__carrier--debug")).toBe(
        false,
      );
      expect(carrier.getBoundingClientRect()).toMatchObject({
        left: 100,
        top: 40 + index * 40,
        width: 624,
        height: 40,
      });
      expect(
        trigger(fixture.container, "row", index).closest(
          "[data-table-row-carrier]",
        ),
      ).toBeNull();
      expect(
        trigger(fixture.container, "row", index).hasAttribute(
          "data-dnd-drag-handle",
        ),
      ).toBe(false);
      const rowZoneStyle = zone(fixture.container, "row", index).style;
      expect({
        left: rowZoneStyle.left,
        top: rowZoneStyle.top,
        width: rowZoneStyle.width,
        height: rowZoneStyle.height,
      }).toEqual({
        left: "80px",
        top: `${40 + index * 40}px`,
        width: "20px",
        height: "40px",
      });
      expect(carrier.children).toHaveLength(0);
      expect(
        carrier.querySelector(
          "button, [data-dnd-drag-handle], [data-editor-block-id], [data-table-cell-id]",
        ),
      ).toBeNull();
      expect(carrier.textContent).toBe("");
    }
    fixture.dispose();
  });

  it("mounts one full-size normal-flow horizontal carrier per logical column", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const canonicalColumnIds = resolveColumnIds(fixture.editor);
    const rowCarrier = fixture.container.querySelector<HTMLElement>(
      "[data-table-row-carrier]",
    );
    const carriers = [
      ...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-column-carrier]",
      ),
    ];
    expect(carriers).toHaveLength(canonicalColumnIds.length);
    expect(
      carriers.map((carrier) => carrier.dataset.tableColumnPresentationId),
    ).toEqual(canonicalColumnIds);
    expect(carriers.every((carrier) => carrier.style.left === "")).toBe(true);
    expect(carriers.every((carrier) => carrier.style.width !== "")).toBe(true);
    expect(carriers.every((carrier) => carrier.style.height === "160px")).toBe(
      true,
    );
    expect(
      carriers.every(
        (carrier) =>
          carrier.dataset.tableDndAxis === "horizontal" &&
          carrier.dataset.tableDndGroup === "first-draft-table-columns",
      ),
    ).toBe(true);
    expect(rowCarrier?.dataset.tableDndGroup).toBe(
      "first-draft-table-rows",
    );
    carriers.forEach((carrier, index) => {
      expect(carrier.classList.contains("table-block__carrier--debug")).toBe(
        false,
      );
      expect(carrier.getBoundingClientRect()).toMatchObject({
        left: 100 + index * 208,
        top: 40,
        width: 208,
        height: 160,
      });
      expect(
        trigger(fixture.container, "column", index).closest(
          "[data-table-column-carrier]",
        ),
      ).toBeNull();
      expect(
        trigger(fixture.container, "column", index).hasAttribute(
          "data-dnd-drag-handle",
        ),
      ).toBe(false);
      expect(carrier.children).toHaveLength(0);
      expect(
        carrier.querySelector(
          "button, [data-dnd-drag-handle], [data-editor-block-id], [data-table-cell-id]",
        ),
      ).toBeNull();
      expect(carrier.textContent).toBe("");
    });

    scrollBounds = domRect(400, 0, 100, 220);
    gridBounds = domRect(100, 40, defaultGridWidth, 160);
    fireEvent.scroll(
      fixture.container.querySelector(".table-block__scroll")!,
    );
    flushAnimationFrames();
    expect(
      fixture.container.querySelectorAll("[data-table-column-carrier]"),
    ).toHaveLength(canonicalColumnIds.length);
    fixture.dispose();
  });

  it("keeps a quick column pointer click as the existing menu activation", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const columnTrigger = trigger(fixture.container, "column", 0);
    fireEvent(columnTrigger, tablePointerEvent("pointerdown", 30, 110));
    fireEvent(window, tablePointerEvent("pointerup", 30, 110));
    fireEvent.click(columnTrigger, { detail: 1 });
    expect(fixture.store.getSnapshot()).toMatchObject({
      kind: "open",
      target: { kind: "column" },
    });
    fixture.dispose();
  });

  it("projects every row, tracks, carriers, and indexes before one atomic column drop", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const boundary = activeDragBoundary(fixture.container);
    const rowIds = fixture.editor.getChildBlockIds(tableId);
    const cellsBefore = rowIds.map((rowId) => [
      ...fixture.editor.getChildBlockIds(rowId),
    ]);
    const sourceCellIds = cellsBefore.map((cells) => cells[0]!);
    const sourceCells = new Map(
      sourceCellIds.map((sourceCellId) => {
        const cell = fixture.container.querySelector<HTMLElement>(
          `[data-table-cell-id="${sourceCellId}"]`,
        );
        if (!cell) throw new Error(`Missing source cell ${sourceCellId}`);
        return [
          sourceCellId,
          {
            cell,
            editorShell: cell.firstElementChild,
            rect: cell.getBoundingClientRect(),
          },
        ] as const;
      }),
    );
    const sourceCellText = sourceCellIds.map(
      (sourceCellId) => sourceCells.get(sourceCellId)!.cell.textContent,
    );
    const columnIdsBefore = resolveColumnIds(fixture.editor);
    const selectionBefore =
      fixture.editor.selectionController.getCanonicalSnapshot();
    const transaction = vi.spyOn(fixture.editor, "transaction");
    fixture.onChange.mockClear();
    const columnTrigger = trigger(fixture.container, "column", 0);
    const originalColumnCarriers = new Map(
      [
        ...fixture.container.querySelectorAll<HTMLElement>(
          "[data-table-column-carrier]",
        ),
      ].map((carrier) => [
        carrier.dataset.tableColumnPresentationId!,
        carrier,
      ]),
    );
    const sourceCarrier = fixture.container.querySelector<HTMLElement>(
      `[data-table-column-carrier][data-table-column-presentation-id="${columnIdsBefore[0]}"]`,
    );
    if (!sourceCarrier) throw new Error("Missing source column carrier");
    const sourceCarrierRect = sourceCarrier.getBoundingClientRect();

    fireEvent(columnTrigger, tablePointerEvent("pointerdown", 30, 110));
    fireEvent(window, tablePointerEvent("pointermove", 30, 520));
    flushAnimationFrames();

    expect(boundary.dataset.firstDraftActiveDragGroup).toBe(
      TABLE_COLUMN_DND_GROUP,
    );
    expect(columnTrigger.isConnected).toBe(true);
    for (const control of fixture.container.querySelectorAll<HTMLElement>(
      ".table-block__action-control-zone, .table-block__action-control-bridge, .table-block__action-trigger, .table-block__append, .table-block__resize-handle",
    )) {
      expect(control.isConnected).toBe(true);
    }

    const session = fixture.tableDragStore.getSnapshot().session;
    if (session?.axis !== "column") {
      throw new Error("Expected an active column drag session");
    }
    expect(session.sourceRect).toMatchObject({
      left: sourceCarrierRect.left,
      top: sourceCarrierRect.top,
      width: sourceCarrierRect.width,
      height: sourceCarrierRect.height,
    });
    const projectedIds = session.projectedItems.map(
      (item) => item.presentationId,
    );
    expect(projectedIds).toEqual([
      columnIdsBefore[1],
      columnIdsBefore[2],
      columnIdsBefore[0],
    ]);
    expect(resolveColumnIds(fixture.editor)).toEqual(columnIdsBefore);
    expect(
      rowIds.map((rowId) => fixture.editor.getChildBlockIds(rowId)),
    ).toEqual(cellsBefore);
    expect(transaction).not.toHaveBeenCalled();
    expect(fixture.onChange).not.toHaveBeenCalled();
    expect(
      fixture.editor.selectionController.getCanonicalSnapshot(),
    ).toBe(selectionBefore);
    const placeholderCells = [
      ...fixture.container.querySelectorAll<HTMLElement>(
        '[data-table-drag-placeholder="column"]',
      ),
    ];
    expect(
      placeholderCells.map((cell) => cell.dataset.tableCellId),
    ).toEqual(sourceCellIds);
    expect(
      placeholderCells.every((cell) => cell.getAttribute("aria-colindex") === "3"),
    ).toBe(true);
    for (const cell of placeholderCells) {
      const captured = sourceCells.get(cell.dataset.tableCellId as BlockId)!;
      expect(cell).toBe(captured.cell);
      expect(cell.firstElementChild).toBe(captured.editorShell);
      expect(cell.getBoundingClientRect()).toMatchObject({
        width: captured.rect.width,
        height: captured.rect.height,
      });
      expect(cell.style.display).toBe("");
      expect(cell.style.visibility).toBe("");
      expect(cell.style.opacity).toBe("");
      expect(cell.parentElement).toBe(
        cell.parentElement?.parentElement?.lastElementChild,
      );
    }
    const overlay = document.querySelector<HTMLElement>(
      ".table-block__column-drag-overlay",
    );
    expect(overlay).not.toBeNull();
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(overlay?.hasAttribute("inert")).toBe(true);
    expect(
      overlay?.classList.contains("first-draft-document-block-drag-overlay"),
    ).toBe(false);
    expect(overlay?.querySelector("button, [role='button']")).toBeNull();
    const overlayPreviewCells = [
      ...(overlay?.querySelectorAll<HTMLElement>(
        "[data-first-draft-table-drag-preview-cell]",
      ) ?? []),
    ];
    expect(
      overlayPreviewCells.map(
        (cell) => cell.dataset.firstDraftTableDragPreviewCell,
      ),
    ).toEqual(sourceCellIds);
    expect(overlayPreviewCells.map((cell) => cell.textContent)).toEqual(
      sourceCellText,
    );
    expect(overlay?.querySelectorAll("strong")).toHaveLength(1);
    expect(
      overlay?.querySelector(
        ".table-block__object, .table-block__scroll, .table-block__frame, .table-block__grid-stack, .table-block__grid",
      ),
    ).toBeNull();
    expect(["", "1"]).toContain(getComputedStyle(overlay!).opacity);
    expect(["", "none"]).toContain(
      getComputedStyle(overlay!).getPropertyValue("mask-image"),
    );
    const overlayRect = overlay?.getBoundingClientRect();
    expect(overlayRect).toMatchObject({
      width: sourceCarrierRect.width,
      height: sourceCarrierRect.height,
    });
    expect(
      overlay
        ?.querySelector<HTMLElement>(
          ".table-block__column-drag-overlay-body",
        )
        ?.getBoundingClientRect(),
    ).toMatchObject({
      width: sourceCarrierRect.width,
      height: sourceCarrierRect.height,
    });
    expect(
      overlay
        ?.querySelector<HTMLElement>(
          ".table-block__column-drag-overlay-trigger",
        )
        ?.getBoundingClientRect(),
    ).toMatchObject({
      left: overlayRect?.left,
      top: (overlayRect?.top ?? 0) - 20,
      width: sourceCarrierRect.width,
      height: 16,
    });
    expect(
      overlay
        ?.querySelector(".table-block__column-drag-overlay-body")
        ?.contains(
          overlay.querySelector(".table-block__column-drag-overlay-trigger"),
        ),
    ).toBe(false);
    expect(
      overlay?.querySelector(
        "[data-editor-block-id], [data-table-cell-id], button, [role='button']",
      ),
    ).toBeNull();
    expect(
      [...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-column-carrier]",
      )].map((carrier) => carrier.dataset.tableColumnPresentationId),
    ).toEqual(projectedIds);
    [...fixture.container.querySelectorAll<HTMLElement>(
      "[data-table-column-carrier]",
    )].forEach((carrier) => {
      expect(carrier).toBe(
        originalColumnCarriers.get(carrier.dataset.tableColumnPresentationId!),
      );
      expect(carrier.children).toHaveLength(0);
    });
    expect(
      [...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-column-carrier]",
      )].map((carrier) => carrier.getBoundingClientRect()),
    ).toEqual([
      expect.objectContaining({ left: 100, top: 40, width: 208, height: 160 }),
      expect.objectContaining({ left: 308, top: 40, width: 208, height: 160 }),
      expect.objectContaining({ left: 516, top: 40, width: 208, height: 160 }),
    ]);
    expect(
      [...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-resize-column]",
      )].map((handle) => handle.dataset.tableResizeColumn),
    ).toEqual(projectedIds);
    expect(
      triggers(fixture.container, "column").map(
        (button) => button.getBoundingClientRect().left,
      ),
    ).toEqual([308, 516, 100]);
    const presentedRows = [
      ...fixture.container.querySelectorAll<HTMLElement>(
        ".table-block__row",
      ),
    ];
    presentedRows.forEach((row, rowIndex) => {
      const cells = [
        ...row.querySelectorAll<HTMLElement>("[data-table-cell-id]"),
      ];
      expect(cells.map((cell) => cell.dataset.tableCellId)).toEqual([
        cellsBefore[rowIndex]![1],
        cellsBefore[rowIndex]![2],
        cellsBefore[rowIndex]![0],
      ]);
      expect(cells.map((cell) => cell.getAttribute("aria-colindex"))).toEqual([
        "1",
        "2",
        "3",
      ]);
      expect(cells.map((cell) => cell.dataset.tableColumnId)).toEqual(
        projectedIds,
      );
    });
    expect(
      fixture.container.querySelector<HTMLElement>(".table-block__object")
        ?.style.getPropertyValue("--first-draft-table-tracks"),
    ).toBe("208px 208px 208px");

    fireEvent(window, tablePointerEvent("pointerup", 30, 520));
    fireEvent.click(columnTrigger, { detail: 1 });

    expect(boundary.hasAttribute("data-first-draft-active-drag-group")).toBe(
      false,
    );
    expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });
    expect(transaction).toHaveBeenCalledOnce();
    expect(fixture.onChange).toHaveBeenCalledOnce();
    expect(
      fixture.container.querySelectorAll("[data-table-drag-placeholder]"),
    ).toHaveLength(0);
    expect(resolveColumnIds(fixture.editor)).toEqual(projectedIds);
    rowIds.forEach((rowId, rowIndex) => {
      expect(fixture.editor.getChildBlockIds(rowId)).toEqual([
        cellsBefore[rowIndex]![1],
        cellsBefore[rowIndex]![2],
        cellsBefore[rowIndex]![0],
      ]);
    });
    fixture.dispose();
  });

  it("matches an unequal-width column overlay to its complete source carrier", () => {
    rowBounds.set("fd-table-row-1", domRect(100, 40, defaultGridWidth, 28));
    rowBounds.set("fd-table-row-2", domRect(100, 68, defaultGridWidth, 36));
    rowBounds.set("fd-table-row-3", domRect(100, 104, defaultGridWidth, 44));
    rowBounds.set("fd-table-row-4", domRect(100, 148, defaultGridWidth, 52));
    const fixture = renderFixture(
      false,
      undefined,
      snapshotWithColumnWidths([184, 232, 208]),
    );
    flushAnimationFrames();
    const carriers = [
      ...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-column-carrier]",
      ),
    ];
    expect(carriers.map((carrier) => carrier.getBoundingClientRect())).toEqual([
      expect.objectContaining({ left: 100, top: 40, width: 184, height: 160 }),
      expect.objectContaining({ left: 284, top: 40, width: 232, height: 160 }),
      expect.objectContaining({ left: 516, top: 40, width: 208, height: 160 }),
    ]);
    expect(
      fixture.container.querySelector<HTMLElement>(".table-block__object")
        ?.style.getPropertyValue("--first-draft-table-tracks"),
    ).toBe("184px 232px 208px");

    const sourceTrigger = trigger(fixture.container, "column", 1);
    const sourceRect = carriers[1]!.getBoundingClientRect();
    fireEvent(sourceTrigger, tablePointerEvent("pointerdown", 30, 300));
    fireEvent(window, tablePointerEvent("pointermove", 30, 306));
    flushAnimationFrames();

    expect(fixture.tableDragStore.getSnapshot().session).toMatchObject({
      axis: "column",
      sourceRect: {
        left: sourceRect.left,
        top: sourceRect.top,
        width: sourceRect.width,
        height: sourceRect.height,
      },
    });
    const overlay = document.querySelector<HTMLElement>(
      ".table-block__column-drag-overlay",
    );
    expect(overlay?.getBoundingClientRect()).toMatchObject({
      width: sourceRect.width,
      height: sourceRect.height,
    });
    expect(
      overlay
        ?.querySelector<HTMLElement>(
          ".table-block__column-drag-overlay-body",
        )
        ?.getBoundingClientRect(),
    ).toMatchObject({ width: sourceRect.width, height: sourceRect.height });
    expect(
      overlay?.querySelector<HTMLElement>(
        ".table-block__column-drag-overlay-body",
      )?.style.gridTemplateRows,
    ).toBe("28px 36px 44px 52px");
    expect(
      overlay?.querySelector<HTMLElement>(
        ".table-block__column-drag-overlay-body",
      )?.style.gridTemplateColumns,
    ).toBe("232px");
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(
      overlay?.querySelector(
        "[data-editor-block-id], [data-table-cell-id], button, [role='button']",
      ),
    ).toBeNull();
    fireEvent(window, tablePointerEvent("pointercancel", 30, 306));
    expect(
      document.querySelector(".table-block__column-drag-overlay"),
    ).toBeNull();
    fixture.dispose();
  });

  it("fails a column activation closed when captured row geometry is invalid", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const transaction = vi.spyOn(fixture.editor, "transaction");
    rowBounds.set("fd-table-row-2", domRect(100, 80, defaultGridWidth, 0));

    const sourceTrigger = trigger(fixture.container, "column", 0);
    fireEvent(sourceTrigger, tablePointerEvent("pointerdown", 30, 110));
    fireEvent(window, tablePointerEvent("pointermove", 30, 520));
    flushAnimationFrames();

    expect(fixture.tableDragStore.getSnapshot().session).toBeNull();
    expect(document.querySelector(".first-draft-table-drag-overlay")).toBeNull();
    fireEvent(window, tablePointerEvent("pointerup", 30, 520));
    expect(transaction).not.toHaveBeenCalled();
    expect(fixture.onChange).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("keeps an active cell caret anchored through column preview and commit", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const firstRow = fixture.editor.getChildBlockIds(tableId)[0]!;
    const caretCellId = fixture.editor.getChildBlockIds(firstRow)[1]!;
    act(() => {
      expect(
        fixture.editor.focusText(caretCellId, {
          offset: 1,
          preventScroll: true,
        }).status,
      ).not.toBe("rejected");
    });
    const selectionBefore =
      fixture.editor.selectionController.getCanonicalSnapshot();
    if (selectionBefore.kind !== "document") {
      throw new Error("Expected a document caret inside the table");
    }
    const settlements: EditorStableSelection[] = [];
    const unsubscribe =
      fixture.editor.subscribeStandaloneSelectionSettlements((selection) =>
        settlements.push(selection),
      );
    fixture.onChange.mockClear();
    const sourceTrigger = trigger(fixture.container, "column", 0);
    fireEvent(sourceTrigger, tablePointerEvent("pointerdown", 30, 110));
    fireEvent(window, tablePointerEvent("pointermove", 30, 520));
    flushAnimationFrames();

    expect(
      fixture.editor.selectionController.getCanonicalSnapshot(),
    ).toBe(selectionBefore);
    expect(fixture.onChange).not.toHaveBeenCalled();
    expect(settlements).toEqual([]);

    fireEvent(window, tablePointerEvent("pointerup", 30, 520));
    expect(fixture.onChange).toHaveBeenCalledOnce();
    expect(settlements).toEqual([]);
    expect(
      fixture.editor.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({
      kind: "document",
      snapshot: {
        endpoints: {
          anchor: { blockId: caretCellId, textOffset: 1 },
          head: { blockId: caretCellId, textOffset: 1 },
        },
      },
    });
    unsubscribe();
    fixture.dispose();
  });

  it("keeps synthetic columns draggable and normalizes identities in their move transaction", () => {
    const fixture = renderFixture(
      false,
      undefined,
      snapshotWithColumnIds(undefined),
    );
    flushAnimationFrames();
    const rows = fixture.editor.getChildBlockIds(tableId);
    const cellsBefore = rows.map((rowId) => [
      ...fixture.editor.getChildBlockIds(rowId),
    ]);
    const transaction = vi.spyOn(fixture.editor, "transaction");
    fixture.onChange.mockClear();
    const sourceTrigger = trigger(fixture.container, "column", 0);

    fireEvent(sourceTrigger, tablePointerEvent("pointerdown", 30, 110));
    fireEvent(window, tablePointerEvent("pointermove", 30, 520));
    flushAnimationFrames();
    expect(fixture.tableDragStore.getSnapshot().session).toMatchObject({
      axis: "column",
      sourceTarget: {
        kind: "synthetic-presentation",
        presentationId: "column-1",
        indexAtOpen: 0,
        columnCountAtOpen: 3,
      },
    });
    expect(resolveColumnIds(fixture.editor)).toEqual([
      "column-1",
      "column-2",
      "column-3",
    ]);

    fireEvent(window, tablePointerEvent("pointerup", 30, 520));

    const normalizedIds = resolveColumnIds(fixture.editor);
    expect(new Set(normalizedIds).size).toBe(3);
    expect(normalizedIds).not.toEqual([
      "column-1",
      "column-2",
      "column-3",
    ]);
    expect(transaction).toHaveBeenCalledOnce();
    expect(fixture.onChange).toHaveBeenCalledOnce();
    rows.forEach((rowId, rowIndex) => {
      expect(fixture.editor.getChildBlockIds(rowId)).toEqual([
        cellsBefore[rowIndex]![1],
        cellsBefore[rowIndex]![2],
        cellsBefore[rowIndex]![0],
      ]);
    });
    fixture.dispose();
  });

  it("keeps unequal column carrier DOM, geometry, and overlay anchoring coherent across five drag sessions", () => {
    const fixture = renderFixture(
      false,
      undefined,
      snapshotWithColumnWidths([184, 232, 208]),
    );
    flushAnimationFrames();
    const originalCarriers = new Map(
      [...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-column-carrier]",
      )].map((carrier) => [
        carrier.dataset.tableColumnPresentationId!,
        carrier,
      ]),
    );
    const transaction = vi.spyOn(fixture.editor, "transaction");

    const carrierOrder = () =>
      [...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-column-carrier]",
      )].map((carrier) => carrier.dataset.tableColumnPresentationId!);
    const visibleOrder = () => {
      const firstRow = fixture.container.querySelector<HTMLElement>(
        ".table-block__row",
      );
      return [
        ...(firstRow?.querySelectorAll<HTMLElement>("[data-table-column-id]") ??
          []),
      ].map((cell) => cell.dataset.tableColumnId!);
    };
    const assertSettled = (expectedTransactions: number) => {
      const canonical = resolveColumnIds(fixture.editor);
      expect(carrierOrder()).toEqual(canonical);
      expect(visibleOrder()).toEqual(canonical);
      expect(new Set(carrierOrder()).size).toBe(canonical.length);
      let expectedLeft = gridBounds.left;
      for (const columnId of canonical) {
        const carrier = fixture.container.querySelector<HTMLElement>(
          `[data-table-column-presentation-id="${columnId}"]`,
        );
        expect(carrier).toBe(originalCarriers.get(columnId));
        const width = Number.parseFloat(carrier?.style.width ?? "");
        expect(carrier?.getBoundingClientRect()).toMatchObject({
          left: expectedLeft,
          top: gridBounds.top,
          width,
          height: gridBounds.height,
        });
        expectedLeft += width;
      }
      expect(fixture.tableDragStore.getSnapshot().session).toBeNull();
      expect(
        document.querySelector(".table-block__column-drag-overlay"),
      ).toBeNull();
      expect(
        fixture.container.querySelectorAll("[data-table-drag-placeholder]"),
      ).toHaveLength(0);
      expect(transaction).toHaveBeenCalledTimes(expectedTransactions);
      expect(fixture.onChange).toHaveBeenCalledTimes(expectedTransactions);
    };
    const drag = ({
      sourceIndex,
      targetX,
      result,
      expectedTransactions,
      expectedProjection,
    }: {
      readonly sourceIndex: number;
      readonly targetX: number;
      readonly result: "drop" | "cancel";
      readonly expectedTransactions: number;
      readonly expectedProjection: (
        canonical: readonly string[],
      ) => readonly string[];
    }) => {
      const canonicalBefore = resolveColumnIds(fixture.editor);
      const sourceId = canonicalBefore[sourceIndex]!;
      const sourceCarrier = fixture.container.querySelector<HTMLElement>(
        `[data-table-column-presentation-id="${sourceId}"]`,
      );
      if (!sourceCarrier) {
        throw new Error(`Missing column carrier ${sourceId}`);
      }
      const sourceRect = sourceCarrier.getBoundingClientRect();
      const startX = sourceRect.left + sourceRect.width / 2;
      const sourceTrigger = trigger(fixture.container, "column", sourceIndex);

      fireEvent(sourceTrigger, tablePointerEvent("pointerdown", 90, startX));
      fireEvent(window, tablePointerEvent("pointermove", 90, targetX));
      flushAnimationFrames();

      const session = fixture.tableDragStore.getSnapshot().session;
      if (session?.axis !== "column") {
        throw new Error("Expected an active column drag session");
      }
      expect(session.sourceDragId).toBe(sourceCarrier.dataset.tableColumnCarrier);
      expect(session.sourceRect).toMatchObject({
        left: sourceRect.left,
        top: sourceRect.top,
        width: sourceRect.width,
        height: sourceRect.height,
      });
      const projected = session.projectedItems.map(
        (item) => item.presentationId,
      );
      expect(projected).toEqual(expectedProjection(canonicalBefore));
      expect(carrierOrder()).toEqual(projected);
      expect(visibleOrder()).toEqual(projected);
      const overlay = document.querySelector<HTMLElement>(
        ".table-block__column-drag-overlay",
      );
      if (!overlay) throw new Error("Missing column drag overlay");
      expect(overlay.getBoundingClientRect()).toMatchObject({
        left: sourceRect.left + targetX - startX,
        top: sourceRect.top,
        width: sourceRect.width,
        height: sourceRect.height,
      });

      fireEvent(
        window,
        tablePointerEvent(
          result === "drop" ? "pointerup" : "pointercancel",
          90,
          targetX,
        ),
      );
      flushAnimationFrames();
      assertSettled(expectedTransactions);
    };

    drag({
      sourceIndex: 0,
      targetX: 700,
      result: "drop",
      expectedTransactions: 1,
      expectedProjection: ([first, ...rest]) => [...rest, first!],
    });
    drag({
      sourceIndex: 1,
      targetX: 105,
      result: "drop",
      expectedTransactions: 2,
      expectedProjection: ([first, second, third]) => [second!, first!, third!],
    });
    const noOpSourceRect = fixture.container
      .querySelector<HTMLElement>("[data-table-column-carrier]")!
      .getBoundingClientRect();
    drag({
      sourceIndex: 0,
      targetX: noOpSourceRect.left + noOpSourceRect.width / 2 + 7,
      result: "drop",
      expectedTransactions: 2,
      expectedProjection: (canonical) => canonical,
    });
    drag({
      sourceIndex: 0,
      targetX: 700,
      result: "cancel",
      expectedTransactions: 2,
      expectedProjection: ([first, ...rest]) => [...rest, first!],
    });
    drag({
      sourceIndex: 2,
      targetX: 105,
      result: "drop",
      expectedTransactions: 3,
      expectedProjection: ([first, second, third]) => [third!, first!, second!],
    });
    fixture.dispose();
  });

  it("starts a column drag after the shared activation delay without opening its menu", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    vi.useFakeTimers();
    const columnTrigger = trigger(fixture.container, "column", 0);
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
    fireEvent(columnTrigger, tablePointerEvent("pointerdown", 30, 110));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
    act(() => vi.advanceTimersByTime(179));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
    expect(fixture.tableDragStore.getSnapshot().session).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(document.documentElement.getAttribute(domPointerDragActiveAttribute)).toBe("true");
    expect(fixture.tableDragStore.getSnapshot().session).toMatchObject({
      axis: "column",
      status: "dragging",
    });
    expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });
    fireEvent(window, tablePointerEvent("pointercancel", 30, 110));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
    fixture.dispose();
  });

  it("moves local column selection paint by cell identity without publishing selection", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    fireEvent.click(trigger(fixture.container, "column", 1));
    const selectionBefore =
      fixture.editor.selectionController.getCanonicalSnapshot();
    if (selectionBefore.kind !== "block-internal") {
      throw new Error("Expected the existing column range selection");
    }
    const selectedCellIds = fixture.editor
      .getChildBlockIds(tableId)
      .map((rowId) => fixture.editor.getChildBlockIds(rowId)[1]!);
    const settlements: EditorStableSelection[] = [];
    const unsubscribe =
      fixture.editor.subscribeStandaloneSelectionSettlements((selection) =>
        settlements.push(selection),
      );

    const sourceTrigger = trigger(fixture.container, "column", 0);
    fireEvent(sourceTrigger, tablePointerEvent("pointerdown", 30, 110));
    fireEvent(window, tablePointerEvent("pointermove", 30, 520));
    flushAnimationFrames();

    const selectedCells = [
      ...fixture.container.querySelectorAll<HTMLElement>(
        '.table-block__cell[aria-selected="true"]',
      ),
    ];
    expect(selectedCells.map((cell) => cell.dataset.tableCellId)).toEqual(
      selectedCellIds,
    );
    expect(
      selectedCells.every(
        (cell) =>
          cell.getAttribute("aria-colindex") === "1" &&
          cell.dataset.tableColumnIndex === "0",
      ),
    ).toBe(true);
    expect(
      fixture.editor.selectionController.getCanonicalSnapshot(),
    ).toBe(selectionBefore);
    expect(settlements).toEqual([]);
    fireEvent(window, tablePointerEvent("pointercancel", 30, 520));
    expect(
      [...fixture.container.querySelectorAll<HTMLElement>(
        '.table-block__cell[aria-selected="true"]',
      )].every((cell) => cell.getAttribute("aria-colindex") === "2"),
    ).toBe(true);
    unsubscribe();
    fixture.dispose();
  });

  it("keeps a quick row pointer click as menu activation", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const rowTrigger = trigger(fixture.container, "row", 0);
    fireEvent(rowTrigger, tablePointerEvent("pointerdown", 1));
    fireEvent(window, tablePointerEvent("pointerup", 1));
    fireEvent.click(rowTrigger, { detail: 1 });
    expect(
      activeDragBoundary(fixture.container).hasAttribute(
        "data-first-draft-active-drag-group",
      ),
    ).toBe(false);
    expect(fixture.store.getSnapshot()).toMatchObject({
      kind: "open",
      target: { kind: "row", rowId },
    });
    fixture.dispose();
  });

  it("starts row dragging by distance without opening a menu or changing selection", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const rowTrigger = trigger(fixture.container, "row", 0);
    const selectionBefore =
      fixture.editor.selectionController.getCanonicalSnapshot();
    const boundary = activeDragBoundary(fixture.container);
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
    fireEvent(rowTrigger, tablePointerEvent("pointerdown", 1));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
    expect(boundary.hasAttribute("data-first-draft-active-drag-group")).toBe(
      false,
    );
    fireEvent(window, tablePointerEvent("pointermove", 7));
    expect(document.documentElement.getAttribute(domPointerDragActiveAttribute)).toBe("true");
    expect(fixture.tableDragStore.getSnapshot().session).toMatchObject({
      status: "dragging",
      sourceRowId: rowId,
    });
    expect(boundary.dataset.firstDraftActiveDragGroup).toBe(
      TABLE_ROW_DND_GROUP,
    );
    expect(rowTrigger.isConnected).toBe(true);
    fireEvent(window, tablePointerEvent("pointerup", 7));
    expect(document.documentElement.hasAttribute(domPointerDragActiveAttribute)).toBe(false);
    fireEvent.click(rowTrigger, { detail: 1 });
    expect(boundary.hasAttribute("data-first-draft-active-drag-group")).toBe(
      false,
    );
    expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });
    expect(
      fixture.editor.selectionController.getCanonicalSnapshot(),
    ).toBe(selectionBefore);
    expect(fixture.onChange).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("starts row dragging after the shared 180 millisecond hold", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    vi.useFakeTimers();
    const rowTrigger = trigger(fixture.container, "row", 0);
    fireEvent(rowTrigger, tablePointerEvent("pointerdown", 1));
    act(() => vi.advanceTimersByTime(179));
    expect(fixture.tableDragStore.getSnapshot().session).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(fixture.tableDragStore.getSnapshot().session).toMatchObject({
      status: "dragging",
      sourceRowId: rowId,
    });
    fireEvent(window, tablePointerEvent("pointercancel", 1));
    fixture.dispose();
  });

  it("retains the row placeholder while awaiting drop and clears it with the session", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const rowTrigger = trigger(fixture.container, "row", 0);
    fireEvent(rowTrigger, tablePointerEvent("pointerdown", 60));
    fireEvent(window, tablePointerEvent("pointermove", 190));
    flushAnimationFrames();

    expect(
      fixture.container.querySelectorAll(
        '[data-table-drag-placeholder="row"]',
      ),
    ).toHaveLength(3);
    act(() => fixture.tableDragStore.endRowDrag("dropped"));
    expect(fixture.tableDragStore.getSnapshot().session?.status).toBe(
      "awaiting-drop",
    );
    expect(
      fixture.container.querySelectorAll(
        '[data-table-drag-placeholder="row"]',
      ),
    ).toHaveLength(3);

    act(() => fixture.tableDragStore.clearRowDrag());
    expect(
      fixture.container.querySelectorAll("[data-table-drag-placeholder]"),
    ).toHaveLength(0);
    expect(fixture.onChange).not.toHaveBeenCalled();
    fireEvent(window, tablePointerEvent("pointercancel", 150));
    fixture.dispose();
  });

  it("removes the placeholder immediately when an active session is invalidated", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    fireEvent(
      trigger(fixture.container, "column", 0),
      tablePointerEvent("pointerdown", 30, 110),
    );
    fireEvent(window, tablePointerEvent("pointermove", 30, 520));
    flushAnimationFrames();
    expect(
      fixture.container.querySelectorAll(
        '[data-table-drag-placeholder="column"]',
      ),
    ).toHaveLength(4);

    act(() => fixture.tableDragStore.invalidateActiveDrag(tableId));
    expect(fixture.tableDragStore.getSnapshot().session).toMatchObject({
      valid: false,
    });
    expect(
      fixture.container.querySelectorAll("[data-table-drag-placeholder]"),
    ).toHaveLength(0);
    expect(fixture.onChange).not.toHaveBeenCalled();
    fireEvent(window, tablePointerEvent("pointercancel", 30, 520));
    fixture.dispose();
  });

  it("closes an open menu on row drag without restoring trigger focus or replacing selection", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const rowTrigger = trigger(fixture.container, "row", 0);
    fireEvent.click(rowTrigger);
    const selectionBefore =
      fixture.editor.selectionController.getCanonicalSnapshot();
    expect(fixture.store.getSnapshot().kind).toBe("open");
    fireEvent(rowTrigger, tablePointerEvent("pointerdown", 1));
    fireEvent(window, tablePointerEvent("pointermove", 7));
    expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });
    expect(
      fixture.editor.selectionController.getCanonicalSnapshot(),
    ).toBe(selectionBefore);
    expect(document.activeElement).not.toBe(rowTrigger);
    fireEvent(window, tablePointerEvent("pointercancel", 7));
    fixture.dispose();
  });

  it("commits a projected row drop once while preserving the selected row identities", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const rowsBefore = [...fixture.editor.getChildBlockIds(tableId)];
    const sourceRowId = rowsBefore[0]!;
    const sourceCells = [...fixture.editor.getChildBlockIds(sourceRowId)];
    const rowTrigger = trigger(fixture.container, "row", 0);
    fireEvent.click(rowTrigger);
    const selectionBefore =
      fixture.editor.selectionController.getCanonicalSnapshot();
    if (selectionBefore.kind !== "block-internal") {
      throw new Error("Expected the row menu to own a table range");
    }
    const sourceCellNodes = new Map(
      sourceCells.map((sourceCellId) => {
        const cell = fixture.container.querySelector<HTMLElement>(
          `[data-table-cell-id="${sourceCellId}"]`,
        );
        if (!cell) throw new Error(`Missing source cell ${sourceCellId}`);
        return [
          sourceCellId,
          {
            cell,
            editorShell: cell.firstElementChild,
            localPaint: cell.querySelector(
              '[data-table-selection-kind="local"]',
            ),
            rect: cell.getBoundingClientRect(),
          },
        ] as const;
      }),
    );
    const sourceCellText = sourceCells.map(
      (sourceCellId) => sourceCellNodes.get(sourceCellId)!.cell.textContent,
    );
    fixture.onChange.mockClear();
    const sourceCarrier = fixture.container.querySelector<HTMLElement>(
      `[data-table-row-carrier="${sourceRowId}"]`,
    );
    if (!sourceCarrier) throw new Error("Missing source row carrier");
    const originalRowCarriers = new Map(
      [...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-row-carrier]",
      )].map((carrier) => [carrier.dataset.tableRowCarrier!, carrier]),
    );
    const sourceCarrierRect = sourceCarrier.getBoundingClientRect();

    fireEvent(rowTrigger, tablePointerEvent("pointerdown", 60));
    fireEvent(window, tablePointerEvent("pointermove", 190));
    flushAnimationFrames();
    const dragSession = fixture.tableDragStore.getSnapshot().session;
    const projectedRows =
      dragSession?.axis === "row" ? dragSession.projectedRowIds : undefined;
    expect(dragSession).toMatchObject({
      axis: "row",
      sourceRect: {
        left: sourceCarrierRect.left,
        top: sourceCarrierRect.top,
        width: sourceCarrierRect.width,
        height: sourceCarrierRect.height,
      },
    });
    expect(projectedRows).not.toEqual(rowsBefore);
    expect(projectedRows?.at(-1)).toBe(sourceRowId);
    expect(fixture.editor.getChildBlockIds(tableId)).toEqual(rowsBefore);
    const placeholderCells = [
      ...fixture.container.querySelectorAll<HTMLElement>(
        '[data-table-drag-placeholder="row"]',
      ),
    ];
    expect(
      placeholderCells.map((cell) => cell.dataset.tableCellId),
    ).toEqual(sourceCells);
    expect(
      fixture.container.querySelectorAll(
        '[data-table-drag-placeholder="column"]',
      ),
    ).toHaveLength(0);
    for (const cell of placeholderCells) {
      const captured = sourceCellNodes.get(
        cell.dataset.tableCellId as BlockId,
      )!;
      expect(cell).toBe(captured.cell);
      expect(cell.firstElementChild).toBe(captured.editorShell);
      expect(
        cell.querySelector('[data-table-selection-kind="local"]'),
      ).toBe(captured.localPaint);
      expect(cell.getBoundingClientRect()).toMatchObject({
        width: captured.rect.width,
        height: captured.rect.height,
      });
    }
    const sourceRowShell = fixture.container.querySelector<HTMLElement>(
      `.table-block__grid > [data-editor-block-id="${sourceRowId}"]`,
    );
    expect(sourceRowShell).toBe(sourceRowShell?.parentElement?.lastElementChild);
    const overlay = document.querySelector<HTMLElement>(
      ".table-block__row-drag-overlay",
    );
    expect(overlay?.getBoundingClientRect()).toMatchObject({
      width: sourceCarrierRect.width,
      height: sourceCarrierRect.height,
    });
    expect(
      overlay
        ?.querySelector<HTMLElement>(".table-block__row-drag-overlay-body")
        ?.getBoundingClientRect(),
    ).toMatchObject({
      width: sourceCarrierRect.width,
      height: sourceCarrierRect.height,
    });
    expect(overlay?.getAttribute("aria-hidden")).toBe("true");
    expect(overlay?.hasAttribute("inert")).toBe(true);
    expect(
      overlay?.classList.contains("first-draft-document-block-drag-overlay"),
    ).toBe(false);
    const overlayPreviewCells = [
      ...(overlay?.querySelectorAll<HTMLElement>(
        "[data-first-draft-table-drag-preview-cell]",
      ) ?? []),
    ];
    expect(
      overlayPreviewCells.map(
        (cell) => cell.dataset.firstDraftTableDragPreviewCell,
      ),
    ).toEqual(sourceCells);
    expect(overlayPreviewCells.map((cell) => cell.textContent)).toEqual(
      sourceCellText,
    );
    expect(overlay?.querySelectorAll("strong")).toHaveLength(3);
    expect(
      overlay?.querySelector(
        ".table-block__object, .table-block__scroll, .table-block__frame, .table-block__grid-stack, .table-block__grid",
      ),
    ).toBeNull();
    expect(["", "1"]).toContain(getComputedStyle(overlay!).opacity);
    expect(["", "none"]).toContain(
      getComputedStyle(overlay!).getPropertyValue("mask-image"),
    );
    expect(
      overlay?.querySelector<HTMLElement>(
        ".table-block__row-drag-overlay-body",
      )?.style.gridTemplateColumns,
    ).toBe("208px 208px 208px");
    const overlayRect = overlay?.getBoundingClientRect();
    expect(
      overlay
        ?.querySelector<HTMLElement>(".table-block__row-drag-overlay-trigger")
        ?.getBoundingClientRect(),
    ).toMatchObject({
      left: (overlayRect?.left ?? 0) - 20,
      top: overlayRect?.top,
      width: 16,
      height: sourceCarrierRect.height,
    });
    expect(
      overlay
        ?.querySelector(".table-block__row-drag-overlay-body")
        ?.contains(overlay.querySelector(".table-block__row-drag-overlay-trigger")),
    ).toBe(false);
    expect(
      overlay?.querySelector(
        "[data-editor-block-id], [data-table-cell-id], button, [role='button']",
      ),
    ).toBeNull();
    const capturedPreview = dragSession?.axis === "row" ? dragSession.preview : null;
    fireEvent(window, tablePointerEvent("pointermove", 195));
    expect(
      fixture.tableDragStore.getSnapshot().session?.axis === "row"
        ? fixture.tableDragStore.getSnapshot().session?.preview
        : null,
    ).toBe(capturedPreview);
    expect(
      [
        ...fixture.container.querySelectorAll<HTMLElement>(
          ".table-block__grid > [data-editor-block-id]",
        ),
      ].map((element) => element.dataset.editorBlockId),
    ).toEqual(projectedRows);
    [...fixture.container.querySelectorAll<HTMLElement>(
      "[data-table-row-carrier]",
    )].forEach((carrier) => {
      expect(carrier).toBe(
        originalRowCarriers.get(carrier.dataset.tableRowCarrier!),
      );
      expect(carrier.children).toHaveLength(0);
    });
    expect(
      [
        ...fixture.container.querySelectorAll<HTMLElement>(
          "[data-table-row-carrier]",
        ),
      ].map((element) => element.dataset.tableRowCarrier),
    ).toEqual(projectedRows);
    expect(
      [...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-row-carrier]",
      )].map((carrier) => carrier.getBoundingClientRect()),
    ).toEqual(
      projectedRows?.map((_rowId, index) =>
        expect.objectContaining({
          left: 100,
          top: 40 + index * 40,
          width: 624,
          height: 40,
        }),
      ),
    );
    fireEvent(window, tablePointerEvent("pointerup", 190));

    const rowsAfter = fixture.editor.getChildBlockIds(tableId);
    expect(rowsAfter).not.toEqual(rowsBefore);
    expect(new Set(rowsAfter)).toEqual(new Set(rowsBefore));
    expect(fixture.editor.getChildBlockIds(sourceRowId)).toEqual(sourceCells);
    expect(fixture.onChange).toHaveBeenCalledOnce();
    expect(document.querySelector(".table-block__row-drag-overlay")).toBeNull();
    expect(
      fixture.container.querySelectorAll("[data-table-drag-placeholder]"),
    ).toHaveLength(0);
    expect(
      fixture.editor.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({
      kind: "block-internal",
      snapshot: selectionBefore.snapshot,
    });
    fixture.dispose();
  });

  it("keeps row carrier DOM, registration geometry, and overlay anchoring coherent across five drag sessions", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const originalCarriers = new Map(
      [...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-row-carrier]",
      )].map((carrier) => [carrier.dataset.tableRowCarrier!, carrier]),
    );
    const transaction = vi.spyOn(fixture.editor, "transaction");

    const carrierOrder = () =>
      [...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-row-carrier]",
      )].map((carrier) => carrier.dataset.tableRowCarrier as BlockId);
    const visibleOrder = () =>
      [...fixture.container.querySelectorAll<HTMLElement>(
        ".table-block__grid > [data-editor-block-id]",
      )].map((row) => row.dataset.editorBlockId as BlockId);
    const assertSettled = (expectedTransactions: number) => {
      const canonical = fixture.editor.getChildBlockIds(tableId);
      expect(carrierOrder()).toEqual(canonical);
      expect(visibleOrder()).toEqual(canonical);
      expect(new Set(carrierOrder()).size).toBe(canonical.length);
      for (const [index, currentRowId] of canonical.entries()) {
        const carrier = fixture.container.querySelector<HTMLElement>(
          `[data-table-row-carrier="${currentRowId}"]`,
        );
        expect(carrier).toBe(originalCarriers.get(currentRowId));
        expect(carrier?.getBoundingClientRect()).toMatchObject({
          left: gridBounds.left,
          top: gridBounds.top + index * 40,
          width: defaultGridWidth,
          height: 40,
        });
      }
      expect(fixture.tableDragStore.getSnapshot().session).toBeNull();
      expect(document.querySelector(".table-block__row-drag-overlay")).toBeNull();
      expect(
        fixture.container.querySelectorAll("[data-table-drag-placeholder]"),
      ).toHaveLength(0);
      expect(
        activeDragBoundary(fixture.container).hasAttribute(
          "data-first-draft-active-drag-group",
        ),
      ).toBe(false);
      expect(transaction).toHaveBeenCalledTimes(expectedTransactions);
      expect(fixture.onChange).toHaveBeenCalledTimes(expectedTransactions);
    };
    const drag = ({
      sourceIndex,
      targetY,
      result,
      expectedTransactions,
      expectedProjection,
    }: {
      readonly sourceIndex: number;
      readonly targetY: number;
      readonly result: "drop" | "cancel";
      readonly expectedTransactions: number;
      readonly expectedProjection: (
        canonical: readonly BlockId[],
      ) => readonly BlockId[];
    }) => {
      const canonicalBefore = [...fixture.editor.getChildBlockIds(tableId)];
      const sourceId = canonicalBefore[sourceIndex]!;
      const sourceCarrier = fixture.container.querySelector<HTMLElement>(
        `[data-table-row-carrier="${sourceId}"]`,
      );
      if (!sourceCarrier) throw new Error(`Missing row carrier ${sourceId}`);
      const sourceRect = sourceCarrier.getBoundingClientRect();
      const startY = sourceRect.top + sourceRect.height / 2;
      const sourceTrigger = trigger(fixture.container, "row", sourceIndex);

      fireEvent(sourceTrigger, tablePointerEvent("pointerdown", startY));
      fireEvent(window, tablePointerEvent("pointermove", targetY));
      flushAnimationFrames();

      const session = fixture.tableDragStore.getSnapshot().session;
      if (session?.axis !== "row") {
        throw new Error("Expected an active row drag session");
      }
      expect(session.sourceRowId).toBe(sourceId);
      expect(session.sourceRect).toMatchObject({
        left: sourceRect.left,
        top: sourceRect.top,
        width: sourceRect.width,
        height: sourceRect.height,
      });
      expect(session.projectedRowIds).toEqual(
        expectedProjection(canonicalBefore),
      );
      expect(carrierOrder()).toEqual(session.projectedRowIds);
      expect(visibleOrder()).toEqual(session.projectedRowIds);
      const overlay = document.querySelector<HTMLElement>(
        ".table-block__row-drag-overlay",
      );
      if (!overlay) throw new Error("Missing row drag overlay");
      expect(overlay.getBoundingClientRect()).toMatchObject({
        left: sourceRect.left,
        top: sourceRect.top + targetY - startY,
        width: sourceRect.width,
        height: sourceRect.height,
      });

      fireEvent(
        window,
        tablePointerEvent(result === "drop" ? "pointerup" : "pointercancel", targetY),
      );
      flushAnimationFrames();
      assertSettled(expectedTransactions);
    };

    drag({
      sourceIndex: 0,
      targetY: 190,
      result: "drop",
      expectedTransactions: 1,
      expectedProjection: ([first, ...rest]) => [...rest, first!],
    });
    drag({
      sourceIndex: 2,
      targetY: 45,
      result: "drop",
      expectedTransactions: 2,
      expectedProjection: ([first, second, third, fourth]) => [
        third!,
        first!,
        second!,
        fourth!,
      ],
    });
    const noOpSourceRect = fixture.container
      .querySelector<HTMLElement>("[data-table-row-carrier]")!
      .getBoundingClientRect();
    drag({
      sourceIndex: 0,
      targetY: noOpSourceRect.top + noOpSourceRect.height / 2 + 7,
      result: "drop",
      expectedTransactions: 2,
      expectedProjection: (canonical) => canonical,
    });
    drag({
      sourceIndex: 0,
      targetY: 190,
      result: "cancel",
      expectedTransactions: 2,
      expectedProjection: ([first, ...rest]) => [...rest, first!],
    });
    drag({
      sourceIndex: 3,
      targetY: 45,
      result: "drop",
      expectedTransactions: 3,
      expectedProjection: ([first, second, third, fourth]) => [
        fourth!,
        first!,
        second!,
        third!,
      ],
    });
    fixture.dispose();
  });

  it("keeps row, column, document, row, and column operation state isolated without remounting", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const transaction = vi.spyOn(fixture.editor, "transaction");
    const assertClean = () => {
      expect(fixture.tableDragStore.getSnapshot().session).toBeNull();
      expect(
        document.querySelector(
          ".table-block__row-drag-overlay, .table-block__column-drag-overlay, .first-draft-document-block-drag-overlay",
        ),
      ).toBeNull();
      expect(
        activeDragBoundary(fixture.container).hasAttribute(
          "data-first-draft-active-drag-group",
        ),
      ).toBe(false);
      expect(transaction).not.toHaveBeenCalled();
      expect(fixture.onChange).not.toHaveBeenCalled();
    };
    const cancelRow = () => {
      const carrier = fixture.container.querySelector<HTMLElement>(
        "[data-table-row-carrier]",
      )!;
      const sourceRect = carrier.getBoundingClientRect();
      const startY = sourceRect.top + sourceRect.height / 2;
      fireEvent(
        trigger(fixture.container, "row", 0),
        tablePointerEvent("pointerdown", startY),
      );
      fireEvent(window, tablePointerEvent("pointermove", startY + 7));
      flushAnimationFrames();
      expect(fixture.tableDragStore.getSnapshot().session).toMatchObject({
        axis: "row",
        sourceRect: {
          left: sourceRect.left,
          top: sourceRect.top,
          width: sourceRect.width,
          height: sourceRect.height,
        },
      });
      expect(document.querySelector(".table-block__row-drag-overlay")).not.toBeNull();
      expect(document.querySelector(".table-block__column-drag-overlay")).toBeNull();
      fireEvent(window, tablePointerEvent("pointercancel", startY + 7));
      flushAnimationFrames();
      assertClean();
    };
    const cancelColumn = () => {
      const carrier = fixture.container.querySelector<HTMLElement>(
        "[data-table-column-carrier]",
      )!;
      const sourceRect = carrier.getBoundingClientRect();
      const startX = sourceRect.left + sourceRect.width / 2;
      fireEvent(
        trigger(fixture.container, "column", 0),
        tablePointerEvent("pointerdown", 90, startX),
      );
      fireEvent(window, tablePointerEvent("pointermove", 90, startX + 7));
      flushAnimationFrames();
      expect(fixture.tableDragStore.getSnapshot().session).toMatchObject({
        axis: "column",
        sourceRect: {
          left: sourceRect.left,
          top: sourceRect.top,
          width: sourceRect.width,
          height: sourceRect.height,
        },
      });
      expect(
        document.querySelector(".table-block__column-drag-overlay"),
      ).not.toBeNull();
      expect(document.querySelector(".table-block__row-drag-overlay")).toBeNull();
      fireEvent(
        window,
        tablePointerEvent("pointercancel", 90, startX + 7),
      );
      flushAnimationFrames();
      assertClean();
    };

    cancelRow();
    cancelColumn();
    fireEvent.pointerMove(
      fixture.container.querySelector(".table-block__object")!,
    );
    const blockDragHandle = fixture.container.querySelector<HTMLButtonElement>(
      '.table-block__chrome-anchor button[aria-label="Drag block or open block actions"]',
    );
    if (!blockDragHandle) throw new Error("Missing table block drag handle");
    fireEvent(blockDragHandle, tablePointerEvent("pointerdown", 20, 20));
    fireEvent(window, tablePointerEvent("pointermove", 27, 20));
    flushAnimationFrames();
    expect(
      document.querySelector(".first-draft-document-block-drag-overlay"),
    ).not.toBeNull();
    expect(fixture.tableDragStore.getSnapshot().session).toBeNull();
    expect(
      document.querySelector(
        ".table-block__row-drag-overlay, .table-block__column-drag-overlay",
      ),
    ).toBeNull();
    fireEvent(window, tablePointerEvent("pointercancel", 27, 20));
    flushAnimationFrames();
    assertClean();
    cancelRow();
    cancelColumn();
    fixture.dispose();
  });

  it("keeps the active row carriers registered through horizontal clipping and commits after scrolling", () => {
    let observeFinalized: ((change: EditorSemanticChange) => void) | null =
      null;
    const fixture = renderFixture(
      false,
      undefined,
      createFirstDraftSnapshot(),
      (change) => observeFinalized?.(change),
    );
    const connection = new RuntimePresenceConnection();
    const publishSelection = vi.fn();
    const outbound = createFirstDraftOutboundPublisher();
    outbound.attachGeneration({
      generationId: "table-action-menu",
      socket: connection.socket,
      createTransactionId: () => crypto.randomUUID(),
      publishSelection,
    });
    outbound.generationCaughtUp();
    observeFinalized = (change) => outbound.submitFinalized(change);
    flushAnimationFrames();

    const canonicalRows = [...fixture.editor.getChildBlockIds(tableId)];
    const originalCarriers = new Map(
      [...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-row-carrier]",
      )].map((carrier) => [carrier.dataset.tableRowCarrier!, carrier]),
    );
    const transaction = vi.spyOn(fixture.editor, "transaction");
    const historyBefore = {
      canUndo: fixture.editor.canUndo,
      canRedo: fixture.editor.canRedo,
    };
    fixture.onChange.mockClear();

    const sourceTrigger = trigger(fixture.container, "row", 0);
    fireEvent(sourceTrigger, tablePointerEvent("pointerdown", 60));
    fireEvent(window, tablePointerEvent("pointermove", 150));
    flushAnimationFrames();
    const beforeScroll = fixture.tableDragStore.getSnapshot().session;
    if (beforeScroll?.axis !== "row") {
      throw new Error("Expected an active row drag session");
    }
    expect(beforeScroll.projectedRowIds).not.toEqual(canonicalRows);
    expect(fixture.editor.getChildBlockIds(tableId)).toEqual(canonicalRows);

    scrollBounds = domRect(0, 0, 300, 220);
    gridBounds = domRect(-300, 40, defaultGridWidth, 160);
    fireEvent.scroll(
      fixture.container.querySelector(".table-block__scroll")!,
    );
    flushAnimationFrames();

    const lane = fixture.container.querySelector<HTMLElement>(
      "[data-table-row-carrier-lane]",
    );
    expect(lane?.isConnected).toBe(true);
    const scrolledCarriers = [
      ...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-row-carrier]",
      ),
    ];
    expect(scrolledCarriers).toHaveLength(canonicalRows.length);
    for (const carrier of scrolledCarriers) {
      const stableId = carrier.dataset.tableRowCarrier!;
      expect(carrier).toBe(originalCarriers.get(stableId));
      expect(carrier.isConnected).toBe(true);
      expect(carrier.getBoundingClientRect().width).toBe(defaultGridWidth);
      expect(carrier.getBoundingClientRect().height).toBe(40);
    }
    expect(triggers(fixture.container, "row")).toEqual([]);
    expect(fixture.tableDragStore.getSnapshot().session).toMatchObject({
      axis: "row",
      status: "dragging",
      valid: true,
    });
    expect(transaction).not.toHaveBeenCalled();
    expect(fixture.onChange).not.toHaveBeenCalled();
    expect(connection.sent).toEqual([]);
    expect(publishSelection).not.toHaveBeenCalled();
    expect({
      canUndo: fixture.editor.canUndo,
      canRedo: fixture.editor.canRedo,
    }).toEqual(historyBefore);

    fireEvent(window, tablePointerEvent("pointermove", 190));
    flushAnimationFrames();
    const afterScroll = fixture.tableDragStore.getSnapshot().session;
    if (afterScroll?.axis !== "row") {
      throw new Error("Expected row preview to remain active after scrolling");
    }
    expect(afterScroll.projectedRowIds).not.toEqual(
      beforeScroll.projectedRowIds,
    );
    expect(fixture.editor.getChildBlockIds(tableId)).toEqual(canonicalRows);

    fireEvent(window, tablePointerEvent("pointerup", 190));

    expect(transaction).toHaveBeenCalledOnce();
    expect(fixture.onChange).toHaveBeenCalledOnce();
    expect(connection.sent).toHaveLength(1);
    expect(publishSelection).toHaveBeenCalledOnce();
    expect(fixture.editor.getChildBlockIds(tableId)).toEqual(
      afterScroll.projectedRowIds,
    );
    outbound.dispose();
    fixture.dispose();
  });

  it("keeps row carriers connected through horizontal clipping and cancels without a transaction", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const canonicalRows = [...fixture.editor.getChildBlockIds(tableId)];
    const transaction = vi.spyOn(fixture.editor, "transaction");
    fixture.onChange.mockClear();
    const originalCarriers = new Map(
      [...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-row-carrier]",
      )].map((carrier) => [carrier.dataset.tableRowCarrier!, carrier]),
    );

    fireEvent(
      trigger(fixture.container, "row", 0),
      tablePointerEvent("pointerdown", 60),
    );
    fireEvent(window, tablePointerEvent("pointermove", 150));
    scrollBounds = domRect(0, 0, 300, 220);
    gridBounds = domRect(-300, 40, defaultGridWidth, 160);
    fireEvent.scroll(
      fixture.container.querySelector(".table-block__scroll")!,
    );
    flushAnimationFrames();

    expect(
      [...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-row-carrier]",
      )].every(
        (carrier) =>
          carrier === originalCarriers.get(carrier.dataset.tableRowCarrier!),
      ),
    ).toBe(true);
    expect(fixture.tableDragStore.getSnapshot().session).toMatchObject({
      axis: "row",
      valid: true,
    });
    expect(
      fixture.container.querySelectorAll(
        '[data-table-drag-placeholder="row"]',
      ),
    ).toHaveLength(3);
    expect(document.querySelector(".table-block__row-drag-overlay")).not.toBeNull();
    expect(
      activeDragBoundary(fixture.container).dataset
        .firstDraftActiveDragGroup,
    ).toBe(TABLE_ROW_DND_GROUP);

    fireEvent(window, tablePointerEvent("pointercancel", 150));
    flushAnimationFrames();

    expect(fixture.tableDragStore.getSnapshot().session).toBeNull();
    expect(fixture.editor.getChildBlockIds(tableId)).toEqual(canonicalRows);
    expect(transaction).not.toHaveBeenCalled();
    expect(fixture.onChange).not.toHaveBeenCalled();
    expect(document.querySelector(".table-block__row-drag-overlay")).toBeNull();
    expect(
      activeDragBoundary(fixture.container).hasAttribute(
        "data-first-draft-active-drag-group",
      ),
    ).toBe(false);
    expect(
      fixture.container.querySelectorAll("[data-table-drag-placeholder]"),
    ).toHaveLength(0);
    fixture.dispose();
  });

  it("follows provider-owned row reversal hysteresis and resumes after target exit and re-entry", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const canonicalRows = [...fixture.editor.getChildBlockIds(tableId)];
    const sourceTrigger = trigger(fixture.container, "row", 0);

    fireEvent(sourceTrigger, tablePointerEvent("pointerdown", 60));
    fireEvent(window, tablePointerEvent("pointermove", 150));
    flushAnimationFrames();
    const projected = fixture.tableDragStore.getSnapshot().session;
    if (projected?.axis !== "row") {
      throw new Error("Expected a projected row session");
    }
    expect(projected.projectedRowIds).not.toEqual(canonicalRows);

    fireEvent(window, tablePointerEvent("pointermove", 145));
    flushAnimationFrames();
    const slightReverse = fixture.tableDragStore.getSnapshot().session;
    expect(
      slightReverse?.axis === "row" ? slightReverse.projectedRowIds : null,
    ).toEqual(projected.projectedRowIds);

    fireEvent(window, tablePointerEvent("pointermove", 70));
    flushAnimationFrames();
    const fullReverse = fixture.tableDragStore.getSnapshot().session;
    if (fullReverse?.axis !== "row") {
      throw new Error("Expected the reversed row session");
    }
    expect(fullReverse.projectedRowIds).not.toEqual(projected.projectedRowIds);

    fireEvent(window, tablePointerEvent("pointermove", 70, 700));
    flushAnimationFrames();
    expect(fixture.tableDragStore.getSnapshot().session).toMatchObject({
      axis: "row",
      valid: true,
    });

    fireEvent(window, tablePointerEvent("pointermove", 150, 90));
    flushAnimationFrames();
    const reentered = fixture.tableDragStore.getSnapshot().session;
    if (reentered?.axis !== "row") {
      throw new Error("Expected row targeting to resume after re-entry");
    }
    expect(reentered.projectedRowIds).not.toEqual(canonicalRows);

    fireEvent(window, tablePointerEvent("pointermove", 60, 90));
    flushAnimationFrames();
    const returned = fixture.tableDragStore.getSnapshot().session;
    expect(
      returned?.axis === "row" ? returned.projectedRowIds : null,
    ).toEqual(canonicalRows);
    fireEvent(window, tablePointerEvent("pointerup", 60, 90));
    expect(fixture.onChange).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("keeps an active cell caret anchored through row preview and the preserving move transaction", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const sourceRowId = fixture.editor.getChildBlockIds(tableId)[0]!;
    const sourceCellId = fixture.editor.getChildBlockIds(sourceRowId)[0]!;
    act(() => {
      expect(
        fixture.editor.focusText(sourceCellId, {
          offset: 1,
          preventScroll: true,
        }).status,
      ).not.toBe("rejected");
    });
    const selectionBefore =
      fixture.editor.selectionController.getCanonicalSnapshot();
    if (selectionBefore.kind !== "document") {
      throw new Error("Expected a document caret inside the source row");
    }
    const standaloneSettlements: EditorStableSelection[] = [];
    const unsubscribe =
      fixture.editor.subscribeStandaloneSelectionSettlements((selection) =>
        standaloneSettlements.push(selection),
      );
    fixture.onChange.mockClear();

    const rowTrigger = trigger(fixture.container, "row", 0);
    fireEvent(rowTrigger, tablePointerEvent("pointerdown", 60));
    fireEvent(window, tablePointerEvent("pointermove", 150));
    flushAnimationFrames();

    expect(fixture.onChange).not.toHaveBeenCalled();
    expect(standaloneSettlements).toEqual([]);
    expect(
      fixture.editor.selectionController.getCanonicalSnapshot(),
    ).toBe(selectionBefore);

    fireEvent(window, tablePointerEvent("pointerup", 150));

    expect(fixture.onChange).toHaveBeenCalledOnce();
    expect(standaloneSettlements).toEqual([]);
    expect(fixture.onChange.mock.calls[0]![0].selectionAfter).toMatchObject({
      kind: "selection",
      selection: expect.objectContaining({
        kind: "document",
        anchor: expect.objectContaining({ blockId: sourceCellId }),
        focus: expect.objectContaining({ blockId: sourceCellId }),
      }),
    });
    expect(
      fixture.editor.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({
      kind: "document",
      snapshot: {
        endpoints: {
          anchor: { blockId: sourceCellId, textOffset: 1 },
          head: { blockId: sourceCellId, textOffset: 1 },
        },
      },
    });
    unsubscribe();
    fixture.dispose();
  });

  it("selects exactly one complete row with canonical perimeter paint before opening", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const targetRowId = fixture.editor.getChildBlockIds(tableId)[1]!;
    const targetCells = fixture.editor.getChildBlockIds(targetRowId);

    fireEvent.click(trigger(fixture.container, "row", 1));

    expect(fixture.store.getSnapshot()).toMatchObject({
      kind: "open",
      tableId,
      target: { kind: "row", rowId: targetRowId },
      ownedTableRange: {
        kind: "cell-range",
        anchorCellId: targetCells[0],
        headCellId: targetCells.at(-1),
      },
    });
    expectCanonicalTableRange(
      fixture.editor,
      targetCells[0]!,
      targetCells.at(-1)!,
    );
    expect(
      fixture.editor.selectionController.getPresentationSnapshot().settlement,
    ).toMatchObject({
      cause: "pointer",
      publication: { kind: "standalone-local" },
    });
    expectSelectedCells(fixture.container, targetCells);
    expectRowPerimeter(fixture.container, targetCells);
    fixture.dispose();
  });

  it("selects exactly one complete column with canonical perimeter paint before opening", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const rows = fixture.editor.getChildBlockIds(tableId);
    const targetCells = rows.map(
      (currentRowId) => fixture.editor.getChildBlockIds(currentRowId)[1]!,
    );

    fireEvent.click(trigger(fixture.container, "column", 1));

    expect(fixture.store.getSnapshot()).toMatchObject({
      kind: "open",
      tableId,
      target: { kind: "column" },
      ownedTableRange: {
        kind: "cell-range",
        anchorCellId: targetCells[0],
        headCellId: targetCells.at(-1),
      },
    });
    expectCanonicalTableRange(
      fixture.editor,
      targetCells[0]!,
      targetCells.at(-1)!,
    );
    expectSelectedCells(fixture.container, targetCells);
    expectColumnPerimeter(fixture.container, targetCells);
    fixture.dispose();
  });

  it("mounts every visible control zone before hover and opens each axis by direct entry", () => {
    const fixture = renderFixture();
    flushAnimationFrames();

    const rowTriggers = triggers(fixture.container, "row");
    const columnTriggers = triggers(fixture.container, "column");
    expect(rowTriggers).toHaveLength(
      fixture.editor.getChildBlockIds(tableId).length,
    );
    expect(columnTriggers).toHaveLength(
      resolveColumnIds(fixture.editor).length,
    );
    expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });
    expect(
      fixture.container
        .querySelector(".table-block__action-control-overlay")
        ?.hasAttribute("aria-hidden"),
    ).toBe(false);
    for (const actionTrigger of [...rowTriggers, ...columnTriggers]) {
      const controlZone = actionTrigger.parentElement;
      expect(controlZone?.hasAttribute("data-cell-hovered")).toBe(false);
      expect(controlZone?.hasAttribute("data-control-hovered")).toBe(false);
      expect(controlZone?.hasAttribute("data-open")).toBe(false);
      expect(actionTrigger.getAttribute("aria-expanded")).toBe("false");
    }

    const firstRowTrigger = trigger(fixture.container, "row", 0);
    const firstRowZone = zone(fixture.container, "row", 0);
    expect(
      firstRowZone.classList.contains("table-block__action-control-zone--row"),
    ).toBe(true);
    expect(
      firstRowTrigger.classList.contains("table-block__action-trigger"),
    ).toBe(true);
    fireEvent.pointerEnter(firstRowZone);
    expect(firstRowZone.dataset.controlHovered).toBe("true");
    expect(trigger(fixture.container, "row", 0)).toBe(firstRowTrigger);
    fireEvent.click(firstRowZone, { clientX: 69, clientY: 79 });
    expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });
    fireEvent.click(firstRowTrigger, { clientX: 84, clientY: 79 });
    expect(fixture.store.getSnapshot()).toMatchObject({
      kind: "open",
      target: { kind: "row", rowId },
    });
    fireEvent.keyDown(
      document.querySelector(`#${fixture.store.menuId} [role="menuitem"]`)!,
      { key: "Escape" },
    );
    expect(trigger(fixture.container, "row", 0)).toBe(firstRowTrigger);

    const secondColumnTrigger = trigger(fixture.container, "column", 1);
    const secondColumnZone = zone(fixture.container, "column", 1);
    expect(
      secondColumnZone.classList.contains(
        "table-block__action-control-zone--column",
      ),
    ).toBe(true);
    expect(
      secondColumnTrigger.classList.contains("table-block__action-trigger"),
    ).toBe(true);
    fireEvent.pointerEnter(secondColumnZone);
    expect(secondColumnZone.dataset.controlHovered).toBe("true");
    expect(trigger(fixture.container, "column", 1)).toBe(secondColumnTrigger);
    fireEvent.click(secondColumnTrigger, { clientX: 307, clientY: 32 });
    expect(fixture.store.getSnapshot()).toMatchObject({
      kind: "open",
      target: {
        kind: "column",
        identity: {
          kind: "canonical",
          columnId: resolveColumnIds(fixture.editor)[1],
        },
      },
    });
    fixture.dispose();
  });

  it.each(["row", "column"] as const)(
    "keeps the %s trigger mounted across cell, gap bridge, and button transitions",
    (axis) => {
      const fixture = renderFixture();
      flushAnimationFrames();
      const cell = fixture.container.querySelector<HTMLElement>(
        `[data-table-cell-id="${cellId}"]`,
      );
      if (!cell) throw new Error("Missing table cell");
      const actionTrigger = trigger(fixture.container, axis, 0);
      const controlZone = zone(fixture.container, axis, 0);
      const gapBridge = bridge(fixture.container, axis, 0);

      fireEvent.pointerOver(cell);
      expect(controlZone.dataset.cellHovered).toBe("true");

      fireEvent.pointerOut(cell, { relatedTarget: gapBridge });
      fireEvent.pointerOver(gapBridge, { relatedTarget: cell });
      expect(controlZone.dataset.controlHovered).toBe("true");
      expect(trigger(fixture.container, axis, 0)).toBe(actionTrigger);

      fireEvent.pointerOut(gapBridge, { relatedTarget: actionTrigger });
      fireEvent.pointerOver(actionTrigger, { relatedTarget: gapBridge });
      expect(controlZone.dataset.controlHovered).toBe("true");
      expect(trigger(fixture.container, axis, 0)).toBe(actionTrigger);

      fireEvent.pointerOut(actionTrigger, { relatedTarget: gapBridge });
      fireEvent.pointerOver(gapBridge, { relatedTarget: actionTrigger });
      expect(controlZone.dataset.controlHovered).toBe("true");
      expect(trigger(fixture.container, axis, 0)).toBe(actionTrigger);
      expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });

      fireEvent.pointerOut(gapBridge, { relatedTarget: fixture.container });
      expect(controlZone.hasAttribute("data-control-hovered")).toBe(false);
      expect(trigger(fixture.container, axis, 0)).toBe(actionTrigger);
      fixture.dispose();
    },
  );

  it("keeps row and column gap bridges noninteractive presentation infrastructure", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const selectionBefore =
      fixture.editor.selectionController.getCanonicalSnapshot();
    const historyBefore = {
      canUndo: fixture.editor.canUndo,
      canRedo: fixture.editor.canRedo,
    };
    const transaction = vi.spyOn(fixture.editor, "transaction");
    const focusedBefore = document.activeElement;

    for (const axis of ["row", "column"] as const) {
      const controlZone = zone(fixture.container, axis, 0);
      const gapBridge = bridge(fixture.container, axis, 0);
      const actionTrigger = trigger(fixture.container, axis, 0);
      expect(controlZone.querySelectorAll(".table-block__action-control-bridge")).toHaveLength(1);
      expect(gapBridge.tagName).toBe("SPAN");
      expect(gapBridge.getAttribute("aria-hidden")).toBe("true");
      expect(gapBridge.hasAttribute("role")).toBe(false);
      expect(gapBridge.hasAttribute("tabindex")).toBe(false);
      expect(gapBridge.hasAttribute("data-dnd-drag-handle")).toBe(false);
      expect(gapBridge.closest("button")).toBeNull();
      expect(gapBridge.closest("[data-table-row-carrier]")).toBeNull();
      expect(gapBridge.closest("[data-table-column-carrier]")).toBeNull();
      expect(gapBridge.parentElement).toBe(controlZone);
      expect(actionTrigger.parentElement).toBe(controlZone);
      expect(gapBridge.nextElementSibling).toBe(actionTrigger);

      fireEvent(gapBridge, tablePointerEvent("pointerdown", 30, 90));
      fireEvent(window, tablePointerEvent("pointermove", 30, 110));
      fireEvent(window, tablePointerEvent("pointerup", 30, 110));
      fireEvent.click(gapBridge);

      expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });
      expect(fixture.tableDragStore.getSnapshot().session).toBeNull();
      expect(document.activeElement).toBe(focusedBefore);
      expect(
        fixture.editor.selectionController.getCanonicalSnapshot(),
      ).toBe(selectionBefore);
      expect(transaction).not.toHaveBeenCalled();
      expect(fixture.onChange).not.toHaveBeenCalled();
      expect({
        canUndo: fixture.editor.canUndo,
        canRedo: fixture.editor.canRedo,
      }).toEqual(historyBefore);
    }
    fixture.dispose();
  });

  it("opens a synthetic presentation column by direct zone entry", () => {
    const fixture = renderFixture(
      false,
      undefined,
      snapshotWithColumnIds(undefined),
    );
    flushAnimationFrames();

    expect(triggers(fixture.container, "row")).toHaveLength(
      fixture.editor.getChildBlockIds(tableId).length,
    );
    expect(triggers(fixture.container, "column")).toHaveLength(3);
    const metadataBefore = fixture.editor.getBlock(tableId)?.metadata;
    const rows = fixture.editor.getChildBlockIds(tableId);
    const targetCells = rows.map(
      (currentRowId) => fixture.editor.getChildBlockIds(currentRowId)[1]!,
    );
    const syntheticZone = zone(fixture.container, "column", 1);
    fireEvent.pointerEnter(syntheticZone);
    fireEvent.click(trigger(fixture.container, "column", 1));
    expect(fixture.store.getSnapshot()).toMatchObject({
      kind: "open",
      target: {
        kind: "column",
        identity: {
          kind: "synthetic-presentation",
          presentationId: "column-2",
          indexAtOpen: 1,
          columnCountAtOpen: 3,
        },
      },
    });
    expectCanonicalTableRange(
      fixture.editor,
      targetCells[0]!,
      targetCells.at(-1)!,
    );
    expect(fixture.editor.getBlock(tableId)?.metadata).toEqual(metadataBefore);
    expect(fixture.onChange).not.toHaveBeenCalled();
    fixture.dispose();
  });

  it("keeps persistent control instances across cell continuity and direct exit", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const cell = fixture.container.querySelector<HTMLElement>(
      `[data-table-cell-id="${cellId}"]`,
    );
    if (!cell) throw new Error("Missing table cell");
    const rowTrigger = trigger(fixture.container, "row", 0);
    const columnTrigger = trigger(fixture.container, "column", 0);
    const rowZone = zone(fixture.container, "row", 0);
    const columnZone = zone(fixture.container, "column", 0);

    fireEvent.pointerOver(cell);
    expect(rowZone.dataset.cellHovered).toBe("true");
    expect(columnZone.dataset.cellHovered).toBe("true");
    fireEvent.pointerOut(cell, { relatedTarget: rowZone });
    fireEvent.pointerEnter(rowZone, { relatedTarget: cell });
    expect(trigger(fixture.container, "row", 0)).toBe(rowTrigger);
    expect(rowZone.dataset.controlHovered).toBe("true");

    fireEvent.pointerOver(cell, { relatedTarget: rowZone });
    fireEvent.pointerOut(cell, { relatedTarget: columnZone });
    fireEvent.pointerEnter(columnZone, { relatedTarget: cell });
    expect(trigger(fixture.container, "column", 0)).toBe(columnTrigger);
    expect(columnZone.dataset.controlHovered).toBe("true");

    fireEvent.pointerLeave(columnZone);
    expect(columnZone.hasAttribute("data-control-hovered")).toBe(false);
    expect(trigger(fixture.container, "column", 0)).toBe(columnTrigger);
    fireEvent.pointerEnter(columnZone);
    expect(trigger(fixture.container, "column", 0)).toBe(columnTrigger);
    expect(columnZone.dataset.controlHovered).toBe("true");
    fixture.dispose();
  });

  it.each(["Enter", " ", "ArrowDown"])(
    "opens a focused persistent trigger with %s before any hover",
    (key) => {
      const fixture = renderFixture();
      const settlements: EditorStableSelection[] = [];
      fixture.editor.subscribeStandaloneSelectionSettlements((selection) =>
        settlements.push(selection),
      );
      flushAnimationFrames();
      const actionTrigger = trigger(fixture.container, "row", 0);
      const targetCells = fixture.editor.getChildBlockIds(rowId);
      const controlZone = zone(fixture.container, "row", 0);
      actionTrigger.focus();
      expect(document.activeElement).toBe(actionTrigger);
      expect(controlZone.contains(document.activeElement)).toBe(true);
      fireEvent.keyDown(actionTrigger, { key });
      const menu = document.getElementById(fixture.store.menuId);
      expect(menu).not.toBeNull();
      expect(document.activeElement).toBe(
        menu?.querySelector('[role="menuitem"]'),
      );
      expectCanonicalTableRange(
        fixture.editor,
        targetCells[0]!,
        targetCells.at(-1)!,
      );
      expect(
        fixture.editor.selectionController.getPresentationSnapshot().settlement,
      ).toMatchObject({
        cause: "keyboard",
        publication: { kind: "standalone-local" },
      });
      expect(settlements).toEqual([
        {
          kind: "selection",
          selection: {
            kind: "block-internal",
            blockId: tableId,
            subsystem: "table.cell-range",
            payload: {
              kind: "cell-range",
              anchorCellId: targetCells[0],
              headCellId: targetCells.at(-1),
            },
          },
        },
      ]);
      fireEvent.click(actionTrigger);
      expect(settlements).toHaveLength(1);
      const firstItem = menu?.querySelector<HTMLElement>('[role="menuitem"]');
      if (!firstItem) throw new Error("Missing keyboard-opened menu item");
      fireEvent.keyDown(firstItem, { key: "ArrowDown" });
      expect(document.activeElement?.textContent).toBe("Insert row above");
      fixture.dispose();
    },
  );

  it.each(["Enter", " "])(
    "keeps column trigger %s as menu activation rather than keyboard sorting",
    (key) => {
      const fixture = renderFixture();
      flushAnimationFrames();
      const actionTrigger = trigger(fixture.container, "column", 1);
      const rows = fixture.editor.getChildBlockIds(tableId);
      actionTrigger.focus();

      fireEvent.keyDown(actionTrigger, { key });

      expect(fixture.store.getSnapshot()).toMatchObject({
        kind: "open",
        target: { kind: "column" },
      });
      expectCanonicalTableRange(
        fixture.editor,
        fixture.editor.getChildBlockIds(rows[0]!)[1]!,
        fixture.editor.getChildBlockIds(rows.at(-1)!)[1]!,
      );
      expect(fixture.tableDragStore.getSnapshot().session).toBeNull();
      fixture.dispose();
    },
  );

  it("publishes changed axis selections once without document transactions or history", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const settlements: EditorStableSelection[] = [];
    fixture.editor.subscribeStandaloneSelectionSettlements((selection) =>
      settlements.push(selection),
    );
    const historyBefore = {
      canUndo: fixture.editor.canUndo,
      canRedo: fixture.editor.canRedo,
    };

    fireEvent.click(trigger(fixture.container, "row", 1));
    const rowSelection = settlements[0];
    const rowItem = document.querySelector<HTMLElement>(
      `#${fixture.store.menuId} [role="menuitem"]`,
    );
    fireEvent.keyDown(rowItem!, { key: "Escape" });
    fireEvent.click(trigger(fixture.container, "row", 1));
    expect(settlements).toEqual([rowSelection]);
    fireEvent.keyDown(
      document.querySelector<HTMLElement>(
        `#${fixture.store.menuId} [role="menuitem"]`,
      )!,
      { key: "Escape" },
    );

    fireEvent.click(trigger(fixture.container, "column", 1));
    const rows = fixture.editor.getChildBlockIds(tableId);
    expect(settlements).toEqual([
      {
        kind: "selection",
        selection: {
          kind: "block-internal",
          blockId: tableId,
          subsystem: "table.cell-range",
          payload: {
            kind: "cell-range",
            anchorCellId: "fd-table-cell-2-1",
            headCellId: "fd-table-cell-2-3",
          },
        },
      },
      {
        kind: "selection",
        selection: {
          kind: "block-internal",
          blockId: tableId,
          subsystem: "table.cell-range",
          payload: {
            kind: "cell-range",
            anchorCellId: fixture.editor.getChildBlockIds(rows[0]!)[1],
            headCellId: fixture.editor.getChildBlockIds(rows.at(-1)!)[1],
          },
        },
      },
    ]);
    expect(fixture.onChange).not.toHaveBeenCalled();
    expect({
      canUndo: fixture.editor.canUndo,
      canRedo: fixture.editor.canRedo,
    }).toEqual(historyBefore);
    fixture.dispose();
  });

  it("does not open or alter selection when canonical commitment is rejected", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const before = fixture.editor.selectionController.getCanonicalSnapshot();
    vi.spyOn(
      fixture.editor.selectionController,
      "commitBlockSelection",
    ).mockReturnValue({ kind: "rejected", retainedSelection: before });

    fireEvent.click(trigger(fixture.container, "row", 1));

    expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });
    expect(fixture.editor.selectionController.getCanonicalSnapshot()).toBe(
      before,
    );
    fixture.dispose();
  });

  it("remeasures persistent zones for scrolling, clipping, resize, and deletion", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const scroll = fixture.container.querySelector<HTMLElement>(
      ".table-block__scroll",
    );
    if (!scroll) throw new Error("Missing table scroll viewport");
    const rootShell = scroll.closest<HTMLElement>(
      '.editor-web-block[data-editor-root-layout="full"][data-editor-block-type="table"]',
    )!;
    const rowLane = fixture.container.querySelector<HTMLElement>(
      "[data-table-row-carrier-lane]",
    )!;
    const columnLane = fixture.container.querySelector<HTMLElement>(
      "[data-table-column-carrier-lane]",
    )!;
    const rowCarriers = [
      ...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-row-carrier]",
      ),
    ];
    const columnCarriers = [
      ...fixture.container.querySelectorAll<HTMLElement>(
        "[data-table-column-carrier]",
      ),
    ];
    const initialFirstColumn = trigger(fixture.container, "column", 0);

    scrollBounds = domRect(0, 0, 300, 220);
    gridBounds = domRect(60, 40, defaultGridWidth, 160);
    fireEvent.scroll(scroll);
    flushAnimationFrames();
    expect(zone(fixture.container, "row", 0).style.left).toBe("40px");
    expect(zone(fixture.container, "column", 0).style).toMatchObject({
      left: "60px",
      width: "208px",
    });
    expect(zone(fixture.container, "column", 1).style).toMatchObject({
      left: "268px",
      width: "32px",
    });
    expect(triggers(fixture.container, "column")).toHaveLength(2);

    scrollBounds = domRect(0, 0, 300, 220);
    gridBounds = domRect(-300, 40, defaultGridWidth, 160);
    fireEvent.scroll(scroll);
    flushAnimationFrames();
    expect(initialFirstColumn.isConnected).toBe(false);
    expect(
      triggers(fixture.container, "column").map((item) => item.ariaLabel),
    ).toEqual(["Column 2 actions", "Column 3 actions"]);
    expect(zone(fixture.container, "column", 1).style.width).toBe("116px");
    expect(triggers(fixture.container, "row")).toEqual([]);
    expect(rootShell.isConnected).toBe(true);
    expect(rowLane.isConnected).toBe(true);
    expect(columnLane.isConnected).toBe(true);
    expect(rowLane.style).toMatchObject({ left: "-300px", width: "624px" });
    expect(columnLane.style.left).toBe("-300px");
    expect(
      rowCarriers.every(
        (carrier) =>
          carrier.isConnected &&
          carrier.style.width === "624px" &&
          carrier.style.height === "40px",
      ),
    ).toBe(true);
    expect(
      columnCarriers.every(
        (carrier) =>
          carrier.isConnected &&
          carrier.style.width === "208px" &&
          carrier.style.height === "160px",
      ),
    ).toBe(true);
    const partiallyVisibleColumn = trigger(fixture.container, "column", 1);
    expect(partiallyVisibleColumn.getBoundingClientRect().width).toBe(116);
    fireEvent.click(partiallyVisibleColumn, { clientX: 115, clientY: 28 });
    flushAnimationFrames();
    const partiallyVisibleMenu = document.getElementById(fixture.store.menuId);
    expect(
      partiallyVisibleMenu?.classList.contains("first-draft-table-action-menu"),
    ).toBe(true);
    expect(partiallyVisibleMenu?.style.left).toBe("8px");
    expect(partiallyVisibleMenu?.style.top).toBe("42px");
    const partiallyVisibleMenuItem =
      partiallyVisibleMenu?.querySelector('[role="menuitem"]');
    if (!partiallyVisibleMenuItem)
      throw new Error("Missing partially visible column menu item");
    fireEvent.keyDown(partiallyVisibleMenuItem, { key: "Escape" });

    scrollBounds = domRect(0, 0, 800, 220);
    gridBounds = domRect(100, 40, defaultGridWidth, 160);
    rowBounds.set(
      "fd-table-row-1",
      domRect(100, -20, defaultGridWidth, 40),
    );
    rowBounds.set(
      "fd-table-row-4",
      domRect(100, 240, defaultGridWidth, 40),
    );
    fireEvent.scroll(document);
    flushAnimationFrames();
    expect(
      fixture.container.querySelector<HTMLElement>(
        '[data-table-row-carrier="fd-table-row-1"]',
      )?.style.height,
    ).toBe("40px");
    expect(
      fixture.container.querySelector('[aria-label="Row 4 actions"]'),
    ).not.toBeNull();

    rowBounds.clear();
    const firstRowZone = zone(fixture.container, "row", 0);
    objectBounds = domRect(10, 0, 800, 260);
    gridBounds = domRect(110, 40, defaultGridWidth, 160);
    fireEvent.resize(window);
    flushAnimationFrames();
    expect(zone(fixture.container, "row", 0)).toBe(firstRowZone);
    expect(
      fixture.container.querySelector<HTMLElement>(
        "[data-table-row-carrier-lane]",
      )?.style.left,
    ).toBe("100px");

    const lastRowTrigger = trigger(
      fixture.container,
      "row",
      fixture.editor.getChildBlockIds(tableId).length - 1,
    );
    deleteFirstDraftTableRow(
      fixture.editor,
      tableId,
      fixture.editor.getChildBlockIds(tableId).at(-1)!,
    );
    flushAnimationFrames();
    expect(lastRowTrigger.isConnected).toBe(false);
    expect(triggers(fixture.container, "row")).toHaveLength(3);

    const lastColumnIndex = resolveColumnIds(fixture.editor).length - 1;
    const lastColumnTrigger = trigger(
      fixture.container,
      "column",
      lastColumnIndex,
    );
    deleteFirstDraftTableColumn(fixture.editor, tableId, {
      kind: "canonical",
      columnId: resolveColumnIds(fixture.editor)[lastColumnIndex]!,
    });
    flushAnimationFrames();
    expect(lastColumnTrigger.isConnected).toBe(false);
    expect(
      fixture.container.querySelectorAll("[data-table-column-carrier]"),
    ).toHaveLength(2);
    flushAnimationFrames();
    expect(triggers(fixture.container, "column")).toHaveLength(2);
    fixture.dispose();
  });

  it("isolates direct control hover and open presentation by editor surface", () => {
    const first = renderFixture();
    const second = renderFixture();
    flushAnimationFrames();
    const firstZone = zone(first.container, "row", 0);
    const secondZone = zone(second.container, "row", 0);

    fireEvent.pointerEnter(firstZone);
    expect(firstZone.dataset.controlHovered).toBe("true");
    expect(secondZone.hasAttribute("data-control-hovered")).toBe(false);
    fireEvent.click(trigger(first.container, "row", 0));
    expect(firstZone.dataset.open).toBe("true");
    expect(secondZone.hasAttribute("data-open")).toBe(false);
    expect(first.store.getSnapshot().kind).toBe("open");
    expect(second.store.getSnapshot()).toEqual({ kind: "closed" });
    first.dispose();
    second.dispose();
  });

  it("owns hover locally and dispatches a fixed keyboard menu through document layers", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const before = fixture.editor.readSnapshot();
    const historyBefore = fixture.editor.canUndo;
    const cell = fixture.container.querySelector<HTMLElement>(
      `[data-table-cell-id="${cellId}"]`,
    );
    if (!cell) throw new Error("Missing table cell");

    fireEvent.pointerOver(cell);
    let rowTrigger = trigger(fixture.container, "row");
    const columnTrigger = trigger(fixture.container, "column");
    expect(rowTrigger.getAttribute("aria-label")).toBe("Row 1 actions");
    expect(columnTrigger.getAttribute("aria-label")).toBe("Column 1 actions");
    expect(rowTrigger.getAttribute("aria-expanded")).toBe("false");

    const columnZone = columnTrigger.parentElement;
    if (!columnZone) throw new Error("Missing column control wrapper");
    fireEvent.pointerOut(cell, { relatedTarget: columnZone });
    fireEvent.pointerEnter(columnZone, { relatedTarget: cell });
    expect(trigger(fixture.container, "column")).toBe(columnTrigger);
    fireEvent.pointerLeave(columnZone);
    expect(columnZone.hasAttribute("data-control-hovered")).toBe(false);
    expect(trigger(fixture.container, "column")).toBe(columnTrigger);
    fireEvent.pointerOver(cell);
    rowTrigger = trigger(fixture.container, "row");

    const rowZone = rowTrigger.parentElement;
    if (!rowZone) throw new Error("Missing row control wrapper");
    fireEvent.pointerOut(cell, { relatedTarget: rowZone });
    fireEvent.pointerEnter(rowZone, { relatedTarget: cell });
    expect(trigger(fixture.container, "row")).toBe(rowTrigger);

    fireEvent.focus(rowTrigger);
    fireEvent.pointerLeave(rowZone);
    expect(trigger(fixture.container, "row")).toBe(rowTrigger);

    fireEvent.click(rowTrigger);
    flushAnimationFrames();
    const menu = document.getElementById(fixture.store.menuId);
    expect(menu).not.toBeNull();
    expect(menu?.getAttribute("role")).toBe("menu");
    expect(menu?.style.left).toBe("76px");
    expect(menu?.style.top).toBe("86px");
    expect(menu?.closest(".table-block__scroll")).toBeNull();
    expect(
      menu?.closest('[data-editor-document-layer-host="true"]'),
    ).not.toBeNull();
    expect(rowTrigger.getAttribute("aria-expanded")).toBe("true");
    expect(rowTrigger.getAttribute("aria-controls")).toBe(fixture.store.menuId);
    expect(trigger(fixture.container, "column")).toBe(columnTrigger);
    expect(rowZone.dataset.open).toBe("true");
    rowTriggerLeft = 120;
    fireEvent.scroll(fixture.container.querySelector(".table-block__scroll")!);
    flushAnimationFrames();
    expect(menu?.style.left).toBe("120px");

    const items = [
      ...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []),
    ];
    expect(items.map((item) => item.textContent)).toEqual([
      "Delete row",
      "Insert row above",
      "Insert row below",
      "Duplicate row",
    ]);
    expectDecorativeActionIcons(items, [
      "Trash2",
      "ArrowUpFromLine",
      "ArrowDownFromLine",
      "Copy",
    ]);
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1]!, { key: "End" });
    expect(document.activeElement).toBe(items[3]);
    fireEvent.keyDown(items[3]!, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[3]);
    fireEvent.keyDown(items[3]!, { key: "Escape" });
    expect(document.getElementById(fixture.store.menuId)).toBeNull();
    expect(document.activeElement).toBe(rowTrigger);

    fireEvent.pointerOver(cell);
    const nextColumnTrigger = trigger(fixture.container, "column");
    fireEvent.keyDown(nextColumnTrigger, { key: "ArrowDown" });
    flushAnimationFrames();
    const columnMenu = document.getElementById(fixture.store.menuId);
    const columnItems = [
      ...(columnMenu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
        []),
    ];
    expect(columnItems.map((item) => item.textContent)).toEqual([
      "Delete column",
      "Insert column left",
      "Insert column right",
      "Duplicate column",
    ]);
    expectDecorativeActionIcons(columnItems, [
      "Trash2",
      "ArrowLeftFromLine",
      "ArrowRightFromLine",
      "Copy",
    ]);
    const firstColumnItem = columnItems[0];
    if (!firstColumnItem) throw new Error("Missing column action item");
    fireEvent.keyDown(firstColumnItem, { key: "Enter" });
    expect(document.getElementById(fixture.store.menuId)).toBeNull();
    expect(document.activeElement).not.toBe(nextColumnTrigger);

    expect(fixture.editor.readSnapshot()).not.toEqual(before);
    expect(fixture.editor.canUndo).toBe(true);
    expect(fixture.editor.canUndo).not.toBe(historyBefore);
    expect(fixture.onChange).toHaveBeenCalledOnce();
    expect(fixture.editor.getChildBlockIds(rowId)).toHaveLength(2);
    expectClearedCanonicalSelection(fixture.editor);
    expect(document.activeElement).toBe(
      fixture.container.querySelector("[data-table-grid]"),
    );
    expect(
      fixture.container
        .querySelector(".table-block__action-control-overlay")
        ?.parentElement?.querySelector(":scope > .table-block__scroll"),
    ).not.toBeNull();
    fixture.dispose();
  });

  it.each([
    {
      name: "near the bottom",
      triggerRect: domRect(76, 500, 16, 40),
      placement: "top",
      availableHeight: 486,
    },
    {
      name: "near the top",
      triggerRect: domRect(76, 40, 16, 40),
      placement: "bottom",
      availableHeight: 506,
    },
    {
      name: "where both sides fit and top has more space",
      triggerRect: domRect(76, 350, 16, 40),
      placement: "top",
      availableHeight: 336,
    },
    {
      name: "where both sides fit and bottom has more space",
      triggerRect: domRect(76, 200, 16, 40),
      placement: "bottom",
      availableHeight: 346,
    },
    {
      name: "at an exact space tie",
      triggerRect: domRect(76, 280, 16, 40),
      placement: "bottom",
      availableHeight: 266,
    },
  ])(
    "places the table menu on the greater-space side $name",
    ({ triggerRect, placement, availableHeight }) => {
      const fixture = renderFixture();
      flushAnimationFrames();
      const actionTrigger = trigger(fixture.container, "row", 0);
      elementBounds.set(actionTrigger, triggerRect);

      fireEvent.click(actionTrigger);
      flushAnimationFrames();

      const menu = document.getElementById(fixture.store.menuId);
      expect(menu?.dataset.placement).toBe(placement);
      expect(
        menu?.style.getPropertyValue(
          "--first-draft-table-menu-available-block-size",
        ),
      ).toBe(`${availableHeight}px`);
      fixture.dispose();
    },
  );

  it("intersects the browser viewport with the owning editor boundary", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const actionTrigger = trigger(fixture.container, "row", 0);
    const boundary = fixture.container.querySelector<HTMLElement>(
      ".first-draft-example__document-scroll",
    );
    if (!boundary) throw new Error("Missing owning document-scroll boundary");
    elementBounds.set(boundary, domRect(0, 100, 800, 400));
    elementBounds.set(actionTrigger, domRect(76, 400, 16, 40));

    fireEvent.click(actionTrigger);
    flushAnimationFrames();

    const menu = document.getElementById(fixture.store.menuId);
    expect(window.innerHeight).toBeGreaterThan(500);
    expect(menu?.dataset.placement).toBe("top");
    expect(
      menu?.style.getPropertyValue(
        "--first-draft-table-menu-available-block-size",
      ),
    ).toBe("286px");
    fixture.dispose();
  });

  it("projects the selected side's constrained height to the scrollable menu", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const actionTrigger = trigger(fixture.container, "column", 0);
    const boundary = fixture.container.querySelector<HTMLElement>(
      ".first-draft-example__document-scroll",
    );
    if (!boundary) throw new Error("Missing owning document-scroll boundary");
    elementBounds.set(boundary, domRect(0, 0, 800, 160));
    elementBounds.set(actionTrigger, domRect(100, 60, 176, 40));

    fireEvent.click(actionTrigger);
    flushAnimationFrames();

    const menu = document.getElementById(fixture.store.menuId);
    expect(menuBounds.height).toBeGreaterThan(46);
    expect(menu?.dataset.placement).toBe("bottom");
    expect(
      menu?.style.getPropertyValue(
        "--first-draft-table-menu-available-block-size",
      ),
    ).toBe("46px");
    expect(menu?.classList.contains("first-draft-table-action-menu")).toBe(
      true,
    );
    fixture.dispose();
  });

  it("switches placement on owning-boundary scroll without closing", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const actionTrigger = trigger(fixture.container, "column", 0);
    const boundary = fixture.container.querySelector<HTMLElement>(
      ".first-draft-example__document-scroll",
    );
    if (!boundary) throw new Error("Missing owning document-scroll boundary");
    elementBounds.set(actionTrigger, domRect(100, 100, 176, 16));
    fireEvent.click(actionTrigger);
    flushAnimationFrames();
    const menu = document.getElementById(fixture.store.menuId);
    expect(menu?.dataset.placement).toBe("bottom");

    elementBounds.set(actionTrigger, domRect(100, 500, 176, 16));
    fireEvent.scroll(boundary);
    flushAnimationFrames();

    expect(document.getElementById(fixture.store.menuId)).toBe(menu);
    expect(menu?.dataset.placement).toBe("top");
    expect(
      menu?.style.getPropertyValue(
        "--first-draft-table-menu-available-block-size",
      ),
    ).toBe("486px");
    fixture.dispose();
  });

  it("observes boundary and menu resizing without placement oscillation", () => {
    const resize = installResizeObserverTestDouble();
    const fixture = renderFixture();
    try {
      flushAnimationFrames();
      const actionTrigger = trigger(fixture.container, "row", 0);
      const boundary = fixture.container.querySelector<HTMLElement>(
        ".first-draft-example__document-scroll",
      );
      if (!boundary) throw new Error("Missing owning document-scroll boundary");
      elementBounds.set(actionTrigger, domRect(76, 220, 16, 40));
      fireEvent.click(actionTrigger);
      flushAnimationFrames();
      const menu = document.getElementById(fixture.store.menuId);
      expect(menu?.dataset.placement).toBe("bottom");
      expect(resize.observed(boundary)).toBe(true);

      elementBounds.set(boundary, domRect(0, 0, 800, 330));
      resize.notify(boundary);
      flushAnimationFrames();
      expect(menu?.dataset.placement).toBe("top");
      expect(
        menu?.style.getPropertyValue(
          "--first-draft-table-menu-available-block-size",
        ),
      ).toBe("206px");

      menuBounds = domRect(0, 0, 208, 60);
      resize.notify(menu!);
      flushAnimationFrames();
      expect(menu?.dataset.placement).toBe("top");
      menuBounds = domRect(0, 0, 208, 180);
      resize.notify(menu!);
      flushAnimationFrames();
      expect(menu?.dataset.placement).toBe("top");
    } finally {
      fixture.dispose();
      resize.restore();
    }
  });

  it("uses each editor instance's own placement boundary", () => {
    const first = renderFixture();
    const second = renderFixture();
    flushAnimationFrames();
    const firstBoundary = first.container.querySelector<HTMLElement>(
      ".first-draft-example__document-scroll",
    );
    const secondBoundary = second.container.querySelector<HTMLElement>(
      ".first-draft-example__document-scroll",
    );
    if (!firstBoundary || !secondBoundary)
      throw new Error("Missing isolated document-scroll boundaries");
    const firstTrigger = trigger(first.container, "row", 0);
    const secondTrigger = trigger(second.container, "row", 0);
    elementBounds.set(firstBoundary, domRect(0, 0, 800, 300));
    elementBounds.set(secondBoundary, domRect(0, 0, 800, 700));
    elementBounds.set(firstTrigger, domRect(76, 220, 16, 40));
    elementBounds.set(secondTrigger, domRect(76, 220, 16, 40));

    fireEvent.click(firstTrigger);
    fireEvent.click(secondTrigger);
    flushAnimationFrames();

    expect(document.getElementById(first.store.menuId)?.dataset.placement).toBe(
      "top",
    );
    expect(
      document.getElementById(second.store.menuId)?.dataset.placement,
    ).toBe("bottom");
    first.dispose();
    second.dispose();
  });

  it("closes on Tab and outside pointer without trapping or cross-editor dismissal", () => {
    const first = renderFixture();
    const second = renderFixture();
    flushAnimationFrames();
    const firstCell = first.container.querySelector<HTMLElement>(
      `[data-table-cell-id="${cellId}"]`,
    );
    if (!firstCell) throw new Error("Missing first cell");
    fireEvent.pointerOver(firstCell);
    const firstTrigger = trigger(first.container, "row");
    fireEvent.click(firstTrigger);
    const firstItem = document
      .getElementById(first.store.menuId)
      ?.querySelector<HTMLElement>('[role="menuitem"]');
    if (!firstItem) throw new Error("Missing first menu item");
    const secondScope = second.container.querySelector<HTMLElement>(
      '[data-editor-interaction-scope="true"]',
    );
    if (!secondScope) throw new Error("Missing second editor scope");
    fireEvent.pointerDown(secondScope);
    expect(document.getElementById(first.store.menuId)).not.toBeNull();
    fireEvent.keyDown(firstItem, { key: "Tab" });
    expect(document.getElementById(first.store.menuId)).toBeNull();

    fireEvent.pointerOver(firstCell);
    fireEvent.click(trigger(first.container, "row"));
    fireEvent.pointerDown(first.container);
    expect(document.getElementById(first.store.menuId)).toBeNull();
    expect(document.activeElement).toBe(firstTrigger);
    first.dispose();
    second.dispose();
  });

  it.each(["Escape", "Tab", "outside"] as const)(
    "preserves the canonical axis selection after %s dismissal",
    (dismissal) => {
      const fixture = renderFixture();
      flushAnimationFrames();
      fireEvent.click(trigger(fixture.container, "row", 1));
      const selected =
        fixture.editor.selectionController.getCanonicalSnapshot();
      const item = document.querySelector<HTMLElement>(
        `#${fixture.store.menuId} [role="menuitem"]`,
      );
      if (!item) throw new Error("Missing dismissal menu item");

      if (dismissal === "outside") fireEvent.pointerDown(fixture.container);
      else fireEvent.keyDown(item, { key: dismissal });

      expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });
      expect(fixture.editor.selectionController.getCanonicalSnapshot()).toBe(
        selected,
      );
      expectCanonicalTableRange(
        fixture.editor,
        "fd-table-cell-2-1" as BlockId,
        "fd-table-cell-2-3" as BlockId,
      );
      fixture.dispose();
    },
  );

  it("retains one live interaction owner through Strict Mode and closes on layer unmount", async () => {
    const fixture = renderFixture(true);
    flushAnimationFrames();
    const cell = fixture.container.querySelector<HTMLElement>(
      `[data-table-cell-id="${cellId}"]`,
    );
    if (!cell) throw new Error("Missing strict-mode cell");
    fireEvent.pointerOver(cell);
    fireEvent.click(trigger(fixture.container, "row"));
    const firstItem = document
      .getElementById(fixture.store.menuId)
      ?.querySelector<HTMLElement>('[role="menuitem"]');
    if (!firstItem) throw new Error("Missing strict-mode menu item");
    fireEvent.keyDown(firstItem, { key: "ArrowDown" });
    expect(document.activeElement?.textContent).toBe("Insert row above");

    fixture.unmount();
    await act(async () => Promise.resolve());
    expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });
    fixture.editor.dispose();
  });

  it("closes disconnected and invalid targets and falls back to the live table grid", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const externalTrigger = trigger(fixture.container, "row", 0);
    fireEvent.click(externalTrigger);
    flushAnimationFrames();
    expect(document.getElementById(fixture.store.menuId)).not.toBeNull();

    externalTrigger.remove();
    fireEvent.scroll(window);
    flushAnimationFrames();
    expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });
    expect(document.activeElement).toBe(
      fixture.container.querySelector("[data-table-grid]"),
    );

    const invalidTrigger = document.createElement("button");
    fixture.container.append(invalidTrigger);
    const selected = fixture.editor.selectionController.getCanonicalSnapshot();
    if (
      selected.kind !== "block-internal" ||
      selected.snapshot.internal?.snapshot === undefined
    ) {
      throw new Error("Missing owned table selection");
    }
    const ownedTableRange = selected.snapshot.internal.snapshot as {
      readonly kind: "cell-range";
      readonly anchorCellId: BlockId;
      readonly headCellId: BlockId;
    };
    act(() => {
      fixture.store.open({
        kind: "open",
        tableId,
        target: { kind: "row", rowId: "deleted-row" as BlockId },
        triggerElement: invalidTrigger,
        ownedTableRange,
      });
    });
    expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });
    expect(document.getElementById(fixture.store.menuId)).toBeNull();
    fixture.dispose();
  });

  it("uses the same dispatcher for pointer and Space activation", () => {
    const pointerFixture = renderFixture();
    flushAnimationFrames();
    const pointerCell = pointerFixture.container.querySelector<HTMLElement>(
      `[data-table-cell-id="${cellId}"]`,
    );
    if (!pointerCell) throw new Error("Missing pointer fixture cell");
    fireEvent.pointerOver(pointerCell);
    const rowActionTrigger = trigger(pointerFixture.container, "row");
    fireEvent.click(rowActionTrigger);
    const insertAbove = [
      ...document.querySelectorAll<HTMLElement>(
        `#${pointerFixture.store.menuId} [role="menuitem"]`,
      ),
    ].find((item) => item.textContent === "Insert row above");
    if (!insertAbove) throw new Error("Missing insert-above item");
    fireEvent.click(insertAbove);
    const insertedRowId = pointerFixture.editor.getChildBlockIds(tableId)[0]!;
    expect(insertedRowId).not.toBe(rowId);
    expectClearedCanonicalSelection(pointerFixture.editor);
    expect(document.activeElement).toBe(
      pointerFixture.container.querySelector("[data-table-grid]"),
    );
    expect(pointerFixture.onChange).toHaveBeenCalledOnce();
    expect(document.getElementById(pointerFixture.store.menuId)).toBeNull();
    expect(document.activeElement).not.toBe(rowActionTrigger);
    pointerFixture.dispose();

    const keyboardFixture = renderFixture();
    flushAnimationFrames();
    const keyboardCell = keyboardFixture.container.querySelector<HTMLElement>(
      `[data-table-cell-id="${cellId}"]`,
    );
    if (!keyboardCell) throw new Error("Missing keyboard fixture cell");
    fireEvent.pointerOver(keyboardCell);
    fireEvent.click(trigger(keyboardFixture.container, "column"));
    const columnItems = [
      ...document.querySelectorAll<HTMLElement>(
        `#${keyboardFixture.store.menuId} [role="menuitem"]`,
      ),
    ];
    fireEvent.keyDown(columnItems[0]!, { key: "End" });
    fireEvent.keyDown(columnItems[3]!, { key: " " });
    expect(resolveColumnIds(keyboardFixture.editor)).toHaveLength(4);
    expect(keyboardFixture.onChange).toHaveBeenCalledOnce();
    expect(document.getElementById(keyboardFixture.store.menuId)).toBeNull();
    expectClearedCanonicalSelection(keyboardFixture.editor);
    expect(document.activeElement).toBe(
      keyboardFixture.container.querySelector("[data-table-grid]"),
    );
    keyboardFixture.dispose();
  });

  it("keeps final-target delete items focusable and aria-disabled", () => {
    const fixture = renderFixture(false, (editor) => {
      while (editor.getChildBlockIds(tableId).length > 1) {
        deleteFirstDraftTableRow(
          editor,
          tableId,
          editor.getChildBlockIds(tableId).at(-1)!,
        );
      }
      while (resolveColumnIds(editor).length > 1) {
        deleteFirstDraftTableColumn(editor, tableId, {
          kind: "canonical",
          columnId: resolveColumnIds(editor).at(-1)!,
        });
      }
    });
    flushAnimationFrames();
    const remainingRowId = fixture.editor.getChildBlockIds(tableId)[0]!;
    const remainingCellId = fixture.editor.getChildBlockIds(remainingRowId)[0]!;
    const cell = fixture.container.querySelector<HTMLElement>(
      `[data-table-cell-id="${remainingCellId}"]`,
    );
    if (!cell) throw new Error("Missing remaining table cell");
    const transaction = vi.spyOn(fixture.editor, "transaction");
    fireEvent.pointerOver(cell);
    fireEvent.click(trigger(fixture.container, "row"));
    const selectedRow =
      fixture.editor.selectionController.getCanonicalSnapshot();
    const deleteRow = document.querySelector<HTMLButtonElement>(
      `#${fixture.store.menuId} [role="menuitem"]`,
    );
    expect(deleteRow?.getAttribute("aria-disabled")).toBe("true");
    expect(deleteRow?.tabIndex).toBe(0);
    fireEvent.click(deleteRow!);
    expect(transaction).not.toHaveBeenCalled();
    expect(fixture.store.getSnapshot().kind).toBe("open");
    expect(fixture.editor.selectionController.getCanonicalSnapshot()).toBe(
      selectedRow,
    );
    fireEvent.keyDown(deleteRow!, { key: "Escape" });

    fireEvent.pointerOver(cell);
    fireEvent.click(trigger(fixture.container, "column"));
    const selectedColumn =
      fixture.editor.selectionController.getCanonicalSnapshot();
    const deleteColumn = document.querySelector<HTMLButtonElement>(
      `#${fixture.store.menuId} [role="menuitem"]`,
    );
    expect(deleteColumn?.getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(deleteColumn!, { key: "Enter" });
    expect(transaction).not.toHaveBeenCalled();
    expect(fixture.store.getSnapshot().kind).toBe("open");
    expect(fixture.editor.selectionController.getCanonicalSnapshot()).toBe(
      selectedColumn,
    );
    fixture.dispose();
  });

  it.each([
    { name: "missing", columnIds: undefined },
    { name: "empty", columnIds: ["column-a", "", "column-c"] },
    { name: "duplicate", columnIds: ["same", "same", "column-c"] },
    { name: "wrong-length", columnIds: ["only-one"] },
  ])(
    "renders and executes synthetic column actions for $name column identities",
    ({ columnIds }) => {
      for (const action of [
        "Delete column",
        "Insert column left",
        "Insert column right",
        "Duplicate column",
      ]) {
        const fixture = renderFixture(
          false,
          undefined,
          snapshotWithColumnIds(columnIds),
        );
        flushAnimationFrames();
        const before = readTableSemanticState(fixture.editor);
        const columnZone = zone(fixture.container, "column", 1);
        fireEvent.pointerEnter(columnZone);
        expect(columnZone.dataset.controlHovered).toBe("true");
        expect(trigger(fixture.container, "row")).toBeTruthy();
        const columnTrigger = trigger(fixture.container, "column", 1);
        fireEvent.click(columnTrigger);
        const session = fixture.store.getSnapshot();
        expect(session).toMatchObject({
          kind: "open",
          target: {
            kind: "column",
            identity: {
              kind: "synthetic-presentation",
              presentationId: "column-2",
              indexAtOpen: 1,
              columnCountAtOpen: 3,
            },
          },
        });
        const items = [
          ...document.querySelectorAll<HTMLButtonElement>(
            `#${fixture.store.menuId} [role="menuitem"]`,
          ),
        ];
        expect(items.map((item) => item.textContent)).toEqual([
          "Delete column",
          "Insert column left",
          "Insert column right",
          "Duplicate column",
        ]);
        const item = items.find(
          (candidate) => candidate.textContent === action,
        );
        if (!item) throw new Error(`Missing ${action}`);
        fireEvent.click(item);

        expect(fixture.onChange).toHaveBeenCalledOnce();
        expectClearedCanonicalSelection(fixture.editor);
        expect(document.activeElement).toBe(
          fixture.container.querySelector("[data-table-grid]"),
        );
        const firstRow = fixture.editor.getChildBlockIds(tableId)[0]!;
        const expectedColumns = action === "Delete column" ? 2 : 4;
        expect(fixture.editor.getChildBlockIds(firstRow)).toHaveLength(
          expectedColumns,
        );
        expect(
          resolveFirstDraftTableColumnIds(
            fixture.editor.getBlock(tableId)?.metadata,
            expectedColumns,
          ).kind,
        ).toBe("canonical");
        const after = readTableSemanticState(fixture.editor);
        expect(fixture.editor.undo()).toEqual({ status: "applied" });
        expect(readTableSemanticState(fixture.editor)).toEqual(before);
        expect(fixture.editor.redo()).toEqual({ status: "applied" });
        expect(readTableSemanticState(fixture.editor)).toEqual(after);
        fixture.dispose();
      }
    },
  );

  it.each(["pointer", "Enter", " "] as const)(
    "keeps a rejected %s activation open with focus and an accessible error",
    (activation) => {
      const fixture = renderFixture();
      flushAnimationFrames();
      const before = fixture.editor.readSnapshot();
      const cell = fixture.container.querySelector<HTMLElement>(
        `[data-table-cell-id="${cellId}"]`,
      );
      if (!cell) throw new Error("Missing rejection target cell");
      fireEvent.pointerOver(cell);
      const actionTrigger = trigger(fixture.container, "column");
      fireEvent.click(actionTrigger);
      const selected =
        fixture.editor.selectionController.getCanonicalSnapshot();
      const item = [
        ...document.querySelectorAll<HTMLButtonElement>(
          `#${fixture.store.menuId} [role="menuitem"]`,
        ),
      ].find((candidate) => candidate.textContent === "Insert column right");
      if (!item) throw new Error("Missing insert-column-right item");
      fireEvent.pointerEnter(item);

      const originalInsertBlocks = fixture.editor.insertBlocks.bind(
        fixture.editor,
      );
      let insertions = 0;
      const insertion = vi
        .spyOn(fixture.editor, "insertBlocks")
        .mockImplementation((placement, fragment) => {
          const result = originalInsertBlocks(placement, fragment);
          insertions += 1;
          if (insertions === 2) throw new Error("forced staged failure");
          return result;
        });

      if (activation === "pointer") fireEvent.click(item);
      else fireEvent.keyDown(item, { key: activation });

      expect(fixture.editor.readSnapshot()).toEqual(before);
      expect(fixture.onChange).not.toHaveBeenCalled();
      expect(fixture.editor.canUndo).toBe(false);
      expect(fixture.store.getSnapshot().kind).toBe("open");
      expect(fixture.editor.selectionController.getCanonicalSnapshot()).toBe(
        selected,
      );
      expect(document.activeElement).toBe(item);
      expect(
        document.querySelector(`#${fixture.store.menuId} [role="alert"]`),
      ).toHaveProperty(
        "textContent",
        expect.stringContaining("could not be completed"),
      );

      insertion.mockRestore();
      fireEvent.click(item);
      expect(fixture.onChange).toHaveBeenCalledOnce();
      expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });
      expectClearedCanonicalSelection(fixture.editor);
      expect(document.activeElement).toBe(
        fixture.container.querySelector("[data-table-grid]"),
      );
      fixture.dispose();
    },
  );

  it("rejects a captured synthetic target after its table representation changes", () => {
    const fixture = renderFixture(
      false,
      undefined,
      snapshotWithColumnIds(undefined),
    );
    flushAnimationFrames();
    const cell = fixture.container.querySelector<HTMLElement>(
      '[data-table-cell-id="fd-table-cell-1-2"]',
    );
    if (!cell) throw new Error("Missing stale synthetic target cell");
    fireEvent.pointerOver(cell);
    fireEvent.click(trigger(fixture.container, "column", 1));
    const captured = fixture.store.getSnapshot();
    if (captured.kind !== "open") throw new Error("Missing captured session");

    insertFirstDraftTableColumn(fixture.editor, tableId, 0);
    fixture.onChange.mockClear();
    const transaction = vi.spyOn(fixture.editor, "transaction");
    const before = fixture.editor.readSnapshot();

    expect(
      dispatchFirstDraftTableAction(
        fixture.editor,
        captured,
        "duplicate-column",
      ),
    ).toEqual({ kind: "stale" });
    expect(transaction).not.toHaveBeenCalled();
    expect(fixture.onChange).not.toHaveBeenCalled();
    expect(fixture.editor.readSnapshot()).toEqual(before);
    fixture.dispose();
  });

  it("rematerializes owned axes after remote structure changes and yields to newer selection", () => {
    const snapshot = createFirstDraftSnapshot();
    const { source, changes: sourceChanges } = createRemoteSource(snapshot);
    const fixture = renderFixture(false, undefined, snapshot);
    flushAnimationFrames();
    const refreshed: EditorStableSelection[] = [];
    fixture.editor.subscribeStandaloneSelectionSettlements((selection) =>
      refreshed.push(selection),
    );

    fireEvent.click(trigger(fixture.container, "column", 1));
    refreshed.splice(0);
    const insertedRow = insertFirstDraftTableRow(
      source,
      tableId,
      source.getChildBlockIds(tableId).length,
    );
    applyRemoteChange(fixture.editor, sourceChanges.at(-1)!);
    expect(fixture.store.getSnapshot().kind).toBe("open");
    expectCanonicalTableRange(
      fixture.editor,
      "fd-table-cell-1-2" as BlockId,
      insertedRow.cellIds[1]!,
    );
    expect(refreshed.at(-1)).toMatchObject({
      selection: {
        kind: "block-internal",
        payload: { headCellId: insertedRow.cellIds[1] },
      },
    });
    const rowBefore = insertFirstDraftTableRow(source, tableId, 0);
    applyRemoteChange(fixture.editor, sourceChanges.at(-1)!);
    expectCanonicalTableRange(
      fixture.editor,
      rowBefore.cellIds[1]!,
      insertedRow.cellIds[1]!,
    );

    const columnItem = document.querySelector<HTMLElement>(
      `#${fixture.store.menuId} [role="menuitem"]`,
    );
    fireEvent.keyDown(columnItem!, { key: "Escape" });
    fireEvent.click(trigger(fixture.container, "row", 2));
    const insertedColumn = insertFirstDraftTableColumn(source, tableId, 3);
    applyRemoteChange(fixture.editor, sourceChanges.at(-1)!);
    expect(fixture.store.getSnapshot().kind).toBe("open");
    expectCanonicalTableRange(
      fixture.editor,
      "fd-table-cell-2-1" as BlockId,
      insertedColumn.cellIds[2]!,
    );
    const columnBefore = insertFirstDraftTableColumn(source, tableId, 0);
    applyRemoteChange(fixture.editor, sourceChanges.at(-1)!);
    expectCanonicalTableRange(
      fixture.editor,
      columnBefore.cellIds[2]!,
      insertedColumn.cellIds[2]!,
    );

    act(() => {
      fixture.editor.focusText("fd-paragraph-after-table" as BlockId, {
        offset: 0,
        preventScroll: true,
      });
    });
    expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });
    expect(
      fixture.editor.selectionController.getCanonicalSnapshot(),
    ).toMatchObject({ kind: "document" });
    source.dispose();
    fixture.dispose();
  });

  it("tracks moved stable rows and closes for deleted or invalid synthetic targets", () => {
    const snapshot = createFirstDraftSnapshot();
    const { source, changes } = createRemoteSource(snapshot);
    const fixture = renderFixture(false, undefined, snapshot);
    flushAnimationFrames();
    const stableRowId = source.getChildBlockIds(tableId)[1]!;
    fireEvent.click(trigger(fixture.container, "row", 1));

    expect(
      source.moveBlocks({
        blockIds: [stableRowId],
        destination: { parentId: tableId, childIndex: 3 },
      }),
    ).toMatchObject({ ok: true, changed: true });
    applyRemoteChange(fixture.editor, changes.at(-1)!);
    expect(fixture.store.getSnapshot()).toMatchObject({
      kind: "open",
      target: { kind: "row", rowId: stableRowId },
    });
    expect(fixture.editor.getChildBlockIds(tableId).indexOf(stableRowId)).toBe(
      3,
    );
    expectCanonicalTableRange(
      fixture.editor,
      "fd-table-cell-2-1" as BlockId,
      "fd-table-cell-2-3" as BlockId,
    );

    deleteFirstDraftTableRow(source, tableId, stableRowId);
    applyRemoteChange(fixture.editor, changes.at(-1)!);
    expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });
    fixture.dispose();
    source.dispose();

    const syntheticSnapshot = snapshotWithColumnIds(undefined);
    const syntheticSource = createRemoteSource(syntheticSnapshot);
    const synthetic = renderFixture(false, undefined, syntheticSnapshot);
    flushAnimationFrames();
    fireEvent.click(trigger(synthetic.container, "column", 1));
    insertFirstDraftTableColumn(syntheticSource.source, tableId, 0);
    applyRemoteChange(synthetic.editor, syntheticSource.changes.at(-1)!);
    expect(synthetic.store.getSnapshot()).toEqual({ kind: "closed" });
    synthetic.dispose();
    syntheticSource.source.dispose();
  });

  it("renders a remote participant perimeter through presence without local feedback", () => {
    const publisher = renderFixture();
    const receiver = renderFixture();
    flushAnimationFrames();
    let stable: EditorStableSelection | null = null;
    publisher.editor.subscribeStandaloneSelectionSettlements((selection) => {
      stable = selection;
    });
    fireEvent.click(trigger(publisher.container, "row", 1));
    if (!stable) throw new Error("Missing published table selection");

    const connection = new RuntimePresenceConnection();
    const attachment = attachFirstDraftPresence(connection, receiver.editor, {
      documentId: "runtime-document",
      subject: {
        actorId: "receiver-actor",
        clientId: "receiver-client",
        sessionId: "receiver-session",
      },
      metadata: { displayName: "Receiver", color: "#123456" },
    }, {
      revisions: { presence: 0, selection: 0 },
      beforeStandaloneSelectionPublication: vi.fn(),
    });
    const localBefore =
      receiver.editor.selectionController.getCanonicalSnapshot();
    const framesBeforeRemote = connection.sent.length;
    connection.receive({
      type: "first-draft-participant-update",
      documentId: "runtime-document",
      subject: {
        actorId: "publisher-actor",
        clientId: "publisher-client",
        sessionId: "publisher-session",
      },
      presenceRevision: 1,
      active: true,
      metadata: { displayName: "Publisher", color: "#abcdef" },
    });
    connection.receive({
      type: "first-draft-selection-update",
      documentId: "runtime-document",
      subject: {
        actorId: "publisher-actor",
        clientId: "publisher-client",
        sessionId: "publisher-session",
      },
      selectionRevision: 1,
      selection: stable,
    });

    expect(receiver.editor.selectionController.getCanonicalSnapshot()).toBe(
      localBefore,
    );
    const remotePaint = [
      ...receiver.container.querySelectorAll<HTMLElement>(
        '[data-table-selection-kind="remote"]',
      ),
    ];
    expect(remotePaint).toHaveLength(3);
    expect(
      remotePaint.every(
        (paint) => paint.dataset.tableSelectionColor === "#abcdef",
      ),
    ).toBe(true);
    remotePaint.forEach((paint, index) => {
      expect(paint.dataset.editorSelectionPaintEdgeTop).toBe("true");
      expect(paint.dataset.editorSelectionPaintEdgeBottom).toBe("true");
      expect(paint.dataset.editorSelectionPaintEdgeLeft).toBe(
        index === 0 ? "true" : undefined,
      );
      expect(paint.dataset.editorSelectionPaintEdgeRight).toBe(
        index === remotePaint.length - 1 ? "true" : undefined,
      );
    });
    const remotelySelectedRowId = publisher.editor.getChildBlockIds(tableId)[1]!;
    const receiverRowTrigger = trigger(receiver.container, "row", 0);
    fireEvent(receiverRowTrigger, tablePointerEvent("pointerdown", 60));
    fireEvent(window, tablePointerEvent("pointermove", 150));
    flushAnimationFrames();
    const projectedRemotePaint = [
      ...receiver.container.querySelectorAll<HTMLElement>(
        '[data-table-selection-kind="remote"]',
      ),
    ];
    expect(projectedRemotePaint).toHaveLength(3);
    expect(
      projectedRemotePaint.every(
        (paint) =>
          paint.closest<HTMLElement>("[data-table-row-id]")?.dataset
            .tableRowId === remotelySelectedRowId,
      ),
    ).toBe(true);
    expect(receiver.editor.selectionController.getCanonicalSnapshot()).toBe(
      localBefore,
    );
    expect(connection.sent).toHaveLength(framesBeforeRemote);
    fireEvent(window, tablePointerEvent("pointercancel", 150));

    const remoteRowCells = receiver.editor.getChildBlockIds(
      remotelySelectedRowId,
    );
    const receiverColumnTrigger = trigger(receiver.container, "column", 0);
    fireEvent(
      receiverColumnTrigger,
      tablePointerEvent("pointerdown", 30, 110),
    );
    fireEvent(window, tablePointerEvent("pointermove", 30, 520));
    flushAnimationFrames();
    expect(
      [...receiver.container.querySelectorAll<HTMLElement>(
        '[data-table-selection-kind="remote"]',
      )].map(
        (paint) =>
          paint.closest<HTMLElement>("[data-table-cell-id]")?.dataset
            .tableCellId,
      ),
    ).toEqual([remoteRowCells[1], remoteRowCells[2], remoteRowCells[0]]);
    expect(receiver.editor.selectionController.getCanonicalSnapshot()).toBe(
      localBefore,
    );
    expect(connection.sent).toHaveLength(framesBeforeRemote);
    fireEvent(window, tablePointerEvent("pointercancel", 30, 520));
    attachment.dispose();
    publisher.dispose();
    receiver.dispose();
  });

  it.each([
    { axis: "row" as const, action: "Duplicate row" },
    { axis: "row" as const, action: "Insert row above" },
    { axis: "column" as const, action: "Duplicate column" },
    { axis: "column" as const, action: "Insert column right" },
  ])(
    "publishes only transaction-associated none and removes remote paint for $action",
    ({ axis, action }) => {
      let observeFinalized: ((change: EditorSemanticChange) => void) | null =
        null;
      const publisher = renderFixture(
        false,
        undefined,
        createFirstDraftSnapshot(),
        (change) => observeFinalized?.(change),
      );
      const receiver = renderFixture();
      flushAnimationFrames();
      const publisherConnection = new RuntimePresenceConnection();
      const receiverConnection = new RuntimePresenceConnection();
      const publications: {
        readonly selectionRevision: number;
        readonly transactionId: string | null;
      }[] = [];
      const publisherAttachment = attachFirstDraftPresence(
        publisherConnection,
        publisher.editor,
        {
          documentId: "action-presence-document",
          subject: {
            actorId: "publisher-actor",
            clientId: "publisher-client",
            sessionId: "publisher-session",
          },
          metadata: { displayName: "Publisher", color: "#abcdef" },
        },
        {
          revisions: { presence: 0, selection: 0 },
          beforeStandaloneSelectionPublication: vi.fn(),
          onSelectionPublished: (publication) => publications.push(publication),
        },
      );
      const receiverAttachment = attachFirstDraftPresence(
        receiverConnection,
        receiver.editor,
        {
          documentId: "action-presence-document",
          subject: {
            actorId: "receiver-actor",
            clientId: "receiver-client",
            sessionId: "receiver-session",
          },
          metadata: { displayName: "Receiver", color: "#123456" },
        },
        {
          revisions: { presence: 0, selection: 0 },
          beforeStandaloneSelectionPublication: vi.fn(),
        },
      );
      const outbound = createFirstDraftOutboundPublisher();
      outbound.attachGeneration({
        generationId: "action-presence-publisher",
        socket: publisherConnection.socket,
        createTransactionId: () => crypto.randomUUID(),
        publishSelection: (selection, transactionId) =>
          publisherAttachment.publishSelection(selection, transactionId),
      });
      outbound.generationCaughtUp();
      observeFinalized = (change) => outbound.submitFinalized(change);

      receiverConnection.receive(
        decodedServerMessage(publisherConnection.sent[0]!),
      );
      fireEvent.click(trigger(publisher.container, axis, 1));
      const rangeUpdate = decodedSelectionUpdates(publisherConnection.sent).at(
        -1,
      );
      if (!rangeUpdate) throw new Error("Missing published table range");
      receiverConnection.receive(rangeUpdate);
      expect(
        receiver.container.querySelectorAll(
          '[data-table-selection-kind="remote"]',
        ).length,
      ).toBeGreaterThan(0);
      const receiverCanonicalBefore =
        receiver.editor.selectionController.getCanonicalSnapshot();
      const receiverFramesBefore = receiverConnection.sent.length;
      const publisherFramesBefore = publisherConnection.sent.length;
      const transaction = vi.spyOn(publisher.editor, "transaction");
      const item = [
        ...document.querySelectorAll<HTMLButtonElement>(
          `#${publisher.store.menuId} [role="menuitem"]`,
        ),
      ].find((candidate) => candidate.textContent === action);
      if (!item) throw new Error(`Missing ${action}`);

      fireEvent.click(item);

      expect(transaction).toHaveBeenCalledOnce();
      const actionFrames = publisherConnection.sent.slice(
        publisherFramesBefore,
      );
      const selectionUpdates = decodedSelectionUpdates(actionFrames);
      expect(selectionUpdates).toHaveLength(1);
      expect(selectionUpdates[0]!.selection).toEqual({ kind: "none" });
      expect(selectionUpdates).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            selection: expect.objectContaining({
              selection: expect.objectContaining({ kind: "document" }),
            }),
          }),
        ]),
      );
      const change = publisher.onChange.mock.calls[0]![0];
      expect(change.selectionAfter).toEqual({ kind: "none" });
      expect(publications.at(-1)).toMatchObject({
        transactionId: change.transactionId,
      });

      receiverConnection.receive(selectionUpdates[0]!);
      expect(
        receiver.container.querySelectorAll(
          '[data-table-selection-kind="remote"]',
        ),
      ).toHaveLength(0);
      expect(
        receiver.editor.additionalSelections.getSnapshot()[0],
      ).toMatchObject({ resolution: "cleared", resolvedSelection: null });
      expect(receiver.editor.selectionController.getCanonicalSnapshot()).toBe(
        receiverCanonicalBefore,
      );
      expect(receiverConnection.sent).toHaveLength(receiverFramesBefore);

      publisherAttachment.dispose();
      receiverAttachment.dispose();
      outbound.dispose();
      publisher.dispose();
      receiver.dispose();
    },
  );

  it("does not clear native selection or add an action-specific painter", () => {
    const fixture = renderFixture();
    flushAnimationFrames();
    const getSelection = vi.spyOn(document, "getSelection");
    fireEvent.click(trigger(fixture.container, "row", 1));

    expect(getSelection).not.toHaveBeenCalled();
    expect(
      fixture.container.querySelectorAll(".table-block__selection-paint"),
    ).toHaveLength(3);
    expect(
      fixture.container.querySelector(
        "[class*='row-outline'], [class*='column-outline'], [class*='action-menu-highlight']",
      ),
    ).toBeNull();
    fixture.dispose();
  });

  it.each(["row", "column"] as const)(
    "clears selection when the standalone append-%s control succeeds",
    (axis) => {
      const fixture = renderFixture();
      flushAnimationFrames();
      fireEvent.click(trigger(fixture.container, "row", 1));
      const menuItem = document.querySelector<HTMLElement>(
        `#${fixture.store.menuId} [role="menuitem"]`,
      );
      fireEvent.keyDown(menuItem!, { key: "Escape" });
      const focusText = vi.spyOn(fixture.editor, "focusText");
      const standalone: EditorStableSelection[] = [];
      fixture.editor.subscribeStandaloneSelectionSettlements((selection) =>
        standalone.push(selection),
      );

      fireEvent.click(
        fixture.container.querySelector(`[aria-label="Add table ${axis}"]`)!,
      );

      expect(fixture.onChange).toHaveBeenCalledOnce();
      expect(fixture.onChange.mock.calls[0]![0].selectionAfter).toEqual({
        kind: "none",
      });
      expectClearedCanonicalSelection(fixture.editor);
      expect(focusText).not.toHaveBeenCalled();
      expect(standalone).toEqual([]);
      expect(
        fixture.container.querySelectorAll(
          '.table-block__cell[aria-selected="true"]',
        ),
      ).toHaveLength(0);
      fixture.dispose();
    },
  );

  it.each([
    { axis: "row" as const, action: "Duplicate row" },
    { axis: "column" as const, action: "Duplicate column" },
  ])(
    "restores the pre-action $axis range on undo and none on redo",
    ({ axis, action }) => {
      const fixture = renderFixture();
      flushAnimationFrames();
      fireEvent.click(trigger(fixture.container, axis, 1));
      const selectedBefore =
        fixture.editor.selectionController.getCanonicalSnapshot();
      if (
        selectedBefore.kind !== "block-internal" ||
        selectedBefore.snapshot.internal?.snapshot === undefined
      ) {
        throw new Error("Missing pre-action table range");
      }
      const payloadBefore = selectedBefore.snapshot.internal.snapshot;
      const item = [
        ...document.querySelectorAll<HTMLButtonElement>(
          `#${fixture.store.menuId} [role="menuitem"]`,
        ),
      ].find((candidate) => candidate.textContent === action);
      if (!item) throw new Error(`Missing ${action}`);

      fireEvent.click(item);
      expectClearedCanonicalSelection(fixture.editor);
      expect(fixture.onChange.mock.calls[0]![0]).toMatchObject({
        selectionBefore: {
          kind: "selection",
          selection: {
            kind: "block-internal",
            blockId: tableId,
            subsystem: "table.cell-range",
            payload: payloadBefore,
          },
        },
        selectionAfter: { kind: "none" },
      });
      expect(fixture.editor.undo()).toEqual({ status: "applied" });
      expect(
        fixture.editor.selectionController.getCanonicalSnapshot(),
      ).toMatchObject({
        kind: "block-internal",
        snapshot: { internal: { snapshot: payloadBefore } },
      });
      expect(fixture.editor.redo()).toEqual({ status: "applied" });
      expectClearedCanonicalSelection(fixture.editor);
      fixture.dispose();
    },
  );

  it.each(["pointer", "keyboard"] as const)(
    "routes every action exactly once through %s activation",
    (activation) => {
      for (const action of [
        "Delete row",
        "Insert row above",
        "Insert row below",
        "Duplicate row",
        "Delete column",
        "Insert column left",
        "Insert column right",
        "Duplicate column",
      ]) {
        const fixture = renderFixture();
        flushAnimationFrames();
        const targetCell = fixture.container.querySelector<HTMLElement>(
          '[data-table-cell-id="fd-table-cell-2-2"]',
        );
        if (!targetCell) throw new Error("Missing activation target cell");
        fireEvent.pointerOver(targetCell);
        const axis = action.includes("row") ? "row" : "column";
        const actionTrigger = trigger(fixture.container, axis, 1);
        fireEvent.click(actionTrigger);
        expect(
          fixture.editor.selectionController.getCanonicalSnapshot(),
        ).toMatchObject({ kind: "block-internal" });
        const transaction = vi.spyOn(fixture.editor, "transaction");
        const focusText = vi.spyOn(fixture.editor, "focusText");
        const standalone: EditorStableSelection[] = [];
        fixture.editor.subscribeStandaloneSelectionSettlements((selection) =>
          standalone.push(selection),
        );
        const item = [
          ...document.querySelectorAll<HTMLButtonElement>(
            `#${fixture.store.menuId} [role="menuitem"]`,
          ),
        ].find((candidate) => candidate.textContent === action);
        if (!item) throw new Error(`Missing ${action}`);
        fireEvent.pointerEnter(item);
        if (activation === "pointer") fireEvent.click(item);
        else fireEvent.keyDown(item, { key: "Enter" });

        expect(fixture.onChange).toHaveBeenCalledOnce();
        expect(transaction).toHaveBeenCalledOnce();
        expect(focusText).not.toHaveBeenCalled();
        expect(fixture.store.getSnapshot()).toEqual({ kind: "closed" });
        expectClearedCanonicalSelection(fixture.editor);
        expect(fixture.onChange.mock.calls[0]![0].selectionAfter).toEqual({
          kind: "none",
        });
        expect(standalone).toEqual([]);
        expect(
          fixture.container.querySelectorAll(
            '.table-block__cell[aria-selected="true"]',
          ),
        ).toHaveLength(0);
        expect(
          fixture.container.querySelectorAll(
            '[data-table-selection-kind="local"]',
          ),
        ).toHaveLength(0);
        expect(document.activeElement).toBe(
          fixture.container.querySelector("[data-table-grid]"),
        );
        fixture.dispose();
      }
    },
  );
});

function createRemoteSource(snapshot: EditorInstanceSnapshot): {
  readonly source: FirstDraftTestEditor;
  readonly changes: EditorSemanticChange[];
} {
  const changes: EditorSemanticChange[] = [];
  const source = initializeEditableEditor({
    definition: createFirstDraftEditorDefinition(
      createFirstDraftViewStateStore(),
    ),
    snapshot,
    onChange: (change) => {
      changes.push(change);
    },
  });
  return { source, changes };
}

function applyRemoteChange(
  editor: FirstDraftTestEditor,
  change: EditorSemanticChange,
): void {
  act(() => {
    expect(
      editor.applyRemoteTransaction({
        transaction: convertEditorTransactionToTransport(change),
        authorSelection: { kind: "no-author-selection" },
      }),
    ).toMatchObject({ status: "applied" });
  });
}

class RuntimePresenceConnection implements FirstDraftMessageDispatcher {
  readonly sent: ArrayBuffer[] = [];
  private readonly listeners = new Set<
    (message: FirstDraftServerMessage) => void
  >();
  readonly socket = {
    binaryType: "arraybuffer" as BinaryType,
    readyState: 1,
    send: (data: ArrayBuffer) => this.sent.push(data),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };

  subscribe(listener: (message: FirstDraftServerMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeDecodeErrors(): () => void {
    return () => undefined;
  }

  subscribeSocketErrors(): () => void {
    return () => undefined;
  }

  receive(message: FirstDraftServerMessage): void {
    act(() => {
      for (const listener of this.listeners) listener(message);
    });
  }

  dispose(): void {
    this.listeners.clear();
  }
}

function decodedServerMessage(frame: ArrayBuffer): FirstDraftServerMessage {
  const decoded = decodeFirstDraftMessage(frame);
  if (
    !decoded.ok ||
    decoded.message.type === "connect-first-draft-session" ||
    decoded.message.type === "subscribe-first-draft-document" ||
    decoded.message.type === "unsubscribe-first-draft-document" ||
    decoded.message.type === "proposed-editor-transaction"
  ) {
    throw new Error("Expected a First Draft server message");
  }
  return decoded.message;
}

function decodedSelectionUpdates(
  frames: readonly ArrayBuffer[],
): Extract<
  FirstDraftServerMessage,
  { readonly type: "first-draft-selection-update" }
>[] {
  return frames.flatMap((frame) => {
    const decoded = decodeFirstDraftMessage(frame);
    return decoded.ok && decoded.message.type === "first-draft-selection-update"
      ? [decoded.message]
      : [];
  });
}

function renderFixture(
  strict = false,
  prepare?: (editor: FirstDraftTestEditor) => void,
  snapshot: EditorInstanceSnapshot = createFirstDraftSnapshot(),
  observeChange?: (change: EditorSemanticChange) => void,
) {
  const onChange = vi.fn();
  const viewState = createFirstDraftViewStateStore();
  const store = createFirstDraftTableActionMenuStore();
  const tableDragStore = createFirstDraftTableDragStore();
  const editor = initializeEditableEditor({
    definition: createFirstDraftEditorDefinition(viewState),
    snapshot,
    onChange: (change) => {
      onChange(change);
      observeChange?.(change);
    },
  });
  prepare?.(editor);
  onChange.mockClear();
  const tree = (
    <section data-editor-interaction-scope="true">
      <div className="first-draft-example__document-scroll">
        <FirstDraftViewStateProvider store={viewState}>
          <FirstDraftTableActionMenuProvider store={store}>
            <FirstDraftBlockHoverProvider
              enabled
              tableDragStore={tableDragStore}
              blockDragAndDrop={{
                placementRegistry: createFirstDraftBlockPlacementRegistry(editor),
                captureDocumentBlockDragSession: (blockId) =>
                  captureFirstDraftDocumentBlockDragSession(
                    editor,
                    viewState,
                    blockId,
                  ),
                moveDocumentBlock: vi.fn(),
                moveTableRow: (currentTableId, currentRowId, finalRowIds) =>
                  moveFirstDraftTableRow(
                    editor,
                    currentTableId,
                    currentRowId,
                    finalRowIds,
                  ),
                moveTableColumn: (
                  currentTableId,
                  source,
                  finalTargets,
                ) =>
                  moveFirstDraftTableColumn(
                    editor,
                    currentTableId,
                    source,
                    finalTargets,
                  ),
                closeTableActionMenu: () => store.close(),
                startDocumentBlockAutoScroll: () => undefined,
                updateDocumentBlockAutoScrollPoint: () => undefined,
                stopDocumentBlockAutoScroll: () => undefined,
                startTableDragAutoScroll: () => true,
                updateTableDragAutoScrollPoint: () => undefined,
                stopTableDragAutoScroll: () => undefined,
                registerAutoScrollSynchronization: () => undefined,
              }}
            >
              <EditorDocument
                editor={editor}
                childOrderProjection={tableDragStore.childOrderProjection}
                renderDocumentLayers={(context) => (
                  <FirstDraftTableActionMenuLayer
                    editor={context.editor}
                    geometry={context.editor.geometry}
                    interactions={context.interactions}
                    store={store}
                  />
                )}
              />
            </FirstDraftBlockHoverProvider>
          </FirstDraftTableActionMenuProvider>
        </FirstDraftViewStateProvider>
      </div>
    </section>
  );
  const rendered = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return {
    ...rendered,
    editor,
    store,
    tableDragStore,
    onChange,
    dispose() {
      rendered.unmount();
      editor.dispose();
    },
  };
}

function tablePointerEvent(
  type: string,
  clientY: number,
  clientX = 90,
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    clientX,
    clientY,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "isPrimary", { value: true });
  return event as PointerEvent;
}

function resolveColumnIds(editor: FirstDraftTestEditor): readonly string[] {
  const firstRow = editor.getChildBlockIds(tableId)[0]!;
  return resolveFirstDraftTableColumnIds(
    editor.getBlock(tableId)?.metadata,
    editor.getChildBlockIds(firstRow).length,
  ).ids;
}

function readTableSemanticState(editor: FirstDraftTestEditor) {
  const rowIds = editor.getChildBlockIds(tableId);
  return {
    table: editor.getBlock(tableId),
    rowIds,
    rows: rowIds.map((currentRowId) => {
      const cellIds = editor.getChildBlockIds(currentRowId);
      return {
        row: editor.getBlock(currentRowId),
        cellIds,
        cells: cellIds.map((currentCellId) => ({
          block: editor.getBlock(currentCellId),
          content: editor.readBlockContent(currentCellId, "tableCell"),
        })),
      };
    }),
  };
}

function snapshotWithColumnIds(
  columnIds: readonly string[] | undefined,
): EditorInstanceSnapshot {
  const snapshot = createFirstDraftSnapshot();
  const table = snapshot.blocks[tableId];
  if (!table) throw new Error("Missing fixture table");
  const metadata = { ...table.metadata };
  if (columnIds === undefined) delete metadata[TABLE_COLUMN_IDS_FIELD];
  else metadata[TABLE_COLUMN_IDS_FIELD] = [...columnIds];
  return {
    ...snapshot,
    blocks: {
      ...snapshot.blocks,
      [tableId]: { ...table, metadata },
    },
  };
}

function snapshotWithColumnWidths(
  widths: readonly number[],
): EditorInstanceSnapshot {
  const snapshot = createFirstDraftSnapshot();
  const table = snapshot.blocks[tableId];
  if (!table) throw new Error("Missing fixture table");
  const columnIds = table.metadata?.[
    TABLE_COLUMN_IDS_FIELD
  ] as readonly string[];
  if (columnIds.length !== widths.length) {
    throw new Error("Column width fixture must match the table column count");
  }
  return {
    ...snapshot,
    blocks: {
      ...snapshot.blocks,
      [tableId]: {
        ...table,
        metadata: {
          ...table.metadata,
          [TABLE_COLUMN_WIDTHS_FIELD]: Object.fromEntries(
            columnIds.map((columnId, index) => [columnId, widths[index]!]),
          ),
        },
      },
    },
  };
}

function trigger(
  container: ParentNode,
  axis: "row" | "column",
  index = 0,
): HTMLButtonElement {
  const element = container.querySelector<HTMLButtonElement>(
    `[aria-label="${axis === "row" ? "Row" : "Column"} ${index + 1} actions"]`,
  );
  if (!element) throw new Error(`Missing ${axis} ${index + 1} trigger`);
  return element;
}

function triggers(
  container: ParentNode,
  axis: "row" | "column",
): readonly HTMLButtonElement[] {
  return [
    ...container.querySelectorAll<HTMLButtonElement>(
      `[data-table-action-trigger-axis="${axis}"]`,
    ),
  ];
}

function expectDecorativeActionIcons(
  items: readonly HTMLElement[],
  expectedNames: readonly string[],
): void {
  expect(items).toHaveLength(expectedNames.length);
  for (const [index, item] of items.entries()) {
    const icon = item.querySelector<HTMLElement>(
      ":scope > .first-draft-table-action-menu__icon",
    );
    const svgs = item.querySelectorAll("svg");
    expect(icon?.dataset.firstDraftTableActionIcon).toBe(expectedNames[index]);
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(svgs).toHaveLength(1);
    expect(svgs[0]?.getAttribute("aria-hidden")).toBe("true");
    expect(svgs[0]?.getAttribute("focusable")).toBe("false");
  }
}

function activeDragBoundary(container: ParentNode): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    ".first-draft-block-hover-boundary",
  );
  if (!element) throw new Error("Missing First Draft hover boundary");
  return element;
}

function zone(
  container: ParentNode,
  axis: "row" | "column",
  index = 0,
): HTMLElement {
  const element = trigger(container, axis, index).parentElement;
  if (!element) throw new Error(`Missing ${axis} ${index + 1} control zone`);
  return element;
}

function bridge(
  container: ParentNode,
  axis: "row" | "column",
  index = 0,
): HTMLSpanElement {
  const element = zone(container, axis, index).querySelector<HTMLSpanElement>(
    ":scope > .table-block__action-control-bridge",
  );
  if (!element) throw new Error(`Missing ${axis} ${index + 1} hover bridge`);
  return element;
}

function expectClearedCanonicalSelection(editor: FirstDraftTestEditor): void {
  expect(editor.selectionController.getCanonicalSnapshot()).toMatchObject({
    kind: "none",
  });
}

function expectCanonicalTableRange(
  editor: FirstDraftTestEditor,
  anchorCellId: BlockId,
  headCellId: BlockId,
): void {
  expect(editor.selectionController.getCanonicalSnapshot()).toMatchObject({
    kind: "block-internal",
    subsystem: expect.objectContaining({ id: "table.cell-range" }),
    snapshot: {
      internal: {
        blockId: tableId,
        snapshot: {
          kind: "cell-range",
          anchorCellId,
          headCellId,
        },
      },
    },
  });
}

function expectSelectedCells(
  container: ParentNode,
  expectedCellIds: readonly BlockId[],
): void {
  const selected = [
    ...container.querySelectorAll<HTMLElement>(
      '.table-block__cell[aria-selected="true"]',
    ),
  ];
  expect(selected.map((cell) => cell.dataset.tableCellId)).toEqual(
    expectedCellIds,
  );
  expect(
    selected.every((cell) =>
      cell.classList.contains("table-block__cell--selected"),
    ),
  ).toBe(true);
}

function expectRowPerimeter(
  container: ParentNode,
  cellIds: readonly BlockId[],
): void {
  cellIds.forEach((currentCellId, index) => {
    const paint = localPaint(container, currentCellId);
    expect(paint.dataset.editorSelectionPaintEdgeTop).toBe("true");
    expect(paint.dataset.editorSelectionPaintEdgeBottom).toBe("true");
    expect(paint.dataset.editorSelectionPaintEdgeLeft).toBe(
      index === 0 ? "true" : undefined,
    );
    expect(paint.dataset.editorSelectionPaintEdgeRight).toBe(
      index === cellIds.length - 1 ? "true" : undefined,
    );
  });
}

function expectColumnPerimeter(
  container: ParentNode,
  cellIds: readonly BlockId[],
): void {
  cellIds.forEach((currentCellId, index) => {
    const paint = localPaint(container, currentCellId);
    expect(paint.dataset.editorSelectionPaintEdgeLeft).toBe("true");
    expect(paint.dataset.editorSelectionPaintEdgeRight).toBe("true");
    expect(paint.dataset.editorSelectionPaintEdgeTop).toBe(
      index === 0 ? "true" : undefined,
    );
    expect(paint.dataset.editorSelectionPaintEdgeBottom).toBe(
      index === cellIds.length - 1 ? "true" : undefined,
    );
  });
}

function localPaint(container: ParentNode, cellId: BlockId): HTMLElement {
  const paint = container.querySelector<HTMLElement>(
    `[data-table-cell-id="${cellId}"] [data-table-selection-kind="local"]`,
  );
  if (!paint) throw new Error(`Missing local table paint for ${cellId}`);
  return paint;
}

function flushAnimationFrames(): void {
  act(() => {
    while (animationFrames.length > 0) {
      const frames = animationFrames.splice(0);
      for (const frame of frames) frame(0);
    }
  });
}

function domRect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function readTranslate3d(transform: string): readonly [number, number] {
  const match = transform.match(
    /translate3d\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px,\s*0(?:px)?\)/u,
  );
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

function renderedGridWidth(element: Element, fallback: number): number {
  const widths = renderedTrackWidths(element);
  return widths.length > 0
    ? widths.reduce((total, width) => total + width, 0)
    : fallback;
}

function renderedTrackWidths(element: Element): number[] {
  const object = element.closest<HTMLElement>(".table-block__object");
  const tracks = object?.style.getPropertyValue(
    "--first-draft-table-tracks",
  );
  if (!tracks) return [];
  const widths = [...tracks.matchAll(/(-?\d+(?:\.\d+)?)px/gu)].map(
    (match) => Number(match[1]),
  );
  return widths.every((width) => width > 0) ? widths : [];
}

function installResizeObserverTestDouble(): {
  readonly observed: (target: Element) => boolean;
  readonly notify: (target: Element) => void;
  readonly restore: () => void;
} {
  const previous = Object.getOwnPropertyDescriptor(window, "ResizeObserver");
  const observers: TestResizeObserver[] = [];

  class TestResizeObserver implements ResizeObserver {
    readonly targets = new Set<Element>();

    constructor(readonly callback: ResizeObserverCallback) {
      observers.push(this);
    }

    observe(target: Element): void {
      this.targets.add(target);
    }

    unobserve(target: Element): void {
      this.targets.delete(target);
    }

    disconnect(): void {
      this.targets.clear();
    }
  }

  Object.defineProperty(window, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: TestResizeObserver,
  });
  return {
    observed: (target) =>
      observers.some((observer) => observer.targets.has(target)),
    notify(target) {
      act(() => {
        for (const observer of observers) {
          if (observer.targets.has(target)) observer.callback([], observer);
        }
      });
    },
    restore() {
      if (previous) {
        Object.defineProperty(window, "ResizeObserver", previous);
      } else {
        Reflect.deleteProperty(window, "ResizeObserver");
      }
    },
  };
}
