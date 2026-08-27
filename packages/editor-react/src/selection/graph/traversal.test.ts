import { describe, expect, it } from "vitest";
import type { VersionedBlock } from "@repo/editor-core/document";
import { asContentVersion, type BlockId } from "@repo/editor-core/kernel";
import {
  contentSelection,
  wholeSelection,
  wrapperSelection,
  type BlockSelectionModel,
} from "@repo/editor-core/selection";
import {
  collectEditorSelectionTraversalIds,
  findAdjacentEditorSelectionTarget,
} from "./traversal.ts";
import {
  readEditorBlockSelectionTarget,
  type EditorSelectionGraphReader,
} from "./reader.ts";

const id = (value: string) => value as BlockId;

describe("canonical selection graph traversal", () => {
  it("uses canonical depth-first root and direct-child order", () => {
    const graph = createGraph({
      roots: [id("root-a"), id("root-b")],
      children: {
        [id("root-a")]: [id("child-a"), id("child-b")],
        [id("child-a")]: [id("grandchild")],
      },
      models: {
        [id("root-a")]: wrapperSelection(),
        [id("child-a")]: wrapperSelection(),
        [id("child-b")]: contentSelection(),
        [id("grandchild")]: contentSelection(),
        [id("root-b")]: wholeSelection(),
      },
    });

    expect(collectEditorSelectionTraversalIds(graph)).toEqual([
      id("root-a"),
      id("child-a"),
      id("grandchild"),
      id("child-b"),
      id("root-b"),
    ]);
  });

  it("derives adjacency from the current graph without retaining sibling anchors", () => {
    const graph = createGraph({
      roots: [id("first"), id("wrapper"), id("last")],
      children: { [id("wrapper")]: [id("nested")] },
      models: {
        [id("first")]: contentSelection(),
        [id("wrapper")]: wrapperSelection(),
        [id("nested")]: contentSelection(),
        [id("last")]: contentSelection(),
      },
    });

    expect(
      findAdjacentEditorSelectionTarget(graph, id("first"), 1)?.block.id,
    ).toBe(id("wrapper"));
    expect(
      findAdjacentEditorSelectionTarget(graph, id("last"), -1)?.block.id,
    ).toBe(id("nested"));
  });

  it("returns the canonical block reference in focused derivation", () => {
    const graph = createGraph({
      roots: [id("only")],
      children: {},
      models: { [id("only")]: contentSelection() },
    });
    const block = graph.getBlock(id("only"));

    expect(readEditorBlockSelectionTarget(graph, id("only"))?.block).toBe(
      block,
    );
  });

  it("skips missing and tombstoned records safely", () => {
    const graph = createGraph({
      roots: [id("live"), id("missing"), id("deleted")],
      children: {},
      models: {
        [id("live")]: contentSelection(),
        [id("deleted")]: contentSelection(),
      },
      tombstones: [id("deleted")],
    });

    expect(collectEditorSelectionTraversalIds(graph)).toEqual([id("live")]);
  });
});

function createGraph(input: {
  readonly roots: readonly BlockId[];
  readonly children: Readonly<Partial<Record<BlockId, readonly BlockId[]>>>;
  readonly models: Readonly<Record<BlockId, BlockSelectionModel>>;
  readonly tombstones?: readonly BlockId[];
}): EditorSelectionGraphReader {
  const tombstones = new Set(input.tombstones ?? []);
  const parentById = new Map<BlockId, BlockId | null>(
    input.roots.map((blockId) => [blockId, null]),
  );
  for (const [parentId, childIds] of Object.entries(input.children) as [
    BlockId,
    readonly BlockId[],
  ][]) {
    for (const childId of childIds) parentById.set(childId, parentId);
  }
  const blocks = new Map<BlockId, VersionedBlock>();
  for (const [blockId, model] of Object.entries(input.models) as [
    BlockId,
    BlockSelectionModel,
  ][]) {
    blocks.set(blockId, {
      id: blockId,
      type: model.projection.category === "text" ? "paragraph" : "containerWrapper",
      parentId: parentById.get(blockId) ?? null,
      metadataVersion: "1",
      contentVersion:
        model.projection.category === "text" ? asContentVersion("1") : null,
      tombstone: tombstones.has(blockId)
        ? { deletedAt: 1, reason: "user-delete" }
        : null,
    });
  }
  return {
    getBlock: (blockId) => blocks.get(blockId) ?? null,
    getParentId: (blockId) => blocks.get(blockId)?.parentId ?? null,
    getRootBlockIds: () => input.roots,
    getChildBlockIds: (parentId) => input.children[parentId] ?? [],
    readBlockSelectionModel: (blockId) => input.models[blockId] ?? null,
  };
}
