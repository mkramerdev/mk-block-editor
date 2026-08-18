import { describe, expect, it } from "vitest";
import { createBlockId, cloneJsonValue } from "@repo/editor-core/kernel";
import {
  createCanonicalBlockFragment,
  createCanonicalBlockRecord,
  replaceBlockMetadata,
  validateStructuralDocument,
} from "@repo/editor-core/editing";
import { assertValidBlockDefinitions } from "@repo/editor-core/definitions";
import { contentSelection } from "@repo/editor-core/selection";
import { validateEditorLogicalOperationBody } from "@repo/editor-core/operations";
import { incrementVersion } from "@repo/editor-core/editing";
import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content";
import { validateRichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import { boldMarkDefinition } from "@repo/editor-core/content/marks";
import { validateAndCloneInlineAtomMetadata } from "@repo/editor-core/content/inline-atoms";
import { sanitizeEditorLinkUrl } from "@repo/editor-core/content/urls";
import {
  createBlockRecord,
  normalizeBlockMetadata,
} from "@repo/editor-core/metadata";
import { validateEditorInstanceSnapshot } from "@repo/editor-core/codecs";
import { testBlockDefinitions } from "@repo/editor-core/testing";

describe("editor-core public API barrels", () => {
  it("exposes representative symbols from the final domain entrypoints", () => {
    const blockId = createBlockId();
    const block = createBlockRecord({
      id: blockId,
      type: "paragraph",
      metadata: { label: "A" },
    });
    const richText = createBlockRichTextContentFromPlainText(
      "paragraph",
      "Hello",
    );
    const detached = createCanonicalBlockRecord({
      type: "paragraph",
      content: richText,
      plainText: "Hello",
    });
    const fragment = createCanonicalBlockFragment({
      blocks: [detached],
      rootBlockIds: [detached.id],
      start: { kind: "text", blockId: detached.id },
      end: { kind: "text", blockId: detached.id },
      blockDefinitions: testBlockDefinitions,
    });

    expect(cloneJsonValue({ ok: true })).toStrictEqual({ ok: true });
    expect(normalizeBlockMetadata(block.metadata)).toStrictEqual({
      label: "A",
    });
    expect(validateRichTextDocumentNodeJson(richText).valid).toBe(true);
    expect(boldMarkDefinition.name).toBe("strong");
    expect(
      validateAndCloneInlineAtomMetadata(
        { id: "u1" },
        { id: { type: "string", required: true } },
      ),
    ).toMatchObject({ valid: true, value: { id: "u1" } });
    expect(sanitizeEditorLinkUrl("example.test")).toBe("https://example.test");
    expect(validateEditorLogicalOperationBody({ kind: "unknown" }).valid).toBe(
      false,
    );
    expect(
      validateStructuralDocument({
        blocks: { [block.id]: block },
        rootBlockIds: [block.id],
        childIdsByParentId: {},
        blockDefinitions: testBlockDefinitions,
      }).valid,
    ).toBe(true);
    expect(
      validateEditorInstanceSnapshot(
        {
          blockGraphVersion: 1,
          blocks: { [block.id]: block },
          rootBlockIds: [block.id],
          childIdsByParentId: {},
          content: { [block.id]: richText },
          opaqueContentCheckpoints: {
            [block.id]: {
              kind: "checkpoint",
              format: "test-content",
              version: 1,
              payloadBase64: "AA==",
            },
          },
        },
        { blockDefinitions: testBlockDefinitions },
      ).ok,
    ).toBe(true);
    expect(assertValidBlockDefinitions(testBlockDefinitions)).toBeUndefined();
    expect(contentSelection().projection.category).toBe("text");
    expect(incrementVersion("1")).toBe("2");
    expect(fragment).toMatchObject({
      blocks: [{ id: detached.id, plainText: "Hello" }],
      rootBlockIds: [detached.id],
      start: { kind: "text", blockId: detached.id },
    });
    expect(
      replaceBlockMetadata({
        blockId,
        expectedMetadataVersion: "1",
        metadata: { label: "B" },
      }),
    ).toStrictEqual({
      kind: "replaceBlockMetadata",
      blockId,
      expectedMetadataVersion: "1",
      metadata: { label: "B" },
    });
  });
});
