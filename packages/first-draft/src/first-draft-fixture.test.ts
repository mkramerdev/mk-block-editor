import { describe, expect, it } from "vitest";
import { asBlockId } from "@repo/editor-core/kernel";
import { createFirstDraftSnapshot } from "./first-draft-fixture.ts";

describe("First Draft collaboration fixture", () => {
  it("hydrates independent clients from identical Yjs checkpoints", () => {
    const first = createFirstDraftSnapshot();
    const second = createFirstDraftSnapshot();

    expect(Object.keys(first.blocks).length).toBeGreaterThanOrEqual(140);
    expect(Object.keys(first.content).length).toBeGreaterThanOrEqual(80);

    expect(Object.keys(first.opaqueContentCheckpoints)).toEqual(
      Object.keys(first.content),
    );
    expect(Object.keys(second.opaqueContentCheckpoints)).toEqual(
      Object.keys(second.content),
    );
    for (const blockId of Object.keys(first.content).map(asBlockId)) {
      expect(
        first.opaqueContentCheckpoints[blockId]?.payloadBase64,
        `checkpoint for ${blockId}`,
      ).toBe(second.opaqueContentCheckpoints[blockId]?.payloadBase64);
    }
  });
});
