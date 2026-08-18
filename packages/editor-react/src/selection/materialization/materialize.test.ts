import { describe, expect, it } from "vitest";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import { createVersionedBlockRecord } from "@repo/editor-core/metadata";
import {
  createBlockRichTextContentFromPlainText,
  extractPlainTextFromRichTextDocument,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import {
  contentSelection,
  wholeSelection,
  wrapperSelection,
  type BlockSelectionCoverage,
  type BlockSelectionFragmentDescriptor,
} from "@repo/editor-core/selection";
import type { EditorSelectionGraphReader } from "../graph/reader.ts";
import type {
  EditorLogicalSelectionPoint,
  EditorSelectionRangeBlock,
  EditorSelectionSnapshot,
} from "../model/types.ts";
import { materializeEditorSelectionFragment } from "./materialize.ts";

const renderer = () => null;
const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
  paragraph: {
    kind: "text",
    type: "paragraph",
    renderer,
    rootLayout: "normal",
    split: { default: "paragraph", listItem: "listItem" },
  },
  divider: {
    kind: "atomic",
    type: "divider",
    renderer,
    rootLayout: "normal",
  },
  quote: {
    kind: "wrapper",
    type: "quote",
    renderer,
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["paragraph"], additional: "paragraph" },
  },
  list: {
    kind: "wrapper",
    type: "list",
    renderer,
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["listItem"], additional: "listItem" },
    defaultContent: "listItem",
    list: { kind: "container", itemType: "listItem" },
  },
  listItem: {
    kind: "wrapper",
    type: "listItem",
    renderer,
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["paragraph"], additional: "block" },
    parents: { allowed: ["list"] },
    list: {
      kind: "item",
      containerType: "list",
      primaryTextChildType: "paragraph",
      emptyEnter: "lift-primary-out-of-container",
    },
  },
  columns: {
    kind: "wrapper",
    type: "columns",
    renderer,
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["column", "column"], additional: "column" },
    selection: wrapperSelection({
      fragment: { kind: "wrapper", inclusion: "multiple-selected-children" },
    }),
  },
  column: {
    kind: "wrapper",
    type: "column",
    renderer,
    rootLayout: "normal",
    contentBoundary: true,
    content: { required: ["paragraph"], additional: "block" },
    selection: wrapperSelection({
      fragment: { kind: "wrapper", inclusion: "never" },
    }),
  },
  tabs: {
    kind: "wrapper",
    type: "tabs",
    renderer,
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["tabPane"], additional: "tabPane" },
    selection: wrapperSelection({
      fragment: {
        kind: "wrapper",
        contentScope: "visible",
        preservedChildren: "all",
      },
    }),
  },
  tabPane: {
    kind: "wrapper",
    type: "tabPane",
    renderer,
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["paragraph"], additional: "block" },
    selection: wrapperSelection({
      fragment: { kind: "wrapper", inclusion: "never" },
    }),
  },
  toggle: {
    kind: "wrapper",
    type: "toggle",
    renderer,
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["paragraph", "toggleBody"] },
    selection: wrapperSelection({
      fragment: {
        kind: "wrapper",
        contentScope: "visible",
        preservedChildren: "all",
      },
    }),
  },
  toggleBody: {
    kind: "wrapper",
    type: "toggleBody",
    renderer,
    rootLayout: "normal",
    contentBoundary: false,
    content: { required: ["paragraph"], additional: "block" },
    selection: wrapperSelection({
      fragment: { kind: "wrapper", inclusion: "never" },
    }),
  },
};

describe("selection canonical-fragment materialization", () => {
  it("slices partial text, allocates a new id, and uses open boundaries", () => {
    const sourceId = id(1);
    const graphFixture = fixture([
      {
        id: sourceId,
        type: "paragraph",
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "hello " },
                {
                  type: "text",
                  text: "world",
                  marks: [{ type: "strong" }],
                },
              ],
            },
          ],
        },
      },
    ]);
    const result = materialize(
      graphFixture,
      snapshot([
        range(sourceId, "paragraph", "partial", { kind: "content" }, 6, 11),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fragment.blocks).toHaveLength(1);
    expect(result.fragment.blocks[0]).toMatchObject({
      type: "paragraph",
      plainText: "world",
      content: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "world",
                marks: [{ type: "strong" }],
              },
            ],
          },
        ],
      },
    });
    expect(result.fragment.blocks[0]?.id).not.toBe(sourceId);
    expect(result.fragment.start.kind).toBe("text");
    expect(result.fragment.end.kind).toBe("text");
    const serialized = JSON.stringify(result.fragment);
    expect(serialized).not.toContain(sourceId);
    expect(serialized).not.toContain("coverage");
  });

  it("distinguishes complete text content from a complete text block", () => {
    const sourceId = id(2);
    const graphFixture = fixture([
      { id: sourceId, type: "paragraph", text: "complete" },
    ]);
    const content = materialize(
      graphFixture,
      snapshot([
        range(sourceId, "paragraph", "complete-content", { kind: "content" }),
      ]),
    );
    const block = materialize(
      graphFixture,
      snapshot([
        range(sourceId, "paragraph", "complete-block", { kind: "block" }),
      ]),
    );
    expect(content.ok && content.fragment.blocks[0]?.plainText).toBe(
      "complete",
    );
    expect(content.ok && content.fragment.start.kind).toBe("text");
    expect(block.ok && block.fragment.start.kind).toBe("block");
    expect(block.ok && block.fragment.end.kind).toBe("block");
  });

  it("materializes an atomic block without text fields", () => {
    const sourceId = id(3);
    const result = materialize(
      fixture([{ id: sourceId, type: "divider" }]),
      snapshot([
        range(sourceId, "divider", "complete-block", { kind: "block" }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fragment.blocks[0]).toMatchObject({ type: "divider" });
    expect(result.fragment.blocks[0]).not.toHaveProperty("content");
    expect(result.fragment.blocks[0]).not.toHaveProperty("plainText");
    expect(result.fragment.start.kind).toBe("block");
  });

  it("unwraps a wrapper when only some of its contents are selected", () => {
    const quote = id(10);
    const first = id(11);
    const second = id(12);
    const graph = fixture([
      { id: quote, type: "quote", children: [first, second] },
      { id: first, type: "paragraph", parentId: quote, text: "first" },
      { id: second, type: "paragraph", parentId: quote, text: "second" },
    ]);
    const wrapperRange = range(quote, "quote", "partial", { kind: "wrapper" });
    wrapperRange.coverageResult = {
      ...wrapperRange.coverageResult,
      childCoverages: [{ blockId: first, coverage: "complete-content" }],
    };
    const result = materialize(
      graph,
      snapshot([
        wrapperRange,
        range(first, "paragraph", "complete-content", { kind: "content" }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fragment.blocks.map((block) => block.type)).toEqual([
      "paragraph",
    ]);
    expect(result.fragment.blocks[0]?.parentId).toBeNull();
    expect(result.fragment.blocks.map((block) => block.id)).not.toContain(
      first,
    );
  });

  it("preserves a wrapper only when endpoint offsets cover every child completely", () => {
    const quote = id(13);
    const first = id(14);
    const second = id(15);
    const graph = fixture([
      { id: quote, type: "quote", children: [first, second] },
      { id: first, type: "paragraph", parentId: quote, text: "first" },
      { id: second, type: "paragraph", parentId: quote, text: "second" },
    ]);
    const result = materialize(
      graph,
      snapshot([
        range(first, "paragraph", "partial", { kind: "content" }, 0),
        range(
          second,
          "paragraph",
          "partial",
          { kind: "content" },
          undefined,
          6,
        ),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fragment.blocks.map((block) => block.type)).toEqual([
      "quote",
      "paragraph",
      "paragraph",
    ]);
    expect(
      result.fragment.blocks.slice(1).map((block) => block.parentId),
    ).toEqual([result.fragment.blocks[0]?.id, result.fragment.blocks[0]?.id]);
  });

  it("preserves multi-root order and mixed outer boundary semantics", () => {
    const first = id(20);
    const second = id(21);
    const graph = fixture([
      { id: first, type: "paragraph", text: "alpha" },
      { id: second, type: "paragraph", text: "beta" },
    ]);
    const result = materialize(
      graph,
      snapshot([
        range(first, "paragraph", "partial", { kind: "content" }, 1, 5),
        range(second, "paragraph", "complete-block", { kind: "block" }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.fragment.rootBlockIds.map(
        (rootId) =>
          result.fragment.blocks.find((block) => block.id === rootId)
            ?.plainText,
      ),
    ).toEqual(["lpha", "beta"]);
    expect(result.fragment.start.kind).toBe("text");
    expect(result.fragment.end.kind).toBe("block");
  });

  it("wraps selected canonical list items in one declared container", () => {
    const list = id(30);
    const firstItem = id(31);
    const firstText = id(32);
    const secondItem = id(33);
    const secondText = id(34);
    const graph = fixture([
      { id: list, type: "list", children: [firstItem, secondItem] },
      {
        id: firstItem,
        type: "listItem",
        parentId: list,
        children: [firstText],
      },
      { id: firstText, type: "paragraph", parentId: firstItem, text: "A" },
      {
        id: secondItem,
        type: "listItem",
        parentId: list,
        children: [secondText],
      },
      { id: secondText, type: "paragraph", parentId: secondItem, text: "B" },
    ]);
    const result = materialize(
      graph,
      snapshot([
        range(firstItem, "listItem", "complete-block", { kind: "block" }),
        range(secondItem, "listItem", "complete-block", { kind: "block" }),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fragment.rootBlockIds).toHaveLength(1);
    expect(result.fragment.blocks.map((block) => block.type)).toEqual([
      "list",
      "listItem",
      "paragraph",
      "listItem",
      "paragraph",
    ]);
    const containerId = result.fragment.rootBlockIds[0]!;
    expect(
      result.fragment.blocks
        .filter((block) => block.type === "listItem")
        .map((block) => block.parentId),
    ).toEqual([containerId, containerId]);
  });

  it("keeps a list container for one fully selected item but unwraps a partial item", () => {
    const list = id(40);
    const firstItem = id(41);
    const firstText = id(42);
    const secondItem = id(43);
    const secondText = id(44);
    const graph = fixture([
      { id: list, type: "list", children: [firstItem, secondItem] },
      {
        id: firstItem,
        type: "listItem",
        parentId: list,
        children: [firstText],
      },
      { id: firstText, type: "paragraph", parentId: firstItem, text: "Alpha" },
      {
        id: secondItem,
        type: "listItem",
        parentId: list,
        children: [secondText],
      },
      { id: secondText, type: "paragraph", parentId: secondItem, text: "Beta" },
    ]);

    const complete = materialize(
      graph,
      snapshot([
        range(firstText, "paragraph", "partial", { kind: "content" }, 0, 5),
      ]),
    );
    expect(complete.ok).toBe(true);
    if (complete.ok) {
      expect(complete.fragment.blocks.map((block) => block.type)).toEqual([
        "list",
        "listItem",
        "paragraph",
      ]);
    }

    const partial = materialize(
      graph,
      snapshot([
        range(firstText, "paragraph", "partial", { kind: "content" }, 2, 5),
      ]),
    );
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      expect(partial.fragment.blocks.map((block) => block.type)).toEqual([
        "paragraph",
      ]);
      expect(partial.fragment.blocks[0]?.plainText).toBe("pha");
    }
  });

  it("unwraps one selected column and preserves the selected lane count for multiple columns", () => {
    const columns = id(50);
    const firstColumn = id(51);
    const firstText = id(52);
    const secondColumn = id(53);
    const secondText = id(54);
    const graph = fixture([
      { id: columns, type: "columns", children: [firstColumn, secondColumn] },
      {
        id: firstColumn,
        type: "column",
        parentId: columns,
        children: [firstText],
      },
      {
        id: firstText,
        type: "paragraph",
        parentId: firstColumn,
        text: "Alpha",
      },
      {
        id: secondColumn,
        type: "column",
        parentId: columns,
        children: [secondText],
      },
      {
        id: secondText,
        type: "paragraph",
        parentId: secondColumn,
        text: "Beta",
      },
    ]);
    const columnsFragment = {
      kind: "wrapper",
      inclusion: "multiple-selected-children",
    } as const;
    const transparent = { kind: "wrapper", inclusion: "never" } as const;

    const single = materialize(
      graph,
      snapshot([
        range(columns, "columns", "partial", columnsFragment),
        range(firstColumn, "column", "partial", transparent),
        range(firstText, "paragraph", "partial", { kind: "content" }, 2, 5),
      ]),
    );
    expect(single.ok).toBe(true);
    if (single.ok) {
      expect(single.fragment.blocks.map((block) => block.type)).toEqual([
        "paragraph",
      ]);
    }

    const multiple = materialize(
      graph,
      snapshot([
        range(columns, "columns", "partial", columnsFragment),
        range(firstColumn, "column", "partial", transparent),
        range(firstText, "paragraph", "partial", { kind: "content" }, 2),
        range(secondColumn, "column", "partial", transparent),
        range(
          secondText,
          "paragraph",
          "partial",
          { kind: "content" },
          undefined,
          2,
        ),
      ]),
    );
    expect(multiple.ok).toBe(true);
    if (multiple.ok) {
      expect(multiple.fragment.blocks.map((block) => block.type)).toEqual([
        "columns",
        "column",
        "paragraph",
        "column",
        "paragraph",
      ]);
    }
  });

  it("copies all tabs when the visible pane is complete and unwraps a partial pane", () => {
    const tabs = id(60);
    const firstPane = id(61);
    const firstText = id(62);
    const secondPane = id(63);
    const secondText = id(64);
    const graph = fixture([
      { id: tabs, type: "tabs", children: [firstPane, secondPane] },
      { id: firstPane, type: "tabPane", parentId: tabs, children: [firstText] },
      { id: firstText, type: "paragraph", parentId: firstPane, text: "Hidden" },
      {
        id: secondPane,
        type: "tabPane",
        parentId: tabs,
        children: [secondText],
      },
      {
        id: secondText,
        type: "paragraph",
        parentId: secondPane,
        text: "Visible",
      },
    ]);
    const tabsFragment = {
      kind: "wrapper",
      contentScope: "visible",
      preservedChildren: "all",
    } as const;
    const transparent = { kind: "wrapper", inclusion: "never" } as const;
    const visibleSecond = ({
      blockType,
      childBlockIds,
    }: {
      blockType: BlockType;
      childBlockIds: readonly BlockId[];
    }) => (blockType === "tabs" ? [secondPane] : childBlockIds);

    const complete = materialize(
      graph,
      snapshot([
        range(tabs, "tabs", "partial", tabsFragment),
        range(secondPane, "tabPane", "partial", transparent),
        range(secondText, "paragraph", "partial", { kind: "content" }, 0, 7),
      ]),
      visibleSecond,
    );
    expect(complete.ok).toBe(true);
    if (complete.ok) {
      expect(complete.fragment.blocks.map((block) => block.type)).toEqual([
        "tabs",
        "tabPane",
        "paragraph",
        "tabPane",
        "paragraph",
      ]);
    }

    const partial = materialize(
      graph,
      snapshot([
        range(tabs, "tabs", "partial", tabsFragment),
        range(secondPane, "tabPane", "partial", transparent),
        range(secondText, "paragraph", "partial", { kind: "content" }, 2, 7),
      ]),
      visibleSecond,
    );
    expect(partial.ok).toBe(true);
    if (partial.ok) {
      expect(partial.fragment.blocks.map((block) => block.type)).toEqual([
        "paragraph",
      ]);
      expect(partial.fragment.blocks[0]?.plainText).toBe("sible");
    }
  });

  it("copies a collapsed toggle whole and unwraps an incomplete expanded toggle body", () => {
    const toggle = id(70);
    const summary = id(71);
    const body = id(72);
    const bodyText = id(73);
    const graph = fixture([
      { id: toggle, type: "toggle", children: [summary, body] },
      { id: summary, type: "paragraph", parentId: toggle, text: "Summary" },
      { id: body, type: "toggleBody", parentId: toggle, children: [bodyText] },
      { id: bodyText, type: "paragraph", parentId: body, text: "Body" },
    ]);
    const toggleFragment = {
      kind: "wrapper",
      contentScope: "visible",
      preservedChildren: "all",
    } as const;
    const transparent = { kind: "wrapper", inclusion: "never" } as const;

    const collapsed = materialize(
      graph,
      snapshot([
        range(toggle, "toggle", "partial", toggleFragment),
        range(summary, "paragraph", "partial", { kind: "content" }, 0, 7),
      ]),
      ({ blockType, childBlockIds }) =>
        blockType === "toggle" ? childBlockIds.slice(0, 1) : childBlockIds,
    );
    expect(collapsed.ok).toBe(true);
    if (collapsed.ok) {
      expect(collapsed.fragment.blocks.map((block) => block.type)).toEqual([
        "toggle",
        "paragraph",
        "toggleBody",
        "paragraph",
      ]);
    }

    const expandedPartial = materialize(
      graph,
      snapshot([
        range(toggle, "toggle", "partial", toggleFragment),
        range(summary, "paragraph", "partial", { kind: "content" }, 3, 7),
        range(body, "toggleBody", "complete-content", transparent),
        range(bodyText, "paragraph", "complete-content", { kind: "content" }),
      ]),
    );
    expect(expandedPartial.ok).toBe(true);
    if (expandedPartial.ok) {
      expect(
        expandedPartial.fragment.blocks.map((block) => block.type),
      ).toEqual(["paragraph", "paragraph"]);
      expect(
        expandedPartial.fragment.blocks.map((block) => block.plainText),
      ).toEqual(["mary", "Body"]);
    }
  });
});

interface FixtureBlock {
  readonly id: BlockId;
  readonly type: BlockType;
  readonly parentId?: BlockId | null;
  readonly children?: readonly BlockId[];
  readonly text?: string;
  readonly content?: RichTextDocumentNodeJson;
}

function fixture(input: readonly FixtureBlock[]) {
  const blocks: Record<BlockId, VersionedBlock> = {};
  const children: Partial<Record<BlockId, readonly BlockId[]>> = {};
  const content = new Map<BlockId, RichTextDocumentNodeJson>();
  for (const item of input) {
    blocks[item.id] = createVersionedBlockRecord({
      id: item.id,
      type: item.type,
      parentId: item.parentId ?? null,
    });
    if (item.children) children[item.id] = item.children;
    if (item.content !== undefined) {
      content.set(item.id, item.content);
    } else if (item.text !== undefined) {
      content.set(
        item.id,
        createBlockRichTextContentFromPlainText(item.type, item.text),
      );
    }
  }
  const roots = input
    .filter((item) => (item.parentId ?? null) === null)
    .map((item) => item.id);
  const graph = {
    getBlock: (blockId: BlockId) => blocks[blockId] ?? null,
    getParentId: (blockId: BlockId) => blocks[blockId]?.parentId ?? null,
    getRootBlockIds: () => roots,
    getChildBlockIds: (blockId: BlockId) => children[blockId] ?? [],
    readBlockSelectionModel: (blockId: BlockId) => {
      const type = blocks[blockId]?.type;
      const configured = type ? definitions[type]?.selection : undefined;
      if (configured) return configured;
      if (type === "paragraph") return contentSelection();
      if (type && definitions[type]?.kind === "wrapper")
        return wrapperSelection();
      return wholeSelection();
    },
  } satisfies EditorSelectionGraphReader;
  return {
    graph,
    readBlockContent: (blockId: BlockId) => content.get(blockId) ?? null,
    readBlockPlainText: (blockId: BlockId) => {
      const value = content.get(blockId);
      return value ? extractPlainTextFromRichTextDocument(value) : "";
    },
  };
}

function materialize(
  value: ReturnType<typeof fixture>,
  selection: EditorSelectionSnapshot,
  resolveVisibleChildBlockIds?: NonNullable<
    Parameters<
      typeof materializeEditorSelectionFragment
    >[0]["resolveVisibleChildBlockIds"]
  >,
) {
  return materializeEditorSelectionFragment({
    snapshot: selection,
    graph: value.graph,
    graphRevision: 1,
    readBlockContent: value.readBlockContent,
    readBlockPlainText: value.readBlockPlainText,
    blockDefinitions: definitions,
    resolveVisibleChildBlockIds,
  });
}

function range(
  blockId: BlockId,
  blockType: BlockType,
  coverage: Exclude<BlockSelectionCoverage, "none">,
  descriptor: BlockSelectionFragmentDescriptor,
  startOffset?: number,
  endOffset?: number,
): EditorSelectionRangeBlock {
  const category =
    definitions[blockType]?.kind === "text"
      ? "text"
      : definitions[blockType]?.kind === "wrapper"
        ? "wrapper"
        : "object";
  return {
    blockId,
    blockType,
    category,
    coverage,
    coverageResult: {
      blockId,
      blockType,
      modelId: descriptor.kind,
      coverage,
      fragment: descriptor,
      edit: { kind: descriptor.kind === "custom" ? "custom" : descriptor.kind },
    },
    selectable: true,
    ...(startOffset === undefined ? {} : { startOffset }),
    ...(endOffset === undefined ? {} : { endOffset }),
  };
}

function snapshot(
  rangeBlocks: readonly EditorSelectionRangeBlock[],
): EditorSelectionSnapshot {
  const textRanges = rangeBlocks.filter((block) => block.category === "text");
  const start = point(textRanges[0] ?? rangeBlocks[0]!);
  const end = point(textRanges[textRanges.length - 1] ?? rangeBlocks.at(-1)!);
  return {
    phase: "committed",
    selectionRevision: 1,
    graphRevision: 1,
    lastInvalidationReason: null,
    direction: "forward",
    anchor: start,
    focus: end,
    normalizedStart: start,
    normalizedEnd: end,
    rangeBlocks,
  };
}

function point(
  rangeBlock: EditorSelectionRangeBlock,
): EditorLogicalSelectionPoint {
  return {
    blockId: rangeBlock.blockId,
    blockType: rangeBlock.blockType,
    blockCategory: rangeBlock.category,
    textOffset: rangeBlock.startOffset ?? 0,
    textAnchor: null,
    affinity: null,
  };
}

function id(value: number): BlockId {
  return asBlockId(
    `01890f07-1c00-7000-8000-${String(value).padStart(12, "0")}`,
  );
}
