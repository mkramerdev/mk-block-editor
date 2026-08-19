import { describe, expect, it } from "vitest";
import { createFirstDraftSnapshot } from "../first-draft-fixture.ts";
import {
  createFirstDraftBootstrapFromSnapshot,
  decodeFirstDraftBootstrap,
  firstDraftBootstrapSnapshot,
  serializeFirstDraftBootstrap,
} from "./bootstrap.ts";

function bootstrap() {
  return createFirstDraftBootstrapFromSnapshot({
    documentId: "01890f07-1c00-7000-8000-000000040001",
    revision: 7,
    snapshot: createFirstDraftSnapshot(),
  });
}

describe("First Draft bootstrap codec", () => {
  it("round-trips opaque checkpoint strings without binary construction", () => {
    const source = bootstrap();
    const serialized = structuredClone(serializeFirstDraftBootstrap(source));
    const decoded = decodeFirstDraftBootstrap(serialized);
    expect(decoded.documentId).toBe(source.documentId);
    expect(decoded.revision).toBe(7);
    const before = firstDraftBootstrapSnapshot(source).opaqueContentCheckpoints;
    const after = firstDraftBootstrapSnapshot(decoded).opaqueContentCheckpoints;
    expect(after).toEqual(before);
    for (const blockId of Object.keys(before).map(asBlockId)) {
      expect(after[blockId]?.payloadBase64).toBe(
        before[blockId]?.payloadBase64,
      );
    }
  });

  it.each([10, 100, 1_000])(
    "keeps %i independent text checkpoints opaque at the bootstrap boundary",
    (count) => {
      const source = serializeFirstDraftBootstrap(bootstrap());
      const template = source.blocks.find(
        (entry) => entry.readProjection && entry.checkpoint,
      );
      if (!template) throw new Error("Fixture requires one text block");
      const blocks = Array.from({ length: count }, (_, index) => ({
        block: {
          ...template.block,
          id: asBlockId(`opaque-scale-${count}-${index}`),
          parentId: null,
        },
        readProjection: template.readProjection,
        checkpoint: {
          ...template.checkpoint!,
          payloadBase64: template.checkpoint!.payloadBase64,
        },
      }));

      const decoded = decodeFirstDraftBootstrap({
        ...source,
        blocks,
      });
      const snapshot = firstDraftBootstrapSnapshot(decoded);
      expect(Object.keys(snapshot.opaqueContentCheckpoints)).toHaveLength(
        count,
      );
      expect(Object.keys(snapshot.content)).toHaveLength(count);
      expect(snapshot.rootBlockIds).toHaveLength(count);
      for (const entry of blocks) {
        expect(
          snapshot.opaqueContentCheckpoints[entry.block.id]?.payloadBase64,
        ).toBe(template.checkpoint!.payloadBase64);
      }
    },
  );

  it("contains no checkpoint payload decoder or Yjs construction path", () => {
    const source = readFileSync(
      join(process.cwd(), "src/read-model/bootstrap.ts"),
      "utf8",
    );
    expect(source).not.toMatch(
      /decodeBase64|EditorImmutableBinary|new YDoc|new Doc\(/u,
    );
    expect(source).not.toContain("readCanonicalYjsBlockContent");
  });

  it("rejects invalid graphs, projection ownership, envelopes, and unknown keys", () => {
    const serialized = serializeFirstDraftBootstrap(bootstrap());
    expect(() =>
      decodeFirstDraftBootstrap({ ...serialized, unexpected: true }),
    ).toThrow(/unknown or missing keys/u);

    const first = serialized.blocks[0]!;
    expect(() =>
      decodeFirstDraftBootstrap({
        ...serialized,
        blocks: [
          {
            ...first,
            block: { ...first.block, parentId: "missing-block" },
          },
          ...serialized.blocks.slice(1),
        ],
      }),
    ).toThrow();

    const checkpointIndex = serialized.blocks.findIndex(
      (entry) => entry.checkpoint,
    );
    const checkpointEntry = serialized.blocks[checkpointIndex]!;
    expect(() =>
      decodeFirstDraftBootstrap({
        ...serialized,
        blocks: serialized.blocks.map((entry, index) =>
          index === checkpointIndex
            ? {
                ...entry,
                checkpoint: {
                  ...checkpointEntry.checkpoint!,
                  payloadBase64: "not-base64",
                },
              }
            : entry,
        ),
      }),
    ).toThrow(/checkpoint/u);

    for (const checkpoint of [
      { ...checkpointEntry.checkpoint!, format: "wrong-format" },
      { ...checkpointEntry.checkpoint!, version: 99 },
    ]) {
      expect(() =>
        decodeFirstDraftBootstrap({
          ...serialized,
          blocks: serialized.blocks.map((entry, index) =>
            index === checkpointIndex ? { ...entry, checkpoint } : entry,
          ),
        }),
      ).toThrow(/checkpoint/u);
    }

    expect(() =>
      decodeFirstDraftBootstrap({
        ...serialized,
        blocks: serialized.blocks.map((entry, index) =>
          index === checkpointIndex
            ? {
                ...entry,
                checkpoint: {
                  ...checkpointEntry.checkpoint!,
                  extra: true,
                },
              }
            : entry,
        ),
      }),
    ).toThrow(/checkpoint/u);
  });

  it("rejects a complete bootstrap containing unequal table rows", () => {
    const serialized = serializeFirstDraftBootstrap(bootstrap());
    expect(() =>
      decodeFirstDraftBootstrap({
        ...serialized,
        blocks: serialized.blocks.filter(
          (entry) => entry.block.id !== "fd-table-cell-2-2",
        ),
      }),
    ).toThrow(/rows must have equal cell counts/u);
  });
});
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { asBlockId } from "@repo/editor-core/kernel";
