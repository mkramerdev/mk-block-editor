import { describe, expect, it } from "vitest";
import type { BlockId } from "../../../kernel/identity/ids.ts";
import { moveBlocks } from "./move-blocks.ts";
import { replaceBlockMetadata } from "./replace-block-metadata.ts";

describe("structural operation ownership", () => {
  it("copies caller arrays, placements, and metadata without freezing the caller", () => {
    const blockId = "owned-block" as BlockId;
    const blockIds = [blockId];
    const sourcePlacement = { parentId: null, childIndex: 0 };
    const destinationPlacement = { parentId: null, childIndex: 1 };
    const move = moveBlocks({
      blockIds,
      sourcePlacement,
      destinationPlacement,
    });
    const metadata = { nested: { label: "before" } };
    const replaceMetadata = replaceBlockMetadata({
      blockId,
      expectedMetadataVersion: "1",
      metadata,
    });

    blockIds.length = 0;
    sourcePlacement.childIndex = 9;
    destinationPlacement.childIndex = 10;
    metadata.nested.label = "after";

    expect(move.blockIds).toStrictEqual([blockId]);
    expect(move.sourcePlacement.childIndex).toBe(0);
    expect(move.destinationPlacement.childIndex).toBe(1);
    expect(replaceMetadata.metadata).toStrictEqual({
      nested: { label: "before" },
    });
    expect(Object.isFrozen(blockIds)).toBe(false);
    expect(Object.isFrozen(metadata)).toBe(false);
  });
});
