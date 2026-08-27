import { describe, expect, it, vi } from "vitest";
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
import { materializeEditorSelectionFragmentCandidate } from "./materialize.ts";

const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
  textBlock: {
    kind: "text",
    type: "textBlock",
  },
  atomicBlock: {
    kind: "atomic",
    type: "atomicBlock",
  },
  wrapperBlock: {
    kind: "wrapper",
    type: "wrapperBlock",
    contentBoundary: false,
    content: { required: ["textBlock"], additional: "textBlock" },
  },
};

describe("selection canonical-fragment materialization", () => {
  it("slices partial text, allocates a new id, and uses open boundaries", () => {
    const sourceId = id(1);
    const graphFixture = fixture([
      {
        id: sourceId,
        type: "textBlock",
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
        range(sourceId, "textBlock", "partial", { kind: "content" }, 6, 11),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.blocks).toHaveLength(1);
    expect(result.candidate.blocks[0]).toMatchObject({
      type: "textBlock",
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
    expect(result.candidate.blocks[0]?.id).not.toBe(sourceId);
    expect(result.candidate.start.kind).toBe("text");
    expect(result.candidate.end.kind).toBe("text");
    const serialized = JSON.stringify(result.candidate);
    expect(serialized).not.toContain(sourceId);
    expect(serialized).not.toContain("coverage");
  });

  it("distinguishes complete text content from a complete text block", () => {
    const sourceId = id(2);
    const graphFixture = fixture([
      { id: sourceId, type: "textBlock", text: "complete" },
    ]);
    const content = materialize(
      graphFixture,
      snapshot([
        range(sourceId, "textBlock", "complete-content", { kind: "content" }),
      ]),
    );
    const block = materialize(
      graphFixture,
      snapshot([
        range(sourceId, "textBlock", "complete-block", { kind: "block" }),
      ]),
    );
    expect(content.ok && content.candidate.blocks[0]?.plainText).toBe(
      "complete",
    );
    expect(content.ok && content.candidate.start.kind).toBe("text");
    expect(block.ok && block.candidate.start.kind).toBe("block");
    expect(block.ok && block.candidate.end.kind).toBe("block");
  });

  it("materializes an atomic block without text fields", () => {
    const sourceId = id(3);
    const result = materialize(
      fixture([{ id: sourceId, type: "atomicBlock" }]),
      snapshot([
        range(sourceId, "atomicBlock", "complete-block", { kind: "block" }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.blocks[0]).toMatchObject({ type: "atomicBlock" });
    expect(result.candidate.blocks[0]).not.toHaveProperty("content");
    expect(result.candidate.blocks[0]).not.toHaveProperty("plainText");
    expect(result.candidate.start.kind).toBe("block");
  });

  it("unwraps a wrapper when only some of its contents are selected", () => {
    const wrapper = id(10);
    const first = id(11);
    const second = id(12);
    const graph = fixture([
      { id: wrapper, type: "wrapperBlock", children: [first, second] },
      { id: first, type: "textBlock", parentId: wrapper, text: "first" },
      { id: second, type: "textBlock", parentId: wrapper, text: "second" },
    ]);
    const wrapperRange = range(wrapper, "wrapperBlock", "partial", { kind: "wrapper" });
    wrapperRange.coverageResult = {
      ...wrapperRange.coverageResult,
      childCoverages: [{ blockId: first, coverage: "complete-content" }],
    };
    const result = materialize(
      graph,
      snapshot([
        wrapperRange,
        range(first, "textBlock", "complete-content", { kind: "content" }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.blocks.map((block) => block.type)).toEqual([
      "textBlock",
    ]);
    expect(result.candidate.blocks[0]?.parentId).toBeNull();
    expect(result.candidate.blocks.map((block) => block.id)).not.toContain(
      first,
    );
  });

  it("preserves a wrapper only when endpoint offsets cover every child completely", () => {
    const wrapper = id(13);
    const first = id(14);
    const second = id(15);
    const graph = fixture([
      { id: wrapper, type: "wrapperBlock", children: [first, second] },
      { id: first, type: "textBlock", parentId: wrapper, text: "first" },
      { id: second, type: "textBlock", parentId: wrapper, text: "second" },
    ]);
    const wrapperRange = range(wrapper, "wrapperBlock", "partial", {
      kind: "wrapper",
    });
    wrapperRange.coverageResult = {
      ...wrapperRange.coverageResult,
      childCoverages: [
        { blockId: first, coverage: "complete-content" },
        { blockId: second, coverage: "complete-content" },
      ],
    };
    const result = materialize(
      graph,
      snapshot([
        wrapperRange,
        range(first, "textBlock", "partial", { kind: "content" }, 0),
        range(
          second,
          "textBlock",
          "partial",
          { kind: "content" },
          undefined,
          6,
        ),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.blocks.map((block) => block.type)).toEqual([
      "wrapperBlock",
      "textBlock",
      "textBlock",
    ]);
    expect(
      result.candidate.blocks.slice(1).map((block) => block.parentId),
    ).toEqual([result.candidate.blocks[0]?.id, result.candidate.blocks[0]?.id]);
  });

  it("preserves multi-root order and mixed outer boundary semantics", () => {
    const first = id(20);
    const second = id(21);
    const graph = fixture([
      { id: first, type: "textBlock", text: "alpha" },
      { id: second, type: "textBlock", text: "beta" },
    ]);
    const result = materialize(
      graph,
      snapshot([
        range(first, "textBlock", "partial", { kind: "content" }, 1, 5),
        range(second, "textBlock", "complete-block", { kind: "block" }),
      ]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.candidate.rootBlockIds.map(
        (rootId) =>
          result.candidate.blocks.find((block) => block.id === rootId)
            ?.plainText,
      ),
    ).toEqual(["lpha", "beta"]);
    expect(result.candidate.start.kind).toBe("text");
    expect(result.candidate.end.kind).toBe("block");
  });

  it("reads only one selected region in a 1,000-root graph", () => {
    const rootIds = Array.from({ length: 1_000 }, (_, index) => id(1_000 + index));
    const graphFixture = fixture(
      rootIds.map((blockId, index) => ({
        id: blockId,
        type: "textBlock" as BlockType,
        text: `root-${index}`,
      })),
    );
    const selected = rootIds[500]!;
    const getBlock = vi.spyOn(graphFixture.graph, "getBlock");
    const getParentId = vi.spyOn(graphFixture.graph, "getParentId");
    const getRootBlockIds = vi.spyOn(graphFixture.graph, "getRootBlockIds");
    const getChildBlockIds = vi.spyOn(graphFixture.graph, "getChildBlockIds");

    const result = materialize(
      graphFixture,
      snapshot([
        range(selected, "textBlock", "complete-content", {
          kind: "content",
        }),
      ]),
    );

    expect(result.ok).toBe(true);
    expect(getBlock).toHaveBeenCalledTimes(1);
    expect(getBlock).toHaveBeenCalledWith(selected);
    expect(getParentId).toHaveBeenCalledTimes(1);
    expect(getChildBlockIds).not.toHaveBeenCalled();
    expect(getRootBlockIds).not.toHaveBeenCalled();
  });

  it("keeps canonical output order for a backward normalized range", () => {
    const first = id(2_100);
    const second = id(2_101);
    const graphFixture = fixture([
      { id: first, type: "textBlock", text: "first" },
      { id: second, type: "textBlock", text: "second" },
    ]);
    const forward = snapshot([
      range(first, "textBlock", "complete-content", { kind: "content" }),
      range(second, "textBlock", "complete-content", { kind: "content" }),
    ]);
    const backward: EditorSelectionSnapshot = {
      ...forward,
      direction: "backward",
      anchor: forward.normalizedEnd,
      focus: forward.normalizedStart,
    };
    const result = materialize(graphFixture, backward);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.blocks.map((block) => block.plainText)).toEqual([
      "first",
      "second",
    ]);
    expect(new Set(result.candidate.blocks.map((block) => block.id)).size).toBe(
      result.candidate.blocks.length,
    );
    expect(result.candidate.start.kind).toBe("text");
    expect(result.candidate.end.kind).toBe("text");
  });

  it("rejects stale revisions and missing selected blocks", () => {
    const selected = id(2_200);
    const graphFixture = fixture([
      { id: selected, type: "textBlock", text: "selected" },
    ]);
    const selectedSnapshot = snapshot([
      range(selected, "textBlock", "complete-content", { kind: "content" }),
    ]);
    expect(
      materializeEditorSelectionFragmentCandidate({
        snapshot: selectedSnapshot,
        graph: graphFixture.graph,
        graphRevision: 2,
        readBlockContent: graphFixture.readBlockContent,
        readBlockPlainText: graphFixture.readBlockPlainText,
        blockDefinitions: definitions,
      }),
    ).toEqual({ ok: false, reason: "stale-graph" });

    const missing = id(2_201);
    const malformed = materialize(
      graphFixture,
      snapshot([
        range(missing, "textBlock", "complete-content", { kind: "content" }),
      ]),
    );
    expect(malformed).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("promotes a selected descendant when its wrapper is not included", () => {
    const wrapper = id(2_300);
    const selected = id(2_301);
    const unrelated = id(2_302);
    const graphFixture = fixture([
      { id: wrapper, type: "wrapperBlock", children: [selected, unrelated] },
      { id: selected, type: "textBlock", parentId: wrapper, text: "keep" },
      {
        id: unrelated,
        type: "textBlock",
        parentId: wrapper,
        text: "ignore",
      },
    ]);
    const getBlock = vi.spyOn(graphFixture.graph, "getBlock");
    const result = materialize(
      graphFixture,
      snapshot([
        range(selected, "textBlock", "complete-content", {
          kind: "content",
        }),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.blocks.map((block) => block.plainText)).toEqual([
      "keep",
    ]);
    expect(getBlock).not.toHaveBeenCalledWith(wrapper);
    expect(getBlock).not.toHaveBeenCalledWith(unrelated);
  });

  it("materializes a custom fragment descriptor once", () => {
    const source = id(2_400);
    const customContent = createBlockRichTextContentFromPlainText(
      "textBlock",
      "custom",
    );
    const result = materialize(
      fixture([{ id: source, type: "atomicBlock" }]),
      snapshot([
        range(source, "atomicBlock", "complete-block", {
          kind: "custom",
          nodes: [
            {
              type: "textBlock",
              content: customContent,
            },
          ],
        }),
      ]),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.blocks).toHaveLength(1);
    expect(result.candidate.blocks[0]).toMatchObject({
      type: "textBlock",
      plainText: "custom",
    });
  });

  it("uses the wrapper visible-child policy without reading hidden siblings", () => {
    const wrapper = id(2_500);
    const hidden = id(2_501);
    const visible = id(2_502);
    const graphFixture = fixture([
      { id: wrapper, type: "wrapperBlock", children: [hidden, visible] },
      { id: hidden, type: "textBlock", parentId: wrapper, text: "hidden" },
      { id: visible, type: "textBlock", parentId: wrapper, text: "visible" },
    ]);
    const wrapperRange = range(wrapper, "wrapperBlock", "partial", {
      kind: "wrapper",
      inclusion: "selected-children",
      contentScope: "visible",
    });
    const getBlock = vi.spyOn(graphFixture.graph, "getBlock");
    const result = materialize(
      graphFixture,
      snapshot([
        wrapperRange,
        range(visible, "textBlock", "complete-content", { kind: "content" }),
      ]),
      () => [visible],
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.candidate.blocks.map((block) => block.type)).toEqual([
      "wrapperBlock",
      "textBlock",
    ]);
    expect(result.candidate.blocks[1]?.plainText).toBe("visible");
    expect(getBlock).not.toHaveBeenCalledWith(hidden);
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
      if (type === "textBlock") return contentSelection();
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
      typeof materializeEditorSelectionFragmentCandidate
    >[0]["resolveVisibleChildBlockIds"]
  >,
) {
  return materializeEditorSelectionFragmentCandidate({
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
