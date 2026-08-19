import { describe, expect, it } from "vitest";
import type {
  OrderedBlockGraph,
  VersionedBlock,
} from "@repo/editor-core/document";
import { asBlockId, asContentVersion } from "@repo/editor-core/kernel";
import { createInitialEditorCommandState } from "../state/command-state.ts";
import {
  blocksEquivalent,
  manifestDataMatchesCurrentState,
} from "./manifest-query.ts";

describe("blocksEquivalent", () => {
  const block: VersionedBlock = {
    id: asBlockId("01890f07-1c00-7000-8000-000000000001"),
    type: "paragraph",
    parentId: null,
    metadataVersion: "v1",
    contentVersion: asContentVersion("v1"),
    tombstone: null,
    metadata: { alignment: "left" },
  };

  it("treats version-only accepted-state differences as the same graph block", () => {
    expect(
      blocksEquivalent(block, {
        ...block,
        metadataVersion: "v2",
        contentVersion: asContentVersion("v3"),
      }),
    ).toBe(true);
  });

  it("still detects semantic block-state differences", () => {
    expect(
      blocksEquivalent(block, {
        ...block,
        metadata: { alignment: "right" },
      }),
    ).toBe(false);
  });

  it("matches reordered nested metadata without ignoring meaningful ordering", () => {
    const currentBlock: VersionedBlock = {
      ...block,
      metadata: {
        alignment: "left",
        options: { a: 1, b: 2 },
        ordered: [1, 2],
      },
    };
    const graph = (
      nextBlock: VersionedBlock,
    ): OrderedBlockGraph<VersionedBlock> => ({
      blocks: { [nextBlock.id]: nextBlock },
      rootBlockIds: [nextBlock.id],
      childIdsByParentId: {},
    });
    const current = createInitialEditorCommandState({
      ...graph(currentBlock),
      createdAt: 1,
      updatedAt: 1,
    });
    const reconciliation = (nextBlock: VersionedBlock) => ({
      origin: "external-snapshot" as const,
      blockGraphVersion: current.blockGraphVersion,
      ...graph(nextBlock),
    });
    const reordered = {
      ...currentBlock,
      metadata: {
        ordered: [1, 2],
        options: { b: 2, a: 1 },
        alignment: "left",
      },
    } satisfies VersionedBlock;

    expect(blocksEquivalent(currentBlock, reordered)).toBe(true);
    expect(
      manifestDataMatchesCurrentState(current, reconciliation(reordered)),
    ).toBe(true);
    expect(
      manifestDataMatchesCurrentState(
        current,
        reconciliation({
          ...reordered,
          metadata: { ...reordered.metadata, ordered: [2, 1] },
        }),
      ),
    ).toBe(false);
    expect(
      manifestDataMatchesCurrentState(
        current,
        reconciliation({
          ...reordered,
          metadata: {
            ...reordered.metadata,
            options: { b: 3, a: 1 },
          },
        }),
      ),
    ).toBe(false);
  });

  it("keeps canonical block order significant", () => {
    const second = {
      ...block,
      id: asBlockId("01890f07-1c00-7000-8000-000000000002"),
    } satisfies VersionedBlock;
    const blocks = { [block.id]: block, [second.id]: second };
    const current = createInitialEditorCommandState({
      blocks,
      rootBlockIds: [block.id, second.id],
      childIdsByParentId: {},
      createdAt: 1,
      updatedAt: 1,
    });

    expect(
      manifestDataMatchesCurrentState(current, {
        origin: "external-snapshot",
        blockGraphVersion: current.blockGraphVersion,
        blocks,
        rootBlockIds: [second.id, block.id],
        childIdsByParentId: {},
      }),
    ).toBe(false);
  });
});
