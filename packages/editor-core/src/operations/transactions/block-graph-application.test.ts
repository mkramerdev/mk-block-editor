import { describe, expect, it } from "vitest";
import type {
  OrderedBlockGraph,
  VersionedBlock,
} from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import { asBlockId } from "../../kernel/identity/uuid.ts";
import { createVersionedBlockRecord } from "../../metadata/block-record.ts";
import { applyBlockGraphOperation } from "./block-graph-application.ts";
import {
  applyBlockGraphPatch,
  createBlockGraphPatch,
} from "./block-graph-patch.ts";

const id = (suffix: number): BlockId =>
  asBlockId(
    `01890f07-1c00-7000-8000-${String(suffix).padStart(12, "0")}`,
  );
const record = (blockId: BlockId): VersionedBlock =>
  createVersionedBlockRecord({
    id: blockId,
    type: "paragraph",
    version: { metadataVersion: "1", contentVersion: null },
  });
const graph = (
  records: readonly VersionedBlock[],
  roots = records.map((entry) => entry.id),
): OrderedBlockGraph<VersionedBlock> => ({
  blocks: Object.fromEntries(records.map((entry) => [entry.id, entry])),
  rootBlockIds: roots,
  childIdsByParentId: {},
});

describe("block graph patch application", () => {
  it("applies an ordered graph patch atomically", () => {
    const first = record(id(1));
    const second = record(id(2));
    const previous = graph([first, second]);
    const moved = { ...second, metadataVersion: "2" };
    const result = applyBlockGraphPatch(previous, {
      affectedBlockIds: [second.id],
      upsertedBlocks: [moved],
      rootBlockIds: [second.id, first.id],
      childIdsByParentId: {},
      resolvedPlacements: [
        {
          blockId: second.id,
          parentId: null,
          childIndex: 0,
          previousSiblingId: null,
          nextSiblingId: first.id,
        },
      ],
    });
    expect(result.rootBlockIds).toEqual([second.id, first.id]);
    expect(result.blocks[second.id]).toEqual(moved);
  });

  it("retains removed records as tombstones for history", () => {
    const first = record(id(1));
    const previous = graph([first]);
    const result = applyBlockGraphOperation(
      previous,
      {
        kind: "transformBlocks",
        payload: {
          targetId: "delete",
          affectedBlockIds: [first.id],
          upsertedBlocks: [],
          removedBlockIds: [first.id],
          rootBlockIds: [],
          childIdsByParentId: {},
        },
      },
      { now: 5 },
    );
    expect(result.rootBlockIds).toEqual([]);
    expect(result.blocks[first.id]?.tombstone).toEqual({
      deletedAt: 5,
      reason: "move-replace",
    });
  });

  it("creates a complete patch from two graph states", () => {
    const first = record(id(1));
    const second = record(id(2));
    const previous = graph([first]);
    const next = graph([first, second], [second.id, first.id]);
    expect(createBlockGraphPatch(previous, next)).toEqual({
      affectedBlockIds: [second.id],
      upsertedBlocks: [second],
      removedBlockIds: [],
      rootBlockIds: [second.id, first.id],
      childIdsByParentId: {},
      resolvedPlacements: [
        {
          blockId: second.id,
          parentId: null,
          childIndex: 0,
          previousSiblingId: null,
          nextSiblingId: first.id,
        },
      ],
    });
  });

  it("rejects unsupported runtime fields", () => {
    const first = record(id(1));
    expect(() =>
      applyBlockGraphPatch(graph([first]), {
        affectedBlockIds: [first.id],
        upsertedBlocks: [{ ...first, depth: 1 } as never],
        rootBlockIds: [first.id],
        childIdsByParentId: {},
      }),
    ).toThrow(/unsupported versioned field depth/);
  });
});
