import { afterEach, describe, expect, it, vi } from "vitest";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import type { SortableDropPlacement } from "@mk-drag-and-drop/react";
import {
  createFirstDraftTableDragStore,
  createFirstDraftTableColumnContainerId,
  createFirstDraftTableColumnDragItems,
  createFirstDraftTableRowContainerId,
  type FirstDraftTableColumnDragPreview,
  type FirstDraftTableRowDragPreview,
} from "./index.ts";

const tableId = asBlockId("table");
const rows = ["row-a", "row-b", "row-c"].map(asBlockId);
const lane = createFirstDraftTableRowContainerId(tableId);
const mounted: HTMLElement[] = [];

afterEach(() => {
  for (const element of mounted.splice(0)) element.remove();
});

describe("First Draft table drag store", () => {
  it("previews without canonical mutation and retains a dropped projection until commit", () => {
    const fixture = createFixture();
    expect(fixture.store.beginRowDrag(rows[0]!, rect())).toBe(true);
    expect(fixture.store.updateRowPreview(projectedPlacement())).toBe(true);
    expect(fixture.canonical).toEqual(rows);
    expect(fixture.projected()).toEqual([rows[1], rows[2], rows[0]]);

    fixture.store.endRowDrag("dropped");
    expect(fixture.store.getSnapshot().session?.status).toBe("awaiting-drop");
    expect(fixture.projected()).toEqual([rows[1], rows[2], rows[0]]);

    expect(
      fixture.store.resolveRowDrop(rows[0]!, projectedPlacement().placement),
    ).toEqual({ kind: "move", finalRowIds: [rows[1], rows[2], rows[0]] });
    expect(fixture.store.getSnapshot().session?.status).toBe(
      "awaiting-commit",
    );
    fixture.setCanonical([rows[1]!, rows[2]!, rows[0]!]);
    expect(fixture.store.getSnapshot().session).toBeNull();
    expect(fixture.projected()).toEqual([rows[1], rows[2], rows[0]]);
  });

  it.each(["inactive", "source"] as const)(
    "restores canonical presentation for %s preview",
    (status) => {
      const fixture = createFixture();
      fixture.store.beginRowDrag(rows[0]!, rect());
      fixture.store.updateRowPreview(projectedPlacement());
      fixture.store.updateRowPreview(
        status === "inactive"
          ? { status }
          : { status, placement: sourcePlacement() },
      );
      expect(fixture.projected()).toEqual(rows);
      expect(fixture.canonical).toEqual(rows);
    },
  );

  it.each(["canceled", "no-target", "invalid-target"] as const)(
    "clears projection for %s endings",
    (result) => {
      const fixture = createFixture();
      fixture.store.beginRowDrag(rows[0]!, rect());
      fixture.store.updateRowPreview(projectedPlacement());
      fixture.store.endRowDrag(result);
      expect(fixture.store.getSnapshot().session).toBeNull();
      expect(fixture.projected()).toEqual(rows);
    },
  );

  it("commits nothing for a package-confirmed source drop", () => {
    const fixture = createFixture();
    fixture.store.beginRowDrag(rows[1]!, rect());
    fixture.store.endRowDrag("dropped");
    expect(fixture.store.resolveRowDrop(rows[1]!, undefined)).toEqual({
      kind: "no-op",
    });
    expect(fixture.store.getSnapshot().session).toBeNull();
  });

  it("fails closed when canonical membership becomes stale", () => {
    const fixture = createFixture();
    fixture.store.beginRowDrag(rows[0]!, rect());
    fixture.store.updateRowPreview(projectedPlacement());
    fixture.setCanonical([rows[0]!, rows[1]!]);
    expect(fixture.store.getSnapshot().session?.valid).toBe(false);
    expect(fixture.projected()).toEqual(fixture.canonical);
  });

  it("falls back to a remotely reordered canonical row sequence", () => {
    const fixture = createFixture();
    fixture.store.beginRowDrag(rows[0]!, rect());
    fixture.store.updateRowPreview(projectedPlacement());
    fixture.setCanonical([rows[2]!, rows[0]!, rows[1]!]);
    expect(fixture.store.getSnapshot().session).toMatchObject({
      axis: "row",
      valid: false,
    });
    expect(fixture.projected()).toEqual([rows[2], rows[0], rows[1]]);
  });

  it("invalidates when any required row carrier disconnects", () => {
    const fixture = createFixture();
    fixture.store.beginRowDrag(rows[0]!, rect());
    fixture.store.updateRowPreview(projectedPlacement());
    fixture.disconnectRowCarrier(2);
    expect(fixture.store.getSnapshot().session).toMatchObject({ valid: false });
    expect(fixture.projected()).toEqual(fixture.canonical);
  });

  it("routes the original pointer input through live carrier activations only", () => {
    const rowFixture = createFixture();
    const rowActivation = vi.fn();
    const rowEvent = {} as Parameters<
      typeof rowFixture.store.activateRowCarrier
    >[1];
    expect(rowFixture.store.activateRowCarrier(rows[0]!, rowEvent)).toBe(
      false,
    );
    const releaseRowActivation =
      rowFixture.store.registerRowCarrierActivation(
        rows[0]!,
        rowActivation,
      );
    expect(rowFixture.store.activateRowCarrier(rows[0]!, rowEvent)).toBe(true);
    expect(rowActivation).toHaveBeenCalledWith(rowEvent);
    releaseRowActivation();
    expect(rowFixture.store.activateRowCarrier(rows[0]!, rowEvent)).toBe(
      false,
    );

    const columnFixture = createColumnFixture();
    const columnActivation = vi.fn();
    const columnEvent = {} as Parameters<
      typeof columnFixture.store.activateColumnCarrier
    >[1];
    const dragId = columnFixture.items[0]!.dragId;
    const releaseColumnActivation =
      columnFixture.store.registerColumnCarrierActivation(
        dragId,
        columnActivation,
      );
    expect(
      columnFixture.store.activateColumnCarrier(dragId, columnEvent),
    ).toBe(true);
    expect(columnActivation).toHaveBeenCalledWith(columnEvent);
    columnFixture.disconnectColumnCarrier(0);
    expect(
      columnFixture.store.activateColumnCarrier(dragId, columnEvent),
    ).toBe(false);
    releaseColumnActivation();
  });

  it("captures one operation-local row preview and fails activation when capture fails", () => {
    const fixture = createFixture();
    expect(fixture.store.beginRowDrag(rows[0]!, rect())).toBe(true);
    expect(fixture.captureRowDragPreview).toHaveBeenCalledOnce();
    fixture.store.updateRowPreview(projectedPlacement());
    fixture.store.updateRowPreview({ status: "inactive" });
    expect(fixture.captureRowDragPreview).toHaveBeenCalledOnce();
    fixture.store.endRowDrag("canceled");

    fixture.captureRowDragPreview.mockReturnValueOnce(null);
    expect(fixture.store.beginRowDrag(rows[0]!, rect())).toBe(false);
    expect(fixture.store.getSnapshot().session).toBeNull();
  });

  it("projects one opaque column order through every row without canonical mutation", () => {
    const fixture = createColumnFixture();
    const source = fixture.items[0]!;

    expect(fixture.store.beginColumnDrag(source.dragId, columnRect())).toBe(
      true,
    );
    expect(
      fixture.store.updateColumnPreview(columnProjectedPlacement(fixture)),
    ).toBe(true);
    expect(fixture.structure.cellIdsByRow).toEqual(fixture.canonicalCells);
    expect(fixture.projectedItems()).toEqual([
      fixture.items[1],
      fixture.items[2],
      fixture.items[0],
    ]);
    fixture.structure.rowIds.forEach((rowId, rowIndex) => {
      expect(fixture.projectedCells(rowId)).toEqual([
        fixture.canonicalCells[rowIndex]![1],
        fixture.canonicalCells[rowIndex]![2],
        fixture.canonicalCells[rowIndex]![0],
      ]);
    });

    fixture.store.endColumnDrag("dropped");
    expect(fixture.store.getSnapshot().session?.status).toBe("awaiting-drop");
    const drop = fixture.store.resolveColumnDrop(
      source.dragId,
      columnProjectedPlacement(fixture).placement,
    );
    expect(drop).toMatchObject({
      kind: "move",
      tableId: fixture.tableId,
      sourceTarget: source.target,
    });
    expect(fixture.store.getSnapshot().session?.status).toBe(
      "awaiting-commit",
    );

    const expectedCells = fixture.canonicalCells.map((row) => [
      row[1]!,
      row[2]!,
      row[0]!,
    ]);
    fixture.setCanonical(
      [fixture.items[1]!.presentationId, fixture.items[2]!.presentationId, fixture.items[0]!.presentationId],
      expectedCells,
    );
    fixture.store.completeColumnCommit({
      columnIds: fixture.structure.presentationColumnIds,
      cellIdsByRow: expectedCells,
    });
    expect(fixture.store.getSnapshot().session).toBeNull();
  });

  it("captures one operation-local column preview and fails activation when capture fails", () => {
    const fixture = createColumnFixture();
    const source = fixture.items[1]!;
    expect(fixture.store.beginColumnDrag(source.dragId, columnRect())).toBe(true);
    expect(fixture.captureColumnDragPreview).toHaveBeenCalledOnce();
    fixture.store.updateColumnPreview(columnProjectedPlacement(fixture));
    expect(fixture.captureColumnDragPreview).toHaveBeenCalledOnce();
    fixture.store.endColumnDrag("canceled");

    fixture.captureColumnDragPreview.mockReturnValueOnce(null);
    expect(fixture.store.beginColumnDrag(source.dragId, columnRect())).toBe(false);
    expect(fixture.store.getSnapshot().session).toBeNull();
  });

  it.each(["inactive", "source"] as const)(
    "returns every row and carrier to canonical order for column %s preview",
    (status) => {
      const fixture = createColumnFixture();
      fixture.store.beginColumnDrag(fixture.items[0]!.dragId, columnRect());
      fixture.store.updateColumnPreview(columnProjectedPlacement(fixture));
      fixture.store.updateColumnPreview(
        status === "inactive"
          ? { status }
          : {
              status,
              placement: columnSourcePlacement(fixture),
            },
      );
      expect(fixture.projectedItems()).toEqual(fixture.items);
      fixture.structure.rowIds.forEach((rowId, rowIndex) => {
        expect(fixture.projectedCells(rowId)).toEqual(
          fixture.canonicalCells[rowIndex],
        );
      });
    },
  );

  it("invalidates distributed projection when one row changes remotely", () => {
    const fixture = createColumnFixture();
    fixture.store.beginColumnDrag(fixture.items[0]!.dragId, columnRect());
    fixture.store.updateColumnPreview(columnProjectedPlacement(fixture));
    fixture.setCanonical(fixture.structure.presentationColumnIds, [
      fixture.canonicalCells[0]!,
      fixture.canonicalCells[1]!.slice(0, 2),
      fixture.canonicalCells[2]!,
    ]);
    expect(fixture.store.getSnapshot().session).toMatchObject({
      axis: "column",
      valid: false,
    });
    expect(fixture.projectedCells(fixture.structure.rowIds[0]!)).toEqual(
      fixture.canonicalCells[0],
    );
  });

  it("invalidates when any required column carrier disconnects", () => {
    const fixture = createColumnFixture();
    fixture.store.beginColumnDrag(fixture.items[0]!.dragId, columnRect());
    fixture.store.updateColumnPreview(columnProjectedPlacement(fixture));
    fixture.disconnectColumnCarrier(2);
    expect(fixture.store.getSnapshot().session).toMatchObject({ valid: false });
    expect(fixture.projectedItems()).toEqual(fixture.items);
  });

  it.each(["canceled", "no-target", "invalid-target"] as const)(
    "clears distributed column projection for %s endings",
    (result) => {
      const fixture = createColumnFixture();
      fixture.store.beginColumnDrag(fixture.items[0]!.dragId, columnRect());
      fixture.store.updateColumnPreview(columnProjectedPlacement(fixture));
      fixture.store.endColumnDrag(result);
      expect(fixture.store.getSnapshot().session).toBeNull();
      fixture.structure.rowIds.forEach((rowId, rowIndex) => {
        expect(fixture.projectedCells(rowId)).toEqual(
          fixture.canonicalCells[rowIndex],
        );
      });
    },
  );

  it("commits no column transaction request without sortable placement", () => {
    const fixture = createColumnFixture();
    fixture.store.beginColumnDrag(fixture.items[0]!.dragId, columnRect());
    fixture.store.endColumnDrag("dropped");
    expect(
      fixture.store.resolveColumnDrop(fixture.items[0]!.dragId, undefined),
    ).toEqual({ kind: "no-op" });
    expect(fixture.store.getSnapshot().session).toBeNull();
  });

  it("allocates globally distinct opaque tokens for repeated synthetic presentations", () => {
    const first = createFirstDraftTableColumnDragItems(
      "synthetic-presentation",
      ["column-1", "column-2"],
    );
    const second = createFirstDraftTableColumnDragItems(
      "synthetic-presentation",
      ["column-1", "column-2"],
    );
    expect(new Set([...first, ...second].map((item) => item.dragId)).size).toBe(
      4,
    );
    expect(first[0]!.dragId).not.toContain("column-1");
  });
});

function createFixture() {
  const store = createFirstDraftTableDragStore();
  let canonical: readonly BlockId[] = rows;
  const listeners = new Set<() => void>();
  const columnItems = createFirstDraftTableColumnDragItems("canonical", [
    "column-a",
  ]);
  const scrollElement = document.createElement("div");
  const captureRowDragPreview = vi.fn<
    () => FirstDraftTableRowDragPreview | null
  >(() => ({
    axis: "row" as const,
    tracks: "176px",
    cells: [],
  }));
  document.body.append(scrollElement);
  mounted.push(scrollElement);
  store.registerTable({
    tableId,
    rowContainerId: lane,
    columnContainerId: createFirstDraftTableColumnContainerId(tableId),
    columnItems,
    getHorizontalScrollElement: () => scrollElement,
    captureRowDragPreview,
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
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const carrierReleases: Array<() => void> = [];
  for (const rowId of rows) {
    const element = document.createElement("div");
    document.body.append(element);
    mounted.push(element);
    carrierReleases.push(
      store.registerRowCarrier(tableId, rowId, lane, element),
    );
  }
  return {
    store,
    captureRowDragPreview,
    disconnectRowCarrier(index: number) {
      carrierReleases[index]?.();
    },
    get canonical() {
      return canonical;
    },
    setCanonical(next: readonly BlockId[]) {
      canonical = next;
      for (const listener of [...listeners]) listener();
    },
    projected: () =>
      store.childOrderProjection.getProjectedChildIds(tableId, canonical),
  };
}

function projectedPlacement() {
  return {
    status: "projected" as const,
    placement: {
      sourceContainerId: lane,
      containerId: lane,
      previousDraggableId: rows[2]!,
      nextDraggableId: null,
      targetDraggableId: rows[2]!,
      side: "after" as const,
    },
  };
}

function sourcePlacement(): SortableDropPlacement {
  return {
    sourceContainerId: lane,
    containerId: lane,
    previousDraggableId: null,
    nextDraggableId: rows[1]!,
    targetDraggableId: null,
    side: null,
  };
}

function rect() {
  return {
    x: 0,
    y: 0,
    top: 0,
    right: 624,
    bottom: 40,
    left: 0,
    width: 624,
    height: 40,
  };
}

function createColumnFixture() {
  const store = createFirstDraftTableDragStore();
  const currentTableId = asBlockId("column-table");
  const rowIds = ["column-row-a", "column-row-b", "column-row-c"].map(
    asBlockId,
  );
  const canonicalCells = rowIds.map((_, rowIndex) =>
    [0, 1, 2].map((columnIndex) =>
      asBlockId(`cell-${rowIndex}-${columnIndex}`),
    ),
  );
  const items = createFirstDraftTableColumnDragItems("canonical", [
    "column-a",
    "column-b",
    "column-c",
  ]);
  const columnLane = createFirstDraftTableColumnContainerId(currentTableId);
  const rowLane = createFirstDraftTableRowContainerId(currentTableId);
  const listeners = new Set<() => void>();
  const scrollElement = document.createElement("div");
  document.body.append(scrollElement);
  mounted.push(scrollElement);
  let structure = {
    rowIds: rowIds as readonly BlockId[],
    cellIdsByRow: canonicalCells as readonly (readonly BlockId[])[],
    presentationColumnIds: items.map((item) => item.presentationId),
    columnIdentityKind: "canonical" as const,
  };
  const captureColumnDragPreview = vi.fn<
    (
      item: (typeof items)[number],
      current: typeof structure,
    ) => FirstDraftTableColumnDragPreview | null
  >(
    (_item: (typeof items)[number], current: typeof structure) => ({
      axis: "column" as const,
      columnWidth: 176,
      rowHeights: current.rowIds.map(() => 40),
      cells: [],
    }),
  );
  store.registerTable({
    tableId: currentTableId,
    rowContainerId: rowLane,
    columnContainerId: columnLane,
    columnItems: items,
    getHorizontalScrollElement: () => scrollElement,
    captureRowDragPreview: () => ({
      axis: "row",
      tracks: "176px 176px 176px",
      cells: [],
    }),
    captureColumnDragPreview,
    readCanonicalStructure: () => structure,
    subscribeCanonicalStructure(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
  const carrierReleases: Array<() => void> = [];
  for (const item of items) {
    const element = document.createElement("div");
    document.body.append(element);
    mounted.push(element);
    carrierReleases.push(
      store.registerColumnCarrier(
        currentTableId,
        item,
        columnLane,
        element,
      ),
    );
  }
  return {
    store,
    tableId: currentTableId,
    items,
    captureColumnDragPreview,
    columnLane,
    disconnectColumnCarrier(index: number) {
      carrierReleases[index]?.();
    },
    canonicalCells,
    get structure() {
      return structure;
    },
    setCanonical(
      presentationColumnIds: readonly string[],
      cellIdsByRow: readonly (readonly BlockId[])[],
    ) {
      structure = {
        ...structure,
        presentationColumnIds: [...presentationColumnIds],
        cellIdsByRow: cellIdsByRow.map((row) => [...row]),
      };
      for (const listener of [...listeners]) listener();
    },
    projectedItems: () => {
      const session = store.getSnapshot().session;
      return session?.axis === "column" ? session.projectedItems : items;
    },
    projectedCells: (rowId: BlockId) => {
      const rowIndex = structure.rowIds.indexOf(rowId);
      const canonical = structure.cellIdsByRow[rowIndex]!;
      return store.childOrderProjection.getProjectedChildIds(rowId, canonical);
    },
  };
}

function columnProjectedPlacement(fixture: ReturnType<typeof createColumnFixture>) {
  return {
    status: "projected" as const,
    placement: {
      sourceContainerId: fixture.columnLane,
      containerId: fixture.columnLane,
      previousDraggableId: fixture.items[2]!.dragId,
      nextDraggableId: null,
      targetDraggableId: fixture.items[2]!.dragId,
      side: "after" as const,
    },
  };
}

function columnSourcePlacement(fixture: ReturnType<typeof createColumnFixture>) {
  return {
    sourceContainerId: fixture.columnLane,
    containerId: fixture.columnLane,
    previousDraggableId: null,
    nextDraggableId: fixture.items[1]!.dragId,
    targetDraggableId: null,
    side: null,
  };
}

function columnRect() {
  return {
    x: 0,
    y: 0,
    top: 0,
    right: 208,
    bottom: 160,
    left: 0,
    width: 208,
    height: 160,
  };
}
