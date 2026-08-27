import { describe, expect, it, vi } from "vitest";
import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import type { VersionedBlock } from "@repo/editor-core/document";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import {
  TABLE_COLUMN_WIDTHS_FIELD,
} from "../blocks/table/model.ts";
import {
  captureFirstDraftTableColumnDragPreview,
  captureFirstDraftTableRowDragPreview,
  readFirstDraftTableDragStructure,
} from "./preview-snapshot.ts";
import { createFirstDraftTableColumnDragItems } from "./contracts.ts";

const id = asBlockId;

function block(
  value: string,
  type: string,
  parentId: string | null,
  metadata?: VersionedBlock["metadata"],
): VersionedBlock {
  return {
    id: id(value),
    type,
    parentId: parentId === null ? null : id(parentId),
    tombstone: null,
    metadata,
    metadataVersion: `metadata:${value}`,
    contentVersion: null,
  };
}

function richText(value: string): RichTextDocumentNodeJson {
  return {
    type: "doc",
    content: [{
      type: "paragraph",
      content: [
        { type: "text", text: value, marks: [{ type: "strong" }] },
        { type: "hard_break" },
        { type: "mention", metadata: { id: `${value}-mention` } },
        {
          type: "text",
          text: " link",
          marks: [{ type: "link", attrs: { href: "https://example.com" } }],
        },
      ],
    }],
  } as RichTextDocumentNodeJson;
}

class TableGraph {
  readonly getBlock = vi.fn((blockId: BlockId) => this.blocks.get(blockId) ?? null);
  readonly getParentId = vi.fn((blockId: BlockId) => this.blocks.get(blockId)?.parentId ?? null);
  readonly getChildBlockIds = vi.fn((parentId: BlockId) => this.children.get(parentId) ?? []);
  readonly readBlockContent = vi.fn((blockId: BlockId) => this.content.get(blockId) ?? null);

  constructor(
    readonly blocks: Map<BlockId, VersionedBlock>,
    readonly children: Map<BlockId, readonly BlockId[]>,
    readonly content: Map<BlockId, RichTextDocumentNodeJson>,
  ) {}
}

function fixture(rowCount = 3, columnCount = 3) {
  const tableId = id("table");
  const columnIds = Array.from({ length: columnCount }, (_, index) => `column-${index}`);
  const rows = Array.from({ length: rowCount }, (_, index) => id(`row-${index}`));
  const cells = rows.map((_, rowIndex) =>
    Array.from({ length: columnCount }, (_, columnIndex) =>
      id(`cell-${rowIndex}-${columnIndex}`),
    ),
  );
  const records: VersionedBlock[] = [
    block("table", "table", null, {
      columnIds,
      [TABLE_COLUMN_WIDTHS_FIELD]: Object.fromEntries(
        columnIds.map((columnId, index) => [columnId, 180 + index * 20]),
      ),
    }),
    ...rows.map((rowId) => block(rowId, "tableRow", "table")),
    ...cells.flatMap((row, rowIndex) =>
      row.map((cellId) => block(cellId, "tableCell", rows[rowIndex]!)),
    ),
  ];
  const content = new Map<BlockId, RichTextDocumentNodeJson>(
    cells.flat().map((cellId) => [cellId, richText(cellId)]),
  );
  const graph = new TableGraph(
    new Map(records.map((record) => [record.id, record])),
    new Map([
      [tableId, rows],
      ...rows.map((rowId, rowIndex) => [rowId, cells[rowIndex]!] as const),
    ]),
    content,
  );
  return { graph, tableId, rows, cells, columnIds, content };
}

describe("table drag visual snapshot", () => {
  it("captures only the source row's ordered rich cells and freezes every value", () => {
    const current = fixture();
    const structure = readFirstDraftTableDragStructure(current.graph, current.tableId);
    current.graph.readBlockContent.mockClear();

    const preview = captureFirstDraftTableRowDragPreview(
      current.graph,
      current.tableId,
      current.rows[1]!,
      structure,
    );

    expect(preview?.cells.map((cell) => cell.block.id)).toEqual(current.cells[1]);
    expect(preview?.tracks).toBe("180px 200px 220px");
    expect(current.graph.readBlockContent).toHaveBeenCalledTimes(3);
    expect(current.graph.readBlockContent.mock.calls.map(([cellId]) => cellId)).toEqual(
      current.cells[1],
    );
    expect(preview?.cells[0]?.content).toEqual(current.content.get(current.cells[1]![0]!));
    expect(Object.isFrozen(preview)).toBe(true);
    expect(Object.isFrozen(preview?.cells)).toBe(true);
    expect(Object.isFrozen(preview?.cells[0])).toBe(true);
    expect(Object.isFrozen(preview?.cells[0]?.block)).toBe(true);
    expect(Object.isFrozen(preview?.cells[0]?.content)).toBe(true);
    expect(Object.isFrozen(preview?.cells[0]?.content.content)).toBe(true);
  });

  it("captures one source-column cell per row with unequal frozen row heights", () => {
    const current = fixture();
    const structure = readFirstDraftTableDragStructure(current.graph, current.tableId);
    const item = createFirstDraftTableColumnDragItems("canonical", current.columnIds)[1]!;
    current.graph.readBlockContent.mockClear();

    const preview = captureFirstDraftTableColumnDragPreview(
      current.graph,
      current.tableId,
      item,
      structure,
      [32, 48, 64],
    );

    expect(preview?.cells.map((cell) => cell.block.id)).toEqual([
      current.cells[0]![1],
      current.cells[1]![1],
      current.cells[2]![1],
    ]);
    expect(preview?.columnWidth).toBe(200);
    expect(preview?.rowHeights).toEqual([32, 48, 64]);
    expect(Object.isFrozen(preview?.rowHeights)).toBe(true);
    expect(current.graph.readBlockContent).toHaveBeenCalledTimes(3);
    expect(current.graph.readBlockContent.mock.calls.map(([cellId]) => cellId)).toEqual([
      current.cells[0]![1],
      current.cells[1]![1],
      current.cells[2]![1],
    ]);
  });

  it("rejects malformed membership, missing content, and invalid row geometry", () => {
    const malformed = fixture();
    malformed.graph.children.set(malformed.rows[1]!, [
      malformed.cells[0]![0]!,
      malformed.cells[1]![1]!,
      malformed.cells[1]![2]!,
    ]);
    expect(() =>
      readFirstDraftTableDragStructure(malformed.graph, malformed.tableId),
    ).toThrow(/invalid table cell|duplicate table cell membership/u);

    const missing = fixture();
    const structure = readFirstDraftTableDragStructure(missing.graph, missing.tableId);
    missing.graph.content.delete(missing.cells[0]![1]!);
    const item = createFirstDraftTableColumnDragItems("canonical", missing.columnIds)[1]!;
    expect(
      captureFirstDraftTableColumnDragPreview(
        missing.graph,
        missing.tableId,
        item,
        structure,
        [40, 0, 40],
      ),
    ).toBeNull();
    expect(
      captureFirstDraftTableColumnDragPreview(
        missing.graph,
        missing.tableId,
        item,
        structure,
        [40, 40, 40],
      ),
    ).toBeNull();
  });

  it("does not inspect unrelated document blocks while reading or capturing", () => {
    const current = fixture();
    const unrelated = Array.from({ length: 1_000 }, (_, index) =>
      block(`unrelated-${index}`, "paragraph", null),
    );
    unrelated.forEach((record) => current.graph.blocks.set(record.id, record));

    const structure = readFirstDraftTableDragStructure(current.graph, current.tableId);
    const preview = captureFirstDraftTableRowDragPreview(
      current.graph,
      current.tableId,
      current.rows[0]!,
      structure,
    );

    expect(preview).not.toBeNull();
    expect(current.graph.getBlock.mock.calls.some(([blockId]) =>
      String(blockId).startsWith("unrelated-"),
    )).toBe(false);
    expect(current.graph.readBlockContent).toHaveBeenCalledTimes(3);
  });
});
