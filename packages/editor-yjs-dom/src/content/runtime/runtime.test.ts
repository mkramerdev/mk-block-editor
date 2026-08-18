import { describe, expect, it } from "vitest";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType } from "@repo/editor-core/document";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import {
  createBlockRichTextContentFromPlainText,
  EditorImmutableBinary,
  type EditorContentOperationUpdate,
  type EditorOpaqueContentCheckpoint,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import {
  applyUpdate,
  createBlockContentDocContext,
  createYjsBlockContentCheckpoint,
  Doc,
  encodeStateAsUpdate,
  encodeStateVector,
  writeCanonicalYjsBlockContent,
} from "@repo/editor-yjs";
import { readYjsBlockContentPlainText } from "../projection/block-content-mapping.ts";
import { createYjsBlockContentRuntime } from "./runtime.ts";

const definitions = {
  paragraph: { kind: "text", type: "paragraph", rootLayout: "normal" },
  wrapper: { kind: "wrapper", type: "wrapper", rootLayout: "normal" },
  divider: { kind: "atomic", type: "divider", rootLayout: "normal" },
} satisfies Readonly<Record<BlockType, BlockDefinition>>;

const id = (suffix: number) =>
  asBlockId(`01890f07-1c00-7000-8000-${String(suffix).padStart(12, "0")}`);

describe("independent encoded Yjs block content", () => {
  it("keeps 100 checkpoints opaque and constructs no Y.Doc at startup", () => {
    const source = sourceFor(
      Object.fromEntries(
        Array.from({ length: 100 }, (_, index) => [
          id(index + 1),
          `Block ${index + 1}`,
        ]),
      ),
    );
    const runtime = createYjsBlockContentRuntime(source);
    expect(runtime.getLiveBlockContentCount()).toBe(0);
    expect(runtime.readBlockProjection(id(1), "paragraph")).toBe(
      source.contentById[id(1)],
    );
    expect(runtime.getLiveBlockContentCount()).toBe(0);
    runtime.destroy();
  });

  it("hydrates exactly the acquired block and disposes it after its lease", () => {
    const runtime = createYjsBlockContentRuntime(
      sourceFor({ [id(1)]: "A", [id(2)]: "B" }),
    );
    const a = runtime.acquireBlockContent(id(1), "paragraph", "active-editing");
    expect(runtime.getLiveBlockContentCount()).toBe(1);
    expect(readYjsBlockContentPlainText(a.context)).toBe("A");
    const b = runtime.acquireBlockContent(id(2), "paragraph", "active-editing");
    expect(a.context.doc).not.toBe(b.context.doc);
    expect(runtime.getLiveBlockContentCount()).toBe(2);
    a.release();
    expect(runtime.getLiveBlockContentCount()).toBe(1);
    expect(readYjsBlockContentPlainText(b.context)).toBe("B");
    b.release();
    expect(runtime.getLiveBlockContentCount()).toBe(0);
    runtime.destroy();
  });

  it("constructs one context per activation and releases it across A to B to A", () => {
    const runtime = createYjsBlockContentRuntime(
      sourceFor({ [id(1)]: "A", [id(2)]: "B" }),
    );

    const firstA = runtime.acquireBlockContent(
      id(1),
      "paragraph",
      "active-editing",
    );
    const firstAContext = firstA.context;
    expect(firstA.context).toBe(firstAContext);
    expect(runtime.getLiveBlockContentCount()).toBe(1);
    firstA.release();
    expect(runtime.getLiveBlockContentCount()).toBe(0);

    const blockB = runtime.acquireBlockContent(
      id(2),
      "paragraph",
      "active-editing",
    );
    expect(runtime.getLiveBlockContentCount()).toBe(1);
    expect(blockB.context.doc).not.toBe(firstAContext.doc);
    blockB.release();
    expect(runtime.getLiveBlockContentCount()).toBe(0);

    const secondA = runtime.acquireBlockContent(
      id(1),
      "paragraph",
      "active-editing",
    );
    expect(runtime.getLiveBlockContentCount()).toBe(1);
    expect(secondA.context).not.toBe(firstAContext);
    expect(secondA.context.doc).not.toBe(firstAContext.doc);
    secondA.release();
    expect(runtime.getLiveBlockContentCount()).toBe(0);
    runtime.destroy();
  });

  it("advances an inactive block with a merged update without hydrating it", () => {
    const source = sourceFor({ [id(1)]: "before", [id(2)]: "untouched" });
    const runtime = createYjsBlockContentRuntime(source);
    const next = richText("after");
    const update = updateFromCheckpoint(
      id(1),
      source.opaqueContentCheckpoints[id(1)]!,
      next,
    );
    const untouched = runtime.readOpaqueBlockState(id(2));
    runtime.applyExternalContentUpdate({
      blockGraphVersion: 1,
      blockId: id(1),
      blockType: "paragraph",
      update,
      readProjection: next,
      revision: 8,
    });
    expect(runtime.getLiveBlockContentCount()).toBe(0);
    expect(runtime.readBlockProjection(id(1), "paragraph")).toEqual(next);
    expect(runtime.readOpaqueBlockState(id(2))).toBe(untouched);
    expectCheckpointMatchesLiveDocument(runtime, id(1));
    const lease = runtime.acquireBlockContent(
      id(1),
      "paragraph",
      "active-editing",
    );
    expect(readYjsBlockContentPlainText(lease.context)).toBe("after");
    lease.release();
    runtime.destroy();
  });

  it("defers corrupt checkpoint failure to the owning block's acquisition", () => {
    const source = sourceFor({ [id(1)]: "A", [id(2)]: "B" });
    const corrupt = {
      ...source,
      opaqueContentCheckpoints: {
        ...source.opaqueContentCheckpoints,
        [id(1)]: {
          ...source.opaqueContentCheckpoints[id(1)]!,
          payloadBase64: "AQID",
        },
      },
    };
    const runtime = createYjsBlockContentRuntime(corrupt);
    expect(runtime.readBlockProjection(id(2), "paragraph")).toEqual(
      richText("B"),
    );
    expect(() =>
      runtime.acquireBlockContent(id(1), "paragraph", "active-editing"),
    ).toThrow(/Cannot hydrate/u);
    expect(runtime.getLiveBlockContentCount()).toBe(0);
    runtime.destroy();
  });

  it("notifies only the updated block projection and ignores duplicate revisions", () => {
    const source = sourceFor({ [id(1)]: "A", [id(2)]: "B" });
    const runtime = createYjsBlockContentRuntime(source);
    let a = 0;
    let b = 0;
    runtime.subscribeBlockProjection(id(1), () => a++);
    runtime.subscribeBlockProjection(id(2), () => b++);
    const next = richText("A2");
    const update = updateFromCheckpoint(
      id(1),
      source.opaqueContentCheckpoints[id(1)]!,
      next,
    );
    const accepted = {
      blockGraphVersion: 1,
      blockId: id(1),
      blockType: "paragraph" as const,
      update,
      readProjection: next,
      revision: 2,
    };
    runtime.applyExternalContentUpdate(accepted);
    runtime.applyExternalContentUpdate(accepted);
    expect({ a, b }).toEqual({ a: 1, b: 0 });
    runtime.destroy();
  });

  it("creates and resolves anchors only inside an explicitly owned context", () => {
    const runtime = createYjsBlockContentRuntime(sourceFor({ [id(1)]: "anchor" }));
    expect(
      runtime.tryResolveTextAnchorInLiveContext({
        blockId: id(1),
        blockType: "paragraph",
        codec: "yjs-relative-position",
        payload: { encoded: "AA==", assoc: 0 },
      }),
    ).toEqual({ ok: false, reason: "not-live" });
    expect(runtime.getLiveBlockContentCount()).toBe(0);

    const lease = runtime.acquireBlockContent(
      id(1),
      "paragraph",
      "active-editing",
    );
    const doc = lease.context.doc;
    const anchor = runtime.createTextAnchorInContext(lease, {
      textOffset: 3,
      affinity: "forward",
    });
    expect(anchor.ok).toBe(true);
    if (!anchor.ok) throw new Error("Expected anchor");
    expect(runtime.resolveTextAnchorInContext(lease, anchor)).toEqual({
      ok: true,
      textOffset: 3,
    });
    expect(runtime.getLiveBlockContentCount()).toBe(1);
    expect(lease.context.doc).toBe(doc);
    lease.release();
    expect(runtime.getLiveBlockContentCount()).toBe(0);
    runtime.destroy();
  });

  it("applies an active remote update to the existing Y.Doc", () => {
    const source = sourceFor({ [id(1)]: "before" });
    const runtime = createYjsBlockContentRuntime(source);
    const lease = runtime.acquireBlockContent(
      id(1),
      "paragraph",
      "active-editing",
    );
    const doc = lease.context.doc;
    const next = richText("after");
    runtime.applyExternalContentUpdate({
      blockGraphVersion: 1,
      blockId: id(1),
      blockType: "paragraph",
      update: updateFromCheckpoint(
        id(1),
        source.opaqueContentCheckpoints[id(1)]!,
        next,
      ),
      readProjection: next,
      revision: 1,
    });
    expect(lease.context.doc).toBe(doc);
    expect(readYjsBlockContentPlainText(lease.context)).toBe("after");
    expectCheckpointMatchesLiveDocument(runtime, id(1));
    lease.release();
    runtime.destroy();
  });

  it("keeps the incremental checkpoint state-equivalent after a local commit", () => {
    const source = sourceFor({ [id(1)]: "A" });
    const runtime = createYjsBlockContentRuntime(source);
    const baseToken = runtime.readContentBaseToken(id(1), "paragraph", 1);
    const validated = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken,
            operations: [insertOperation(id(1), 1, "B")],
          },
        ],
      }),
    );
    const applied = runtime.commitContent(validated);
    runtime.publishContentCommit(applied);

    const secondValidated = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken: runtime.readContentBaseToken(id(1), "paragraph", 1),
            operations: [insertOperation(id(1), 2, "C")],
          },
        ],
      }),
    );
    runtime.publishContentCommit(runtime.commitContent(secondValidated));

    expectCheckpointMatchesLiveDocument(runtime, id(1));
    const checkpoint = runtime.readOpaqueBlockState(id(1));
    if (!checkpoint) throw new Error("Expected maintained checkpoint");
    const projection = runtime.readBlockProjection(id(1), "paragraph");
    runtime.destroy();

    const reopened = createYjsBlockContentRuntime({
      ...source,
      contentById: { [id(1)]: projection },
      opaqueContentCheckpoints: { [id(1)]: checkpoint },
    });
    const lease = reopened.acquireBlockContent(
      id(1),
      "paragraph",
      "active-editing",
    );
    expect(readYjsBlockContentPlainText(lease.context)).toBe("ABC");
    lease.release();
    reopened.destroy();
  });

  it("merges every captured update for an introduced block into its checkpoint", () => {
    const source = sourceFor({ [id(1)]: "existing" });
    const runtime = createYjsBlockContentRuntime(source);
    const introducedId = id(2);
    const validated = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        introducedBlocks: { [introducedId]: "paragraph" },
        changes: [
          {
            baseToken: {
              graphRevision: 1,
              blockId: introducedId,
              blockType: "paragraph",
              contentRevision: 0,
            },
            operations: [insertOperation(introducedId, 0, "introduced")],
          },
        ],
      }),
    );
    const applied = runtime.commitContent(validated);
    runtime.publishContentCommit(applied);

    expect(runtime.readBlockProjection(introducedId, "paragraph")).toEqual(
      richText("introduced"),
    );
    expectCheckpointMatchesLiveDocument(runtime, introducedId);
    runtime.destroy();
  });
});

function sourceFor(content: Readonly<Record<BlockId, string>>) {
  const blockTypesById = {} as Record<BlockId, BlockType>;
  const contentById = {} as Record<BlockId, RichTextDocumentNodeJson>;
  const opaqueContentCheckpoints = {} as Record<
    BlockId,
    EditorOpaqueContentCheckpoint
  >;
  for (const [blockId, text] of Object.entries(content) as [BlockId, string][]) {
    blockTypesById[blockId] = "paragraph";
    contentById[blockId] = richText(text);
    opaqueContentCheckpoints[blockId] = opaque(
      createYjsBlockContentCheckpoint(blockId, contentById[blockId]),
    );
  }
  return {
    blockDefinitions: definitions,
    inlineMarks: [],
    inlineAtoms: [],
    blockGraphVersion: 1,
    blockTypesById,
    contentById,
    opaqueContentCheckpoints,
  };
}

function updateFromCheckpoint(
  blockId: BlockId,
  checkpoint: EditorOpaqueContentCheckpoint,
  content: RichTextDocumentNodeJson,
): EditorContentOperationUpdate {
  const doc = new Doc();
  applyUpdate(doc, decodeBase64(checkpoint.payloadBase64), "test-hydration");
  const context = createBlockContentDocContext({
    blockId,
    doc,
    destroyDocOnDestroy: true,
  });
  try {
    const vector = encodeStateVector(doc);
    writeCanonicalYjsBlockContent(context, content, "test-update");
    return Object.freeze({
      kind: "operation",
      format: checkpoint.format,
      version: checkpoint.version,
      payload: EditorImmutableBinary.copyOf(encodeStateAsUpdate(doc, vector)),
    });
  } finally {
    context.destroy();
  }
}

function opaque(
  checkpoint: ReturnType<typeof createYjsBlockContentCheckpoint>,
): EditorOpaqueContentCheckpoint {
  return Object.freeze({
    kind: "checkpoint",
    format: checkpoint.format,
    version: checkpoint.version,
    payloadBase64: Buffer.from(checkpoint.payload.copy()).toString("base64"),
  });
}

function decodeBase64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

function richText(text: string): RichTextDocumentNodeJson {
  return createBlockRichTextContentFromPlainText("paragraph", text);
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

function requireValidated(
  value: ReturnType<
    ReturnType<typeof createYjsBlockContentRuntime>["validateContentCommit"]
  >,
) {
  if (!("kind" in value)) throw new Error(value.message);
  return value;
}

function expectCheckpointMatchesLiveDocument(
  runtime: ReturnType<typeof createYjsBlockContentRuntime>,
  blockId: BlockId,
): void {
  const checkpoint = runtime.readOpaqueBlockState(blockId);
  if (!checkpoint) throw new Error("Expected maintained checkpoint");
  const checkpointDoc = new Doc();
  applyUpdate(
    checkpointDoc,
    decodeBase64(checkpoint.payloadBase64),
    "test-checkpoint",
  );
  const lease = runtime.acquireBlockContent(
    blockId,
    "paragraph",
    "active-editing",
  );
  expect(Array.from(encodeStateVector(checkpointDoc))).toEqual(
    Array.from(encodeStateVector(lease.context.doc)),
  );
  lease.release();
  checkpointDoc.destroy();
}
