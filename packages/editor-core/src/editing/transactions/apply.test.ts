import { describe, expect, it } from "vitest";
import type {
  BlockType,
  OrderedBlockGraph,
  VersionedBlock,
} from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import { asBlockId } from "../../kernel/identity/uuid.ts";
import { createVersionedBlockRecord } from "../../metadata/block-record.ts";
import { createBlockRichTextContentFromPlainText } from "../../content/rich-text/rich-inline-content.ts";
import { testBlockDefinitions } from "../../testing/test-block-definitions.ts";
import { applyStructuralTransaction } from "./apply.ts";
import { insertBlocks } from "./primitives/insert-blocks.ts";
import { moveBlocks } from "./primitives/move-blocks.ts";
import { removeBlocks } from "./primitives/remove-blocks.ts";
import type {
  StructuralTransactionContext,
  StructuralTransactionOperation,
} from "./types.ts";

const id = (suffix: number): BlockId =>
  asBlockId(`01890f07-1c00-7000-8000-${String(suffix).padStart(12, "0")}`);
const blockDefinitions = {
  ...testBlockDefinitions,
  emptyFlowShell: {
    kind: "wrapper" as const,
    rootLayout: "normal" as const,
    type: "emptyFlowShell",
    renderer: () => null,
    content: { required: [], additional: "block" as const },
    contentBoundary: false,
  },
};
const block = (
  blockId: BlockId,
  type: BlockType = "paragraph",
  parentId: BlockId | null = null,
): VersionedBlock =>
  createVersionedBlockRecord({
    id: blockId,
    type,
    parentId,
    version: {
      metadataVersion: "1",
      contentVersion: blockDefinitions[type]?.kind === "text" ? "1" : null,
    },
  });
const graph = (
  blocks: readonly VersionedBlock[],
): OrderedBlockGraph<VersionedBlock> => {
  const childIdsByParentId = {} as Partial<Record<BlockId, BlockId[]>>;
  for (const entry of blocks) {
    if (entry.parentId !== null) {
      (childIdsByParentId[entry.parentId] ??= []).push(entry.id);
    }
  }
  return {
    blocks: Object.fromEntries(blocks.map((entry) => [entry.id, entry])),
    rootBlockIds: blocks
      .filter((entry) => entry.parentId === null)
      .map((entry) => entry.id),
    childIdsByParentId,
  };
};
const context = (
  orderedGraph: OrderedBlockGraph<VersionedBlock>,
): StructuralTransactionContext => ({
  ...orderedGraph,
  blockDefinitions,
  readContent: (_blockId, blockType) =>
    blockDefinitions[blockType]?.kind === "text"
      ? {
          content: createBlockRichTextContentFromPlainText(blockType, ""),
          plainText: "",
          version: "1",
        }
      : null,
  validateContent: () => true,
});
const apply = (
  orderedGraph: OrderedBlockGraph<VersionedBlock>,
  operations: readonly StructuralTransactionOperation[],
) =>
  applyStructuralTransaction(
    { origin: "test", operations },
    context(orderedGraph),
  );
const expectApplied = (result: ReturnType<typeof apply>) => {
  if (!result.ok) throw new Error(result.message);
  expect(result.ok).toBe(true);
  return result.transaction;
};

describe("graph-native structural transactions", () => {
  it("inserts at a requested root index", () => {
    const first = block(id(1));
    const second = block(id(2));
    const transaction = expectApplied(
      apply(graph([first]), [
        insertBlocks({
          placement: { parentId: null, childIndex: 1 },
          blocks: [
            {
              id: second.id,
              type: second.type,
              parentId: null,
              content: createBlockRichTextContentFromPlainText(second.type, ""),
              plainText: "",
            },
          ],
        }),
      ]),
    );
    expect(transaction.rootBlockIds).toEqual([first.id, second.id]);
  });

  it("inserts at a requested child index", () => {
    const parent = block(id(1), "callout");
    const first = block(id(2), "paragraph", parent.id);
    const second = block(id(3), "divider", parent.id);
    const transaction = expectApplied(
      apply(graph([parent, first]), [
        insertBlocks({
          placement: { parentId: parent.id, childIndex: 1 },
          blocks: [{ id: second.id, type: second.type, parentId: parent.id }],
        }),
      ]),
    );
    expect(transaction.childIdsByParentId[parent.id]).toEqual([
      first.id,
      second.id,
    ]);
  });

  it.each([
    ["first to last", 0, 2, [2, 3, 1]],
    ["last to first", 2, 0, [3, 1, 2]],
    ["earlier to later", 0, 2, [2, 3, 1]],
    ["later to earlier", 2, 1, [1, 3, 2]],
  ] as const)(
    "moves within one parent: %s",
    (_label, sourceIndex, destinationIndex, expected) => {
      const entries = [block(id(1)), block(id(2)), block(id(3))];
      const moving = entries[sourceIndex]!;
      const transaction = expectApplied(
        apply(graph(entries), [
          moveBlocks({
            blockIds: [moving.id],
            sourcePlacement: { parentId: null, childIndex: sourceIndex },
            destinationPlacement: {
              parentId: null,
              childIndex: destinationIndex,
            },
          }),
        ]),
      );
      expect(transaction.rootBlockIds).toEqual(
        expected.map((suffix) => id(suffix)),
      );
    },
  );

  it("treats a same-parent placement at the current final index as a no-op", () => {
    const entries = [block(id(1)), block(id(2)), block(id(3))];
    const before = graph(entries);
    const transaction = expectApplied(
      apply(before, [
        moveBlocks({
          blockIds: [entries[1]!.id],
          sourcePlacement: { parentId: null, childIndex: 1 },
          destinationPlacement: { parentId: null, childIndex: 1 },
        }),
      ]),
    );
    expect(transaction.rootBlockIds).toEqual(entries.map((entry) => entry.id));
    expect(transaction.rootBlockIds).toBe(before.rootBlockIds);
    expect(transaction.childIdsByParentId).toBe(before.childIdsByParentId);
    expect(transaction.blocks).toBe(before.blocks);
    expect(transaction.affectedBlockIds).toEqual([]);
  });

  it("reparents between two containers", () => {
    const left = block(id(1), "emptyFlowShell");
    const child = block(id(2), "paragraph", left.id);
    const right = block(id(3), "emptyFlowShell");
    const transaction = expectApplied(
      apply(graph([left, child, right]), [
        moveBlocks({
          blockIds: [child.id],
          sourcePlacement: { parentId: left.id, childIndex: 0 },
          destinationPlacement: { parentId: right.id, childIndex: 0 },
        }),
      ]),
    );
    expect(transaction.childIdsByParentId[left.id]).toEqual([]);
    expect(transaction.childIdsByParentId[right.id]).toEqual([child.id]);
    expect(transaction.blocks[child.id]?.parentId).toBe(right.id);
  });

  it("copies only the two parent sequences during reparenting", () => {
    const left = block(id(1), "emptyFlowShell");
    const moving = block(id(2), "paragraph", left.id);
    const right = block(id(3), "emptyFlowShell");
    const other = block(id(4), "emptyFlowShell");
    const stable = block(id(5), "paragraph", other.id);
    const before = graph([left, moving, right, other, stable]);

    const transaction = expectApplied(
      apply(before, [
        moveBlocks({
          blockIds: [moving.id],
          sourcePlacement: { parentId: left.id, childIndex: 0 },
          destinationPlacement: { parentId: right.id, childIndex: 0 },
        }),
      ]),
    );

    expect(transaction.rootBlockIds).toBe(before.rootBlockIds);
    expect(transaction.childIdsByParentId).not.toBe(before.childIdsByParentId);
    expect(transaction.childIdsByParentId[left.id]).not.toBe(
      before.childIdsByParentId[left.id],
    );
    expect(transaction.childIdsByParentId[right.id]).not.toBe(
      before.childIdsByParentId[right.id],
    );
    expect(transaction.childIdsByParentId[other.id]).toBe(
      before.childIdsByParentId[other.id],
    );
    expect(transaction.blocks[stable.id]).toBe(before.blocks[stable.id]);
  });

  it("reuses every nested sequence during a root reorder", () => {
    const first = block(id(1), "emptyFlowShell");
    const child = block(id(2), "paragraph", first.id);
    const second = block(id(3), "emptyFlowShell");
    const before = graph([first, child, second]);

    const transaction = expectApplied(
      apply(before, [
        moveBlocks({
          blockIds: [second.id],
          sourcePlacement: { parentId: null, childIndex: 1 },
          destinationPlacement: { parentId: null, childIndex: 0 },
        }),
      ]),
    );

    expect(transaction.rootBlockIds).not.toBe(before.rootBlockIds);
    expect(transaction.childIdsByParentId).toBe(before.childIdsByParentId);
    expect(transaction.childIdsByParentId[first.id]).toBe(
      before.childIdsByParentId[first.id],
    );
  });

  it("moves between root and nested containment in both directions", () => {
    const parent = block(id(1), "emptyFlowShell");
    const nested = block(id(2), "paragraph", parent.id);
    const root = block(id(3));
    const nestedAtRoot = expectApplied(
      apply(graph([parent, nested, root]), [
        moveBlocks({
          blockIds: [nested.id],
          sourcePlacement: { parentId: parent.id, childIndex: 0 },
          destinationPlacement: { parentId: null, childIndex: 2 },
        }),
      ]),
    );
    expect(nestedAtRoot.rootBlockIds).toEqual([parent.id, root.id, nested.id]);

    const rootInParent = expectApplied(
      apply(nestedAtRoot, [
        moveBlocks({
          blockIds: [root.id],
          sourcePlacement: { parentId: null, childIndex: 1 },
          destinationPlacement: { parentId: parent.id, childIndex: 0 },
        }),
      ]),
    );
    expect(rootInParent.childIdsByParentId[parent.id]).toEqual([root.id]);
  });

  it("rejects a descendant destination that creates a cycle", () => {
    const parent = block(id(1), "callout");
    const child = block(id(2), "callout", parent.id);
    const result = apply(graph([parent, child]), [
      moveBlocks({
        blockIds: [parent.id],
        sourcePlacement: { parentId: null, childIndex: 0 },
        destinationPlacement: { parentId: child.id, childIndex: 0 },
      }),
    ]);
    expect(result).toMatchObject({
      ok: false,
      failureKind: "invalid-structure",
    });
  });

  it("deletes an ordered subtree atomically", () => {
    const parent = block(id(1), "callout");
    const child = block(id(2), "paragraph", parent.id);
    const sibling = block(id(3));
    const transaction = expectApplied(
      apply(graph([parent, child, sibling]), [
        removeBlocks({
          blockIds: [parent.id],
          includeDescendants: true,
        }),
      ]),
    );
    expect(transaction.rootBlockIds).toEqual([sibling.id]);
    expect(transaction.blocks[parent.id]).toBeUndefined();
    expect(transaction.blocks[child.id]).toBeUndefined();
  });

  it("restores a complete ordered subtree in one canonical reduction", () => {
    const sibling = block(id(1));
    const parent = block(id(2), "callout");
    const first = block(id(3), "paragraph", parent.id);
    const second = block(id(4), "divider", parent.id);
    const transaction = expectApplied(
      apply(graph([sibling]), [
        {
          kind: "restoreBlocks",
          blocks: [
            {
              block: parent,
              placement: { parentId: null, childIndex: 0 },
            },
            {
              block: first,
              placement: { parentId: parent.id, childIndex: 0 },
            },
            {
              block: second,
              placement: { parentId: parent.id, childIndex: 1 },
            },
          ],
        },
      ]),
    );

    expect(transaction.rootBlockIds).toEqual([parent.id, sibling.id]);
    expect(transaction.childIdsByParentId[parent.id]).toEqual([
      first.id,
      second.id,
    ]);
    expect(transaction.affectedBlockIds).toEqual([
      parent.id,
      first.id,
      second.id,
    ]);
  });

  it("rejects an invalid restored subtree without publishing a partial graph", () => {
    const sibling = block(id(1));
    const leaf = block(id(2), "paragraph");
    const child = block(id(3), "paragraph", leaf.id);
    const before = graph([sibling]);
    const result = apply(before, [
      {
        kind: "restoreBlocks",
        blocks: [
          {
            block: leaf,
            placement: { parentId: null, childIndex: 0 },
          },
          {
            block: child,
            placement: { parentId: leaf.id, childIndex: 0 },
          },
        ],
      },
    ]);

    expect(result).toMatchObject({
      ok: false,
      failureKind: "invalid-structure",
    });
    expect(before.rootBlockIds).toEqual([sibling.id]);
    expect(before.blocks[leaf.id]).toBeUndefined();
    expect(before.blocks[child.id]).toBeUndefined();
  });

  it("replaces a live structural block record through the same reducer", () => {
    const original = block(id(1), "paragraph");
    const replacement = {
      ...original,
      type: "heading",
      metadataVersion: "2",
    };
    const transaction = expectApplied(
      apply(graph([original]), [
        {
          kind: "replaceBlocks",
          blocks: [{ block: replacement }],
        },
      ]),
    );

    expect(transaction.rootBlockIds).toEqual([original.id]);
    expect(transaction.blocks[original.id]).toMatchObject({
      id: original.id,
      type: "heading",
      parentId: null,
      metadataVersion: "2",
    });
  });

  it("rejects invalid destination indices atomically", () => {
    const first = block(id(1));
    const before = graph([first]);
    const result = apply(before, [
      insertBlocks({
        placement: { parentId: null, childIndex: 2 },
        blocks: [{ id: id(2), type: "textLeaf", parentId: null }],
      }),
    ]);
    expect(result).toMatchObject({
      ok: false,
      failureKind: "invalid-boundary",
    });
    expect(before.rootBlockIds).toEqual([first.id]);
  });
});
