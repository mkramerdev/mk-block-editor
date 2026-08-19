import { describe, expect, it } from "vitest";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import { freezeManifestState } from "./freezing.ts";

const firstId = "manifest-first" as BlockId;
const secondId = "manifest-second" as BlockId;

function block(id: BlockId): VersionedBlock {
  return {
    id,
    type: "paragraph",
    parentId: null,
    tombstone: null,
    metadataVersion: "1",
    contentVersion: null,
  };
}

describe("manifest publication", () => {
  it("allocates only changed paths and retains unchanged references", () => {
    const previous = freezeManifestState(
      {
        blockGraphVersion: 1,
        blocks: { [firstId]: block(firstId), [secondId]: block(secondId) },
        rootBlockIds: [firstId, secondId],
        childIdsByParentId: { [firstId]: [secondId] },
        createdAt: 1,
        updatedAt: 1,
      },
      {},
      undefined,
      { structuralDraftAlreadyValidated: true },
    );
    const next = freezeManifestState(
      {
        ...previous,
        blocks: {
          ...previous.blocks,
          [firstId]: {
            ...previous.blocks[firstId]!,
            metadata: { changed: true },
          },
        },
        updatedAt: 2,
      },
      {},
      previous,
      {
        structuralDraftAlreadyValidated: true,
        changedBlockIds: [firstId],
        changedParentIds: [],
      },
    );

    expect(next.blocks).not.toBe(previous.blocks);
    expect(next.blocks[firstId]).not.toBe(previous.blocks[firstId]);
    expect(next.blocks[secondId]).toBe(previous.blocks[secondId]);
    expect(next.rootBlockIds).toBe(previous.rootBlockIds);
    expect(next.childIdsByParentId).toBe(previous.childIdsByParentId);
    expect(next.childIdsByParentId[firstId]).toBe(
      previous.childIdsByParentId[firstId],
    );
  });
});
