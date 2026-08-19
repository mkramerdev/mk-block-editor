import { describe, expect, it, vi } from "vitest";
import {
  createBlockRichTextContentFromPlainText,
  type EditorContentCheckpoint,
  type EditorContentOperationUpdate,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { EditorContentRuntime as CoreEditorContentRuntime } from "@repo/editor-core/content";
import type { EditorContentBaseToken } from "@repo/editor-core/operations";
import {
  asBlockId,
  type BlockId,
  type EditorOpaqueContentCheckpoint,
} from "@repo/editor-core/kernel";
import {
  createEditorContentRuntime,
  type EditorContentRuntime,
  type EditorWebContentRuntime,
} from "../runtime/content/content-runtime.ts";
import {
  decodeLocalContentCheckpoint,
  decodeLocalContentOperationUpdate,
  encodeLocalContentCheckpoint,
} from "../content/local/runtime.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";
import { createTestContentOperationUpdate } from "./editor-web-test-helpers.ts";

const firstBlockId = asBlockId("01890f07-1c00-7000-8000-000000008001");
const secondBlockId = asBlockId("01890f07-1c00-7000-8000-000000008002");

describe("local content prepare/apply/release protocol", () => {
  it("implements the core runtime contract through the web compatibility aliases", () => {
    const runtime = createRuntime({ [firstBlockId]: "contract" });
    const canonical: CoreEditorContentRuntime = runtime;
    const compatibility: EditorWebContentRuntime = canonical;

    expect(compatibility).toBe(runtime);
    runtime.destroy();
  });

  it("rejects a content lease owned by another runtime", () => {
    const owner = createRuntime({ [firstBlockId]: "owner" });
    const other = createRuntime({ [firstBlockId]: "other" });
    const foreignLease = owner.acquireBlockContent(
      firstBlockId,
      "paragraph",
      "active-editing",
    );

    expect(
      other.createTextAnchorInContext(foreignLease, {
        textOffset: 0,
        affinity: null,
      }),
    ).toMatchObject({
      ok: false,
      reason: "missing-text",
      message: "Block content lease is not owned by this runtime",
    });

    foreignLease.release();
    owner.destroy();
    other.destroy();
  });

  it("installs the exact deeply immutable prepared projection", () => {
    const runtime = createRuntime({
      [firstBlockId]: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "fixed",
                marks: [{ type: "strong" }],
              },
              { type: "text", text: "tail" },
            ],
          },
        ],
      },
    });
    const before = runtime.readBlockProjection(firstBlockId, "paragraph");
    const prepared = requirePreparation(
      prepareInsert(runtime, firstBlockId, 9, " after"),
    );
    const preparedProjection = runtime.readValidatedBlockContent(
      prepared,
      firstBlockId,
      "paragraph",
    );

    expect(preparedProjection).not.toBe(before);
    expectDeeplyFrozen(before);
    expectDeeplyFrozen(preparedProjection);
    expect(preparedProjection?.content[0]?.content?.[0]).toBe(
      before.content[0]?.content?.[0],
    );

    const applied = runtime.commitContent(prepared);
    expect(runtime.readBlockProjection(firstBlockId, "paragraph")).toBe(
      preparedProjection,
    );
    runtime.publishContentCommit(applied);
  });

  it("prepares without mutation or publication and applies silently", () => {
    const runtime = createRuntime({ [firstBlockId]: "before" });
    const blockListener = vi.fn();
    const commitListener = vi.fn();
    runtime.subscribeBlockProjection(firstBlockId, blockListener);
    runtime.subscribeContentCommits(commitListener);
    const prepared = prepareInsert(runtime, firstBlockId, 6, " after");

    expect(readText(runtime, firstBlockId)).toBe("before");
    expect(blockListener).not.toHaveBeenCalled();
    expect(commitListener).not.toHaveBeenCalled();

    const applied = requirePrepared(runtime, prepared);
    expect(readText(runtime, firstBlockId)).toBe("before after");
    expect(applied.blocks[0]?.inverseContentOperations).toMatchObject([
      { kind: "deleteInlineRange" },
    ]);
    expect(blockListener).not.toHaveBeenCalled();
    expect(commitListener).not.toHaveBeenCalled();

    runtime.publishContentCommit(applied);
    expect(blockListener).toHaveBeenCalledTimes(1);
    expect(commitListener).toHaveBeenCalledTimes(1);
  });

  it("rejects stale graph, stale content, and block-type mismatches", () => {
    const runtime = createRuntime({ [firstBlockId]: "A" });
    const token = runtime.readContentBaseToken(firstBlockId, "paragraph", 1);
    const operation = insertOperation(firstBlockId, 1, "B");

    expect(
      runtime.validateContentCommit({
        graphRevision: 0,
        changes: [{ baseToken: token, operations: [operation] }],
      }),
    ).toMatchObject({ ok: false, reason: "stale-graph-revision" });

    expect(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken: { ...token, blockType: "heading" },
            operations: [{ ...operation, blockType: "heading" }],
          },
        ],
      }),
    ).toMatchObject({ ok: false, reason: "block-type-mismatch" });

    runtime.applyExternalContentUpdate({
      blockGraphVersion: 1,
      blockId: firstBlockId,
      blockType: "paragraph",
      update: createTestContentOperationUpdate(runtime),
      readProjection: richText("external"),
      revision: 1,
    });
    expect(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [{ baseToken: token, operations: [operation] }],
      }),
    ).toMatchObject({ ok: false, reason: "stale-content-revision" });
  });

  it("rejects a multi-block batch without preparing a partial subset", () => {
    const runtime = createRuntime({
      [firstBlockId]: "A",
      [secondBlockId]: "B",
    });
    const firstToken = token(runtime, firstBlockId);
    const secondToken = token(runtime, secondBlockId);

    const rejected = runtime.validateContentCommit({
      graphRevision: 1,
      changes: [
        {
          baseToken: firstToken,
          operations: [insertOperation(firstBlockId, 1, "1")],
        },
        {
          baseToken: secondToken,
          operations: [insertOperation(secondBlockId, 100, "invalid")],
        },
      ],
    });

    expect(rejected).toMatchObject({
      ok: false,
      reason: "invalid-operation",
      changeIndex: 1,
    });
    expect(readText(runtime, firstBlockId)).toBe("A");
    expect(readText(runtime, secondBlockId)).toBe("B");
    expect(token(runtime, firstBlockId)).toEqual(firstToken);
    expect(token(runtime, secondBlockId)).toEqual(secondToken);
  });

  it("rejects malformed change relationships and non-reversible operations during preparation", () => {
    const runtime = createRuntime({ [firstBlockId]: "AB" });
    const firstToken = token(runtime, firstBlockId);
    const secondToken = { ...firstToken, blockId: secondBlockId };

    expect(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken: firstToken,
            operations: [insertOperation(secondBlockId, 1, "X")],
          },
        ],
      }),
    ).toMatchObject({ ok: false, reason: "invalid-operation" });
    expect(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken: firstToken,
            operations: [insertOperation(firstBlockId, 1, "X")],
          },
          {
            baseToken: firstToken,
            operations: [insertOperation(firstBlockId, 1, "Y")],
          },
        ],
      }),
    ).toMatchObject({ ok: false, reason: "invalid-operation" });
    expect(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken: secondToken,
            operations: [insertOperation(secondBlockId, 0, "X")],
          },
        ],
      }),
    ).toMatchObject({ ok: false, reason: "missing-block" });
    expect(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken: firstToken,
            operations: [
              {
                kind: "deleteInlineRange",
                blockId: firstBlockId,
                blockType: "paragraph",
                target: { kind: "text" },
                range: {
                  from: { blockId: firstBlockId, offset: 0 },
                  to: { blockId: firstBlockId, offset: 1 },
                },
              },
            ],
          },
        ],
      }),
    ).toMatchObject({ ok: false, reason: "invalid-operation" });
    expect(readText(runtime, firstBlockId)).toBe("AB");
  });

  it("stores reverse-ordered inverses and effective rebased operations", () => {
    const runtime = createRuntime({ [firstBlockId]: "abcabc" });
    const prepared = runtime.validateContentCommit({
      graphRevision: 1,
      changes: [
        {
          baseToken: token(runtime, firstBlockId),
          operations: [
            {
              kind: "deleteInlineRange",
              blockId: firstBlockId,
              blockType: "paragraph",
              target: { kind: "text" },
              range: {
                from: { blockId: firstBlockId, offset: 0 },
                to: { blockId: firstBlockId, offset: 2 },
              },
              deletedContent: [{ type: "text", text: "bc" }],
            },
            insertOperation(firstBlockId, 4, "Z"),
          ],
        },
      ],
      origin: "undo",
    });
    const applied = requirePrepared(runtime, prepared);

    expect(applied.blocks[0]?.contentOperations[0]).toMatchObject({
      range: { from: { offset: 1 }, to: { offset: 3 } },
    });
    expect(applied.blocks[0]?.inverseContentOperations).toMatchObject([
      { kind: "deleteInlineRange", range: { from: { offset: 4 } } },
      { kind: "insertInlineContent", position: { offset: 1 } },
    ]);
  });

  it("enforces single-use prepared and applied values", () => {
    const runtime = createRuntime({ [firstBlockId]: "A" });
    const prepared = requirePreparation(
      prepareInsert(runtime, firstBlockId, 1, "B"),
    );
    const applied = runtime.commitContent(prepared);

    expect(() => runtime.commitContent(prepared)).toThrow(
      /already been applied/,
    );
    runtime.publishContentCommit(applied);
    expect(() => runtime.publishContentCommit(applied)).toThrow(
      /already been finalized/,
    );
  });

  it("rejects a prepared commit whose base became stale before application", () => {
    const runtime = createRuntime({ [firstBlockId]: "A" });
    const prepared = requirePreparation(
      prepareInsert(runtime, firstBlockId, 1, "B"),
    );
    runtime.applyExternalContentUpdate({
      blockGraphVersion: 1,
      blockId: firstBlockId,
      blockType: "paragraph",
      update: createTestContentOperationUpdate(runtime),
      readProjection: richText("external"),
      revision: 1,
    });

    expect(() => runtime.commitContent(prepared)).toThrow(
      /Prepared content commit is stale/,
    );
    expect(() => runtime.commitContent(prepared)).toThrow(
      /unknown or has already been applied/,
    );
    expect(readText(runtime, firstBlockId)).toBe("external");
  });

  it("publishes an applied commit exactly once", () => {
    const runtime = createRuntime({ [firstBlockId]: "A" });
    const listener = vi.fn();
    runtime.subscribeBlockProjection(firstBlockId, listener);
    const applied = requirePrepared(
      runtime,
      prepareInsert(runtime, firstBlockId, 1, "B"),
    );

    expect(readText(runtime, firstBlockId)).toBe("AB");
    runtime.publishContentCommit(applied);
    expect(readText(runtime, firstBlockId)).toBe("AB");
    expect(listener).toHaveBeenCalledOnce();
  });

  it("removes a block atomically and publishes the deletion", () => {
    const runtime = createRuntime({ [firstBlockId]: "retained exactly" });
    const removedProjection = vi.fn();
    runtime.subscribeBlockProjection(firstBlockId, removedProjection);
    const prepared = requirePreparation(
      runtime.validateContentCommit({
        graphRevision: 1,
        resultingGraphRevision: 2,
        changes: [],
        removedBlockIds: [firstBlockId],
      }),
    );
    expect(prepared.blocks).toEqual([]);
    expect(prepared.affectedBlockIds).toEqual([firstBlockId]);
    expect(prepared.removedBlocks).toMatchObject([
      {
        blockId: firstBlockId,
        inverseContentOperations: [
          {
            kind: "insertInlineContent",
            position: { offset: 0 },
            content: [{ type: "text", text: "retained exactly" }],
          },
        ],
      },
    ]);
    const applied = requirePrepared(runtime, prepared);

    expect(() => readText(runtime, firstBlockId)).toThrow(/does not exist/);
    runtime.publishContentCommit(applied);
    expect(removedProjection).not.toHaveBeenCalled();
    expect(() => readText(runtime, firstBlockId)).toThrow(/does not exist/);
  });

  it("does not increment content revisions for no-op batches", () => {
    const runtime = createRuntime({ [firstBlockId]: "A" });
    const before = token(runtime, firstBlockId);
    const prepared = runtime.validateContentCommit({
      graphRevision: 1,
      changes: [],
    });
    const applied = requirePrepared(runtime, prepared);

    expect(applied.affectedBlockIds).toEqual([]);
    runtime.publishContentCommit(applied);
    expect(token(runtime, firstBlockId)).toEqual(before);
  });

  it("preserves execution order while notifying blocks deterministically", () => {
    const runtime = createRuntime({
      [firstBlockId]: "A",
      [secondBlockId]: "B",
    });
    const notifications: BlockId[] = [];
    runtime.subscribeBlockProjection(firstBlockId, () =>
      notifications.push(firstBlockId),
    );
    runtime.subscribeBlockProjection(secondBlockId, () =>
      notifications.push(secondBlockId),
    );
    const prepared = runtime.validateContentCommit({
      graphRevision: 1,
      changes: [
        {
          baseToken: token(runtime, secondBlockId),
          operations: [insertOperation(secondBlockId, 1, "2")],
        },
        {
          baseToken: token(runtime, firstBlockId),
          operations: [insertOperation(firstBlockId, 1, "1")],
        },
      ],
    });
    const applied = requirePrepared(runtime, prepared);

    expect(applied.affectedBlockIds).toEqual([secondBlockId, firstBlockId]);
    expect(applied.blocks.map((block) => block.blockId)).toEqual([
      secondBlockId,
      firstBlockId,
    ]);
    runtime.publishContentCommit(applied);
    expect(notifications).toEqual([firstBlockId, secondBlockId]);
  });
});

describe("local content stable text anchors", () => {
  it.each([
    { splitOffset: 0, affinity: "backward" as const },
    { splitOffset: 5, affinity: "backward" as const },
    { splitOffset: 11, affinity: "forward" as const },
  ])(
    "round-trips a replay-associated split anchor at offset $splitOffset",
    ({ splitOffset, affinity }) => {
      const runtime = createRuntime({ [firstBlockId]: "hello world" });
      const anchor = requireAnchor(
        runtime.tryCreateTextAnchorInLiveContext({
          blockId: firstBlockId,
          blockType: "paragraph",
          textOffset: splitOffset,
          affinity,
        }),
      );
      if (splitOffset < 11) {
        const suffix = "hello world".slice(splitOffset);
        const deletion = requirePrepared(
          runtime,
          runtime.validateContentCommit({
            graphRevision: 1,
            changes: [
              {
                baseToken: token(runtime, firstBlockId),
                operations: [
                  {
                    kind: "deleteInlineRange",
                    blockId: firstBlockId,
                    blockType: "paragraph",
                    target: { kind: "text" },
                    range: {
                      from: { blockId: firstBlockId, offset: splitOffset },
                      to: { blockId: firstBlockId, offset: 11 },
                    },
                    deletedContent: [{ type: "text", text: suffix }],
                  },
                ],
              },
            ],
          }),
        );
        runtime.publishContentCommit(deletion);
        const insertion = requirePrepared(
          runtime,
          prepareInsert(runtime, firstBlockId, splitOffset, suffix),
        );
        runtime.publishContentCommit(insertion);
      }

      expect(resolveAnchor(runtime, anchor)).toEqual({
        ok: true,
        textOffset: splitOffset,
      });
    },
  );

  it("rebases an anchor across insertion before its canonical point", () => {
    const runtime = createRuntime({ [firstBlockId]: "abcd" });
    const anchor = requireAnchor(
      runtime.tryCreateTextAnchorInLiveContext({
        blockId: firstBlockId,
        blockType: "paragraph",
        textOffset: 2,
        affinity: "forward",
      }),
    );

    const applied = requirePrepared(
      runtime,
      prepareInsert(runtime, firstBlockId, 0, "XY"),
    );
    runtime.publishContentCommit(applied);

    expect(
      runtime.tryResolveTextAnchorInLiveContext({
        blockId: firstBlockId,
        blockType: "paragraph",
        codec: anchor.codec,
        payload: anchor.payload,
      }),
    ).toEqual({ ok: true, textOffset: 4 });
  });

  it("preserves association at insertion and deletion boundaries", () => {
    const runtime = createRuntime({ [firstBlockId]: "abcd" });
    const backward = requireAnchor(
      runtime.tryCreateTextAnchorInLiveContext({
        blockId: firstBlockId,
        blockType: "paragraph",
        textOffset: 2,
        affinity: "backward",
      }),
    );
    const forward = requireAnchor(
      runtime.tryCreateTextAnchorInLiveContext({
        blockId: firstBlockId,
        blockType: "paragraph",
        textOffset: 2,
        affinity: "forward",
      }),
    );
    let applied = requirePrepared(
      runtime,
      prepareInsert(runtime, firstBlockId, 2, "X"),
    );
    runtime.publishContentCommit(applied);

    expect(resolveAnchor(runtime, backward)).toEqual({
      ok: true,
      textOffset: 2,
    });
    expect(resolveAnchor(runtime, forward)).toEqual({
      ok: true,
      textOffset: 3,
    });

    const base = token(runtime, firstBlockId);
    const prepared = runtime.validateContentCommit({
      graphRevision: 1,
      changes: [
        {
          baseToken: base,
          operations: [
            {
              kind: "deleteInlineRange",
              blockId: firstBlockId,
              blockType: "paragraph",
              target: { kind: "text" },
              range: {
                from: { blockId: firstBlockId, offset: 1 },
                to: { blockId: firstBlockId, offset: 4 },
              },
              deletedContent: [{ type: "text", text: "bXc" }],
            },
          ],
        },
      ],
    });
    applied = requirePrepared(runtime, prepared);
    runtime.publishContentCommit(applied);

    expect(resolveAnchor(runtime, backward)).toEqual({
      ok: true,
      textOffset: 1,
    });
    expect(resolveAnchor(runtime, forward)).toEqual({
      ok: true,
      textOffset: 1,
    });
    expect(backward.payload.assoc).toBe(-1);
    expect(forward.payload.assoc).toBe(1);
  });

  it("round-trips transport data and returns unresolved after untracked replacement", () => {
    const runtime = createRuntime({ [firstBlockId]: "abcd" });
    const anchor = requireAnchor(
      runtime.tryCreateTextAnchorInLiveContext({
        blockId: firstBlockId,
        blockType: "paragraph",
        textOffset: 3,
        affinity: "forward",
      }),
    );
    const transported = JSON.parse(
      JSON.stringify({ codec: anchor.codec, payload: anchor.payload }),
    ) as Pick<typeof anchor, "codec" | "payload">;

    expect(resolveAnchor(runtime, transported)).toEqual({
      ok: true,
      textOffset: 3,
    });

    runtime.applyExternalContentUpdate({
      blockGraphVersion: 1,
      blockId: firstBlockId,
      blockType: "paragraph",
      update: createTestContentOperationUpdate(runtime),
      readProjection: richText("replacement"),
      revision: 1,
    });

    expect(resolveAnchor(runtime, transported)).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("is unresolved while deleted and resolves when the same model identity is restored", () => {
    const runtime = createRuntime({ [firstBlockId]: "abcd" });
    const anchor = requireAnchor(
      runtime.tryCreateTextAnchorInLiveContext({
        blockId: firstBlockId,
        blockType: "paragraph",
        textOffset: 2,
        affinity: "forward",
      }),
    );
    const removal = requirePrepared(
      runtime,
      runtime.validateContentCommit({
        graphRevision: 1,
        resultingGraphRevision: 2,
        changes: [],
        removedBlockIds: [firstBlockId],
      }),
    );
    runtime.publishContentCommit(removal);

    expect(resolveAnchor(runtime, anchor)).toMatchObject({
      ok: false,
      reason: "missing-text",
    });

    const restoration = requirePrepared(
      runtime,
      runtime.validateContentCommit({
        graphRevision: 2,
        resultingGraphRevision: 3,
        introducedBlocks: { [firstBlockId]: "paragraph" },
        changes: [
          {
            baseToken: {
              graphRevision: 2,
              blockId: firstBlockId,
              blockType: "paragraph",
              contentRevision: 0,
            },
            operations: [insertOperation(firstBlockId, 0, "abcd")],
          },
        ],
      }),
    );
    runtime.publishContentCommit(restoration);

    expect(resolveAnchor(runtime, anchor)).toEqual({
      ok: true,
      textOffset: 2,
    });
  });
});

describe("local content envelopes", () => {
  it("round-trips checkpoints and validates format, version, and kind", () => {
    const content = richText("round trip");
    const checkpoint = encodeLocalContentCheckpoint(content);

    expect(decodeLocalContentCheckpoint(checkpoint)).toEqual(content);
    expect(() =>
      decodeLocalContentCheckpoint({ ...checkpoint, format: "unknown" }),
    ).toThrow(/Unknown local content format/);
    expect(() =>
      decodeLocalContentCheckpoint({ ...checkpoint, version: 99 }),
    ).toThrow(/Unknown local content version/);
    expect(() =>
      decodeLocalContentCheckpoint({
        ...checkpoint,
        // @ts-expect-error Operation envelopes are deliberately invalid checkpoint input.
        kind: "operation",
      }),
    ).toThrow(/Expected local checkpoint/);
  });

  it("publishes one immutable byte value without per-subscriber copies", () => {
    const runtime = createRuntime({ [firstBlockId]: "immutable" });
    const first = runtime.readBlockContentCheckpoint(firstBlockId, "paragraph");
    const originalByte = first.payload.byteAt(0);
    Reflect.set(first.payload, "0", 255);
    const second = runtime.readBlockContentCheckpoint(
      firstBlockId,
      "paragraph",
    );

    expect(second.payload.byteAt(0)).toBe(originalByte);

    let published: EditorContentOperationUpdate | undefined;
    runtime.subscribeContentCommits((commit) => {
      published = commit.blocks[0]?.operationUpdate;
    });
    const applied = requirePrepared(
      runtime,
      prepareInsert(runtime, firstBlockId, 9, "!"),
    );
    runtime.publishContentCommit(applied);
    expect(published).toBeDefined();
    expect(published).toBe(applied.blocks[0]?.operationUpdate);
    expect(published?.payload).toBe(applied.blocks[0]?.operationUpdate.payload);
  });

  it("keeps operation updates distinct from checkpoints", () => {
    const runtime = createRuntime({ [firstBlockId]: "A" });
    const applied = requirePrepared(
      runtime,
      prepareInsert(runtime, firstBlockId, 1, "B"),
    );
    const update = applied.blocks[0]!.operationUpdate;

    expect(decodeLocalContentOperationUpdate(update)).toHaveLength(1);
    expect(() =>
      decodeLocalContentCheckpoint(
        update as unknown as EditorContentCheckpoint,
      ),
    ).toThrow(/Expected local checkpoint/);
  });
});

function createRuntime(
  contentByBlockId: Record<BlockId, string | RichTextDocumentNodeJson>,
) {
  const blockTypesById = {} as Record<BlockId, "paragraph">;
  const contentById = {} as Record<BlockId, RichTextDocumentNodeJson>;
  const opaqueContentCheckpoints = {} as Record<
    BlockId,
    EditorOpaqueContentCheckpoint
  >;
  for (const [blockId, value] of Object.entries(contentByBlockId) as [
    BlockId,
    string | RichTextDocumentNodeJson,
  ][]) {
    blockTypesById[blockId] = "paragraph";
    contentById[blockId] = typeof value === "string" ? richText(value) : value;
    const checkpoint = encodeLocalContentCheckpoint(contentById[blockId]);
    opaqueContentCheckpoints[blockId] = {
      kind: checkpoint.kind,
      format: checkpoint.format,
      version: checkpoint.version,
      payloadBase64: encodeBase64(checkpoint.payload.copy()),
    };
  }
  return createEditorContentRuntime({
    blockDefinitions: testEditableEditorDefinition.blocks,
    inlineMarks: testEditableEditorDefinition.inlineMarks,
    inlineAtoms: testEditableEditorDefinition.inlineAtoms,
    blockGraphVersion: 1,
    blockTypesById,
    opaqueContentCheckpoints,
    contentById,
  });
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function token(
  runtime: EditorContentRuntime,
  blockId: BlockId,
): EditorContentBaseToken {
  return runtime.readContentBaseToken(blockId, "paragraph", 1);
}

function prepareInsert(
  runtime: EditorContentRuntime,
  blockId: BlockId,
  offset: number,
  text: string,
) {
  return runtime.validateContentCommit({
    graphRevision: 1,
    changes: [
      {
        baseToken: token(runtime, blockId),
        operations: [insertOperation(blockId, offset, text)],
      },
    ],
  });
}

function insertOperation(blockId: BlockId, offset: number, text: string) {
  return {
    kind: "insertInlineContent" as const,
    blockId,
    blockType: "paragraph" as const,
    target: { kind: "text" as const },
    position: { blockId, offset },
    content: [{ type: "text" as const, text }],
  };
}

function requirePreparation(
  value: ReturnType<EditorContentRuntime["validateContentCommit"]>,
) {
  if (!("kind" in value)) throw new Error(value.message);
  return value;
}

function requirePrepared(
  runtime: EditorContentRuntime,
  value: ReturnType<EditorContentRuntime["validateContentCommit"]>,
) {
  return runtime.commitContent(requirePreparation(value));
}

function readText(runtime: EditorContentRuntime, blockId: BlockId): string {
  return runtime.readBlockPlainText(blockId, "paragraph");
}

function requireAnchor(
  result: ReturnType<EditorContentRuntime["tryCreateTextAnchorInLiveContext"]>,
): Extract<
  ReturnType<EditorContentRuntime["tryCreateTextAnchorInLiveContext"]>,
  { ok: true }
> {
  if (!result.ok) {
    throw new Error("message" in result ? result.message : result.reason);
  }
  return result;
}

function resolveAnchor(
  runtime: EditorContentRuntime,
  anchor: Pick<
    Extract<
      ReturnType<EditorContentRuntime["tryCreateTextAnchorInLiveContext"]>,
      { ok: true }
    >,
    "codec" | "payload"
  >,
) {
  return runtime.tryResolveTextAnchorInLiveContext({
    blockId: firstBlockId,
    blockType: "paragraph",
    codec: anchor.codec,
    payload: anchor.payload,
  });
}

function richText(text: string): RichTextDocumentNodeJson {
  return createBlockRichTextContentFromPlainText("paragraph", text);
}

function expectDeeplyFrozen(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  expect(Object.isFrozen(value)).toBe(true);
  for (const child of Object.values(value)) expectDeeplyFrozen(child);
}
