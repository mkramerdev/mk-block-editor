import { describe, expect, it } from "vitest";
import type { BlockId } from "../kernel/identity/ids.ts";
import type { ContentVersion } from "../kernel/versioning/versions.ts";
import { createBlockRecord, createVersionedBlockRecord } from "./block-record.ts";

describe("editor block factory", () => {
  it("fills canonical defaults and preserves caller metadata without product-specific sanitization", () => {
    const blockId = "block-1" as BlockId;

    expect(
      createBlockRecord({
        id: blockId,
        type: "heading",
        metadata: { level: 99, archived: true },
      }),
    ).toStrictEqual({
      id: blockId,
      type: "heading",
      parentId: null,
      tombstone: null,
      metadata: { level: 99, archived: true },
    });
  });

  it("preserves explicit graph fields and semantic tombstone metadata", () => {
    const parentId = "parent" as BlockId;

    expect(
      createBlockRecord({
        id: "child" as BlockId,
        type: "paragraph",
        parentId: parentId,
        tombstone: {
          deletedAt: 10,
          reason: "user-delete",
        },
      }),
    ).toStrictEqual({
      id: "child",
      type: "paragraph",
      parentId: parentId,
      tombstone: {
        deletedAt: 10,
        reason: "user-delete",
      },
    });
  });

  it("creates explicit versioned runtime block records outside the canonical factory", () => {
    const blockId = "block-2" as BlockId;

    expect(
      createVersionedBlockRecord({
        id: blockId,
        type: "paragraph",
        version: {
          metadataVersion: "7",
          contentVersion: "v1" as ContentVersion,
        },
      }),
    ).toStrictEqual({
      id: blockId,
      type: "paragraph",
      parentId: null,
      metadataVersion: "7",
      contentVersion: "v1",
      tombstone: null,
    });
  });
});
