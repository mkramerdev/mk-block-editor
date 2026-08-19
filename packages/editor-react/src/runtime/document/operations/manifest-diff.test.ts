import { describe, expect, it } from "vitest";
import type { VersionedBlock } from "@repo/editor-core/document";
import { asBlockId, asContentVersion } from "@repo/editor-core/kernel";
import { createInitialEditorCommandState } from "../state/command-state.ts";
import { createEditorBlockGraphPatch } from "./manifest-diff.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000000001");

function block(metadata: VersionedBlock["metadata"]): VersionedBlock {
  return {
    id: blockId,
    type: "paragraph",
    parentId: null,
    tombstone: null,
    metadata,
    metadataVersion: "metadata-v1",
    contentVersion: asContentVersion("content-v1"),
  };
}

function state(value: VersionedBlock) {
  return createInitialEditorCommandState({
    blocks: { [blockId]: value },
    rootBlockIds: [blockId],
    childIdsByParentId: {},
    createdAt: 1,
    updatedAt: 1,
  });
}

describe("createEditorBlockGraphPatch metadata equality", () => {
  it("does not publish a patch for object-order-only differences", () => {
    const previous = state(
      block({ alignment: "left", options: { a: 1, b: 2 } }),
    );
    const next = state(block({ options: { b: 2, a: 1 }, alignment: "left" }));

    expect(
      createEditorBlockGraphPatch(previous, next, {
        reason: "runtime-mutation",
        nextState: next,
        contentOperations: [],
        candidateBlockIds: [blockId],
        provenance: null,
      }),
    ).toBeNull();
  });

  it("publishes a canonical block update for a nested value change", () => {
    const previous = state(block({ options: { a: 1, b: 2 } }));
    const next = state(block({ options: { b: 3, a: 1 } }));

    const result = createEditorBlockGraphPatch(previous, next, {
      reason: "runtime-mutation",
      nextState: next,
      contentOperations: [],
      candidateBlockIds: [blockId],
      provenance: null,
    });

    expect(result?.patch.upsertedBlocks.map(({ id }) => id)).toEqual([blockId]);
    expect(result?.update.canonical.updatedBlockIds).toEqual([blockId]);
    expect(result?.update.containerSequences.changedParentIds).toEqual([]);
  });
});
