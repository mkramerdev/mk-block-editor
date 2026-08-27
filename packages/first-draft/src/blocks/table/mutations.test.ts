import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import { validateRichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import type {
  EditableEditorDefinition,
  EditorSemanticChange,
} from "@repo/editor-web/editor";
import { createFirstDraftEditorDefinition } from "../../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../../first-draft-fixture.ts";
import {
  initializeTestEditableEditor,
  type FirstDraftTestEditor,
} from "../../test-editor.ts";
import { convertEditorTransactionToTransport } from "../../transport/editor-transaction-to-transport.ts";
import { createFirstDraftViewStateStore } from "../view-state.tsx";
import {
  resolveFirstDraftTableColumnIds,
  TABLE_COLUMN_IDS_FIELD,
  TABLE_COLUMN_WIDTHS_FIELD,
} from "./model.ts";
import {
  deleteFirstDraftTableColumn,
  deleteFirstDraftTableRow,
  duplicateFirstDraftTableColumn,
  duplicateFirstDraftTableRow,
  insertFirstDraftTableColumn,
  insertFirstDraftTableRow,
  moveFirstDraftTableColumn,
  moveFirstDraftTableRow,
  resizeFirstDraftTableColumn,
} from "./mutations.ts";

const tableId = asBlockId("fd-table");

function canonicalColumnTarget(columnId: string) {
  return { kind: "canonical", columnId } as const;
}
const canonicalIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const invalidColumnMetadataCases: readonly {
  readonly name: string;
  readonly columnIds: readonly string[] | undefined;
  readonly widths: Readonly<Record<string, number>>;
  readonly expectedWidths: Readonly<Record<string, number>>;
}[] = [
  {
    name: "missing identities",
    columnIds: undefined,
    widths: { "column-1": 180, "column-2": 200, stale: 900 },
    expectedWidths: { "normalized-1": 180, "normalized-2": 200 },
  },
  {
    name: "wrong-length identities",
    columnIds: ["only-one"],
    widths: { "only-one": 180 },
    expectedWidths: {},
  },
  {
    name: "duplicate identities",
    columnIds: ["duplicate", "duplicate", "unique"],
    widths: { duplicate: 180, unique: 240 },
    expectedWidths: { "normalized-3": 240 },
  },
  {
    name: "empty identities",
    columnIds: ["", "valid-two", "valid-three"],
    widths: { "": 160, "valid-two": 220, "valid-three": 260 },
    expectedWidths: { "normalized-2": 220, "normalized-3": 260 },
  },
];
const disposables: FirstDraftTestEditor[] = [];

afterEach(() => {
  for (const editor of disposables.splice(0)) editor.dispose();
  vi.restoreAllMocks();
});

describe("First Draft table mutations", () => {
  it("moves an existing row upward or downward in one preserving transaction", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const canonical = [...editor.getChildBlockIds(tableId)];
    const source = canonical[0]!;
    const sourceCells = [...editor.getChildBlockIds(source)];
    const transaction = vi.spyOn(editor, "transaction");
    const selection = vi.spyOn(editor, "setTransactionSelection");
    const finalOrder = [...canonical.slice(1), source];

    const result = moveFirstDraftTableRow(
      editor,
      tableId,
      source,
      finalOrder,
    );

    expect(result).toMatchObject({
      kind: "moved",
      rowId: source,
      rowIndex: finalOrder.length - 1,
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(selection).toHaveBeenCalledOnce();
    expect(selection).toHaveBeenCalledWith({ kind: "preserve" });
    expect(changes).toHaveLength(1);
    expect(editor.getChildBlockIds(tableId)).toEqual(finalOrder);
    expect(editor.getChildBlockIds(source)).toEqual(sourceCells);

    expect(editor.undo()).toMatchObject({ status: "applied" });
    expect(editor.getChildBlockIds(tableId)).toEqual(canonical);
    expect(editor.redo()).toMatchObject({ status: "applied" });
    expect(editor.getChildBlockIds(tableId)).toEqual(finalOrder);
  });

  it("does not open a transaction for a semantic row no-op", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const canonical = editor.getChildBlockIds(tableId);
    const transaction = vi.spyOn(editor, "transaction");

    expect(
      moveFirstDraftTableRow(
        editor,
        tableId,
        canonical[1]!,
        canonical,
      ),
    ).toEqual({ kind: "no-op", rowId: canonical[1], rowIndex: 1 });
    expect(transaction).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  it("rejects stale row orders before a transaction", () => {
    const { editor } = createEditor(createFirstDraftSnapshot());
    const canonical = editor.getChildBlockIds(tableId);
    const transaction = vi.spyOn(editor, "transaction");
    expect(() =>
      moveFirstDraftTableRow(editor, tableId, canonical[0]!, [
        canonical[0]!,
        canonical[0]!,
        ...canonical.slice(2),
      ]),
    ).toThrow("stale or invalid order");
    expect(transaction).not.toHaveBeenCalled();
  });

  it("moves one existing cell per row and column metadata in one preserving transaction", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const columnIds = [...readColumnIds(editor)];
    const rows = editor.getChildBlockIds(tableId);
    const cellsBefore = rows.map((rowId) => [
      ...editor.getChildBlockIds(rowId),
    ]);
    const contentsBefore = cellsBefore.map((cells) =>
      cells.map((cellId) => editor.readBlockContent(cellId, "tableCell")),
    );
    const widthsBefore = editor.getBlock(tableId)?.metadata?.columnWidths;
    const transaction = vi.spyOn(editor, "transaction");
    const moveBlocks = vi.spyOn(editor, "moveBlocks");
    const selection = vi.spyOn(editor, "setTransactionSelection");

    const result = moveFirstDraftTableColumn(
      editor,
      tableId,
      canonicalColumnTarget(columnIds[0]!),
      [columnIds[1]!, columnIds[2]!, columnIds[0]!].map(
        canonicalColumnTarget,
      ),
    );

    expect(result).toMatchObject({
      kind: "moved",
      columnId: columnIds[0],
      columnIndex: 2,
      cellIds: cellsBefore.map((cells) => cells[0]),
      expectedColumnIds: [columnIds[1], columnIds[2], columnIds[0]],
    });
    expect(transaction).toHaveBeenCalledOnce();
    expect(moveBlocks).toHaveBeenCalledTimes(rows.length);
    expect(selection).toHaveBeenCalledOnce();
    expect(selection).toHaveBeenCalledWith({ kind: "preserve" });
    expect(changes).toHaveLength(1);
    expect(readColumnIds(editor)).toEqual([
      columnIds[1],
      columnIds[2],
      columnIds[0],
    ]);
    rows.forEach((rowId, rowIndex) => {
      expect(editor.getChildBlockIds(rowId)).toEqual([
        cellsBefore[rowIndex]![1],
        cellsBefore[rowIndex]![2],
        cellsBefore[rowIndex]![0],
      ]);
      expect(
        editor
          .getChildBlockIds(rowId)
          .map((cellId) => editor.readBlockContent(cellId, "tableCell")),
      ).toEqual([
        contentsBefore[rowIndex]![1],
        contentsBefore[rowIndex]![2],
        contentsBefore[rowIndex]![0],
      ]);
    });
    expect(editor.getBlock(tableId)?.metadata?.columnWidths).toEqual(
      widthsBefore,
    );
  });

  it("does not open a transaction for a semantic column no-op", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const columnIds = readColumnIds(editor);
    const transaction = vi.spyOn(editor, "transaction");

    expect(
      moveFirstDraftTableColumn(
        editor,
        tableId,
        canonicalColumnTarget(columnIds[1]!),
        columnIds.map(canonicalColumnTarget),
      ),
    ).toMatchObject({ kind: "no-op", columnIndex: 1 });
    expect(transaction).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
  });

  it.each(invalidColumnMetadataCases)(
    "normalizes $name and moves cells in the same transaction",
    ({ columnIds, widths, expectedWidths }) => {
      const { editor, changes } = createEditor(
        snapshotWithTableMetadata(columnIds, widths),
      );
      const rows = editor.getChildBlockIds(tableId);
      const cellsBefore = rows.map((rowId) => editor.getChildBlockIds(rowId));
      const allocated = ["normalized-1", "normalized-2", "normalized-3"];
      const transaction = vi.spyOn(editor, "transaction");

      const result = moveFirstDraftTableColumn(
        editor,
        tableId,
        {
          kind: "synthetic-presentation",
          presentationId: "column-2",
          indexAtOpen: 1,
          columnCountAtOpen: 3,
        },
        [0, 2, 1].map((index) => ({
          kind: "synthetic-presentation" as const,
          presentationId: `column-${index + 1}`,
          indexAtOpen: index,
          columnCountAtOpen: 3,
        })),
        { createColumnId: () => allocated.shift() ?? "exhausted" },
      );

      expect(result).toMatchObject({
        kind: "moved",
        columnIndex: 2,
        expectedColumnIds: [
          "normalized-1",
          "normalized-3",
          "normalized-2",
        ],
      });
      expect(transaction).toHaveBeenCalledOnce();
      expect(changes).toHaveLength(1);
      expect(editor.getBlock(tableId)?.metadata?.columnWidths).toEqual(
        expectedWidths,
      );
      rows.forEach((rowId, rowIndex) => {
        expect(editor.getChildBlockIds(rowId)).toEqual([
          cellsBefore[rowIndex]![0],
          cellsBefore[rowIndex]![2],
          cellsBefore[rowIndex]![1],
        ]);
      });
    },
  );

  it("rolls back every staged row move when a later column move operation fails", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const before = readTableState(editor);
    const columnIds = readColumnIds(editor);
    const originalMoveBlocks = editor.moveBlocks.bind(editor);
    let moves = 0;
    vi.spyOn(editor, "moveBlocks").mockImplementation((input) => {
      moves += 1;
      if (moves === 2) throw new Error("forced staged column failure");
      return originalMoveBlocks(input);
    });

    expect(() =>
      moveFirstDraftTableColumn(
        editor,
        tableId,
        canonicalColumnTarget(columnIds[0]!),
        [columnIds[1]!, columnIds[2]!, columnIds[0]!].map(
          canonicalColumnTarget,
        ),
      ),
    ).toThrow();
    expect(readTableState(editor)).toEqual(before);
    expect(changes).toEqual([]);
    expect(editor.canUndo).toBe(false);
  });

  it("fails synthetic column identity exhaustion before opening a transaction", () => {
    const { editor, changes } = createEditor(
      snapshotWithTableMetadata(undefined, {}),
    );
    const before = readTableState(editor);
    const transaction = vi.spyOn(editor, "transaction");
    const synthetic = (index: number) => ({
      kind: "synthetic-presentation" as const,
      presentationId: `column-${index + 1}`,
      indexAtOpen: index,
      columnCountAtOpen: 3,
    });

    expect(() =>
      moveFirstDraftTableColumn(
        editor,
        tableId,
        synthetic(0),
        [synthetic(1), synthetic(2), synthetic(0)],
        { createColumnId: () => "" },
      ),
    ).toThrow("unable to allocate a unique table column id");
    expect(transaction).not.toHaveBeenCalled();
    expect(readTableState(editor)).toEqual(before);
    expect(changes).toEqual([]);
  });

  it.each([
    "insert-row",
    "delete-row",
    "duplicate-row",
    "insert-column",
    "delete-column",
    "duplicate-column",
  ] as const)("requests one atomic selection clear for %s", (action) => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const selection = vi.spyOn(editor, "setTransactionSelection");
    const targetRowId = editor.getChildBlockIds(tableId)[1]!;
    const targetColumnId = readColumnIds(editor)[1]!;

    switch (action) {
      case "insert-row":
        insertFirstDraftTableRow(editor, tableId, 1);
        break;
      case "delete-row":
        deleteFirstDraftTableRow(editor, tableId, targetRowId);
        break;
      case "duplicate-row":
        duplicateFirstDraftTableRow(editor, tableId, targetRowId);
        break;
      case "insert-column":
        insertFirstDraftTableColumn(editor, tableId, 1);
        break;
      case "delete-column":
        deleteFirstDraftTableColumn(
          editor,
          tableId,
          canonicalColumnTarget(targetColumnId),
        );
        break;
      case "duplicate-column":
        duplicateFirstDraftTableColumn(
          editor,
          tableId,
          canonicalColumnTarget(targetColumnId),
        );
        break;
    }

    expect(selection).toHaveBeenCalledOnce();
    expect(selection).toHaveBeenCalledWith({ kind: "clear" });
    expect(changes).toHaveLength(1);
    expectClearedSelection(editor, changes[0]!);
  });

  it("materializes rows and cells against the active editor definition", () => {
    const baseDefinition = createFirstDraftEditorDefinition(
      createFirstDraftViewStateStore(),
    );
    const definitionReads = new Set<PropertyKey>();
    const retainedDefinitions = Object.setPrototypeOf(
      { ...baseDefinition.blocks },
      { testDefinitionRegistry: true },
    );
    const blocks = new Proxy(retainedDefinitions, {
      get(target, property, receiver) {
        definitionReads.add(property);
        return Reflect.get(target, property, receiver);
      },
    });
    const { editor } = createEditor(createFirstDraftSnapshot(), {
      ...baseDefinition,
      blocks,
    });
    definitionReads.clear();

    const row = appendRow(editor);
    if (!row) throw new Error("Expected a row append");
    appendColumn(editor);

    expect(editor.definition.blocks).toBe(blocks);
    expect([...definitionReads]).toEqual(
      expect.arrayContaining(["tableRow", "tableCell"]),
    );
    expectRectangularTable(editor, 5, 4);
  });

  it("allocates canonical structural ids and a separate unique column id", () => {
    const initial = createFirstDraftSnapshot();
    const initialIds = new Set(Object.keys(initial.blocks));
    const { editor, changes } = createEditor(initial);

    const row = appendRow(editor);
    expect(row).not.toBeNull();
    if (!row) throw new Error("Expected a row append");
    expect(changes).toHaveLength(1);
    expectClearedSelection(editor, changes[0]!);

    const column = appendColumn(editor);
    expect(changes).toHaveLength(2);
    expectClearedSelection(editor, changes[1]!);

    const structuralIds = [row.rowId, ...row.cellIds, ...column.cellIds];
    expect(new Set(structuralIds).size).toBe(structuralIds.length);
    for (const blockId of structuralIds) {
      expect(initialIds.has(blockId)).toBe(false);
      expect(blockId).toMatch(canonicalIdPattern);
      expect(blockId).not.toMatch(/^first-draft-(?:row|cell)-/u);
    }

    const columnIds = readColumnIds(editor);
    expect(new Set(columnIds).size).toBe(columnIds.length);
    expect(columnIds.at(-1)).toBe(column.columnId);
    expect(column.columnId).not.toMatch(/^first-draft-column-/u);
    expect(
      Object.values(editor.readSnapshot().blocks).some(
        (block) => block.id === column.columnId,
      ),
    ).toBe(false);
    expectRectangularTable(editor, 5, 4);
    for (const cellId of [...row.cellIds, ...column.cellIds]) {
      expect(editor.readBlockPlainText(cellId, "tableCell")).toBe("");
    }
  });

  it("inserts rows at the requested first, middle, and append positions", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const originalRows = editor.getChildBlockIds(tableId);

    const first = insertFirstDraftTableRow(editor, tableId, 0);
    expect(editor.getChildBlockIds(tableId)).toEqual([
      first.rowId,
      ...originalRows,
    ]);
    expectClearedSelection(editor, changes[0]!);

    const middle = insertFirstDraftTableRow(editor, tableId, 3);
    expect(editor.getChildBlockIds(tableId)[3]).toBe(middle.rowId);
    expectClearedSelection(editor, changes[1]!);

    const appended = insertFirstDraftTableRow(
      editor,
      tableId,
      editor.getChildBlockIds(tableId).length,
    );
    expect(editor.getChildBlockIds(tableId).at(-1)).toBe(appended.rowId);
    expect(changes).toHaveLength(3);
    expectClearedSelection(editor, changes[2]!);
    expectRectangularTable(editor, 7, 3);
  });

  it.each([
    { name: "first", index: 0 },
    { name: "middle", index: 1 },
    { name: "final deletable", index: 3 },
  ])("deletes the $name row and clears selection", ({ index }) => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const beforeRows = editor.getChildBlockIds(tableId);
    const rowId = beforeRows[index]!;
    const result = deleteFirstDraftTableRow(editor, tableId, rowId);

    expect(result).toMatchObject({ rowId, rowIndex: index });
    expect(result).not.toHaveProperty("selectionCellId");
    expect(editor.getChildBlockIds(tableId)).toEqual(
      beforeRows.filter((candidate) => candidate !== rowId),
    );
    expect(editor.getBlock(rowId)?.tombstone).not.toBeNull();
    expect(changes).toHaveLength(1);
    expectClearedSelection(editor, changes[0]!);
    expectRectangularTable(editor, 3, 3);
  });

  it("rejects final-row deletion before opening a transaction", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    while (editor.getChildBlockIds(tableId).length > 1) {
      deleteFirstDraftTableRow(
        editor,
        tableId,
        editor.getChildBlockIds(tableId).at(-1)!,
      );
    }
    changes.splice(0);
    const before = readTableState(editor);
    const beforeSelection = editor.selectionController.getCanonicalSnapshot();
    const transaction = vi.spyOn(editor, "transaction");

    expect(() =>
      deleteFirstDraftTableRow(
        editor,
        tableId,
        editor.getChildBlockIds(tableId)[0]!,
      ),
    ).toThrow("cannot delete the final table row");
    expect(transaction).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    expect(readTableState(editor)).toEqual(before);
    expect(editor.selectionController.getCanonicalSnapshot()).toEqual(
      beforeSelection,
    );
  });

  it("duplicates a complete formatted row with fresh structural identities", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const sourceRowId = editor.getChildBlockIds(tableId)[0]!;
    const sourceCellIds = editor.getChildBlockIds(sourceRowId);
    const sourceContents = sourceCellIds.map((cellId) =>
      editor.readBlockContent(cellId, "tableCell"),
    );

    const duplicate = duplicateFirstDraftTableRow(editor, tableId, sourceRowId);

    expect(editor.getChildBlockIds(tableId)[1]).toBe(duplicate.rowId);
    expect(duplicate.rowId).not.toBe(sourceRowId);
    expect(new Set(duplicate.cellIds).size).toBe(sourceCellIds.length);
    expect(duplicate.cellIds).not.toEqual(sourceCellIds);
    expect(
      duplicate.cellIds.map((cellId) =>
        editor.readBlockContent(cellId, "tableCell"),
      ),
    ).toEqual(sourceContents);
    expect(
      sourceCellIds.map((cellId) =>
        editor.readBlockContent(cellId, "tableCell"),
      ),
    ).toEqual(sourceContents);
    expect(changes).toHaveLength(1);
    expectClearedSelection(editor, changes[0]!);
  });

  it("duplicates a row whose cells are all empty", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const empty = insertFirstDraftTableRow(
      editor,
      tableId,
      editor.getChildBlockIds(tableId).length,
    );
    changes.splice(0);

    const duplicate = duplicateFirstDraftTableRow(editor, tableId, empty.rowId);

    expect(duplicate.cellIds).toHaveLength(3);
    expect(
      duplicate.cellIds.map((cellId) =>
        editor.readBlockPlainText(cellId, "tableCell"),
      ),
    ).toEqual(["", "", ""]);
    expect(changes).toHaveLength(1);
  });

  it("duplicates inline atoms and valid cell metadata without sharing identity", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const sourceRowId = editor.getChildBlockIds(tableId)[1]!;
    const sourceCellId = editor.getChildBlockIds(sourceRowId)[1]!;
    expect(
      editor.updateInlineAtom({
        blockId: sourceCellId,
        range: { from: 0, to: 4 },
        atom: { type: "mention", metadata: { id: "person-001" } },
      }),
    ).toBe(true);
    expect(
      editor.updateBlockMetadata(
        [{ blockId: sourceCellId, values: { textAlign: "center" } }],
        { editorSuggestion: null },
      ),
    ).toBe(true);
    changes.splice(0);
    const sourceContent = editor.readBlockContent(sourceCellId, "tableCell");

    const duplicate = duplicateFirstDraftTableRow(editor, tableId, sourceRowId);
    const duplicateCellId = duplicate.cellIds[1]!;

    expect(editor.readBlockContent(duplicateCellId, "tableCell")).toEqual(
      sourceContent,
    );
    expect(editor.getBlock(duplicateCellId)?.metadata).toEqual(
      editor.getBlock(sourceCellId)?.metadata,
    );
    expect(duplicateCellId).not.toBe(sourceCellId);
    expect(changes).toHaveLength(1);
  });

  it("inserts columns at the requested first, middle, and append positions", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const originalColumnIds = readColumnIds(editor);
    const originalFirstRow = editor.getChildBlockIds(
      editor.getChildBlockIds(tableId)[0]!,
    );

    const first = insertFirstDraftTableColumn(editor, tableId, 0);
    expect(readColumnIds(editor)).toEqual([
      first.columnId,
      ...originalColumnIds,
    ]);
    expect(
      editor.getChildBlockIds(editor.getChildBlockIds(tableId)[0]!)[0],
    ).toBe(first.cellIds[0]);

    const middle = insertFirstDraftTableColumn(editor, tableId, 2);
    expect(readColumnIds(editor)[2]).toBe(middle.columnId);

    const appended = insertFirstDraftTableColumn(
      editor,
      tableId,
      readColumnIds(editor).length,
    );
    expect(readColumnIds(editor).at(-1)).toBe(appended.columnId);
    expect(editor.getChildBlockIds(tableId)).toHaveLength(4);
    expect(originalFirstRow.every((cellId) => editor.getBlock(cellId))).toBe(
      true,
    );
    expect(changes).toHaveLength(3);
    expectClearedSelection(editor, changes[2]!);
    expectRectangularTable(editor, 4, 6);
  });

  it.each([
    { name: "first", index: 0 },
    { name: "middle", index: 1 },
    { name: "final deletable", index: 2 },
  ])(
    "deletes the $name column and only its width while clearing selection",
    ({ index }) => {
      const { editor, changes } = createEditor(createFirstDraftSnapshot());
      const beforeColumnIds = readColumnIds(editor);
      const sourceColumnId = beforeColumnIds[index]!;
      const rowIds = editor.getChildBlockIds(tableId);
      const targetCellIds = rowIds.map(
        (rowId) => editor.getChildBlockIds(rowId)[index]!,
      );
      const result = deleteFirstDraftTableColumn(
        editor,
        tableId,
        canonicalColumnTarget(sourceColumnId),
      );

      expect(result).toMatchObject({
        columnId: sourceColumnId,
        columnIndex: index,
        cellIds: targetCellIds,
      });
      expect(result).not.toHaveProperty("selectionCellId");
      expect(readColumnIds(editor)).toEqual(
        beforeColumnIds.filter((columnId) => columnId !== sourceColumnId),
      );
      expect(editor.getBlock(tableId)?.metadata?.columnWidths).toEqual(
        Object.fromEntries(
          beforeColumnIds
            .filter((columnId) => columnId !== sourceColumnId)
            .map((columnId) => [columnId, 208]),
        ),
      );
      for (const cellId of targetCellIds) {
        expect(editor.getBlock(cellId)?.tombstone).not.toBeNull();
      }
      expect(changes).toHaveLength(1);
      expectClearedSelection(editor, changes[0]!);
      expectRectangularTable(editor, 4, 2);
    },
  );

  it("rejects final-column deletion before opening a transaction", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    while (readColumnIds(editor).length > 1) {
      deleteFirstDraftTableColumn(
        editor,
        tableId,
        canonicalColumnTarget(readColumnIds(editor)[0]!),
      );
    }
    changes.splice(0);
    const before = readTableState(editor);
    const beforeSelection = editor.selectionController.getCanonicalSnapshot();
    const transaction = vi.spyOn(editor, "transaction");

    expect(() =>
      deleteFirstDraftTableColumn(
        editor,
        tableId,
        canonicalColumnTarget(readColumnIds(editor)[0]!),
      ),
    ).toThrow("cannot delete the final table column");
    expect(transaction).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    expect(readTableState(editor)).toEqual(before);
    expect(editor.selectionController.getCanonicalSnapshot()).toEqual(
      beforeSelection,
    );
  });

  it("duplicates a formatted column with fresh cell and column identities", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const sourceColumnId = readColumnIds(editor)[0]!;
    const rowIds = editor.getChildBlockIds(tableId);
    const sourceCellIds = rowIds.map(
      (rowId) => editor.getChildBlockIds(rowId)[0]!,
    );
    const sourceContents = sourceCellIds.map((cellId) =>
      editor.readBlockContent(cellId, "tableCell"),
    );

    const duplicate = duplicateFirstDraftTableColumn(
      editor,
      tableId,
      canonicalColumnTarget(sourceColumnId),
    );

    expect(duplicate.sourceColumnId).toBe(sourceColumnId);
    expect(duplicate.columnId).not.toBe(sourceColumnId);
    expect(readColumnIds(editor)[1]).toBe(duplicate.columnId);
    expect(duplicate.cellIds).not.toEqual(sourceCellIds);
    expect(
      duplicate.cellIds.map((cellId) =>
        editor.readBlockContent(cellId, "tableCell"),
      ),
    ).toEqual(sourceContents);
    expect(editor.getBlock(tableId)?.metadata?.columnWidths).toMatchObject({
      [sourceColumnId]: 208,
      [duplicate.columnId]: 208,
    });
    expect(changes).toHaveLength(1);
    expectClearedSelection(editor, changes[0]!);
  });

  it("duplicates different per-row content including marks and an inline atom", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const sourceColumnId = readColumnIds(editor)[0]!;
    const sourceCellIds = editor
      .getChildBlockIds(tableId)
      .map((rowId) => editor.getChildBlockIds(rowId)[0]!);
    expect(
      editor.updateInlineAtom({
        blockId: sourceCellIds[1]!,
        range: { from: 0, to: 8 },
        atom: { type: "mention", metadata: { id: "person-002" } },
      }),
    ).toBe(true);
    changes.splice(0);
    const sourceContents = sourceCellIds.map((cellId) =>
      editor.readBlockContent(cellId, "tableCell"),
    );

    const duplicate = duplicateFirstDraftTableColumn(
      editor,
      tableId,
      canonicalColumnTarget(sourceColumnId),
    );

    expect(
      duplicate.cellIds.map((cellId) =>
        editor.readBlockContent(cellId, "tableCell"),
      ),
    ).toEqual(sourceContents);
    expect(new Set(duplicate.cellIds).size).toBe(sourceCellIds.length);
    expect(
      duplicate.cellIds.every((cellId) => !sourceCellIds.includes(cellId)),
    ).toBe(true);
    expect(changes).toHaveLength(1);
  });

  it("preserves default-width behavior when duplicating an implicit-width column", () => {
    const sourceColumnId = "fd-table-column-b";
    const snapshot = snapshotWithTableMetadata(
      ["fd-table-column-a", sourceColumnId, "fd-table-column-c"],
      {
        "fd-table-column-a": 180,
        "fd-table-column-c": 260,
      },
    );
    const { editor } = createEditor(snapshot);

    const duplicate = duplicateFirstDraftTableColumn(
      editor,
      tableId,
      canonicalColumnTarget(sourceColumnId),
    );
    const widths = editor.getBlock(tableId)?.metadata?.columnWidths;

    expect(widths).toEqual({
      "fd-table-column-a": 180,
      "fd-table-column-c": 260,
    });
    expect(widths).not.toHaveProperty(duplicate.columnId);
  });

  it("never falls back to a stale column index", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const staleId = readColumnIds(editor)[1]!;
    deleteFirstDraftTableColumn(
      editor,
      tableId,
      canonicalColumnTarget(staleId),
    );
    changes.splice(0);
    const before = readTableState(editor);
    const transaction = vi.spyOn(editor, "transaction");

    expect(() =>
      duplicateFirstDraftTableColumn(
        editor,
        tableId,
        canonicalColumnTarget(staleId),
      ),
    ).toThrow("cannot mutate a missing table column");
    expect(transaction).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    expect(readTableState(editor)).toEqual(before);
  });

  it("normalizes a verified synthetic column target in the mutation commit", () => {
    const { editor, changes } = createEditor(
      snapshotWithTableMetadata(undefined, {
        "column-1": 170,
        "column-2": 210,
      }),
    );
    const presentationId = readColumnIds(editor)[1]!;
    const candidates = [
      "normalized-a",
      "normalized-b",
      "normalized-c",
      "duplicated-b",
    ];

    const result = duplicateFirstDraftTableColumn(
      editor,
      tableId,
      {
        kind: "synthetic-presentation",
        presentationId,
        indexAtOpen: 1,
        columnCountAtOpen: 3,
      },
      {
        createColumnId: () => candidates.shift() ?? "exhausted",
      },
    );

    expect(result).toMatchObject({
      sourceColumnId: "normalized-b",
      columnId: "duplicated-b",
      columnIndex: 2,
    });
    expect(readColumnIds(editor)).toEqual([
      "normalized-a",
      "normalized-b",
      "duplicated-b",
      "normalized-c",
    ]);
    expect(editor.getBlock(tableId)?.metadata?.columnWidths).toEqual({
      "normalized-a": 170,
      "normalized-b": 210,
      "duplicated-b": 210,
    });
    expect(changes).toHaveLength(1);
    expectRectangularTable(editor, 4, 4);
  });

  it("rejects a synthetic column target after the table shape changes", () => {
    const { editor, changes } = createEditor(
      snapshotWithTableMetadata(undefined, {}),
    );
    const presentationId = readColumnIds(editor)[1]!;
    const before = readTableState(editor);
    const transaction = vi.spyOn(editor, "transaction");

    expect(() =>
      duplicateFirstDraftTableColumn(editor, tableId, {
        kind: "synthetic-presentation",
        presentationId,
        indexAtOpen: 1,
        columnCountAtOpen: 4,
      }),
    ).toThrow("cannot mutate a stale synthetic table shape");
    expect(transaction).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    expect(readTableState(editor)).toEqual(before);
  });

  it("rejects stale row identity and stale row parent before mutation", () => {
    const first = createEditor(createFirstDraftSnapshot());
    const firstTransaction = vi.spyOn(first.editor, "transaction");
    expect(() =>
      duplicateFirstDraftTableRow(
        first.editor,
        tableId,
        asBlockId("missing-row"),
      ),
    ).toThrow("cannot mutate a missing table row");
    expect(firstTransaction).not.toHaveBeenCalled();
    expect(first.changes).toEqual([]);

    const second = createEditor(createFirstDraftSnapshot());
    const rowId = asBlockId("fd-table-row-2");
    const getParentId = second.editor.getParentId.bind(second.editor);
    vi.spyOn(second.editor, "getParentId").mockImplementation((blockId) =>
      blockId === rowId ? null : getParentId(blockId),
    );
    const secondTransaction = vi.spyOn(second.editor, "transaction");
    expect(() =>
      deleteFirstDraftTableRow(second.editor, tableId, rowId),
    ).toThrow("cannot mutate an invalid table row");
    expect(secondTransaction).not.toHaveBeenCalled();
    expect(second.changes).toEqual([]);
  });

  it("leaves snapshot and selection unchanged when the transaction rejects", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const before = readTableState(editor);
    const beforeSelection = editor.selectionController.getCanonicalSnapshot();
    vi.spyOn(editor, "transaction").mockReturnValue({
      ok: false,
      phase: "commit",
      message: "forced rejection",
    });

    expect(() => insertFirstDraftTableRow(editor, tableId, 1)).toThrow(
      "table mutation was rejected: forced rejection",
    );
    expect(changes).toEqual([]);
    expect(readTableState(editor)).toEqual(before);
    expect(editor.selectionController.getCanonicalSnapshot()).toEqual(
      beforeSelection,
    );
  });

  it.each([
    {
      name: "row insert",
      mutate: (editor: FirstDraftTestEditor) =>
        insertFirstDraftTableRow(editor, tableId, 2),
    },
    {
      name: "row delete",
      mutate: (editor: FirstDraftTestEditor) =>
        deleteFirstDraftTableRow(
          editor,
          tableId,
          editor.getChildBlockIds(tableId)[1]!,
        ),
    },
    {
      name: "row duplicate",
      mutate: (editor: FirstDraftTestEditor) =>
        duplicateFirstDraftTableRow(
          editor,
          tableId,
          editor.getChildBlockIds(tableId)[1]!,
        ),
    },
    {
      name: "row move",
      mutate: (editor: FirstDraftTestEditor) => {
        const rowIds = editor.getChildBlockIds(tableId);
        return moveFirstDraftTableRow(editor, tableId, rowIds[0]!, [
          ...rowIds.slice(1),
          rowIds[0]!,
        ]);
      },
    },
    {
      name: "column insert",
      mutate: (editor: FirstDraftTestEditor) =>
        insertFirstDraftTableColumn(editor, tableId, 1),
    },
    {
      name: "column move",
      mutate: (editor: FirstDraftTestEditor) => {
        const columnIds = readColumnIds(editor);
        return moveFirstDraftTableColumn(
          editor,
          tableId,
          canonicalColumnTarget(columnIds[2]!),
          [columnIds[2]!, columnIds[0]!, columnIds[1]!].map(
            canonicalColumnTarget,
          ),
        );
      },
    },
    {
      name: "column delete",
      mutate: (editor: FirstDraftTestEditor) =>
        deleteFirstDraftTableColumn(
          editor,
          tableId,
          canonicalColumnTarget(readColumnIds(editor)[1]!),
        ),
    },
    {
      name: "column duplicate",
      mutate: (editor: FirstDraftTestEditor) =>
        duplicateFirstDraftTableColumn(
          editor,
          tableId,
          canonicalColumnTarget(readColumnIds(editor)[1]!),
        ),
    },
  ])(
    "$name is one undoable, redoable, transport- and reload-stable commit",
    ({ mutate }) => {
      const snapshot = createFirstDraftSnapshot();
      const source = createEditor(snapshot);
      const peer = createEditor(snapshot).editor;
      const before = readTableState(source.editor);

      mutate(source.editor);
      const after = readTableState(source.editor);
      expect(source.changes).toHaveLength(1);
      applyChange(peer, source.changes[0]!);
      expect(readTableState(peer)).toEqual(after);

      expect(source.editor.undo()).toEqual({ status: "applied" });
      expect(source.changes).toHaveLength(2);
      applyChange(peer, source.changes[1]!);
      expect(readTableState(source.editor)).toEqual(before);
      expect(readTableState(peer)).toEqual(before);

      expect(source.editor.redo()).toEqual({ status: "applied" });
      expect(source.changes).toHaveLength(3);
      applyChange(peer, source.changes[2]!);
      expect(readTableState(source.editor)).toEqual(after);
      expect(readTableState(peer)).toEqual(after);

      const reloaded = createEditor(peer.readSnapshot()).editor;
      expect(readTableState(reloaded)).toEqual(after);
    },
  );

  it("preserves legacy counter-shaped identities while appending successfully", () => {
    const snapshot = legacyCounterIdentitySnapshot();
    const { editor } = createEditor(snapshot);
    const legacyRowId = asBlockId("first-draft-row-2");
    const legacyCellId = asBlockId("first-draft-cell-3");
    const rowBefore = editor.getBlock(legacyRowId);
    const cellBefore = editor.getBlock(legacyCellId);

    const row = appendRow(editor);
    if (!row) throw new Error("Expected a row append");
    const column = appendColumn(editor);

    expect(editor.getBlock(legacyRowId)).toEqual(rowBefore);
    expect(editor.getBlock(legacyCellId)).toEqual(cellBefore);
    expect(row.rowId).not.toBe(legacyRowId);
    expect(row.cellIds).not.toContain(legacyCellId);
    expect(column.cellIds).not.toContain(legacyCellId);
    expect(column.columnId).not.toBe("first-draft-column-6");
    expect(readColumnIds(editor).slice(0, 3)).toEqual([
      "first-draft-column-6",
      "fd-table-column-b",
      "fd-table-column-c",
    ]);
    expectRectangularTable(editor, 5, 4);
    expect(readColumnIds(editor)).toHaveLength(4);
    expect(new Set(readColumnIds(editor)).size).toBe(4);
  });

  it.each(invalidColumnMetadataCases)(
    "normalizes $name atomically when appending a column",
    ({ columnIds, widths, expectedWidths }) => {
      const initial = snapshotWithTableMetadata(columnIds, widths);
      const { editor, changes } = createEditor(initial);
      const originalRows = editor.getChildBlockIds(tableId);
      const originalCells = originalRows.flatMap((rowId) =>
        editor.getChildBlockIds(rowId),
      );
      const before = editor.readSnapshot();
      const candidates = [
        "normalized-1",
        "normalized-2",
        "normalized-3",
        "normalized-4",
      ];

      const result = insertFirstDraftTableColumn(editor, tableId, 3, {
        createColumnId: () => candidates.shift() ?? "normalized-exhausted",
      });

      expect(changes).toHaveLength(1);
      expect(readColumnIds(editor)).toEqual([
        "normalized-1",
        "normalized-2",
        "normalized-3",
        "normalized-4",
      ]);
      expect(result.columnId).toBe("normalized-4");
      expect(editor.getBlock(tableId)?.metadata?.columnWidths).toEqual(
        expectedWidths,
      );
      expect(editor.getChildBlockIds(tableId)).toEqual(originalRows);
      for (const cellId of originalCells) {
        expect(editor.getBlock(cellId)).toMatchObject({
          id: cellId,
          tombstone: null,
        });
      }

      expect(editor.undo()).toEqual({ status: "applied" });
      expect(editor.getBlock(tableId)?.metadata).toEqual(
        before.blocks[tableId]?.metadata,
      );
      expect(editor.getChildBlockIds(tableId)).toEqual(originalRows);
      for (const cellId of originalCells) {
        expect(editor.getBlock(cellId)).toMatchObject({
          id: cellId,
          tombstone: null,
        });
      }
      expect(editor.redo()).toEqual({ status: "applied" });
      expect(readColumnIds(editor)).toEqual([
        "normalized-1",
        "normalized-2",
        "normalized-3",
        "normalized-4",
      ]);
    },
  );

  it("normalizes identity and widths in the first resize transaction", () => {
    const initial = snapshotWithTableMetadata(undefined, {
      "column-1": 180,
      "column-2": 200,
      stale: 900,
    });
    const { editor, changes } = createEditor(initial);
    const before = editor.readSnapshot();
    const candidates = ["resize-1", "resize-2", "resize-3"];

    const result = resizeFirstDraftTableColumn(editor, tableId, 1, 248, {
      createColumnId: () => candidates.shift() ?? "resize-exhausted",
    });

    expect(result).toMatchObject({ columnId: "resize-2", width: 248 });
    expect(changes).toHaveLength(1);
    expect(readColumnIds(editor)).toEqual(["resize-1", "resize-2", "resize-3"]);
    expect(editor.getBlock(tableId)?.metadata?.columnWidths).toEqual({
      "resize-1": 180,
      "resize-2": 248,
    });
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.getBlock(tableId)?.metadata).toEqual(
      before.blocks[tableId]?.metadata,
    );
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(readColumnIds(editor)).toEqual(["resize-1", "resize-2", "resize-3"]);
  });

  it("opens no transaction when table identity normalization is exhausted", () => {
    const { editor, changes } = createEditor(
      snapshotWithTableMetadata(undefined, {}),
    );
    const before = editor.readSnapshot();
    const transaction = vi.spyOn(editor, "transaction");

    expect(() =>
      insertFirstDraftTableColumn(editor, tableId, 3, {
        createColumnId: () => "",
      }),
    ).toThrow("unable to allocate a unique table column id");
    expect(() =>
      resizeFirstDraftTableColumn(editor, tableId, 0, 220, {
        createColumnId: () => "",
      }),
    ).toThrow("unable to allocate a unique table column id");
    expect(transaction).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    expect(editor.readSnapshot()).toEqual(before);
  });

  it("continues allocating unique identities after snapshot reload", () => {
    const first = createEditor(createFirstDraftSnapshot()).editor;
    const firstRow = appendRow(first);
    if (!firstRow) throw new Error("Expected a row append");
    const firstColumn = appendColumn(first);
    const persisted = first.readSnapshot();
    const persistedIds = new Set(Object.keys(persisted.blocks));
    const persistedColumns = readColumnIds(first);
    first.dispose();
    disposables.splice(disposables.indexOf(first), 1);

    const second = createEditor(persisted).editor;
    const secondRow = appendRow(second);
    if (!secondRow) throw new Error("Expected a row append after reload");
    const secondColumn = appendColumn(second);

    for (const blockId of [
      secondRow.rowId,
      ...secondRow.cellIds,
      ...secondColumn.cellIds,
    ]) {
      expect(persistedIds.has(blockId)).toBe(false);
    }
    for (const blockId of [
      firstRow.rowId,
      ...firstRow.cellIds,
      ...firstColumn.cellIds,
    ]) {
      expect(second.getBlock(blockId)?.id).toBe(blockId);
    }
    expect(readColumnIds(second).slice(0, persistedColumns.length)).toEqual(
      persistedColumns,
    );
    expect(new Set(readColumnIds(second)).size).toBe(5);
    expectRectangularTable(second, 6, 5);
    for (const rowId of second.getChildBlockIds(tableId)) {
      for (const cellId of second.getChildBlockIds(rowId)) {
        const content = second.readBlockContent(cellId, "tableCell");
        expect(content).not.toBeNull();
        if (content) {
          expect(validateRichTextDocumentNodeJson(content).valid).toBe(true);
        }
      }
    }
  });

  it("does not couple independent editors through a deterministic sequence", () => {
    const snapshot = createFirstDraftSnapshot();
    const first = createEditor(snapshot).editor;
    const second = createEditor(snapshot).editor;

    const firstRow = appendRow(first);
    const secondRow = appendRow(second);
    if (!firstRow || !secondRow) throw new Error("Expected row appends");
    const firstColumn = appendColumn(first);
    const secondColumn = appendColumn(second);
    const firstStructuralIds = new Set([
      firstRow.rowId,
      ...firstRow.cellIds,
      ...firstColumn.cellIds,
    ]);
    const secondStructuralIds = [
      secondRow.rowId,
      ...secondRow.cellIds,
      ...secondColumn.cellIds,
    ];

    expect(
      secondStructuralIds.filter((blockId) => firstStructuralIds.has(blockId)),
    ).toEqual([]);
    expect(secondColumn.columnId).not.toBe(firstColumn.columnId);
  });

  it.each(["row", "column"] as const)(
    "commits a %s append once and restores the same identities on redo",
    (kind) => {
      const { editor, changes } = createEditor(createFirstDraftSnapshot());
      const beforeRows = editor.getChildBlockIds(tableId);
      const beforeColumns = readColumnIds(editor);
      const result = kind === "row" ? appendRow(editor) : appendColumn(editor);
      if (!result) throw new Error("Expected a table append");
      const createdIds: BlockId[] = [...result.cellIds];
      if ("rowId" in result) createdIds.unshift(result.rowId);
      expect(result.transaction).toMatchObject({ ok: true, changed: true });
      expect(changes).toHaveLength(1);
      expectClearedSelection(editor, changes[0]!);
      expect(editor.undo()).toEqual({ status: "applied" });
      expect(editor.getChildBlockIds(tableId)).toEqual(beforeRows);
      expect(readColumnIds(editor)).toEqual(beforeColumns);
      expect(editor.redo()).toEqual({ status: "applied" });
      for (const blockId of createdIds) {
        expect(editor.getBlock(blockId)).toMatchObject({
          id: blockId,
          tombstone: null,
        });
      }
      expect(editor.selectionController.getCanonicalSnapshot()).toMatchObject({
        kind: "none",
      });

      const reloaded = createEditor(editor.readSnapshot()).editor;
      for (const blockId of createdIds) {
        expect(reloaded.getBlock(blockId)).toMatchObject({
          id: blockId,
          tombstone: null,
        });
      }
    },
  );

  it("does not open a transaction when structural identity preparation fails", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const before = editor.readSnapshot();
    const transaction = vi.spyOn(editor, "transaction");
    const collision = () => tableId;

    expect(() =>
      insertFirstDraftTableRow(editor, tableId, 3, {
        createBlockId: collision,
      }),
    ).toThrow("unable to allocate a unique block id for table mutation");
    expect(() =>
      insertFirstDraftTableColumn(editor, tableId, 3, {
        createBlockId: collision,
      }),
    ).toThrow("unable to allocate a unique block id for table mutation");
    expect(transaction).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    expect(editor.readSnapshot()).toEqual(before);
  });

  it("never recycles a tombstoned block identity", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const tombstonedId = asBlockId("fd-paragraph-outro");
    expect(
      editor.transaction(() => {
        editor.deleteBlocks({
          blockIds: [tombstonedId],
          includeDescendants: true,
          expectedParents: { [tombstonedId]: null },
        });
        editor.setTransactionSelection({ kind: "preserve" });
      }),
    ).toMatchObject({ ok: true, changed: true });
    expect(editor.getBlock(tombstonedId)?.tombstone).not.toBeNull();
    changes.splice(0);
    const before = editor.readSnapshot();
    const transaction = vi.spyOn(editor, "transaction");

    expect(() =>
      insertFirstDraftTableRow(editor, tableId, 3, {
        createBlockId: () => tombstonedId,
      }),
    ).toThrow("unable to allocate a unique block id for table mutation");
    expect(transaction).not.toHaveBeenCalled();
    expect(changes).toEqual([]);
    expect(editor.readSnapshot()).toEqual(before);
  });

  it("publishes stable table identities that a peer and snapshot reload preserve", () => {
    const snapshot = createFirstDraftSnapshot();
    const { editor, changes } = createEditor(snapshot);
    const peer = createEditor(snapshot).editor;
    const row = appendRow(editor);
    if (!row) throw new Error("Expected a row append");
    const column = appendColumn(editor);

    expect(changes).toHaveLength(2);
    for (const change of changes) {
      expect(
        peer.applyRemoteTransaction({
          transaction: convertEditorTransactionToTransport(change),
          authorSelection: { kind: "no-author-selection" },
        }),
      ).toMatchObject({ status: "applied" });
    }
    expect(peer.getChildBlockIds(tableId)).toEqual(
      editor.getChildBlockIds(tableId),
    );
    for (const rowId of editor.getChildBlockIds(tableId)) {
      expect(peer.getChildBlockIds(rowId)).toEqual(
        editor.getChildBlockIds(rowId),
      );
    }
    expect(readColumnIds(peer)).toEqual(readColumnIds(editor));
    expect(peer.getBlock(row.rowId)?.id).toBe(row.rowId);
    for (const cellId of [...row.cellIds, ...column.cellIds]) {
      expect(peer.getBlock(cellId)?.id).toBe(cellId);
    }

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(changes).toHaveLength(3);
    expect(
      peer.applyRemoteTransaction({
        transaction: convertEditorTransactionToTransport(changes[2]!),
        authorSelection: { kind: "no-author-selection" },
      }),
    ).toMatchObject({ status: "applied" });
    expect(readColumnIds(peer)).toHaveLength(3);
    for (const cellId of column.cellIds) {
      expect(peer.getBlock(cellId)?.tombstone).not.toBeNull();
    }

    expect(editor.redo()).toEqual({ status: "applied" });
    expect(changes).toHaveLength(4);
    expect(
      peer.applyRemoteTransaction({
        transaction: convertEditorTransactionToTransport(changes[3]!),
        authorSelection: { kind: "no-author-selection" },
      }),
    ).toMatchObject({ status: "applied" });
    expect(readColumnIds(peer)).toEqual(readColumnIds(editor));
    for (const cellId of column.cellIds) {
      expect(peer.getBlock(cellId)).toMatchObject({
        id: cellId,
        tombstone: null,
      });
    }

    const reloaded = createEditor(peer.readSnapshot()).editor;
    expect(reloaded.getChildBlockIds(tableId)).toEqual(
      editor.getChildBlockIds(tableId),
    );
    expect(readColumnIds(reloaded)).toEqual(readColumnIds(editor));
  });

  it("publishes normalized legacy metadata as one remote and reload-stable transaction", () => {
    const snapshot = snapshotWithTableMetadata(
      ["duplicate", "duplicate", "unique"],
      { duplicate: 180, unique: 260 },
    );
    const { editor, changes } = createEditor(snapshot);
    const peer = createEditor(snapshot).editor;
    const originalRows = editor.getChildBlockIds(tableId);
    const originalCells = originalRows.flatMap((rowId) =>
      editor.getChildBlockIds(rowId),
    );
    const candidates = ["remote-1", "remote-2", "remote-3", "remote-4"];

    insertFirstDraftTableColumn(editor, tableId, 3, {
      createColumnId: () => candidates.shift() ?? "remote-exhausted",
    });

    expect(changes).toHaveLength(1);
    expect(
      peer.applyRemoteTransaction({
        transaction: convertEditorTransactionToTransport(changes[0]!),
        authorSelection: { kind: "no-author-selection" },
      }),
    ).toMatchObject({ status: "applied" });
    expect(readColumnIds(peer)).toEqual([
      "remote-1",
      "remote-2",
      "remote-3",
      "remote-4",
    ]);
    expect(peer.getBlock(tableId)?.metadata).toEqual(
      editor.getBlock(tableId)?.metadata,
    );
    expect(peer.getChildBlockIds(tableId)).toEqual(originalRows);
    for (const cellId of originalCells) {
      expect(peer.getBlock(cellId)).toMatchObject({
        id: cellId,
        tombstone: null,
      });
    }

    const reloaded = createEditor(peer.readSnapshot()).editor;
    expect(readColumnIds(reloaded)).toEqual(readColumnIds(editor));
    expect(reloaded.getBlock(tableId)?.metadata).toEqual(
      editor.getBlock(tableId)?.metadata,
    );
  });

  it.each(["yjs", "local"] as const)(
    "keeps a mixed structural sequence stable through repeated undo/redo in the %s runtime",
    (runtime) => {
      const definition = createFirstDraftEditorDefinition(
        createFirstDraftViewStateStore(),
      );
      const localDefinition = { ...definition };
      if (runtime === "local") delete localDefinition.content;
      const { editor, changes } = createEditor(
        createFirstDraftSnapshot(),
        localDefinition,
      );
      const before = readTableState(editor);

      const insertedRow = insertFirstDraftTableRow(editor, tableId, 1);
      const duplicatedRow = duplicateFirstDraftTableRow(
        editor,
        tableId,
        insertedRow.rowId,
      );
      const insertedColumn = insertFirstDraftTableColumn(editor, tableId, 1);
      const duplicatedColumn = duplicateFirstDraftTableColumn(editor, tableId, {
        kind: "canonical",
        columnId: insertedColumn.columnId,
      });
      deleteFirstDraftTableRow(editor, tableId, duplicatedRow.rowId);
      deleteFirstDraftTableColumn(editor, tableId, {
        kind: "canonical",
        columnId: duplicatedColumn.columnId,
      });
      const after = readTableState(editor);
      expect(changes).toHaveLength(6);

      for (let repetition = 0; repetition < 2; repetition += 1) {
        for (let index = 0; index < 6; index += 1) {
          expect(editor.undo()).toEqual({ status: "applied" });
        }
        expect(readTableState(editor)).toEqual(before);
        for (let index = 0; index < 6; index += 1) {
          expect(editor.redo()).toEqual({ status: "applied" });
        }
        expect(readTableState(editor)).toEqual(after);
      }
    },
  );

  it("rolls back all staged rows when a multi-row column mutation fails", () => {
    const { editor, changes } = createEditor(createFirstDraftSnapshot());
    const before = readTableState(editor);
    const originalInsertBlocks = editor.insertBlocks.bind(editor);
    let insertions = 0;
    vi.spyOn(editor, "insertBlocks").mockImplementation(
      (placement, fragment) => {
        const result = originalInsertBlocks(placement, fragment);
        insertions += 1;
        if (insertions === 2) throw new Error("forced staged failure");
        return result;
      },
    );

    expect(() => insertFirstDraftTableColumn(editor, tableId, 1)).toThrow(
      "forced staged failure",
    );
    expect(readTableState(editor)).toEqual(before);
    expect(changes).toEqual([]);
    expect(editor.canUndo).toBe(false);
  });
});

function createEditor(
  snapshot: EditorInstanceSnapshot,
  definition: EditableEditorDefinition = createFirstDraftEditorDefinition(
    createFirstDraftViewStateStore(),
  ),
): {
  readonly editor: FirstDraftTestEditor;
  readonly changes: EditorSemanticChange[];
} {
  const changes: EditorSemanticChange[] = [];
  const editor = initializeTestEditableEditor({
    definition,
    snapshot,
    onChange(change) {
      changes.push(change);
    },
  });
  disposables.push(editor);
  return { editor, changes };
}

function appendRow(editor: FirstDraftTestEditor) {
  const rowIds = editor.getChildBlockIds(tableId);
  return insertFirstDraftTableRow(editor, tableId, rowIds.length);
}

function appendColumn(editor: FirstDraftTestEditor) {
  const rowId = editor.getChildBlockIds(tableId)[0]!;
  return insertFirstDraftTableColumn(
    editor,
    tableId,
    editor.getChildBlockIds(rowId).length,
  );
}

function readColumnIds(editor: FirstDraftTestEditor): readonly string[] {
  const table = editor.getBlock(tableId);
  const firstRowId = editor.getChildBlockIds(tableId)[0];
  if (!table || !firstRowId) throw new Error("Missing test table");
  return resolveFirstDraftTableColumnIds(
    table.metadata,
    editor.getChildBlockIds(firstRowId).length,
  ).ids;
}

function readTableState(editor: FirstDraftTestEditor) {
  const table = editor.getBlock(tableId);
  if (!table) throw new Error("Missing test table");
  const rowIds = editor.getChildBlockIds(tableId);
  return {
    table: {
      id: table.id,
      type: table.type,
      metadata: table.metadata,
    },
    columnIds: readColumnIds(editor),
    rows: rowIds.map((rowId) => {
      const row = editor.getBlock(rowId);
      return {
        id: rowId,
        type: row?.type,
        metadata: row?.metadata,
        cells: editor.getChildBlockIds(rowId).map((cellId) => {
          const cell = editor.getBlock(cellId);
          return {
            id: cellId,
            type: cell?.type,
            metadata: cell?.metadata,
            content: editor.readBlockContent(cellId, "tableCell"),
            plainText: editor.readBlockPlainText(cellId, "tableCell"),
          };
        }),
      };
    }),
  };
}

function expectRectangularTable(
  editor: FirstDraftTestEditor,
  rowCount: number,
  columnCount: number,
): void {
  const rowIds = editor.getChildBlockIds(tableId);
  expect(rowIds).toHaveLength(rowCount);
  for (const rowId of rowIds) {
    expect(editor.getChildBlockIds(rowId)).toHaveLength(columnCount);
  }
}

function expectClearedSelection(
  editor: FirstDraftTestEditor,
  change: EditorSemanticChange,
): void {
  expect(editor.selectionController.getCanonicalSnapshot()).toMatchObject({
    kind: "none",
  });
  expect(change.selectionAfter).toEqual({ kind: "none" });
}

function applyChange(
  editor: FirstDraftTestEditor,
  change: EditorSemanticChange,
): void {
  expect(
    editor.applyRemoteTransaction({
      transaction: convertEditorTransactionToTransport(change),
      authorSelection: { kind: "no-author-selection" },
    }),
  ).toMatchObject({ status: "applied" });
}

function legacyCounterIdentitySnapshot(): EditorInstanceSnapshot {
  const source = createFirstDraftSnapshot();
  const replacements = new Map<BlockId, BlockId>([
    [asBlockId("fd-table-row-1"), asBlockId("first-draft-row-2")],
    [asBlockId("fd-table-cell-1-1"), asBlockId("first-draft-cell-3")],
  ]);
  const replace = (blockId: BlockId): BlockId =>
    replacements.get(blockId) ?? blockId;
  const blocks: EditorInstanceSnapshot["blocks"] = Object.fromEntries(
    Object.values(source.blocks).map((block) => {
      const nextId = replace(block.id);
      const metadata =
        block.id === tableId
          ? {
              ...block.metadata,
              [TABLE_COLUMN_IDS_FIELD]: [
                "first-draft-column-6",
                "fd-table-column-b",
                "fd-table-column-c",
              ],
            }
          : block.metadata;
      return [
        nextId,
        {
          ...block,
          id: nextId,
          parentId: block.parentId === null ? null : replace(block.parentId),
          ...(metadata === undefined ? {} : { metadata }),
        },
      ];
    }),
  );
  return {
    ...source,
    blocks,
    rootBlockIds: source.rootBlockIds.map(replace),
    childIdsByParentId: remapSnapshotRecord(
      source.childIdsByParentId,
      replace,
      (children) => children.map(replace),
    ),
    content: remapSnapshotRecord(source.content, replace),
    opaqueContentCheckpoints: remapSnapshotRecord(
      source.opaqueContentCheckpoints,
      replace,
    ),
  };
}

function snapshotWithTableMetadata(
  columnIds: readonly string[] | undefined,
  columnWidths: Readonly<Record<string, number>>,
): EditorInstanceSnapshot {
  const source = createFirstDraftSnapshot();
  const table = source.blocks[tableId]!;
  const metadata = {
    ...table.metadata,
    ...(columnIds === undefined
      ? {}
      : { [TABLE_COLUMN_IDS_FIELD]: [...columnIds] }),
    [TABLE_COLUMN_WIDTHS_FIELD]: { ...columnWidths },
  };
  if (columnIds === undefined) delete metadata[TABLE_COLUMN_IDS_FIELD];
  return {
    ...source,
    blocks: {
      ...source.blocks,
      [tableId]: { ...table, metadata },
    },
  };
}

function remapSnapshotRecord<Value>(
  record: Readonly<Partial<Record<BlockId, Value>>>,
  replace: (blockId: BlockId) => BlockId,
  replaceValue: (value: Value) => Value = (value) => value,
): Partial<Record<BlockId, Value>> {
  const result: Partial<Record<BlockId, Value>> = {};
  for (const key of Object.keys(record)) {
    const blockId = asBlockId(key);
    const value = record[blockId];
    if (value !== undefined) result[replace(blockId)] = replaceValue(value);
  }
  return result;
}
