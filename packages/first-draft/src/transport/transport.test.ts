import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import {
  createBlockRichTextContentFromPlainText,
  richTextBlockInlineContent,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import {
  createCanonicalBlockFragment,
  createCanonicalBlockRecord,
  type StructuralEditRange,
} from "@repo/editor-core/editing";
import {
  executeStructuralEditComposition,
  resolveCanonicalEditComposition,
  type CanonicalEditCompositionGraph,
} from "@repo/editor-react/editor";
import type { EditorSemanticChange } from "@repo/editor-web/editor";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import { initializeTestEditableEditor as initializeEditableEditor } from "../test-editor.ts";
import { describe, expect, it, vi } from "vitest";
import { createFirstDraftEditorDefinition } from "../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../first-draft-fixture.ts";
import { createYjsBlockContentCheckpoint } from "@repo/editor-yjs-dom";
import { createFirstDraftBootstrapFromSnapshot } from "../bootstrap/bootstrap.ts";
import { createFirstDraftViewStateStore } from "../blocks/view-state.tsx";
import { planFirstDraftStructuralRangeDeletion } from "../block-operations/structural-range-deletion.ts";
import { convertEditorTransactionToTransport } from "./editor-transaction-to-transport.ts";
import {
  decodeFirstDraftMessage,
  encodeFirstDraftMessage,
  MAX_FIRST_DRAFT_FRAME_BYTES,
  type FirstDraftMessage,
} from "./message-protocol.ts";
import { attachFirstDraftRemoteTransactions } from "./remote-transaction-client.ts";
import {
  attachFirstDraftPresence,
  type FirstDraftPresenceEditor,
} from "./presence-client.ts";
import { createFirstDraftMessageDispatcher } from "./collaboration-connection.ts";
import {
  createFirstDraftOutboundPublisher,
  type FirstDraftOutboundPublisher,
  type FirstDraftOutboundSocket,
} from "./outbound-publisher.ts";
import { encodeFirstDraftWireFrame } from "./wire-frame.ts";

const textBlockId = asBlockId("fd-paragraph-intro");
const metadataBlockId = asBlockId("fd-check-unchecked");
const secondMetadataBlockId = asBlockId("fd-check-checked");

describe("First Draft transaction conversion", () => {
  it("preserves identity and the committed incremental payload without copying", () => {
    const { editor, changes } = createTestEditor();
    expect(
      editor.insertText({ blockId: textBlockId, offset: 0, text: "X" }),
    ).toBe(true);
    const change = changes[0];
    if (!change || change.kind !== "block-content")
      throw new Error("Expected content change");
    const inputBytes = change.yjsUpdate.payload.copy();

    const transport = convertEditorTransactionToTransport(change);

    expect(transport.transactionId).toBe(change.transactionId);
    expect("baseDocumentRevision" in transport).toBe(false);
    expect("documentRevision" in transport).toBe(false);
    expect(transport.historyAction).toBe("command");
    expect("baseRevision" in transport).toBe(false);
    expect("revision" in transport).toBe(false);
    expect(transport.content[0]!.update.payload.equalsBytes(inputBytes)).toBe(
      true,
    );
    expect("operations" in transport.content[0]!).toBe(false);
    expect(transport.content[0]!.update.payload).toBe(change.yjsUpdate.payload);
    expect(change.yjsUpdate.payload.equalsBytes(inputBytes)).toBe(true);
    editor.dispose();
  });

  it("preserves ordered multi-block metadata updates", () => {
    const { editor, changes } = createTestEditor();
    expect(
      editor.updateBlockMetadata([
        { blockId: metadataBlockId, values: { checked: true, owner: "Ada" } },
        { blockId: secondMetadataBlockId, values: { checked: false } },
      ]),
    ).toBe(true);
    const change = changes[0];
    if (!change || change.kind !== "block-metadata")
      throw new Error("Expected metadata change");

    const transport = convertEditorTransactionToTransport(change);
    expect(transport.metadata?.updates.map(({ blockId }) => blockId)).toEqual([
      metadataBlockId,
      secondMetadataBlockId,
    ]);
    expect(transport.metadata?.updates[0]?.values).toEqual({
      checked: true,
      owner: "Ada",
    });
    expect(transport.graph).toBeNull();
    editor.dispose();
  });

  it("serializes an open-boundary join without donor content or a new wire shape", () => {
    const { editor, changes } = createTestEditor();
    const startId = asBlockId("fd-paragraph-intro");
    const donorId = asBlockId("fd-paragraph-byline");
    const start = editor.getBlock(startId)!;
    const donor = editor.getBlock(donorId)!;
    const intervening = editor.getBlock(asBlockId("fd-code"))!;
    const startText = editor.readBlockPlainText(start.id, start.type)!;
    const donorText = editor.readBlockPlainText(donor.id, donor.type)!;
    const range: StructuralEditRange = {
      graphRevision: editor.getSelectionGraphRevision(),
      selectionRevision: 1,
      blocks: [
        {
          kind: "text",
          blockId: start.id,
          blockType: start.type,
          parentId: start.parentId,
          from: 2,
          to: startText.length,
          expectedContentVersion: start.contentVersion,
        },
        {
          kind: "block",
          blockId: intervening.id,
          blockType: intervening.type,
          parentId: intervening.parentId,
        },
        {
          kind: "text",
          blockId: donor.id,
          blockType: donor.type,
          parentId: donor.parentId,
          from: 0,
          to: 2,
          expectedContentVersion: donor.contentVersion,
        },
      ],
      start: { kind: "text", blockId: start.id, offset: 2 },
      end: { kind: "text", blockId: donor.id, offset: 2 },
    };

    expect(
      editor.executeStructuralRangeDeletion(range, {
        intent: "cut",
        provenance: null,
      }),
    ).toMatchObject({ ok: true });
    expect(changes).toHaveLength(1);
    const change = changes[0];
    if (!change || change.kind !== "block-graph") {
      throw new Error("Expected one block-graph change");
    }
    const transport = convertEditorTransactionToTransport(change);
    expect(transport.graph?.changes).toContainEqual({
      kind: "delete",
      blockId: donor.id,
    });
    expect(transport.content.map(({ blockId }) => blockId)).toEqual([start.id]);
    const decoded = decodeFirstDraftMessage(
      encodeFirstDraftMessage({
        type: "proposed-editor-transaction",
        transaction: transport,
      }),
    );
    expect(decoded).toMatchObject({
      ok: true,
      message: {
        type: "proposed-editor-transaction",
        transaction: {
          graph: transport.graph,
        },
      },
    });
    expect(editor.getBlock(donor.id)).toBeNull();
    expect(editor.readBlockPlainText(start.id, start.type)).toBe(
      startText.slice(0, 2) + donorText.slice(2),
    );
    editor.dispose();
  });

  it("consumes an ordered-list boundary item while retaining contiguous definition-owned numbering", () => {
    const { editor, changes } = createTestEditor();
    const start = editor.getBlock(asBlockId("fd-heading-3"))!;
    const middle = editor.getBlock(asBlockId("fd-paragraph-before-rollout"))!;
    const list = editor.getBlock(asBlockId("fd-ordered-list"))!;
    const item1 = editor.getBlock(asBlockId("fd-ordered-1"))!;
    const donor = editor.getBlock(asBlockId("fd-ordered-1-text"))!;
    const item2 = editor.getBlock(asBlockId("fd-ordered-2"))!;
    const item3 = editor.getBlock(asBlockId("fd-ordered-3"))!;
    const startText = editor.readBlockPlainText(start.id, start.type)!;
    const donorText = editor.readBlockPlainText(donor.id, donor.type)!;
    const startMetadata = start.metadata;
    const range: StructuralEditRange = {
      graphRevision: editor.getSelectionGraphRevision(),
      selectionRevision: 1,
      blocks: [
        {
          kind: "text",
          blockId: start.id,
          blockType: start.type,
          parentId: start.parentId,
          from: 3,
          to: startText.length,
          expectedContentVersion: start.contentVersion,
        },
        {
          kind: "block",
          blockId: middle.id,
          blockType: middle.type,
          parentId: middle.parentId,
        },
        {
          kind: "text",
          blockId: donor.id,
          blockType: donor.type,
          parentId: donor.parentId,
          from: 0,
          to: 3,
          expectedContentVersion: donor.contentVersion,
        },
      ],
      start: { kind: "text", blockId: start.id, offset: 3 },
      end: { kind: "text", blockId: donor.id, offset: 3 },
    };

    const plan = planFirstDraftStructuralRangeDeletion({
      intent: "cut",
      range,
      graph: editor,
      readBlockContent: (blockId, blockType) =>
        editor.readBlockContent(blockId, blockType),
    });
    if (!plan) throw new Error("Expected First Draft list-boundary plan");
    const rangeResult = editor.executeStructuralTransaction(plan, { provenance: null });
    if (!rangeResult.ok) throw new Error(JSON.stringify(rangeResult));
    expect(rangeResult).toMatchObject({ ok: true });
    expect(editor.getBlock(start.id)).toMatchObject({
      id: start.id,
      type: "heading",
      metadata: startMetadata,
    });
    expect(editor.readBlockPlainText(start.id, start.type)).toBe(
      startText.slice(0, 3) + donorText.slice(3),
    );
    expect(editor.getBlock(item1.id)).toBeNull();
    expect(editor.getBlock(donor.id)).toBeNull();
    expect(editor.getChildBlockIds(list.id)).toEqual([item2.id, item3.id]);
    expect(
      editor
        .getChildBlockIds(list.id)
        .map((itemId) => editor.getBlock(itemId)?.metadata?.ordinal),
    ).toEqual([undefined, undefined]);
    expect(changes).toHaveLength(1);
    const change = changes[0];
    if (!change || change.kind !== "block-graph") {
      throw new Error("Expected one ordered-list graph change");
    }
    const transport = convertEditorTransactionToTransport(change);
    expect(transport.content.map(({ blockId }) => blockId)).toEqual([start.id]);
    editor.dispose();
  });

  it("preserves and round-trips the ordered graph for one multi-block transaction", () => {
    const { editor, changes } = createTestEditor();
    const operations = addEditorBlockOperations(editor);
    let sequence = 0;
    const inserted = operations.insertBlock({
      blockId: textBlockId,
      blockType: "columns",
      createBlockId: () => asBlockId(`multi-block-${++sequence}`),
    });
    expect(inserted.ok).toBe(true);
    const change = changes[0];
    if (!change || change.kind !== "block-graph") {
      throw new Error("Expected multi-block graph change");
    }
    const before = JSON.stringify(change);
    const transaction = convertEditorTransactionToTransport(change);
    expect(transaction.graph?.changes.length).toBeGreaterThan(1);
    const decoded = decodeFirstDraftMessage(
      encodeFirstDraftMessage({
        type: "proposed-editor-transaction",
        transaction,
      }),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok || decoded.message.type !== "proposed-editor-transaction") {
      throw new Error("Expected proposed transaction");
    }
    expect(decoded.message.transaction.graph).toEqual(transaction.graph);
    expect(JSON.stringify(change)).toBe(before);
    editor.dispose();
  });

  it("does not invent a move for an Enter block when a later open fragment joins into it", () => {
    const { editor, changes } = createTestEditor();
    const rootsBeforeEnter = editor.getRootBlockIds();
    const insertedContent = createBlockRichTextContentFromPlainText(
      "paragraph",
      "",
    );
    const inserted = createCanonicalBlockRecord({
      type: "paragraph",
      parentId: null,
      content: insertedContent,
      plainText: "",
    });
    const insertedFragment = createCanonicalBlockFragment({
      blocks: [inserted],
      rootBlockIds: [inserted.id],
      start: { kind: "text", blockId: inserted.id },
      end: { kind: "text", blockId: inserted.id },
      blockDefinitions: editor.definition.blocks,
    });
    expect(
      editor.transaction(() => {
        editor.insertBlocks(
          { parentId: null, childIndex: rootsBeforeEnter.length },
          insertedFragment,
        );
        editor.setTransactionSelection({
          kind: "text",
          blockId: inserted.id,
          offset: 0,
        });
      }),
    ).toMatchObject({ ok: true, changed: true });
    const enterBlockId = editor
      .getRootBlockIds()
      .find((blockId) => !rootsBeforeEnter.includes(blockId));
    expect(enterBlockId).toBeTruthy();
    const enterBlock = editor.getBlock(enterBlockId!);
    expect(enterBlock).toBeTruthy();

    const firstContent = createBlockRichTextContentFromPlainText(
      "paragraph",
      "first",
    );
    const first = createCanonicalBlockRecord({
      type: "paragraph",
      parentId: null,
      content: firstContent,
      plainText: "first",
    });
    const secondContent = createBlockRichTextContentFromPlainText(
      "paragraph",
      "second",
    );
    const second = createCanonicalBlockRecord({
      type: "paragraph",
      parentId: null,
      content: secondContent,
      plainText: "second",
    });
    const fragment = createCanonicalBlockFragment({
      blocks: [first, second],
      rootBlockIds: [first.id, second.id],
      start: { kind: "text", blockId: first.id },
      end: { kind: "text", blockId: second.id },
      blockDefinitions: createDefinition().blocks,
    });
    const compositionGraph: CanonicalEditCompositionGraph = {
      blockDefinitions: editor.definition.blocks,
      getBlock: (blockId) => editor.getBlock(blockId),
      getRootBlockIds: () => editor.getRootBlockIds(),
      getChildBlockIds: (blockId) => editor.getChildBlockIds(blockId),
      readBlockContent: (blockId, blockType) =>
        editor.readBlockContent(blockId, blockType),
    };
    const composition = resolveCanonicalEditComposition({
      graph: compositionGraph,
      target: {
        kind: "caret",
        blockId: enterBlockId!,
        offset: 0,
        graphRevision: editor.getSelectionGraphRevision(),
        expectedContentVersion: enterBlock!.contentVersion,
      },
      fragment,
    });
    expect(composition).toBeTruthy();
    expect(
      executeStructuralEditComposition(editor, composition!, {
        provenance: null,
      }),
    ).toMatchObject({ ok: true, changed: true });

    expect(changes).toHaveLength(2);
    const paste = changes[1];
    if (!paste || paste.kind !== "block-graph") {
      throw new Error("Expected paste graph change");
    }
    const transport = convertEditorTransactionToTransport(paste);
    expect(transport.graph?.changes).not.toContainEqual(
      expect.objectContaining({ kind: "move", blockId: enterBlockId }),
    );
    expect(transport.graph?.changes).toEqual([
      expect.objectContaining({ kind: "create", blockId: second.id }),
    ]);
    expect(transport.content.map((content) => content.blockId)).toEqual(
      expect.arrayContaining([enterBlockId, second.id]),
    );
    expect(transport.content).toHaveLength(2);
    editor.dispose();
  });
});

describe("First Draft binary message protocol", () => {
  it("round-trips every non-transaction protocol variant without a container identity", () => {
    const collaborationSubject = {
      actorId: "actor-a",
      clientId: "client-a",
      sessionId: "session-a",
    };
    const participant = {
      subject: collaborationSubject,
      presenceRevision: 3,
      active: true,
      metadata: { displayName: "Ada", color: "#123abc" },
    };
    const remoteSelection = {
      subject: collaborationSubject,
      selectionRevision: 5,
      selection: { kind: "none" as const },
    };
    const messages = [
      {
        type: "connect-first-draft-session" as const,
        ...collaborationSubject,
        documentId: "document-a",
      },
      {
        type: "first-draft-session-connected" as const,
        ...collaborationSubject,
        documentId: "document-a",
      },
      {
        type: "subscribe-first-draft-document" as const,
        documentId: "document-a",
      },
      {
        type: "subscribe-first-draft-document" as const,
        documentId: "document-a",
        knownRevision: 0,
      },
      {
        type: "subscribe-first-draft-document" as const,
        documentId: "document-a",
        knownRevision: 17,
      },
      {
        type: "first-draft-document-caught-up" as const,
        documentId: "document-a",
        requestedRevision: 3,
        revision: 3,
      },
      {
        type: "unsubscribe-first-draft-document" as const,
        documentId: "document-a",
      },
      {
        type: "first-draft-document-unsubscribed" as const,
        documentId: "document-a",
      },
      {
        type: "first-draft-participant-update" as const,
        documentId: "document-a",
        ...participant,
      },
      {
        type: "first-draft-participant-snapshot" as const,
        documentId: "document-a",
        participants: [participant],
      },
      {
        type: "first-draft-selection-update" as const,
        documentId: "document-a",
        ...remoteSelection,
      },
      {
        type: "first-draft-selection-snapshot" as const,
        documentId: "document-a",
        selections: [remoteSelection],
      },
      {
        type: "first-draft-protocol-error" as const,
        code: "test-error",
        message: "test diagnostic",
        fatal: false,
      },
    ];

    for (const message of messages) {
      expect(decodeFirstDraftMessage(encodeFirstDraftMessage(message))).toEqual(
        {
          ok: true,
          message,
        },
      );
    }
  });

  it("strictly validates revision-aware subscriptions", () => {
    for (const knownRevision of [
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      null,
      "3",
    ]) {
      const decoded = decodeFirstDraftMessage(
        encodeFirstDraftWireFrame({
          type: "subscribe-first-draft-document",
          documentId: "document-a",
          knownRevision,
        }),
      );
      expect(decoded).toEqual({
        ok: false,
        error: "First Draft document subscription is malformed",
      });
    }
    expect(
      decodeFirstDraftMessage(
        encodeFirstDraftWireFrame({
          type: "subscribe-first-draft-document",
          documentId: "document-a",
          knownRevision: 3,
          unexpected: true,
        }),
      ),
    ).toEqual({
      ok: false,
      error: "First Draft document subscription is malformed",
    });
  });

  it("round-trips an explicit authoritative resynchronization", () => {
    const bootstrap = createFirstDraftBootstrapFromSnapshot({
      documentId: "document-a",
      revision: 11,
      snapshot: createFirstDraftSnapshot(),
    });
    const message = {
      type: "first-draft-document-resynchronized" as const,
      documentId: "document-a",
      requestedRevision: 4,
      revision: 11,
      reason: "revision-unavailable" as const,
      bootstrap,
    };
    expect(decodeFirstDraftMessage(encodeFirstDraftMessage(message))).toEqual({
      ok: true,
      message,
    });
  });

  it("delivers blocks, projections, checkpoints, and revision in one initial message", () => {
    const bootstrap = createFirstDraftBootstrapFromSnapshot({
      documentId: "document-a",
      revision: 3,
      snapshot: createFirstDraftSnapshot(),
    });
    const decoded = decodeFirstDraftMessage(
      encodeFirstDraftMessage({
        type: "first-draft-document-loaded",
        documentId: "document-a",
        revision: 3,
        bootstrap,
      }),
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok || decoded.message.type !== "first-draft-document-loaded") {
      throw new Error("Expected the complete initial document message");
    }
    expect(
      decoded.message.bootstrap.snapshot.rootBlockIds.length,
    ).toBeGreaterThan(0);
    expect(
      Object.keys(decoded.message.bootstrap.snapshot.content).length,
    ).toBeGreaterThan(0);
    expect(
      Object.keys(decoded.message.bootstrap.snapshot.opaqueContentCheckpoints)
        .length,
    ).toBeGreaterThan(0);
    expect(decoded.message.revision).toBe(3);
  });

  it("round-trips an anonymous connection with no credential field", () => {
    const connection = {
      type: "connect-first-draft-session" as const,
      actorId: "actor-a",
      clientId: "client-a",
      sessionId: "session-a",
      documentId: "document-a",
    };
    const frame = encodeFirstDraftMessage(connection);
    expect(decodeFirstDraftMessage(frame)).toEqual({
      ok: true,
      message: connection,
    });
    expect(Object.keys(connection)).toEqual([
      "type",
      "actorId",
      "clientId",
      "sessionId",
      "documentId",
    ]);

    const removedCredential = ["authentication", "Token"].join("");
    expect(
      decodeFirstDraftMessage(
        addMetadataPropertyAtRoot(frame, removedCredential, "removed-token"),
      ).ok,
    ).toBe(false);
  });

  it("strictly rejects the removed container field", () => {
    const frame = encodeFirstDraftMessage({
      type: "connect-first-draft-session",
      actorId: "actor-a",
      clientId: "client-a",
      sessionId: "session-a",
      documentId: "document-a",
    });
    const removedField = ["workspace", "Id"].join("");
    expect(
      decodeFirstDraftMessage(
        addMetadataPropertyAtRoot(frame, removedField, "removed-container"),
      ).ok,
    ).toBe(false);
  });

  it("round-trips server acceptance and persistence failure messages", () => {
    const accepted = {
      type: "editor-transaction-accepted" as const,
      documentId: "document-a",
      transactionId: "transaction-a",
      baseRevision: 7,
      revision: 8,
      acceptedAt: 1_700_000_000_000,
    };
    const failed = {
      type: "editor-transaction-persistence-failed" as const,
      documentId: "document-a",
      transactionId: "transaction-b",
      reason: "invalid" as const,
      retryable: false,
      message: "Canonical validation failed",
    };

    expect(decodeFirstDraftMessage(encodeFirstDraftMessage(accepted))).toEqual({
      ok: true,
      message: accepted,
    });
    expect(decodeFirstDraftMessage(encodeFirstDraftMessage(failed))).toEqual({
      ok: true,
      message: failed,
    });
    expect(
      decodeFirstDraftMessage(
        encodeFirstDraftMessage({ ...accepted, revision: 9 }),
      ).ok,
    ).toBe(false);
    expect(
      decodeFirstDraftMessage(
        encodeFirstDraftMessage({
          ...failed,
          reason: "sql-error" as "invalid",
        }),
      ).ok,
    ).toBe(false);
  });

  it("round-trips the complete transaction and preserves Yjs bytes", () => {
    const { editor, changes } = createTestEditor();
    expect(
      editor.insertText({ blockId: textBlockId, offset: 1, text: "binary" }),
    ).toBe(true);
    const change = changes[0]!;
    const transaction = convertEditorTransactionToTransport(change);
    const frame = encodeFirstDraftMessage({
      type: "proposed-editor-transaction",
      transaction,
    });

    expect(frame).toBeInstanceOf(ArrayBuffer);
    const decoded = decodeFirstDraftMessage(frame);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error(decoded.error);
    const decodedTransaction = requireProposedMessage(
      decoded.message,
    ).transaction;
    expect(decodedTransaction).toEqual(transaction);
    expect(
      decodedTransaction.content[0]!.update.payload.equals(
        transaction.content[0]!.update.payload,
      ),
    ).toBe(true);
    Reflect.set(decodedTransaction.content[0]!.update.payload, "0", 255);
    expect(
      decodedTransaction.content[0]!.update.payload.equals(
        transaction.content[0]!.update.payload,
      ),
    ).toBe(true);
    editor.dispose();
  });

  it("rejects unrelated variants and invalid operation data", () => {
    const { editor, changes } = createTestEditor();
    expect(
      editor.insertText({ blockId: textBlockId, offset: 0, text: "X" }),
    ).toBe(true);
    const frame = encodeFirstDraftMessage({
      type: "proposed-editor-transaction",
      transaction: convertEditorTransactionToTransport(changes[0]!),
    });

    expect(
      decodeFirstDraftMessage(replaceAscii(frame, "proposed", "rejected")),
    ).toMatchObject({
      ok: false,
    });
    expect(
      decodeFirstDraftMessage(replaceAscii(frame, "operation", "operatiox")),
    ).toMatchObject({
      ok: false,
    });
    editor.dispose();
  });

  it("rejects bad magic, bad version, malformed metadata, and oversized frames", () => {
    const frame = createContentFrame();
    const badMagic = frame.slice(0);
    const badMagicBytes = new Uint8Array(badMagic);
    badMagicBytes[0] = badMagicBytes[0]! ^ 0xff;
    const badVersion = frame.slice(0);
    const badVersionBytes = new Uint8Array(badVersion);
    badVersionBytes[3] = 4;

    expect(decodeFirstDraftMessage(badMagic).ok).toBe(false);
    expect(decodeFirstDraftMessage(badVersion).ok).toBe(false);
    expect(
      decodeFirstDraftMessage(
        replaceAscii(frame, "historyAction", "historyActiom"),
      ).ok,
    ).toBe(false);
    expect(
      decodeFirstDraftMessage(new Uint8Array(MAX_FIRST_DRAFT_FRAME_BYTES + 1))
        .ok,
    ).toBe(false);
  });

  it("rejects truncated and mismatched binary segments", () => {
    const frame = createContentFrame();
    expect(decodeFirstDraftMessage(frame.slice(0, -1)).ok).toBe(false);

    const { editor, changes } = createTestEditor();
    expect(
      editor.updateBlockMetadata([
        { blockId: metadataBlockId, values: { checked: true } },
      ]),
    ).toBe(true);
    const metadataFrame = encodeFirstDraftMessage({
      type: "proposed-editor-transaction",
      transaction: convertEditorTransactionToTransport(changes[0]!),
    });
    const mismatched = new Uint8Array(metadataFrame.byteLength + 5);
    mismatched.set(new Uint8Array(metadataFrame));
    new DataView(mismatched.buffer).setUint32(metadataFrame.byteLength, 1);
    mismatched[mismatched.byteLength - 1] = 0xaa;
    expect(decodeFirstDraftMessage(mismatched).ok).toBe(false);
    editor.dispose();
  });

  it("rejects every server or removed client revision field in proposed messages", () => {
    const { editor, changes } = createTestEditor();
    expect(
      editor.updateBlockMetadata([
        { blockId: metadataBlockId, values: { checked: true } },
      ]),
    ).toBe(true);
    const frame = encodeFirstDraftMessage({
      type: "proposed-editor-transaction",
      transaction: convertEditorTransactionToTransport(changes[0]!),
    });
    for (const field of [
      "baseRevision",
      "revision",
      "baseDocumentRevision",
      "documentRevision",
      "currentAcceptedRevision",
      "acceptedFrontier",
    ]) {
      expect(
        decodeFirstDraftMessage(addMetadataProperty(frame, field, 42)).ok,
      ).toBe(false);
    }
    editor.dispose();
  });
});

describe("First Draft outbound publisher", () => {
  it.each([0, 2, 3, 99])(
    "retains the sealed edit while socket state %s is unusable",
    (readyState) => {
      const socket = { readyState, send: vi.fn() };
      const errors = vi.fn();
      const publisher = createFirstDraftOutboundPublisher();
      publisher.attachGeneration({
        generationId: `socket-state-${readyState}`,
        socket,
        createTransactionId: sequentialIds("aggregate"),
        publishSelection: vi.fn(),
        onError: errors,
      });
      publisher.generationCaughtUp();
      const { editor, changes } = createTestEditor();
      expect(
        editor.insertText({ blockId: textBlockId, offset: 0, text: "X" }),
      ).toBe(true);
      publisher.submitFinalized(changes[0]!);
      publisher.flush("manual");
      expect(errors).not.toHaveBeenCalled();
      expect(socket.send).not.toHaveBeenCalled();
      expect(publisher.getSnapshot().outstanding).toHaveLength(1);
      expect(publisher.getSnapshot().outstanding[0]?.state).toBe("sealed");
      publisher.dispose();
      editor.dispose();
    },
  );

  it("retains an edit when its socket generation is marked unusable", () => {
    const socket = { readyState: 1, send: vi.fn() };
    const { editor, changes } = createTestEditor();
    expect(
      editor.insertText({ blockId: textBlockId, offset: 0, text: "X" }),
    ).toBe(true);
    const errors = vi.fn();
    const publisher = createFirstDraftOutboundPublisher();
    publisher.attachGeneration({
      generationId: "socket-error",
      socket,
      createTransactionId: sequentialIds("aggregate"),
      publishSelection: vi.fn(),
      onError: errors,
    });
    publisher.generationCaughtUp();
    publisher.markGenerationUnusable();
    publisher.submitFinalized(changes[0]!);
    publisher.flush("manual");
    expect(errors).not.toHaveBeenCalled();
    expect(socket.send).not.toHaveBeenCalled();
    expect(publisher.getSnapshot().outstanding).toHaveLength(1);
    editor.dispose();
  });

  it("sends undo and redo as new ordinary proposed transactions", async () => {
    const frames: ArrayBuffer[] = [];
    const publisher = createFirstDraftOutboundPublisher();
    publisher.attachGeneration({
      generationId: "undo-redo",
      socket: {
        readyState: 1,
        send: (frame: ArrayBuffer) => frames.push(frame),
      },
      createTransactionId: sequentialIds("aggregate"),
      publishSelection: vi.fn(),
    });
    publisher.generationCaughtUp();
    const editor = initializeEditableEditor({
      definition: createDefinition(),
      snapshot: createFirstDraftSnapshot(),
      onChange: (change) => publisher.submitFinalized(change),
      createTransactionId: sequentialIds("history"),
    });
    expect(
      editor.updateBlockMetadata([
        { blockId: metadataBlockId, values: { checked: true } },
      ]),
    ).toBe(true);
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.redo()).toEqual({ status: "applied" });
    publisher.flush("manual");
    acceptSentTransportRecords(publisher);
    await vi.waitFor(() => expect(frames).toHaveLength(3));

    const messages = frames.map((frame) => {
      const decoded = decodeFirstDraftMessage(frame);
      if (!decoded.ok) throw new Error(decoded.error);
      return requireProposedMessage(decoded.message).transaction;
    });
    expect(messages.map(({ historyAction }) => historyAction)).toEqual([
      "command",
      "undo",
      "redo",
    ]);
    expect(
      new Set(messages.map(({ transactionId }) => transactionId)).size,
    ).toBe(3);
    expect(messages[0]!.metadata?.updates[0]?.values.checked).toBe(true);
    publisher.dispose();
    editor.dispose();
  });

  it.each([
    {
      name: "before the original insertion",
      peerOffset: 2,
      received: "abQcXYZdef",
      undone: "abQcdef",
      redone: "abQcXYZdef",
    },
    {
      name: "at the inverse range start",
      peerOffset: 3,
      received: "abcQXYZdef",
      undone: "abcQdef",
      redone: "abcQXYZdef",
    },
    {
      name: "at the inverse range end",
      peerOffset: 6,
      received: "abcXYZQdef",
      undone: "abcQdef",
      redone: "abcXYZQdef",
    },
  ])(
    "refreshes Yjs replay plans after a causally received peer insertion $name",
    ({ peerOffset, received, undone, redone }) => {
      const snapshot = snapshotWithText(textBlockId, "abcdef");
      const source = createCollaborativeTestEditor(snapshot, "source");
      const peer = createCollaborativeTestEditor(snapshot, "peer");
      expect(
        source.editor.insertText({
          blockId: textBlockId,
          offset: 3,
          text: "XYZ",
        }),
      ).toBe(true);
      applyPeerChange(peer.editor, source.changes[0]!);
      expect(
        peer.editor.insertText({
          blockId: textBlockId,
          offset: peerOffset,
          text: "Q",
        }),
      ).toBe(true);
      applyPeerChange(source.editor, peer.changes[0]!);
      expect(source.editor.readBlockPlainText(textBlockId, "paragraph")).toBe(
        received,
      );

      for (let cycle = 0; cycle < 3; cycle += 1) {
        expect(source.editor.undo()).toEqual({ status: "applied" });
        expect(source.editor.readBlockPlainText(textBlockId, "paragraph")).toBe(
          undone,
        );
        expect(source.editor.redo()).toEqual({ status: "applied" });
        expect(source.editor.readBlockPlainText(textBlockId, "paragraph")).toBe(
          redone,
        );
      }
      source.editor.dispose();
      peer.editor.dispose();
    },
  );

  it("deletes only recreated content after undoing a deletion across a causally received gap insertion", () => {
    const snapshot = snapshotWithText(textBlockId, "abcXYZdef");
    const source = createCollaborativeTestEditor(snapshot, "delete-source");
    const peer = createCollaborativeTestEditor(snapshot, "delete-peer");
    expect(
      source.editor.deleteText({
        blockId: textBlockId,
        range: { from: 3, to: 6 },
      }),
    ).toBe(true);
    applyPeerChange(peer.editor, source.changes[0]!);
    expect(
      peer.editor.insertText({ blockId: textBlockId, offset: 3, text: "Q" }),
    ).toBe(true);
    applyPeerChange(source.editor, peer.changes[0]!);
    expect(source.editor.readBlockPlainText(textBlockId, "paragraph")).toBe(
      "abcQdef",
    );
    expect(source.editor.undo()).toEqual({ status: "applied" });
    expect(source.editor.readBlockPlainText(textBlockId, "paragraph")).toBe(
      "abcXYZQdef",
    );
    expect(source.editor.redo()).toEqual({ status: "applied" });
    expect(source.editor.readBlockPlainText(textBlockId, "paragraph")).toBe(
      "abcQdef",
    );
    source.editor.dispose();
    peer.editor.dispose();
  });

  it("rejects a stale anchored undo without deleting duplicate Yjs content", () => {
    const snapshot = snapshotWithText(textBlockId, "XYZabcdef");
    const source = createCollaborativeTestEditor(snapshot, "duplicate-source");
    const peer = createCollaborativeTestEditor(snapshot, "duplicate-peer");
    expect(
      source.editor.insertText({
        blockId: textBlockId,
        offset: 3,
        text: "XYZ",
      }),
    ).toBe(true);
    applyPeerChange(peer.editor, source.changes[0]!);
    expect(
      peer.editor.insertText({ blockId: textBlockId, offset: 4, text: "Q" }),
    ).toBe(true);
    applyPeerChange(source.editor, peer.changes[0]!);
    expect(source.editor.readBlockPlainText(textBlockId, "paragraph")).toBe(
      "XYZXQYZabcdef",
    );
    const history = source.editor as unknown as {
      readonly history: readonly { readonly state: string }[];
      readonly historyIndex: number;
    };

    expect(source.editor.undo()).toMatchObject({
      status: "operation-application-failed",
    });
    expect(source.editor.readBlockPlainText(textBlockId, "paragraph")).toBe(
      "XYZXQYZabcdef",
    );
    expect(history.historyIndex).toBe(1);
    expect(history.history[0]?.state).toBe("applied");
    expect(source.editor.canUndo).toBe(true);
    expect(source.editor.canRedo).toBe(false);
    source.editor.dispose();
    peer.editor.dispose();
  });

  it("does not relocate a genuine replaceInlineRange undo to duplicate Yjs content", () => {
    const snapshot = snapshotWithText(textBlockId, "XYabcdef");
    const source = createCollaborativeTestEditor(
      snapshot,
      "replace-duplicate-source",
    );
    const peer = createCollaborativeTestEditor(
      snapshot,
      "replace-duplicate-peer",
    );
    const replaced = source.editor.acceptContentOperationProposal(
      {
        base: {
          graphRevision: source.editor.getSelectionGraphRevision(),
          blockId: textBlockId,
          blockType: "paragraph",
          contentRevision: 0,
        },
        operations: [
          {
            kind: "replaceInlineRange",
            blockId: textBlockId,
            blockType: "paragraph",
            target: { kind: "text" },
            range: {
              from: { blockId: textBlockId, offset: 4 },
              to: { blockId: textBlockId, offset: 6 },
            },
            content: [{ type: "text", text: "XY" }],
            deletedContent: [{ type: "text", text: "cd" }],
          },
        ],
        selectionAfter: null,
      },
      {
        origin: "prosemirror-proposal",
        selectionPresentation: "canonical-only",
        provenance: null,
      },
    );
    expect(replaced.ok).toBe(true);
    applyPeerChange(peer.editor, source.changes[0]!);
    expect(
      peer.editor.insertText({ blockId: textBlockId, offset: 5, text: "Q" }),
    ).toBe(true);
    applyPeerChange(source.editor, peer.changes[0]!);
    expect(source.editor.readBlockPlainText(textBlockId, "paragraph")).toBe(
      "XYabXQYef",
    );

    expect(source.editor.undo()).toMatchObject({
      status: "operation-application-failed",
    });
    expect(source.editor.readBlockPlainText(textBlockId, "paragraph")).toBe(
      "XYabXQYef",
    );
    source.editor.dispose();
    peer.editor.dispose();
  });

  it("documents the delayed causal-delivery limitation after Yjs redo creates new identities", () => {
    const snapshot = snapshotWithText(textBlockId, "abcdef");
    const source = createCollaborativeTestEditor(snapshot, "delay-source");
    const peer = createCollaborativeTestEditor(snapshot, "delay-peer");
    expect(
      source.editor.insertText({
        blockId: textBlockId,
        offset: 3,
        text: "XYZ",
      }),
    ).toBe(true);
    const original = source.changes[0]!;
    applyPeerChange(peer.editor, original);
    expect(
      peer.editor.insertText({ blockId: textBlockId, offset: 6, text: "Q" }),
    ).toBe(true);

    expect(source.editor.undo()).toEqual({ status: "applied" });
    expect(source.editor.redo()).toEqual({ status: "applied" });
    const recreated = source.changes[2]!;
    if (
      original.kind !== "block-content" ||
      recreated.kind !== "block-content"
    ) {
      throw new Error("Expected Yjs content transactions");
    }
    expect(recreated.yjsUpdate.payload.equals(original.yjsUpdate.payload)).toBe(
      false,
    );
    applyPeerChange(source.editor, peer.changes[0]!);

    // Q was causally attached to the original XYZ identity. Local replay made
    // a new XYZ identity before Q arrived, so intention-preserving placement
    // relative to the recreated content is deliberately not guaranteed.
    expect(
      [...source.editor.readBlockPlainText(textBlockId, "paragraph")].sort(),
    ).toEqual([..."abcXYZQdef"].sort());
    source.editor.dispose();
    peer.editor.dispose();
  });

  it("refreshes Yjs mark replay while excluding peer insertions at both range boundaries", () => {
    const snapshot = snapshotWithText(textBlockId, "abcdef");
    const source = createCollaborativeTestEditor(snapshot, "mark-source");
    const peer = createCollaborativeTestEditor(snapshot, "mark-peer");
    expect(
      source.editor.updateMark({
        blockId: textBlockId,
        range: { from: 1, to: 4 },
        mark: { type: "strong" },
        enabled: true,
      }),
    ).toBe(true);
    applyPeerChange(peer.editor, source.changes[0]!);
    expect(
      peer.editor.insertText({ blockId: textBlockId, offset: 1, text: "Q" }),
    ).toBe(true);
    expect(
      peer.editor.insertText({ blockId: textBlockId, offset: 5, text: "R" }),
    ).toBe(true);
    applyPeerChange(source.editor, peer.changes[0]!);
    applyPeerChange(source.editor, peer.changes[1]!);
    expect(source.editor.readBlockPlainText(textBlockId, "paragraph")).toBe(
      "aQbcdRef",
    );
    expect(readMarkedText(source.editor, "strong")).toBe("bcd");

    expect(source.editor.undo()).toEqual({ status: "applied" });
    expect(readMarkedText(source.editor, "strong")).toBe("");
    expect(source.editor.redo()).toEqual({ status: "applied" });
    expect(readMarkedText(source.editor, "strong")).toBe("bcd");
    source.editor.dispose();
    peer.editor.dispose();
  });

  it("refreshes ordered replacement replay with peer content at both boundaries", () => {
    const snapshot = snapshotWithText(textBlockId, "abcdef");
    const source = createCollaborativeTestEditor(snapshot, "replace-source");
    const peer = createCollaborativeTestEditor(snapshot, "replace-peer");
    expect(
      source.editor.transaction(() => {
        expect(
          source.editor.deleteText({
            blockId: textBlockId,
            range: { from: 2, to: 4 },
          }),
        ).toBe(true);
        expect(
          source.editor.insertText({
            blockId: textBlockId,
            offset: 2,
            text: "XY",
          }),
        ).toBe(true);
      }),
    ).toMatchObject({ ok: true, changed: true });
    applyPeerChange(peer.editor, source.changes[0]!);
    expect(
      peer.editor.insertText({ blockId: textBlockId, offset: 2, text: "Q" }),
    ).toBe(true);
    expect(
      peer.editor.insertText({ blockId: textBlockId, offset: 5, text: "R" }),
    ).toBe(true);
    applyPeerChange(source.editor, peer.changes[0]!);
    applyPeerChange(source.editor, peer.changes[1]!);
    expect(source.editor.readBlockPlainText(textBlockId, "paragraph")).toBe(
      "abQXYRef",
    );
    expect(source.editor.undo()).toEqual({ status: "applied" });
    expect(source.editor.readBlockPlainText(textBlockId, "paragraph")).toBe(
      "abcdQRef",
    );
    expect(source.editor.redo()).toEqual({ status: "applied" });
    expect(source.editor.readBlockPlainText(textBlockId, "paragraph")).toBe(
      "abQXYRef",
    );
    source.editor.dispose();
    peer.editor.dispose();
  });

  it("replays inline entity replacement repeatedly with freshly captured Yjs anchors", () => {
    const snapshot = snapshotWithText(textBlockId, "abc");
    const source = createCollaborativeTestEditor(snapshot, "entity");
    expect(
      source.editor.updateInlineAtom({
        blockId: textBlockId,
        range: { from: 1, to: 2 },
        atom: { type: "mention", metadata: { id: "person-001" } },
      }),
    ).toBe(true);
    expect(
      JSON.stringify(source.editor.readBlockContent(textBlockId, "paragraph")),
    ).toContain('"type":"mention"');
    for (let cycle = 0; cycle < 3; cycle += 1) {
      expect(source.editor.undo()).toEqual({ status: "applied" });
      expect(source.editor.readBlockPlainText(textBlockId, "paragraph")).toBe(
        "abc",
      );
      expect(source.editor.redo()).toEqual({ status: "applied" });
      expect(
        JSON.stringify(
          source.editor.readBlockContent(textBlockId, "paragraph"),
        ),
      ).toContain('"type":"mention"');
    }
    source.editor.dispose();
  });
});

describe("First Draft outbox acceptance and replay identity", () => {
  it("processes consecutive frames in order through its sole message listener", () => {
    const socket = new TestSocket();
    const connection = createFirstDraftMessageDispatcher(socket);
    const received: string[] = [];
    connection.subscribe((message) => received.push(message.type));

    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-document-caught-up",
        documentId: "document-a",
        requestedRevision: 7,
        revision: 7,
      }),
    );
    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-document-unsubscribed",
        documentId: "document-a",
      }),
    );

    expect(socket.messageListenerCount).toBe(1);
    expect(received).toEqual([
      "first-draft-document-caught-up",
      "first-draft-document-unsubscribed",
    ]);
    connection.dispose();
    expect(socket.messageListenerCount).toBe(0);
  });

  it("accepts only an outstanding publication and retains retryable failures", () => {
    const socket = new TestSocket();
    const connection = createFirstDraftMessageDispatcher(socket);
    const { editor, changes } = createTestEditor();
    expect(
      editor.insertText({ blockId: textBlockId, offset: 0, text: "X" }),
    ).toBe(true);
    const outbox = createFirstDraftOutboundPublisher();
    outbox.attachGeneration({
      generationId: "acceptance",
      socket,
      createTransactionId: sequentialIds("aggregate"),
      publishSelection: vi.fn(),
    });
    outbox.generationCaughtUp();
    outbox.submitFinalized(changes[0]!);
    outbox.flush("manual");
    const proposed = decodeFirstDraftMessage(socket.frames[0]!);
    if (!proposed.ok || proposed.message.type !== "proposed-editor-transaction") {
      throw new Error("Expected proposed transaction");
    }
    const transactionId = proposed.message.transaction.transactionId;
    const applyRemoteTransaction = vi.fn();
    const accepted = vi.fn();
    const failed = vi.fn();
    const protocolError = vi.fn();
    const dispose = attachFirstDraftRemoteTransactions(
      connection,
      { applyRemoteTransaction },
      {
        documentId: "document-a",
        initialRevision: 2,
        outbox,
        onProtocolError: protocolError,
        onAccepted: accepted,
        onPersistenceFailed: failed,
      },
    );
    socket.receive(
      encodeFirstDraftMessage({
        type: "editor-transaction-accepted",
        documentId: "document-a",
        transactionId,
        baseRevision: 2,
        revision: 3,
        acceptedAt: 10,
      }),
    );
    socket.receive(
      encodeFirstDraftMessage({
        type: "editor-transaction-persistence-failed",
        documentId: "document-a",
        transactionId,
        reason: "unavailable",
        retryable: true,
        message: "Persistence unavailable",
      }),
    );
    expect(accepted).toHaveBeenCalledTimes(1);
    expect(failed).not.toHaveBeenCalled();
    expect(protocolError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("active outbox head") }),
    );
    expect(applyRemoteTransaction).not.toHaveBeenCalled();
    expect(outbox.getSnapshot().outstanding).toHaveLength(0);
    dispose();
    outbox.dispose();
    connection.dispose();
    editor.dispose();
  });

  it("does not collapse distinct IDs that share local revision numbers", () => {
    const { editor, changes } = createTestEditor();
    expect(
      editor.insertText({ blockId: textBlockId, offset: 0, text: "X" }),
    ).toBe(true);
    const first = convertEditorTransactionToTransport(changes[0]!);
    const socket = new TestSocket();
    const connection = createFirstDraftMessageDispatcher(socket);
    const applyRemoteTransaction = vi.fn(() => ({
      status: "applied" as const,
      changedBlockIds: [textBlockId],
      authorSelection: { status: "ignored-no-author" as const },
    }));
    const outbox = createFirstDraftOutboundPublisher();
    const dispose = attachFirstDraftRemoteTransactions(
      connection,
      { applyRemoteTransaction },
      {
        documentId: "document-one",
        initialRevision: 0,
        outbox,
      },
    );
    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-accepted-transaction-replay",
        documentId: "document-one",
        transactionId: "peer-a:one",
        baseRevision: 0,
        revision: 1,
        acceptedAt: 1,
        transaction: { ...first, transactionId: "peer-a:one" },
      }),
    );
    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-accepted-transaction-replay",
        documentId: "document-one",
        transactionId: "peer-b:two",
        baseRevision: 1,
        revision: 2,
        acceptedAt: 2,
        transaction: { ...first, transactionId: "peer-b:two" },
      }),
    );
    expect(applyRemoteTransaction).toHaveBeenCalledTimes(2);
    dispose();
    outbox.dispose();
    connection.dispose();
    editor.dispose();
  });

  it("resolves a canonical sender replay and ignores its exact duplicate acceptance", async () => {
    const socket = new TestSocket();
    const connection = createFirstDraftMessageDispatcher(socket);
    const applyRemoteTransaction = vi.fn(() => ({
      status: "applied" as const,
      changedBlockIds: [textBlockId],
      authorSelection: { status: "ignored-no-author" as const },
    }));
    const duplicate = vi.fn();
    const revisionAdvanced = vi.fn();
    const { editor, changes } = createTestEditor();
    expect(
      editor.insertText({ blockId: textBlockId, offset: 0, text: "X" }),
    ).toBe(true);
    const publisher = createFirstDraftOutboundPublisher();
    publisher.attachGeneration({
      generationId: "sender-echo",
      socket,
      createTransactionId: sequentialIds("aggregate"),
      publishSelection: vi.fn(),
    });
    publisher.generationCaughtUp();
    const dispose = attachFirstDraftRemoteTransactions(
      connection,
      { applyRemoteTransaction },
      {
        documentId: "document-one",
        initialRevision: 0,
        outbox: publisher,
        onDuplicate: duplicate,
        onRevisionAdvanced: revisionAdvanced,
      },
    );
    publisher.submitFinalized(changes[0]!);
    publisher.flush("manual");
    const proposed = decodeFirstDraftMessage(socket.frames[0]!);
    expect(proposed.ok && proposed.message.type).toBe(
      "proposed-editor-transaction",
    );
    if (
      !proposed.ok ||
      proposed.message.type !== "proposed-editor-transaction"
    ) {
      throw new Error("Expected proposed transaction");
    }
    const canonicalTransaction = {
      ...proposed.message.transaction,
      content: proposed.message.transaction.content.map((entry) => ({
        ...entry,
        readProjection: createBlockRichTextContentFromPlainText(
          entry.blockType,
          "server canonical projection",
        ),
      })),
    };
    const echo = encodeFirstDraftMessage({
      type: "first-draft-accepted-transaction-replay",
      documentId: "document-one",
      transactionId: proposed.message.transaction.transactionId,
      baseRevision: 0,
      revision: 1,
      acceptedAt: 1,
      transaction: canonicalTransaction,
    });
    socket.receive(echo);
    socket.receive(echo);
    socket.receive(
      encodeFirstDraftMessage({
        type: "editor-transaction-accepted",
        documentId: "document-one",
        transactionId: proposed.message.transaction.transactionId,
        baseRevision: 0,
        revision: 1,
        acceptedAt: 1,
      }),
    );

    expect(applyRemoteTransaction).not.toHaveBeenCalled();
    expect(duplicate).toHaveBeenCalledTimes(3);
    expect(revisionAdvanced).toHaveBeenCalledOnce();
    expect(revisionAdvanced).toHaveBeenCalledWith(1, "remote-replay");
    publisher.dispose();
    dispose();
    connection.dispose();
    editor.dispose();
  });
});

describe("First Draft ephemeral presence", () => {
  const subject = {
    actorId: "actor-a",
    clientId: "client-a",
    sessionId: "session-a",
  };
  const selection = {
    kind: "selection" as const,
    selection: {
      kind: "document" as const,
      direction: "forward" as const,
      anchor: {
        kind: "block" as const,
        blockId: textBlockId,
        surface: "block" as const,
      },
      focus: {
        kind: "block" as const,
        blockId: textBlockId,
        surface: "block" as const,
      },
    },
  };

  it("publishes reconnect presence only after all retained transactions are republished in order", () => {
    const { editor, changes } = createTestEditor();
    expect(editor.insertText({ blockId: textBlockId, offset: 0, text: "A" })).toBe(true);
    expect(editor.insertText({ blockId: textBlockId, offset: 1, text: "B" })).toBe(true);
    const publisher = createFirstDraftOutboundPublisher();
    const oldSocket = new TestSocket();
    publisher.attachGeneration({
      generationId: "presence-old",
      socket: oldSocket,
      createTransactionId: sequentialIds("presence-old-aggregate"),
      publishSelection: vi.fn(),
    });
    publisher.generationCaughtUp();
    for (const change of changes) {
      publisher.beginAtomicOperation();
      publisher.submitFinalized(change);
    }
    expect(oldSocket.frames.map(decodedMessageType)).toEqual([
      "proposed-editor-transaction",
    ]);
    publisher.detachGeneration({ attemptSend: false });

    const replacement = new TestSocket();
    const connection = createFirstDraftMessageDispatcher(replacement);
    const revisions = { presence: 0, selection: 0 };
    const presence = attachFirstDraftPresence(
      connection,
      editor,
      presenceSession(subject),
      {
        revisions,
        beforeStandaloneSelectionPublication: () =>
          publisher.beforeStandaloneSelectionPublication(),
      },
    );
    publisher.attachGeneration({
      generationId: "presence-replacement",
      socket: replacement,
      createTransactionId: sequentialIds("presence-replacement-aggregate"),
      publishSelection: (committed, transactionId) =>
        presence.publishSelection(committed, transactionId),
      onRetainedPublished: (committed) =>
        presence.publishCurrentSelection(committed ?? undefined),
    });
    publisher.generationCaughtUp();
    expect(replacement.frames.map(decodedMessageType)).toEqual([
      "first-draft-participant-update",
      "proposed-editor-transaction",
      "first-draft-selection-update",
    ]);

    publisher.acceptLocal(
      {
        type: "editor-transaction-accepted",
        documentId: "document-one",
        transactionId: changes[0]!.transactionId,
        baseRevision: 0,
        revision: 1,
        acceptedAt: 1,
      },
      0,
    );
    expect(replacement.frames.map(decodedMessageType)).toEqual([
      "first-draft-participant-update",
      "proposed-editor-transaction",
      "first-draft-selection-update",
      "proposed-editor-transaction",
      "first-draft-selection-update",
    ]);
    expect(revisions.selection).toBe(2);
    presence.dispose();
    connection.dispose();
    publisher.dispose();
    editor.dispose();
  });

  it("round-trips distinct participant and semantic selection variants", () => {
    const participant = {
      type: "first-draft-participant-update" as const,
      documentId: "document-one",
      subject,
      presenceRevision: 4,
      active: true,
      metadata: { displayName: "Ada", color: "#123abc" },
    };
    const selectionMessage = {
      type: "first-draft-selection-update" as const,
      documentId: "document-one",
      subject,
      selectionRevision: 9,
      selection,
    };
    expect(
      decodeFirstDraftMessage(encodeFirstDraftMessage(participant)),
    ).toEqual({ ok: true, message: participant });
    expect(
      decodeFirstDraftMessage(encodeFirstDraftMessage(selectionMessage)),
    ).toEqual({ ok: true, message: selectionMessage });
    expect("baseRevision" in participant).toBe(false);
    expect("documentRevision" in selectionMessage).toBe(false);
  });

  it("rejects malformed participant identity and malformed selection anchors", () => {
    const malformedParticipant = encodeFirstDraftMessage({
      type: "first-draft-participant-update",
      documentId: "document-one",
      subject,
      presenceRevision: 1,
      active: true,
      metadata: { displayName: "Ada", color: "#123abc" },
    });
    expect(
      decodeFirstDraftMessage(
        addMetadataPropertyAtRoot(malformedParticipant, "subject", {
          ...subject,
          sessionId: "",
        }),
      ).ok,
    ).toBe(false);
    const malformedSelection = encodeFirstDraftMessage({
      type: "first-draft-selection-update",
      documentId: "document-one",
      subject,
      selectionRevision: 1,
      selection,
    });
    expect(
      decodeFirstDraftMessage(
        addMetadataPropertyAtRoot(malformedSelection, "selection", {
          kind: "selection",
          selection: {
            kind: "document",
            direction: "forward",
            anchor: {
              kind: "text",
              blockId: textBlockId,
              textAnchor: null,
              affinity: null,
            },
            focus: selection.selection.focus,
          },
        }),
      ).ok,
    ).toBe(false);
  });

  it("accepts selection and participant snapshots in either order without feedback", () => {
    const socket = new TestSocket();
    const connection = createFirstDraftMessageDispatcher(socket);
    const peer = {
      actorId: "actor-b",
      clientId: "client-b",
      sessionId: "session-b",
    };
    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-document-caught-up",
        documentId: "document-one",
        requestedRevision: 0,
        revision: 0,
      }),
    );
    const setSelections = vi.fn<FirstDraftPresenceEditor["setSelections"]>();
    const dispose = attachFirstDraftPresence(
      connection,
      presenceEditor(setSelections),
      presenceSession(subject),
      {
        revisions: { presence: 0, selection: 0 },
        beforeStandaloneSelectionPublication: vi.fn(),
      },
    );
    dispose.publishCurrentSelection();
    const outboundBeforeSnapshots = socket.frames.length;

    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-selection-snapshot",
        documentId: "document-one",
        selections: [
          { subject, selectionRevision: 9, selection },
          { subject: peer, selectionRevision: 7, selection },
        ],
      }),
    );
    expect(setSelections).toHaveBeenLastCalledWith({
      entries: [{ subject: peer, selectionRevision: 7, selection }],
    });
    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-participant-snapshot",
        documentId: "document-one",
        participants: [
          {
            subject: peer,
            presenceRevision: 4,
            active: true,
            metadata: { displayName: "Grace", color: "#abcdef" },
          },
        ],
      }),
    );
    expect(setSelections).toHaveBeenLastCalledWith({
      entries: [
        { subject: peer, selectionRevision: 7, selection, color: "#abcdef" },
      ],
    });
    expect(socket.frames).toHaveLength(outboundBeforeSnapshots);

    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-selection-snapshot",
        documentId: "document-two",
        selections: [],
      }),
    );
    expect(setSelections).toHaveBeenLastCalledWith({
      entries: [
        { subject: peer, selectionRevision: 7, selection, color: "#abcdef" },
      ],
    });
    dispose.dispose();
    connection.dispose();
  });

  it("shares one socket, publishes finalized local settlements directly, and clears a departed participant", () => {
    const socket = new TestSocket();
    const connection = createFirstDraftMessageDispatcher(socket);
    let localListener: (() => void) | null = null;
    const setSelections = vi.fn<FirstDraftPresenceEditor["setSelections"]>();
    const onParticipants = vi.fn();
    const beforeStandaloneSelectionPublication = vi.fn();
    const dispose = attachFirstDraftPresence(
      connection,
      {
        selection: {
          getSnapshot: () => ({ kind: "none" as const, revision: 0 }),
        },
        subscribeStandaloneSelectionSettlements(listener) {
          localListener = () => listener({ kind: "none" });
          return () => {
            localListener = null;
          };
        },
        setSelections,
      },
      {
        documentId: "document-one",
        subject,
        metadata: { displayName: "Ada", color: "#123abc" },
      },
      {
        revisions: { presence: 0, selection: 0 },
        beforeStandaloneSelectionPublication,
        onParticipants,
      },
    );
    dispose.publishCurrentSelection();
    expect(socket.frames.map((frame) => decodedMessageType(frame))).toEqual([
      "first-draft-participant-update",
      "first-draft-selection-update",
    ]);
    const framesBeforeSettlement = socket.frames.length;
    invokeListener(localListener);
    expect(beforeStandaloneSelectionPublication).toHaveBeenCalledOnce();
    expect(socket.frames).toHaveLength(framesBeforeSettlement + 1);
    expect(decodeFirstDraftMessage(socket.frames.at(-1)!)).toMatchObject({
      ok: true,
      message: { type: "first-draft-selection-update", selectionRevision: 1 },
    });

    const collapsedTextAnchor = {
      kind: "block-relative-text" as const,
      codec: "test",
      version: 1 as const,
      payload: { encoded: "AQ==", assoc: 1 as const },
    };
    dispose.publishSelection({
      kind: "selection",
      selection: {
        kind: "document",
        direction: "forward",
        anchor: {
          kind: "text",
          blockId: textBlockId,
          textOffset: 4,
          textAnchor: collapsedTextAnchor,
          affinity: "forward",
        },
        focus: {
          kind: "text",
          blockId: textBlockId,
          textOffset: 4,
          textAnchor: collapsedTextAnchor,
          affinity: "forward",
        },
      },
    });
    expect(decodeFirstDraftMessage(socket.frames.at(-1)!)).toMatchObject({
      ok: true,
      message: {
        type: "first-draft-selection-update",
        selectionRevision: 2,
        selection: {
          selection: {
            anchor: { textAnchor: collapsedTextAnchor },
            focus: { textAnchor: collapsedTextAnchor },
          },
        },
      },
    });

    const peer = {
      actorId: "actor-b",
      clientId: "client-b",
      sessionId: "session-b",
    };
    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-selection-update",
        documentId: "document-one",
        subject: peer,
        selectionRevision: 2,
        selection,
      }),
    );
    expect(setSelections).toHaveBeenLastCalledWith({
      entries: [{ subject: peer, selectionRevision: 2, selection }],
    });
    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-participant-update",
        documentId: "document-one",
        subject: peer,
        presenceRevision: 3,
        active: true,
        metadata: { displayName: "Grace", color: "#654321" },
      }),
    );
    expect(setSelections).toHaveBeenLastCalledWith({
      entries: [
        { subject: peer, selectionRevision: 2, selection, color: "#654321" },
      ],
    });
    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-participant-update",
        documentId: "document-one",
        subject: peer,
        presenceRevision: 4,
        active: false,
        metadata: { displayName: "Grace", color: "#654321" },
      }),
    );
    expect(setSelections).toHaveBeenLastCalledWith({ entries: [] });
    const framesBeforeDispose = socket.frames.length;
    dispose.dispose();
    expect(socket.frames).toHaveLength(framesBeforeDispose);
    expect(onParticipants).toHaveBeenLastCalledWith([]);
    const callsAfterDispose = setSelections.mock.calls.length;
    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-participant-update",
        documentId: "document-one",
        subject: peer,
        presenceRevision: 5,
        active: true,
        metadata: { displayName: "Grace", color: "#654321" },
      }),
    );
    expect(setSelections).toHaveBeenCalledTimes(callsAfterDispose);
    connection.dispose();
  });

  it("keeps publication revisions monotonic when presence attaches to a replacement generation", () => {
    const revisions = { presence: 0, selection: 0 };
    const firstSocket = new TestSocket();
    const firstConnection = createFirstDraftMessageDispatcher(firstSocket);
    const first = attachFirstDraftPresence(
      firstConnection,
      presenceEditor(vi.fn()),
      presenceSession(subject),
      {
        revisions,
        beforeStandaloneSelectionPublication: vi.fn(),
      },
    );
    first.publishCurrentSelection();
    first.publishSelection({ kind: "none" }, "aggregate-one");
    expect(decodeFirstDraftMessage(firstSocket.frames[0]!)).toMatchObject({
      ok: true,
      message: { type: "first-draft-participant-update", presenceRevision: 0 },
    });
    expect(decodeFirstDraftMessage(firstSocket.frames[2]!)).toMatchObject({
      ok: true,
      message: { type: "first-draft-selection-update", selectionRevision: 1 },
    });
    first.dispose();
    firstConnection.dispose();

    const secondSocket = new TestSocket();
    const secondConnection = createFirstDraftMessageDispatcher(secondSocket);
    const second = attachFirstDraftPresence(
      secondConnection,
      presenceEditor(vi.fn()),
      presenceSession(subject),
      {
        revisions,
        beforeStandaloneSelectionPublication: vi.fn(),
      },
    );
    second.publishCurrentSelection();
    expect(decodeFirstDraftMessage(secondSocket.frames[0]!)).toMatchObject({
      ok: true,
      message: { type: "first-draft-participant-update", presenceRevision: 1 },
    });
    expect(decodeFirstDraftMessage(secondSocket.frames[1]!)).toMatchObject({
      ok: true,
      message: { type: "first-draft-selection-update", selectionRevision: 2 },
    });
    second.dispose();
    secondConnection.dispose();
  });

  it("flushes a pending transaction and its committed selection before standalone selection", () => {
    const socket = new TestSocket();
    const connection = createFirstDraftMessageDispatcher(socket);
    let settleStandalone: (() => void) | null = null;
    const presenceOwner: FirstDraftPresenceEditor = {
      selection: {
        getSnapshot: () => ({ kind: "none", revision: 0 }),
      },
      subscribeStandaloneSelectionSettlements(listener) {
        settleStandalone = () => listener({ kind: "none" });
        return () => {
          settleStandalone = null;
        };
      },
      setSelections: vi.fn(),
    };
    const publisher = createFirstDraftOutboundPublisher();
    const presence = attachFirstDraftPresence(
      connection,
      presenceOwner,
      presenceSession(subject),
      {
        revisions: { presence: 0, selection: 0 },
        beforeStandaloneSelectionPublication:
          publisher.beforeStandaloneSelectionPublication,
      },
    );
    publisher.attachGeneration({
      generationId: "presence-ordering",
      socket,
      createTransactionId: sequentialIds("aggregate"),
      publishSelection: (selection, transactionId) =>
        presence.publishSelection(selection, transactionId),
    });
    publisher.generationCaughtUp();
    const { editor, changes } = createTestEditor();
    editor.insertText({ blockId: textBlockId, offset: 0, text: "X" });
    publisher.submitFinalized(changes[0]!);
    const beforeSettlement = socket.frames.length;

    invokeListener(settleStandalone);
    expect(
      socket.frames.slice(beforeSettlement).map((frame) => decodedMessageType(frame)),
    ).toEqual([
      "proposed-editor-transaction",
      "first-draft-selection-update",
      "first-draft-selection-update",
    ]);
    expect(decodeFirstDraftMessage(socket.frames[beforeSettlement + 1]!)).toMatchObject({
      ok: true,
      message: { selectionRevision: 0 },
    });
    expect(decodeFirstDraftMessage(socket.frames[beforeSettlement + 2]!)).toMatchObject({
      ok: true,
      message: { selectionRevision: 1 },
    });
    publisher.dispose();
    presence.dispose();
    connection.dispose();
    editor.dispose();
  });

  it("installs and clears remote document and table selections without feedback", () => {
    const socket = new TestSocket();
    const connection = createFirstDraftMessageDispatcher(socket);
    const { editor, changes } = createTestEditor();
    const dispose = attachFirstDraftPresence(
      connection,
      editor,
      {
        documentId: "document-one",
        subject,
        metadata: { displayName: "Ada", color: "#123abc" },
      },
      {
        revisions: { presence: 0, selection: 0 },
        beforeStandaloneSelectionPublication: vi.fn(),
      },
    );
    const peer = {
      actorId: "actor-b",
      clientId: "client-b",
      sessionId: "session-b",
    };
    expect(
      editor.focusText(textBlockId, { offset: 2, preventScroll: true }),
    ).toEqual({ status: "pending" });
    const canonicalBefore = editor.selectionController.getCanonicalSnapshot();
    expect(canonicalBefore).toMatchObject({ kind: "document" });
    const textBefore = editor.readBlockPlainText(textBlockId, "paragraph");
    const framesBeforeRemoteSelections = socket.frames.length;
    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-selection-update",
        documentId: "document-one",
        subject: peer,
        selectionRevision: 1,
        selection,
      }),
    );
    expect(editor.additionalSelections.getSnapshot()).toHaveLength(1);
    for (const [selectionRevision, headCellId] of [
      [2, "fd-table-cell-1-1"],
      [3, "fd-table-cell-1-2"],
    ] as const) {
      socket.receive(
        encodeFirstDraftMessage({
          type: "first-draft-selection-update",
          documentId: "document-one",
          subject: peer,
          selectionRevision,
          selection: {
            kind: "selection",
            selection: {
              kind: "block-internal",
              blockId: "fd-table" as BlockId,
              subsystem: "table.cell-range",
              payload: {
                kind: "cell-range",
                anchorCellId: "fd-table-cell-1-1",
                headCellId,
              },
            },
          },
        }),
      );
      expect(
        editor.additionalSelections.getSnapshot()[0]?.resolvedSelection,
      ).toMatchObject({
        kind: "block-internal",
        blockId: "fd-table",
      });
    }
    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-selection-snapshot",
        documentId: "document-one",
        selections: [],
      }),
    );
    expect(editor.additionalSelections.getSnapshot()).toEqual([
      expect.objectContaining({
        active: false,
        resolution: "inactive",
        resolvedSelection: null,
      }),
    ]);
    expect(editor.selectionController.getCanonicalSnapshot()).toBe(
      canonicalBefore,
    );
    socket.receive(
      encodeFirstDraftMessage({
        type: "first-draft-selection-update",
        documentId: "document-one",
        subject: peer,
        selectionRevision: 4,
        selection: { kind: "none" },
      }),
    );
    expect(editor.additionalSelections.getSnapshot()[0]).toMatchObject({
      resolution: "cleared",
      resolvedSelection: null,
    });
    expect(socket.frames).toHaveLength(framesBeforeRemoteSelections);
    expect(editor.selectionController.getCanonicalSnapshot()).toBe(
      canonicalBefore,
    );
    expect(editor.readBlockPlainText(textBlockId, "paragraph")).toBe(
      textBefore,
    );
    expect(changes).toHaveLength(0);
    expect(editor.canUndo).toBe(false);
    dispose.dispose();
    connection.dispose();
    editor.dispose();
  });
});

function createTestEditor() {
  const changes: EditorSemanticChange[] = [];
  const editor = initializeEditableEditor({
    definition: createDefinition(),
    snapshot: createFirstDraftSnapshot(),
    onChange: (change) => {
      changes.push(change);
    },
    createTransactionId: sequentialIds("converter"),
  });
  return { editor, changes };
}

function createCollaborativeTestEditor(
  snapshot: EditorInstanceSnapshot,
  idPrefix: string,
) {
  const changes: EditorSemanticChange[] = [];
  const editor = initializeEditableEditor({
    definition: createDefinition(),
    snapshot,
    onChange: (change) => {
      changes.push(change);
    },
    createTransactionId: sequentialIds(idPrefix),
  });
  return { editor, changes };
}

function applyPeerChange(
  editor: ReturnType<typeof createCollaborativeTestEditor>["editor"],
  change: EditorSemanticChange,
): void {
  expect(
    editor.applyRemoteTransaction({
      transaction: convertEditorTransactionToTransport(change),
      authorSelection: { kind: "no-author-selection" },
    }),
  ).toMatchObject({ status: "applied" });
}

function readMarkedText(
  editor: ReturnType<typeof createCollaborativeTestEditor>["editor"],
  markType: string,
): string {
  const content = editor.readBlockContent(textBlockId, "paragraph");
  if (!content) throw new Error("Expected collaborative rich text content");
  return richTextBlockInlineContent(content)
    .filter(
      (node) =>
        node.type === "text" &&
        node.marks?.some((mark) => mark.type === markType),
    )
    .map((node) => (node.type === "text" ? node.text : ""))
    .join("");
}

function snapshotWithText(
  blockId: BlockId,
  text: string,
): EditorInstanceSnapshot {
  const snapshot = createFirstDraftSnapshot();
  const content = createBlockRichTextContentFromPlainText(
    "paragraph",
    text,
  ) as RichTextDocumentNodeJson;
  const checkpoint = createYjsBlockContentCheckpoint(blockId, content);
  return {
    ...snapshot,
    content: { ...snapshot.content, [blockId]: content },
    opaqueContentCheckpoints: {
      ...snapshot.opaqueContentCheckpoints,
      [blockId]: {
        kind: "checkpoint",
        format: checkpoint.format,
        version: checkpoint.version,
        payloadBase64: Buffer.from(checkpoint.payload.copy()).toString(
          "base64",
        ),
      },
    },
  };
}

function createDefinition() {
  return createFirstDraftEditorDefinition(createFirstDraftViewStateStore());
}

function sequentialIds(prefix: string): () => string {
  let sequence = 0;
  return () => `${prefix}:${++sequence}`;
}

function createContentFrame(): ArrayBuffer {
  const { editor, changes } = createTestEditor();
  expect(
    editor.insertText({ blockId: textBlockId, offset: 0, text: "X" }),
  ).toBe(true);
  const frame = encodeFirstDraftMessage({
    type: "proposed-editor-transaction",
    transaction: convertEditorTransactionToTransport(changes[0]!),
  });
  editor.dispose();
  return frame;
}

function replaceAscii(
  frame: ArrayBuffer,
  before: string,
  after: string,
): ArrayBuffer {
  if (before.length !== after.length)
    throw new Error("Replacement must preserve frame length");
  const copy = frame.slice(0);
  const bytes = new Uint8Array(copy);
  const needle = new TextEncoder().encode(before);
  const replacement = new TextEncoder().encode(after);
  const index = bytes.findIndex((_, candidate) =>
    needle.every((byte, offset) => bytes[candidate + offset] === byte),
  );
  if (index < 0) throw new Error(`Missing frame text ${before}`);
  bytes.set(replacement, index);
  return copy;
}

function requireProposedMessage(
  message: FirstDraftMessage,
): Extract<
  FirstDraftMessage,
  { readonly type: "proposed-editor-transaction" }
> {
  if (message.type !== "proposed-editor-transaction") {
    throw new Error("Expected a proposed editor transaction message");
  }
  return message;
}

function decodedMessageType(frame: ArrayBuffer): FirstDraftMessage["type"] {
  const decoded = decodeFirstDraftMessage(frame);
  if (!decoded.ok) throw new Error(decoded.error);
  return decoded.message.type;
}

function invokeListener(listener: (() => void) | null): void {
  if (!listener) throw new Error("Expected a registered listener");
  listener();
}

function addMetadataProperty(
  frame: ArrayBuffer,
  key: string,
  value: unknown,
): ArrayBuffer {
  const view = new DataView(frame);
  const metadataLength = view.getUint32(4);
  const metadata = JSON.parse(
    new TextDecoder().decode(new Uint8Array(frame, 8, metadataLength)),
  ) as { transaction: Record<string, unknown> };
  metadata.transaction[key] = value;
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const result = new ArrayBuffer(8 + metadataBytes.byteLength);
  const bytes = new Uint8Array(result);
  bytes.set(new Uint8Array(frame, 0, 4));
  new DataView(result).setUint32(4, metadataBytes.byteLength);
  bytes.set(metadataBytes, 8);
  return result;
}

function addMetadataPropertyAtRoot(
  frame: ArrayBuffer,
  key: string,
  value: unknown,
): ArrayBuffer {
  const view = new DataView(frame);
  const metadataLength = view.getUint32(4);
  const metadata = JSON.parse(
    new TextDecoder().decode(new Uint8Array(frame, 8, metadataLength)),
  ) as Record<string, unknown>;
  metadata[key] = value;
  const metadataBytes = new TextEncoder().encode(JSON.stringify(metadata));
  const result = new ArrayBuffer(8 + metadataBytes.byteLength);
  const bytes = new Uint8Array(result);
  bytes.set(new Uint8Array(frame, 0, 4));
  new DataView(result).setUint32(4, metadataBytes.byteLength);
  bytes.set(metadataBytes, 8);
  return result;
}

function acceptSentTransportRecords(publisher: FirstDraftOutboundPublisher): void {
  let revision = publisher.getSnapshot().acceptedLocalTransactionIds.length;
  while (publisher.getSnapshot().outstanding[0]?.state === "sent") {
    const transactionId = publisher.getSnapshot().outstanding[0]!.transactionId;
    publisher.acceptLocal(
      {
        type: "editor-transaction-accepted",
        documentId: "document-one",
        transactionId,
        baseRevision: revision,
        revision: revision + 1,
        acceptedAt: revision + 1,
      },
      revision,
    );
    revision += 1;
  }
}

class TestSocket implements FirstDraftOutboundSocket {
  readyState = 1;
  binaryType: BinaryType = "blob";
  readonly frames: ArrayBuffer[] = [];
  private readonly messages = new Set<(event: MessageEvent<unknown>) => void>();
  private readonly errors = new Set<(event: Event) => void>();

  get messageListenerCount(): number {
    return this.messages.size;
  }

  send(frame: ArrayBuffer): void {
    this.frames.push(frame);
  }

  addEventListener(
    type: "message" | "error",
    listener:
      | ((event: MessageEvent<unknown>) => void)
      | ((event: Event) => void),
  ): void {
    if (type === "message")
      this.messages.add(listener as (event: MessageEvent<unknown>) => void);
    else this.errors.add(listener as (event: Event) => void);
  }

  removeEventListener(
    type: "message" | "error",
    listener:
      | ((event: MessageEvent<unknown>) => void)
      | ((event: Event) => void),
  ): void {
    if (type === "message")
      this.messages.delete(listener as (event: MessageEvent<unknown>) => void);
    else this.errors.delete(listener as (event: Event) => void);
  }

  receive(data: ArrayBuffer): void {
    for (const listener of this.messages)
      listener({ data } as MessageEvent<unknown>);
  }
}

function presenceEditor(
  setSelections: FirstDraftPresenceEditor["setSelections"],
): FirstDraftPresenceEditor {
  return {
    selection: {
      getSnapshot: () => ({ kind: "none" as const, revision: 0 }),
    },
    subscribeStandaloneSelectionSettlements: () => () => undefined,
    setSelections,
  };
}

function presenceSession(
  subject: Readonly<{
    actorId: string;
    clientId: string;
    sessionId: string;
  }>,
) {
  return {
    documentId: "document-one",
    subject,
    metadata: { displayName: "Ada", color: "#123abc" },
  };
}
