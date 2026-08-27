import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import { materializeCanonicalBlockCreation } from "@repo/editor-core/editing";
import {
  asBlockId,
  asContentVersion,
  type BlockId,
} from "@repo/editor-core/kernel";
import { describe, expect, it } from "vitest";
import type { CanonicalEditCompositionGraph } from "./canonical-edit-composition.ts";
import { resolveTypingTriggerFragmentComposition } from "./typing-trigger-fragment-composition.ts";

const sourceId = asBlockId("01890f07-1c00-7000-8000-000000000401");
const wrapperId = asBlockId("01890f07-1c00-7000-8000-000000000402");
const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
  textBlock: {
    kind: "text",
    type: "textBlock",
  },
  alternateTextBlock: {
    kind: "text",
    type: "alternateTextBlock",
  },
  wrapperBlock: {
    kind: "wrapper",
    type: "wrapperBlock",
    content: { required: ["textBlock"] },
  },
};

describe("typing trigger fragment composition", () => {
  it("uses exact same-index replacement when an emptied direct boundary accepts it", () => {
    const graph = createGraph("/", null);
    const fragment = materialize("alternateTextBlock");
    expect(plan(graph, fragment, 0, 1)).toMatchObject({
      deletion: { blocks: [{ kind: "block", blockId: sourceId }] },
      insertions: [{ placement: { parentId: null, childIndex: 0 }, fragment }],
    });
  });

  it("retains a now-empty source and climbs after the nearest acceptable ancestor", () => {
    const graph = createGraph("/", wrapperId);
    const fragment = materialize("alternateTextBlock");
    expect(plan(graph, fragment, 0, 1)).toMatchObject({
      deletion: {
        blocks: [{ kind: "text", blockId: sourceId, from: 0, to: 1 }],
      },
      insertions: [{ placement: { parentId: null, childIndex: 1 }, fragment }],
    });
  });

  it("retains source identity and deletes only the trigger range when text remains", () => {
    const graph = createGraph("before /query after", null);
    const fragment = materialize("alternateTextBlock");
    expect(plan(graph, fragment, 7, 13)).toMatchObject({
      deletion: {
        blocks: [{ kind: "text", blockId: sourceId, from: 7, to: 13 }],
      },
      insertions: [{ placement: { parentId: null, childIndex: 1 }, fragment }],
    });
    expect(fragment.blocks[0]?.type).toBe("alternateTextBlock");
  });
});

function materialize(type: "alternateTextBlock") {
  return materializeCanonicalBlockCreation({
    type,
    blockDefinitions: definitions,
  }).fragment;
}

function plan(
  graph: CanonicalEditCompositionGraph,
  fragment: ReturnType<typeof materialize>,
  from: number,
  to: number,
) {
  return resolveTypingTriggerFragmentComposition({
    graph,
    sourceBlock: graph.getBlock(sourceId)!,
    range: { from, to },
    graphRevision: 4,
    fragment,
  });
}

function createGraph(
  text: string,
  parentId: BlockId | null,
): CanonicalEditCompositionGraph {
  const source: VersionedBlock = {
    id: sourceId,
    type: "textBlock",
    parentId,
    metadataVersion: "metadata",
    contentVersion: asContentVersion("content"),
    tombstone: null,
  };
  const wrapper: VersionedBlock = {
    id: wrapperId,
    type: "wrapperBlock",
    parentId: null,
    metadataVersion: "metadata",
    contentVersion: null,
    tombstone: null,
  };
  return {
    blockDefinitions: definitions,
    getBlock: (id) =>
      id === sourceId ? source : id === wrapperId ? wrapper : null,
    getRootBlockIds: () => (parentId ? [wrapperId] : [sourceId]),
    getChildBlockIds: (id) => (id === wrapperId ? [sourceId] : []),
    readBlockContent: (id, type) =>
      id === sourceId
        ? createBlockRichTextContentFromPlainText(type, text)
        : null,
  };
}
