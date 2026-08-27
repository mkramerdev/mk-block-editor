"use client";

import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEventHandler,
  type ReactNode,
  type RefObject,
} from "react";
import { Ellipsis } from "lucide-react";
import { richTextDocumentContentSize } from "@repo/editor-core/content/rich-text";
import type { BlockId } from "@repo/editor-core/kernel";
import { EditableTextBlockPrimitive } from "@repo/editor-web/editable-block-renderer";
import {
  editorSelectionBoundsDataAttributes,
  readEditorBlockSelectionTarget,
  selectionPaintSegmentDataAttributes,
  useEditorTextGestureBoundary,
} from "@repo/editor-web/block-renderer";
import type {
  EditorTextGestureBoundary,
  EditorTextGesturePointer,
  EditorTransferredPointerGesture,
} from "@repo/editor-web/block-renderer";
import type { EditableEditor } from "@repo/editor-web/editor";
import type { AdditionalSelectionRecord } from "@repo/editor-web/editor";
import type { FirstDraftBlockRendererProps } from "../../first-draft-editor-contracts.ts";
import {
  isFirstDraftBlockDropAnchorEligible,
  useFirstDraftBlockDropTargetRef,
} from "../../block-drag-and-drop/index.ts";
import { FIRST_DRAFT_TABLE_GRID_BOUNDS_TARGET } from "../../block-drag-and-drop/document-drag-visual-bounds.ts";
import {
  FIRST_DRAFT_BLOCK_CONTROL_OFFSETS,
  FirstDraftBlockChrome,
  useSetHoveredFirstDraftBlockId,
} from "../../block-controls/index.ts";
import {
  createTableRangeCoverage,
  decodeTableRangeSelection,
  encodeTableRange,
  rangeSelectionPaintSegments,
  readTableRangeSelection,
  readTableRangeSelectionPayload,
  resolveTableRange,
  selectionPaintSegmentsForIds,
  TABLE_INTERNAL_SELECTION_SUBSYSTEM_ID,
  tableInternalSelectionSubsystem,
  createTableSelectionStore,
  TableSelectionProvider,
  useTableSelectionState,
  type RemoteTableSelectionSegment,
  type TableCellPoint,
  type TableRange,
  type TableSelectionStore,
} from "./selection.ts";
import {
  resolveFirstDraftTableColumnIds,
  resolveFirstDraftTablePresentationColumnWidths,
  type FirstDraftTableColumnIdResolution,
} from "./model.ts";
import {
  insertFirstDraftTableColumn,
  insertFirstDraftTableRow,
  readFirstDraftTableMutationStructure,
  resolveFirstDraftTableColumnTargetIndex,
  resizeFirstDraftTableColumn,
} from "./mutations.ts";
import {
  createFirstDraftTableGeometryRegistry,
  FirstDraftTableGeometryProvider,
  useFirstDraftTableActionControlLayouts,
  useFirstDraftTableGeometryElementRef,
  useFirstDraftTableRowGeometryRef,
  type TableActionControlLayout,
} from "./action-control-geometry.tsx";
import {
  materializeFirstDraftTableActionRange,
  resolveFirstDraftTableActionTarget,
  tableRangeSelectionsEqual,
} from "./action-target.ts";
import {
  useFirstDraftTableActionMenuSnapshot,
  useFirstDraftTableActionMenuStore,
  type FirstDraftTableActionTarget,
} from "../../table-action-menu/index.ts";
import type { TableRangeSelection } from "./selection.ts";
import {
  FirstDraftTableColumnCarrierLane,
  captureFirstDraftTableColumnDragPreview,
  captureFirstDraftTableRowDragPreview,
  readFirstDraftTableDragStructure,
  createFirstDraftTablePresentationStore,
  FirstDraftTablePresentationProvider,
  FirstDraftTableRowCarrierLane,
  createFirstDraftTableColumnContainerId,
  createFirstDraftTableColumnDragItems,
  createFirstDraftTableRowContainerId,
  useFirstDraftProjectedTableColumnItems,
  useFirstDraftProjectedTableRowIds,
  useFirstDraftTableDragSnapshot,
  useFirstDraftTableDragStore,
  useFirstDraftTablePresentation,
  type FirstDraftTablePresentation,
  type FirstDraftTablePresentationStore,
  type TableColumnDragItem,
} from "../../table-drag-and-drop/index.ts";
import { TableGridPresentation } from "../presentations.tsx";

type Props = FirstDraftBlockRendererProps;

interface HoveredTablePoint {
  readonly rowId: BlockId;
  readonly rowIndex: number;
  readonly columnId: string;
  readonly columnIndex: number;
}

interface TableActionControlTarget {
  readonly target: FirstDraftTableActionTarget;
  readonly targetIndex: number;
}

const MIN_WIDTH = 176;

interface TableRuntimeBindings {
  objectRef(element: HTMLDivElement | null): void;
  scrollRef(element: HTMLDivElement | null): void;
  gridRef(element: HTMLDivElement | null): void;
  keyDown(event: React.KeyboardEvent<HTMLDivElement>): void;
  objectPointerMove(event: React.PointerEvent<HTMLDivElement>): void;
  pointerDown(event: React.PointerEvent<HTMLDivElement>): void;
  pointerMove(event: React.PointerEvent<HTMLDivElement>): void;
  pointerUp(event: React.PointerEvent<HTMLDivElement>): void;
  click(event: React.MouseEvent<HTMLDivElement>): void;
  pointerCancel(event: React.PointerEvent<HTMLDivElement>): void;
  paste(event: React.ClipboardEvent<HTMLDivElement>): void;
  pointerOver(event: React.PointerEvent<HTMLDivElement>): void;
  pointerOut(event: React.PointerEvent<HTMLDivElement>): void;
}

interface TableControlSnapshot {
  readonly resizeControls: ReactNode;
  readonly appendColumnControl: ReactNode;
  readonly appendRowControl: ReactNode;
  readonly actionControls: ReactNode;
}

interface TableControlStore {
  readonly getSnapshot: () => TableControlSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly publish: (snapshot: TableControlSnapshot) => void;
}

const emptyTableControlSnapshot: TableControlSnapshot = {
  resizeControls: null,
  appendColumnControl: null,
  appendRowControl: null,
  actionControls: null,
};

function createTableControlStore(): TableControlStore {
  let snapshot = emptyTableControlSnapshot;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish(next) {
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
  };
}

const emptyRuntimeBindings: TableRuntimeBindings = {
  objectRef: () => undefined,
  scrollRef: () => undefined,
  gridRef: () => undefined,
  keyDown: () => undefined,
  objectPointerMove: () => undefined,
  pointerDown: () => undefined,
  pointerMove: () => undefined,
  pointerUp: () => undefined,
  click: () => undefined,
  pointerCancel: () => undefined,
  paste: () => undefined,
  pointerOver: () => undefined,
  pointerOut: () => undefined,
};

export function TableRenderer({
  block,
  editor,
  children,
  selectionController,
}: Props) {
  const afterTargetRef = useTableAfterTargetRef(block.id);
  const hasAfterTarget = isFirstDraftBlockDropAnchorEligible(editor, {
    kind: "after-block",
    blockId: block.id,
  });
  const rows = editor.getChildBlockIds(block.id);
  const columnCount = rows[0] ? editor.getChildBlockIds(rows[0]).length : 0;
  const initialColumnResolution = resolveFirstDraftTableColumnIds(
    block.metadata,
    columnCount,
  );
  const initialColumnItems = createFirstDraftTableColumnDragItems(
    initialColumnResolution.kind,
    initialColumnResolution.ids,
  );
  const initialWidths = readColumnWidths(block.metadata, initialColumnResolution);
  const initialTracks = initialColumnResolution.ids
    .map((columnId) => `${initialWidths[columnId] ?? MIN_WIDTH}px`)
    .join(" ");
  const initialStyle = {
    "--first-draft-table-tracks": initialTracks,
    "--first-draft-table-grid-content-width": `${initialColumnResolution.ids.reduce(
      (total, columnId) => total + (initialWidths[columnId] ?? MIN_WIDTH),
      0,
    )}px`,
  } as CSSProperties;
  const geometryRegistry = useMemo(
    () => createFirstDraftTableGeometryRegistry(),
    [],
  );
  const objectGeometryRef = useFirstDraftTableGeometryElementRef(
    geometryRegistry,
    "object",
  );
  const scrollGeometryRef = useFirstDraftTableGeometryElementRef(
    geometryRegistry,
    "scroll",
  );
  const gridGeometryRef = useFirstDraftTableGeometryElementRef(
    geometryRegistry,
    "grid",
  );
  const [presentationStore] = useState(() =>
    createFirstDraftTablePresentationStore({
      tableId: block.id,
      rows: rows.map((rowId) => ({
        rowId,
        cellIds: editor.getChildBlockIds(rowId),
      })),
      columns: initialColumnItems,
      dragPlaceholder: null,
    }),
  );
  const [selectionStore] = useState(createTableSelectionStore);
  const [controlStore] = useState(createTableControlStore);
  const bindingsRef = useRef<TableRuntimeBindings>(emptyRuntimeBindings);
  const objectRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const setObjectRef = useCallback((element: HTMLDivElement | null) => {
    objectRef.current = element;
    objectGeometryRef(element);
    bindingsRef.current.objectRef(element);
  }, [objectGeometryRef]);
  const setScrollRef = useCallback((element: HTMLDivElement | null) => {
    scrollRef.current = element;
    scrollGeometryRef(element);
    bindingsRef.current.scrollRef(element);
  }, [scrollGeometryRef]);
  const setGridRef = useCallback((element: HTMLDivElement | null) => {
    gridRef.current = element;
    gridGeometryRef(element);
    bindingsRef.current.gridRef(element);
  }, [gridGeometryRef]);

  return (
    <>
      <div
        ref={setObjectRef}
        className="table-block__object"
        data-editor-object-root="true"
        style={initialStyle}
        onKeyDownCapture={(event) => bindingsRef.current.keyDown(event)}
        onPointerMove={(event) => bindingsRef.current.objectPointerMove(event)}
      >
        <div ref={setScrollRef} className="table-block__scroll">
          <div className="table-block__chrome-anchor">
            <FirstDraftBlockChrome
              blockId={block.id}
              editor={editor}
              blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.table}
            />
          </div>
          <div className="table-block__frame">
            <div className="table-block__grid-stack">
              <TableGridPresentation
                rootRef={setGridRef}
                rowCount={rows.length}
                columnCount={columnCount}
                rootAttributes={{
                  tabIndex: -1,
                  "data-table-grid": "",
                  "data-editor-block-internal-selection-host": "true",
                  ...editorSelectionBoundsDataAttributes(block.id, {
                    target: FIRST_DRAFT_TABLE_GRID_BOUNDS_TARGET,
                  }),
                  onPointerDownCapture: (event) =>
                    bindingsRef.current.pointerDown(event),
                  onPointerMoveCapture: (event) =>
                    bindingsRef.current.pointerMove(event),
                  onPointerUpCapture: (event) =>
                    bindingsRef.current.pointerUp(event),
                  onClickCapture: (event) =>
                    bindingsRef.current.click(event),
                  onPointerCancelCapture: (event) =>
                    bindingsRef.current.pointerCancel(event),
                  onPasteCapture: (event) =>
                    bindingsRef.current.paste(event),
                  onPointerOver: (event) =>
                    bindingsRef.current.pointerOver(event),
                  onPointerOut: (event) =>
                    bindingsRef.current.pointerOut(event),
                }}
              >
                <FirstDraftTableGeometryProvider registry={geometryRegistry}>
                  <FirstDraftTablePresentationProvider
                    store={presentationStore}
                  >
                    <TableSelectionProvider store={selectionStore}>
                      {children}
                    </TableSelectionProvider>
                  </FirstDraftTablePresentationProvider>
                </FirstDraftTableGeometryProvider>
              </TableGridPresentation>
              <TableControlProjection
                store={controlStore}
                control="resizeControls"
              />
            </div>
            <TableControlProjection
              store={controlStore}
              control="appendColumnControl"
            />
            <TableControlProjection
              store={controlStore}
              control="appendRowControl"
            />
            <div
              className="table-block__append-corner"
              aria-hidden="true"
              data-editor-ui="true"
              data-editor-object-ui="true"
            />
          </div>
        </div>
        <TableControlProjection
          store={controlStore}
          control="actionControls"
        />
        <TableRuntimeController
          block={block}
          editor={editor}
          selectionController={selectionController}
          geometryRegistry={geometryRegistry}
          presentationStore={presentationStore}
          selectionStore={selectionStore}
          controlStore={controlStore}
          bindingsRef={bindingsRef}
          objectRef={objectRef}
          gridRef={gridRef}
        />
      </div>
      {hasAfterTarget ? (
        <div
          ref={afterTargetRef}
          className="first-draft-block-drop-target"
          data-first-draft-block-drop-target-active="false"
          data-editor-ui="true"
          aria-hidden="true"
        />
      ) : null}
    </>
  );
}

function TableRuntimeController({
  block,
  editor,
  selectionController,
  geometryRegistry,
  presentationStore,
  selectionStore,
  controlStore,
  bindingsRef,
  objectRef,
  gridRef,
}: Omit<Props, "children"> & {
  readonly geometryRegistry: ReturnType<
    typeof createFirstDraftTableGeometryRegistry
  >;
  readonly presentationStore: FirstDraftTablePresentationStore;
  readonly selectionStore: TableSelectionStore;
  readonly controlStore: TableControlStore;
  readonly bindingsRef: RefObject<TableRuntimeBindings>;
  readonly objectRef: RefObject<HTMLDivElement | null>;
  readonly gridRef: RefObject<HTMLDivElement | null>;
}) {
  const setHoveredBlockId = useSetHoveredFirstDraftBlockId();
  const structureCache = useRef<{
    readonly key: string;
    readonly rows: readonly BlockId[];
  }>({ key: "", rows: [] });
  const structure = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        const currentRows = editor.getChildBlockIds(block.id);
        const releases = [
          editor.subscribeChildBlockIds(block.id, listener),
          ...currentRows.map((rowId) =>
            editor.subscribeChildBlockIds(rowId, listener),
          ),
        ];
        return () => releases.forEach((release) => release());
      },
      [block.id, editor],
    ),
    useCallback(
      () => {
        const rows = editor.getChildBlockIds(block.id);
        const key = JSON.stringify(
          rows.map((rowId) => [rowId, ...editor.getChildBlockIds(rowId)]),
        );
        if (structureCache.current.key === key) return structureCache.current;
        structureCache.current = { key, rows };
        return structureCache.current;
      },
      [block.id, editor],
    ),
    useCallback(() => structureCache.current, []),
  );
  const rows = structure.rows;
  const tableDragStore = useFirstDraftTableDragStore();
  const tableDragSnapshot = useFirstDraftTableDragSnapshot();
  const suppressedRowActionClicks = useRef(new Set<BlockId>());
  useLayoutEffect(() => {
    const session = tableDragSnapshot.session;
    if (session?.axis === "row" && session.status === "dragging") {
      suppressedRowActionClicks.current.add(session.sourceRowId);
    }
  }, [tableDragSnapshot]);
  const projectedRows = useFirstDraftProjectedTableRowIds(block.id, rows);
  const rowContainerId = createFirstDraftTableRowContainerId(block.id);
  const columnContainerId = createFirstDraftTableColumnContainerId(block.id);
  const columnCount = rows[0] ? editor.getChildBlockIds(rows[0]).length : 0;
  const columnResolution = useMemo(
    () => resolveFirstDraftTableColumnIds(block.metadata, columnCount),
    [block.metadata, columnCount],
  );
  const canonicalColumnIds = columnResolution.ids;
  const columnIdentityKey = JSON.stringify([
    columnResolution.kind,
    ...canonicalColumnIds,
  ]);
  const canonicalColumnItems = useMemo(
    () =>
      createFirstDraftTableColumnDragItems(
        columnResolution.kind,
        canonicalColumnIds,
      ),
    // The serialized identity key intentionally keeps opaque tokens stable
    // across metadata-only table updates such as column resizing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columnIdentityKey],
  );
  const projectedColumnItems = useFirstDraftProjectedTableColumnItems(
    block.id,
    canonicalColumnItems,
  );
  const columnIds = useMemo(
    () => projectedColumnItems.map((item) => item.presentationId),
    [projectedColumnItems],
  );
  const columnDragIds = useMemo(
    () => projectedColumnItems.map((item) => item.dragId),
    [projectedColumnItems],
  );
  useLayoutEffect(
    () =>
      tableDragStore.registerTable({
        tableId: block.id,
        rowContainerId,
        columnContainerId,
        columnItems: canonicalColumnItems,
        getHorizontalScrollElement: () => geometryRegistry.getElements().scroll,
        readCanonicalStructure: () =>
          readFirstDraftTableDragStructure(editor, block.id),
        captureRowDragPreview: (rowId, structure) =>
          captureFirstDraftTableRowDragPreview(
            editor,
            block.id,
            rowId,
            structure,
          ),
        captureColumnDragPreview: (item, structure) => {
          const elements = geometryRegistry.getElements();
          const grid = elements.grid;
          if (!grid?.isConnected) return null;
          const rowHeights: number[] = [];
          for (const rowId of structure.rowIds) {
            const row = elements.rows.get(rowId);
            if (
              !row?.isConnected ||
              row.ownerDocument !== grid.ownerDocument ||
              row.dataset.tableRowId !== rowId ||
              !grid.contains(row)
            ) {
              return null;
            }
            const height = row.getBoundingClientRect().height;
            if (!Number.isFinite(height) || height <= 0) return null;
            rowHeights.push(height);
          }
          return captureFirstDraftTableColumnDragPreview(
            editor,
            block.id,
            item,
            structure,
            rowHeights,
          );
        },
        subscribeCanonicalStructure(listener) {
          const currentRows = editor.getChildBlockIds(block.id);
          const releases = [
            editor.subscribeBlock(block.id, listener),
            editor.subscribeChildBlockIds(block.id, listener),
            ...currentRows.map((rowId) =>
              editor.subscribeChildBlockIds(rowId, listener),
            ),
          ];
          return () => releases.forEach((release) => release());
        },
      }),
    [
      block.id,
      canonicalColumnItems,
      columnContainerId,
      editor,
      geometryRegistry,
      rowContainerId,
      tableDragStore,
    ],
  );
  const widths = useMemo(
    () => readColumnWidths(block.metadata, columnResolution),
    [block, columnResolution],
  );
  const [preview, setPreview] = useState<Record<string, number> | null>(null);
  const [drag, setDrag] = useState<{
    readonly pointerId: number;
    readonly id: string;
    readonly target: TableColumnDragItem["target"];
    readonly startX: number;
    readonly startWidth: number;
  } | null>(null);
  const canonical = useSyncExternalStore(
    (listener) =>
      selectionController.endpoint.subscribeBlock(block.id, listener),
    selectionController.getCanonicalSnapshot,
    selectionController.getCanonicalSnapshot,
  );
  const presentationRows = useMemo(() => {
    // Column projection changes the store adapter result for every row.
    void projectedColumnItems;
    return projectedRows.map((rowId) => ({
      rowId,
      cellIds: tableDragStore.childOrderProjection.getProjectedChildIds(
        rowId,
        editor.getChildBlockIds(rowId),
      ),
    }));
  }, [editor, projectedColumnItems, projectedRows, tableDragStore]);
  const dragPlaceholder = useMemo(() => {
    const session = tableDragSnapshot.session;
    if (!session?.valid || session.tableId !== block.id) return null;
    return session.axis === "row"
      ? ({ axis: "row", rowId: session.sourceRowId } as const)
      : ({ axis: "column", dragId: session.sourceDragId } as const);
  }, [block.id, tableDragSnapshot.session]);
  const presentation = useMemo<FirstDraftTablePresentation>(
    () => ({
      tableId: block.id,
      rows: presentationRows,
      columns: projectedColumnItems,
      dragPlaceholder,
    }),
    [block.id, dragPlaceholder, presentationRows, projectedColumnItems],
  );
  const presentationGraph = useMemo(
    () => ({
      getParentId: (blockId: BlockId) => editor.getParentId(blockId),
      getChildBlockIds: (parentId: BlockId) => {
        if (parentId === block.id) {
          return presentation.rows.map((row) => row.rowId);
        }
        return (
          presentation.rows.find((row) => row.rowId === parentId)?.cellIds ??
          editor.getChildBlockIds(parentId)
        );
      },
    }),
    [block.id, editor, presentation],
  );
  const range = useMemo(
    () => readTableRangeSelection(canonical, block.id, editor),
    [block.id, canonical, editor],
  );
  const tableActionMenuStore = useFirstDraftTableActionMenuStore();
  const tableActionMenu = useFirstDraftTableActionMenuSnapshot();
  const gesture = useRef<{
    readonly pointerId: number;
    readonly anchor: TableCellPoint;
    readonly startX: number;
    readonly startY: number;
    moved: boolean;
    promoted: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const selectedIds = useMemo(
    () => new Set(rangeSelectionPaintSegments(editor, block.id, range).keys()),
    [block.id, editor, range],
  );
  const paintSegments = useMemo(
    () =>
      selectionPaintSegmentsForIds(presentationGraph, block.id, selectedIds),
    [block.id, presentationGraph, selectedIds],
  );
  const remoteRecords = useSyncExternalStore(
    useCallback(
      (listener: () => void) =>
        editor.additionalSelections.subscribeBlockInternal(block.id, listener),
      [block.id, editor.additionalSelections],
    ),
    useCallback(
      () => editor.additionalSelections.getBlockInternalSnapshot(block.id),
      [block.id, editor.additionalSelections],
    ),
    () => emptyAdditionalSelectionRecords,
  );
  const remoteSegments = useMemo(
    () =>
      remoteTableSelectionSegments(
        remoteRecords,
        editor,
        presentationGraph,
        block.id,
      ),
    [block.id, editor, presentationGraph, remoteRecords],
  );
  const renderedWidths = preview ?? widths;
  const normalizedWidths = useMemo(
    () => columnIds.map((id) => renderedWidths[id] ?? MIN_WIDTH),
    [columnIds, renderedWidths],
  );
  const canonicalColumnWidths = useMemo(
    () =>
      canonicalColumnItems.map(
        (item) => renderedWidths[item.presentationId] ?? MIN_WIDTH,
      ),
    [canonicalColumnItems, renderedWidths],
  );
  const tracks = normalizedWidths.map((width) => `${width}px`).join(" ");
  const gridContentWidth = `${normalizedWidths.reduce(
    (total, width) => total + width,
    0,
  )}px`;
  const pointFromTarget = useCallback(
    (target: EventTarget | null): TableCellPoint | null => {
      const cell =
        target instanceof Element
          ? target.closest<HTMLElement>("[data-table-cell-id]")
          : null;
      if (!cell || cell.dataset.tableId !== block.id) return null;
      const row = Number(cell.dataset.tableRowIndex);
      const column = Number(cell.dataset.tableColumnIndex);
      const cellId = cell.dataset.tableCellId as BlockId | undefined;
      return cellId && Number.isInteger(row) && Number.isInteger(column)
        ? { row, column, cellId }
        : null;
    },
    [block.id],
  );
  const hoverPointFromTarget = useCallback(
    (target: EventTarget | null): HoveredTablePoint | null => {
      const cell =
        target instanceof Element
          ? target.closest<HTMLElement>("[data-table-cell-id]")
          : null;
      if (!cell || cell.dataset.tableId !== block.id) return null;
      const rowIndex = Number(cell.dataset.tableRowIndex);
      const columnIndex = Number(cell.dataset.tableColumnIndex);
      const rowId = cell.dataset.tableRowId as BlockId | undefined;
      const columnId = cell.dataset.tableColumnId;
      return rowId &&
        columnId &&
        Number.isInteger(rowIndex) &&
        Number.isInteger(columnIndex)
        ? { rowId, rowIndex, columnId, columnIndex }
        : null;
    },
    [block.id],
  );
  const clearRange = useCallback(
    (cause: "pointer" | "keyboard") => {
      const current = selectionController.getCanonicalSnapshot();
      if (
        current.kind !== "block-internal" ||
        current.snapshot.internal?.blockId !== block.id
      )
        return;
      selectionController.clearBlockSelection(
        block.id,
        standaloneSelectionContext(cause),
        current.revision,
      );
    },
    [block.id, selectionController],
  );
  const focusCell = useCallback(
    (point: TableCellPoint, offset: number, cause: "pointer" | "keyboard") => {
      clearRange(cause);
      if (
        editor.focusText(point.cellId, { offset, preventScroll: true })
          .status === "rejected"
      )
        return false;
      const selectionPoint = editor.createSelectionTextPoint(
        point.cellId,
        offset,
      );
      if (selectionPoint) {
        selectionController.commitSelectionPoint(
          selectionPoint,
          editor,
          editor.getSelectionGraphRevision(),
          standaloneSelectionContext(cause),
        );
      }
      return true;
    },
    [clearRange, editor, selectionController],
  );
  const commitRangeSelection = useCallback(
    (
      selection: TableRangeSelection,
      cause: "pointer" | "keyboard" | "canonical-rebase",
    ) => {
      const target = readEditorBlockSelectionTarget(editor, block.id);
      if (!target) return false;
      const result = selectionController.commitBlockSelection(
        target,
        createTableRangeCoverage(block.id, block.type, selection, editor),
        tableInternalSelectionSubsystem,
        standaloneSelectionContext(cause),
        editor.getSelectionGraphRevision(),
      );
      return result.kind !== "rejected";
    },
    [block.id, block.type, editor, selectionController],
  );
  const commitRange = useCallback(
    (next: TableRange, cause: "pointer" | "keyboard") =>
      commitRangeSelection(encodeTableRange(next), cause),
    [commitRangeSelection],
  );
  const activateTableActionMenu = useCallback(
    (
      target: FirstDraftTableActionTarget,
      triggerElement: HTMLButtonElement,
      cause: "pointer" | "keyboard",
    ) => {
      if (!triggerElement.isConnected) return false;
      let ownedTableRange: TableRangeSelection;
      try {
        ownedTableRange = materializeFirstDraftTableActionRange(
          target,
          resolveFirstDraftTableActionTarget(editor, block.id, target),
        );
      } catch {
        return false;
      }
      if (!commitRangeSelection(ownedTableRange, cause)) return false;
      return tableActionMenuStore.open({
        kind: "open",
        tableId: block.id,
        target,
        triggerElement,
        ownedTableRange,
      });
    },
    [block.id, commitRangeSelection, editor, tableActionMenuStore],
  );

  useLayoutEffect(() => {
    const session =
      tableActionMenu.kind === "open" && tableActionMenu.tableId === block.id
        ? tableActionMenu
        : null;
    if (!session) return;
    const current = readTableRangeSelectionPayload(canonical, block.id);
    if (
      !current ||
      !tableRangeSelectionsEqual(current, session.ownedTableRange)
    ) {
      tableActionMenuStore.close();
      return;
    }
    let desired: TableRangeSelection;
    try {
      desired = materializeFirstDraftTableActionRange(
        session.target,
        resolveFirstDraftTableActionTarget(
          editor,
          session.tableId,
          session.target,
        ),
      );
    } catch {
      tableActionMenuStore.close();
      return;
    }
    if (tableRangeSelectionsEqual(desired, session.ownedTableRange)) return;
    if (!commitRangeSelection(desired, "canonical-rebase")) {
      tableActionMenuStore.close();
      return;
    }
    tableActionMenuStore.updateOwnedTableRange(session, desired);
  });
  const textGestureBoundary = useMemo<EditorTextGestureBoundary>(
    () => ({
      begin(start) {
        const anchor = pointFromTarget(start.target);
        const gestureGrid = gridRef.current;
        if (!anchor || anchor.cellId !== start.blockId || !gestureGrid)
          return null;
        const pointFor = (pointer: EditorTextGesturePointer) =>
          pointFromTarget(pointer.target);
        let transferHead: TableCellPoint | null = null;
        return {
          shouldTransfer(pointer) {
            const head = pointFor(pointer);
            if (!head || head.cellId === anchor.cellId) return false;
            transferHead = head;
            return true;
          },
          transfer(pointer): EditorTransferredPointerGesture | null {
            const grid = gestureGrid;
            const head = transferHead ?? pointFor(pointer);
            if (!head || head.cellId === anchor.cellId) return null;
            try {
              grid.setPointerCapture(pointer.pointerId);
            } catch {
              return null;
            }
            // Generic transient paint is already gone, while the text-pointer
            // presentation claim still suppresses native paint. Remove its
            // input projection and install the table range before that claim
            // is released by the generic coordinator.
            editor.blurEditor();
            grid.ownerDocument.getSelection()?.removeAllRanges();
            if (!commitRange({ anchor, head }, "pointer")) {
              if (grid.hasPointerCapture(pointer.pointerId))
                grid.releasePointerCapture(pointer.pointerId);
              return null;
            }
            grid.focus({ preventScroll: true });
            let active = true;
            const release = () => {
              if (!active) return;
              active = false;
              try {
                if (grid.hasPointerCapture(pointer.pointerId))
                  grid.releasePointerCapture(pointer.pointerId);
              } catch {
                // Capture may already be gone after browser cancellation.
              }
            };
            const update = (next: EditorTextGesturePointer) => {
              if (!active) return;
              const nextHead = pointFor(next);
              if (nextHead) commitRange({ anchor, head: nextHead }, "pointer");
            };
            return {
              pointerId: pointer.pointerId,
              move: update,
              finish(next) {
                update(next);
                release();
                grid.focus({ preventScroll: true });
              },
              cancel() {
                release();
                grid.focus({ preventScroll: true });
              },
            };
          },
          cancel() {
            // The renderer holds no pointer resource until transfer succeeds.
          },
        };
      },
    }),
    [commitRange, editor, gridRef, pointFromTarget],
  );
  const registerTextGestureBoundary =
    useEditorTextGestureBoundary(textGestureBoundary);
  const registerMenuGrid = useCallback(
    (element: HTMLElement) =>
      tableActionMenuStore.registerTableGrid(block.id, element),
    [block.id, tableActionMenuStore],
  );
  const menuGridCleanup = useRef<(() => void) | null>(null);
  const registerGridRef = useCallback(
    (grid: HTMLDivElement | null) => {
      menuGridCleanup.current?.();
      menuGridCleanup.current = null;
      registerTextGestureBoundary(grid);
      if (grid) menuGridCleanup.current = registerMenuGrid(grid);
    },
    [registerMenuGrid, registerTextGestureBoundary],
  );
  const actionControlLayouts = useFirstDraftTableActionControlLayouts(
    geometryRegistry,
    editor.geometry,
    columnDragIds,
    normalizedWidths,
  );
  const actionControlLayoutKey = useMemo(
    () =>
      JSON.stringify({
        rowLane: actionControlLayouts.rowLane,
        columnLane: actionControlLayouts.columnLane,
        rows: [...actionControlLayouts.rows].map(([id, layout]) => [
          id,
          layout.width,
          layout.height,
        ]),
        columns: [...actionControlLayouts.columns].map(([id, layout]) => [
          id,
          layout.width,
          layout.height,
        ]),
        rowTriggers: [...actionControlLayouts.rowTriggers].map(
          ([id, layout]) => [
            id,
            layout.left,
            layout.top,
            layout.width,
            layout.height,
          ],
        ),
        columnTriggers: [...actionControlLayouts.columnTriggers].map(
          ([id, layout]) => [
            id,
            layout.left,
            layout.top,
            layout.width,
            layout.height,
          ],
        ),
      }),
    [actionControlLayouts],
  );
  useLayoutEffect(() => {
    tableDragStore.notifyTableGeometryChanged(block.id, actionControlLayoutKey);
  }, [actionControlLayoutKey, block.id, tableDragStore]);
  const [hoveredPoint, setHoveredPoint] = useState<HoveredTablePoint | null>(
    null,
  );
  const [hoveredControl, setHoveredControl] =
    useState<TableActionControlTarget | null>(null);
  const tableValue = useMemo(
    () => ({
      selectedIds,
      paintSegments,
      remoteSegments,
    }),
    [paintSegments, remoteSegments, selectedIds],
  );
  const pasteRange = (event: React.ClipboardEvent) => {
    if (!range) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    const matrix = text
      .replace(/\r\n?/gu, "\n")
      .split("\n")
      .map((line) => line.split("\t"));
    const startRow = Math.min(range.anchor.row, range.head.row);
    const startColumn = Math.min(range.anchor.column, range.head.column);
    editor.transaction(() => {
      matrix.forEach((values, rowOffset) => {
        const rowId = rows[startRow + rowOffset];
        if (!rowId) return;
        const cells = editor.getChildBlockIds(rowId);
        values.forEach((value, columnOffset) => {
          const cellId = cells[startColumn + columnOffset];
          if (!cellId) return;
          replaceCellText(editor, cellId, value);
        });
      });
      editor.setTransactionSelection({ kind: "preserve" });
    });
  };
  const cells = presentation.rows.flatMap((currentRow, row) =>
    currentRow.cellIds.map((cellId, column) => ({ row, column, cellId })),
  );
  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (
      event.target instanceof Element &&
      event.target.closest('[data-editor-ui="true"]')
    ) {
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) editor.redo();
      else editor.undo();
      return;
    }
    const point = pointFromTarget(event.target);
    if (range && (event.key === "Backspace" || event.key === "Delete")) {
      event.preventDefault();
      clearCells(editor, [...selectedIds]);
      return;
    }
    if (range && event.key === "Escape") {
      event.preventDefault();
      clearRange("keyboard");
      return;
    }
    if (range && event.key === "Enter") {
      event.preventDefault();
      focusCell(range.head, 0, "keyboard");
      return;
    }
    if (range && isArrowKey(event.key)) {
      const next = moveByArrow(range.head, event.key, rows.length, columnCount);
      if (next) {
        event.preventDefault();
        event.stopPropagation();
        const cellId = presentation.rows[next.row]?.cellIds[next.column];
        if (cellId)
          commitRange(
            { anchor: range.anchor, head: { ...next, cellId } },
            "keyboard",
          );
      }
      return;
    }
    if (!point) return;
    if (event.key === "Tab") {
      event.preventDefault();
      const index = cells.findIndex((cell) => cell.cellId === point.cellId);
      const next = cells[index + (event.shiftKey ? -1 : 1)];
      if (next) {
        focusCell(
          next,
          event.shiftKey ? cellLength(editor, next.cellId) : 0,
          "keyboard",
        );
      } else if (!event.shiftKey) {
        insertFirstDraftTableRow(editor, block.id, rows.length);
      }
      return;
    }
    if (!isArrowKey(event.key)) return;
    const next = moveByArrow(point, event.key, rows.length, columnCount);
    if (!next) return;
    if (!shouldLeaveTextCell(event.target, event.key)) return;
    const cellId = presentation.rows[next.row]?.cellIds[next.column];
    if (!cellId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.shiftKey) {
      if (
        commitRange({ anchor: point, head: { ...next, cellId } }, "keyboard")
      ) {
        gridRef.current?.focus({ preventScroll: true });
      }
      return;
    }
    focusCell(
      { ...next, cellId },
      event.key === "ArrowLeft" ? cellLength(editor, cellId) : 0,
      "keyboard",
    );
  };
  const beginResize = (
    item: TableColumnDragItem,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setPreview(widths);
    setDrag({
      pointerId: event.pointerId,
      id: item.presentationId,
      target: item.target,
      startX: event.clientX,
      startWidth: widths[item.presentationId] ?? MIN_WIDTH,
    });
  };
  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag || drag.pointerId !== event.pointerId || !preview) return;
    const next = resizeColumn(
      preview,
      columnIds,
      drag.id,
      drag.startWidth + event.clientX - drag.startX,
    );
    if (next) setPreview(next);
  };
  const finishResize = (commit: boolean) => {
    if (commit && preview && drag) {
      const width = preview[drag.id];
      if (width !== undefined) {
        try {
          const columnIndex = resolveFirstDraftTableColumnTargetIndex(
            readFirstDraftTableMutationStructure(editor, block.id),
            drag.target,
          );
          resizeFirstDraftTableColumn(editor, block.id, columnIndex, width);
        } catch {
          // A stale resize identity fails closed without committing a width.
        }
      }
    }
    setPreview(null);
    setDrag(null);
  };
  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    suppressClick.current = false;
    const point = pointFromTarget(event.target);
    if (!point) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-editor-text-root="true"]')) return;
    gesture.current = {
      pointerId: event.pointerId,
      anchor: point,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      promoted: false,
    };
  };
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (
      !current ||
      current.pointerId !== event.pointerId ||
      event.buttons === 0
    )
      return;
    if (
      current.promoted &&
      !event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      gesture.current = null;
      if (current.moved) suppressClick.current = true;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
      return;
    }
    if (
      Math.hypot(
        event.clientX - current.startX,
        event.clientY - current.startY,
      ) > 3
    )
      current.moved = true;
    const point = pointFromTarget(
      event.currentTarget.ownerDocument.elementFromPoint(
        event.clientX,
        event.clientY,
      ),
    );
    if (!point) return;
    if (!current.promoted && point.cellId === current.anchor.cellId) return;
    event.preventDefault();
    event.stopPropagation();
    if (!current.promoted) {
      const grid = event.currentTarget;
      const pointerId = event.pointerId;
      grid.addEventListener(
        "lostpointercapture",
        (lostEvent) => {
          if (!cancelPointerState(grid, pointerId)) return;
          lostEvent.preventDefault();
          lostEvent.stopPropagation();
        },
        { once: true },
      );
      event.currentTarget.setPointerCapture(event.pointerId);
      current.promoted = true;
      editor.blurEditor();
      event.currentTarget.ownerDocument.getSelection()?.removeAllRanges();
    }
    commitRange({ anchor: current.anchor, head: point }, "pointer");
  };
  const finishPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const completed = gesture.current;
    if (!completed || completed.pointerId !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (completed.moved) {
      suppressClick.current = true;
    }
    if (completed.promoted) {
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.focus({ preventScroll: true });
    }
  };
  const cancelPointerState = useCallback(
    (target: HTMLDivElement, pointerId: number) => {
      const canceled = gesture.current;
      if (!canceled || canceled.pointerId !== pointerId) return false;
      gesture.current = null;
      if (target.hasPointerCapture(pointerId))
        target.releasePointerCapture(pointerId);
      if (canceled.moved) suppressClick.current = true;
      if (canceled.promoted) {
        target.focus({ preventScroll: true });
      }
      return canceled.promoted;
    },
    [],
  );
  const cancelPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!cancelPointerState(event.currentTarget, event.pointerId)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const completedClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (suppressClick.current) {
      suppressClick.current = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const point = pointFromTarget(event.target);
    if (!point) return;
    if (
      event.target instanceof Element &&
      event.target.closest('[data-editor-text-root="true"]')
    )
      return;
    if (event.shiftKey && range) {
      event.preventDefault();
      commitRange({ anchor: range.anchor, head: point }, "pointer");
    }
  };
  const handleCellPointerOver = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = hoverPointFromTarget(event.target);
    if (!point) return;
    const previous = hoverPointFromTarget(event.relatedTarget);
    if (
      previous?.rowId === point.rowId &&
      previous.columnId === point.columnId
    ) {
      return;
    }
    setHoveredPoint(point);
  };
  const handleCellPointerOut = (event: React.PointerEvent<HTMLDivElement>) => {
    const point = hoverPointFromTarget(event.target);
    if (!point) return;
    const next = hoverPointFromTarget(event.relatedTarget);
    if (next) {
      setHoveredPoint(next);
      return;
    }
    setHoveredPoint(null);
  };

  const openSession =
    tableActionMenu.kind === "open" && tableActionMenu.tableId === block.id
      ? tableActionMenu
      : null;
  const visibleRowControlTargets = new Map<BlockId, TableActionControlTarget>();
  projectedRows.forEach((rowId, rowIndex) => {
    if (!actionControlLayouts.rowTriggers.has(rowId)) return;
    visibleRowControlTargets.set(rowId, {
      target: { kind: "row", rowId },
      targetIndex: rowIndex,
    });
  });
  const visibleColumnControlTargets = new Map<
    string,
    TableActionControlTarget
  >();
  projectedColumnItems.forEach((item, columnIndex) => {
    if (!actionControlLayouts.columnTriggers.has(item.dragId)) return;
    visibleColumnControlTargets.set(item.dragId, {
      target: {
        kind: "column",
        identity: item.target,
      },
      targetIndex: columnIndex,
    });
  });

  const enterControl = (target: TableActionControlTarget) => {
    setHoveredControl(target);
    setHoveredPoint(null);
  };
  const leaveControl = (
    target: TableActionControlTarget,
    relatedTarget: EventTarget | null,
  ) => {
    const nextPoint = hoverPointFromTarget(relatedTarget);
    if (nextPoint) setHoveredPoint(nextPoint);
    setHoveredControl((current) =>
      sameTableActionControlTarget(current, target) ? null : current,
    );
  };

  const resizeControls = (
    <div
      className="table-block__resize-overlay"
      style={{ gridTemplateColumns: tracks }}
      data-editor-ui="true"
      data-editor-object-ui="true"
    >
      {projectedColumnItems.map((item, index) => (
        <div
          key={item.dragId}
          className="table-block__resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label={`Resize column ${index + 1}`}
          aria-valuemin={MIN_WIDTH}
          aria-valuenow={renderedWidths[item.presentationId] ?? MIN_WIDTH}
          tabIndex={0}
          data-table-resize-column={item.presentationId}
          data-table-resize-active={drag?.id === item.presentationId || undefined}
          onPointerDown={(event) => beginResize(item, event)}
          onPointerMove={moveResize}
          onPointerUp={(event) => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            finishResize(true);
          }}
          onPointerCancel={() => finishResize(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") finishResize(false);
            if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
            event.preventDefault();
            const next = resizeColumn(
              widths,
              columnIds,
              item.presentationId,
              (widths[item.presentationId] ?? MIN_WIDTH) +
                (event.key === "ArrowLeft" ? -8 : 8),
            );
            if (!next) return;
            try {
              const canonicalIndex = resolveFirstDraftTableColumnTargetIndex(
                readFirstDraftTableMutationStructure(editor, block.id),
                item.target,
              );
              resizeFirstDraftTableColumn(
                editor,
                block.id,
                canonicalIndex,
                next[item.presentationId]!,
              );
            } catch {
              // Keyboard resize rejects stale logical identities.
            }
          }}
        />
      ))}
    </div>
  );
  const appendColumnControl = (
    <div
      className="table-block__append-zone table-block__append-zone--column"
      data-editor-ui="true"
      data-editor-object-ui="true"
    >
      <TableAppendButton
        axis="column"
        label="Add table column"
        onAppend={() =>
          insertFirstDraftTableColumn(editor, block.id, columnCount)
        }
      />
    </div>
  );
  const appendRowControl = (
    <div
      className="table-block__append-zone table-block__append-zone--row"
      data-editor-ui="true"
      data-editor-object-ui="true"
    >
      <TableAppendButton
        axis="row"
        label="Add table row"
        onAppend={() => insertFirstDraftTableRow(editor, block.id, rows.length)}
      />
    </div>
  );
  const actionControls = (
    <div
      className="table-block__action-control-overlay"
      data-editor-ui="true"
      data-editor-object-ui="true"
    >
        {/* The package exclusively projects these canonical carrier nodes.
            Visible table rows continue to follow the application projection. */}
        <FirstDraftTableRowCarrierLane
          tableId={block.id}
          rowContainerId={rowContainerId}
          rowIds={rows}
          laneLayout={actionControlLayouts.rowLane}
          rowLayouts={actionControlLayouts.rows}
          store={tableDragStore}
        />
        {projectedRows.map((rowId) => {
          const target = visibleRowControlTargets.get(rowId);
          const triggerLayout = actionControlLayouts.rowTriggers.get(rowId);
          return target && triggerLayout ? (
            <TableActionTrigger
              key={`row-trigger:${rowId}`}
              target={target}
              layout={triggerLayout}
              menuId={tableActionMenuStore.menuId}
              open={
                openSession !== null &&
                sameTableActionTarget(openSession.target, target.target)
              }
              cellHovered={hoveredPoint?.rowId === rowId}
              controlHovered={sameTableActionControlTarget(
                hoveredControl,
                target,
              )}
              onSortablePointerDown={(event) => {
                tableDragStore.activateRowCarrier(rowId, event);
              }}
              onOpen={(triggerElement, cause) =>
                activateTableActionMenu(target.target, triggerElement, cause)
              }
              consumeSuppressedPointerClick={() =>
                suppressedRowActionClicks.current.delete(rowId)
              }
              onPointerEnter={enterControl}
              onPointerLeave={leaveControl}
            />
          ) : null;
        })}
        <FirstDraftTableColumnCarrierLane
          tableId={block.id}
          columnContainerId={columnContainerId}
          items={canonicalColumnItems}
          laneLayout={actionControlLayouts.columnLane}
          columnLayouts={actionControlLayouts.columns}
          columnWidths={canonicalColumnWidths}
          store={tableDragStore}
        />
        {projectedColumnItems.map((item) => {
          const target = visibleColumnControlTargets.get(item.dragId);
          const triggerLayout = actionControlLayouts.columnTriggers.get(
            item.dragId,
          );
          return target && triggerLayout ? (
            <TableActionTrigger
              key={`column-trigger:${item.dragId}`}
              target={target}
              layout={triggerLayout}
              menuId={tableActionMenuStore.menuId}
              open={
                openSession !== null &&
                sameTableActionTarget(openSession.target, target.target)
              }
              cellHovered={hoveredPoint?.columnId === item.presentationId}
              controlHovered={sameTableActionControlTarget(
                hoveredControl,
                target,
              )}
              onSortablePointerDown={(event) => {
                tableDragStore.activateColumnCarrier(item.dragId, event);
              }}
              onOpen={(triggerElement, cause) =>
                activateTableActionMenu(target.target, triggerElement, cause)
              }
              consumeSuppressedPointerClick={() => false}
              onPointerEnter={enterControl}
              onPointerLeave={leaveControl}
            />
          ) : null;
        })}
    </div>
  );

  useLayoutEffect(() => {
    registerGridRef(gridRef.current);
    return () => registerGridRef(null);
  }, [gridRef, registerGridRef]);

  useLayoutEffect(() => {
    bindingsRef.current = {
      objectRef: () => undefined,
      scrollRef: () => undefined,
      gridRef: registerGridRef,
      keyDown: handleKey,
      objectPointerMove(event) {
        setHoveredBlockId(block.id);
        event.stopPropagation();
      },
      pointerDown,
      pointerMove,
      pointerUp: finishPointer,
      click: completedClick,
      pointerCancel: cancelPointer,
      paste: pasteRange,
      pointerOver: handleCellPointerOver,
      pointerOut: handleCellPointerOut,
    };
    presentationStore.publish(presentation);
    selectionStore.publish(tableValue);
    controlStore.publish({
      resizeControls,
      appendColumnControl,
      appendRowControl,
      actionControls,
    });
    const object = objectRef.current;
    if (object) {
      object.style.setProperty("--first-draft-table-tracks", tracks);
      object.style.setProperty(
        "--first-draft-table-grid-content-width",
        gridContentWidth,
      );
    }
    const grid = gridRef.current;
    if (!grid) return;
    grid.setAttribute("aria-rowcount", String(rows.length));
    grid.setAttribute("aria-colcount", String(columnCount));
    setOptionalDataAttribute(grid, "tableSelectionKind", range ? "local" : null);
    setOptionalDataAttribute(
      grid,
      "tableSelectionType",
      range ? "cell-range" : null,
    );
    setOptionalDataAttribute(
      grid,
      "tableSelectionAnchorCellId",
      range?.anchor.cellId ?? null,
    );
    setOptionalDataAttribute(
      grid,
      "tableSelectionHeadCellId",
      range?.head.cellId ?? null,
    );
  });

  return null;
}

function TableControlProjection({
  store,
  control,
}: {
  readonly store: TableControlStore;
  readonly control: keyof TableControlSnapshot;
}) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  return snapshot[control];
}

function setOptionalDataAttribute(
  element: HTMLElement,
  key: keyof DOMStringMap,
  value: string | null,
): void {
  if (value === null) delete element.dataset[key];
  else element.dataset[key] = value;
}

function TableActionTrigger({
  target,
  layout,
  menuId,
  open,
  cellHovered,
  controlHovered,
  onOpen,
  onPointerEnter,
  onPointerLeave,
  onSortablePointerDown,
  consumeSuppressedPointerClick,
}: {
  readonly target: TableActionControlTarget;
  readonly layout: TableActionControlLayout;
  readonly menuId: string;
  readonly open: boolean;
  readonly cellHovered: boolean;
  readonly controlHovered: boolean;
  readonly onOpen: (
    triggerElement: HTMLButtonElement,
    cause: "pointer" | "keyboard",
  ) => void;
  readonly onPointerEnter: (target: TableActionControlTarget) => void;
  readonly onPointerLeave: (
    target: TableActionControlTarget,
    relatedTarget: EventTarget | null,
  ) => void;
  readonly onSortablePointerDown: PointerEventHandler<HTMLButtonElement>;
  readonly consumeSuppressedPointerClick: () => boolean;
}) {
  const suppressKeyboardClick = useRef(false);
  const axis = target.target.kind;
  const label = `${axis === "row" ? "Row" : "Column"} ${target.targetIndex + 1} actions`;
  return (
    <div
      className={`table-block__action-control-zone table-block__action-control-zone--${axis}`}
      style={layout}
      data-table-action-control-axis={axis}
      data-cell-hovered={cellHovered || undefined}
      data-control-hovered={controlHovered || undefined}
      data-open={open || undefined}
      onPointerEnter={() => onPointerEnter(target)}
      onPointerLeave={(event) => onPointerLeave(target, event.relatedTarget)}
    >
      <span className="table-block__action-control-bridge" aria-hidden="true" />
      <button
        type="button"
        className="table-block__action-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-editor-ui="true"
        data-editor-object-ui="true"
        data-editor-preserve-selection="true"
        data-table-action-trigger-axis={axis}
        data-open={open || undefined}
        onPointerDown={(event) => {
          onSortablePointerDown(event);
          event.stopPropagation();
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.stopPropagation();
          if (event.detail !== 0 && consumeSuppressedPointerClick()) return;
          if (suppressKeyboardClick.current && event.detail === 0) {
            suppressKeyboardClick.current = false;
            return;
          }
          onOpen(event.currentTarget, "pointer");
        }}
        onKeyDown={(event) => {
          if (
            event.key !== "Enter" &&
            event.key !== " " &&
            event.key !== "ArrowDown"
          ) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
          suppressKeyboardClick.current = true;
          queueMicrotask(() => {
            suppressKeyboardClick.current = false;
          });
          onOpen(event.currentTarget, "keyboard");
        }}
      >
        <Ellipsis aria-hidden="true" />
      </button>
    </div>
  );
}

function sameTableActionControlTarget(
  left: TableActionControlTarget | null,
  right: TableActionControlTarget,
): boolean {
  return left !== null && sameTableActionTarget(left.target, right.target);
}

function sameTableActionTarget(
  left: FirstDraftTableActionTarget,
  right: FirstDraftTableActionTarget,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "row" && right.kind === "row") {
    return left.rowId === right.rowId;
  }
  if (left.kind !== "column" || right.kind !== "column") return false;
  if (left.identity.kind !== right.identity.kind) return false;
  return left.identity.kind === "canonical" &&
    right.identity.kind === "canonical"
    ? left.identity.columnId === right.identity.columnId
    : left.identity.kind === "synthetic-presentation" &&
        right.identity.kind === "synthetic-presentation" &&
        left.identity.presentationId === right.identity.presentationId &&
        left.identity.indexAtOpen === right.identity.indexAtOpen &&
        left.identity.columnCountAtOpen === right.identity.columnCountAtOpen;
}

function TableAppendButton({
  axis,
  label,
  onAppend,
}: {
  readonly axis: "row" | "column";
  readonly label: string;
  readonly onAppend: () => void;
}) {
  return (
    <button
      className={`table-block__append table-block__append--${axis}`}
      type="button"
      aria-label={label}
      data-editor-ui="true"
      data-editor-object-ui="true"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        onAppend();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (event.detail === 0) onAppend();
      }}
    >
      <span aria-hidden="true">+</span>
    </button>
  );
}

export function TableRowRenderer({ block, editor, children }: Props) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const rowGeometryRef = useFirstDraftTableRowGeometryRef(block.id);
  const setRowRef = useCallback(
    (element: HTMLDivElement | null) => {
      rowRef.current = element;
      rowGeometryRef(element);
    },
    [rowGeometryRef],
  );
  const table = block.parentId ? editor.getBlock(block.parentId) : null;
  const count = editor.getChildBlockIds(block.id).length;
  const resolution = resolveFirstDraftTableColumnIds(table?.metadata, count);
  const widths = readColumnWidths(table?.metadata, resolution);
  const initialTracks = resolution.ids
    .map((columnId) => `${widths[columnId] ?? MIN_WIDTH}px`)
    .join(" ");
  return (
    <div
      ref={setRowRef}
      className="table-block__row"
      role="row"
      data-table-row-id={block.id}
      style={{
        gridTemplateColumns: `var(--first-draft-table-tracks, ${initialTracks})`,
      }}
    >
      {children}
      <TableRowTrackController block={block} editor={editor} rowRef={rowRef} />
    </div>
  );
}

function TableRowTrackController({
  block,
  editor,
  rowRef,
}: Pick<Props, "block" | "editor"> & {
  readonly rowRef: RefObject<HTMLDivElement | null>;
}) {
  const presentation = useFirstDraftTablePresentation();
  const tableId = block.parentId;
  const table = useSyncExternalStore(
    (listener) =>
      tableId ? editor.subscribeBlock(tableId, listener) : () => undefined,
    () => (tableId ? editor.getBlock(tableId) : null),
    () => (tableId ? editor.getBlock(tableId) : null),
  );
  const count = editor.getChildBlockIds(block.id).length;
  const resolution = resolveFirstDraftTableColumnIds(table?.metadata, count);
  const widths = readColumnWidths(table?.metadata, resolution);
  const fallbackTracks = presentation.columns
    .map((item) => `${widths[item.presentationId] ?? MIN_WIDTH}px`)
    .join(" ");
  useLayoutEffect(() => {
    rowRef.current?.style.setProperty(
      "grid-template-columns",
      `var(--first-draft-table-tracks, ${fallbackTracks})`,
    );
  }, [fallbackTracks, rowRef]);
  return null;
}

export function TableCellRenderer({ block, editor }: Props) {
  const presentation = useFirstDraftTablePresentation();
  const rowId = block.parentId!;
  const tableId = editor.getParentId(rowId)!;
  const row = presentation.rows.findIndex(
    (candidate) => candidate.rowId === rowId,
  );
  const presentedRow = presentation.rows[row];
  const column = presentedRow?.cellIds.indexOf(block.id) ?? -1;
  const columnItem = presentation.columns[column];
  const columnId = columnItem?.presentationId;
  const isDragPlaceholder =
    presentation.dragPlaceholder?.axis === "row"
      ? presentation.dragPlaceholder.rowId === rowId
      : presentation.dragPlaceholder?.axis === "column" &&
        columnItem?.dragId === presentation.dragPlaceholder.dragId;
  const selection = useTableSelectionState();
  const selected = selection.selectedIds.has(block.id);
  const paintSegment = selection.paintSegments.get(block.id);
  const remoteSegments = selection.remoteSegments.get(block.id) ?? [];
  return (
    <div
      className={`table-block__cell${selected ? " table-block__cell--selected" : ""}`}
      role="gridcell"
      aria-colindex={column + 1}
      aria-selected={selected || undefined}
      data-table-id={tableId}
      data-table-cell-id={block.id}
      data-table-row-id={rowId}
      data-table-column-id={columnId}
      data-table-row-index={row}
      data-table-column-index={column}
      data-table-drag-placeholder={
        isDragPlaceholder ? presentation.dragPlaceholder?.axis : undefined
      }
    >
      <EditableTextBlockPrimitive block={block} editor={editor} />
      {selected && paintSegment ? (
        <span
          className="table-block__selection-paint"
          data-table-selection-kind="local"
          {...selectionPaintSegmentDataAttributes(paintSegment)}
          aria-hidden="true"
        />
      ) : null}
      {remoteSegments.map((segment) => (
        <span
          key={segment.subject}
          className="table-block__selection-paint"
          data-table-selection-kind="remote"
          data-table-selection-participant={segment.subject}
          data-table-selection-color={segment.color ?? undefined}
          {...selectionPaintSegmentDataAttributes(segment.edges)}
          style={
            {
              "--table-block-selection-color":
                segment.color ??
                "var(--editor-additional-selection-color, Highlight)",
            } as CSSProperties
          }
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function useTableAfterTargetRef(blockId: BlockId) {
  return useFirstDraftBlockDropTargetRef({ kind: "after-block", blockId });
}

const emptyAdditionalSelectionRecords = Object.freeze(
  [],
) as readonly AdditionalSelectionRecord[];

function remoteTableSelectionSegments(
  records: readonly AdditionalSelectionRecord[],
  canonicalGraph: Pick<EditableEditor, "getParentId" | "getChildBlockIds">,
  presentationGraph: Pick<EditableEditor, "getParentId" | "getChildBlockIds">,
  tableId: BlockId,
): ReadonlyMap<BlockId, readonly RemoteTableSelectionSegment[]> {
  const result = new Map<BlockId, RemoteTableSelectionSegment[]>();
  for (const record of records) {
    const resolved = record.resolvedSelection;
    if (
      !record.active ||
      record.resolution !== "resolved" ||
      !resolved ||
      resolved.kind !== "block-internal" ||
      resolved.blockId !== tableId ||
      resolved.subsystem !== TABLE_INTERNAL_SELECTION_SUBSYSTEM_ID
    ) {
      continue;
    }
    const selection = decodeTableRangeSelection(resolved.payload);
    const range = selection
      ? resolveTableRange(canonicalGraph, tableId, selection)
      : null;
    if (!range) continue;
    const selectedIds = new Set(
      rangeSelectionPaintSegments(canonicalGraph, tableId, range).keys(),
    );
    for (const [cellId, edges] of selectionPaintSegmentsForIds(
      presentationGraph,
      tableId,
      selectedIds,
    )) {
      const segments = result.get(cellId) ?? [];
      segments.push({ subject: record.subject, color: record.color, edges });
      result.set(cellId, segments);
    }
  }
  return result;
}

type ArrowKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

function isArrowKey(key: string): key is ArrowKey {
  return (
    key === "ArrowLeft" ||
    key === "ArrowRight" ||
    key === "ArrowUp" ||
    key === "ArrowDown"
  );
}

function moveByArrow(
  point: TableCellPoint,
  key: ArrowKey,
  rows: number,
  columns: number,
): Omit<TableCellPoint, "cellId"> | null {
  const next = {
    row: point.row + (key === "ArrowUp" ? -1 : key === "ArrowDown" ? 1 : 0),
    column:
      point.column + (key === "ArrowLeft" ? -1 : key === "ArrowRight" ? 1 : 0),
  };
  return next.row >= 0 &&
    next.row < rows &&
    next.column >= 0 &&
    next.column < columns
    ? next
    : null;
}

function shouldLeaveTextCell(
  target: EventTarget | null,
  key: ArrowKey,
): boolean {
  if (key === "ArrowUp" || key === "ArrowDown") return true;
  if (!(target instanceof Element)) return true;
  const root = target.closest<HTMLElement>('[data-editor-text-root="true"]');
  const selection = root?.ownerDocument.getSelection();
  if (!root || !selection?.focusNode || !root.contains(selection.focusNode)) {
    return true;
  }
  const range = root.ownerDocument.createRange();
  try {
    range.selectNodeContents(root);
    range.setEnd(selection.focusNode, selection.focusOffset);
    const offset = range.toString().length;
    return key === "ArrowLeft"
      ? offset === 0
      : offset === (root.textContent?.length ?? 0);
  } catch {
    return true;
  } finally {
    range.detach();
  }
}

function cellLength(
  editor: {
    getBlock(id: BlockId): { type: string } | null;
    readBlockPlainText(id: BlockId, type: string): string;
  },
  cellId: BlockId,
): number {
  const cell = editor.getBlock(cellId);
  return cell ? editor.readBlockPlainText(cellId, cell.type).length : 0;
}

function standaloneSelectionContext(
  cause: "pointer" | "keyboard" | "canonical-rebase",
) {
  return { publication: { kind: "standalone-local" as const }, cause };
}

function clearCells(editor: EditableEditor, cellIds: readonly BlockId[]) {
  editor.transaction(() => {
    for (const cellId of cellIds) replaceCellText(editor, cellId, "");
    editor.setTransactionSelection({ kind: "preserve" });
  });
}

function replaceCellText(
  editor: EditableEditor,
  cellId: BlockId,
  text: string,
) {
  const document = editor.readBlockContent(cellId, "tableCell");
  const length = document ? richTextDocumentContentSize(document) : 0;
  if (length)
    editor.deleteText({ blockId: cellId, range: { from: 0, to: length } });
  if (text) editor.insertText({ blockId: cellId, offset: 0, text });
}

function readColumnWidths(
  metadata: Readonly<Record<string, unknown>> | undefined,
  resolution: FirstDraftTableColumnIdResolution,
): Record<string, number> {
  const record = resolveFirstDraftTablePresentationColumnWidths(
    metadata,
    resolution,
  );
  return Object.fromEntries(
    resolution.ids.map((id) => [
      id,
      typeof record[id] === "number"
        ? Math.max(MIN_WIDTH, record[id])
        : MIN_WIDTH,
    ]),
  );
}

function resizeColumn(
  widths: Readonly<Record<string, number>>,
  ids: readonly string[],
  id: string,
  target: number,
): Readonly<Record<string, number>> | null {
  if (!ids.includes(id) || !Number.isFinite(target)) return null;
  return Object.fromEntries(
    ids.map((current) => [
      current,
      current === id
        ? Math.max(MIN_WIDTH, Math.round(target))
        : (widths[current] ?? MIN_WIDTH),
    ]),
  );
}
