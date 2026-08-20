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
  appendFirstDraftTableColumn,
  appendFirstDraftTableRow,
  resizeFirstDraftTableColumn,
} from "./mutations.ts";

const tableId = asBlockId("fd-table");
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
    expectRectangularTable(editor, 4, 4);
  });

  it("allocates canonical structural ids and a separate unique column id", () => {
    const initial = createFirstDraftSnapshot();
    const initialIds = new Set(Object.keys(initial.blocks));
    const { editor, changes } = createEditor(initial);

    const row = appendRow(editor);
    expect(row).not.toBeNull();
    if (!row) throw new Error("Expected a row append");
    expect(changes).toHaveLength(1);
    expectSelection(editor, row.cellIds[0]!);

    const column = appendColumn(editor);
    expect(changes).toHaveLength(2);
    expectSelection(editor, column.cellIds[0]!);

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
    expectRectangularTable(editor, 4, 4);
    for (const cellId of [...row.cellIds, ...column.cellIds]) {
      expect(editor.readBlockPlainText(cellId, "tableCell")).toBe("");
    }
  });

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
    expectRectangularTable(editor, 4, 4);
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

      const result = appendFirstDraftTableColumn(editor, tableId, {
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
      appendFirstDraftTableColumn(editor, tableId, {
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
    expectRectangularTable(second, 5, 5);
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
      const expectedSelection = result.cellIds[0]!;

      expect(result.transaction).toMatchObject({ ok: true, changed: true });
      expect(changes).toHaveLength(1);
      expectSelection(editor, expectedSelection);
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
      expectSelection(editor, expectedSelection);

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
      appendFirstDraftTableRow(editor, tableId, 3, 3, {
        createBlockId: collision,
      }),
    ).toThrow("unable to allocate a unique block id for table mutation");
    expect(() =>
      appendFirstDraftTableColumn(editor, tableId, {
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
      appendFirstDraftTableRow(editor, tableId, 3, 3, {
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

    appendFirstDraftTableColumn(editor, tableId, {
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
  const columnCount = editor.getChildBlockIds(rowIds[0]!).length;
  return appendFirstDraftTableRow(editor, tableId, rowIds.length, columnCount);
}

function appendColumn(editor: FirstDraftTestEditor) {
  return appendFirstDraftTableColumn(editor, tableId);
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

function expectSelection(editor: FirstDraftTestEditor, blockId: BlockId): void {
  expect(editor.selectionController.getCanonicalSnapshot()).toMatchObject({
    kind: "document",
    snapshot: {
      endpoints: {
        anchor: { blockId, textOffset: 0 },
        head: { blockId, textOffset: 0 },
      },
    },
  });
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
