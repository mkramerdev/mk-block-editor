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

  it("preserves selected wrapper structure and only selected children", () => {
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
      "quote",
      "paragraph",
    ]);
    expect(result.fragment.blocks[1]?.parentId).toBe(
      result.fragment.blocks[0]?.id,
    );
    expect(result.fragment.blocks.map((block) => block.id)).not.toContain(
      first,
    );
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
      if (type === "paragraph") return contentSelection();
      if (type === "quote" || type === "list" || type === "listItem")
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
) {
  return materializeEditorSelectionFragment({
    snapshot: selection,
    graph: value.graph,
    graphRevision: 1,
    readBlockContent: value.readBlockContent,
    readBlockPlainText: value.readBlockPlainText,
    blockDefinitions: definitions,
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
  const start = point(rangeBlocks[0]!);
  const end = point(rangeBlocks[rangeBlocks.length - 1]!);
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
