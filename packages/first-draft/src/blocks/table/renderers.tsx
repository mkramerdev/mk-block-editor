"use client";

import {
  Children,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";
import { richTextDocumentContentSize } from "@repo/editor-core/content/rich-text";
import type { BlockId } from "@repo/editor-core/kernel";
import { EditableTextBlockPrimitive } from "@repo/editor-web/editable-block-renderer";
import {
  editorSelectionBoundsDataAttributes,
  readEditorBlockSelectionTarget,
  selectionPaintSegmentDataAttributes,
  textOffsetFromPoint,
} from "@repo/editor-web/block-renderer";
import type { EditableEditor } from "@repo/editor-web/editor";
import type { AdditionalSelectionRecord } from "@repo/editor-web/editor";
import type { FirstDraftBlockRendererProps } from "../../first-draft-editor-contracts.ts";
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
  resolveTableRange,
  TABLE_INTERNAL_SELECTION_SUBSYSTEM_ID,
  tableInternalSelectionSubsystem,
  TableSelectionProvider,
  useTableSelectionState,
  type RemoteTableSelectionSegment,
  type TableCellPoint,
  type TableRange,
} from "./selection.ts";
import {
  readFirstDraftTableColumnIds,
  TABLE_COLUMN_WIDTHS_FIELD,
} from "./model.ts";
import {
  appendFirstDraftTableColumn,
  appendFirstDraftTableRow,
} from "./mutations.ts";

type Props = FirstDraftBlockRendererProps;

const MIN_WIDTH = 176;

export function TableRenderer({
  block,
  editor,
  children,
  selectionController,
}: Props) {
  const setHoveredBlockId = useSetHoveredFirstDraftBlockId();
  const rows = editor.getChildBlockIds(block.id);
  const columnCount = rows[0] ? editor.getChildBlockIds(rows[0]).length : 0;
  const columnIds = readFirstDraftTableColumnIds(block.metadata, columnCount);
  const widths = readColumnWidths(block.metadata, columnIds);
  const [preview, setPreview] = useState<Record<string, number> | null>(null);
  const [drag, setDrag] = useState<{
    readonly pointerId: number;
    readonly id: string;
    readonly startX: number;
    readonly startWidth: number;
  } | null>(null);
  const canonical = useSyncExternalStore(
    (listener) =>
      selectionController.endpoint.subscribeBlock(block.id, listener),
    selectionController.getCanonicalSnapshot,
    selectionController.getCanonicalSnapshot,
  );
  const range = useMemo(
    () => readTableRangeSelection(canonical, block.id, editor),
    [block.id, canonical, editor],
  );
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<{
    readonly pointerId: number;
    readonly anchor: TableCellPoint;
    readonly startX: number;
    readonly startY: number;
    moved: boolean;
    promoted: boolean;
  } | null>(null);
  const suppressClick = useRef(false);
  const paintSegments = useMemo(
    () => rangeSelectionPaintSegments(editor, block.id, range),
    [block.id, editor, range],
  );
  const selectedIds = useMemo(
    () => new Set(paintSegments.keys()),
    [paintSegments],
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
    () => remoteTableSelectionSegments(remoteRecords, editor, block.id),
    [block.id, editor, remoteRecords],
  );
  const renderedWidths = preview ?? widths;
  const normalizedWidths = columnIds.map(
    (id) => renderedWidths[id] ?? MIN_WIDTH,
  );
  const tracks = normalizedWidths.map((width) => `${width}px`).join(" ");
  const gridContentWidth = `${normalizedWidths.reduce(
    (total, width) => total + width,
    0,
  )}px`;
  const style = {
    "--first-draft-table-tracks": tracks,
    "--first-draft-table-grid-content-width": gridContentWidth,
  } as CSSProperties;
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
  const commitRange = useCallback(
    (next: TableRange, cause: "pointer" | "keyboard") => {
      const target = readEditorBlockSelectionTarget(editor, block.id);
      if (!target) return false;
      const result = selectionController.commitBlockSelection(
        target,
        createTableRangeCoverage(
          block.id,
          block.type,
          encodeTableRange(next),
          editor,
        ),
        tableInternalSelectionSubsystem,
        standaloneSelectionContext(cause),
        editor.getSelectionGraphRevision(),
      );
      return result.kind !== "rejected";
    },
    [block.id, block.type, editor, selectionController],
  );
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
  const cells = rows.flatMap((rowId, row) =>
    editor
      .getChildBlockIds(rowId)
      .map((cellId, column) => ({ row, column, cellId })),
  );
  const handleKey = (event: React.KeyboardEvent<HTMLDivElement>) => {
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
        const cellId = editor.getChildBlockIds(rows[next.row]!)[next.column];
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
        appendFirstDraftTableRow(editor, block.id, rows.length, columnCount);
      }
      return;
    }
    if (!isArrowKey(event.key)) return;
    const next = moveByArrow(point, event.key, rows.length, columnCount);
    if (!next) return;
    if (!shouldLeaveTextCell(event.target, event.key)) return;
    const cellId = editor.getChildBlockIds(rows[next.row]!)[next.column];
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
    id: string,
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setPreview(widths);
    setDrag({
      pointerId: event.pointerId,
      id,
      startX: event.clientX,
      startWidth: widths[id] ?? MIN_WIDTH,
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
    if (commit && preview) {
      editor.updateBlockMetadata(
        [
          {
            blockId: block.id,
            values: { [TABLE_COLUMN_WIDTHS_FIELD]: preview },
          },
        ],
        { editorSuggestion: null },
      );
    } else setPreview(null);
    setDrag(null);
  };
  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    suppressClick.current = false;
    const point = pointFromTarget(event.target);
    if (!point) return;
    const cell =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-table-cell-id]")
        : null;
    const textRoot = cell?.querySelector<HTMLElement>(
      '[data-editor-text-root="true"]',
    );
    if (textRoot && !textRoot.isContentEditable) event.preventDefault();
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
    const cell =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>("[data-table-cell-id]")
        : null;
    if (!point || !cell) return;
    const native = cell.ownerDocument.getSelection();
    const textRoot =
      cell.querySelector<HTMLElement>('[data-editor-text-root="true"]') ?? cell;
    if (
      native &&
      !native.isCollapsed &&
      native.anchorNode &&
      native.focusNode &&
      textRoot.contains(native.anchorNode) &&
      textRoot.contains(native.focusNode)
    )
      return;
    if (event.shiftKey && range) {
      event.preventDefault();
      commitRange({ anchor: range.anchor, head: point }, "pointer");
      return;
    }
    const length = cellLength(editor, point.cellId);
    const offset =
      textOffsetFromPoint(textRoot, event.clientX, event.clientY, length) ??
      length;
    event.preventDefault();
    focusCell(point, offset, "pointer");
  };

  return (
    <div
      className="table-block__object"
      data-editor-object-root="true"
      style={style}
      onKeyDownCapture={handleKey}
      onPointerMove={(event) => {
        setHoveredBlockId(block.id);
        event.stopPropagation();
      }}
    >
      <div className="table-block__chrome-anchor">
        <FirstDraftBlockChrome
          blockId={block.id}
          editor={editor}
          blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.table}
        />
      </div>
      <div className="table-block__scroll">
        <div className="table-block__frame">
          <div className="table-block__grid-stack">
            <div
              ref={gridRef}
              className="table-block__grid"
              role="grid"
              aria-label="Table"
              aria-rowcount={rows.length}
              aria-colcount={columnCount}
              tabIndex={-1}
              data-table-grid
              data-table-selection-kind={range ? "local" : undefined}
              data-table-selection-type={range ? "cell-range" : undefined}
              data-table-selection-anchor-cell-id={range?.anchor.cellId}
              data-table-selection-head-cell-id={range?.head.cellId}
              data-editor-block-internal-selection-host="true"
              {...editorSelectionBoundsDataAttributes(block.id, {
                target: "table-grid",
              })}
              onPointerDownCapture={pointerDown}
              onPointerMoveCapture={pointerMove}
              onPointerUpCapture={finishPointer}
              onClickCapture={completedClick}
              onPointerCancelCapture={cancelPointer}
              onPasteCapture={pasteRange}
            >
              <TableSelectionProvider value={tableValue}>
                {children}
              </TableSelectionProvider>
            </div>
            <div
              className="table-block__resize-overlay"
              style={{ gridTemplateColumns: tracks }}
              data-editor-ui="true"
              data-editor-object-ui="true"
            >
              {columnIds.map((id, index) => (
                <div
                  key={id}
                  className="table-block__resize-handle"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize column ${index + 1}`}
                  aria-valuemin={MIN_WIDTH}
                  aria-valuenow={renderedWidths[id] ?? MIN_WIDTH}
                  tabIndex={0}
                  data-table-resize-column={id}
                  data-table-resize-active={drag?.id === id || undefined}
                  onPointerDown={(event) => beginResize(id, event)}
                  onPointerMove={moveResize}
                  onPointerUp={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId))
                      event.currentTarget.releasePointerCapture(
                        event.pointerId,
                      );
                    finishResize(true);
                  }}
                  onPointerCancel={() => finishResize(false)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") finishResize(false);
                    if (
                      event.key === "ArrowLeft" ||
                      event.key === "ArrowRight"
                    ) {
                      event.preventDefault();
                      const next = resizeColumn(
                        widths,
                        columnIds,
                        id,
                        (widths[id] ?? MIN_WIDTH) +
                          (event.key === "ArrowLeft" ? -8 : 8),
                      );
                      if (next)
                        editor.updateBlockMetadata(
                          [
                            {
                              blockId: block.id,
                              values: { [TABLE_COLUMN_WIDTHS_FIELD]: next },
                            },
                          ],
                          { editorSuggestion: null },
                        );
                    }
                  }}
                />
              ))}
            </div>
          </div>
          <TableAppendButton
            axis="column"
            label="Add table column"
            onAppend={() =>
              appendFirstDraftTableColumn(editor, block.id, columnIds)
            }
          />
          <TableAppendButton
            axis="row"
            label="Add table row"
            onAppend={() =>
              appendFirstDraftTableRow(
                editor,
                block.id,
                rows.length,
                columnCount,
              )
            }
          />
        </div>
      </div>
    </div>
  );
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
  const tableId = block.parentId;
  const table = useSyncExternalStore(
    (listener) =>
      tableId ? editor.subscribeBlock(tableId, listener) : () => undefined,
    () => (tableId ? editor.getBlock(tableId) : null),
    () => (tableId ? editor.getBlock(tableId) : null),
  );
  const count = editor.getChildBlockIds(block.id).length;
  const ids = readFirstDraftTableColumnIds(table?.metadata, count);
  const widths = readColumnWidths(table?.metadata, ids);
  const fallbackTracks = ids
    .map((id) => `${widths[id] ?? MIN_WIDTH}px`)
    .join(" ");
  const elements = Children.toArray(children);
  return (
    <div
      className="table-block__row"
      role="row"
      style={{
        gridTemplateColumns: `var(--first-draft-table-tracks, ${fallbackTracks})`,
      }}
    >
      {elements}
    </div>
  );
}

export function TableCellRenderer({ block, editor }: Props) {
  const rowId = block.parentId!;
  const tableId = editor.getParentId(rowId)!;
  const row = editor.getChildBlockIds(tableId).indexOf(rowId);
  const column = editor.getChildBlockIds(rowId).indexOf(block.id);
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
      data-table-row-index={row}
      data-table-column-index={column}
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

const emptyAdditionalSelectionRecords = Object.freeze(
  [],
) as readonly AdditionalSelectionRecord[];

function remoteTableSelectionSegments(
  records: readonly AdditionalSelectionRecord[],
  graph: EditableEditor,
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
      ? resolveTableRange(graph, tableId, selection)
      : null;
    if (!range) continue;
    for (const [cellId, edges] of rangeSelectionPaintSegments(
      graph,
      tableId,
      range,
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

function standaloneSelectionContext(cause: "pointer" | "keyboard") {
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
  ids: readonly string[],
): Record<string, number> {
  const value = metadata?.[TABLE_COLUMN_WIDTHS_FIELD];
  const record =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return Object.fromEntries(
    ids.map((id) => [
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
