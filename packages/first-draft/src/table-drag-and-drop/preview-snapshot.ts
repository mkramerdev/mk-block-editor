import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import type { BlockId, JsonValue } from "@repo/editor-core/kernel";
import type { EditableEditor } from "@repo/editor-web/editor";
import {
  resolveFirstDraftTableColumnIds,
  resolveFirstDraftTablePresentationColumnWidths,
  type FirstDraftTableColumnIdResolution,
} from "../blocks/table/model.ts";
import type {
  FirstDraftTableCanonicalDragStructure,
  FirstDraftTableColumnDragPreview,
  FirstDraftTableDragPreviewCell,
  FirstDraftTableDragPreviewCellBlock,
  FirstDraftTableRowDragPreview,
  TableColumnDragItem,
} from "./contracts.ts";

type PreviewEditor = Pick<
  EditableEditor,
  "getBlock" | "getParentId" | "getChildBlockIds" | "readBlockContent"
>;

const TABLE_MIN_COLUMN_WIDTH = 176;

/** Reads only table membership and identities; visual content is captured separately. */
export function readFirstDraftTableDragStructure(
  editor: PreviewEditor,
  tableId: BlockId,
): FirstDraftTableCanonicalDragStructure {
  const table = editor.getBlock(tableId);
  if (!table || table.tombstone !== null || table.type !== "table") {
    throw new Error("cannot drag a missing or invalid table");
  }
  const rowIds = [...editor.getChildBlockIds(tableId)];
  if (rowIds.length === 0 || new Set(rowIds).size !== rowIds.length) {
    throw new Error("cannot drag a table with invalid row membership");
  }
  const allCellIds = new Set<BlockId>();
  const cellIdsByRow: BlockId[][] = [];
  let columnCount: number | null = null;
  for (const rowId of rowIds) {
    const row = editor.getBlock(rowId);
    if (
      !row ||
      row.tombstone !== null ||
      row.type !== "tableRow" ||
      row.parentId !== tableId ||
      editor.getParentId(rowId) !== tableId
    ) {
      throw new Error("cannot drag an invalid table row");
    }
    const cellIds = [...editor.getChildBlockIds(rowId)];
    columnCount ??= cellIds.length;
    if (
      cellIds.length === 0 ||
      cellIds.length !== columnCount ||
      new Set(cellIds).size !== cellIds.length
    ) {
      throw new Error("cannot drag a non-rectangular table");
    }
    for (const cellId of cellIds) {
      if (allCellIds.has(cellId)) {
        throw new Error("cannot drag duplicate table cell membership");
      }
      allCellIds.add(cellId);
      const cell = editor.getBlock(cellId);
      if (
        !cell ||
        cell.tombstone !== null ||
        cell.type !== "tableCell" ||
        cell.parentId !== rowId ||
        editor.getParentId(cellId) !== rowId
      ) {
        throw new Error("cannot drag an invalid table cell");
      }
    }
    cellIdsByRow.push(cellIds);
  }
  const resolution = resolveFirstDraftTableColumnIds(
    table.metadata,
    columnCount!,
  );
  return Object.freeze({
    rowIds: Object.freeze(rowIds),
    cellIdsByRow: Object.freeze(
      cellIdsByRow.map((cellIds) => Object.freeze(cellIds)),
    ),
    presentationColumnIds: Object.freeze([...resolution.ids]),
    columnIdentityKind: resolution.kind,
  });
}

export function captureFirstDraftTableRowDragPreview(
  editor: PreviewEditor,
  tableId: BlockId,
  rowId: BlockId,
  structure: FirstDraftTableCanonicalDragStructure,
): FirstDraftTableRowDragPreview | null {
  const rowIndex = uniqueIndex(structure.rowIds, rowId);
  if (rowIndex < 0) return null;
  const cellIds = structure.cellIdsByRow[rowIndex];
  if (!cellIds || cellIds.length !== structure.presentationColumnIds.length) {
    return null;
  }
  const cells = captureCells(editor, rowId, cellIds);
  const presentation = resolveTablePresentation(editor, tableId, structure);
  return cells && presentation
    ? Object.freeze({ axis: "row", tracks: presentation.tracks, cells })
    : null;
}

export function captureFirstDraftTableColumnDragPreview(
  editor: PreviewEditor,
  tableId: BlockId,
  item: TableColumnDragItem,
  structure: FirstDraftTableCanonicalDragStructure,
  rowHeights: readonly number[],
): FirstDraftTableColumnDragPreview | null {
  const columnIndex = uniqueIndex(
    structure.presentationColumnIds,
    item.presentationId,
  );
  if (
    columnIndex < 0 ||
    rowHeights.length !== structure.rowIds.length ||
    rowHeights.some((height) => !Number.isFinite(height) || height <= 0)
  ) {
    return null;
  }
  const cells: FirstDraftTableDragPreviewCell[] = [];
  for (const [rowIndex, rowId] of structure.rowIds.entries()) {
    const rowCells = structure.cellIdsByRow[rowIndex];
    if (!rowCells || rowCells.length !== structure.presentationColumnIds.length) {
      return null;
    }
    const cellId = rowCells[columnIndex];
    if (!cellId) return null;
    const cell = captureCell(editor, rowId, cellId);
    if (!cell) return null;
    cells.push(cell);
  }
  const presentation = resolveTablePresentation(editor, tableId, structure);
  const width = presentation?.widths[columnIndex];
  if (width === undefined) return null;
  return Object.freeze({
    axis: "column",
    columnWidth: width,
    rowHeights: Object.freeze([...rowHeights]),
    cells: Object.freeze(cells),
  });
}

function captureCells(
  editor: PreviewEditor,
  rowId: BlockId,
  cellIds: readonly BlockId[],
): readonly FirstDraftTableDragPreviewCell[] | null {
  const cells: FirstDraftTableDragPreviewCell[] = [];
  for (const cellId of cellIds) {
    const cell = captureCell(editor, rowId, cellId);
    if (!cell) return null;
    cells.push(cell);
  }
  return Object.freeze(cells);
}

function captureCell(
  editor: PreviewEditor,
  rowId: BlockId,
  cellId: BlockId,
): FirstDraftTableDragPreviewCell | null {
  const block = editor.getBlock(cellId);
  if (
    !block ||
    block.tombstone !== null ||
    block.type !== "tableCell" ||
    block.parentId !== rowId ||
    editor.getParentId(cellId) !== rowId
  ) {
    return null;
  }
  let content: RichTextDocumentNodeJson | null;
  try {
    content = editor.readBlockContent(cellId, "tableCell");
  } catch {
    return null;
  }
  if (!content) return null;
  return Object.freeze({
    block: cloneCellBlock(block as FirstDraftTableDragPreviewCellBlock),
    content: cloneJson(content) as RichTextDocumentNodeJson,
  });
}

function resolveTablePresentation(
  editor: PreviewEditor,
  tableId: BlockId,
  structure: FirstDraftTableCanonicalDragStructure,
): { readonly tracks: string; readonly widths: readonly number[] } | null {
  const table = editor.getBlock(tableId);
  if (!table || table.tombstone !== null || table.type !== "table") return null;
  const resolution: FirstDraftTableColumnIdResolution = {
    kind: structure.columnIdentityKind,
    ids: structure.presentationColumnIds,
  };
  const widths = resolveFirstDraftTablePresentationColumnWidths(
    table.metadata,
    resolution,
  );
  const normalized = structure.presentationColumnIds.map((columnId) => {
    const width = widths[columnId];
    return typeof width === "number" && Number.isFinite(width)
      ? Math.max(TABLE_MIN_COLUMN_WIDTH, width)
      : TABLE_MIN_COLUMN_WIDTH;
  });
  return {
    tracks: normalized.map((width) => `${width}px`).join(" "),
    widths: normalized,
  };
}

function cloneCellBlock(
  block: FirstDraftTableDragPreviewCellBlock,
): FirstDraftTableDragPreviewCellBlock {
  return Object.freeze({
    ...block,
    ...(block.metadata
      ? {
          metadata: cloneJson(
            block.metadata,
          ) as FirstDraftTableDragPreviewCellBlock["metadata"],
        }
      : {}),
  });
}

function cloneJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return Object.freeze(value.map(cloneJson));
  if (value !== null && typeof value === "object") {
    return Object.freeze(
      Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, cloneJson(child)]),
      ),
    );
  }
  return value;
}

function uniqueIndex<T>(values: readonly T[], value: T): number {
  const index = values.indexOf(value);
  return index >= 0 && values.lastIndexOf(value) === index ? index : -1;
}
