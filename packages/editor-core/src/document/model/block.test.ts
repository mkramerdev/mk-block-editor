import { describe, expect, it } from "vitest";
import { asBlockId, asContentVersion } from "../../api/kernel.ts";
import { blocksHaveEqualCanonicalState, type VersionedBlock } from "./block.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000000001");

function block(overrides: Partial<VersionedBlock> = {}): VersionedBlock {
  return {
    id: blockId,
    type: "paragraph",
    parentId: null,
    tombstone: null,
    metadata: { alignment: "left", options: { a: 1, b: 2 } },
    metadataVersion: "metadata-v1",
    contentVersion: asContentVersion("content-v1"),
    ...overrides,
  };
}

describe("blocksHaveEqualCanonicalState", () => {
  it("accepts references and separately constructed equivalent blocks", () => {
    const value = block();
    expect(blocksHaveEqualCanonicalState(value, value)).toBe(true);
    expect(blocksHaveEqualCanonicalState(value, block())).toBe(true);
  });

  it("ignores top-level and nested metadata property order", () => {
    expect(
      blocksHaveEqualCanonicalState(
        block(),
        block({
          metadata: { options: { b: 2, a: 1 }, alignment: "left" },
        }),
      ),
    ).toBe(true);
  });

  it("preserves metadata array order", () => {
    expect(
      blocksHaveEqualCanonicalState(
        block({ metadata: { values: [1, 2] } }),
        block({ metadata: { values: [1, 2] } }),
      ),
    ).toBe(true);
    expect(
      blocksHaveEqualCanonicalState(
        block({ metadata: { values: [1, 2] } }),
        block({ metadata: { values: [2, 1] } }),
      ),
    ).toBe(false);
  });

  it("detects structural and semantic changes", () => {
    const value = block();
    expect(
      blocksHaveEqualCanonicalState(
        value,
        block({ id: asBlockId("01890f07-1c00-7000-8000-000000000002") }),
      ),
    ).toBe(false);
    expect(
      blocksHaveEqualCanonicalState(value, block({ type: "heading" })),
    ).toBe(false);
    expect(
      blocksHaveEqualCanonicalState(
        value,
        block({ parentId: asBlockId("01890f07-1c00-7000-8000-000000000003") }),
      ),
    ).toBe(false);
    expect(
      blocksHaveEqualCanonicalState(
        value,
        block({ metadata: { alignment: "right" } }),
      ),
    ).toBe(false);
  });

  it("compares tombstones semantically while ignoring property order", () => {
    const left = block({
      tombstone: { deletedAt: 1, reason: "user-delete" },
    });
    const reordered = block({
      tombstone: { reason: "user-delete", deletedAt: 1 },
    });
    expect(blocksHaveEqualCanonicalState(left, reordered)).toBe(true);
    expect(
      blocksHaveEqualCanonicalState(
        left,
        block({ tombstone: { deletedAt: 2, reason: "user-delete" } }),
      ),
    ).toBe(false);
  });

  it("treats absent and empty metadata as equal without erasing null keys", () => {
    expect(
      blocksHaveEqualCanonicalState(
        block({ metadata: undefined }),
        block({ metadata: {} }),
      ),
    ).toBe(true);
    expect(
      blocksHaveEqualCanonicalState(
        block({ metadata: undefined }),
        block({ metadata: { value: null } }),
      ),
    ).toBe(false);
  });

  it("intentionally ignores metadata and content versions", () => {
    expect(
      blocksHaveEqualCanonicalState(
        block(),
        block({ metadataVersion: "metadata-v2" }),
      ),
    ).toBe(true);
    expect(
      blocksHaveEqualCanonicalState(
        block(),
        block({ contentVersion: asContentVersion("content-v2") }),
      ),
    ).toBe(true);
  });
});
