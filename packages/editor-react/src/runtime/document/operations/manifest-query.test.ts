import { describe, expect, it } from "vitest";
import type { VersionedBlock } from "@repo/editor-core/document";
import { blocksEquivalent } from "./manifest-query.ts";

describe("blocksEquivalent", () => {
  const block: VersionedBlock = {
    id: "01890f07-1c00-7000-8000-000000000001" as never,
    type: "paragraph",
    parentId: null,
    metadataVersion: "v1" as never,
    contentVersion: "v1" as never,
    tombstone: null,
    metadata: { alignment: "left" },
  };

  it("treats version-only accepted-state differences as the same graph block", () => {
    expect(
      blocksEquivalent(block, {
        ...block,
        metadataVersion: "v2" as never,
        contentVersion: "v3" as never,
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
});
