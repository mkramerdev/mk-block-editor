import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import type { FirstDraftBlockDragPreviewNode } from "./document-drag-overlay-contracts.ts";
import { EDITOR_BLOCK_DND_GROUP } from "./stable-anchors.tsx";
import {
  TABLE_COLUMN_DND_GROUP,
  TABLE_ROW_DND_GROUP,
  createFirstDraftTableColumnContainerId,
  createFirstDraftTableColumnDragItems,
  createFirstDraftTableDragStore,
  createFirstDraftTableRowContainerId,
} from "../table-drag-and-drop/index.ts";

const probes = vi.hoisted(() => ({
  providerProps: null as Record<string, unknown> | null,
  remeasure: vi.fn(),
  recompute: vi.fn(),
  targetingAlgorithm: vi.fn(),
}));

vi.mock("@mk-drag-and-drop/react", () => ({
  DragProvider: ({
    children,
    ...props
  }: Record<string, unknown> & { children: ReactNode }) => {
    probes.providerProps = props;
    return children;
  },
  useRemeasureDropTargets: () => probes.remeasure,
  useRecomputeActiveDrag: () => probes.recompute,
  useDroppable: () => ({ ref: vi.fn() }),
  pointerToRectDistance: probes.targetingAlgorithm,
}));

import {
  FirstDraftBlockDragAndDropProvider,
  useFirstDraftActiveDragGroup,
  type FirstDraftBlockDragAndDropBridge,
} from "./lifecycle-bridge.tsx";
import { createFirstDraftActiveDropTargetStore } from "./active-drop-target-store.tsx";

afterEach(() => {
  cleanup();
  probes.providerProps = null;
  probes.remeasure.mockReset();
  probes.recompute.mockReset();
  vi.restoreAllMocks();
});

describe("First Draft block drag lifecycle bridge", () => {
  it("publishes only recognized active groups and preserves them through dropped end", () => {
    const fixture = createBridge();
    const closeTableActionMenu = vi.fn();
    const closeBlockActionMenuForDocumentDrag = vi.fn();
    render(
      <FirstDraftBlockDragAndDropProvider
        bridge={{
          ...fixture.bridge,
          closeTableActionMenu,
          closeBlockActionMenuForDocumentDrag,
        }}
      >
        <ActiveDragGroupProbe />
      </FirstDraftBlockDragAndDropProvider>,
    );

    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      "inactive",
    );
    act(() =>
      callback("onDragStart")({
        ...documentStart({ x: 1, y: 1 }),
        group: "unrecognized-group",
      }),
    );
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      "inactive",
    );

    act(() => callback("onDragStart")(documentStart({ x: 1, y: 1 })));
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      EDITOR_BLOCK_DND_GROUP,
    );
    expect(closeTableActionMenu).toHaveBeenCalledOnce();
    expect(closeBlockActionMenuForDocumentDrag).toHaveBeenCalledOnce();
    expect(closeBlockActionMenuForDocumentDrag).toHaveBeenCalledWith(
      asBlockId("dragged-block"),
    );
    act(() => callback("onDragEnd")(documentEnd("dropped")));
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      EDITOR_BLOCK_DND_GROUP,
    );
    act(() => callback("onDrop")(documentDrop("known-target")));
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      "inactive",
    );

    act(() => callback("onDragStart")(rowStart("row-probe" as BlockId)));
    expect(closeBlockActionMenuForDocumentDrag).toHaveBeenCalledOnce();
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      TABLE_ROW_DND_GROUP,
    );
    act(() =>
      callback("onDragEnd")(rowEnd("row-probe" as BlockId, "no-target")),
    );
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      "inactive",
    );

    act(() => callback("onDragStart")(columnStart("column-probe")));
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      TABLE_COLUMN_DND_GROUP,
    );
    act(() => callback("onDragEnd")(columnEnd("column-probe", "canceled")));
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      "inactive",
    );
  });

  it("clears drop activity in finally without allowing stale group cleanup", () => {
    const fixture = createBridge();
    fixture.placementRegistry.get.mockReturnValue(null);
    render(
      <FirstDraftBlockDragAndDropProvider bridge={fixture.bridge}>
        <ActiveDragGroupProbe />
      </FirstDraftBlockDragAndDropProvider>,
    );

    act(() => callback("onDragStart")(documentStart({ x: 1, y: 1 })));
    act(() => callback("onDragEnd")(documentEnd("dropped")));
    act(() => callback("onDragStart")(rowStart("new-row" as BlockId)));
    act(() => callback("onDrop")(documentDrop("stale-target")));
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      TABLE_ROW_DND_GROUP,
    );

    act(() =>
      callback("onDrop")({
        draggableId: "new-row",
        group: TABLE_ROW_DND_GROUP,
        source: "pointer",
        dropTargetId: null,
      }),
    );
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      "inactive",
    );
  });

  it("clears activity when a document mutation throws or its bridge is absent", () => {
    const fixture = createBridge();
    fixture.moveDocumentBlock.mockImplementation(() => {
      throw new Error("rejected move");
    });
    const view = render(
      <FirstDraftBlockDragAndDropProvider bridge={fixture.bridge}>
        <ActiveDragGroupProbe />
      </FirstDraftBlockDragAndDropProvider>,
    );
    act(() => callback("onDragStart")(documentStart({ x: 1, y: 1 })));
    act(() => callback("onDragEnd")(documentEnd("dropped")));
    let thrown: unknown;
    act(() => {
      try {
        callback("onDrop")(documentDrop("known-target"));
      } catch (error) {
        thrown = error;
      }
    });
    expect(thrown).toEqual(
      expect.objectContaining({ message: "rejected move" }),
    );
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      "inactive",
    );

    view.rerender(
      <FirstDraftBlockDragAndDropProvider>
        <ActiveDragGroupProbe />
      </FirstDraftBlockDragAndDropProvider>,
    );
    act(() => callback("onDragStart")(documentStart({ x: 1, y: 1 })));
    act(() => callback("onDragEnd")(documentEnd("dropped")));
    act(() => callback("onDrop")(documentDrop("known-target")));
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      "inactive",
    );
  });

  it("uses the package rectangle-distance algorithm for insertion lines", () => {
    render(
      <FirstDraftBlockDragAndDropProvider>
        <div />
      </FirstDraftBlockDragAndDropProvider>,
    );
    expect(probes.providerProps?.targetingAlgorithm).toBe(
      probes.targetingAlgorithm,
    );
    expect(probes.providerProps?.targetingConstraint).toBeUndefined();
    expect(probes.providerProps?.pointerConfiguration).toEqual({
      activationDelay: 180,
      activationDistance: 6,
    });
    expect(probes.providerProps?.dragOverlay).toEqual(expect.any(Function));
  });

  it("resolves one document preview and aligns its captured visual rectangle from the handle", () => {
    const fixture = createBridge();
    fixture.captureDocumentBlockDragSession.mockReturnValue(
      validDocumentSession("dragged-block", {
          left: -36,
          top: 72,
          width: 640,
          height: 148,
      }),
    );
    render(
      <FirstDraftBlockDragAndDropProvider bridge={fixture.bridge}>
        <div />
      </FirstDraftBlockDragAndDropProvider>,
    );
    act(() => callback("onDragStart")(documentStart({ x: 2, y: 3 })));

    const overlay = render(
      <>{overlayCallback()({ dragState: documentStart({ x: 2, y: 3 }) })}</>,
    ).container.firstElementChild as HTMLElement;

    expect(fixture.captureDocumentBlockDragSession).toHaveBeenCalledOnce();
    expect(fixture.captureDocumentBlockDragSession).toHaveBeenCalledWith(
      asBlockId("dragged-block"),
    );
    expect(overlay.classList).not.toContain("first-draft-example");
    expect(overlay.classList).toContain(
      "first-draft-document-block-drag-overlay",
    );
    expect(overlay.style.width).toBe("640px");
    expect(overlay.style.minHeight).toBe("148px");
    expect(overlay.style.transform).toBe("translate3d(-36px, 72px, 0)");
    expect(overlay.hasAttribute("inert")).toBe(true);
    expect(overlay.getAttribute("aria-hidden")).toBe("true");
    expect(overlay.querySelector(".divider-block__rule")).not.toBeNull();
    expect(overlay.querySelector("[data-editor-block-shell='true']")).toBeNull();
    expect(overlay.querySelector("[data-editor-block-id]")).toBeNull();
  });

  it("routes by group without crossing document and table overlay state", () => {
    const fixture = createBridge();
    const tableDragStore = createFirstDraftTableDragStore();
    const tableReads = vi.fn(tableDragStore.getSnapshot);
    const instrumentedTableDragStore = {
      ...tableDragStore,
      getSnapshot: tableReads,
    };
    render(
      <FirstDraftBlockDragAndDropProvider
        bridge={fixture.bridge}
        tableDragStore={instrumentedTableDragStore}
      >
        <div />
      </FirstDraftBlockDragAndDropProvider>,
    );
    tableReads.mockClear();
    act(() => callback("onDragStart")(documentStart({ x: 2, y: 3 })));
    tableReads.mockClear();

    render(
      <>{overlayCallback()({ dragState: documentStart({ x: 2, y: 3 }) })}</>,
    );
    expect(fixture.captureDocumentBlockDragSession).toHaveBeenCalledOnce();
    expect(tableReads).not.toHaveBeenCalled();

    overlayCallback()({ dragState: rowStart(asBlockId("row-probe")) });
    overlayCallback()({ dragState: columnStart("column-probe") });
    expect(fixture.captureDocumentBlockDragSession).toHaveBeenCalledOnce();
  });

  it("renders one measurable inert handle-sized blank when document resolution fails", () => {
    const fixture = createBridge();
    fixture.captureDocumentBlockDragSession.mockReturnValue(
      Object.freeze({
        blockId: asBlockId("dragged-block"),
        captureSucceeded: false,
      }),
    );
    render(
      <FirstDraftBlockDragAndDropProvider bridge={fixture.bridge}>
        <div />
      </FirstDraftBlockDragAndDropProvider>,
    );
    act(() => callback("onDragStart")(documentStart({ x: 2, y: 3 })));

    const overlay = render(
      <>{overlayCallback()({ dragState: documentStart({ x: 2, y: 3 }) })}</>,
    ).container.firstElementChild as HTMLElement;

    expect(overlay.style.width).toBe("20px");
    expect(overlay.style.minHeight).toBe("20px");
    expect(overlay.childElementCount).toBe(0);
    expect(overlay.hasAttribute("inert")).toBe(true);
  });

  it("keeps a failed capture inert through a dropped end and never enters the move path", () => {
    const fixture = createBridge();
    fixture.captureDocumentBlockDragSession.mockReturnValue(
      Object.freeze({
        blockId: asBlockId("dragged-block"),
        captureSucceeded: false,
      }),
    );
    render(
      <FirstDraftBlockDragAndDropProvider bridge={fixture.bridge}>
        <ActiveDragGroupProbe />
      </FirstDraftBlockDragAndDropProvider>,
    );

    act(() => callback("onDragStart")(documentStart({ x: 2, y: 3 })));
    act(() =>
      callback("onDragUpdate")(
        documentUpdate({ x: 4, y: 5 }, "known-target"),
      ),
    );
    act(() => callback("onDragEnd")(documentEnd("dropped")));
    act(() => callback("onDrop")(documentDrop("known-target")));

    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      "inactive",
    );
    expect(fixture.startDocumentBlockAutoScroll).not.toHaveBeenCalled();
    expect(fixture.updateDocumentBlockAutoScrollPoint).not.toHaveBeenCalled();
    expect(fixture.stopDocumentBlockAutoScroll).not.toHaveBeenCalled();
    expect(fixture.placementRegistry.get).not.toHaveBeenCalled();
    expect(fixture.moveDocumentBlock).not.toHaveBeenCalled();
  });

  it("clears completed sessions and captures a fresh snapshot for each drag", () => {
    const fixture = createBridge();
    render(
      <FirstDraftBlockDragAndDropProvider bridge={fixture.bridge}>
        <div />
      </FirstDraftBlockDragAndDropProvider>,
    );

    callback("onDragStart")(documentStart({ x: 1, y: 1 }));
    expect(
      render(
        <>{overlayCallback()({ dragState: documentStart({ x: 1, y: 1 }) })}</>,
      ).container.querySelector(".divider-block__rule"),
    ).not.toBeNull();
    callback("onDragEnd")(documentEnd("canceled"));
    expect(
      render(
        <>{overlayCallback()({ dragState: documentStart({ x: 1, y: 1 }) })}</>,
      ).container.querySelector(".divider-block__rule"),
    ).toBeNull();

    callback("onDragStart")(documentStart({ x: 2, y: 2 }));
    callback("onDragEnd")(documentEnd("dropped"));
    callback("onDrop")(documentDrop("known-target"));

    expect(fixture.captureDocumentBlockDragSession).toHaveBeenCalledTimes(2);
    expect(fixture.moveDocumentBlock).toHaveBeenCalledOnce();
    expect(
      render(
        <>{overlayCallback()({ dragState: documentStart({ x: 2, y: 2 }) })}</>,
      ).container.querySelector(".divider-block__rule"),
    ).toBeNull();
  });

  it("forwards package pointer points and performs no native pointer tracking", () => {
    const fixture = createBridge();
    const addEventListener = vi.spyOn(document, "addEventListener");
    render(
      <FirstDraftBlockDragAndDropProvider bridge={fixture.bridge}>
        <div />
      </FirstDraftBlockDragAndDropProvider>,
    );
    const initial = Object.freeze({ x: 11, y: 17 });
    const latest = Object.freeze({ x: 13, y: 23 });
    callback("onDragStart")(documentStart(initial));
    callback("onDragUpdate")(documentUpdate(latest, "known-target"));

    expect(fixture.startDocumentBlockAutoScroll).toHaveBeenCalledWith(
      EDITOR_BLOCK_DND_GROUP,
      initial,
    );
    expect(fixture.updateDocumentBlockAutoScrollPoint).toHaveBeenCalledWith(
      EDITOR_BLOCK_DND_GROUP,
      latest,
    );
    expect(addEventListener).not.toHaveBeenCalledWith(
      expect.stringMatching(/^pointer/),
      expect.anything(),
    );
  });

  it("notifies only the previous and next active target subscribers", () => {
    const store = createFirstDraftActiveDropTargetStore();
    const firstTarget = vi.fn();
    const secondTarget = vi.fn();
    const unrelatedTarget = vi.fn();
    store.subscribe("first", firstTarget);
    store.subscribe("second", secondTarget);
    store.subscribe("unrelated", unrelatedTarget);

    store.setActiveDropTargetId("first");
    expect(firstTarget).toHaveBeenCalledOnce();
    expect(secondTarget).not.toHaveBeenCalled();
    expect(unrelatedTarget).not.toHaveBeenCalled();

    store.setActiveDropTargetId("second");
    expect(firstTarget).toHaveBeenCalledTimes(2);
    expect(secondTarget).toHaveBeenCalledOnce();
    expect(unrelatedTarget).not.toHaveBeenCalled();

    store.setActiveDropTargetId("second");
    expect(firstTarget).toHaveBeenCalledTimes(2);
    expect(secondTarget).toHaveBeenCalledOnce();

    store.setActiveDropTargetId(null);
    expect(secondTarget).toHaveBeenCalledTimes(2);
    expect(unrelatedTarget).not.toHaveBeenCalled();
  });

  it.each(["dropped", "canceled", "no-target", "invalid-target"])(
    "stops autoscroll for a %s result",
    (result) => {
      const fixture = createBridge();
      render(
        <FirstDraftBlockDragAndDropProvider bridge={fixture.bridge}>
          <div />
        </FirstDraftBlockDragAndDropProvider>,
      );
      callback("onDragStart")(documentStart({ x: 1, y: 1 }));
      callback("onDragEnd")(documentEnd(result));
      expect(fixture.stopDocumentBlockAutoScroll).toHaveBeenCalledOnce();
    },
  );

  it("looks up one immutable position and invokes one editor move after stop", () => {
    const order: string[] = [];
    const fixture = createBridge(order);
    render(
      <FirstDraftBlockDragAndDropProvider bridge={fixture.bridge}>
        <div />
      </FirstDraftBlockDragAndDropProvider>,
    );
    callback("onDragStart")(documentStart({ x: 1, y: 1 }));
    callback("onDragEnd")(documentEnd("dropped"));
    callback("onDrop")(documentDrop("known-target"));

    expect(fixture.placementRegistry.get).toHaveBeenCalledOnce();
    expect(fixture.moveDocumentBlock).toHaveBeenCalledOnce();
    expect(fixture.moveDocumentBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        blockId: "dragged-block" as BlockId,
        parentId: null,
        childIndex: 1,
      }),
      fixture.position,
    );
    expect(order).toEqual(["stop", "lookup", "move"]);
  });

  it("fails closed for an unresolved target", () => {
    const fixture = createBridge();
    fixture.placementRegistry.get.mockImplementation(() => null);
    render(
      <FirstDraftBlockDragAndDropProvider bridge={fixture.bridge}>
        <div />
      </FirstDraftBlockDragAndDropProvider>,
    );
    callback("onDragStart")(documentStart({ x: 1, y: 1 }));
    callback("onDragEnd")(documentEnd("dropped"));
    callback("onDrop")(documentDrop("unknown-target"));
    expect(fixture.placementRegistry.get).toHaveBeenCalledWith(
      "unknown-target",
    );
    expect(fixture.moveDocumentBlock).not.toHaveBeenCalled();
  });

  it("remeasures the editor group before recomputing and releases the callback", () => {
    const order: string[] = [];
    let frame: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frame = callback;
      return 1;
    });
    probes.remeasure.mockImplementation(() => order.push("remeasure"));
    probes.recompute.mockImplementation(() => order.push("recompute"));
    const fixture = createBridge();
    const view = render(
      <FirstDraftBlockDragAndDropProvider bridge={fixture.bridge}>
        <div />
      </FirstDraftBlockDragAndDropProvider>,
    );
    expect(fixture.registeredSynchronization).toEqual(expect.any(Function));
    expect(probes.remeasure).not.toHaveBeenCalled();

    callback("onDragStart")(documentStart({ x: 0, y: 0 }));
    fixture.registeredSynchronization?.({
      kind: "scroll",
      group: EDITOR_BLOCK_DND_GROUP,
    });
    act(() => (frame as FrameRequestCallback | null)?.(0));
    expect(probes.remeasure).toHaveBeenCalledWith({
      group: EDITOR_BLOCK_DND_GROUP,
    });
    expect(order).toEqual(["remeasure", "recompute"]);

    view.unmount();
    expect(fixture.registerAutoScrollSynchronization).toHaveBeenLastCalledWith(
      null,
    );
  });

  it("coalesces actual scroll geometry and cancels obsolete frames at end", () => {
    const frames: FrameRequestCallback[] = [];
    const canceled: number[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      canceled.push(id);
    });
    const fixture = createBridge();
    render(
      <FirstDraftBlockDragAndDropProvider bridge={fixture.bridge}>
        <div />
      </FirstDraftBlockDragAndDropProvider>,
    );
    callback("onDragStart")(documentStart({ x: 0, y: 0 }));
    fixture.registeredSynchronization?.({
      kind: "scroll",
      group: EDITOR_BLOCK_DND_GROUP,
    });
    fixture.registeredSynchronization?.({
      kind: "scroll",
      group: EDITOR_BLOCK_DND_GROUP,
    });
    fixture.registeredSynchronization?.({
      kind: "scroll",
      group: TABLE_ROW_DND_GROUP,
    });
    expect(frames).toHaveLength(1);
    act(() => frames.shift()!(0));
    expect(probes.remeasure).toHaveBeenCalledTimes(1);
    expect(probes.remeasure).toHaveBeenCalledWith({
      group: EDITOR_BLOCK_DND_GROUP,
    });
    expect(probes.recompute).toHaveBeenCalledTimes(1);

    fixture.registeredSynchronization?.({
      kind: "scroll",
      group: EDITOR_BLOCK_DND_GROUP,
    });
    callback("onDragEnd")(documentEnd("canceled"));
    expect(canceled).toHaveLength(1);
    act(() => frames.shift()!(16));
    expect(probes.remeasure).toHaveBeenCalledTimes(1);
  });

  it("routes row preview and one canonical drop independently from document dragging", () => {
    let projectionFrame: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      projectionFrame = callback;
      return 1;
    });
    const geometryOrder: string[] = [];
    probes.remeasure.mockImplementation(() => geometryOrder.push("remeasure"));
    probes.recompute.mockImplementation(() => geometryOrder.push("recompute"));
    const fixture = createBridge();
    const tableDragStore = createFirstDraftTableDragStore();
    const tableId = "table" as BlockId;
    const rowIds = ["row-a", "row-b", "row-c"] as BlockId[];
    const lane = createFirstDraftTableRowContainerId(tableId);
    const columnLane = createFirstDraftTableColumnContainerId(tableId);
    const columnItems = createFirstDraftTableColumnDragItems("canonical", [
      "column-a",
    ]);
    let canonical: readonly BlockId[] = rowIds;
    const canonicalListeners = new Set<() => void>();
    const tableScrollElement = document.createElement("div");
    document.body.append(tableScrollElement);
    tableDragStore.registerTable({
      tableId,
      rowContainerId: lane,
      columnContainerId: columnLane,
      columnItems,
      getHorizontalScrollElement: () => tableScrollElement,
      captureRowDragPreview: () => ({
        axis: "row",
        tracks: "176px",
        cells: [],
      }),
      captureColumnDragPreview: (_item, structure) => ({
        axis: "column",
        columnWidth: 176,
        rowHeights: structure.rowIds.map(() => 40),
        cells: [],
      }),
      readCanonicalStructure: () => ({
        rowIds: canonical,
        cellIdsByRow: canonical.map(
          (rowId) => [`cell:${rowId}` as BlockId],
        ),
        presentationColumnIds: ["column-a"],
        columnIdentityKind: "canonical",
      }),
      subscribeCanonicalStructure(listener) {
        canonicalListeners.add(listener);
        return () => canonicalListeners.delete(listener);
      },
    });
    const carriers = rowIds.map((rowId) => {
      const element = document.createElement("div");
      document.body.append(element);
      tableDragStore.registerRowCarrier(tableId, rowId, lane, element);
      return element;
    });
    const closeMenu = vi.fn();
    const moveTableRow = vi.fn((_tableId, _rowId, finalRowIds) => {
      canonical = finalRowIds;
      for (const listener of canonicalListeners) listener();
      return {
        kind: "moved",
        rowId: rowIds[0]!,
        rowIndex: 2,
        transaction: {},
      } as never;
    });
    const bridge = {
      ...fixture.bridge,
      closeTableActionMenu: closeMenu,
      moveTableRow,
    };
    const view = render(
      <FirstDraftBlockDragAndDropProvider
        bridge={bridge}
        tableDragStore={tableDragStore}
      >
        <ActiveDragGroupProbe />
      </FirstDraftBlockDragAndDropProvider>,
    );

    act(() => callback("onDragStart")(rowStart(rowIds[0]!)));
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      TABLE_ROW_DND_GROUP,
    );
    expect(tableDragStore.getSnapshot().session).toMatchObject({
      status: "dragging",
      tableId,
      sourceRowId: rowIds[0],
      canonicalRowIds: rowIds,
    });
    expect(closeMenu).toHaveBeenCalledOnce();
    expect(fixture.startTableDragAutoScroll).toHaveBeenCalledWith(
      TABLE_ROW_DND_GROUP,
      tableId,
      tableScrollElement,
      expect.any(Object),
    );
    act(() => callback("onDragUpdate")(rowUpdate(rowIds, lane)));
    expect(fixture.updateTableDragAutoScrollPoint).toHaveBeenCalledWith(
      TABLE_ROW_DND_GROUP,
      tableId,
      expect.any(Object),
    );
    expect(canonical).toEqual(rowIds);
    const projectedSession = tableDragStore.getSnapshot().session;
    expect(projectedSession?.axis).toBe("row");
    expect(
      projectedSession?.axis === "row"
        ? projectedSession.projectedRowIds
        : null,
    ).toEqual([
      rowIds[1],
      rowIds[2],
      rowIds[0],
    ]);
    expect(projectionFrame).toEqual(expect.any(Function));
    act(() => (projectionFrame as FrameRequestCallback | null)?.(0));
    expect(probes.remeasure).toHaveBeenCalledWith({
      group: TABLE_ROW_DND_GROUP,
    });
    expect(geometryOrder).toEqual(["remeasure", "recompute"]);
    projectionFrame = null;
    act(() => callback("onDragUpdate")(rowUpdate(rowIds, lane)));
    expect(projectionFrame).toBeNull();
    act(() => callback("onDragEnd")(rowEnd(rowIds[0]!, "dropped")));
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      TABLE_ROW_DND_GROUP,
    );
    expect(fixture.stopTableDragAutoScroll).toHaveBeenCalledWith(
      TABLE_ROW_DND_GROUP,
      tableId,
    );
    expect(tableDragStore.getSnapshot().session?.status).toBe("awaiting-drop");
    act(() => callback("onDrop")(rowDrop(rowIds, lane)));
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      "inactive",
    );
    expect(moveTableRow).toHaveBeenCalledOnce();
    expect(canonical).toEqual([rowIds[1], rowIds[2], rowIds[0]]);
    expect(tableDragStore.getSnapshot().session).toBeNull();
    expect(
      fixture.stopTableDragAutoScroll.mock.invocationCallOrder[0],
    ).toBeLessThan(moveTableRow.mock.invocationCallOrder[0]!);

    callback("onDragStart")({
      ...rowStart(rowIds[0]!),
      group: TABLE_COLUMN_DND_GROUP,
    });
    expect(tableDragStore.getSnapshot().session).toBeNull();
    view.unmount();
    carriers.forEach((element) => element.remove());
    tableScrollElement.remove();
  });

  it("routes distributed column preview and one atomic drop without row or document ownership", () => {
    let projectionFrame: FrameRequestCallback | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      projectionFrame = callback;
      return 1;
    });
    const fixture = createBridge();
    const tableDragStore = createFirstDraftTableDragStore();
    const tableId = "column-table" as BlockId;
    const rowIds = ["row-a", "row-b"] as BlockId[];
    const items = createFirstDraftTableColumnDragItems("canonical", [
      "column-a",
      "column-b",
      "column-c",
    ]);
    const rowLane = createFirstDraftTableRowContainerId(tableId);
    const columnLane = createFirstDraftTableColumnContainerId(tableId);
    let columnIds = items.map((item) => item.presentationId);
    let cells = rowIds.map((_, rowIndex) =>
      [0, 1, 2].map(
        (columnIndex) => `cell-${rowIndex}-${columnIndex}` as BlockId,
      ),
    );
    const canonicalListeners = new Set<() => void>();
    const tableScrollElement = document.createElement("div");
    document.body.append(tableScrollElement);
    tableDragStore.registerTable({
      tableId,
      rowContainerId: rowLane,
      columnContainerId: columnLane,
      columnItems: items,
      getHorizontalScrollElement: () => tableScrollElement,
      captureRowDragPreview: () => ({
        axis: "row",
        tracks: "176px 176px 176px",
        cells: [],
      }),
      captureColumnDragPreview: (_item, structure) => ({
        axis: "column",
        columnWidth: 176,
        rowHeights: structure.rowIds.map(() => 40),
        cells: [],
      }),
      readCanonicalStructure: () => ({
        rowIds,
        cellIdsByRow: cells,
        presentationColumnIds: columnIds,
        columnIdentityKind: "canonical",
      }),
      subscribeCanonicalStructure(listener) {
        canonicalListeners.add(listener);
        return () => canonicalListeners.delete(listener);
      },
    });
    const carriers = items.map((item) => {
      const element = document.createElement("div");
      document.body.append(element);
      tableDragStore.registerColumnCarrier(
        tableId,
        item,
        columnLane,
        element,
      );
      return element;
    });
    const moveTableColumn = vi.fn(() => {
      columnIds = [columnIds[1]!, columnIds[2]!, columnIds[0]!];
      cells = cells.map((row) => [row[1]!, row[2]!, row[0]!]);
      for (const listener of canonicalListeners) listener();
      return {
        kind: "moved",
        columnId: "column-a",
        columnIndex: 2,
        cellIds: cells.map((row) => row[2]!),
        expectedColumnIds: columnIds,
        expectedCellIdsByRow: cells,
        transaction: {},
      } as never;
    });
    const closeMenu = vi.fn();
    const view = render(
      <FirstDraftBlockDragAndDropProvider
        bridge={{
          ...fixture.bridge,
          moveTableColumn,
          closeTableActionMenu: closeMenu,
        }}
        tableDragStore={tableDragStore}
      >
        <ActiveDragGroupProbe />
      </FirstDraftBlockDragAndDropProvider>,
    );

    act(() => callback("onDragStart")(columnStart(items[0]!.dragId)));
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      TABLE_COLUMN_DND_GROUP,
    );
    expect(tableDragStore.getSnapshot().session).toMatchObject({
      axis: "column",
      status: "dragging",
      tableId,
      sourceDragId: items[0]!.dragId,
      canonicalItems: items,
      canonicalCellIdsByRow: cells,
    });
    expect(closeMenu).toHaveBeenCalledOnce();
    expect(fixture.startDocumentBlockAutoScroll).not.toHaveBeenCalled();
    expect(fixture.startTableDragAutoScroll).toHaveBeenCalledWith(
      TABLE_COLUMN_DND_GROUP,
      tableId,
      tableScrollElement,
      expect.any(Object),
    );

    act(() =>
      callback("onDragUpdate")(columnUpdate(items, columnLane)),
    );
    expect(fixture.updateDocumentBlockAutoScrollPoint).not.toHaveBeenCalled();
    expect(projectionFrame).toEqual(expect.any(Function));
    act(() => (projectionFrame as FrameRequestCallback | null)?.(0));
    expect(probes.remeasure).toHaveBeenCalledWith({
      group: TABLE_COLUMN_DND_GROUP,
    });
    expect(tableDragStore.getSnapshot().session).toMatchObject({
      projectedItems: [items[1], items[2], items[0]],
    });

    act(() => callback("onDragEnd")(columnEnd(items[0]!.dragId, "dropped")));
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      TABLE_COLUMN_DND_GROUP,
    );
    expect(tableDragStore.getSnapshot().session).toMatchObject({
      axis: "column",
      status: "awaiting-drop",
      projectedItems: [items[1], items[2], items[0]],
    });
    act(() => callback("onDrop")(columnDrop(items, columnLane)));
    expect(screen.getByTestId("active-drag-group").textContent).toBe(
      "inactive",
    );
    expect(moveTableColumn).toHaveBeenCalledOnce();
    expect(tableDragStore.getSnapshot().session).toBeNull();
    expect(fixture.moveDocumentBlock).not.toHaveBeenCalled();
    expect(fixture.stopDocumentBlockAutoScroll).not.toHaveBeenCalled();
    expect(fixture.stopTableDragAutoScroll).toHaveBeenCalledWith(
      TABLE_COLUMN_DND_GROUP,
      tableId,
    );
    expect(
      fixture.stopTableDragAutoScroll.mock.invocationCallOrder[0],
    ).toBeLessThan(moveTableColumn.mock.invocationCallOrder[0]!);

    view.unmount();
    carriers.forEach((element) => element.remove());
    tableScrollElement.remove();
  });
});

function ActiveDragGroupProbe() {
  return (
    <output data-testid="active-drag-group">
      {useFirstDraftActiveDragGroup() ?? "inactive"}
    </output>
  );
}

function createBridge(order: string[] = []) {
  const position = Object.freeze({ parentId: null, childIndex: 2 });
  let registeredSynchronization:
    | ((event: { kind: "scroll" | "stopped"; group: string }) => void)
    | null = null;
  const moveDocumentBlock = vi.fn(() => {
      order.push("move");
      return {
        ok: false,
        handled: false,
        reason: "no-change",
      } as const;
    });
  const captureDocumentBlockDragSession = vi.fn<
    FirstDraftBlockDragAndDropBridge["captureDocumentBlockDragSession"]
  >(() => validDocumentSession("dragged-block"));
  const placementRegistry = {
    get: vi.fn((dropTargetId: string): typeof position | null => {
      void dropTargetId;
      order.push("lookup");
      return position;
    }),
  };
  const startDocumentBlockAutoScroll = vi.fn();
  const updateDocumentBlockAutoScrollPoint = vi.fn();
  const stopDocumentBlockAutoScroll = vi.fn(() => order.push("stop"));
  const startTableDragAutoScroll = vi.fn(() => true);
  const updateTableDragAutoScrollPoint = vi.fn();
  const stopTableDragAutoScroll = vi.fn();
  const registerAutoScrollSynchronization = vi.fn(
    (
      synchronize:
        | ((event: { kind: "scroll" | "stopped"; group: string }) => void)
        | null,
    ) => {
      registeredSynchronization = synchronize;
    },
  );
  const bridge: FirstDraftBlockDragAndDropBridge = {
    placementRegistry,
    captureDocumentBlockDragSession,
    moveDocumentBlock,
    startDocumentBlockAutoScroll,
    updateDocumentBlockAutoScrollPoint,
    stopDocumentBlockAutoScroll,
    startTableDragAutoScroll,
    updateTableDragAutoScrollPoint,
    stopTableDragAutoScroll,
    registerAutoScrollSynchronization,
  };
  return {
    bridge,
    captureDocumentBlockDragSession,
    moveDocumentBlock,
    placementRegistry,
    position,
    startDocumentBlockAutoScroll,
    updateDocumentBlockAutoScrollPoint,
    stopDocumentBlockAutoScroll,
    startTableDragAutoScroll,
    updateTableDragAutoScrollPoint,
    stopTableDragAutoScroll,
    registerAutoScrollSynchronization,
    get registeredSynchronization() {
      return registeredSynchronization;
    },
  };
}

function callback(name: string): (event: Record<string, unknown>) => void {
  const value = probes.providerProps?.[name];
  if (typeof value !== "function") throw new Error(`Missing ${name}`);
  return value as (event: Record<string, unknown>) => void;
}

function overlayCallback(): (input: Record<string, unknown>) => ReactNode {
  const value = probes.providerProps?.dragOverlay;
  if (typeof value !== "function") throw new Error("Missing dragOverlay");
  return value as (input: Record<string, unknown>) => ReactNode;
}

function dividerPreview(value: string): FirstDraftBlockDragPreviewNode {
  return Object.freeze({
    block: Object.freeze({
      id: asBlockId(value),
      type: "divider",
      parentId: null,
      tombstone: null,
      metadata: {},
      metadataVersion: `metadata:${value}`,
      contentVersion: null,
    }),
    content: null,
    children: Object.freeze([]),
    presentation: Object.freeze({
      headingLevel: null,
      checked: null,
      orderedListOrdinal: null,
      collapsed: null,
      selectedTabPaneId: null,
      columns: null,
      table: null,
    }),
  });
}

function validDocumentSession(
  value: string,
  rect: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  } = { left: 0, top: 0, width: 20, height: 20 },
) {
  const blockId = asBlockId(value);
  return Object.freeze({
    blockId,
    captureSucceeded: true as const,
    preview: dividerPreview(value),
    sourceRect: Object.freeze(rect),
    sourcePlacement: Object.freeze({
      blockId,
      parentId: null,
      childIndex: 1,
    }),
  });
}

const sourceRect = Object.freeze({
  x: 0,
  y: 0,
  top: 0,
  right: 20,
  bottom: 20,
  left: 0,
  width: 20,
  height: 20,
});

function documentStart(pointerPosition: { readonly x: number; readonly y: number }) {
  return {
    draggableId: "dragged-block",
    group: EDITOR_BLOCK_DND_GROUP,
    source: "pointer",
    pointerPosition,
    sourceRect,
  };
}

function documentUpdate(
  pointerPosition: { readonly x: number; readonly y: number },
  activeDropTargetId: string | null,
) {
  return {
    draggableId: "dragged-block",
    group: EDITOR_BLOCK_DND_GROUP,
    source: "pointer",
    pointerPosition,
    overlayRect: null,
    activeDropTargetId,
    previousDropTargetId: null,
    sortablePreview: { status: "inactive" },
  };
}

function documentEnd(result: string) {
  return {
    draggableId: "dragged-block",
    group: EDITOR_BLOCK_DND_GROUP,
    source: "pointer",
    result,
    overlayRect: null,
    dropTargetId: result === "dropped" ? "known-target" : null,
  };
}

function documentDrop(dropTargetId: string) {
  return {
    draggableId: "dragged-block",
    group: EDITOR_BLOCK_DND_GROUP,
    source: "pointer",
    dropTargetId,
  };
}

function rowStart(rowId: BlockId) {
  return {
    draggableId: rowId,
    group: TABLE_ROW_DND_GROUP,
    source: "pointer",
    pointerPosition: { x: 1, y: 1 },
    sourceRect,
  };
}

function rowUpdate(rowIds: readonly BlockId[], lane: string) {
  return {
    draggableId: rowIds[0]!,
    group: TABLE_ROW_DND_GROUP,
    source: "pointer",
    pointerPosition: { x: 1, y: 30 },
    overlayRect: sourceRect,
    activeDropTargetId: rowIds[2],
    previousDropTargetId: rowIds[1],
    sortablePreview: {
      status: "projected",
      placement: rowPlacement(rowIds, lane),
    },
  };
}

function rowEnd(rowId: BlockId, result: string) {
  return {
    draggableId: rowId,
    group: TABLE_ROW_DND_GROUP,
    source: "pointer",
    result,
    overlayRect: sourceRect,
    dropTargetId: result === "dropped" ? "row-c" : null,
  };
}

function rowDrop(rowIds: readonly BlockId[], lane: string) {
  return {
    draggableId: rowIds[0]!,
    group: TABLE_ROW_DND_GROUP,
    source: "pointer",
    dropTargetId: rowIds[2]!,
    sortablePlacement: rowPlacement(rowIds, lane),
  };
}

function rowPlacement(rowIds: readonly BlockId[], lane: string) {
  return {
    sourceContainerId: lane,
    containerId: lane,
    previousDraggableId: rowIds[2]!,
    nextDraggableId: null,
    targetDraggableId: rowIds[2]!,
    side: "after",
  };
}

function columnStart(dragId: string) {
  return {
    draggableId: dragId,
    group: TABLE_COLUMN_DND_GROUP,
    source: "pointer",
    pointerPosition: { x: 1, y: 1 },
    sourceRect,
  };
}

function columnUpdate(
  items: readonly { readonly dragId: string }[],
  lane: string,
) {
  return {
    draggableId: items[0]!.dragId,
    group: TABLE_COLUMN_DND_GROUP,
    source: "pointer",
    pointerPosition: { x: 30, y: 1 },
    overlayRect: sourceRect,
    activeDropTargetId: items[2]!.dragId,
    previousDropTargetId: items[1]!.dragId,
    sortablePreview: {
      status: "projected",
      placement: columnPlacement(items, lane),
    },
  };
}

function columnEnd(dragId: string, result: string) {
  return {
    draggableId: dragId,
    group: TABLE_COLUMN_DND_GROUP,
    source: "pointer",
    result,
    overlayRect: sourceRect,
    dropTargetId: result === "dropped" ? "column-target" : null,
  };
}

function columnDrop(
  items: readonly { readonly dragId: string }[],
  lane: string,
) {
  return {
    draggableId: items[0]!.dragId,
    group: TABLE_COLUMN_DND_GROUP,
    source: "pointer",
    dropTargetId: items[2]!.dragId,
    sortablePlacement: columnPlacement(items, lane),
  };
}

function columnPlacement(
  items: readonly { readonly dragId: string }[],
  lane: string,
) {
  return {
    sourceContainerId: lane,
    containerId: lane,
    previousDraggableId: items[2]!.dragId,
    nextDraggableId: null,
    targetDraggableId: items[2]!.dragId,
    side: "after",
  };
}
