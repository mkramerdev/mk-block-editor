import { materializeCanonicalBlockCreation } from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditableEditor } from "@repo/editor-web/editor";
import { createFirstDraftBlockIdAllocator } from "../../identity/block-id-allocator.ts";
import {
  createFirstDraftTableColumnId,
  TABLE_COLUMN_IDS_FIELD,
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
  columnIds: readonly string[],
  identitySources: TableIdentitySources = {},
): FirstDraftTableColumnAppendResult {
  const rowIds = editor.getChildBlockIds(tableId);
  if (rowIds.length === 0) {
    throw new Error("cannot append a column to a table without rows");
  }
  for (const rowId of rowIds) {
    if (editor.getChildBlockIds(rowId).length !== columnIds.length) {
      throw new Error("cannot append a column to a non-rectangular table");
    }
  }

  const allocateBlockId = createFirstDraftBlockIdAllocator(editor, {
    createId: identitySources.createBlockId,
    purpose: "table mutation",
  });
  const cells = rowIds.map((rowId) => {
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
    | Omit<FirstDraftTableColumnAppendResult, "transaction">,
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
