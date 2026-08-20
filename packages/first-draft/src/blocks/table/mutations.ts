import { materializeCanonicalBlockCreation } from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditableEditor } from "@repo/editor-web/editor";
import { createFirstDraftBlockIdAllocator } from "../../identity/block-id-allocator.ts";
import {
  createFirstDraftTableColumnId,
  normalizeFirstDraftTableColumns,
  TABLE_COLUMN_IDS_FIELD,
  TABLE_COLUMN_WIDTHS_FIELD,
} from "./model.ts";

interface TableIdentitySources {
  readonly createBlockId?: () => BlockId;
  readonly createColumnId?: () => string;
}

export interface FirstDraftTableRowAppendResult {
  readonly rowId: BlockId;
  readonly cellIds: readonly BlockId[];
  readonly transaction: Extract<
    ReturnType<EditableEditor["transaction"]>,
    { readonly ok: true; readonly changed: true }
  >;
}

export interface FirstDraftTableColumnAppendResult {
  readonly columnId: string;
  readonly cellIds: readonly BlockId[];
  readonly transaction: Extract<
    ReturnType<EditableEditor["transaction"]>,
    { readonly ok: true; readonly changed: true }
  >;
}

export interface FirstDraftTableColumnResizeResult {
  readonly columnId: string;
  readonly width: number;
  readonly transaction: Extract<
    ReturnType<EditableEditor["transaction"]>,
    { readonly ok: true; readonly changed: true }
  >;
}

/** Prepares and atomically appends one canonical row tree. */
export function appendFirstDraftTableRow(
  editor: EditableEditor,
  tableId: BlockId,
  index: number,
  columnCount: number,
  identitySources: TableIdentitySources = {},
): FirstDraftTableRowAppendResult | null {
  if (columnCount < 1) return null;
  const allocateBlockId = createFirstDraftBlockIdAllocator(editor, {
    createId: identitySources.createBlockId,
    purpose: "table mutation",
  });
  const creation = materializeTableBlock({
    blockDefinitions: editor.definition.blocks,
    type: "tableRow",
    defaultContentCount: columnCount,
    createBlockId: allocateBlockId,
  });
  const cellIds = creation.fragment.blocks.flatMap((block) =>
    block.parentId === creation.rootBlockId && block.type === "tableCell"
      ? [block.id]
      : [],
  );
  const firstCellId = cellIds[0];
  if (
    cellIds.length !== columnCount ||
    !firstCellId ||
    creation.selectionBlockId !== firstCellId
  ) {
    throw new Error("canonical table row creation produced an invalid row");
  }

  const transaction = editor.transaction(() => {
    editor.insertBlocks(
      { parentId: tableId, childIndex: index },
      creation.fragment,
    );
    editor.setTransactionSelection({
      kind: "text",
      blockId: firstCellId,
      offset: 0,
    });
  });
  return requireChangedTableTransaction(transaction, {
    rowId: creation.rootBlockId,
    cellIds,
  });
}

/** Prepares every identity and fragment before atomically appending a column. */
export function appendFirstDraftTableColumn(
  editor: EditableEditor,
  tableId: BlockId,
  identitySources: TableIdentitySources = {},
): FirstDraftTableColumnAppendResult {
  const structure = readCanonicalTableStructure(editor, tableId);
  const normalized = normalizeFirstDraftTableColumns(
    structure.table.metadata,
    structure.columnCount,
    identitySources.createColumnId,
  );
  const columnIds = normalized.columnIds;

  const allocateBlockId = createFirstDraftBlockIdAllocator(editor, {
    createId: identitySources.createBlockId,
    purpose: "table mutation",
  });
  const cells = structure.rowIds.map((rowId) => {
    const creation = materializeTableBlock({
      blockDefinitions: editor.definition.blocks,
      type: "tableCell",
      createBlockId: allocateBlockId,
    });
    if (
      creation.fragment.blocks.length !== 1 ||
      creation.selectionBlockId !== creation.rootBlockId
    ) {
      throw new Error("canonical table cell creation produced an invalid cell");
    }
    return { rowId, creation };
  });
  const cellIds = cells.map(({ creation }) => creation.rootBlockId);
  const firstCellId = cellIds[0];
  if (!firstCellId) {
    throw new Error("canonical table column creation produced no cells");
  }
  const columnId = createFirstDraftTableColumnId(
    columnIds,
    identitySources.createColumnId,
  );

  const transaction = editor.transaction(() => {
    for (const { rowId, creation } of cells) {
      editor.insertBlocks(
        { parentId: rowId, childIndex: columnIds.length },
        creation.fragment,
      );
    }
    editor.updateBlockMetadata(
      [
        {
          blockId: tableId,
          values: {
            [TABLE_COLUMN_IDS_FIELD]: [...columnIds, columnId],
            [TABLE_COLUMN_WIDTHS_FIELD]: normalized.columnWidths,
          },
        },
      ],
      { editorSuggestion: null },
    );
    editor.setTransactionSelection({
      kind: "text",
      blockId: firstCellId,
      offset: 0,
    });
  });
  return requireChangedTableTransaction(transaction, { columnId, cellIds });
}

/** Re-resolves table identity at commit preparation before changing a width. */
export function resizeFirstDraftTableColumn(
  editor: EditableEditor,
  tableId: BlockId,
  columnIndex: number,
  width: number,
  identitySources: Pick<TableIdentitySources, "createColumnId"> = {},
): FirstDraftTableColumnResizeResult {
  const structure = readCanonicalTableStructure(editor, tableId);
  if (
    !Number.isInteger(columnIndex) ||
    columnIndex < 0 ||
    columnIndex >= structure.columnCount
  ) {
    throw new Error("cannot resize a missing table column");
  }
  if (!Number.isFinite(width) || width <= 0) {
    throw new Error("table column width must be a positive finite number");
  }
  const normalized = normalizeFirstDraftTableColumns(
    structure.table.metadata,
    structure.columnCount,
    identitySources.createColumnId,
  );
  const columnId = normalized.columnIds[columnIndex]!;
  const roundedWidth = Math.round(width);
  const columnWidths = {
    ...normalized.columnWidths,
    [columnId]: roundedWidth,
  };
  const transaction = editor.transaction(() => {
    editor.updateBlockMetadata(
      [
        {
          blockId: tableId,
          values: {
            [TABLE_COLUMN_IDS_FIELD]: normalized.columnIds,
            [TABLE_COLUMN_WIDTHS_FIELD]: columnWidths,
          },
        },
      ],
      { editorSuggestion: null },
    );
    editor.setTransactionSelection({ kind: "preserve" });
  });
  return requireChangedTableTransaction(transaction, {
    columnId,
    width: roundedWidth,
  });
}

function readCanonicalTableStructure(editor: EditableEditor, tableId: BlockId) {
  const table = editor.getBlock(tableId);
  if (!table || table.tombstone || table.type !== "table") {
    throw new Error("cannot mutate a missing or invalid table");
  }
  const rowIds = editor.getChildBlockIds(tableId);
  if (rowIds.length === 0) {
    throw new Error("cannot mutate a table without rows");
  }
  let columnCount: number | null = null;
  for (const rowId of rowIds) {
    const row = editor.getBlock(rowId);
    if (
      !row ||
      row.tombstone ||
      row.type !== "tableRow" ||
      row.parentId !== tableId
    ) {
      throw new Error("cannot mutate an invalid table row");
    }
    const cellIds = editor.getChildBlockIds(rowId);
    columnCount ??= cellIds.length;
    if (cellIds.length === 0 || cellIds.length !== columnCount) {
      throw new Error("cannot mutate a non-rectangular table");
    }
    for (const cellId of cellIds) {
      const cell = editor.getBlock(cellId);
      if (
        !cell ||
        cell.tombstone ||
        cell.type !== "tableCell" ||
        cell.parentId !== rowId
      ) {
        throw new Error("cannot mutate an invalid table cell");
      }
    }
  }
  return { table, rowIds, columnCount: columnCount! };
}

function materializeTableBlock(
  options: Pick<
    Parameters<typeof materializeCanonicalBlockCreation>[0],
    "blockDefinitions" | "type" | "defaultContentCount" | "createBlockId"
  >,
) {
  try {
    return materializeCanonicalBlockCreation(options);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "unable to allocate unique ids for block creation"
    ) {
      throw new Error(
        "unable to allocate a unique block id for table mutation",
      );
    }
    throw error;
  }
}

function requireChangedTableTransaction<
  Result extends
    | Omit<FirstDraftTableRowAppendResult, "transaction">
    | Omit<FirstDraftTableColumnAppendResult, "transaction">
    | Omit<FirstDraftTableColumnResizeResult, "transaction">,
>(
  transaction: ReturnType<EditableEditor["transaction"]>,
  result: Result,
): Result & {
  readonly transaction: Extract<
    ReturnType<EditableEditor["transaction"]>,
    { readonly ok: true; readonly changed: true }
  >;
} {
  if (!transaction.ok) {
    throw new Error(`table mutation was rejected: ${transaction.message}`);
  }
  if (!transaction.changed) {
    throw new Error("table mutation produced no document change");
  }
  return { ...result, transaction };
}
