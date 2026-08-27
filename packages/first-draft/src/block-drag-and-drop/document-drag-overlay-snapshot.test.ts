import { describe, expect, it, vi } from "vitest";
import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import type { VersionedBlock } from "@repo/editor-core/document";
import { asBlockId, type BlockId, type JsonObject } from "@repo/editor-core/kernel";
import type {
  FirstDraftBlockDragPreviewEditor,
  FirstDraftBlockDragPreviewViewState,
  FirstDraftBlockType,
} from "./document-drag-overlay-contracts.ts";
import { resolveFirstDraftBlockDragPreview } from "./document-drag-overlay-snapshot.ts";

const id = asBlockId;

function block(
  value: string,
  type: FirstDraftBlockType,
  parentId: string | null,
  metadata?: JsonObject,
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

function text(value: string): RichTextDocumentNodeJson {
  return {
    type: "doc",
    content: [{
      type: "paragraph",
      content: value ? [{ type: "text", text: value }] : [],
    }],
  };
}

class PreviewGraph implements FirstDraftBlockDragPreviewEditor {
  readonly getBlock = vi.fn((blockId: BlockId) => this.blocks.get(blockId) ?? null);
  readonly getParentId = vi.fn((blockId: BlockId) => this.blocks.get(blockId)?.parentId ?? null);
  readonly getChildBlockIds = vi.fn((parentId: BlockId) => this.children.get(parentId) ?? []);
  readonly readBlockContent = vi.fn((blockId: BlockId) => this.content.get(blockId) ?? null);

  constructor(
    readonly blocks: ReadonlyMap<BlockId, VersionedBlock>,
    readonly children: ReadonlyMap<BlockId, readonly BlockId[]>,
    readonly content: ReadonlyMap<BlockId, RichTextDocumentNodeJson>,
  ) {}
}

function graph(
  blocks: readonly VersionedBlock[],
  children: Readonly<Record<string, readonly string[]>> = {},
  content: Readonly<Record<string, RichTextDocumentNodeJson>> = {},
) {
  return new PreviewGraph(
    new Map(blocks.map((record) => [record.id, record])),
    new Map(
      Object.entries(children).map(([parentId, childIds]) => [
        id(parentId),
        childIds.map(id),
      ]),
    ),
    new Map(Object.entries(content).map(([blockId, value]) => [id(blockId), value])),
  );
}

function viewState(input: {
  readonly collapsed?: readonly string[];
  readonly selectedTabs?: Readonly<Record<string, string>>;
} = {}) {
  const selectedTabs = Object.fromEntries(
    Object.entries(input.selectedTabs ?? {}).map(([owner, pane]) => [id(owner), id(pane)]),
  ) as Readonly<Record<BlockId, BlockId>>;
  const collapsed = new Set((input.collapsed ?? []).map(id));
  return {
    getSelectedTab: vi.fn(
      (tabsId: BlockId) => selectedTabs[tabsId] ?? null,
    ),
    isBlockCollapsed: vi.fn((blockId: BlockId) => collapsed.has(blockId)),
  } satisfies FirstDraftBlockDragPreviewViewState;
}

function unrelatedViewState(entryCount: number) {
  return viewState({
    collapsed: Array.from({ length: entryCount }, (_, index) =>
      `unrelated-toggle-${index}`,
    ),
    selectedTabs: Object.fromEntries(
      Array.from({ length: entryCount }, (_, index) => [
        `unrelated-tabs-${index}`,
        `unrelated-pane-${index}`,
      ]),
    ),
  });
}

function expectOrdinaryLeafReadCounts(editor: PreviewGraph): void {
  expect(editor.getBlock).toHaveBeenCalledTimes(1);
  expect(editor.getParentId).toHaveBeenCalledTimes(1);
  expect(editor.getChildBlockIds).toHaveBeenCalledTimes(1);
  expect(editor.readBlockContent).toHaveBeenCalledTimes(1);
}

describe("resolveFirstDraftBlockDragPreview", () => {
  it.each([10, 100, 1_000])(
    "does constant graph and view-state work with %i unrelated entries",
    (entryCount) => {
      const editor = graph(
        [block("source", "paragraph", null)],
        {},
        { source: text("bounded") },
      );
      const state = unrelatedViewState(entryCount);

      expect(
        resolveFirstDraftBlockDragPreview(editor, state, id("source")),
      ).not.toBeNull();

      expectOrdinaryLeafReadCounts(editor);
      expect(state.getSelectedTab).not.toHaveBeenCalled();
      expect(state.isBlockCollapsed).not.toHaveBeenCalled();
    },
  );

  it("reads only visited toggle and tabs presentation state", () => {
    const editor = graph(
      [
        block("toggle", "toggleListItem", null),
        block("summary", "paragraph", "toggle"),
        block("body", "toggleListItemBody", "toggle"),
        block("tabs", "tabs", "body"),
        block("pane-a", "tabPane", "tabs"),
        block("pane-b", "tabPane", "tabs"),
      ],
      {
        toggle: ["summary", "body"],
        body: ["tabs"],
        tabs: ["pane-a", "pane-b"],
      },
      { summary: text("Summary") },
    );
    const state = viewState({
      collapsed: ["toggle", "unrelated-toggle"],
      selectedTabs: {
        tabs: "missing-pane",
        "unrelated-tabs": "unrelated-pane",
      },
    });

    const result = resolveFirstDraftBlockDragPreview(
      editor,
      state,
      id("toggle"),
    );

    expect(result?.presentation.collapsed).toBe(true);
    expect(result?.children[1]?.children[0]?.presentation.selectedTabPaneId).toBe(
      id("pane-a"),
    );
    expect(state.isBlockCollapsed).toHaveBeenCalledTimes(1);
    expect(state.isBlockCollapsed).toHaveBeenCalledWith(id("toggle"));
    expect(state.getSelectedTab).toHaveBeenCalledTimes(1);
    expect(state.getSelectedTab).toHaveBeenCalledWith(id("tabs"));
  });
  it("captures text immutably without whole-document traversal or mutation", () => {
    const content = text("captured");
    const source = block("source", "paragraph", null);
    const unrelated = block("unrelated", "paragraph", null);
    const editor = graph([source, unrelated], {}, { source: content, unrelated: text("ignored") });
    const beforeBlock = JSON.stringify(source);
    const beforeContent = JSON.stringify(content);

    const result = resolveFirstDraftBlockDragPreview(editor, viewState(), source.id);

    expect(result?.block).toEqual(source);
    expect(result?.content).toEqual(content);
    expect(result?.children).toEqual([]);
    expect(editor.getBlock.mock.calls.some(([blockId]) => blockId === unrelated.id)).toBe(false);
    expect(editor.readBlockContent).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(source)).toBe(beforeBlock);
    expect(JSON.stringify(content)).toBe(beforeContent);
    expectDeepFrozen(result);
  });

  it("preserves canonical order, deep descendants, and standalone ordered-list context", () => {
    const records = [
      block("list", "orderedList", null),
      block("item-a", "orderedListItem", "list"),
      block("item-b", "orderedListItem", "list"),
      block("text-a", "paragraph", "item-a"),
      block("text-b", "paragraph", "item-b"),
      block("nested", "bulletList", "item-b"),
      block("nested-item", "bulletListItem", "nested"),
      block("nested-text", "paragraph", "nested-item"),
    ];
    const editor = graph(records, {
      list: ["item-a", "item-b"],
      "item-a": ["text-a"],
      "item-b": ["text-b", "nested"],
      nested: ["nested-item"],
      "nested-item": ["nested-text"],
    }, {
      "text-a": text("first"),
      "text-b": text("second"),
      "nested-text": text("deep"),
    });

    const whole = resolveFirstDraftBlockDragPreview(editor, viewState(), id("list"));
    expect(whole?.children.map((child) => child.block.id)).toEqual([id("item-a"), id("item-b")]);
    expect(whole?.children[1]?.children[1]?.children[0]?.children[0]?.content).toEqual(text("deep"));
    expect(whole?.children[0]?.presentation.orderedListOrdinal).toBe(1);
    expect(whole?.children[1]?.presentation.orderedListOrdinal).toBe(2);

    const item = resolveFirstDraftBlockDragPreview(editor, viewState(), id("item-b"));
    expect(item?.presentation.orderedListOrdinal).toBe(2);
    expect(item?.children.map((child) => child.block.id)).toEqual([id("text-b"), id("nested")]);
  });

  it("captures collapsed/expanded toggles and selected tab presentation once", () => {
    const records = [
      block("toggle", "toggleHeading", null),
      block("summary", "heading", "toggle", { level: 2 }),
      block("body", "toggleHeadingBody", "toggle"),
      block("body-text", "paragraph", "body"),
      block("tabs", "tabs", null),
      block("pane-a", "tabPane", "tabs", { title: "A" }),
      block("pane-b", "tabPane", "tabs", { title: "B" }),
      block("pane-a-text", "paragraph", "pane-a"),
      block("pane-b-text", "paragraph", "pane-b"),
    ];
    const editor = graph(records, {
      toggle: ["summary", "body"],
      body: ["body-text"],
      tabs: ["pane-a", "pane-b"],
      "pane-a": ["pane-a-text"],
      "pane-b": ["pane-b-text"],
    }, {
      summary: text("Summary"),
      "body-text": text("Body"),
      "pane-a-text": text("Inactive"),
      "pane-b-text": text("Selected"),
    });

    const collapsed = resolveFirstDraftBlockDragPreview(editor, viewState({ collapsed: ["toggle"] }), id("toggle"));
    const expanded = resolveFirstDraftBlockDragPreview(editor, viewState(), id("toggle"));
    const tabs = resolveFirstDraftBlockDragPreview(editor, viewState({ selectedTabs: { tabs: "pane-b" } }), id("tabs"));

    expect(collapsed?.presentation.collapsed).toBe(true);
    expect(collapsed?.children[0]?.presentation.headingLevel).toBe(2);
    expect(collapsed?.children[1]?.children[0]?.content).toEqual(text("Body"));
    expect(expanded?.presentation.collapsed).toBe(false);
    expect(tabs?.presentation.selectedTabPaneId).toBe(id("pane-b"));
    expect(tabs?.children.map((pane) => pane.block.id)).toEqual([id("pane-a"), id("pane-b")]);
  });

  it("captures ordered column weights and complete rectangular table metadata", () => {
    const columnsEditor = graph([
      block("columns", "columns", null),
      block("left", "column", "columns", { layoutWeight: 2 }),
      block("right", "column", "columns", { layoutWeight: 1 }),
      block("left-text", "paragraph", "left"),
      block("right-text", "paragraph", "right"),
    ], {
      columns: ["left", "right"],
      left: ["left-text"],
      right: ["right-text"],
    }, { "left-text": text("Left"), "right-text": text("Right") });
    const columns = resolveFirstDraftBlockDragPreview(columnsEditor, viewState(), id("columns"));
    expect(columns?.presentation.columns).toEqual({
      tracks: "minmax(0, 2fr) minmax(0, 1fr)",
      orderedColumnIds: [id("left"), id("right")],
      weights: [2, 1],
    });

    const tableEditor = graph([
      block("table", "table", null, {
        columnIds: ["name", "value"],
        columnWidths: { name: 210, value: 260 },
      }),
      block("row-a", "tableRow", "table"),
      block("row-b", "tableRow", "table"),
      block("a1", "tableCell", "row-a"),
      block("a2", "tableCell", "row-a"),
      block("b1", "tableCell", "row-b"),
      block("b2", "tableCell", "row-b"),
    ], {
      table: ["row-a", "row-b"],
      "row-a": ["a1", "a2"],
      "row-b": ["b1", "b2"],
    }, { a1: text("A1"), a2: text("A2"), b1: text("B1"), b2: text("B2") });
    const table = resolveFirstDraftBlockDragPreview(tableEditor, viewState(), id("table"));
    expect(table?.presentation.table).toEqual({
      columnIds: ["name", "value"],
      columnWidths: { name: 210, value: 260 },
      tracks: "210px 260px",
      rowCount: 2,
      columnCount: 2,
    });
    expect(table?.children.map((row) => row.block.id)).toEqual([id("row-a"), id("row-b")]);
    expect(table?.children[1]?.children.map((cell) => cell.block.id)).toEqual([id("b1"), id("b2")]);
    tableEditor.getBlock.mockClear();
    const standaloneRow = resolveFirstDraftBlockDragPreview(
      tableEditor,
      viewState(),
      id("row-b"),
    );
    expect(standaloneRow?.presentation.table?.tracks).toBe("210px 260px");
    expect(
      tableEditor.getBlock.mock.calls.some(([blockId]) => blockId === id("row-a")),
    ).toBe(false);
  });

  it("rejects missing, mismatched, duplicated, cyclic, and malformed membership", () => {
    const missingSource = graph([]);
    expect(resolveFirstDraftBlockDragPreview(missingSource, viewState(), id("missing"))).toBeNull();

    const missingChild = graph([block("callout", "callout", null)], { callout: ["ghost"] });
    expect(resolveFirstDraftBlockDragPreview(missingChild, viewState(), id("callout"))).toBeNull();

    const mismatch = graph([
      block("callout", "callout", null),
      block("text", "paragraph", null),
    ], { callout: ["text"] }, { text: text("wrong parent") });
    expect(resolveFirstDraftBlockDragPreview(mismatch, viewState(), id("callout"))).toBeNull();

    const duplicate = graph([
      block("callout", "callout", null),
      block("text", "paragraph", "callout"),
    ], { callout: ["text", "text"] }, { text: text("duplicate") });
    expect(resolveFirstDraftBlockDragPreview(duplicate, viewState(), id("callout"))).toBeNull();

    const cyclic = graph([
      block("a", "callout", "b"),
      block("b", "callout", "a"),
    ], { a: ["b"], b: ["a"] });
    expect(resolveFirstDraftBlockDragPreview(cyclic, viewState(), id("a"))).toBeNull();
  });
});

function expectDeepFrozen(value: unknown): void {
  if (!value || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeepFrozen(child);
}
