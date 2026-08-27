import {
  createCanonicalBlockFragment,
  createCanonicalBlockRecord,
  materializeCanonicalBlockCreation,
  type CanonicalBlockFragment,
} from "@repo/editor-core/editing";
import { extractPlainTextFromRichTextDocument } from "@repo/editor-core/content/rich-text";
import type { BlockId, JsonObject } from "@repo/editor-core/kernel";
import type { EditableEditor } from "@repo/editor-web/editor";
import { createFirstDraftBlockIdAllocator } from "../../identity/block-id-allocator.ts";
import {
  createFirstDraftTableColumnId,
  normalizeFirstDraftTableColumns,
  resolveFirstDraftTableColumnIds,
  TABLE_COLUMN_IDS_FIELD,
  TABLE_COLUMN_WIDTHS_FIELD,
} from "./model.ts";

export interface FirstDraftTableIdentitySources {
  readonly createBlockId?: () => BlockId;
  readonly createColumnId?: () => string;
}

export type FirstDraftTableColumnMutationTarget =
  | {
      readonly kind: "canonical";
      readonly columnId: string;
    }
  | {
      readonly kind: "synthetic-presentation";
      readonly presentationId: string;
      readonly indexAtOpen: number;
      readonly columnCountAtOpen: number;
    };

type ChangedTableTransaction = Extract<
  ReturnType<EditableEditor["transaction"]>,
  { readonly ok: true; readonly changed: true }
>;

export interface FirstDraftTableRowInsertionResult {
  readonly rowId: BlockId;
  readonly cellIds: readonly BlockId[];
  readonly rowIndex: number;
  readonly transaction: ChangedTableTransaction;
}

export interface FirstDraftTableRowDeletionResult {
  readonly rowId: BlockId;
  readonly rowIndex: number;
  readonly transaction: ChangedTableTransaction;
}

export interface FirstDraftTableRowDuplicationResult {
  readonly sourceRowId: BlockId;
  readonly rowId: BlockId;
  readonly cellIds: readonly BlockId[];
  readonly rowIndex: number;
  readonly transaction: ChangedTableTransaction;
}

export type FirstDraftTableRowMoveResult =
  | {
      readonly kind: "moved";
      readonly rowId: BlockId;
      readonly rowIndex: number;
      readonly transaction: ChangedTableTransaction;
    }
  | { readonly kind: "no-op"; readonly rowId: BlockId; readonly rowIndex: number };

export type FirstDraftTableColumnMoveResult =
  | {
      readonly kind: "moved";
      readonly columnId: string;
      readonly columnIndex: number;
      readonly cellIds: readonly BlockId[];
      readonly expectedColumnIds: readonly string[];
      readonly expectedCellIdsByRow: readonly (readonly BlockId[])[];
      readonly transaction: ChangedTableTransaction;
    }
  | {
      readonly kind: "no-op";
      readonly columnIndex: number;
      readonly cellIds: readonly BlockId[];
    };

export interface FirstDraftTableColumnInsertionResult {
  readonly columnId: string;
  readonly cellIds: readonly BlockId[];
  readonly columnIndex: number;
  readonly transaction: ChangedTableTransaction;
}

export interface FirstDraftTableColumnDeletionResult {
  readonly columnId: string;
  readonly cellIds: readonly BlockId[];
  readonly columnIndex: number;
  readonly transaction: ChangedTableTransaction;
}

export interface FirstDraftTableColumnDuplicationResult {
  readonly sourceColumnId: string;
  readonly columnId: string;
  readonly cellIds: readonly BlockId[];
  readonly columnIndex: number;
  readonly transaction: ChangedTableTransaction;
}

export interface FirstDraftTableColumnResizeResult {
  readonly columnId: string;
  readonly width: number;
  readonly transaction: ChangedTableTransaction;
}

export interface FirstDraftTableMutationStructure {
  readonly table: NonNullable<ReturnType<EditableEditor["getBlock"]>>;
  readonly rowIds: readonly BlockId[];
  readonly cellIdsByRow: readonly (readonly BlockId[])[];
  readonly columnCount: number;
  readonly presentationColumnIds: readonly string[];
  readonly columnIdentityKind: "canonical" | "synthetic-presentation";
}

export function insertFirstDraftTableRow(
  editor: EditableEditor,
  tableId: BlockId,
  rowIndex: number,
  identitySources: FirstDraftTableIdentitySources = {},
): FirstDraftTableRowInsertionResult {
  const structure = readFirstDraftTableMutationStructure(editor, tableId);
  assertInsertionIndex(rowIndex, structure.rowIds.length, "row");
  const normalized = normalizeColumns(structure, identitySources);
  const creation = materializeEmptyRow(
    editor,
    structure.columnCount,
    identitySources,
  );
  const transaction = editor.transaction(() => {
    editor.insertBlocks(
      { parentId: tableId, childIndex: rowIndex },
      creation.fragment,
    );
    normalizeTableMetadataIfNeeded(editor, tableId, structure, normalized);
    editor.setTransactionSelection({ kind: "clear" });
  });
  return requireChangedTableTransaction(transaction, {
    rowId: creation.rowId,
    cellIds: creation.cellIds,
    rowIndex,
  });
}

export function deleteFirstDraftTableRow(
  editor: EditableEditor,
  tableId: BlockId,
  rowId: BlockId,
  identitySources: Pick<FirstDraftTableIdentitySources, "createColumnId"> = {},
): FirstDraftTableRowDeletionResult {
  const structure = readFirstDraftTableMutationStructure(editor, tableId);
  const rowIndex = resolveRowIndex(structure, rowId);
  if (structure.rowIds.length === 1) {
    throw new Error("cannot delete the final table row");
  }
  const normalized = normalizeColumns(structure, identitySources);
  const transaction = editor.transaction(() => {
    editor.deleteBlocks({
      blockIds: [rowId],
      includeDescendants: true,
      expectedParents: { [rowId]: tableId },
    });
    normalizeTableMetadataIfNeeded(editor, tableId, structure, normalized);
    editor.setTransactionSelection({ kind: "clear" });
  });
  return requireChangedTableTransaction(transaction, {
    rowId,
    rowIndex,
  });
}

export function duplicateFirstDraftTableRow(
  editor: EditableEditor,
  tableId: BlockId,
  rowId: BlockId,
  identitySources: FirstDraftTableIdentitySources = {},
): FirstDraftTableRowDuplicationResult {
  const structure = readFirstDraftTableMutationStructure(editor, tableId);
  const sourceRowIndex = resolveRowIndex(structure, rowId);
  const normalized = normalizeColumns(structure, identitySources);
  const duplicate = materializeDuplicatedRow(
    editor,
    structure,
    sourceRowIndex,
    identitySources,
  );
  const rowIndex = sourceRowIndex + 1;
  const transaction = editor.transaction(() => {
    editor.insertBlocks(
      { parentId: tableId, childIndex: rowIndex },
      duplicate.fragment,
    );
    normalizeTableMetadataIfNeeded(editor, tableId, structure, normalized);
    editor.setTransactionSelection({ kind: "clear" });
  });
  return requireChangedTableTransaction(transaction, {
    sourceRowId: rowId,
    rowId: duplicate.rowId,
    cellIds: duplicate.cellIds,
    rowIndex,
  });
}

export function moveFirstDraftTableRow(
  editor: EditableEditor,
  tableId: BlockId,
  rowId: BlockId,
  finalRowIds: readonly BlockId[],
): FirstDraftTableRowMoveResult {
  const structure = readFirstDraftTableMutationStructure(editor, tableId);
  resolveRowIndex(structure, rowId);
  if (!isExactBlockIdPermutation(structure.rowIds, finalRowIds)) {
    throw new Error("cannot move a table row to a stale or invalid order");
  }
  const rowIndex = finalRowIds.indexOf(rowId);
  if (sameBlockIdOrder(structure.rowIds, finalRowIds)) {
    return { kind: "no-op", rowId, rowIndex };
  }
  const transaction = editor.transaction(() => {
    editor.moveBlocks({
      blockIds: [rowId],
      destination: { parentId: tableId, childIndex: rowIndex },
    });
    editor.setTransactionSelection({ kind: "preserve" });
  });
  return requireChangedTableTransaction(transaction, {
    kind: "moved" as const,
    rowId,
    rowIndex,
  });
}

export function insertFirstDraftTableColumn(
  editor: EditableEditor,
  tableId: BlockId,
  columnIndex: number,
  identitySources: FirstDraftTableIdentitySources = {},
): FirstDraftTableColumnInsertionResult {
  const structure = readFirstDraftTableMutationStructure(editor, tableId);
  assertInsertionIndex(columnIndex, structure.columnCount, "column");
  const normalized = normalizeColumns(structure, identitySources);
  const columnId = createFirstDraftTableColumnId(
    normalized.columnIds,
    identitySources.createColumnId,
  );
  const cells = materializeEmptyColumn(editor, structure, identitySources);
  const cellIds = cells.map(({ cellId }) => cellId);
  const transaction = editor.transaction(() => {
    for (const cell of cells) {
      editor.insertBlocks(
        { parentId: cell.rowId, childIndex: columnIndex },
        cell.fragment,
      );
    }
    updateTableColumns(editor, tableId, {
      columnIds: insertAt(normalized.columnIds, columnIndex, columnId),
      columnWidths: normalized.columnWidths,
    });
    editor.setTransactionSelection({ kind: "clear" });
  });
  return requireChangedTableTransaction(transaction, {
    columnId,
    cellIds,
    columnIndex,
  });
}

export function moveFirstDraftTableColumn(
  editor: EditableEditor,
  tableId: BlockId,
  source: FirstDraftTableColumnMutationTarget,
  finalTargets: readonly FirstDraftTableColumnMutationTarget[],
  identitySources: Pick<FirstDraftTableIdentitySources, "createColumnId"> = {},
): FirstDraftTableColumnMoveResult {
  const structure = readFirstDraftTableMutationStructure(editor, tableId);
  const sourceIndex = resolveFirstDraftTableColumnTargetIndex(
    structure,
    source,
  );
  if (finalTargets.length !== structure.columnCount) {
    throw new Error("cannot move a table column to a stale or invalid order");
  }
  const finalIndexes = finalTargets.map((target) =>
    resolveFirstDraftTableColumnTargetIndex(structure, target),
  );
  if (
    new Set(finalIndexes).size !== structure.columnCount ||
    finalIndexes.some((index) => index < 0 || index >= structure.columnCount)
  ) {
    throw new Error("cannot move a table column to a stale or invalid order");
  }
  const columnIndex = finalIndexes.indexOf(sourceIndex);
  const expectedMoveIndexes = moveOneIndex(
    structure.columnCount,
    sourceIndex,
    columnIndex,
  );
  if (!sameNumberOrder(finalIndexes, expectedMoveIndexes)) {
    throw new Error("cannot move more than one table column at a time");
  }
  const cellIds = structure.cellIdsByRow.map((row) => row[sourceIndex]!);
  if (sameNumberOrder(finalIndexes, identityIndexes(structure.columnCount))) {
    return { kind: "no-op", columnIndex, cellIds };
  }

  // Identity allocation and malformed-width recovery are prepared before the
  // transaction, then committed together with every existing-cell move.
  const normalized = normalizeColumns(structure, identitySources);
  const expectedColumnIds = finalIndexes.map(
    (index) => normalized.columnIds[index]!,
  );
  const expectedCellIdsByRow = structure.cellIdsByRow.map((row) =>
    finalIndexes.map((index) => row[index]!),
  );
  const columnId = normalized.columnIds[sourceIndex]!;
  const transaction = editor.transaction(() => {
    structure.rowIds.forEach((rowId, rowIndex) => {
      editor.moveBlocks({
        blockIds: [structure.cellIdsByRow[rowIndex]![sourceIndex]!],
        destination: { parentId: rowId, childIndex: columnIndex },
      });
    });
    updateTableColumns(editor, tableId, {
      columnIds: expectedColumnIds,
      columnWidths: normalized.columnWidths,
    });
    editor.setTransactionSelection({ kind: "preserve" });
  });
  return requireChangedTableTransaction(transaction, {
    kind: "moved" as const,
    columnId,
    columnIndex,
    cellIds,
    expectedColumnIds,
    expectedCellIdsByRow,
  });
}

export function deleteFirstDraftTableColumn(
  editor: EditableEditor,
  tableId: BlockId,
  target: FirstDraftTableColumnMutationTarget,
  identitySources: Pick<FirstDraftTableIdentitySources, "createColumnId"> = {},
): FirstDraftTableColumnDeletionResult {
  const structure = readFirstDraftTableMutationStructure(editor, tableId);
  const columnIndex = resolveFirstDraftTableColumnTargetIndex(
    structure,
    target,
  );
  if (structure.columnCount === 1) {
    throw new Error("cannot delete the final table column");
  }
  const normalized = normalizeColumns(structure, identitySources);
  const canonicalColumnId = normalized.columnIds[columnIndex]!;
  const cellIds = structure.cellIdsByRow.map((row) => row[columnIndex]!);
  const columnWidths = { ...normalized.columnWidths };
  delete columnWidths[canonicalColumnId];
  const expectedParents = Object.fromEntries(
    cellIds.map((cellId, rowIndex) => [cellId, structure.rowIds[rowIndex]!]),
  ) as Partial<Record<BlockId, BlockId>>;
  const transaction = editor.transaction(() => {
    editor.deleteBlocks({
      blockIds: cellIds,
      includeDescendants: true,
      expectedParents,
    });
    updateTableColumns(editor, tableId, {
      columnIds: normalized.columnIds.filter(
        (_, index) => index !== columnIndex,
      ),
      columnWidths,
    });
    editor.setTransactionSelection({ kind: "clear" });
  });
  return requireChangedTableTransaction(transaction, {
    columnId: canonicalColumnId,
    cellIds,
    columnIndex,
  });
}

export function duplicateFirstDraftTableColumn(
  editor: EditableEditor,
  tableId: BlockId,
  target: FirstDraftTableColumnMutationTarget,
  identitySources: FirstDraftTableIdentitySources = {},
): FirstDraftTableColumnDuplicationResult {
  const structure = readFirstDraftTableMutationStructure(editor, tableId);
  const sourceColumnIndex = resolveFirstDraftTableColumnTargetIndex(
    structure,
    target,
  );
  const normalized = normalizeColumns(structure, identitySources);
  const sourceColumnId = normalized.columnIds[sourceColumnIndex]!;
  const duplicateColumnId = createFirstDraftTableColumnId(
    normalized.columnIds,
    identitySources.createColumnId,
  );
  const cells = materializeDuplicatedColumn(
    editor,
    structure,
    sourceColumnIndex,
    identitySources,
  );
  const cellIds = cells.map(({ cellId }) => cellId);
  const columnIndex = sourceColumnIndex + 1;
  const columnWidths = { ...normalized.columnWidths };
  if (Object.prototype.hasOwnProperty.call(columnWidths, sourceColumnId)) {
    columnWidths[duplicateColumnId] = columnWidths[sourceColumnId]!;
  }
  const transaction = editor.transaction(() => {
    for (const cell of cells) {
      editor.insertBlocks(
        { parentId: cell.rowId, childIndex: columnIndex },
        cell.fragment,
      );
    }
    updateTableColumns(editor, tableId, {
      columnIds: insertAt(normalized.columnIds, columnIndex, duplicateColumnId),
      columnWidths,
    });
    editor.setTransactionSelection({ kind: "clear" });
  });
  return requireChangedTableTransaction(transaction, {
    sourceColumnId,
    columnId: duplicateColumnId,
    cellIds,
    columnIndex,
  });
}

export function resizeFirstDraftTableColumn(
  editor: EditableEditor,
  tableId: BlockId,
  columnIndex: number,
  width: number,
  identitySources: Pick<FirstDraftTableIdentitySources, "createColumnId"> = {},
): FirstDraftTableColumnResizeResult {
  const structure = readFirstDraftTableMutationStructure(editor, tableId);
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
  const normalized = normalizeColumns(structure, identitySources);
  const columnId = normalized.columnIds[columnIndex]!;
  const roundedWidth = Math.round(width);
  const transaction = editor.transaction(() => {
    updateTableColumns(editor, tableId, {
      columnIds: normalized.columnIds,
      columnWidths: {
        ...normalized.columnWidths,
        [columnId]: roundedWidth,
      },
    });
    editor.setTransactionSelection({ kind: "preserve" });
  });
  return requireChangedTableTransaction(transaction, {
    columnId,
    width: roundedWidth,
  });
}

export function readFirstDraftTableMutationStructure(
  editor: EditableEditor,
  tableId: BlockId,
): FirstDraftTableMutationStructure {
  const table = editor.getBlock(tableId);
  if (!table || table.tombstone || table.type !== "table") {
    throw new Error("cannot mutate a missing or invalid table");
  }
  const rowIds = editor.getChildBlockIds(tableId);
  if (rowIds.length === 0) {
    throw new Error("cannot mutate a table without rows");
  }
  const cellIdsByRow: BlockId[][] = [];
  let columnCount: number | null = null;
  for (const rowId of rowIds) {
    const row = editor.getBlock(rowId);
    if (
      !row ||
      row.tombstone ||
      row.type !== "tableRow" ||
      row.parentId !== tableId ||
      editor.getParentId(rowId) !== tableId
    ) {
      throw new Error("cannot mutate an invalid table row");
    }
    const cellIds = [...editor.getChildBlockIds(rowId)];
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
        cell.parentId !== rowId ||
        editor.getParentId(cellId) !== rowId
      ) {
        throw new Error("cannot mutate an invalid table cell");
      }
      if (!editor.readBlockContent(cellId, "tableCell")) {
        throw new Error("cannot mutate a table cell without canonical content");
      }
    }
    cellIdsByRow.push(cellIds);
  }
  const resolution = resolveFirstDraftTableColumnIds(
    table.metadata,
    columnCount!,
  );
  return {
    table,
    rowIds: [...rowIds],
    cellIdsByRow,
    columnCount: columnCount!,
    presentationColumnIds: resolution.ids,
    columnIdentityKind: resolution.kind,
  };
}

export function resolveFirstDraftTableColumnTargetIndex(
  structure: FirstDraftTableMutationStructure,
  target: FirstDraftTableColumnMutationTarget,
): number {
  if (target.kind === "canonical") {
    if (structure.columnIdentityKind !== "canonical") {
      throw new Error("cannot mutate a stale canonical table column");
    }
    const index = structure.presentationColumnIds.indexOf(target.columnId);
    if (index < 0) throw new Error("cannot mutate a missing table column");
    return index;
  }
  if (structure.columnIdentityKind !== "synthetic-presentation") {
    throw new Error("cannot mutate a stale synthetic table column");
  }
  if (target.columnCountAtOpen !== structure.columnCount) {
    throw new Error("cannot mutate a stale synthetic table shape");
  }
  if (
    !Number.isInteger(target.indexAtOpen) ||
    target.indexAtOpen < 0 ||
    target.indexAtOpen >= structure.columnCount ||
    structure.presentationColumnIds[target.indexAtOpen] !==
      target.presentationId
  ) {
    throw new Error("cannot mutate a stale synthetic table column");
  }
  return target.indexAtOpen;
}

function resolveRowIndex(
  structure: FirstDraftTableMutationStructure,
  rowId: BlockId,
): number {
  const rowIndex = structure.rowIds.indexOf(rowId);
  if (rowIndex < 0) throw new Error("cannot mutate a missing table row");
  return rowIndex;
}

function normalizeColumns(
  structure: FirstDraftTableMutationStructure,
  identitySources: Pick<FirstDraftTableIdentitySources, "createColumnId">,
) {
  return normalizeFirstDraftTableColumns(
    structure.table.metadata,
    structure.columnCount,
    identitySources.createColumnId,
  );
}

function normalizeTableMetadataIfNeeded(
  editor: EditableEditor,
  tableId: BlockId,
  structure: FirstDraftTableMutationStructure,
  normalized: ReturnType<typeof normalizeFirstDraftTableColumns>,
): void {
  if (structure.columnIdentityKind === "canonical") return;
  updateTableColumns(editor, tableId, normalized);
}

function updateTableColumns(
  editor: EditableEditor,
  tableId: BlockId,
  columns: {
    readonly columnIds: readonly string[];
    readonly columnWidths: Readonly<Record<string, number>>;
  },
): void {
  editor.updateBlockMetadata(
    [
      {
        blockId: tableId,
        values: {
          [TABLE_COLUMN_IDS_FIELD]: [...columns.columnIds],
          [TABLE_COLUMN_WIDTHS_FIELD]: { ...columns.columnWidths },
        },
      },
    ],
    { editorSuggestion: null },
  );
}

function materializeEmptyRow(
  editor: EditableEditor,
  columnCount: number,
  identitySources: Pick<FirstDraftTableIdentitySources, "createBlockId">,
) {
  const allocateBlockId = createTableBlockIdAllocator(editor, identitySources);
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
  if (
    cellIds.length !== columnCount ||
    creation.selectionBlockId !== cellIds[0]
  ) {
    throw new Error("canonical table row creation produced an invalid row");
  }
  return {
    fragment: creation.fragment,
    rowId: creation.rootBlockId,
    cellIds,
  };
}

function materializeEmptyColumn(
  editor: EditableEditor,
  structure: FirstDraftTableMutationStructure,
  identitySources: Pick<FirstDraftTableIdentitySources, "createBlockId">,
) {
  const allocateBlockId = createTableBlockIdAllocator(editor, identitySources);
  return structure.rowIds.map((rowId) => {
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
    return {
      rowId,
      cellId: creation.rootBlockId,
      fragment: creation.fragment,
    };
  });
}

function materializeDuplicatedRow(
  editor: EditableEditor,
  structure: FirstDraftTableMutationStructure,
  sourceRowIndex: number,
  identitySources: Pick<FirstDraftTableIdentitySources, "createBlockId">,
): {
  readonly fragment: CanonicalBlockFragment;
  readonly rowId: BlockId;
  readonly cellIds: readonly BlockId[];
} {
  const sourceRowId = structure.rowIds[sourceRowIndex]!;
  const sourceRow = editor.getBlock(sourceRowId)!;
  const allocateBlockId = createTableBlockIdAllocator(editor, identitySources);
  const rowId = allocateBlockId();
  const cellIds = structure.cellIdsByRow[sourceRowIndex]!.map(() =>
    allocateBlockId(),
  );
  const row = createCanonicalBlockRecord({
    id: rowId,
    type: sourceRow.type,
    metadata: sourceRow.metadata as JsonObject | undefined,
  });
  const cells = structure.cellIdsByRow[sourceRowIndex]!.map(
    (sourceCellId, index) =>
      duplicateCellRecord(editor, sourceCellId, cellIds[index]!, rowId),
  );
  return {
    rowId,
    cellIds,
    fragment: createCanonicalBlockFragment({
      blocks: [row, ...cells],
      rootBlockIds: [rowId],
      start: { kind: "block", blockId: rowId },
      end: { kind: "block", blockId: rowId },
      blockDefinitions: editor.definition.blocks,
    }),
  };
}

function materializeDuplicatedColumn(
  editor: EditableEditor,
  structure: FirstDraftTableMutationStructure,
  sourceColumnIndex: number,
  identitySources: Pick<FirstDraftTableIdentitySources, "createBlockId">,
) {
  const allocateBlockId = createTableBlockIdAllocator(editor, identitySources);
  return structure.rowIds.map((rowId, rowIndex) => {
    const sourceCellId = structure.cellIdsByRow[rowIndex]![sourceColumnIndex]!;
    const cellId = allocateBlockId();
    const record = duplicateCellRecord(editor, sourceCellId, cellId, null);
    return {
      rowId,
      cellId,
      fragment: createCanonicalBlockFragment({
        blocks: [record],
        rootBlockIds: [cellId],
        start: { kind: "text", blockId: cellId },
        end: { kind: "text", blockId: cellId },
        blockDefinitions: editor.definition.blocks,
      }),
    };
  });
}

function duplicateCellRecord(
  editor: EditableEditor,
  sourceCellId: BlockId,
  cellId: BlockId,
  parentId: BlockId | null,
) {
  const sourceCell = editor.getBlock(sourceCellId);
  const content = editor.readBlockContent(sourceCellId, "tableCell");
  if (!sourceCell || !content) {
    throw new Error("cannot duplicate a missing table cell");
  }
  return createCanonicalBlockRecord({
    id: cellId,
    type: sourceCell.type,
    parentId,
    metadata: sourceCell.metadata as JsonObject | undefined,
    content,
    plainText: extractPlainTextFromRichTextDocument(content),
  });
}

function createTableBlockIdAllocator(
  editor: EditableEditor,
  identitySources: Pick<FirstDraftTableIdentitySources, "createBlockId">,
) {
  return createFirstDraftBlockIdAllocator(editor, {
    createId: identitySources.createBlockId,
    purpose: "table mutation",
  });
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

function assertInsertionIndex(
  index: number,
  length: number,
  axis: "row" | "column",
): void {
  if (!Number.isInteger(index) || index < 0 || index > length) {
    throw new Error(`cannot insert at an invalid table ${axis} index`);
  }
}

function insertAt<Value>(
  values: readonly Value[],
  index: number,
  value: Value,
): readonly Value[] {
  return [...values.slice(0, index), value, ...values.slice(index)];
}

function identityIndexes(length: number): readonly number[] {
  return Array.from({ length }, (_, index) => index);
}

function moveOneIndex(
  length: number,
  sourceIndex: number,
  destinationIndex: number,
): readonly number[] {
  const indexes = identityIndexes(length).filter(
    (index) => index !== sourceIndex,
  );
  indexes.splice(destinationIndex, 0, sourceIndex);
  return indexes;
}

function sameNumberOrder(
  left: readonly number[],
  right: readonly number[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function isExactBlockIdPermutation(
  canonical: readonly BlockId[],
  candidate: readonly BlockId[],
): boolean {
  if (canonical.length !== candidate.length) return false;
  const canonicalIds = new Set(canonical);
  const candidateIds = new Set(candidate);
  return (
    canonicalIds.size === canonical.length &&
    candidateIds.size === candidate.length &&
    candidate.every((blockId) => canonicalIds.has(blockId))
  );
}

function sameBlockIdOrder(
  left: readonly BlockId[],
  right: readonly BlockId[],
): boolean {
  return (
    left.length === right.length &&
    left.every((blockId, index) => blockId === right[index])
  );
}

function requireChangedTableTransaction<Result>(
  transaction: ReturnType<EditableEditor["transaction"]>,
  result: Result,
): Result & { readonly transaction: ChangedTableTransaction } {
  if (!transaction.ok) {
    throw new Error(`table mutation was rejected: ${transaction.message}`);
  }
  if (!transaction.changed) {
    throw new Error("table mutation produced no document change");
  }
  return { ...result, transaction };
}
