import {
  createBlockRichTextContentFromPlainText,
  extractPlainTextFromRichTextDocument,
  isRichTextDocument,
  richTextDocumentContentSize,
} from "@repo/editor-core/content/rich-text";
import {
  createCanonicalBlockFragment,
  createCanonicalBlockRecord,
  type CanonicalBlockFragment,
  type CanonicalBlockRecord,
} from "@repo/editor-core/editing";
import type {
  BlockId,
  JsonObject,
  MutableJsonObject,
} from "@repo/editor-core/kernel";
import type { EditorContentCodecs } from "@repo/editor-web/document-runtime";
import {
  decodeTableRangeSelection,
  resolveTableRange,
  TABLE_INTERNAL_SELECTION_SUBSYSTEM_ID,
} from "./selection.ts";
import {
  createFirstDraftTableColumnIds,
  createFirstDraftTableMetadata,
  resolveFirstDraftTableColumnIds,
  TABLE_COLUMN_IDS_FIELD,
  TABLE_COLUMN_WIDTHS_FIELD,
} from "./model.ts";

const TABLE_TYPE = "table";
const ROW_TYPE = "tableRow";
const CELL_TYPE = "tableCell";

type MaterializeInput = Parameters<
  NonNullable<
    EditorContentCodecs["internalSelectionFragmentMaterializers"]
  >[number]["materialize"]
>[0];

export const firstDraftTableClipboardCodecs: EditorContentCodecs = {
  internalSelectionFragmentMaterializers: [
    {
      id: "first-draft.table-cell-range-fragment",
      subsystemId: TABLE_INTERNAL_SELECTION_SUBSYSTEM_ID,
      materialize: materializeFirstDraftTableCellRange,
    },
  ],
  internalSelectionCutHandlers: [
    {
      id: "first-draft.table-cell-range-cut",
      subsystemId: TABLE_INTERNAL_SELECTION_SUBSYSTEM_ID,
      cut({ hostBlockId, selection, editor }) {
        const decoded = decodeTableRangeSelection(selection);
        const range = decoded
          ? resolveTableRange(editor, hostBlockId, decoded)
          : null;
        if (!range || editor.getBlock(hostBlockId)?.type !== TABLE_TYPE)
          return { ok: false, changed: false };
        const cells = selectedCells(editor, hostBlockId, range);
        if (!cells) return { ok: false, changed: false };
        return editor.transaction(() => {
          for (const blockId of cells) {
            const block = editor.getBlock(blockId);
            if (!block || block.type !== CELL_TYPE) continue;
            const content = editor.readBlockContent(blockId, block.type);
            const length = content ? richTextDocumentContentSize(content) : 0;
            if (length)
              editor.deleteText({ blockId, range: { from: 0, to: length } });
          }
          editor.setTransactionSelection({ kind: "preserve" });
        });
      },
    },
  ],
  plainTextImportHandlers: [
    {
      id: "first-draft.table-tsv-import",
      importText(text, context) {
        const matrix = rectangularTsv(text);
        return matrix
          ? plainTextTableFragment(matrix, context.blockDefinitions)
          : null;
      },
    },
  ],
  plainTextExportHandlers: [
    {
      id: "first-draft.table-tsv-export",
      exportBlock(block, context) {
        if (block.type !== TABLE_TYPE) return null;
        const rows = context.childrenByParentId.get(block.id) ?? [];
        if (rows.some((row) => row.type !== ROW_TYPE)) return "";
        return rows
          .map((row) =>
            (context.childrenByParentId.get(row.id) ?? [])
              .map((cell) =>
                cell.type === CELL_TYPE ? (cell.plainText ?? "") : "",
              )
              .join("\t"),
          )
          .join("\n");
      },
    },
  ],
  htmlImportHandlers: [
    {
      id: "first-draft.semantic-table-import",
      elements: ["table"],
      parse: parseSemanticTable,
    },
  ],
  htmlExportHandlers: [
    {
      id: "first-draft.semantic-table-export",
      export(block, context) {
        if (block.type !== TABLE_TYPE) return null;
        const table = context.document.createElement("table");
        const body = context.document.createElement("tbody");
        body.append(context.exportChildren(block.id));
        table.append(body);
        return table;
      },
    },
    {
      id: "first-draft.semantic-table-row-export",
      export(block, context) {
        if (block.type !== ROW_TYPE) return null;
        const row = context.document.createElement("tr");
        row.append(context.exportChildren(block.id));
        return row;
      },
    },
    {
      id: "first-draft.semantic-table-cell-export",
      export(block, context) {
        if (block.type !== CELL_TYPE) return null;
        const cell = context.document.createElement("td");
        const richText = context.exportTextContent(block);
        const paragraph = richText?.firstElementChild;
        if (paragraph?.tagName.toLowerCase() === "p") {
          while (paragraph.firstChild) cell.append(paragraph.firstChild);
        } else if (richText) cell.append(richText);
        return cell;
      },
    },
  ],
};

export function materializeFirstDraftTableCellRange(
  input: MaterializeInput,
): CanonicalBlockFragment | null {
  const table = input.getBlock(input.hostBlockId);
  const decoded = decodeTableRangeSelection(input.selection);
  const range = decoded
    ? resolveTableRange(input, input.hostBlockId, decoded)
    : null;
  if (!table || table.type !== TABLE_TYPE || !range) return null;
  const sourceCells = selectedCells(input, input.hostBlockId, range);
  if (!sourceCells) return null;
  const firstSourceRowId = input.getChildBlockIds(input.hostBlockId)[0];
  if (!firstSourceRowId) return null;
  const sourceColumnCount = input.getChildBlockIds(firstSourceRowId).length;
  const rowCount = Math.abs(range.head.row - range.anchor.row) + 1;
  const startColumn = Math.min(range.anchor.column, range.head.column);
  const endColumn = Math.max(range.anchor.column, range.head.column);
  const columnCount = endColumn - startColumn + 1;
  const newColumnIds = createFirstDraftTableColumnIds(columnCount);
  const root = createCanonicalBlockRecord({
    type: TABLE_TYPE,
    metadata: selectedMetadata(
      table.metadata,
      startColumn,
      endColumn,
      newColumnIds,
      sourceColumnCount,
    ),
  });
  const records: CanonicalBlockRecord[] = [root];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const row = createCanonicalBlockRecord({
      type: ROW_TYPE,
      parentId: root.id,
    });
    records.push(row);
    for (let columnIndex = 0; columnIndex < columnCount; columnIndex += 1) {
      const sourceId = sourceCells[rowIndex * columnCount + columnIndex]!;
      const content = input.readBlockContent(sourceId, CELL_TYPE);
      if (!content || !isRichTextDocument(content)) return null;
      records.push(
        createCanonicalBlockRecord({
          type: CELL_TYPE,
          parentId: row.id,
          content,
          plainText: extractPlainTextFromRichTextDocument(content),
        }),
      );
    }
  }
  return finalize(records, root.id, input.blockDefinitions);
}

function selectedCells(
  graph: Pick<
    MaterializeInput,
    "getBlock" | "getChildBlockIds" | "getParentId"
  >,
  tableId: BlockId,
  range: NonNullable<ReturnType<typeof resolveTableRange>>,
): readonly BlockId[] | null {
  const rows = graph.getChildBlockIds(tableId);
  if (rows.length === 0) return null;
  const columnCount = graph.getChildBlockIds(rows[0]!).length;
  if (columnCount === 0) return null;
  for (const rowId of rows) {
    const cells = graph.getChildBlockIds(rowId);
    if (
      graph.getBlock(rowId)?.type !== ROW_TYPE ||
      graph.getParentId(rowId) !== tableId ||
      cells.length !== columnCount
    )
      return null;
    for (const cellId of cells) {
      if (
        graph.getBlock(cellId)?.type !== CELL_TYPE ||
        graph.getParentId(cellId) !== rowId ||
        graph.getChildBlockIds(cellId).length !== 0
      )
        return null;
    }
  }
  const rowStart = Math.min(range.anchor.row, range.head.row);
  const rowEnd = Math.max(range.anchor.row, range.head.row);
  const columnStart = Math.min(range.anchor.column, range.head.column);
  const columnEnd = Math.max(range.anchor.column, range.head.column);
  if (rowEnd >= rows.length || columnEnd >= columnCount) return null;
  return rows
    .slice(rowStart, rowEnd + 1)
    .flatMap((rowId) =>
      graph.getChildBlockIds(rowId).slice(columnStart, columnEnd + 1),
    );
}

function selectedMetadata(
  source: Readonly<Record<string, unknown>> | undefined,
  start: number,
  end: number,
  newIds: readonly string[],
  sourceColumnCount: number,
): JsonObject {
  const canonicalMetadata = createFirstDraftTableMetadata(newIds);
  const result = Object.fromEntries(
    Object.entries(source ?? {}).filter(
      ([key]) =>
        key !== TABLE_COLUMN_IDS_FIELD && key !== TABLE_COLUMN_WIDTHS_FIELD,
    ),
  ) as MutableJsonObject;
  Object.assign(result, canonicalMetadata);
  const sourceResolution = resolveFirstDraftTableColumnIds(
    source,
    sourceColumnCount,
  );
  const sourceIds = sourceResolution.ids;
  const sourceWidths = source?.[TABLE_COLUMN_WIDTHS_FIELD];
  if (
    sourceWidths &&
    typeof sourceWidths === "object" &&
    !Array.isArray(sourceWidths)
  ) {
    const widths = sourceWidths as Record<string, unknown>;
    const retained = Object.fromEntries(
      sourceIds.slice(start, end + 1).flatMap((id, index) => {
        const width = widths[id];
        return typeof width === "number" && Number.isFinite(width) && width > 0
          ? [[newIds[index]!, width]]
          : [];
      }),
    );
    if (Object.keys(retained).length > 0) {
      result[TABLE_COLUMN_WIDTHS_FIELD] = retained;
    }
  }
  return result;
}

function rectangularTsv(text: string): readonly (readonly string[])[] | null {
  const normalized = text.replace(/\r\n?/gu, "\n");
  if (!normalized.includes("\t")) return null;
  const rows = normalized.split("\n");
  if (rows.at(-1) === "") rows.pop();
  const matrix = rows.map((row) => row.split("\t"));
  const columns = matrix[0]?.length ?? 0;
  return columns > 1 && matrix.every((row) => row.length === columns)
    ? matrix
    : null;
}

function plainTextTableFragment(
  matrix: readonly (readonly string[])[],
  definitions: MaterializeInput["blockDefinitions"],
): CanonicalBlockFragment | null {
  const columns = createFirstDraftTableColumnIds(matrix[0]!.length);
  const root = createCanonicalBlockRecord({
    type: TABLE_TYPE,
    metadata: createFirstDraftTableMetadata(columns),
  });
  const records: CanonicalBlockRecord[] = [root];
  for (const values of matrix) {
    const row = createCanonicalBlockRecord({
      type: ROW_TYPE,
      parentId: root.id,
    });
    records.push(row);
    for (const value of values) {
      records.push(
        createCanonicalBlockRecord({
          type: CELL_TYPE,
          parentId: row.id,
          content: createBlockRichTextContentFromPlainText(CELL_TYPE, value),
          plainText: value,
        }),
      );
    }
  }
  return finalize(records, root.id, definitions);
}

function parseSemanticTable(
  node: HTMLElement,
  context: Parameters<
    NonNullable<EditorContentCodecs["htmlImportHandlers"]>[number]["parse"]
  >[1],
): CanonicalBlockFragment | null {
  if (node.tagName.toLowerCase() !== "table") return null;
  const children = Array.from(node.children);
  if (children.length !== 1 || children[0]!.tagName.toLowerCase() !== "tbody")
    return null;
  const sourceRows = Array.from(children[0]!.children);
  if (sourceRows.length === 0) return null;
  const parsedRows: CanonicalBlockRecord[][] = [];
  let columns: number | null = null;
  for (const sourceRow of sourceRows) {
    const cells = Array.from(sourceRow.children);
    if (
      sourceRow.tagName.toLowerCase() !== "tr" ||
      cells.length === 0 ||
      cells.some((cell) => cell.tagName.toLowerCase() !== "td") ||
      (columns !== null && cells.length !== columns)
    )
      return null;
    columns = cells.length;
    const parsed: CanonicalBlockRecord[] = [];
    for (const cell of cells) {
      const fragment = context.parseTextBlock(cell as HTMLElement, CELL_TYPE);
      if (
        !fragment ||
        fragment.blocks.length !== 1 ||
        fragment.rootBlockIds.length !== 1
      )
        return null;
      const record = fragment.blocks[0]!;
      if (record.type !== CELL_TYPE || !record.content) return null;
      parsed.push(record);
    }
    parsedRows.push(parsed);
  }
  const root = createCanonicalBlockRecord({
    type: TABLE_TYPE,
    metadata: createFirstDraftTableMetadata(
      createFirstDraftTableColumnIds(columns!),
    ),
  });
  const records: CanonicalBlockRecord[] = [root];
  for (const parsedCells of parsedRows) {
    const row = createCanonicalBlockRecord({
      type: ROW_TYPE,
      parentId: root.id,
    });
    records.push(row);
    for (const parsed of parsedCells) {
      records.push(
        createCanonicalBlockRecord({
          type: CELL_TYPE,
          parentId: row.id,
          content: parsed.content,
          plainText: parsed.plainText ?? "",
        }),
      );
    }
  }
  return finalize(records, root.id, context.blockDefinitions);
}

function finalize(
  records: readonly CanonicalBlockRecord[],
  rootId: BlockId,
  definitions: MaterializeInput["blockDefinitions"],
): CanonicalBlockFragment | null {
  try {
    return createCanonicalBlockFragment({
      blocks: records,
      rootBlockIds: [rootId],
      start: { kind: "block", blockId: rootId },
      end: { kind: "block", blockId: rootId },
      blockDefinitions: definitions,
    });
  } catch {
    return null;
  }
}
