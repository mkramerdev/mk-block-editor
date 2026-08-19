import { describe, expect, it } from "vitest";
import type { BlockDefinition } from "../definitions/block-definition.ts";
import type { BlockType, VersionedBlock } from "../document/model/block.ts";
import type { BlockId } from "../kernel/identity/ids.ts";
import { asBlockId } from "../kernel/identity/uuid.ts";
import { createVersionedBlockRecord } from "./block-record.ts";
import { applyBlockMetadataUpdates } from "./block-metadata-update.ts";

const firstId = asBlockId("01890f07-1c00-7000-8000-000000000201");
const secondId = asBlockId("01890f07-1c00-7000-8000-000000000202");
const missingId = asBlockId("01890f07-1c00-7000-8000-000000000203");
const tombstonedId = asBlockId("01890f07-1c00-7000-8000-000000000204");
const renderer = () => null;

const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
  paragraph: {
    kind: "text",
    type: "paragraph",
    rootLayout: "normal",
    renderer,
    validateMetadata: ({ metadata }) =>
      metadata?.required === true ? [] : ["paragraph requires required=true"],
  },
  callout: {
    kind: "atomic",
    type: "callout",
    rootLayout: "normal",
    renderer,
    validateMetadata: ({ metadata }) =>
      typeof metadata?.tone === "string" ? [] : ["callout requires tone"],
  },
};

describe("applyBlockMetadataUpdates", () => {
  it("shallowly updates several fields, preserves unrelated fields, and clones values", () => {
    const nested = { width: 320 };
    const items = [3, 4];
    const result = apply({
      updates: [
        {
          blockId: firstId,
          values: {
            nested,
            items,
            nullable: null,
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const metadata = result.blocks[firstId]?.metadata;
    expect(metadata).toStrictEqual({
      required: true,
      untouched: "kept",
      nested: { width: 320 },
      items: [3, 4],
      nullable: null,
    });
    expect(metadata?.nested).not.toBe(nested);
    expect(metadata?.items).not.toBe(items);

    nested.width = 999;
    items.push(5);
    expect(result.blocks[firstId]?.metadata?.nested).toStrictEqual({
      width: 320,
    });
    expect(result.blocks[firstId]?.metadata?.items).toStrictEqual([3, 4]);
  });

  it("derives each block type and applies several blocks atomically", () => {
    const result = apply({
      updates: [
        { blockId: firstId, values: { required: true, extra: "first" } },
        { blockId: secondId, values: { tone: "warning" } },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.affectedBlockIds).toStrictEqual([firstId, secondId]);
    expect(result.blocks[firstId]?.metadata?.extra).toBe("first");
    expect(result.blocks[secondId]?.metadata?.tone).toBe("warning");
    expect(result.blocks[firstId]?.metadataVersion).toBe("2");
    expect(result.blocks[secondId]?.metadataVersion).toBe("2");
  });

  it("rejects duplicates, missing blocks, tombstones, and malformed JSON", () => {
    const duplicate = apply({
      updates: [
        { blockId: firstId, values: { required: true } },
        { blockId: firstId, values: { required: true } },
      ],
    });
    const missing = apply({
      updates: [{ blockId: missingId, values: { value: true } }],
    });
    const tombstoned = apply({
      updates: [{ blockId: tombstonedId, values: { value: true } }],
    });
    const malformed = apply({
      updates: [
        {
          blockId: firstId,
          values: { invalid: (() => undefined) as never },
        },
      ],
    });

    expect(duplicate.ok).toBe(false);
    expect(missing.ok).toBe(false);
    expect(tombstoned.ok).toBe(false);
    expect(malformed.ok).toBe(false);
  });

  it("rejects the complete request when one final metadata object is invalid", () => {
    const blocks = createBlocks();
    const result = applyBlockMetadataUpdates({
      operation: {
        kind: "updateBlockMetadata",
        updates: [
          { blockId: firstId, values: { required: true, accepted: true } },
          { blockId: secondId, values: { tone: 42 } },
        ],
      },
      blocks,
      blockDefinitions: definitions,
      getDirectChildIds: () => [],
    });

    expect(result.ok).toBe(false);
    expect(blocks[firstId]?.metadata).toStrictEqual({
      required: true,
      untouched: "kept",
      nested: { width: 100, height: 80 },
      items: [1, 2],
    });
    expect(blocks[firstId]?.metadataVersion).toBe("1");
  });

  it("reports an unchanged update as a no-op", () => {
    const blocks = createBlocks();
    const result = applyBlockMetadataUpdates({
      operation: {
        kind: "updateBlockMetadata",
        updates: [{ blockId: firstId, values: { required: true } }],
      },
      blocks,
      blockDefinitions: definitions,
      getDirectChildIds: () => [],
    });

    expect(result).toMatchObject({ ok: true, affectedBlockIds: [] });
    if (result.ok) expect(result.blocks[firstId]).toBe(blocks[firstId]);
  });
});

function apply(input: {
  readonly updates: readonly {
    readonly blockId: BlockId;
    readonly values: Record<string, unknown>;
  }[];
}) {
  return applyBlockMetadataUpdates({
    operation: {
      kind: "updateBlockMetadata",
      updates: input.updates as never,
    },
    blocks: createBlocks(),
    blockDefinitions: definitions,
    getDirectChildIds: () => [],
  });
}

function createBlocks(): Readonly<Record<BlockId, VersionedBlock>> {
  return {
    [firstId]: createVersionedBlockRecord({
      id: firstId,
      type: "paragraph",
      metadata: {
        required: true,
        untouched: "kept",
        nested: { width: 100, height: 80 },
        items: [1, 2],
      },
      version: { metadataVersion: "1", contentVersion: null },
    }),
    [secondId]: createVersionedBlockRecord({
      id: secondId,
      type: "callout",
      metadata: { tone: "info" },
      version: { metadataVersion: "1", contentVersion: null },
    }),
    [tombstonedId]: createVersionedBlockRecord({
      id: tombstonedId,
      type: "paragraph",
      metadata: { required: true },
      tombstone: { deletedAt: 1, reason: "user-delete" },
      version: { metadataVersion: "1", contentVersion: null },
    }),
  };
}
