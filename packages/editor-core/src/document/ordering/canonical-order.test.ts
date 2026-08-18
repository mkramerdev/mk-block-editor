import { describe, expect, it } from "vitest";
import type { Block, OrderedBlockGraph } from "../model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import { asBlockId } from "../../kernel/identity/uuid.ts";
import {
  getCanonicalBlockOrder,
  getDirectChildren,
  getNextLiveBlock,
  getPreviousLiveBlock,
  getSubtreeBlockIds,
  getSubtreeOrderBounds,
} from "./canonical-order.ts";

const id = (suffix: number): BlockId =>
  asBlockId(
    `01890f07-1c00-7000-8000-${String(suffix).padStart(12, "0")}`,
  );

function block(blockId: BlockId, parentId: BlockId | null = null): Block {
  return {
    id: blockId,
    type: "paragraph",
    parentId,
    tombstone: null,
  };
}

function graph(): OrderedBlockGraph {
  const rootA = block(id(1));
  const childA = block(id(2), rootA.id);
  const grandchild = block(id(3), childA.id);
  const childB = block(id(4), rootA.id);
  const rootB = block(id(5));
  return {
    blocks: {
      [rootB.id]: rootB,
      [childB.id]: childB,
      [grandchild.id]: grandchild,
      [rootA.id]: rootA,
      [childA.id]: childA,
    },
    rootBlockIds: [rootA.id, rootB.id],
    childIdsByParentId: {
      [rootA.id]: [childA.id, childB.id],
      [childA.id]: [grandchild.id],
    },
  };
}

describe("canonical ordered graph traversal", () => {
  it("uses explicit root and child sequences rather than object insertion order", () => {
    expect(getCanonicalBlockOrder(graph())).toEqual([
      id(1),
      id(2),
      id(3),
      id(4),
      id(5),
    ]);
  });

  it("returns ordered direct children", () => {
    expect(getDirectChildren(graph(), id(1)).map((entry) => entry.id)).toEqual([
      id(2),
      id(4),
    ]);
  });

  it("returns a depth-first ordered subtree", () => {
    expect(getSubtreeBlockIds(graph(), id(1))).toEqual([
      id(1),
      id(2),
      id(3),
      id(4),
    ]);
  });

  it("derives subtree bounds from canonical containment", () => {
    const bounds = getSubtreeOrderBounds(graph(), id(2));
    expect(bounds.first.id).toBe(id(2));
    expect(bounds.last.id).toBe(id(3));
    expect(bounds.nextAfterSubtree?.id).toBe(id(4));
  });

  it("finds canonical previous and next blocks", () => {
    expect(getPreviousLiveBlock(graph(), id(4))?.id).toBe(id(3));
    expect(getNextLiveBlock(graph(), id(4))?.id).toBe(id(5));
  });
});
