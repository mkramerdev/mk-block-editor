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
    lease.release();
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
