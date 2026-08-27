import { describe, expect, it } from "vitest";
import type { BlockDefinition } from "../definitions/block-definition.ts";
import type { Block, BlockType } from "../document/model/block.ts";
import type { EditorInstanceSnapshot } from "../document/model/snapshot.ts";
import { INITIAL_BLOCK_GRAPH_VERSION } from "../document/lifecycle/block-graph-version.ts";
import { asBlockId } from "../kernel/identity/uuid.ts";
import type { BlockId } from "../kernel/identity/ids.ts";
import { createBlockRichTextContentFromPlainText } from "../content/rich-text/rich-inline-content.ts";
import { EditorImmutableBinary } from "../kernel/content/encoded-content.ts";
import {
  assertValidEditorInstanceSnapshot,
  validateEditorInstanceBlockSlice,
  validateEditorInstanceSnapshot,
  validateEditorInstanceSnapshotAtBoundary,
} from "./snapshots.ts";
const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
  textBlock: {
    kind: "text",
    type: "textBlock",
  },
  alternateTextBlock: { kind: "text", type: "alternateTextBlock" },
  textbox: { kind: "text", type: "textbox" },
  collection: {
    kind: "wrapper",
    type: "collection",
    contentBoundary: true,
    content: { required: ["collectionGroup"], additional: "collectionGroup" },
  },
  collectionGroup: {
    kind: "wrapper",
    type: "collectionGroup",
    contentBoundary: true,
    content: { required: ["collectionText"], additional: "collectionText" },
  },
  collectionText: {
    kind: "text",
    type: "collectionText",
  },
  atomicBlock: { kind: "atomic", type: "atomicBlock" },
};
const options = { blockDefinitions: definitions };

describe("editor snapshot text content ownership", () => {
  it("captures an owned snapshot instead of certifying caller-owned aliases", () => {
    const blockId = id(1);
    const source = {
      blockGraphVersion: INITIAL_BLOCK_GRAPH_VERSION,
      blocks: {
        [blockId]: {
          id: blockId,
          type: "textBlock",
          parentId: null,
          tombstone: null,
          metadata: { nested: { label: "before" } },
        },
      },
      rootBlockIds: [blockId],
      childIdsByParentId: {},
      content: {
        [blockId]: {
          type: "doc" as const,
          content: [
            {
              type: "paragraph" as const,
              content: [{ type: "text" as const, text: "before" }],
            },
          ],
        },
      },
      opaqueContentCheckpoints: {
        [blockId]: {
          kind: "checkpoint" as const,
          format: "test-content",
          version: 1,
          payloadBase64: "AQ==",
        },
      },
    };
    const validated = validateEditorInstanceSnapshotAtBoundary(source, options);

    source.rootBlockIds.length = 0;
    const sourceBlock = source.blocks[blockId];
    const sourceContent = source.content[blockId];
    const sourceCheckpoint = source.opaqueContentCheckpoints[blockId];
    expect(sourceBlock).toBeDefined();
    expect(sourceContent).toBeDefined();
    expect(sourceCheckpoint).toBeDefined();
    if (!sourceBlock || !sourceContent || !sourceCheckpoint) {
      throw new Error("snapshot fixture is incomplete");
    }
    sourceBlock.metadata.nested.label = "after";
    sourceContent.content[0]!.content[0]!.text = "after";
    sourceCheckpoint.payloadBase64 = "Ag==";

    expect(validated.snapshot.rootBlockIds).toStrictEqual([blockId]);
    expect(validated.snapshot.blocks[blockId]?.metadata).toStrictEqual({
      nested: { label: "before" },
    });
    expect(validated.snapshot.content[blockId]).toMatchObject({
      content: [{ content: [{ text: "before" }] }],
    });
    expect(
      validated.snapshot.opaqueContentCheckpoints[blockId]?.payloadBase64,
    ).toBe("AQ==");
  });

  it.each(["textBlock", "alternateTextBlock", "textbox"] as const)(
    "requires rich-text content for %s",
    (type) => {
      const snapshot = singleBlockSnapshot(type);
      expect(validateEditorInstanceSnapshot(snapshot, options)).toStrictEqual({
        ok: true,
      });
      expect(
        validateEditorInstanceSnapshot({ ...snapshot, content: {} }, options),
      ).toMatchObject({
        ok: false,
        errors: expect.arrayContaining([
          expect.stringContaining("is missing rich-text content"),
        ]),
      });
    },
  );

  it("requires rich-text content for nested collection text", () => {
    const snapshot = tableSnapshot();
    expect(validateEditorInstanceSnapshot(snapshot, options)).toStrictEqual({
      ok: true,
    });
    expect(
      validateEditorInstanceSnapshot({ ...snapshot, content: {} }, options),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.stringContaining("is missing rich-text content"),
      ]),
    });
  });

  it.each([
    ["wrapper", tableSnapshot(), id(1)],
    ["atomic", singleBlockSnapshot("atomicBlock"), id(1)],
  ] as const)(
    "rejects text content on an %s block",
    (_label, snapshot, blockId) => {
      const content = {
        ...snapshot.content,
        [blockId]: createBlockRichTextContentFromPlainText("textBlock", ""),
      };
      expect(
        validateEditorInstanceSnapshot({ ...snapshot, content }, options),
      ).toMatchObject({
        ok: false,
        errors: expect.arrayContaining([
          expect.stringContaining("must not have text content"),
        ]),
      });
    },
  );

  it.each([
    ["string", "plain text"],
    ["generic object", {}],
    ["malformed rich text", { type: "doc", content: [{ type: "alternateTextBlock" }] }],
  ])("rejects %s content", (_label, value) => {
    const snapshot = singleBlockSnapshot("textBlock");
    expect(
      validateEditorInstanceSnapshot(
        { ...snapshot, content: { [id(1)]: value } },
        options,
      ),
    ).toMatchObject({ ok: false });
  });

  it("rejects content for missing and tombstoned blocks", () => {
    const snapshot = singleBlockSnapshot("textBlock");
    const missing = id(99);
    expect(
      validateEditorInstanceSnapshot(
        {
          ...snapshot,
          content: {
            ...snapshot.content,
            [missing]: createBlockRichTextContentFromPlainText("textBlock", ""),
          },
        },
        options,
      ),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.stringContaining("references missing or tombstoned block"),
      ]),
    });
    expect(
      validateEditorInstanceSnapshot(
        {
          ...snapshot,
          blocks: {
            ...snapshot.blocks,
            [missing]: block(missing, "textBlock", null, {
              deletedAt: 1,
              reason: "user-delete",
            }),
          },
          content: {
            ...snapshot.content,
            [missing]: createBlockRichTextContentFromPlainText("textBlock", ""),
          },
        },
        options,
      ),
    ).toMatchObject({ ok: false });
  });

  it("rejects unsupported block types and inline marks", () => {
    const unknown = singleBlockSnapshot("unknown");
    expect(validateEditorInstanceSnapshot(unknown, options)).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.stringContaining("unsupported type unknown"),
      ]),
    });
    const marked = singleBlockSnapshot("textBlock");
    expect(
      validateEditorInstanceSnapshot(marked, {
        blockDefinitions: definitions,
        inlineMarks: [],
      }),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.stringContaining("unsupported inline mark strong"),
      ]),
    });
  });

  it("rejects content attached to a wrapper block", () => {
    const snapshot = tableSnapshot();
    expect(
      validateEditorInstanceSnapshot(
        {
          ...snapshot,
          content: {
            ...snapshot.content,
            [id(1)]: { rows: 1, columns: 1, cells: [["legacy"]] },
          },
        },
        options,
      ),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.stringContaining("must not have text content"),
      ]),
    });
  });

  it("applies the same ownership contract to block slices", () => {
    const textBlock = block(id(1), "textBlock");
    const wrapper = block(id(2), "collection");
    const base = {
      blockGraphVersion: INITIAL_BLOCK_GRAPH_VERSION,
      affectedBlockIds: [textBlock.id, wrapper.id],
      blocks: { [textBlock.id]: textBlock, [wrapper.id]: wrapper },
      rootBlockIds: [textBlock.id, wrapper.id],
      childIdsByParentId: {},
      content: {
        [textBlock.id]: createBlockRichTextContentFromPlainText(
          "textBlock",
          "",
        ),
      },
      contentCheckpoints: {
        [textBlock.id]: {
          kind: "checkpoint" as const,
          format: "test-content",
          version: 1,
          payload: EditorImmutableBinary.copyOf(new Uint8Array([1])),
        },
      },
    };
    expect(validateEditorInstanceBlockSlice(base, options)).toStrictEqual({
      ok: true,
    });
    expect(
      validateEditorInstanceBlockSlice(
        {
          ...base,
          content: {
            ...base.content,
            [wrapper.id]: createBlockRichTextContentFromPlainText(
              "textBlock",
              "",
            ),
          },
        },
        options,
      ),
    ).toMatchObject({ ok: false });
    const missingCheckpoints = { ...base } as Record<string, unknown>;
    delete missingCheckpoints.contentCheckpoints;
    expect(
      validateEditorInstanceBlockSlice(missingCheckpoints, options),
    ).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([
        expect.stringContaining("contentCheckpoints must be a record"),
      ]),
    });
  });

  it("asserts valid snapshots with definitions", () => {
    expect(() =>
      assertValidEditorInstanceSnapshot(tableSnapshot(), options),
    ).not.toThrow();
  });
});

function singleBlockSnapshot(type: BlockType): EditorInstanceSnapshot {
  const blockId = id(1);
  const definition = definitions[type];
  return {
    blockGraphVersion: INITIAL_BLOCK_GRAPH_VERSION,
    blocks: { [blockId]: block(blockId, type) },
    rootBlockIds: [blockId],
    childIdsByParentId: {},
    content:
      definition?.kind === "text" || type === "unknown"
        ? {
            [blockId]:
              type === "textBlock"
                ? {
                    type: "doc",
                    content: [
                      {
                        type: "paragraph",
                        content: [
                          {
                            type: "text",
                            text: "x",
                            marks: [{ type: "strong" }],
                          },
                        ],
                      },
                    ],
                  }
                : createBlockRichTextContentFromPlainText(type, ""),
          }
        : {},
    opaqueContentCheckpoints:
      definition?.kind === "text" || type === "unknown"
        ? { [blockId]: opaqueCheckpoint() }
        : {},
  };
}

function tableSnapshot(): EditorInstanceSnapshot {
  const tableId = id(1);
  const rowId = id(2);
  const cellId = id(3);
  return {
    blockGraphVersion: INITIAL_BLOCK_GRAPH_VERSION,
    blocks: {
      [tableId]: block(tableId, "collection"),
      [rowId]: block(rowId, "collectionGroup", tableId),
      [cellId]: block(cellId, "collectionText", rowId),
    },
    rootBlockIds: [tableId],
    childIdsByParentId: { [tableId]: [rowId], [rowId]: [cellId] },
    content: {
      [cellId]: createBlockRichTextContentFromPlainText("collectionText", ""),
    },
    opaqueContentCheckpoints: { [cellId]: opaqueCheckpoint() },
  };
}

function opaqueCheckpoint() {
  return {
    kind: "checkpoint" as const,
    format: "test-content",
    version: 1,
    payloadBase64: "AA==",
  };
}

function block(
  blockId: BlockId,
  type: BlockType,
  parentId: BlockId | null = null,
  tombstone: Block["tombstone"] = null,
): Block {
  return { id: blockId, type, parentId, tombstone };
}

function id(value: number): BlockId {
  return asBlockId(`block-${value}`);
}
