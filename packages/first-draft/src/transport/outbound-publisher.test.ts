import {
  EditorImmutableBinary,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import { asBlockId } from "@repo/editor-core/kernel";
import type { EditorSemanticChange } from "@repo/editor-web/editor";
import {
  projectCanonicalSelectionToTransaction,
  projectTransactionSelectionToStable,
} from "@repo/editor-react/selection";
import {
  EDITOR_YJS_CONTENT_FORMAT,
  EDITOR_YJS_CONTENT_FORMAT_VERSION,
  mergeUpdates,
} from "@repo/editor-yjs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFirstDraftViewStateStore } from "../blocks/view-state.tsx";
import { createFirstDraftEditorDefinition } from "../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../first-draft-fixture.ts";
import { initializeTestEditableEditor as initializeEditableEditor } from "../test-editor.ts";
import { convertEditorTransactionToTransport } from "./editor-transaction-to-transport.ts";
import {
  decodeFirstDraftMessage,
  encodeFirstDraftMessage,
  type ProposedEditorTransactionMessage,
} from "./message-protocol.ts";
import {
  createFirstDraftOutboundPublisher,
  type FirstDraftOutboundPublisher,
  type FirstDraftOutboundPublisherOptions,
} from "./outbound-publisher.ts";
import type { EditorTransportTransaction } from "./transport-types.ts";
import { firstDraftTransactionProposalsEqual } from "./transaction-proposal-identity.ts";

const firstBlockId = asBlockId("fd-paragraph-intro");
const secondBlockId = asBlockId("fd-paragraph-outro");

afterEach(() => {
  vi.useRealTimers();
});

describe("First Draft outbound coalescing", () => {
  it("rejects invalid active-record and retained-byte capacities", () => {
    expect(() =>
      createFirstDraftOutboundPublisher({ limits: { maxActiveRecords: 0 } }),
    ).toThrow("active record limit must be a positive integer");
    expect(() =>
      createFirstDraftOutboundPublisher({
        limits: { maxRetainedEncodedBytes: Number.MAX_SAFE_INTEGER + 1 },
      }),
    ).toThrow("retained encoded byte limit must be a positive integer");
  });

  it("compares proposal identity semantically while excluding only the read projection", () => {
    const { editor, changes } = editorWithChanges();
    insertCharacters(editor, "A");
    const transaction = convertEditorTransactionToTransport(changes[0]!);
    const entry = transaction.content[0]!;
    const changedProjection: EditorTransportTransaction = {
      ...transaction,
      content: [{ ...entry, readProjection: { type: "doc", content: [] } }],
    };
    expect(firstDraftTransactionProposalsEqual(transaction, changedProjection)).toBe(true);
    const changedBytes = entry.update.payload.copy();
    changedBytes[0] = (changedBytes[0]! + 1) & 0xff;
    const conflicts = [
      { ...transaction, historyAction: "undo" },
      { ...transaction, graph: { changes: [] } },
      {
        ...transaction,
        metadata: { kind: "updateBlockMetadata", updates: [] },
      },
      { ...transaction, content: [{ ...entry, blockId: secondBlockId }] },
      { ...transaction, content: [{ ...entry, blockType: "heading" }] },
      {
        ...transaction,
        content: [{ ...entry, update: { ...entry.update, kind: "checkpoint" } }],
      },
      {
        ...transaction,
        content: [{ ...entry, update: { ...entry.update, format: "other" } }],
      },
      {
        ...transaction,
        content: [{ ...entry, update: { ...entry.update, version: 99 } }],
      },
      {
        ...transaction,
        content: [
          {
            ...entry,
            update: {
              ...entry.update,
              payload: EditorImmutableBinary.copyOf(changedBytes),
            },
          },
        ],
      },
    ];
    for (const conflict of conflicts) {
      expect(
        firstDraftTransactionProposalsEqual(
          transaction,
          conflict as unknown as EditorTransportTransaction,
        ),
      ).toBe(false);
    }
    editor.dispose();
  });

  it("accepts hundreds of original local commits without waiting for transport and preserves history", () => {
    vi.useFakeTimers();
    const frames: ArrayBuffer[] = [];
    const changes: EditorSemanticChange[] = [];
    const publisher = createFirstDraftOutboundPublisher({
      limits: { maxEntries: 512 },
    });
    publisher.attachGeneration({
      generationId: "generation:1",
      socket: { readyState: 1, send: (frame) => frames.push(frame) },
      createTransactionId: sequentialIds("aggregate"),
      publishSelection: vi.fn(),
    });
    publisher.generationCaughtUp();
    const editor = createEditor((change) => {
      changes.push(change);
      publisher.submitFinalized(change);
    });

    for (let index = 0; index < 300; index += 1) {
      expect(
        editor.insertText({
          blockId: firstBlockId,
          offset: index,
          text: String.fromCharCode(97 + (index % 26)),
        }),
      ).toBe(true);
    }

    expect(changes).toHaveLength(300);
    expect(frames).toHaveLength(0);
    expect(editor.canUndo).toBe(true);
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(changes).toHaveLength(301);
    expect(changes.at(-1)?.historyAction).toBe("undo");
    expect(editor.canRedo).toBe(true);
    acceptSentRecords(publisher, frames);
    expect(frames).toHaveLength(2);
    publisher.dispose();
    editor.dispose();
  });

  it("coalesces hundreds of ordinary deletions while hard latency publishes and original history remains local", () => {
    vi.useFakeTimers();
    const frames: ArrayBuffer[] = [];
    const selections = vi.fn();
    const publisher = createFirstDraftOutboundPublisher({
      limits: { maxEntries: 512 },
    });
    publisher.attachGeneration({
      generationId: "deletion-generation",
      socket: { readyState: 1, send: (frame) => frames.push(frame) },
      createTransactionId: sequentialIds("deletion-aggregate"),
      publishSelection: selections,
    });
    publisher.generationCaughtUp();
    const { editor, changes } = editorWithChanges();
    insertCharacters(editor, "x".repeat(300));
    const setupChanges = changes.length;
    const initialLength = editor.readBlockPlainText(
      firstBlockId,
      "paragraph",
    ).length;

    for (let index = 0; index < 250; index += 1) {
      expect(
        editor.deleteText({
          blockId: firstBlockId,
          range: { from: 0, to: 1 },
        }),
      ).toBe(true);
      const change = changes[setupChanges + index]!;
      expect(contentChange(change).operations[0]?.kind).toBe(
        "deleteInlineRange",
      );
      publisher.submitFinalized(change);
      vi.advanceTimersByTime(10);
      acceptSentRecords(publisher, frames);
      if (index === 24) expect(frames.length).toBeGreaterThan(0);
    }
    publisher.flush("manual");
    acceptSentRecords(publisher, frames);
    expect(changes).toHaveLength(setupChanges + 250);
    expect(
      editor.readBlockPlainText(firstBlockId, "paragraph").length,
    ).toBe(initialLength - 250);
    expect(frames.length).toBeGreaterThan(5);
    expect(frames.length).toBeLessThan(25);
    expect(selections).toHaveBeenCalledTimes(frames.length);
    expect(
      frames.every(
        (frame) =>
          proposed(frame).transaction.content[0]?.update.format ===
            EDITOR_YJS_CONTENT_FORMAT &&
          proposed(frame).transaction.content[0]?.update.version ===
            EDITOR_YJS_CONTENT_FORMAT_VERSION,
      ),
    ).toBe(true);

    expect(editor.undo()).toEqual({ status: "applied" });
    const undo = changes.at(-1)!;
    expect(undo.historyAction).toBe("undo");
    publisher.submitFinalized(undo);
    acceptSentRecords(publisher, frames);
    expect(editor.redo()).toEqual({ status: "applied" });
    const redo = changes.at(-1)!;
    expect(redo.historyAction).toBe("redo");
    publisher.submitFinalized(redo);
    acceptSentRecords(publisher, frames);
    expect(
      frames.slice(-2).map((frame) => proposed(frame).transaction.historyAction),
    ).toEqual(["undo", "redo"]);
    publisher.dispose();
    editor.dispose();
  });

  it("merges eligible updates with a dedicated identity, final projection, and final selection", () => {
    const events: string[] = [];
    const frames: ArrayBuffer[] = [];
    const selections = vi.fn((_: unknown, id: string) => events.push(`selection:${id}`));
    const socket = {
      readyState: 1,
      send: (frame: ArrayBuffer) => {
        events.push("transaction");
        frames.push(frame);
      },
    };
    const publisher = createFirstDraftOutboundPublisher();
    publisher.attachGeneration({
      generationId: "generation:1",
      socket,
      createTransactionId: sequentialIds("aggregate"),
      publishSelection: selections,
      onPublished: (id) => events.push(`published:${id}`),
    });
    publisher.generationCaughtUp();
    const { editor, changes } = editorWithChanges();
    const peer = createEditor();
    for (const [offset, text] of [
      [0, "A"],
      [1, "B"],
      [2, "C"],
    ] as const) {
      expect(editor.insertText({ blockId: firstBlockId, offset, text })).toBe(true);
    }
    for (const change of changes) publisher.submitFinalized(change);
    expect(frames).toHaveLength(0);

    publisher.flush("manual");

    expect(frames).toHaveLength(1);
    const transaction = proposed(frames[0]!).transaction;
    expect(transaction.transactionId).toBe("aggregate:1");
    expect(changes.map(({ transactionId }) => transactionId)).not.toContain(
      transaction.transactionId,
    );
    expect(transaction.historyAction).toBe("command");
    expect(transaction.graph).toBeNull();
    expect(transaction.metadata).toBeNull();
    expect(transaction.content).toHaveLength(1);
    expect(transaction.content[0]).toMatchObject({
      blockId: firstBlockId,
      blockType: "paragraph",
      readProjection: contentChange(changes.at(-1)!).readProjection,
      update: {
        kind: "operation",
        format: EDITOR_YJS_CONTENT_FORMAT,
        version: EDITOR_YJS_CONTENT_FORMAT_VERSION,
      },
    });
    expect(
      peer.applyRemoteTransaction({
        transaction,
        authorSelection: { kind: "no-author-selection" },
      }),
    ).toMatchObject({ status: "applied" });
    expect(peer.readBlockPlainText(firstBlockId, "paragraph")).toBe(
      editor.readBlockPlainText(firstBlockId, "paragraph"),
    );
    expect(selections).toHaveBeenCalledWith(
      changes.at(-1)!.selectionAfter,
      "aggregate:1",
    );
    expect(events).toEqual([
      "transaction",
      "published:aggregate:1",
      "selection:aggregate:1",
    ]);
    expect(
      publisher.getSnapshot().outstanding.map(({ transactionId }) => transactionId),
    ).toEqual(["aggregate:1"]);
    expect(publisher.getSnapshot().outstanding[0]!.sourceTransactionIds).toEqual(
      changes.map(({ transactionId }) => transactionId),
    );
    publisher.dispose();
    editor.dispose();
    peer.dispose();
  });

  it("publishes a single queued change through the same publisher with its source identity", () => {
    const harness = createHarness();
    const { editor, changes } = editorWithChanges();
    editor.insertText({ blockId: firstBlockId, offset: 0, text: "S" });
    harness.publisher.submitFinalized(changes[0]!);
    harness.publisher.flush("manual");

    expect(proposed(harness.frames[0]!).transaction.transactionId).toBe(
      changes[0]!.transactionId,
    );
    expect(harness.selection).toHaveBeenCalledOnce();
    expect(harness.publisher.getSnapshot().outstanding[0]?.transactionId).toBe(
      changes[0]!.transactionId,
    );
    harness.publisher.dispose();
    editor.dispose();
  });

  it("coalesces repeated ordinary Backspace/Delete-shaped changes", () => {
    const harness = createHarness();
    const { editor, changes } = editorWithChanges();
    expect(
      editor.deleteText({ blockId: firstBlockId, range: { from: 0, to: 1 } }),
    ).toBe(true);
    expect(
      editor.deleteText({ blockId: firstBlockId, range: { from: 0, to: 1 } }),
    ).toBe(true);
    expect(
      changes.every(
        (change) =>
          change.kind === "block-content" &&
          change.operations[0]?.kind === "deleteInlineRange",
      ),
    ).toBe(true);
    for (const change of changes) harness.publisher.submitFinalized(change);
    harness.publisher.flush("manual");
    expect(harness.frames).toHaveLength(1);
    expect(proposed(harness.frames[0]!).transaction.transactionId).toBe(
      "aggregate:1",
    );
    harness.publisher.dispose();
    editor.dispose();
  });

  it("flushes on quiet and hard timers under continuous input", () => {
    vi.useFakeTimers();
    const quiet = createHarness();
    const quietEditor = editorWithChanges();
    quietEditor.editor.insertText({ blockId: firstBlockId, offset: 0, text: "Q" });
    quiet.publisher.submitFinalized(quietEditor.changes[0]!);
    vi.advanceTimersByTime(74);
    expect(quiet.frames).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(quiet.frames).toHaveLength(1);

    const hard = createHarness();
    const hardEditor = editorWithChanges();
    for (let index = 0; index < 5; index += 1) {
      hardEditor.editor.insertText({
        blockId: firstBlockId,
        offset: index,
        text: String(index),
      });
      hard.publisher.submitFinalized(hardEditor.changes[index]!);
      if (index < 4) vi.advanceTimersByTime(50);
    }
    vi.advanceTimersByTime(24);
    expect(hard.frames).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(hard.frames).toHaveLength(1);

    quiet.publisher.dispose();
    hard.publisher.dispose();
    quietEditor.editor.dispose();
    hardEditor.editor.dispose();
  });

  it("enforces entry and aggregate-byte limits deterministically", () => {
    const entry = createHarness({ limits: { maxEntries: 2 } });
    const entryEditor = editorWithChanges();
    insertCharacters(entryEditor.editor, "ABC");
    entry.publisher.submitFinalized(entryEditor.changes[0]!);
    entry.publisher.submitFinalized(entryEditor.changes[1]!);
    entry.publisher.submitFinalized(entryEditor.changes[2]!);
    expect(entry.frames).toHaveLength(1);
    expect(entry.publisher.getSnapshot().pendingEntries).toBe(1);
    entry.publisher.flush("manual");
    acceptSentRecords(entry.publisher, entry.frames);
    expect(entry.frames).toHaveLength(2);

    const byteEditor = editorWithChanges();
    insertCharacters(byteEditor.editor, "XY");
    const firstBytes = contentChange(byteEditor.changes[0]!).yjsUpdate.payload.byteLength;
    const secondBytes = contentChange(byteEditor.changes[1]!).yjsUpdate.payload.byteLength;
    const mergedBytes = mergeUpdates([
      contentChange(byteEditor.changes[0]!).yjsUpdate.payload.copy(),
      contentChange(byteEditor.changes[1]!).yjsUpdate.payload.copy(),
    ]).byteLength;
    expect(mergedBytes).toBeGreaterThan(Math.max(firstBytes, secondBytes));
    const bytes = createHarness({
      limits: { maxMergedUpdateBytes: mergedBytes - 1 },
    });
    bytes.publisher.submitFinalized(byteEditor.changes[0]!);
    bytes.publisher.submitFinalized(byteEditor.changes[1]!);
    expect(bytes.frames).toHaveLength(1);
    expect(bytes.publisher.getSnapshot().pendingEntries).toBe(1);
    bytes.publisher.flush("manual");
    acceptSentRecords(bytes.publisher, bytes.frames);
    expect(bytes.frames).toHaveLength(2);

    entry.publisher.dispose();
    bytes.publisher.dispose();
    entryEditor.editor.dispose();
    byteEditor.editor.dispose();
  });

  it("flushes an older aggregate before block changes and cannot contaminate its projection", () => {
    const harness = createHarness();
    const { editor, changes } = editorWithChanges();
    editor.insertText({ blockId: firstBlockId, offset: 0, text: "A" });
    editor.insertText({ blockId: firstBlockId, offset: 1, text: "B" });
    const olderProjection = contentChange(changes[1]!).readProjection;
    editor.insertText({ blockId: firstBlockId, offset: 2, text: "PASTE" });
    for (const change of changes) harness.publisher.submitFinalized(change);
    acceptSentRecords(harness.publisher, harness.frames);

    expect(harness.frames).toHaveLength(2);
    expect(proposed(harness.frames[0]!).transaction.content[0]!.readProjection).toEqual(
      olderProjection,
    );
    expect(proposed(harness.frames[0]!).transaction.transactionId).toBe(
      "aggregate:1",
    );
    expect(proposed(harness.frames[1]!).transaction.transactionId).toBe(
      changes[2]!.transactionId,
    );

    editor.insertText({ blockId: firstBlockId, offset: 7, text: "C" });
    editor.insertText({ blockId: secondBlockId, offset: 0, text: "D" });
    harness.publisher.submitFinalized(changes[3]!);
    harness.publisher.submitFinalized(changes[4]!);
    acceptSentRecords(harness.publisher, harness.frames);
    expect(harness.frames).toHaveLength(4);
    expect(proposed(harness.frames[2]!).transaction.transactionId).toBe(
      changes[3]!.transactionId,
    );
    expect(proposed(harness.frames[3]!).transaction.transactionId).toBe(
      changes[4]!.transactionId,
    );

    editor.insertText({ blockId: secondBlockId, offset: 1, text: "E" });
    harness.publisher.submitFinalized(changes[5]!);
    const typeChange: EditorSemanticChange = {
      kind: "block-graph",
      transactionId: "type-change:1",
      baseDocumentRevision: contentChange(changes[5]!).documentRevision,
      documentRevision: contentChange(changes[5]!).documentRevision + 1,
      selectionBefore: changes[5]!.selectionAfter,
      selectionAfter: changes[5]!.selectionAfter,
      historyAction: "command",
      changedBlockIds: [firstBlockId],
      deletedBlockIds: [],
      change: {
        kind: "block-graph",
        blockId: firstBlockId,
        changes: [
          { kind: "change-type", blockId: firstBlockId, blockType: "heading" },
        ],
      },
      graphChanges: [
        { kind: "change-type", blockId: firstBlockId, blockType: "heading" },
      ],
      contentChanges: [],
    };
    harness.publisher.submitFinalized(typeChange);
    acceptSentRecords(harness.publisher, harness.frames);
    expect(harness.frames).toHaveLength(6);
    expect(proposed(harness.frames[5]!).transaction.graph?.changes).toContainEqual({
      kind: "change-type",
      blockId: firstBlockId,
      blockType: "heading",
    });
    harness.publisher.dispose();
    editor.dispose();
  });

  it("keeps formatting, entities, replacements, paste-like inserts, metadata, undo, and redo standalone", () => {
    const harness = createHarness();
    const { editor, changes } = editorWithChanges();
    editor.insertText({ blockId: firstBlockId, offset: 0, text: "X" });
    const source = contentChange(changes[0]!);
    const operationVariants = [
      {
        kind: "addInlineMark",
        blockId: firstBlockId,
        blockType: "paragraph",
        target: { kind: "text" },
        range: {
          from: { blockId: firstBlockId, offset: 0 },
          to: { blockId: firstBlockId, offset: 1 },
        },
        markName: "strong",
      },
      {
        kind: "setInlineEntity",
        blockId: firstBlockId,
        blockType: "paragraph",
        target: { kind: "text" },
        range: {
          from: { blockId: firstBlockId, offset: 0 },
          to: { blockId: firstBlockId, offset: 1 },
        },
        entity: { type: "mention", attrs: { id: "one" } },
      },
      {
        kind: "replaceInlineRange",
        blockId: firstBlockId,
        blockType: "paragraph",
        target: { kind: "text" },
        range: {
          from: { blockId: firstBlockId, offset: 0 },
          to: { blockId: firstBlockId, offset: 1 },
        },
        content: [{ type: "text", text: "Y" }],
      },
      {
        kind: "insertInlineContent",
        blockId: firstBlockId,
        blockType: "paragraph",
        target: { kind: "text" },
        position: { blockId: firstBlockId, offset: 1 },
        content: [{ type: "text", text: "PASTE" }],
      },
    ] as const;
    for (const [index, operation] of operationVariants.entries()) {
      harness.publisher.submitFinalized({
        ...source,
        transactionId: `atomic:${index}`,
        operations: [operation],
      } as EditorSemanticChange);
    }
    acceptSentRecords(harness.publisher, harness.frames);
    expect(harness.frames).toHaveLength(operationVariants.length);

    editor.updateBlockMetadata([
      { blockId: asBlockId("fd-check-unchecked"), values: { checked: true } },
    ]);
    harness.publisher.submitFinalized(changes[1]!);
    editor.undo();
    harness.publisher.submitFinalized(changes[2]!);
    editor.redo();
    harness.publisher.submitFinalized(changes[3]!);
    acceptSentRecords(harness.publisher, harness.frames);
    expect(
      harness.frames.slice(-3).map((frame) => proposed(frame).transaction.historyAction),
    ).toEqual(["command", "undo", "redo"]);
    expect(harness.publisher.getSnapshot().pendingEntries).toBe(0);
    harness.publisher.dispose();
    editor.dispose();
  });

  it("suppresses selection on transaction encoding or send failure and reports both", () => {
    const { editor, changes } = editorWithChanges();
    editor.insertText({ blockId: firstBlockId, offset: 0, text: "E" });
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const encoding = createHarness();
    encoding.publisher.submitFinalized({
      ...contentChange(changes[0]!),
      transactionId: "encoding-failure",
      operations: [
        {
          kind: "insertInlineContent",
          blockId: firstBlockId,
          blockType: "paragraph",
          target: { kind: "text" },
          position: { blockId: firstBlockId, offset: 0 },
          content: [{ type: "text", text: "PASTE" }],
        },
      ],
      readProjection: circular as unknown as RichTextDocumentNodeJson,
    });
    expect(encoding.frames).toHaveLength(0);
    expect(encoding.selection).not.toHaveBeenCalled();
    expect(encoding.errors).toHaveBeenCalledOnce();
    expect(encoding.publisher.getSnapshot().outstanding).toEqual([
      expect.objectContaining({
        transactionId: "encoding-failure",
        state: "terminal-failure",
        sourceTransactionIds: ["encoding-failure"],
        hasSemanticTransaction: true,
      }),
    ]);

    const sendError = new Error("send failed");
    const sending = createHarness({
      send: () => {
        throw sendError;
      },
    });
    sending.publisher.submitFinalized(changes[0]!);
    sending.publisher.flush("manual");
    expect(sending.selection).not.toHaveBeenCalled();
    expect(sending.errors).toHaveBeenCalledWith(sendError);
    expect(sending.publisher.getSnapshot().outstanding[0]).toMatchObject({
      transactionId: changes[0]!.transactionId,
      state: "retryable-failure",
    });
    encoding.publisher.dispose();
    sending.publisher.dispose();
    editor.dispose();
  });

  it("seals on disconnect, waits for catch-up, and retries identical identity and bytes", () => {
    vi.useFakeTimers();
    const firstFrames: ArrayBuffer[] = [];
    const publisher = createFirstDraftOutboundPublisher();
    const firstAllocator = vi.fn(sequentialIds("first-aggregate"));
    publisher.attachGeneration({
      generationId: "generation:1",
      socket: { readyState: 1, send: (frame) => firstFrames.push(frame) },
      createTransactionId: firstAllocator,
      publishSelection: vi.fn(),
    });
    publisher.generationCaughtUp();
    const { editor, changes } = editorWithChanges();
    insertCharacters(editor, "AB");
    publisher.submitFinalized(changes[0]!);
    publisher.submitFinalized(changes[1]!);
    expect(vi.getTimerCount()).toBe(2);

    publisher.detachGeneration({ attemptSend: false });
    expect(vi.getTimerCount()).toBe(0);
    expect(firstFrames).toHaveLength(0);
    expect(publisher.getSnapshot()).toMatchObject({
      pendingEntries: 0,
      outstanding: [
        {
          transactionId: "first-aggregate:1",
          state: "sealed",
          lastSentGeneration: null,
        },
      ],
    });
    expect(() => publisher.assertResynchronizationSafe()).toThrow(
      "acceptance is unresolved",
    );

    const secondFrames: ArrayBuffer[] = [];
    const secondAllocator = vi.fn(sequentialIds("second-aggregate"));
    publisher.attachGeneration({
      generationId: "generation:2",
      socket: { readyState: 1, send: (frame) => secondFrames.push(frame) },
      createTransactionId: secondAllocator,
      publishSelection: vi.fn(),
    });
    expect(secondFrames).toHaveLength(0);
    publisher.generationCaughtUp();
    expect(secondFrames).toHaveLength(1);
    const firstRetry = new Uint8Array(secondFrames[0]!);
    expect(secondAllocator).not.toHaveBeenCalled();

    publisher.detachGeneration({ attemptSend: false });
    const thirdFrames: ArrayBuffer[] = [];
    publisher.attachGeneration({
      generationId: "generation:3",
      socket: { readyState: 1, send: (frame) => thirdFrames.push(frame) },
      createTransactionId: sequentialIds("third-aggregate"),
      publishSelection: vi.fn(),
    });
    expect(thirdFrames).toHaveLength(0);
    publisher.generationCaughtUp();
    expect([...new Uint8Array(thirdFrames[0]!) ]).toEqual([...firstRetry]);
    expect(proposed(thirdFrames[0]!).transaction.transactionId).toBe(
      "first-aggregate:1",
    );

    publisher.acceptLocal({
      type: "editor-transaction-accepted",
      documentId: "document-one",
      transactionId: "first-aggregate:1",
      baseRevision: 0,
      revision: 1,
      acceptedAt: 1,
    }, 0);
    expect(publisher.getSnapshot().outstanding).toHaveLength(0);
    expect(publisher.getSnapshot().acceptedLocalTransactionIds).toEqual([
      "first-aggregate:1",
    ]);
    expect(
      publisher
        .getSnapshot()
        .acceptedLocalTransactionIds.some((id) =>
          changes.some(({ transactionId }) => transactionId === id),
        ),
    ).toBe(false);
    publisher.dispose();
    editor.dispose();
  });

  it("retains retryable and terminal persistence failures without replacing identity", () => {
    const harness = createHarness();
    const { editor, changes } = editorWithChanges();
    editor.insertText({ blockId: firstBlockId, offset: 0, text: "F" });
    harness.publisher.submitFinalized(changes[0]!);
    harness.publisher.flush("manual");
    const sentTransaction = proposed(harness.frames[0]!).transaction;
    const transactionId = sentTransaction.transactionId;
    expect(() =>
      harness.publisher.classifyReplay(
        replay({ ...sentTransaction, historyAction: "undo" }),
        0,
      ),
    ).toThrow("conflicts with the outbox");

    harness.publisher.persistenceFailed({
      type: "editor-transaction-persistence-failed",
      documentId: "document-one",
      transactionId,
      reason: "unavailable",
      retryable: true,
      message: "try later",
    });
    expect(harness.publisher.getSnapshot().outstanding[0]).toMatchObject({
      transactionId,
      state: "retryable-failure",
    });

    harness.publisher.detachGeneration({ attemptSend: false });
    const retryFrames: ArrayBuffer[] = [];
    harness.publisher.attachGeneration({
      generationId: "generation:retry",
      socket: { readyState: 1, send: (frame) => retryFrames.push(frame) },
      createTransactionId: sequentialIds("unused"),
      publishSelection: vi.fn(),
      onError: harness.errors,
    });
    harness.publisher.generationCaughtUp();
    expect(retryFrames).toHaveLength(1);
    expect(proposed(retryFrames[0]!).transaction.transactionId).toBe(transactionId);

    harness.publisher.persistenceFailed({
      type: "editor-transaction-persistence-failed",
      documentId: "document-one",
      transactionId,
      reason: "integrity",
      retryable: false,
      message: "rejected permanently",
    });
    expect(harness.publisher.getSnapshot().outstanding[0]).toMatchObject({
      transactionId,
      state: "terminal-failure",
      failure: expect.stringContaining("rejected permanently"),
    });
    expect(harness.errors).toHaveBeenCalled();
    expect(() =>
      harness.publisher.acceptLocal({
        type: "editor-transaction-accepted",
        documentId: "document-one",
        transactionId: "unknown-id",
        baseRevision: 1,
        revision: 2,
        acceptedAt: 2,
      }, 1),
    ).toThrow("active outbox head");
    harness.publisher.dispose();
    editor.dispose();
  });

  it("never continues an old generation accumulator on a replacement generation", () => {
    const firstFrames: ArrayBuffer[] = [];
    const publisher = createFirstDraftOutboundPublisher();
    publisher.attachGeneration({
      generationId: "generation:old",
      socket: { readyState: 1, send: (frame) => firstFrames.push(frame) },
      createTransactionId: sequentialIds("old-aggregate"),
      publishSelection: vi.fn(),
    });
    publisher.generationCaughtUp();
    const { editor, changes } = editorWithChanges();
    insertCharacters(editor, "ABC");
    publisher.submitFinalized(changes[0]!);
    publisher.submitFinalized(changes[1]!);

    publisher.attachGeneration({
      generationId: "generation:new",
      socket: { readyState: 1, send: vi.fn() },
      createTransactionId: sequentialIds("new-aggregate"),
      publishSelection: vi.fn(),
    });
    expect(firstFrames).toHaveLength(1);
    publisher.submitFinalized(changes[2]!);
    expect(publisher.getSnapshot()).toMatchObject({
      attachedGeneration: "generation:new",
      pendingEntries: 1,
      pendingSourceTransactionIds: [changes[2]!.transactionId],
      outstanding: [
        {
          transactionId: "old-aggregate:1",
          sourceTransactionIds: [
            changes[0]!.transactionId,
            changes[1]!.transactionId,
          ],
        },
      ],
    });
    publisher.dispose();
    editor.dispose();
  });

  it("refreshes projection and rebased selection after compatible remote interleaving without changing local bytes", () => {
    const harness = createHarness();
    const local = editorWithChanges();
    const remote = editorWithChanges();
    insertCharacters(local.editor, "AB");
    harness.publisher.submitFinalized(local.changes[0]!);
    harness.publisher.submitFinalized(local.changes[1]!);
    const expectedLocalBytes = mergeUpdates(
      local.changes.map((change) => contentChange(change).yjsUpdate.payload.copy()),
    );

    remote.editor.insertText({ blockId: firstBlockId, offset: 0, text: "R" });
    const remoteTransaction = convertEditorTransactionToTransport(
      remote.changes[0]!,
    );
    const result = local.editor.applyRemoteTransaction({
      transaction: remoteTransaction,
      authorSelection: { kind: "no-author-selection" },
    });
    if (result.status !== "applied") throw new Error(result.message);
    const expectedSelection = projectTransactionSelectionToStable(
      projectCanonicalSelectionToTransaction(local.editor.selection.getSnapshot()),
    );
    harness.publisher.remoteApplied(replay(remoteTransaction), result, local.editor);
    expect(harness.publisher.getSnapshot().pendingEntries).toBe(2);

    harness.publisher.flush("manual");
    const aggregate = proposed(harness.frames[0]!).transaction;
    expect(
      aggregate.content[0]!.update.payload.equalsBytes(expectedLocalBytes),
    ).toBe(true);
    expect(aggregate.content[0]!.readProjection).toEqual(
      local.editor.readBlockContent(firstBlockId, "paragraph"),
    );
    expect(harness.selection).toHaveBeenCalledWith(
      expectedSelection,
      aggregate.transactionId,
    );
    expect(
      remote.editor.applyRemoteTransaction({
        transaction: aggregate,
        authorSelection: { kind: "no-author-selection" },
      }),
    ).toMatchObject({ status: "applied" });
    expect(remote.editor.readBlockPlainText(firstBlockId, "paragraph")).toBe(
      local.editor.readBlockPlainText(firstBlockId, "paragraph"),
    );
    harness.publisher.dispose();
    local.editor.dispose();
    remote.editor.dispose();
  });

  it("leaves another-block remote content pending, but flushes after remote metadata", () => {
    const harness = createHarness();
    const local = editorWithChanges();
    const remote = editorWithChanges();
    local.editor.insertText({ blockId: firstBlockId, offset: 0, text: "L" });
    harness.publisher.submitFinalized(local.changes[0]!);

    remote.editor.insertText({ blockId: secondBlockId, offset: 0, text: "R" });
    const otherBlock = convertEditorTransactionToTransport(remote.changes[0]!);
    const otherResult = local.editor.applyRemoteTransaction({
      transaction: otherBlock,
      authorSelection: { kind: "no-author-selection" },
    });
    if (otherResult.status !== "applied") throw new Error(otherResult.message);
    harness.publisher.remoteApplied(replay(otherBlock), otherResult, local.editor);
    expect(harness.frames).toHaveLength(0);
    expect(harness.publisher.getSnapshot().pendingEntries).toBe(1);

    remote.editor.updateBlockMetadata([
      { blockId: asBlockId("fd-check-unchecked"), values: { checked: true } },
    ]);
    const metadata = convertEditorTransactionToTransport(remote.changes[1]!);
    const metadataResult = local.editor.applyRemoteTransaction({
      transaction: metadata,
      authorSelection: { kind: "no-author-selection" },
    });
    if (metadataResult.status !== "applied") throw new Error(metadataResult.message);
    harness.publisher.remoteApplied(replay(metadata), metadataResult, local.editor);
    expect(harness.frames).toHaveLength(1);
    expect(harness.publisher.getSnapshot().pendingEntries).toBe(0);
    harness.publisher.dispose();
    local.editor.dispose();
    remote.editor.dispose();
  });

  it.each([
    { name: "deletes", block: null },
    {
      name: "changes the type of",
      block: { id: firstBlockId, type: "heading" as const, tombstone: null },
    },
  ])("retains a terminal queued record when a remote change $name its block", ({ block }) => {
    const harness = createHarness();
    const local = editorWithChanges();
    local.editor.insertText({ blockId: firstBlockId, offset: 0, text: "L" });
    harness.publisher.submitFinalized(local.changes[0]!);
    const remoteTransaction = {
      ...convertEditorTransactionToTransport(local.changes[0]!),
      transactionId: "remote-delete",
    };
    harness.publisher.remoteApplied(
      replay(remoteTransaction),
      {
        status: "applied",
        changedBlockIds: [firstBlockId],
        authorSelection: { status: "ignored-no-author" },
      },
      {
        getBlock: () => block,
        readBlockContent: () => null,
        selection: local.editor.selection,
      },
    );
    expect(harness.errors).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("invalidated") }),
    );
    expect(harness.publisher.getSnapshot()).toMatchObject({
      pendingEntries: 1,
      pendingFailure: expect.stringContaining("invalidated"),
    });
    harness.publisher.flush("manual");
    expect(harness.frames).toHaveLength(0);
    expect(harness.publisher.getSnapshot().outstanding[0]).toMatchObject({
      state: "terminal-failure",
      sourceTransactionIds: [local.changes[0]!.transactionId],
    });
    harness.publisher.dispose();
    local.editor.dispose();
  });

  it("uses the First Draft atomic boundary once, including for one-character operations", () => {
    const harness = createHarness();
    const { editor, changes } = editorWithChanges();
    insertCharacters(editor, "ABCD");
    harness.publisher.submitFinalized(changes[0]!);
    const clearPaste = harness.publisher.beginAtomicOperation();
    expect(harness.frames).toHaveLength(1);
    harness.publisher.submitFinalized(changes[1]!);
    acceptSentRecords(harness.publisher, harness.frames);
    expect(harness.frames).toHaveLength(2);
    expect(proposed(harness.frames[1]!).transaction.transactionId).toBe(
      changes[1]!.transactionId,
    );
    clearPaste();

    const clearNoOpCut = harness.publisher.beginAtomicOperation();
    clearNoOpCut();
    harness.publisher.submitFinalized(changes[2]!);
    expect(harness.frames).toHaveLength(2);
    expect(harness.publisher.getSnapshot().pendingEntries).toBe(1);
    const clearCut = harness.publisher.beginAtomicOperation();
    acceptSentRecords(harness.publisher, harness.frames);
    expect(harness.frames).toHaveLength(3);
    harness.publisher.submitFinalized(changes[3]!);
    acceptSentRecords(harness.publisher, harness.frames);
    expect(harness.frames).toHaveLength(4);
    expect(proposed(harness.frames[3]!).transaction.transactionId).toBe(
      changes[3]!.transactionId,
    );
    clearCut();
    harness.publisher.dispose();
    editor.dispose();
  });

  it("resolves a canonical own replay by semantic proposal identity and ignores an exact later acceptance", () => {
    const harness = createHarness();
    const { editor, changes } = editorWithChanges();
    editor.insertText({ blockId: firstBlockId, offset: 0, text: "S" });
    harness.publisher.submitFinalized(changes[0]!);
    harness.publisher.flush("manual");
    const proposedTransaction = proposed(harness.frames[0]!).transaction;
    const canonicalTransaction: EditorTransportTransaction = {
      ...proposedTransaction,
      content: proposedTransaction.content.map((entry) => ({
        ...entry,
        readProjection: {
          type: "doc",
          content: [{ type: "paragraph", content: [{ type: "text", text: "canonical" }] }],
        },
      })),
    };
    expect(
      harness.publisher.classifyReplay(replay(canonicalTransaction), 0),
    ).toBe("local-outstanding");
    expect(harness.publisher.getSnapshot().outstanding).toHaveLength(0);
    expect(
      harness.publisher.acceptLocal(
        {
          type: "editor-transaction-accepted",
          documentId: "document-one",
          transactionId: proposedTransaction.transactionId,
          baseRevision: 0,
          revision: 1,
          acceptedAt: 99,
        },
        1,
      ),
    ).toBe("duplicate-local-acceptance");
    harness.publisher.dispose();
    editor.dispose();
  });

  it("keeps strict canonical equality for duplicate remote accepted replay", () => {
    const harness = createHarness();
    const { editor, changes } = editorWithChanges();
    editor.insertText({ blockId: firstBlockId, offset: 0, text: "R" });
    const transaction = convertEditorTransactionToTransport(changes[0]!);
    const accepted = replay({ ...transaction, transactionId: "remote:strict" });
    harness.publisher.remoteApplied(
      accepted,
      {
        status: "applied",
        changedBlockIds: [firstBlockId],
        authorSelection: { status: "ignored-no-author" },
      },
      editor,
    );
    expect(() =>
      harness.publisher.classifyReplay(
        {
          ...accepted,
          transaction: {
            ...accepted.transaction,
            content: accepted.transaction.content.map((entry) => ({
              ...entry,
              readProjection: { type: "doc", content: [] },
            })),
          },
        },
        1,
      ),
    ).toThrow("conflicts with applied history");
    harness.publisher.dispose();
    editor.dispose();
  });

  it("blocks later records behind a retryable head and retries the exact frame before pumping the next", () => {
    const harness = createHarness();
    const { editor, changes } = editorWithChanges();
    insertCharacters(editor, "AB");
    const createdBlockId = asBlockId("ordered-created-block");
    const selection = changes[0]!.selectionAfter;
    const graphCreate: EditorSemanticChange = {
      kind: "block-graph",
      transactionId: "ordered:0",
      baseDocumentRevision: 0,
      documentRevision: 1,
      selectionBefore: selection,
      selectionAfter: selection,
      historyAction: "command",
      changedBlockIds: [createdBlockId],
      deletedBlockIds: [],
      change: {
        kind: "block-graph",
        blockId: createdBlockId,
        changes: [
          {
            kind: "create",
            blockId: createdBlockId,
            blockType: "paragraph",
            placement: {
              parentId: null,
              previousSiblingId: firstBlockId,
              nextSiblingId: secondBlockId,
            },
          },
        ],
      },
      graphChanges: [
        {
          kind: "create",
          blockId: createdBlockId,
          blockType: "paragraph",
          placement: {
            parentId: null,
            previousSiblingId: firstBlockId,
            nextSiblingId: secondBlockId,
          },
        },
      ],
      contentChanges: [],
    };
    const dependentContent = {
      ...contentChange(changes[1]!),
      transactionId: "ordered:1",
      blockId: createdBlockId,
    };
    for (const change of [graphCreate, dependentContent]) {
      harness.publisher.beginAtomicOperation();
      harness.publisher.submitFinalized(change);
    }
    expect(harness.frames).toHaveLength(1);
    expect(proposed(harness.frames[0]!).transaction.graph?.changes).toContainEqual(
      expect.objectContaining({ kind: "create", blockId: createdBlockId }),
    );
    const firstFrame = new Uint8Array(harness.frames[0]!).slice();
    harness.publisher.persistenceFailed({
      type: "editor-transaction-persistence-failed",
      documentId: "document-one",
      transactionId: "ordered:0",
      reason: "unavailable",
      retryable: true,
      message: "retry",
    });
    expect(harness.publisher.getSnapshot().outstanding.map(({ state }) => state)).toEqual([
      "retryable-failure",
      "sealed",
    ]);
    expect(() => harness.publisher.submitFinalized(changes[0]!)).toThrow(
      "queue is blocked",
    );

    harness.publisher.detachGeneration({ attemptSend: false });
    const retryFrames: ArrayBuffer[] = [];
    harness.publisher.attachGeneration({
      generationId: "ordered:retry",
      socket: { readyState: 1, send: (frame) => retryFrames.push(frame) },
      createTransactionId: sequentialIds("unused"),
      publishSelection: vi.fn(),
    });
    harness.publisher.generationCaughtUp();
    expect([...new Uint8Array(retryFrames[0]!)]).toEqual([...firstFrame]);
    harness.publisher.acceptLocal(
      {
        type: "editor-transaction-accepted",
        documentId: "document-one",
        transactionId: "ordered:0",
        baseRevision: 0,
        revision: 1,
        acceptedAt: 1,
      },
      0,
    );
    expect(retryFrames).toHaveLength(2);
    expect(proposed(retryFrames[1]!).transaction).toMatchObject({
      transactionId: "ordered:1",
      content: [{ blockId: createdBlockId }],
    });
    harness.publisher.dispose();
    editor.dispose();
  });

  it("retains complete terminal records and one stable aggregate identity through encoding failure", () => {
    const allocator = vi.fn(sequentialIds("stable-aggregate"));
    const frames: ArrayBuffer[] = [];
    const errors = vi.fn();
    const publisher = createFirstDraftOutboundPublisher();
    publisher.attachGeneration({
      generationId: "encoding-stability",
      socket: { readyState: 1, send: (frame) => frames.push(frame) },
      createTransactionId: allocator,
      publishSelection: vi.fn(),
      onError: errors,
    });
    publisher.generationCaughtUp();
    const { editor, changes } = editorWithChanges();
    insertCharacters(editor, "AB");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    publisher.submitFinalized(changes[0]!);
    publisher.submitFinalized({
      ...contentChange(changes[1]!),
      readProjection: circular as unknown as RichTextDocumentNodeJson,
    });
    publisher.flush("manual");
    publisher.flush("manual");
    expect(allocator).toHaveBeenCalledOnce();
    expect(frames).toHaveLength(0);
    expect(publisher.getSnapshot().outstanding).toEqual([
      expect.objectContaining({
        transactionId: "stable-aggregate:1",
        state: "terminal-failure",
        hasSemanticTransaction: true,
        sourceTransactionIds: [changes[0]!.transactionId, changes[1]!.transactionId],
      }),
    ]);
    expect(errors).toHaveBeenCalledOnce();
    publisher.dispose();
    editor.dispose();
  });

  it("enforces the active-record and final encoded-frame bounds with one retained overflow", () => {
    const { editor, changes } = editorWithChanges();
    insertCharacters(editor, "ABC");
    const harness = createHarness({
      limits: {
        maxActiveRecords: 2,
        maxRetainedEncodedBytes: 1_024 * 1_024,
      },
    });
    for (const [index, change] of changes.entries()) {
      harness.publisher.beginAtomicOperation();
      harness.publisher.submitFinalized({ ...change, transactionId: `capacity:${index}` });
    }
    expect(harness.publisher.getSnapshot().outstanding).toHaveLength(3);
    expect(harness.publisher.getSnapshot().outstanding[2]).toMatchObject({
      transactionId: "capacity:2",
      state: "terminal-failure",
      hasSemanticTransaction: true,
    });

    const oversized = createHarness({ limits: { maxClientFrameBytes: 1_024 } });
    oversized.publisher.beginAtomicOperation();
    oversized.publisher.submitFinalized({
      ...contentChange(changes[0]!),
      transactionId: "large-projection",
      readProjection: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "x".repeat(4_096) }],
          },
        ],
      },
    });
    expect(oversized.frames).toHaveLength(0);
    expect(oversized.publisher.getSnapshot().outstanding[0]).toMatchObject({
      transactionId: "large-projection",
      state: "terminal-failure",
      hasSemanticTransaction: true,
      encodedBytes: expect.any(Number),
    });
    harness.publisher.dispose();
    oversized.publisher.dispose();
    editor.dispose();
  });

  it("accepts the exact retained-frame byte capacity and retains one terminal overflow record", () => {
    const { editor, changes } = editorWithChanges();
    insertCharacters(editor, "ABC");
    const standaloneChanges = changes.map((change, index) => ({
      ...change,
      transactionId: `retained:${index}`,
    }));
    const frameBytes = standaloneChanges.map((change) =>
      encodeFirstDraftMessage({
        type: "proposed-editor-transaction",
        transaction: convertEditorTransactionToTransport(change),
      }).byteLength,
    );
    const harness = createHarness({
      limits: {
        maxActiveRecords: 8,
        maxRetainedEncodedBytes: frameBytes[0]! + frameBytes[1]!,
      },
    });
    for (const change of standaloneChanges.slice(0, 2)) {
      harness.publisher.beginAtomicOperation();
      harness.publisher.submitFinalized(change);
    }
    expect(harness.publisher.getSnapshot()).toMatchObject({
      activeRecordCount: 2,
      retainedEncodedBytes: frameBytes[0]! + frameBytes[1]!,
    });

    harness.publisher.beginAtomicOperation();
    harness.publisher.submitFinalized(standaloneChanges[2]!);
    expect(harness.publisher.getSnapshot()).toMatchObject({
      activeRecordCount: 3,
      retainedEncodedBytes: frameBytes.reduce((total, bytes) => total + bytes, 0),
      outstanding: [
        expect.anything(),
        expect.anything(),
        expect.objectContaining({
          transactionId: "retained:2",
          state: "terminal-failure",
          encodedBytes: frameBytes[2],
        }),
      ],
    });
    harness.publisher.dispose();
    editor.dispose();
  });

  it("clears timers on disposal and clearly rejects duplicate or late submissions", () => {
    vi.useFakeTimers();
    const harness = createHarness();
    const { editor, changes } = editorWithChanges();
    editor.insertText({ blockId: firstBlockId, offset: 0, text: "D" });
    harness.publisher.submitFinalized(changes[0]!);
    expect(vi.getTimerCount()).toBe(2);
    expect(() => harness.publisher.submitFinalized(changes[0]!)).toThrow(
      "submitted more than once",
    );
    harness.publisher.dispose();
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.publisher.getSnapshot()).toMatchObject({
      disposed: true,
      pendingEntries: 0,
    });
    expect(() => harness.publisher.submitFinalized(changes[0]!)).toThrow(
      "disposed First Draft outbound publisher",
    );
    vi.advanceTimersByTime(1_000);
    expect(harness.frames).toHaveLength(1);
    editor.dispose();
  });

  it("bounds accepted and recent source diagnostics while releasing active ownership", () => {
    const harness = createHarness();
    const { editor, changes } = editorWithChanges();
    insertCharacters(editor, "A");
    const source = contentChange(changes[0]!);
    for (let index = 0; index < 2_050; index += 1) {
      const transactionId = `bounded-diagnostic:${index}`;
      harness.publisher.beginAtomicOperation();
      harness.publisher.submitFinalized({ ...source, transactionId });
      harness.publisher.acceptLocal(
        {
          type: "editor-transaction-accepted",
          documentId: "document-one",
          transactionId,
          baseRevision: index,
          revision: index + 1,
          acceptedAt: index + 1,
        },
        index,
      );
    }
    const snapshot = harness.publisher.getSnapshot();
    expect(snapshot.activeRecordCount).toBe(0);
    expect(snapshot.retainedEncodedBytes).toBe(0);
    expect(snapshot.acceptedLocalTransactionIds).toHaveLength(2_048);
    expect(snapshot.acceptedLocalTransactionIds).not.toContain(
      "bounded-diagnostic:0",
    );
    expect(snapshot.acceptedLocalTransactionIds.at(-1)).toBe(
      "bounded-diagnostic:2049",
    );
    harness.publisher.dispose();
    editor.dispose();
  });
});

function createHarness(
  input: {
    readonly limits?: FirstDraftOutboundPublisherOptions["limits"];
    readonly send?: (frame: ArrayBuffer) => void;
  } = {},
) {
  const frames: ArrayBuffer[] = [];
  const socket = {
    readyState: 1,
    send: input.send ?? ((frame: ArrayBuffer) => frames.push(frame)),
  };
  const selection = vi.fn();
  const errors = vi.fn();
  const publisher = createFirstDraftOutboundPublisher({
    ...(input.limits ? { limits: input.limits } : {}),
  });
  publisher.attachGeneration({
    generationId: "generation:1",
    socket,
    createTransactionId: sequentialIds("aggregate"),
    publishSelection: selection,
    onError: errors,
  });
  publisher.generationCaughtUp();
  return { publisher, socket, frames, selection, errors };
}

function editorWithChanges() {
  const changes: EditorSemanticChange[] = [];
  return { editor: createEditor((change) => changes.push(change)), changes };
}

function createEditor(onChange?: (change: EditorSemanticChange) => void) {
  return initializeEditableEditor({
    definition: createFirstDraftEditorDefinition(createFirstDraftViewStateStore()),
    snapshot: createFirstDraftSnapshot(),
    onChange,
    createTransactionId: sequentialIds("source"),
  });
}

function insertCharacters(editor: ReturnType<typeof createEditor>, text: string) {
  for (const [offset, character] of Array.from(text).entries()) {
    expect(editor.insertText({ blockId: firstBlockId, offset, text: character })).toBe(
      true,
    );
  }
}

function contentChange(change: EditorSemanticChange) {
  if (change.kind !== "block-content") throw new Error("Expected content change");
  return change;
}

function proposed(frame: ArrayBuffer): ProposedEditorTransactionMessage {
  const decoded = decodeFirstDraftMessage(frame);
  if (!decoded.ok) throw new Error(decoded.error);
  if (decoded.message.type !== "proposed-editor-transaction") {
    throw new Error("Expected proposed transaction");
  }
  return decoded.message;
}

function replay(transaction: EditorTransportTransaction, revision = 1) {
  return {
    type: "first-draft-accepted-transaction-replay" as const,
    documentId: "document-one",
    transactionId: transaction.transactionId,
    baseRevision: revision - 1,
    revision,
    acceptedAt: revision,
    transaction,
  };
}

function acceptSentRecords(
  publisher: FirstDraftOutboundPublisher,
  frames: readonly ArrayBuffer[],
): void {
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
  expect(frames.length).toBeGreaterThanOrEqual(revision);
}

function sequentialIds(prefix: string): () => string {
  let sequence = 0;
  return () => `${prefix}:${++sequence}`;
}
