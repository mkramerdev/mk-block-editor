"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import { composeRefs, useSortable } from "@mk-drag-and-drop/react";
import type {
  TableColumnCarrierLaneLayout,
  TableColumnCarrierLayout,
  TableRowCarrierLayout,
  TableRowCarrierLaneLayout,
} from "../blocks/table/action-control-geometry.tsx";
import {
  TABLE_COLUMN_DND_GROUP,
  TABLE_ROW_DND_GROUP,
  type FirstDraftTableDragStore,
  type TableColumnDragItem,
} from "./contracts.ts";

export function FirstDraftTableRowCarrierLane({
  tableId,
  rowContainerId,
  rowIds,
  laneLayout,
  rowLayouts,
  store,
}: {
  readonly tableId: BlockId;
  readonly rowContainerId: string;
  readonly rowIds: readonly BlockId[];
  readonly laneLayout: TableRowCarrierLaneLayout | null;
  readonly rowLayouts: ReadonlyMap<BlockId, TableRowCarrierLayout>;
  readonly store: FirstDraftTableDragStore;
}) {
  if (!laneLayout) return null;
  const style: CSSProperties = {
    left: laneLayout.left,
    top: laneLayout.top,
    width: laneLayout.width,
  };
  return (
    <div
      className="table-block__row-carrier-lane"
      data-table-row-carrier-lane={tableId}
      style={style}
    >
      {rowIds.map((rowId) => {
        const layout = rowLayouts.get(rowId);
        return layout ? (
          <FirstDraftTableRowCarrier
            key={rowId}
            tableId={tableId}
            rowId={rowId}
            rowContainerId={rowContainerId}
            layout={layout}
            store={store}
          />
        ) : null;
      })}
    </div>
  );
}

function FirstDraftTableRowCarrier({
  tableId,
  rowId,
  rowContainerId,
  layout,
  store,
}: {
  readonly tableId: BlockId;
  readonly rowId: BlockId;
  readonly rowContainerId: string;
  readonly layout: TableRowCarrierLayout;
  readonly store: FirstDraftTableDragStore;
}) {
  const sortable = useSortable<HTMLElement>({
    draggableId: rowId,
    group: TABLE_ROW_DND_GROUP,
    containerId: rowContainerId,
    axis: "vertical",
  });
  useEffect(() => {
    const activation = sortable.onPointerDown;
    return activation
      ? store.registerRowCarrierActivation(rowId, activation)
      : undefined;
  }, [rowId, sortable.onPointerDown, store]);
  const releaseRegistration = useRef<(() => void) | null>(null);
  useEffect(() => () => releaseRegistration.current?.(), []);
  const registerCarrier = useCallback(
    (element: HTMLDivElement | null) => {
      releaseRegistration.current?.();
      releaseRegistration.current = element
        ? store.registerRowCarrier(
            tableId,
            rowId,
            rowContainerId,
            element,
          )
        : null;
    },
    [rowContainerId, rowId, store, tableId],
  );
  const carrierRef = useMemo(
    () => composeRefs(sortable.ref, registerCarrier),
    [registerCarrier, sortable.ref],
  );
  return (
    <div
      ref={carrierRef}
      className="table-block__row-carrier"
      data-table-row-carrier={rowId}
      data-table-dnd-group={TABLE_ROW_DND_GROUP}
      data-table-dnd-axis="vertical"
      data-table-dnd-container={rowContainerId}
      style={{ width: layout.width, height: layout.height }}
    />
  );
}

export function FirstDraftTableColumnCarrierLane({
  tableId,
  columnContainerId,
  items,
  laneLayout,
  columnLayouts,
  columnWidths,
  store,
}: {
  readonly tableId: BlockId;
  readonly columnContainerId: string;
  readonly items: readonly TableColumnDragItem[];
  readonly laneLayout: TableColumnCarrierLaneLayout | null;
  readonly columnLayouts: ReadonlyMap<string, TableColumnCarrierLayout>;
  readonly columnWidths: readonly number[];
  readonly store: FirstDraftTableDragStore;
}) {
  if (!laneLayout) return null;
  return (
    <div
      className="table-block__column-carrier-lane"
      data-table-column-carrier-lane={tableId}
      style={{
        left: laneLayout.left,
        top: laneLayout.top,
        height: laneLayout.height,
      }}
    >
      {items.map((item, columnIndex) => {
        const layout = columnLayouts.get(item.dragId) ?? {
          width: columnWidths[columnIndex] ?? 0,
          height: laneLayout.height,
        };
        return layout.width > 0 ? (
          <FirstDraftTableColumnCarrier
            key={item.presentationId}
            tableId={tableId}
            item={item}
            columnContainerId={columnContainerId}
            layout={layout}
            store={store}
          />
        ) : null;
      })}
    </div>
  );
}

function FirstDraftTableColumnCarrier({
  tableId,
  item,
  columnContainerId,
  layout,
  store,
}: {
  readonly tableId: BlockId;
  readonly item: TableColumnDragItem;
  readonly columnContainerId: string;
  readonly layout: TableColumnCarrierLayout;
  readonly store: FirstDraftTableDragStore;
}) {
  const sortable = useSortable<HTMLElement>({
    draggableId: item.dragId,
    group: TABLE_COLUMN_DND_GROUP,
    containerId: columnContainerId,
    axis: "horizontal",
  });
  useEffect(() => {
    const activation = sortable.onPointerDown;
    return activation
      ? store.registerColumnCarrierActivation(item.dragId, activation)
      : undefined;
  }, [item.dragId, sortable.onPointerDown, store]);
  const releaseRegistration = useRef<(() => void) | null>(null);
  useEffect(() => () => releaseRegistration.current?.(), []);
  const registerCarrier = useCallback(
    (element: HTMLDivElement | null) => {
      releaseRegistration.current?.();
      releaseRegistration.current = element
        ? store.registerColumnCarrier(
            tableId,
            item,
            columnContainerId,
            element,
          )
        : null;
    },
    [columnContainerId, item, store, tableId],
  );
  const carrierRef = useMemo(
    () => composeRefs(sortable.ref, registerCarrier),
    [registerCarrier, sortable.ref],
  );
  return (
    <div
      ref={carrierRef}
      className="table-block__column-carrier"
      data-table-column-carrier={item.dragId}
      data-table-column-presentation-id={item.presentationId}
      data-table-dnd-group={TABLE_COLUMN_DND_GROUP}
      data-table-dnd-axis="horizontal"
      data-table-dnd-container={columnContainerId}
      style={{ width: layout.width, height: layout.height }}
    />
  );
}
