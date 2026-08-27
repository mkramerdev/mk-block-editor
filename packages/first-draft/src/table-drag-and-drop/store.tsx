"use client";

import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  type FirstDraftTableCanonicalDragStructure,
  type FirstDraftTableColumnDragSession,
  type FirstDraftTableDragRegistration,
  type FirstDraftTableDragSession,
  type FirstDraftTableDragSnapshot,
  type FirstDraftTableDragStore,
  type FirstDraftTableSortablePointerActivation,
  type TableColumnDragItem,
} from "./contracts.ts";
import {
  projectSortableBlockOrder,
  projectSortableRecordOrder,
} from "./sortable-placement.ts";

const initialSnapshot: FirstDraftTableDragSnapshot = Object.freeze({
  revision: 0,
  projectionRevision: 0,
  geometryRevision: 0,
  session: null,
});

interface RegisteredTable extends FirstDraftTableDragRegistration {
  readonly token: symbol;
  readonly unsubscribe: () => void;
}

interface RegisteredRowCarrier {
  readonly tableId: BlockId;
  readonly rowContainerId: string;
  readonly element: HTMLElement;
  readonly token: symbol;
}

interface RegisteredColumnCarrier {
  readonly tableId: BlockId;
  readonly item: TableColumnDragItem;
  readonly columnContainerId: string;
  readonly element: HTMLElement;
  readonly token: symbol;
}

interface RegisteredCarrierActivation {
  readonly activation: FirstDraftTableSortablePointerActivation;
  readonly token: symbol;
}

export function createFirstDraftTableDragStore(): FirstDraftTableDragStore {
  const listeners = new Set<() => void>();
  const parentListeners = new Map<BlockId, Set<() => void>>();
  const tables = new Map<BlockId, RegisteredTable>();
  const rowCarriers = new Map<BlockId, RegisteredRowCarrier>();
  const columnCarriers = new Map<string, RegisteredColumnCarrier>();
  const rowCarrierActivations = new Map<BlockId, RegisteredCarrierActivation>();
  const columnCarrierActivations = new Map<
    string,
    RegisteredCarrierActivation
  >();
  const tableGeometryKeys = new Map<BlockId, string>();
  let snapshot = initialSnapshot;

  const publish = (
    session: FirstDraftTableDragSession | null,
    projectionChanged = false,
    geometryChanged = false,
  ): void => {
    const parents = new Set([
      ...projectionParents(snapshot.session),
      ...projectionParents(session),
    ]);
    snapshot = Object.freeze({
      revision: snapshot.revision + 1,
      projectionRevision:
        snapshot.projectionRevision + (projectionChanged ? 1 : 0),
      geometryRevision:
        snapshot.geometryRevision + (geometryChanged ? 1 : 0),
      session,
    });
    for (const listener of [...listeners]) listener();
    for (const parentId of parents) notifyParent(parentId);
  };

  const clear = (): void => {
    const session = snapshot.session;
    if (!session) return;
    publish(null, hasProjectedOrder(session));
  };

  const invalidate = (
    session: FirstDraftTableDragSession,
    structure?: FirstDraftTableCanonicalDragStructure,
  ): void => {
    if (session.axis === "row") {
      const canonicalRowIds = structure?.rowIds ?? session.canonicalRowIds;
      publish(
        Object.freeze({
          ...session,
          canonicalRowIds,
          projectedRowIds: canonicalRowIds,
          valid: false,
        }),
        !sameOrder(session.projectedRowIds, canonicalRowIds),
      );
      return;
    }
    publish(
      Object.freeze({
        ...session,
        projectedItems: session.canonicalItems,
        valid: false,
      }),
      !sameItemOrder(session.projectedItems, session.canonicalItems),
    );
  };

  const reconcile = (): void => {
    const session = snapshot.session;
    if (!session) return;
    const registration = tables.get(session.tableId);
    if (!registration) {
      clear();
      return;
    }
    let structure: FirstDraftTableCanonicalDragStructure;
    try {
      structure = registration.readCanonicalStructure();
    } catch {
      clear();
      return;
    }
    if (session.axis === "row") {
      if (
        session.status === "awaiting-commit" &&
        session.expectedFinalRowIds &&
        sameOrder(structure.rowIds, session.expectedFinalRowIds)
      ) {
        clear();
        return;
      }
      if (
        !sameOrder(structure.rowIds, session.canonicalRowIds) ||
        !isExactPermutation(structure.rowIds, session.projectedRowIds)
      ) {
        invalidate(session, structure);
      }
      return;
    }

    if (session.status === "awaiting-commit") {
      if (
        session.expectedColumnIds === null ||
        session.expectedCellIdsByRow === null
      ) {
        return;
      }
      if (
        sameOrder(structure.rowIds, session.canonicalRowIds) &&
        structure.columnIdentityKind === "canonical" &&
        sameOrder(structure.presentationColumnIds, session.expectedColumnIds) &&
        sameMatrix(structure.cellIdsByRow, session.expectedCellIdsByRow)
      ) {
        clear();
      } else {
        clear();
      }
      return;
    }
    if (!columnStructureMatchesSession(structure, session)) {
      invalidate(session);
    }
  };

  const store: FirstDraftTableDragStore = {
    childOrderProjection: {
      subscribe(parentId, listener) {
        return store.subscribeParent(parentId, listener);
      },
      getProjectedChildIds(parentId, canonicalChildIds) {
        const session = snapshot.session;
        if (!session?.valid) return canonicalChildIds;
        if (session.axis === "row") {
          return session.tableId === parentId &&
            isExactPermutation(canonicalChildIds, session.projectedRowIds)
            ? session.projectedRowIds
            : canonicalChildIds;
        }
        const rowIndex = session.canonicalRowIds.indexOf(parentId);
        if (rowIndex < 0) return canonicalChildIds;
        const capturedCells = session.canonicalCellIdsByRow[rowIndex];
        if (
          !capturedCells ||
          !sameOrder(canonicalChildIds, capturedCells) ||
          capturedCells.length !== session.canonicalItems.length
        ) {
          return canonicalChildIds;
        }
        const projectedCells = session.projectedItems.map((item) => {
          const canonicalIndex = session.canonicalItems.findIndex(
            (candidate) => candidate.dragId === item.dragId,
          );
          return capturedCells[canonicalIndex]!;
        });
        return isExactPermutation(canonicalChildIds, projectedCells)
          ? projectedCells
          : canonicalChildIds;
      },
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeParent(parentId, listener) {
      const subscriptions = parentListeners.get(parentId) ?? new Set();
      subscriptions.add(listener);
      parentListeners.set(parentId, subscriptions);
      return () => {
        subscriptions.delete(listener);
        if (subscriptions.size === 0) parentListeners.delete(parentId);
      };
    },
    getTableScrollElement(tableId) {
      const registration = tables.get(tableId);
      if (!registration) return null;
      try {
        const element = registration.getHorizontalScrollElement();
        return element?.isConnected ? element : null;
      } catch {
        return null;
      }
    },
    registerTable(registration) {
      const token = Symbol("table-drag-registration");
      tables.get(registration.tableId)?.unsubscribe();
      const unsubscribe = registration.subscribeCanonicalStructure(reconcile);
      tables.set(registration.tableId, { ...registration, token, unsubscribe });
      reconcile();
      return () => {
        const current = tables.get(registration.tableId);
        if (current?.token !== token) return;
        current.unsubscribe();
        tables.delete(registration.tableId);
        tableGeometryKeys.delete(registration.tableId);
        if (snapshot.session?.tableId === registration.tableId) clear();
      };
    },
    registerRowCarrier(tableId, rowId, rowContainerId, element) {
      const token = Symbol("row-drag-carrier");
      rowCarriers.set(rowId, { tableId, rowContainerId, element, token });
      return () => {
        if (rowCarriers.get(rowId)?.token !== token) return;
        rowCarriers.delete(rowId);
        const session = snapshot.session;
        if (
          session?.axis === "row" &&
          session.canonicalRowIds.includes(rowId)
        ) {
          invalidate(session);
        }
      };
    },
    registerColumnCarrier(
      tableId,
      item,
      columnContainerId,
      element,
    ) {
      const token = Symbol("column-drag-carrier");
      columnCarriers.set(item.dragId, {
        tableId,
        item,
        columnContainerId,
        element,
        token,
      });
      return () => {
        if (columnCarriers.get(item.dragId)?.token !== token) return;
        columnCarriers.delete(item.dragId);
        const session = snapshot.session;
        if (
          session?.axis === "column" &&
          session.canonicalItems.some(
            (candidate) => candidate.dragId === item.dragId,
          )
        ) {
          invalidate(session);
        }
      };
    },
    registerRowCarrierActivation(rowId, activation) {
      const token = Symbol("row-carrier-activation");
      rowCarrierActivations.set(rowId, { activation, token });
      return () => {
        if (rowCarrierActivations.get(rowId)?.token === token) {
          rowCarrierActivations.delete(rowId);
        }
      };
    },
    registerColumnCarrierActivation(dragId, activation) {
      const token = Symbol("column-carrier-activation");
      columnCarrierActivations.set(dragId, { activation, token });
      return () => {
        if (columnCarrierActivations.get(dragId)?.token === token) {
          columnCarrierActivations.delete(dragId);
        }
      };
    },
    activateRowCarrier(rowId, event) {
      const carrier = rowCarriers.get(rowId);
      const registration = rowCarrierActivations.get(rowId);
      if (!carrier?.element.isConnected || !registration) return false;
      registration.activation(event);
      return true;
    },
    activateColumnCarrier(dragId, event) {
      const carrier = columnCarriers.get(dragId);
      const registration = columnCarrierActivations.get(dragId);
      if (!carrier?.element.isConnected || !registration) return false;
      registration.activation(event);
      return true;
    },
    beginRowDrag(rowId, sourceRect) {
      const carrier = rowCarriers.get(rowId);
      const registration = carrier ? tables.get(carrier.tableId) : undefined;
      if (
        !carrier ||
        !registration ||
        !carrier.element.isConnected ||
        carrier.rowContainerId !== registration.rowContainerId
      ) {
        clear();
        return false;
      }
      let structure: FirstDraftTableCanonicalDragStructure;
      try {
        structure = registration.readCanonicalStructure();
      } catch {
        clear();
        return false;
      }
      const canonicalRowIds = [...structure.rowIds];
      if (
        canonicalRowIds.filter((candidate) => candidate === rowId).length !==
          1 ||
        !canonicalRowIds.every((candidate) => {
          const mounted = rowCarriers.get(candidate);
          return (
            mounted?.tableId === registration.tableId &&
            mounted.rowContainerId === registration.rowContainerId &&
            mounted.element.isConnected
          );
        })
      ) {
        clear();
        return false;
      }
      const preview = registration.captureRowDragPreview(rowId, structure);
      if (!preview) {
        clear();
        return false;
      }
      publish(
        Object.freeze({
          axis: "row",
          status: "dragging",
          tableId: registration.tableId,
          sourceRowId: rowId,
          rowContainerId: registration.rowContainerId,
          canonicalRowIds,
          projectedRowIds: canonicalRowIds,
          expectedFinalRowIds: null,
          preview,
          sourceRect,
          valid: true,
        }),
      );
      return true;
    },
    updateRowPreview(preview) {
      const session = snapshot.session;
      if (
        session?.axis !== "row" ||
        session.status !== "dragging" ||
        !session.valid
      ) {
        return false;
      }
      let nextOrder = session.canonicalRowIds;
      if (preview.status === "projected") {
        const result = projectSortableBlockOrder(
          session.canonicalRowIds,
          session.sourceRowId,
          session.rowContainerId,
          preview.placement,
        );
        if (!result.ok) {
          invalidate(session);
          return false;
        }
        nextOrder = result.order;
      }
      if (sameOrder(session.projectedRowIds, nextOrder)) return false;
      publish(Object.freeze({ ...session, projectedRowIds: nextOrder }), true);
      return true;
    },
    endRowDrag(result) {
      const session = snapshot.session;
      if (session?.axis !== "row") return;
      if (result === "dropped" && session.valid) {
        publish(Object.freeze({ ...session, status: "awaiting-drop" }));
      } else {
        clear();
      }
    },
    resolveRowDrop(rowId, placement) {
      const session = snapshot.session;
      if (
        session?.axis !== "row" ||
        session.status !== "awaiting-drop" ||
        !session.valid ||
        session.sourceRowId !== rowId
      ) {
        if (session?.axis === "row") clear();
        return { kind: "invalid", reason: "row drop session is stale" };
      }
      if (!placement) {
        clear();
        return { kind: "no-op" };
      }
      const registration = tables.get(session.tableId);
      if (!registration) {
        clear();
        return { kind: "invalid", reason: "table registration is missing" };
      }
      let canonical: readonly BlockId[];
      try {
        canonical = registration.readCanonicalStructure().rowIds;
      } catch (error) {
        clear();
        return { kind: "invalid", reason: errorMessage(error) };
      }
      const result = projectSortableBlockOrder(
        canonical,
        session.sourceRowId,
        session.rowContainerId,
        placement,
      );
      if (!result.ok) {
        clear();
        return { kind: "invalid", reason: result.reason };
      }
      if (!result.changed) {
        clear();
        return { kind: "no-op" };
      }
      publish(
        Object.freeze({
          ...session,
          status: "awaiting-commit",
          canonicalRowIds: canonical,
          projectedRowIds: result.order,
          expectedFinalRowIds: result.order,
        }),
        !sameOrder(session.projectedRowIds, result.order),
      );
      return { kind: "move", finalRowIds: result.order };
    },
    clearRowDrag() {
      if (snapshot.session?.axis === "row") clear();
    },
    beginColumnDrag(dragId, sourceRect) {
      const carrier = columnCarriers.get(dragId);
      const registration = carrier ? tables.get(carrier.tableId) : undefined;
      if (
        !carrier ||
        !registration ||
        !carrier.element.isConnected ||
        carrier.columnContainerId !== registration.columnContainerId
      ) {
        clear();
        return false;
      }
      let structure: FirstDraftTableCanonicalDragStructure;
      try {
        structure = registration.readCanonicalStructure();
      } catch {
        clear();
        return false;
      }
      if (
        !registrationMatchesStructure(registration, structure) ||
        !registration.columnItems.every((item) => {
          const mounted = columnCarriers.get(item.dragId);
          return (
            mounted?.tableId === registration.tableId &&
            mounted.columnContainerId === registration.columnContainerId &&
            mounted.element.isConnected &&
            sameColumnTarget(mounted.item.target, item.target)
          );
        })
      ) {
        clear();
        return false;
      }
      const source = registration.columnItems.find(
        (item) => item.dragId === dragId,
      );
      if (!source) {
        clear();
        return false;
      }
      const preview = registration.captureColumnDragPreview(source, structure);
      if (!preview) {
        clear();
        return false;
      }
      const canonicalItems = [...registration.columnItems];
      publish(
        Object.freeze({
          axis: "column",
          status: "dragging",
          tableId: registration.tableId,
          sourceDragId: dragId,
          sourceTarget: source.target,
          columnContainerId: registration.columnContainerId,
          canonicalItems,
          projectedItems: canonicalItems,
          canonicalRowIds: [...structure.rowIds],
          canonicalCellIdsByRow: structure.cellIdsByRow.map((row) => [
            ...row,
          ]),
          expectedColumnIds: null,
          expectedCellIdsByRow: null,
          preview,
          sourceRect,
          valid: true,
        }),
      );
      return true;
    },
    updateColumnPreview(preview) {
      const session = snapshot.session;
      if (
        session?.axis !== "column" ||
        session.status !== "dragging" ||
        !session.valid
      ) {
        return false;
      }
      let nextOrder = session.canonicalItems;
      if (preview.status === "projected") {
        const result = projectSortableRecordOrder(
          session.canonicalItems,
          session.sourceDragId,
          session.columnContainerId,
          preview.placement,
          readDragId,
        );
        if (!result.ok) {
          invalidate(session);
          return false;
        }
        nextOrder = result.order;
      }
      if (sameItemOrder(session.projectedItems, nextOrder)) return false;
      publish(Object.freeze({ ...session, projectedItems: nextOrder }), true);
      return true;
    },
    endColumnDrag(result) {
      const session = snapshot.session;
      if (session?.axis !== "column") return;
      if (result === "dropped" && session.valid) {
        publish(Object.freeze({ ...session, status: "awaiting-drop" }));
      } else {
        clear();
      }
    },
    resolveColumnDrop(dragId, placement) {
      const session = snapshot.session;
      if (
        session?.axis !== "column" ||
        session.status !== "awaiting-drop" ||
        !session.valid ||
        session.sourceDragId !== dragId
      ) {
        if (session?.axis === "column") clear();
        return { kind: "invalid", reason: "column drop session is stale" };
      }
      if (!placement) {
        clear();
        return { kind: "no-op" };
      }
      const registration = tables.get(session.tableId);
      if (!registration) {
        clear();
        return { kind: "invalid", reason: "table registration is missing" };
      }
      let structure: FirstDraftTableCanonicalDragStructure;
      try {
        structure = registration.readCanonicalStructure();
      } catch (error) {
        clear();
        return { kind: "invalid", reason: errorMessage(error) };
      }
      if (
        !columnStructureMatchesSession(structure, session) ||
        !sameItemOrder(registration.columnItems, session.canonicalItems)
      ) {
        clear();
        return { kind: "invalid", reason: "column identities are stale" };
      }
      const result = projectSortableRecordOrder(
        session.canonicalItems,
        session.sourceDragId,
        session.columnContainerId,
        placement,
        readDragId,
      );
      if (!result.ok) {
        clear();
        return { kind: "invalid", reason: result.reason };
      }
      if (!result.changed) {
        clear();
        return { kind: "no-op" };
      }
      publish(
        Object.freeze({
          ...session,
          status: "awaiting-commit",
          projectedItems: result.order,
          expectedColumnIds: null,
          expectedCellIdsByRow: null,
        }),
        !sameItemOrder(session.projectedItems, result.order),
      );
      return {
        kind: "move",
        tableId: session.tableId,
        sourceTarget: session.sourceTarget,
        finalTargets: result.order.map((item) => item.target),
      };
    },
    completeColumnCommit(expectation) {
      const session = snapshot.session;
      if (session?.axis !== "column" || session.status !== "awaiting-commit") {
        return;
      }
      publish(
        Object.freeze({
          ...session,
          expectedColumnIds: [...expectation.columnIds],
          expectedCellIdsByRow: expectation.cellIdsByRow.map((row) => [
            ...row,
          ]),
        }),
      );
      reconcile();
    },
    clearColumnDrag() {
      if (snapshot.session?.axis === "column") clear();
    },
    invalidateActiveDrag(tableId) {
      const session = snapshot.session;
      if (!session || session.tableId !== tableId) return;
      let structure: FirstDraftTableCanonicalDragStructure | undefined;
      try {
        structure = tables.get(tableId)?.readCanonicalStructure();
      } catch {
        // Captured canonical state is the safe presentation fallback.
      }
      invalidate(session, structure);
    },
    notifyTableGeometryChanged(tableId, layoutKey) {
      if (tableGeometryKeys.get(tableId) === layoutKey) return;
      tableGeometryKeys.set(tableId, layoutKey);
      publish(snapshot.session, false, true);
    },
    reconcileActiveTable: reconcile,
  };
  return Object.freeze(store);

  function notifyParent(parentId: BlockId): void {
    for (const listener of [...(parentListeners.get(parentId) ?? [])]) {
      listener();
    }
  }
}

const Context = createContext<FirstDraftTableDragStore | null>(null);

export function FirstDraftTableDragStoreProvider({
  store,
  children,
}: {
  readonly store: FirstDraftTableDragStore;
  readonly children: ReactNode;
}) {
  return <Context.Provider value={store}>{children}</Context.Provider>;
}

export function useFirstDraftTableDragStore(): FirstDraftTableDragStore {
  const store = useContext(Context);
  if (!store) throw new Error("First Draft table drag store provider is missing");
  return store;
}

export function useFirstDraftTableDragSnapshot(): FirstDraftTableDragSnapshot {
  const store = useFirstDraftTableDragStore();
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}

export function useFirstDraftProjectedTableRowIds(
  tableId: BlockId,
  canonicalRowIds: readonly BlockId[],
): readonly BlockId[] {
  const store = useFirstDraftTableDragStore();
  useProjectionParentSubscription(store, tableId);
  return store.childOrderProjection.getProjectedChildIds(
    tableId,
    canonicalRowIds,
  );
}

export function useFirstDraftProjectedTableColumnItems(
  tableId: BlockId,
  canonicalItems: readonly TableColumnDragItem[],
): readonly TableColumnDragItem[] {
  const store = useFirstDraftTableDragStore();
  useProjectionParentSubscription(store, tableId);
  const session = store.getSnapshot().session;
  return session?.axis === "column" &&
    session.valid &&
    session.tableId === tableId &&
    isExactItemPermutation(canonicalItems, session.projectedItems)
    ? session.projectedItems
    : canonicalItems;
}

function useProjectionParentSubscription(
  store: FirstDraftTableDragStore,
  parentId: BlockId,
): void {
  const subscribe = useCallback(
    (listener: () => void) => store.subscribeParent(parentId, listener),
    [store, parentId],
  );
  useSyncExternalStore(subscribe, store.getSnapshot, store.getSnapshot);
}

function projectionParents(
  session: FirstDraftTableDragSession | null,
): readonly BlockId[] {
  if (!session) return [];
  return session.axis === "row"
    ? [session.tableId]
    : [session.tableId, ...session.canonicalRowIds];
}

function hasProjectedOrder(session: FirstDraftTableDragSession): boolean {
  return session.axis === "row"
    ? !sameOrder(session.projectedRowIds, session.canonicalRowIds)
    : !sameItemOrder(session.projectedItems, session.canonicalItems);
}

function registrationMatchesStructure(
  registration: FirstDraftTableDragRegistration,
  structure: FirstDraftTableCanonicalDragStructure,
): boolean {
  if (
    registration.columnItems.length !== structure.presentationColumnIds.length
  ) {
    return false;
  }
  return registration.columnItems.every((item, index) => {
    if (item.presentationId !== structure.presentationColumnIds[index]) {
      return false;
    }
    return structure.columnIdentityKind === "canonical"
      ? item.target.kind === "canonical" &&
          item.target.columnId === structure.presentationColumnIds[index]
      : item.target.kind === "synthetic-presentation" &&
          item.target.presentationId === structure.presentationColumnIds[index] &&
          item.target.indexAtOpen === index &&
          item.target.columnCountAtOpen === structure.presentationColumnIds.length;
  });
}

function columnStructureMatchesSession(
  structure: FirstDraftTableCanonicalDragStructure,
  session: FirstDraftTableColumnDragSession,
): boolean {
  return (
    sameOrder(structure.rowIds, session.canonicalRowIds) &&
    sameMatrix(structure.cellIdsByRow, session.canonicalCellIdsByRow) &&
    structure.presentationColumnIds.length === session.canonicalItems.length &&
    session.canonicalItems.every((item, index) =>
      structure.columnIdentityKind === "canonical"
        ? item.target.kind === "canonical" &&
          item.target.columnId === structure.presentationColumnIds[index]
        : item.target.kind === "synthetic-presentation" &&
          item.target.presentationId === structure.presentationColumnIds[index] &&
          item.target.indexAtOpen === index &&
          item.target.columnCountAtOpen === structure.presentationColumnIds.length,
    )
  );
}

function sameColumnTarget(
  left: TableColumnDragItem["target"],
  right: TableColumnDragItem["target"],
): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "canonical" && right.kind === "canonical"
    ? left.columnId === right.columnId
    : left.kind === "synthetic-presentation" &&
        right.kind === "synthetic-presentation" &&
        left.presentationId === right.presentationId &&
        left.indexAtOpen === right.indexAtOpen &&
        left.columnCountAtOpen === right.columnCountAtOpen;
}

function readDragId(item: TableColumnDragItem): string {
  return item.dragId;
}

function isExactItemPermutation(
  canonical: readonly TableColumnDragItem[],
  projected: readonly TableColumnDragItem[],
): boolean {
  return isExactPermutation(
    canonical.map(readDragId),
    projected.map(readDragId),
  );
}

function isExactPermutation<Value>(
  canonical: readonly Value[],
  projected: readonly Value[],
): boolean {
  if (canonical.length !== projected.length) return false;
  const canonicalSet = new Set(canonical);
  const projectedSet = new Set(projected);
  return (
    canonicalSet.size === canonical.length &&
    projectedSet.size === projected.length &&
    projected.every((id) => canonicalSet.has(id))
  );
}

function sameItemOrder(
  left: readonly TableColumnDragItem[],
  right: readonly TableColumnDragItem[],
): boolean {
  return sameOrder(left.map(readDragId), right.map(readDragId));
}

function sameMatrix<Value>(
  left: readonly (readonly Value[])[],
  right: readonly (readonly Value[])[],
): boolean {
  return (
    left.length === right.length &&
    left.every((row, index) => sameOrder(row, right[index] ?? []))
  );
}

function sameOrder<Value>(
  left: readonly Value[],
  right: readonly Value[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
