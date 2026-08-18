import { describe, expect, it } from "vitest";
import {
  createBlockRichTextContentFromPlainText,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import { createVersionedBlockRecord } from "@repo/editor-core/metadata";
import {
  contentSelection,
  wholeSelection,
  wrapperSelection,
} from "@repo/editor-core/selection";
import type { EditorSelectionGraphReader } from "../graph/reader.ts";
import type {
  EditorLogicalSelectionPoint,
  EditorSelectionRangeBlock,
  EditorSelectionSnapshot,
} from "../model/types.ts";
import { resolveStructuralEditRange } from "./resolve-structural-edit-range.ts";

const list = blockId(1);
const firstItem = blockId(2);
const firstParagraph = blockId(3);
const secondItem = blockId(4);
const secondParagraph = blockId(5);

const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
  list: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "list",
    content: { required: ["listItem"], additional: "listItem" },
    defaultContent: "listItem",
    contentBoundary: false,
  },
  listItem: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "listItem",
    content: { required: ["paragraph"], additional: "block" },
    contentBoundary: false,
  },
  paragraph: {
    kind: "text",
    rootLayout: "normal",
    type: "paragraph",
  },
};

describe("resolveStructuralEditRange", () => {
  it("omits descendants when their completely selected ancestor is deleted", () => {
    const fixture = graphFixture();
    const result = resolveStructuralEditRange({
      snapshot: snapshot([
        range(list, "list", "complete-content", "wrapper"),
        range(firstItem, "listItem", "complete-block", "block"),
        range(firstParagraph, "paragraph", "complete-content", "content"),
        range(secondItem, "listItem", "complete-block", "block"),
      ]),
      graph: fixture.graph,
      graphRevision: 1,
      blockDefinitions: definitions,
      readBlockContent: (id) => fixture.content.get(id) ?? null,
    });

    expect(result?.blocks).toEqual([
      {
        kind: "block",
        blockId: firstItem,
        blockType: "listItem",
        parentId: list,
      },
      {
        kind: "block",
        blockId: secondItem,
        blockType: "listItem",
        parentId: list,
      },
    ]);
  });
});

function graphFixture() {
  const records = new Map<BlockId, VersionedBlock>([
    [list, record(list, "list", null)],
    [firstItem, record(firstItem, "listItem", list)],
    [firstParagraph, record(firstParagraph, "paragraph", firstItem)],
    [secondItem, record(secondItem, "listItem", list)],
    [secondParagraph, record(secondParagraph, "paragraph", secondItem)],
  ]);
  const children = new Map<BlockId, readonly BlockId[]>([
    [list, [firstItem, secondItem]],
    [firstItem, [firstParagraph]],
    [secondItem, [secondParagraph]],
  ]);
  const content = new Map<BlockId, RichTextDocumentNodeJson>([
    [firstParagraph, createBlockRichTextContentFromPlainText("paragraph", "A")],
    [secondParagraph, createBlockRichTextContentFromPlainText("paragraph", "B")],
  ]);
  const graph = {
    getBlock: (id: BlockId) => records.get(id) ?? null,
    getParentId: (id: BlockId) => records.get(id)?.parentId ?? null,
    getRootBlockIds: () => [list],
    getChildBlockIds: (id: BlockId) => children.get(id) ?? [],
    readBlockSelectionModel: (id: BlockId) => {
      const type = records.get(id)?.type;
      return type === "paragraph"
        ? contentSelection()
        : type === "listItem"
          ? wholeSelection()
          : wrapperSelection();
    },
  } satisfies EditorSelectionGraphReader;
  return { content, graph };
}

function range(
  id: BlockId,
  type: BlockType,
  coverage: EditorSelectionRangeBlock["coverage"],
  behavior: "wrapper" | "block" | "content",
): EditorSelectionRangeBlock {
  return {
    blockId: id,
    blockType: type,
    category:
      type === "paragraph" ? "text" : type === "listItem" ? "object" : "wrapper",
    coverage,
    coverageResult: {
      blockId: id,
      blockType: type,
      modelId: behavior,
      coverage,
      delete: { kind: behavior },
    },
    selectable: type !== "list",
  };
}

function snapshot(
  rangeBlocks: readonly EditorSelectionRangeBlock[],
): EditorSelectionSnapshot {
  const anchor = point(rangeBlocks[1]!);
  const focus = point(rangeBlocks.at(-1)!);
  return {
    phase: "committed",
    selectionRevision: 1,
    graphRevision: 1,
    lastInvalidationReason: null,
    direction: "forward",
    anchor,
    focus,
    normalizedStart: anchor,
    normalizedEnd: focus,
    rangeBlocks,
  };
}

function point(rangeBlock: EditorSelectionRangeBlock): EditorLogicalSelectionPoint {
  return {
    blockId: rangeBlock.blockId,
    blockType: rangeBlock.blockType,
    blockCategory: rangeBlock.category,
    textOffset: 1,
    textAnchor: null,
    affinity: null,
  };
}

function record(id: BlockId, type: BlockType, parentId: BlockId | null) {
  return createVersionedBlockRecord({ id, type, parentId });
}

function blockId(value: number): BlockId {
  return asBlockId(
    `01890f07-1c00-7000-8000-${String(value).padStart(12, "0")}`,
  );
}
