import type { EditorTransportTransaction } from "../transport/transport-types.ts";
import { EditorImmutableBinary } from "@repo/editor-core/content/rich-text";
import type { EditorTextBlockContent } from "@repo/editor-core/codecs";
import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  decodeFirstDraftMessage,
  encodeFirstDraftMessage,
} from "../transport/message-protocol.ts";

/**
 * Canonical database representation. Base64 exists only because the existing
 * editor_transactions column is text; it never enters the WebSocket contract.
 */
export function serializeFirstDraftTransactionForDatabase(
  transaction: EditorTransportTransaction,
): string {
  return stableJsonStringify({
    transactionId: transaction.transactionId,
    historyAction: transaction.historyAction,
    graph: transaction.graph,
    metadata: transaction.metadata,
    content: transaction.content.map((entry) => ({
      blockId: entry.blockId,
      blockType: entry.blockType,
      readProjection: entry.readProjection,
      update: {
        kind: entry.update.kind,
        format: entry.update.format,
        version: entry.update.version,
        payloadBase64: Buffer.from(entry.update.payload.copy()).toString(
          "base64",
        ),
      },
    })),
  });
}

function stableJsonStringify(value: unknown): string {
  return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => [key, sortJson(entry)]),
  );
}

export function readDatabaseBinary(
  value: string,
): EditorImmutableBinary | null {
  try {
    const bytes = Buffer.from(value, "base64");
    return bytes.toString("base64") === value
      ? EditorImmutableBinary.copyOf(
          new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
        )
      : null;
  } catch {
    return null;
  }
}

/** Decodes the canonical database transaction form through the protocol validator. */
export function deserializeFirstDraftTransactionFromDatabase(
  value: string,
): EditorTransportTransaction | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !isRecord(parsed) ||
      !hasExactKeys(parsed, [
        "transactionId",
        "historyAction",
        "graph",
        "metadata",
        "content",
      ]) ||
      !Array.isArray(parsed.content)
    )
      return null;
    const content: EditorTransportTransaction["content"] = parsed.content.map(
      (entry) => {
        if (
          !isRecord(entry) ||
          !hasExactKeys(entry, [
            "blockId",
            "blockType",
            "readProjection",
            "update",
          ]) ||
          !isRichTextProjection(entry.readProjection) ||
          typeof entry.blockId !== "string" ||
          typeof entry.blockType !== "string" ||
          !isRecord(entry.update) ||
          !hasExactKeys(entry.update, [
            "kind",
            "format",
            "version",
            "payloadBase64",
          ]) ||
          entry.update.kind !== "operation" ||
          typeof entry.update.format !== "string" ||
          !Number.isSafeInteger(entry.update.version) ||
          typeof entry.update.payloadBase64 !== "string"
        )
          throw new Error("Persisted transaction content is malformed");
        const payload = readDatabaseBinary(entry.update.payloadBase64);
        if (!payload?.byteLength)
          throw new Error("Persisted transaction binary is malformed");
        return {
          blockId: entry.blockId as BlockId,
          blockType: entry.blockType as BlockType,
          readProjection: entry.readProjection,
          update: {
            kind: entry.update.kind,
            format: entry.update.format,
            version: entry.update.version as number,
            payload,
          },
        };
      },
    );
    const candidate = {
      transactionId: parsed.transactionId,
      historyAction: parsed.historyAction,
      graph: parsed.graph,
      metadata: parsed.metadata,
      content,
    } as EditorTransportTransaction;
    const decoded = decodeFirstDraftMessage(
      encodeFirstDraftMessage({
        type: "proposed-editor-transaction",
        transaction: candidate,
      }),
    );
    return decoded.ok && decoded.message.type === "proposed-editor-transaction"
      ? decoded.message.transaction
      : null;
  } catch {
    return null;
  }
}

function isRichTextProjection(value: unknown): value is EditorTextBlockContent {
  return (
    isRecord(value) && value.type === "doc" && Array.isArray(value.content)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}
