import { describe, expect, it } from "vitest";
import type { BlockId } from "../../kernel/identity/ids.ts";
import { asBlockId } from "../../kernel/identity/uuid.ts";
import { createVersionedBlockRecord } from "../../metadata/block-record.ts";
import { testBlockDefinitions } from "../../testing/test-block-definitions.ts";
import {
  validateBlockGraphOperationBody,
  validateLogicalBlockGraphOperation,
} from "./block-graph.ts";

const id = (suffix: number): BlockId =>
  asBlockId(`01890f07-1c00-7000-8000-${String(suffix).padStart(12, "0")}`);
const rootId = id(1);
const root = createVersionedBlockRecord({
  id: rootId,
  type: "paragraph",
  version: { metadataVersion: "1", contentVersion: null },
});

const body = () => ({
  kind: "transformBlocks" as const,
  payload: {
    targetId: "graph-change",
    affectedBlockIds: [rootId],
    upsertedBlocks: [root],
    rootBlockIds: [rootId],
    childIdsByParentId: {},
  },
});

describe("block graph operation validation", () => {
  it("accepts an explicit ordered graph patch", () => {
    expect(
      validateBlockGraphOperationBody(body(), {
        blockDefinitions: testBlockDefinitions,
      }),
    ).toEqual({ valid: true, errors: [] });
  });

  it("accepts the logical operation envelope with the same graph payload", () => {
    expect(
      validateLogicalBlockGraphOperation({
        kind: "blockGraph",
        graphKind: "transformBlocks",
        payload: body().payload,
      }),
    ).toEqual({ valid: true, errors: [] });
  });

  it("requires explicit roots and direct-child sequences", () => {
    const payload = { ...body().payload } as Record<string, unknown>;
    delete payload.rootBlockIds;
    delete payload.childIdsByParentId;
    const result = validateBlockGraphOperationBody(
      { kind: "transformBlocks", payload },
      { blockDefinitions: testBlockDefinitions },
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "operation.payload.rootBlockIds must be an array",
        "operation.payload.childIdsByParentId must be an object",
      ]),
    );
  });

  it("rejects duplicate affected identities", () => {
    const result = validateBlockGraphOperationBody(
      {
        ...body(),
        payload: {
          ...body().payload,
          affectedBlockIds: [rootId, rootId],
        },
      },
      { blockDefinitions: testBlockDefinitions },
    );
    expect(result.errors).toContain(
      "operation.payload.affectedBlockIds must not contain duplicates",
    );
  });

  it("rejects persistence ranking fields in generic blocks", () => {
    const result = validateBlockGraphOperationBody(
      {
        ...body(),
        payload: {
          ...body().payload,
          upsertedBlocks: [{ ...root, persistentRank: "a0" }],
        },
      },
      { blockDefinitions: testBlockDefinitions },
    );
    expect(result.errors).toContain(
      "operation.payload.upsertedBlocks[0].persistentRank is not supported",
    );
  });

  it("rejects logical content batches that target removed blocks", () => {
    const result = validateBlockGraphOperationBody(
      {
        ...body(),
        payload: {
          ...body().payload,
          upsertedBlocks: [],
          rootBlockIds: [],
          removedBlockIds: [rootId],
          contentOperations: [
            {
              blockId: rootId,
              operations: [
                {
                  kind: "insertInlineContent",
                  blockId: rootId,
                  blockType: "textLeaf",
                  target: { kind: "text" },
                  position: { blockId: rootId, offset: 0 },
                  content: [{ type: "text", text: "removed" }],
                },
              ],
            },
          ],
        },
      },
      { blockDefinitions: testBlockDefinitions },
    );
    expect(result.errors).toContain(
      "operation.payload.contentOperations blockId must not reference removedBlockIds",
    );
  });

  it("rejects duplicate per-block logical operation batches", () => {
    const operation = {
      kind: "insertInlineContent",
      blockId: rootId,
      blockType: "paragraph",
      target: { kind: "text" },
      position: { blockId: rootId, offset: 0 },
      content: [{ type: "text", text: "ordered" }],
    } as const;
    const result = validateBlockGraphOperationBody(
      {
        ...body(),
        payload: {
          ...body().payload,
          contentOperations: [
            { blockId: rootId, operations: [operation] },
            { blockId: rootId, operations: [operation] },
          ],
        },
      },
      { blockDefinitions: testBlockDefinitions },
    );

    expect(result.errors).toContain(
      "operation.payload.contentOperations must not contain duplicate blockId batches",
    );
  });

  it("rejects the removed structural content field", () => {
    const removedField = ["content", "Effects"].join("");
    const result = validateBlockGraphOperationBody(
      {
        ...body(),
        payload: {
          ...body().payload,
          [removedField]: [],
        },
      },
      { blockDefinitions: testBlockDefinitions },
    );

    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      `operation.payload.${removedField} is not supported`,
    );
  });
});
