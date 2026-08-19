import { describe, expect, it } from "vitest";
import type { Block, OrderedBlockGraph } from "../model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import { asBlockId } from "../../kernel/identity/uuid.ts";
import { getCanonicalBlockOrder } from "./canonical-order.ts";

const id = (suffix: number): BlockId =>
  asBlockId(`01890f07-1c00-7000-8000-${String(suffix).padStart(12, "0")}`);
const block = (blockId: BlockId, parentId: BlockId | null = null): Block => ({
  id: blockId,
  type: "paragraph",
  parentId,
  tombstone: null,
});
const derive = (graph: OrderedBlockGraph) => () =>
  getCanonicalBlockOrder(graph);

describe("canonical ordered graph invariants", () => {
  it("rejects duplicate root containment", () => {
    const root = block(id(1));
    expect(
      derive({
        blocks: { [root.id]: root },
        rootBlockIds: [root.id, root.id],
        childIdsByParentId: {},
      }),
    ).toThrow(/appears more than once/);
  });

  it("rejects duplicate child containment", () => {
    const parent = block(id(1));
    const child = block(id(2), parent.id);
    expect(
      derive({
        blocks: { [parent.id]: parent, [child.id]: child },
        rootBlockIds: [parent.id],
        childIdsByParentId: { [parent.id]: [child.id, child.id] },
      }),
    ).toThrow(/appears more than once|duplicate child/);
  });

  it("rejects unknown child references", () => {
    const parent = block(id(1));
    expect(
      derive({
        blocks: { [parent.id]: parent },
        rootBlockIds: [parent.id],
        childIdsByParentId: { [parent.id]: [id(2)] },
      }),
    ).toThrow(/unknown block/);
  });

  it("rejects parent and child disagreement", () => {
    const parent = block(id(1));
    const child = block(id(2));
    expect(
      derive({
        blocks: { [parent.id]: parent, [child.id]: child },
        rootBlockIds: [parent.id],
        childIdsByParentId: { [parent.id]: [child.id] },
      }),
    ).toThrow(/disagrees/);
  });

  it("rejects cycles", () => {
    const first = block(id(1), id(2));
    const second = block(id(2), id(1));
    expect(
      derive({
        blocks: { [first.id]: first, [second.id]: second },
        rootBlockIds: [],
        childIdsByParentId: {
          [first.id]: [second.id],
          [second.id]: [first.id],
        },
      }),
    ).toThrow(/unreachable|cycle/);
  });

  it("rejects unreachable live blocks", () => {
    const root = block(id(1));
    const detached = block(id(2));
    expect(
      derive({
        blocks: { [root.id]: root, [detached.id]: detached },
        rootBlockIds: [root.id],
        childIdsByParentId: {},
      }),
    ).toThrow(/unreachable/);
  });

  it("rejects tombstones in live containment", () => {
    const root = {
      ...block(id(1)),
      tombstone: { deletedAt: 1, reason: "user-delete" as const },
    };
    expect(
      derive({
        blocks: { [root.id]: root },
        rootBlockIds: [root.id],
        childIdsByParentId: {},
      }),
    ).toThrow(/tombstoned/);
  });

  it("rejects child sequences for unknown parents even when empty", () => {
    expect(
      derive({
        blocks: {},
        rootBlockIds: [],
        childIdsByParentId: { [id(1)]: [] },
      }),
    ).toThrow(/unknown parent/);
  });
});
