import { asBlockId } from "@repo/editor-core/kernel";
import {
  createBlockRichTextContentFromPlainText,
  EditorImmutableBinary,
} from "@repo/editor-core/content/rich-text";
import { describe, expect, it } from "vitest";
import type { EditorTransportTransaction } from "../transport/transport-types.ts";
import {
  decodeFirstDraftMessage,
  encodeFirstDraftMessage,
} from "../transport/message-protocol.ts";
import {
  readDatabaseBinary,
  serializeFirstDraftTransactionForDatabase,
} from "./persisted-transaction.ts";

describe("First Draft database-only transaction serialization", () => {
  it("preserves Yjs bytes without changing the binary WebSocket contract", () => {
    const bytes = new Uint8Array([0, 1, 2, 127, 128, 254, 255]);
    const immutableBytes = EditorImmutableBinary.copyOf(bytes);
    const transaction: EditorTransportTransaction = {
      transactionId: "transaction-database-round-trip",
      historyAction: "undo",
      graph: null,
      metadata: null,
      content: [
        {
          blockId: asBlockId("block-a"),
          blockType: "paragraph",
          readProjection: createBlockRichTextContentFromPlainText(
            "paragraph",
            "x",
          ),
          update: {
            kind: "operation",
            format: "editor-yjs-rich-text",
            version: 2,
            payload: immutableBytes,
          },
        },
      ],
    };

    const stored = JSON.parse(
      serializeFirstDraftTransactionForDatabase(transaction),
    ) as {
      content: readonly [{ update: { payloadBase64: string } }];
    };
    expect(stored.content[0].update.payloadBase64).toBeTypeOf("string");
    expect(
      readDatabaseBinary(stored.content[0].update.payloadBase64)?.equalsBytes(
        bytes,
      ),
    ).toBe(true);
    expect(transaction.content[0]?.update.payload).toBe(immutableBytes);
  });

  it("keeps transport and persistence identical regardless of consumer order or mutation attempts", () => {
    const immutableBytes = EditorImmutableBinary.copyOf(
      new Uint8Array([0, 1, 2, 127, 128, 254, 255]),
    );
    const transaction: EditorTransportTransaction = {
      transactionId: "transaction-consumer-order",
      historyAction: "command",
      graph: null,
      metadata: null,
      content: [
        {
          blockId: asBlockId("block-a"),
          blockType: "paragraph",
          readProjection: createBlockRichTextContentFromPlainText(
            "paragraph",
            "x",
          ),
          update: {
            kind: "operation",
            format: "editor-yjs-rich-text",
            version: 2,
            payload: immutableBytes,
          },
        },
      ],
    };
    const message = {
      type: "proposed-editor-transaction" as const,
      transaction,
    };

    const transportBeforePersistence = new Uint8Array(
      encodeFirstDraftMessage(message),
    );
    const persistedAfterTransport =
      serializeFirstDraftTransactionForDatabase(transaction);
    Reflect.set(immutableBytes, "0", 255);
    const persistedBeforeTransport =
      serializeFirstDraftTransactionForDatabase(transaction);
    const transportAfterPersistence = new Uint8Array(
      encodeFirstDraftMessage(message),
    );

    expect(transportAfterPersistence).toEqual(transportBeforePersistence);
    expect(persistedBeforeTransport).toBe(persistedAfterTransport);
    const remote = decodeFirstDraftMessage(transportAfterPersistence.buffer);
    expect(remote.ok).toBe(true);
    if (!remote.ok) throw new Error(remote.error);
    const remoteBlock = remote.message.transaction.content[0]!;
    expect(remoteBlock.update.payload.equals(immutableBytes)).toBe(true);
    Reflect.set(remoteBlock.update.payload, "0", 255);
    expect(remoteBlock.update.payload.equals(immutableBytes)).toBe(true);
    expect("operations" in remoteBlock).toBe(false);
  });

  it("rejects non-canonical or malformed database text", () => {
    expect(readDatabaseBinary("not base64!")).toBeNull();
    expect(readDatabaseBinary("AA")).toBeNull();
  });

  it("canonicalizes JSON object key order for durable duplicate comparison", () => {
    const first: EditorTransportTransaction = {
      transactionId: "transaction-canonical",
      historyAction: "command",
      graph: null,
      metadata: {
        kind: "updateBlockMetadata",
        updates: [
          { blockId: asBlockId("block-a"), values: { alpha: 1, beta: 2 } },
        ],
      },
      content: [],
    };
    const reordered: EditorTransportTransaction = {
      ...first,
      metadata: {
        kind: "updateBlockMetadata",
        updates: [
          { blockId: asBlockId("block-a"), values: { beta: 2, alpha: 1 } },
        ],
      },
    };
    expect(serializeFirstDraftTransactionForDatabase(first)).toBe(
      serializeFirstDraftTransactionForDatabase(reordered),
    );
  });
});
