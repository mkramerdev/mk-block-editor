import { describe, expect, it } from "vitest";
import { validateEditorLogicalOperationBody } from "./logical-operations.ts";
import { asBlockId } from "../../kernel/identity/uuid.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000000101");
const blockId2 = asBlockId("01890f07-1c00-7000-8000-000000000102");

describe("logical operation body validation", () => {
  it("accepts direct metadata updates, explicit inverse deletions, and multi-block batches", () => {
    const operations = [
      {
        kind: "updateBlockMetadata",
        updates: [{ blockId, values: { label: "A" } }],
      },
      {
        kind: "updateBlockMetadata",
        updates: [],
        deletions: [{ blockId, fields: ["label"] }],
      },
      {
        kind: "updateBlockMetadata",
        updates: [
          { blockId, values: { label: "A" } },
          { blockId: blockId2, values: { caption: "B" } },
        ],
      },
    ];

    expect(
      operations.map((operation) =>
        validateEditorLogicalOperationBody(operation),
      ),
    ).toStrictEqual(operations.map(() => ({ valid: true, errors: [] })));
    expect(JSON.parse(JSON.stringify(operations[2]))).toStrictEqual(
      operations[2],
    );
  });

  it("does not impose a registration-order block-count limit on atomic updates", () => {
    const updates = Array.from({ length: 300 }, (_, index) => ({
      blockId: asBlockId(
        `01890f07-1c00-7000-8000-${String(index + 1).padStart(12, "0")}`,
      ),
      values: { value: index },
    }));

    expect(
      validateEditorLogicalOperationBody({
        kind: "updateBlockMetadata",
        updates,
      }),
    ).toStrictEqual({ valid: true, errors: [] });
  });

  it("rejects empty, duplicate, unknown-key, installed-token, envelope, and snapshot shapes", () => {
    const invalid = [
      { kind: "updateBlockMetadata", updates: [] },
      {
        kind: "updateBlockMetadata",
        updates: [
          { blockId, values: { label: "A" } },
          { blockId, values: { label: "B" } },
        ],
      },
      {
        kind: "updateBlockMetadata",
        updates: [{ blockId, values: { label: "A" }, writerToken: "client" }],
      },
      {
        kind: "updateBlockMetadata",
        transportEnvelope: "not-semantic",
        updates: [{ blockId, values: { label: "A" } }],
      },
      {
        kind: "updateBlockMetadata",
        updates: [
          { blockId, values: { label: "A" }, metadata: { label: "A" } },
        ],
      },
    ];

    expect(
      invalid.map(
        (operation) => validateEditorLogicalOperationBody(operation).valid,
      ),
    ).toStrictEqual([false, false, false, false, false]);
  });

  it("rejects oversized and excessively nested metadata batches", () => {
    const nested: Record<string, unknown> = {};
    let cursor = nested;
    for (let level = 0; level < 40; level += 1) {
      const next: Record<string, unknown> = {};
      cursor.next = next;
      cursor = next;
    }
    expect(
      validateEditorLogicalOperationBody({
        kind: "updateBlockMetadata",
        updates: [{ blockId, values: { deep: nested } }],
      }).errors,
    ).toContain("operation exceeds maximum JSON depth 32");
    expect(
      validateEditorLogicalOperationBody({
        kind: "updateBlockMetadata",
        updates: [{ blockId, values: { large: "x".repeat(300_000) } }],
      }).errors,
    ).toContain("operation exceeds 262144 UTF-8 bytes");
  });

  it("validates rich content operation bodies", () => {
    expect(
      validateEditorLogicalOperationBody({
        kind: "insertInlineContent",
        blockId,
        blockType: "textBlock",
        target: { kind: "text" },
        position: { blockId, offset: 0 },
        content: [{ type: "text", text: "A" }],
      }),
    ).toStrictEqual({ valid: true, errors: [] });
  });

  it("rejects body errors from the model-owned focused validators", () => {
    expect(
      validateEditorLogicalOperationBody({
        kind: "updateBlockMetadata",
        updates: [
          {
            blockId,
            values: { "": true },
          },
        ],
      }).errors,
    ).toStrictEqual([
      "operation.updates[0].values contains invalid metadata field ",
    ]);
  });

  it("delegates non-text coordinate target validation to inline content", () => {
    expect(
      validateEditorLogicalOperationBody({
        kind: "insertInlineContent",
        blockId,
        blockType: "textBlock",
        target: { kind: "nested-content", groupIndex: 0, itemIndex: 0 },
        position: { blockId, offset: 0 },
        content: [{ type: "text", text: "A" }],
      }).errors,
    ).toEqual(
      expect.arrayContaining([
        "operation.target.kind must be text",
        "operation.target.groupIndex is not supported",
        "operation.target.itemIndex is not supported",
      ]),
    );
  });

  it("rejects extra structural keys on operation bodies", () => {
    expect(
      validateEditorLogicalOperationBody({
        ...validInlineOperation(),
        extraBodyField: "extra-a",
      }).errors,
    ).toContain("operation.extraBodyField is not supported");
  });

  it("rejects extra structural keys on targets and points", () => {
    const result = validateEditorLogicalOperationBody({
      ...validInlineOperation(),
      target: { kind: "text", cell: { rowIndex: 0, columnIndex: 0 } },
      position: { blockId, offset: 0, sticky: "before" },
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        "operation.target.cell is not supported",
        "operation.position.sticky is not supported",
      ]),
    );
  });

  it("rejects extra structural keys on block graph operations and transform payloads", () => {
    const result = validateEditorLogicalOperationBody({
      ...validBlockGraphOperation(),
      retryToken: "retry-a",
      payload: {
        ...(validBlockGraphOperation().payload as Record<string, unknown>),
        cacheRow: "row-a",
        upsertedBlocks: [
          {
            ...((
              validBlockGraphOperation().payload as {
                readonly upsertedBlocks: readonly Record<string, unknown>[];
              }
            ).upsertedBlocks[0] ?? {}),
            unsupportedRenderData: "value-a",
          },
        ],
      },
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        "operation.retryToken is not supported",
        "operation.payload.cacheRow is not supported",
        "operation.payload.upsertedBlocks[0].unsupportedRenderData is not supported",
      ]),
    );
  });

  it("keeps inline attrs and metadata values extensible JSON", () => {
    expect(
      validateEditorLogicalOperationBody({
        kind: "addInlineMark",
        blockId,
        blockType: "textBlock",
        target: { kind: "text" },
        range: { from: { blockId, offset: 0 }, to: { blockId, offset: 1 } },
        markName: "annotation",
        attrs: {
          productKey: "comment-a",
          nested: { customNestedKey: "value-a", values: [1, true, null] },
        },
      }),
    ).toStrictEqual({ valid: true, errors: [] });

    expect(
      validateEditorLogicalOperationBody({
        kind: "updateBlockMetadata",
        updates: [
          {
            blockId,
            values: {
              productKey: {
                label: "metadata-a",
                nested: { customNestedKey: "value-a", values: [1, true, null] },
              },
            },
          },
        ],
      }),
    ).toStrictEqual({ valid: true, errors: [] });
  });

  it("accepts durable JSON inline content, attrs, entity payloads, and metadata", () => {
    expect(
      validateEditorLogicalOperationBody({
        kind: "replaceInlineRange",
        blockId,
        blockType: "textBlock",
        target: { kind: "text" },
        range: { from: { blockId, offset: 0 }, to: { blockId, offset: 1 } },
        content: [
          {
            type: "mention",
            metadata: {
              id: "user-a",
            },
          },
        ],
        deletedContent: [
          { type: "text", text: "A", marks: [{ type: "strong" }] },
        ],
      }),
    ).toStrictEqual({ valid: true, errors: [] });

    expect(
      validateEditorLogicalOperationBody({
        kind: "setInlineEntity",
        blockId,
        blockType: "textBlock",
        target: { kind: "text" },
        range: { from: { blockId, offset: 0 }, to: { blockId, offset: 1 } },
        entity: {
          type: "mention",
          metadata: {
            id: "user-a",
          },
        },
      }),
    ).toStrictEqual({ valid: true, errors: [] });
  });

  it("rejects malformed durable JSON values in metadata operations", () => {
    const circular: Record<string, unknown> = { productKey: "value-a" };
    circular.self = circular;

    expect(
      validateEditorLogicalOperationBody({
        kind: "updateBlockMetadata",
        updates: [{ blockId, values: { bad: undefined } }],
      }).errors,
    ).toContain("operation.updates[0].values.bad must be a JSON value");

    expect(
      validateEditorLogicalOperationBody({
        kind: "updateBlockMetadata",
        updates: [{ blockId, values: { bad: circular } }],
      }).errors,
    ).toContain(
      "operation.updates[0].values.bad.self must not contain circular references",
    );

    expect(
      validateEditorLogicalOperationBody({
        kind: "updateBlockMetadata",
        updates: [{ blockId, values: { bad: new Date() as never } }],
      }).errors,
    ).toEqual(
      expect.arrayContaining([
        "operation.updates[0].values.bad must be a JSON value",
      ]),
    );
  });

  it("rejects malformed durable JSON values in inline content operations", () => {
    expect(
      validateEditorLogicalOperationBody({
        ...validInlineOperation(),
        content: [{ type: "text", text: "A", bad: () => undefined }],
      }).errors,
    ).toContain("operation.content[0].bad must be a JSON value");

    expect(
      validateEditorLogicalOperationBody({
        ...validInlineOperation(),
        content: [["not", "an", "object"]],
      }).errors,
    ).toContain("operation.content[0] must be a JSON object");

    expect(
      validateEditorLogicalOperationBody({
        kind: "addInlineMark",
        blockId,
        blockType: "textBlock",
        target: { kind: "text" },
        range: { from: { blockId, offset: 0 }, to: { blockId, offset: 1 } },
        markName: "annotation",
        attrs: new Map([["id", "comment-a"]]) as never,
      }).errors,
    ).toEqual(
      expect.arrayContaining([
        "operation.attrs must be a JSON value",
        "operation.attrs must be a JSON object",
      ]),
    );

    expect(
      validateEditorLogicalOperationBody({
        kind: "setInlineEntity",
        blockId,
        blockType: "textBlock",
        target: { kind: "text" },
        range: { from: { blockId, offset: 0 }, to: { blockId, offset: 1 } },
        entity: new (class EntityPayload {
          readonly type = "mention";
        })() as never,
      }).errors,
    ).toEqual(
      expect.arrayContaining([
        "operation.entity must be a JSON value",
        "operation.entity must be a JSON object",
      ]),
    );
  });

  it("rejects runtime hint fields in durable block graph operation payloads", () => {
    const operation = validBlockGraphOperation();
    const result = validateEditorLogicalOperationBody({
      ...operation,
      payload: {
        ...operation.payload,
        focusBlockId: blockId2,
        focusOffset: 0,
        selection: {
          anchor: { blockId: blockId2, offset: 0 },
          focus: { blockId: blockId2, offset: 1 },
        },
        cursor: { blockId: blockId2, offset: 0 },
        placement: "end",
        preventScroll: true,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "operation.payload.focusBlockId is not supported",
        "operation.payload.focusOffset is not supported",
        "operation.payload.selection is not supported",
        "operation.payload.cursor is not supported",
        "operation.payload.placement is not supported",
        "operation.payload.preventScroll is not supported",
      ]),
    );
  });
});

function validInlineOperation() {
  return {
    kind: "insertInlineContent",
    blockId,
    blockType: "textBlock",
    target: { kind: "text" },
    position: { blockId, offset: 0 },
    content: [{ type: "text", text: "A" }],
  };
}

function validBlockGraphOperation() {
  return {
    kind: "blockGraph",
    graphKind: "transformBlocks",
    payload: {
      targetId: "transform-a",
      affectedBlockIds: [blockId2],
      upsertedBlocks: [
        {
          id: blockId2,
          type: "textBlock",
          parentId: null,
          metadataVersion: "meta-1",
          contentVersion: null,
          tombstone: null,
          metadata: { productKey: "metadata-a" },
        },
      ],
      removedBlockIds: [],
      rootBlockIds: [blockId2],
      childIdsByParentId: {},
    },
  };
}
