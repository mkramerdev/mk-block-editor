import type {
  EditorInstanceSnapshot,
  EditorTextBlockContent,
} from "@repo/editor-core/codecs";
import {
  EditorImmutableBinary,
  type EditorContentCheckpoint,
} from "@repo/editor-core/content/rich-text";
import type { Block } from "@repo/editor-core/document";
import type {
  BlockId,
  EditorOpaqueContentCheckpoint,
} from "@repo/editor-core/kernel";
import { createBlockRecord } from "@repo/editor-core/metadata";
import {
  createBlockContentDocContext,
  Doc as YDoc,
  EDITOR_YJS_CONTENT_FORMAT,
  EDITOR_YJS_CONTENT_FORMAT_VERSION,
  encodeBlockContentUpdate,
  ensureCanonicalYjsBlockContent,
} from "@repo/editor-yjs";
import {
  createFirstDraftDocumentTemplate,
  createFirstDraftFixtureDocumentTemplate,
} from "./first-draft-document-template.ts";

/** Materializes the concise document used by database seeding and live reset. */
export function createFirstDraftDefaultSnapshot(): EditorInstanceSnapshot {
  return materializeFirstDraftSnapshot(createFirstDraftDocumentTemplate());
}

/** Materializes the broad deterministic snapshot used by integration tests. */
export function createFirstDraftSnapshot(): EditorInstanceSnapshot {
  return materializeFirstDraftSnapshot(createFirstDraftFixtureDocumentTemplate());
}

function materializeFirstDraftSnapshot(
  fragment: ReturnType<typeof createFirstDraftDocumentTemplate>,
): EditorInstanceSnapshot {
  const blocks = {} as Record<BlockId, Block>;
  const content = {} as Record<BlockId, EditorTextBlockContent>;
  const opaqueContentCheckpoints = {} as Record<
    BlockId,
    EditorOpaqueContentCheckpoint
  >;
  const childIdsByParentId = {} as Record<BlockId, BlockId[]>;

  for (const record of fragment.blocks) {
    blocks[record.id] = createBlockRecord({
      id: record.id,
      type: record.type,
      parentId: record.parentId,
      ...(record.metadata ? { metadata: record.metadata } : {}),
    });
    if (record.parentId !== null) {
      (childIdsByParentId[record.parentId] ??= []).push(record.id);
    }
    if (record.content !== undefined) {
      content[record.id] = record.content;
      opaqueContentCheckpoints[record.id] = toOpaqueCheckpoint(
        createDeterministicCheckpoint(record.id, record.content),
      );
    }
  }

  return {
    blockGraphVersion: 1,
    blocks,
    rootBlockIds: [...fragment.rootBlockIds],
    childIdsByParentId,
    content,
    opaqueContentCheckpoints,
  };
}

const FIRST_DRAFT_FIXTURE_HYDRATION_ORIGIN = Object.freeze({
  kind: "first-draft-fixture-hydration",
});

function createDeterministicCheckpoint(
  blockId: BlockId,
  content: EditorTextBlockContent,
): EditorContentCheckpoint {
  const doc = new YDoc();
  doc.clientID = deterministicYjsClientId(blockId);
  const context = createBlockContentDocContext({
    blockId,
    doc,
    destroyDocOnDestroy: true,
  });
  try {
    ensureCanonicalYjsBlockContent(
      context,
      content,
      FIRST_DRAFT_FIXTURE_HYDRATION_ORIGIN,
    );
    return Object.freeze({
      kind: "checkpoint",
      format: EDITOR_YJS_CONTENT_FORMAT,
      version: EDITOR_YJS_CONTENT_FORMAT_VERSION,
      payload: EditorImmutableBinary.takeOwnership(
        encodeBlockContentUpdate(context),
      ),
    });
  } finally {
    context.destroy();
  }
}

function deterministicYjsClientId(blockId: BlockId): number {
  let hash = 2_166_136_261;
  for (const character of blockId) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16_777_619) >>> 0;
  }
  return hash || 1;
}

function toOpaqueCheckpoint(
  checkpoint: EditorContentCheckpoint,
): EditorOpaqueContentCheckpoint {
  return Object.freeze({
    kind: "checkpoint",
    format: checkpoint.format,
    version: checkpoint.version,
    payloadBase64: encodeBase64(checkpoint.payload.copy()),
  });
}

const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function encodeBase64(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index]!;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const chunk =
      (first << 16) | ((second ?? 0) << 8) | (third === undefined ? 0 : third);
    result += BASE64_ALPHABET[(chunk >>> 18) & 63];
    result += BASE64_ALPHABET[(chunk >>> 12) & 63];
    result += second === undefined ? "=" : BASE64_ALPHABET[(chunk >>> 6) & 63];
    result += third === undefined ? "=" : BASE64_ALPHABET[chunk & 63];
  }
  return result;
}
