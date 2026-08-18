import { describe, expect, it } from "vitest";
import {
  createBlockRichTextContentFromPlainText,
  richTextDocumentContentSize,
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
  type BlockSelectionModel,
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
const middleItem = blockId(4);
const middleParagraph = blockId(5);
const additionalParagraph = blockId(6);
const nestedList = blockId(7);
const nestedItem = blockId(8);
const nestedParagraph = blockId(9);
const lastItem = blockId(10);
const lastParagraph = blockId(11);
const ordinaryWrapper = blockId(12);
const ordinaryParagraph = blockId(13);
const atomicChild = blockId(14);

const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
  list: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "list",
    content: { required: ["listItem"], additional: "listItem" },
    defaultContent: "listItem",
    contentBoundary: false,
    list: { kind: "container", itemType: "listItem" },
  },
  listItem: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "listItem",
    content: { required: ["paragraph"], additional: "block" },
    contentBoundary: false,
    list: {
      kind: "item",
      containerType: "list",
      primaryTextChildType: "paragraph",
      emptyEnter: "lift-primary-out-of-container",
    },
  },
  paragraph: {
    kind: "text",
    rootLayout: "normal",
    type: "paragraph",
  },
  divider: {
    kind: "atomic",
    rootLayout: "normal",
    type: "divider",
  },
  ordinaryWrapper: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "ordinaryWrapper",
    content: { required: ["paragraph"], additional: "block" },
    contentBoundary: false,
  },
};

describe("resolveStructuralEditRange", () => {
  it("removes a complete middle item structurally in a larger range", () => {
    const fixture = graphFixture();
    const result = resolve(fixture, [
      range(firstItem, "listItem", "partial"),
      range(
        firstParagraph,
        "paragraph",
        "partial",
        1,
        contentSize(fixture, firstParagraph),
      ),
      range(middleItem, "listItem", "complete-content"),
      range(middleParagraph, "paragraph", "complete-content"),
      range(additionalParagraph, "paragraph", "complete-content"),
      range(nestedList, "list", "complete-content"),
      range(nestedItem, "listItem", "complete-content"),
      range(nestedParagraph, "paragraph", "complete-content"),
      range(atomicChild, "divider", "complete-block"),
      range(lastItem, "listItem", "partial"),
      range(lastParagraph, "paragraph", "partial", 0, 1),
    ]);

    expect(
      result?.blocks.map(({ kind, blockId }) => ({ kind, blockId })),
    ).toEqual([
      { kind: "text", blockId: firstParagraph },
      { kind: "block", blockId: middleItem },
      { kind: "text", blockId: lastParagraph },
    ]);
  });

  it("treats nominally partial boundary text covering 0..contentSize as complete", () => {
    const fixture = graphFixture({ firstText: "A🙂e\u0301" });
    const result = resolve(fixture, [
      range(firstItem, "listItem", "complete-content"),
      range(
        firstParagraph,
        "paragraph",
        "partial",
        0,
        contentSize(fixture, firstParagraph),
      ),
    ]);

    expect(result?.blocks).toEqual([
      {
        kind: "block",
        blockId: firstItem,
        blockType: "listItem",
        parentId: list,
      },
    ]);
  });

  it("does not remove an item whose primary paragraph is partially selected", () => {
    const fixture = graphFixture();
    const result = resolve(fixture, [
      range(firstItem, "listItem", "partial"),
      range(firstParagraph, "paragraph", "partial", 0, 1),
    ]);

    expect(result?.blocks).toEqual([
      expect.objectContaining({
        kind: "text",
        blockId: firstParagraph,
        from: 0,
        to: 1,
      }),
    ]);
  });

  it("does not remove an item with an unselected additional child", () => {
    const fixture = graphFixture();
    const result = resolve(fixture, [
      range(middleItem, "listItem", "partial"),
      range(middleParagraph, "paragraph", "complete-content"),
    ]);

    expect(result?.blocks).toEqual([
      expect.objectContaining({
        kind: "content",
        blockId: middleParagraph,
      }),
    ]);
  });

  it("selects the nearest complete nested list-item removal root without duplicates", () => {
    const fixture = graphFixture();
    const nestedOnly = resolve(fixture, [
      range(middleItem, "listItem", "partial"),
      range(nestedList, "list", "complete-content"),
      range(nestedItem, "listItem", "complete-content"),
      range(nestedParagraph, "paragraph", "complete-content"),
    ]);
    expect(nestedOnly?.blocks).toEqual([
      {
        kind: "block",
        blockId: nestedItem,
        blockType: "listItem",
        parentId: nestedList,
      },
    ]);

    const outerComplete = resolve(fixture, completeMiddleItemRanges());
    expect(outerComplete?.blocks.map((entry) => entry.blockId)).toEqual([
      middleItem,
    ]);
  });

  it("does not promote an ordinary complete-content wrapper to block removal", () => {
    const fixture = graphFixture();
    const result = resolve(fixture, [
      range(ordinaryWrapper, "ordinaryWrapper", "complete-content"),
      range(ordinaryParagraph, "paragraph", "complete-content"),
    ]);

    expect(result?.blocks).toEqual([
      expect.objectContaining({
        kind: "content",
        blockId: ordinaryParagraph,
      }),
    ]);
  });

  it("treats an empty primary text block selected from 0..0 as complete", () => {
    const fixture = graphFixture({ firstText: "" });
    const result = resolve(fixture, [
      range(firstItem, "listItem", "complete-content"),
      range(firstParagraph, "paragraph", "partial", 0, 0),
    ]);

    expect(result?.blocks.map((entry) => entry.blockId)).toEqual([firstItem]);
  });

  it("rejects stale descendant types instead of hiding them behind a list-item root", () => {
    const fixture = graphFixture();
    const result = resolve(fixture, [
      range(firstItem, "listItem", "complete-content"),
      range(firstParagraph, "staleParagraph", "complete-content"),
    ]);

    expect(result).toBeNull();
  });
});

function completeMiddleItemRanges(): readonly EditorSelectionRangeBlock[] {
  return [
    range(middleItem, "listItem", "complete-content"),
    range(middleParagraph, "paragraph", "complete-content"),
    range(additionalParagraph, "paragraph", "complete-content"),
    range(nestedList, "list", "complete-content"),
    range(nestedItem, "listItem", "complete-content"),
    range(nestedParagraph, "paragraph", "complete-content"),
    range(atomicChild, "divider", "complete-block"),
  ];
}

function resolve(
  fixture: ReturnType<typeof graphFixture>,
  rangeBlocks: readonly EditorSelectionRangeBlock[],
) {
  return resolveStructuralEditRange({
    snapshot: snapshot(rangeBlocks),
    graph: fixture.graph,
    graphRevision: 1,
    blockDefinitions: definitions,
    readBlockContent: (id) => fixture.content.get(id) ?? null,
  });
}

function graphFixture(options: { readonly firstText?: string } = {}) {
  const records = new Map<BlockId, VersionedBlock>([
    [list, record(list, "list", null)],
    [firstItem, record(firstItem, "listItem", list)],
    [firstParagraph, record(firstParagraph, "paragraph", firstItem)],
    [middleItem, record(middleItem, "listItem", list)],
    [middleParagraph, record(middleParagraph, "paragraph", middleItem)],
    [additionalParagraph, record(additionalParagraph, "paragraph", middleItem)],
    [nestedList, record(nestedList, "list", middleItem)],
    [nestedItem, record(nestedItem, "listItem", nestedList)],
    [nestedParagraph, record(nestedParagraph, "paragraph", nestedItem)],
    [lastItem, record(lastItem, "listItem", list)],
    [lastParagraph, record(lastParagraph, "paragraph", lastItem)],
    [ordinaryWrapper, record(ordinaryWrapper, "ordinaryWrapper", null)],
    [
      ordinaryParagraph,
      record(ordinaryParagraph, "paragraph", ordinaryWrapper),
    ],
    [atomicChild, record(atomicChild, "divider", middleItem)],
  ]);
  const children = new Map<BlockId, readonly BlockId[]>([
    [list, [firstItem, middleItem, lastItem]],
    [firstItem, [firstParagraph]],
    [
      middleItem,
      [middleParagraph, additionalParagraph, nestedList, atomicChild],
    ],
    [nestedList, [nestedItem]],
    [nestedItem, [nestedParagraph]],
    [lastItem, [lastParagraph]],
    [ordinaryWrapper, [ordinaryParagraph]],
  ]);
  const content = new Map<BlockId, RichTextDocumentNodeJson>([
    [
      firstParagraph,
      createBlockRichTextContentFromPlainText(
        "paragraph",
        options.firstText ?? "First",
      ),
    ],
    [
      middleParagraph,
      createBlockRichTextContentFromPlainText("paragraph", "Middle"),
    ],
    [
      additionalParagraph,
      createBlockRichTextContentFromPlainText("paragraph", "Extra"),
    ],
    [
      nestedParagraph,
      createBlockRichTextContentFromPlainText("paragraph", "Nested"),
    ],
    [
      lastParagraph,
      createBlockRichTextContentFromPlainText("paragraph", "Last"),
    ],
    [
      ordinaryParagraph,
      createBlockRichTextContentFromPlainText("paragraph", "Ordinary"),
    ],
  ]);
  const graph = {
    getBlock: (id: BlockId) => records.get(id) ?? null,
    getParentId: (id: BlockId) => records.get(id)?.parentId ?? null,
    getRootBlockIds: () => [list, ordinaryWrapper],
    getChildBlockIds: (id: BlockId) => children.get(id) ?? [],
    readBlockSelectionModel: (id: BlockId) =>
      selectionModel(records.get(id)?.type),
  } satisfies EditorSelectionGraphReader;
  return { content, graph };
}

function selectionModel(type: BlockType | undefined): BlockSelectionModel {
  if (type === "paragraph") return contentSelection();
  if (type === "divider") return wholeSelection();
  return wrapperSelection();
}

function range(
  id: BlockId,
  type: BlockType,
  coverage: EditorSelectionRangeBlock["coverage"],
  startOffset?: number,
  endOffset?: number,
): EditorSelectionRangeBlock {
  const model = selectionModel(type);
  return {
    blockId: id,
    blockType: type,
    category: model.projection.category,
    coverage,
    coverageResult: {
      blockId: id,
      blockType: type,
      modelId: model.id,
      coverage,
      ...(model.paint === undefined ? {} : { paint: model.paint }),
      ...(model.fragment === undefined ? {} : { fragment: model.fragment }),
      ...(model.edit === undefined ? {} : { edit: model.edit }),
      ...(model.delete === undefined ? {} : { delete: model.delete }),
      ...(model.cut === undefined ? {} : { cut: model.cut }),
      ...(model.move === undefined ? {} : { move: model.move }),
    },
    selectable: model.projection.selectable,
    ...(startOffset === undefined ? {} : { startOffset }),
    ...(endOffset === undefined ? {} : { endOffset }),
  };
}

function snapshot(
  rangeBlocks: readonly EditorSelectionRangeBlock[],
): EditorSelectionSnapshot {
  const textBlocks = rangeBlocks.filter((entry) => entry.category === "text");
  const anchor = point(textBlocks[0] ?? rangeBlocks[0]!);
  const focus = point(textBlocks.at(-1) ?? rangeBlocks.at(-1)!);
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

function contentSize(
  fixture: ReturnType<typeof graphFixture>,
  id: BlockId,
): number {
  return richTextDocumentContentSize(fixture.content.get(id)!);
}

function record(id: BlockId, type: BlockType, parentId: BlockId | null) {
  return createVersionedBlockRecord({ id, type, parentId });
}

function blockId(value: number): BlockId {
  return asBlockId(
    `01890f07-1c00-7000-8000-${String(value).padStart(12, "0")}`,
  );
}
