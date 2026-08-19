import { once } from "node:events";
import { extractPlainTextFromRichTextDocument } from "@repo/editor-core/content/rich-text";
import { asBlockId } from "@repo/editor-core/kernel";
import {
  createFirstDraftEditorDefinition,
  createFirstDraftViewStateStore,
} from "@repo/editor-first-draft/definition";
import { createFirstDraftSnapshot } from "@repo/editor-first-draft/fixture";
import { createFirstDraftBootstrapFromSnapshot } from "@repo/editor-first-draft/read-model";
import {
  createFirstDraftMessageDispatcher,
  decodeFirstDraftMessage,
  encodeFirstDraftMessage,
  handleTransaction,
  attachFirstDraftRemoteTransactions,
  type EditorTransactionWebSocket,
  type FirstDraftMessage,
  type FirstDraftConnectionSocket,
  type FirstDraftSessionIdentity,
} from "@repo/editor-first-draft/transport";
import type { FirstDraftTransactionPersistence } from "@repo/editor-first-draft/server";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import { initializeEditableEditor as initializeCompiledEditor } from "@repo/editor-web/editor";
import {
  compileCanonicalEditorDefinition,
  type EditableEditorDefinition,
} from "@repo/editor-web/editor-definition";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import {
  EDITOR_SELECTION_PRESENCE_INACTIVITY_MS,
  startEditorRealtimeServer,
  type EditorRealtimeServer,
  type EditorRealtimeTimeoutScheduler,
} from "./server.ts";

const authenticationToken = "dev-editor-realtime-token";
const documentOne = "document-one";
const documentTwo = "document-two";
const textBlockId = asBlockId("fd-paragraph-intro");
const metadataBlockId = asBlockId("fd-check-unchecked");
const createdBlockId = asBlockId("phase-1-live-created-block");

function initializeEditableEditor(options: {
  readonly definition: ReturnType<typeof createFirstDraftEditorDefinition>;
  readonly snapshot: ReturnType<typeof createFirstDraftSnapshot>;
  readonly onChange?: Parameters<
    typeof initializeCompiledEditor
  >[0]["onChange"];
  readonly createTransactionId?: Parameters<
    typeof initializeCompiledEditor
  >[0]["createTransactionId"];
  readonly onContentRuntime?: (runtime: TestContentRuntime) => void;
}) {
  const definition = options.onContentRuntime
    ? captureDefinitionContentRuntime(
        options.definition,
        options.onContentRuntime,
      )
    : options.definition;
  return initializeCompiledEditor({
    compiledDefinition: compileCanonicalEditorDefinition(definition),
    snapshot: options.snapshot,
    onChange: options.onChange,
    createTransactionId: options.createTransactionId,
  });
}

describe("the sole editor realtime WebSocket service", () => {
  let server: EditorRealtimeServer | null = null;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      await closeSocket(socket);
    }
    await server?.close();
    server = null;
  });

  it("fails before listening when the canonical PostgreSQL schema is incompatible", async () => {
    const error = new Error(
      "First Draft PostgreSQL schema is incompatible:\nmissing public.editor_transactions.\nRun `pnpm db:reset:first-draft` for local development.",
    );
    const readiness = {
      assertReady: vi.fn(async () => Promise.reject(error)),
      checkReadiness: vi.fn(async () => ({
        ok: false,
        issues: [error.message],
      })),
    };

    await expect(
      startTestEditorRealtimeServer({
        config: testConfig(),
        persistence: acceptingPersistence(),
        readiness,
      }),
    ).rejects.toBe(error);
    expect(readiness.assertReady).toHaveBeenCalledOnce();
    expect(readiness.checkReadiness).not.toHaveBeenCalled();
  });

  it("reports PostgreSQL readiness independently from process liveness", async () => {
    const readiness = {
      assertReady: vi.fn(async () => undefined),
      checkReadiness: vi.fn(async () => ({
        ok: false,
        issues: ["PostgreSQL is unavailable."],
      })),
    };
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
      readiness,
    });

    await expect(fetch(`${server.url}/healthz`)).resolves.toMatchObject({
      status: 200,
    });
    const ready = await fetch(`${server.url}/readyz`);
    expect(ready.status).toBe(503);
    await expect(ready.json()).resolves.toMatchObject({
      ok: false,
      postgres: { ok: false, issues: ["PostgreSQL is unavailable."] },
    });
  });

  it("authenticates one binary session handshake and cleans up its document room", async () => {
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
    });
    const identity = session("member", documentOne);
    const socket = await connectSession(server, identity);
    sockets.push(socket);

    expect(server.documentSessionCount(documentOne)).toBe(1);
    const health = await fetch(`${server.url}/healthz`);
    await expect(health.json()).resolves.toMatchObject({
      ok: true,
      protocol: "first-draft",
      protocolVersion: 4,
    });
    const serverOnlyError = waitForMessage(
      socket,
      (message) => message.type === "first-draft-protocol-error",
    );
    socket.send(
      encodeFirstDraftMessage({
        type: "first-draft-session-connected",
        ...identity,
      }),
    );
    await expect(serverOnlyError).resolves.toMatchObject({
      code: "invalid-client-message",
      fatal: false,
    });

    await closeSocket(socket);
    await waitFor(() => server?.documentSessionCount(documentOne) === 0);
  });

  it("rejects unauthorized sessions and non-binary transaction messages", async () => {
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
    });
    const unauthorized = await openSocket(server);
    sockets.push(unauthorized);
    const unauthorizedError = waitForMessage(
      unauthorized,
      (message) => message.type === "first-draft-protocol-error",
    );
    unauthorized.send(
      encodeFirstDraftMessage({
        type: "connect-first-draft-session",
        authenticationToken: "wrong-token",
        ...session("unauthorized", documentOne),
      }),
    );
    await expect(unauthorizedError).resolves.toMatchObject({
      type: "first-draft-protocol-error",
      code: "unauthorized",
      fatal: true,
    });
    expect(server.documentSessionCount(documentOne)).toBe(0);

    const wrongDocument = await openSocket(server);
    sockets.push(wrongDocument);
    await authenticateSession(
      wrongDocument,
      session("wrong-document", documentOne),
    );
    const documentError = waitForMessage(
      wrongDocument,
      (message) => message.type === "first-draft-protocol-error",
    );
    wrongDocument.send(
      encodeFirstDraftMessage({
        type: "subscribe-first-draft-document",
        documentId: documentTwo,
      }),
    );
    await expect(documentError).resolves.toMatchObject({
      code: "unauthorized-document",
      fatal: false,
    });
    expect(server.documentSessionCount(documentTwo)).toBe(0);

    const invalidTextClient = await openSocket(server);
    sockets.push(invalidTextClient);
    const invalidTextError = waitForMessage(
      invalidTextClient,
      (message) => message.type === "first-draft-protocol-error",
    );
    invalidTextClient.send(
      JSON.stringify({
        type: "submit-transaction",
        documentId: documentOne,
        baseRevision: 0,
      }),
    );
    await expect(invalidTextError).resolves.toMatchObject({
      type: "first-draft-protocol-error",
      code: "binary-frame-required",
      fatal: true,
    });
  });

  it("maintains session-scoped participants, snapshots, stale-safe selections, and cleanup", async () => {
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
    });
    const identityA = session("presence-a", documentOne);
    const socketA = await connectSession(server, identityA);
    sockets.push(socketA);
    socketA.send(
      encodeFirstDraftMessage(participantMessage(identityA, 2, true)),
    );

    const identityB = session("presence-b", documentOne);
    const socketB = await openSocket(server);
    sockets.push(socketB);
    await authenticateSession(socketB, identityB);
    const [, participantSnapshot] = await subscribeSession(socketB, identityB);
    expect(participantSnapshot).toMatchObject({
      type: "first-draft-participant-snapshot",
      participants: [{ subject: subject(identityA), active: true }],
    });

    const joined = waitForMessage(
      socketA,
      (message) => message.type === "first-draft-participant-update",
    );
    socketB.send(
      encodeFirstDraftMessage(participantMessage(identityB, 0, true)),
    );
    await expect(joined).resolves.toMatchObject({
      subject: subject(identityB),
      active: true,
    });

    const staleParticipantSilence = expectNoMessage(
      socketB,
      (message) => message.type === "first-draft-participant-update",
      50,
    );
    socketA.send(
      encodeFirstDraftMessage(participantMessage(identityA, 1, false)),
    );
    await staleParticipantSilence;
    const participantConflict = waitForMessage(
      socketA,
      (message) => message.type === "first-draft-protocol-error",
    );
    const participantConflictSilence = expectNoMessage(
      socketB,
      (message) => message.type === "first-draft-participant-update",
      50,
    );
    socketA.send(
      encodeFirstDraftMessage(participantMessage(identityA, 2, false)),
    );
    await expect(participantConflict).resolves.toMatchObject({
      code: "presence-revision-conflict",
    });
    await participantConflictSilence;

    const selection = blockSelection();
    const newest = waitForMessage(
      socketB,
      (message) => message.type === "first-draft-selection-update",
    );
    socketA.send(
      encodeFirstDraftMessage(selectionMessage(identityA, 2, selection)),
    );
    await expect(newest).resolves.toMatchObject({
      selectionRevision: 2,
      selection,
    });
    const staleSilence = expectNoMessage(
      socketB,
      (message) => message.type === "first-draft-selection-update",
      50,
    );
    socketA.send(
      encodeFirstDraftMessage(selectionMessage(identityA, 1, { kind: "none" })),
    );
    await staleSilence;
    const selectionConflict = waitForMessage(
      socketA,
      (message) => message.type === "first-draft-protocol-error",
    );
    const selectionConflictSilence = expectNoMessage(
      socketB,
      (message) => message.type === "first-draft-selection-update",
      50,
    );
    socketA.send(
      encodeFirstDraftMessage(selectionMessage(identityA, 2, { kind: "none" })),
    );
    await expect(selectionConflict).resolves.toMatchObject({
      code: "selection-revision-conflict",
    });
    await selectionConflictSilence;

    const left = waitForMessage(
      socketB,
      (message) =>
        message.type === "first-draft-participant-update" && !message.active,
    );
    const cleared = waitForMessage(
      socketB,
      (message) => message.type === "first-draft-selection-snapshot",
    );
    await closeSocket(socketA);
    await expect(left).resolves.toMatchObject({
      subject: subject(identityA),
      active: false,
    });
    await expect(cleared).resolves.toMatchObject({ selections: [] });
    expect(server.documentSessionCount(documentOne)).toBe(1);
  });

  it("expires unchanged selection presence at 30 seconds without expiring its participant", async () => {
    const scheduler = manualTimeoutScheduler();
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
      selectionPresenceScheduler: scheduler,
    });
    const identityA = session("lease-a", documentOne);
    const identityB = session("lease-b", documentOne);
    const socketA = await connectSession(server, identityA);
    const socketB = await connectSession(server, identityB);
    sockets.push(socketA, socketB);
    socketA.send(
      encodeFirstDraftMessage(participantMessage(identityA, 0, true)),
    );
    const initial = waitForMessage(
      socketB,
      (message) => message.type === "first-draft-selection-update",
    );
    socketA.send(
      encodeFirstDraftMessage(selectionMessage(identityA, 0, blockSelection())),
    );
    await initial;
    expect(scheduler.pendingCount()).toBe(1);

    scheduler.advanceBy(10_000);
    const identical = waitForMessage(
      socketB,
      (message) =>
        message.type === "first-draft-selection-update" &&
        message.selectionRevision === 1,
    );
    socketA.send(
      encodeFirstDraftMessage(selectionMessage(identityA, 1, blockSelection())),
    );
    await identical;
    scheduler.advanceBy(19_999);
    const beforeExpiry = expectNoMessage(
      socketB,
      (message) => message.type === "first-draft-selection-snapshot",
      25,
    );
    await beforeExpiry;

    const expired = waitForMessage(
      socketB,
      (message) => message.type === "first-draft-selection-snapshot",
    );
    scheduler.advanceBy(1);
    await expect(expired).resolves.toMatchObject({ selections: [] });
    expect(scheduler.now()).toBe(EDITOR_SELECTION_PRESENCE_INACTIVITY_MS);
    expect(scheduler.pendingCount()).toBe(0);

    const identityC = session("lease-c", documentOne);
    const socketC = await openSocket(server);
    sockets.push(socketC);
    await authenticateSession(socketC, identityC);
    const [, participantSnapshot, expiredSelectionSnapshot] =
      await subscribeSession(socketC, identityC);
    expect(participantSnapshot).toMatchObject({
      participants: [
        expect.objectContaining({ subject: subject(identityA), active: true }),
      ],
    });
    expect(expiredSelectionSnapshot).toMatchObject({ selections: [] });
    expect(server.documentSessionCount(documentOne)).toBe(3);

    const identicalAfterExpiry = expectNoMessage(
      socketB,
      (message) =>
        message.type === "first-draft-selection-update" ||
        message.type === "first-draft-selection-snapshot",
      25,
    );
    socketA.send(
      encodeFirstDraftMessage(selectionMessage(identityA, 2, blockSelection())),
    );
    await identicalAfterExpiry;
    expect(scheduler.pendingCount()).toBe(0);

    const staleAfterExpiry = expectNoMessage(
      socketB,
      (message) =>
        message.type === "first-draft-selection-update" ||
        message.type === "first-draft-selection-snapshot",
      25,
    );
    socketA.send(
      encodeFirstDraftMessage(selectionMessage(identityA, 1, { kind: "none" })),
    );
    await staleAfterExpiry;
    const conflictAfterExpiry = waitForMessage(
      socketA,
      (message) =>
        message.type === "first-draft-protocol-error" &&
        message.code === "selection-revision-conflict",
    );
    const conflictSilence = expectNoMessage(
      socketB,
      (message) =>
        message.type === "first-draft-selection-update" ||
        message.type === "first-draft-selection-snapshot",
      25,
    );
    socketA.send(
      encodeFirstDraftMessage(selectionMessage(identityA, 2, { kind: "none" })),
    );
    await conflictAfterExpiry;
    await conflictSilence;

    const reactivated = waitForMessage(
      socketB,
      (message) =>
        message.type === "first-draft-selection-update" &&
        message.selectionRevision === 3,
    );
    socketA.send(
      encodeFirstDraftMessage(selectionMessage(identityA, 3, { kind: "none" })),
    );
    await expect(reactivated).resolves.toMatchObject({
      selection: { kind: "none" },
    });
    expect(scheduler.pendingCount()).toBe(1);
  });

  it("renews the lease only when the stable selection value changes", async () => {
    const scheduler = manualTimeoutScheduler();
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
      selectionPresenceScheduler: scheduler,
    });
    const identityA = session("renew-a", documentOne);
    const identityB = session("renew-b", documentOne);
    const socketA = await connectSession(server, identityA);
    const socketB = await connectSession(server, identityB);
    sockets.push(socketA, socketB);
    const initial = waitForMessage(
      socketB,
      (message) => message.type === "first-draft-selection-update",
    );
    socketA.send(
      encodeFirstDraftMessage(selectionMessage(identityA, 0, blockSelection())),
    );
    await initial;
    scheduler.advanceBy(29_000);
    const changed = waitForMessage(
      socketB,
      (message) =>
        message.type === "first-draft-selection-update" &&
        message.selectionRevision === 1,
    );
    socketA.send(
      encodeFirstDraftMessage(selectionMessage(identityA, 1, { kind: "none" })),
    );
    await changed;
    expect(scheduler.pendingCount()).toBe(1);

    scheduler.advanceBy(1_000);
    await expectNoMessage(
      socketB,
      (message) => message.type === "first-draft-selection-snapshot",
      25,
    );
    scheduler.advanceBy(28_999);
    await expectNoMessage(
      socketB,
      (message) => message.type === "first-draft-selection-snapshot",
      25,
    );
    const expired = waitForMessage(
      socketB,
      (message) => message.type === "first-draft-selection-snapshot",
    );
    scheduler.advanceBy(1);
    await expect(expired).resolves.toMatchObject({ selections: [] });
    expect(scheduler.now()).toBe(59_000);
  });

  it("cancels selection leases on disconnect and server shutdown", async () => {
    const scheduler = manualTimeoutScheduler();
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
      selectionPresenceScheduler: scheduler,
    });
    const identityA = session("cleanup-a", documentOne);
    const identityB = session("cleanup-b", documentOne);
    const socketA = await connectSession(server, identityA);
    const socketB = await connectSession(server, identityB);
    sockets.push(socketA, socketB);
    const initial = waitForMessage(
      socketB,
      (message) => message.type === "first-draft-selection-update",
    );
    socketA.send(
      encodeFirstDraftMessage(selectionMessage(identityA, 0, blockSelection())),
    );
    await initial;
    expect(scheduler.pendingCount()).toBe(1);
    const disconnected = waitForMessage(
      socketB,
      (message) => message.type === "first-draft-selection-snapshot",
    );
    await closeSocket(socketA);
    await disconnected;
    expect(scheduler.pendingCount()).toBe(0);
    const callbackCount = scheduler.callbackCount();
    scheduler.advanceBy(EDITOR_SELECTION_PRESENCE_INACTIVITY_MS);
    expect(scheduler.callbackCount()).toBe(callbackCount);

    const identityC = session("cleanup-c", documentOne);
    const socketC = await connectSession(server, identityC);
    sockets.push(socketC);
    socketC.send(
      encodeFirstDraftMessage(selectionMessage(identityC, 0, blockSelection())),
    );
    await waitFor(() => scheduler.pendingCount() === 1);
    await server.close();
    server = null;
    expect(scheduler.pendingCount()).toBe(0);
    const shutdownCallbackCount = scheduler.callbackCount();
    scheduler.advanceBy(EDITOR_SELECTION_PRESENCE_INACTIVITY_MS);
    expect(scheduler.callbackCount()).toBe(shutdownCallbackCount);
  });

  it("isolates presence by document and keeps it live while persistence is blocked", async () => {
    const blocked =
      deferred<
        Awaited<ReturnType<FirstDraftTransactionPersistence["accept"]>>
      >();
    const accept = vi.fn(() => blocked.promise);
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: { accept },
    });
    const identityA = session("live-a", documentOne);
    const identityB = session("live-b", documentOne);
    const identityOther = session("live-other", documentTwo);
    const socketA = await connectSession(server, identityA);
    const socketB = await connectSession(server, identityB);
    const other = await connectSession(server, identityOther);
    sockets.push(socketA, socketB, other);

    const acceptedTransactionSilence = expectNoMessage(
      socketB,
      (message) => message.type === "first-draft-accepted-transaction-replay",
      60,
    );
    socketA.send(
      await createTextTransactionFrame("presence-blocked-transaction"),
    );

    const participant = waitForMessage(
      socketB,
      (message) => message.type === "first-draft-participant-update",
    );
    const outsiderSilence = expectNoMessage(
      other,
      (message) => message.type === "first-draft-participant-update",
      60,
    );
    socketA.send(
      encodeFirstDraftMessage(participantMessage(identityA, 0, true)),
    );
    await expect(participant).resolves.toMatchObject({
      subject: subject(identityA),
    });
    await outsiderSilence;
    await acceptedTransactionSilence;

    const selection = waitForMessage(
      socketB,
      (message) => message.type === "first-draft-selection-update",
    );
    socketA.send(
      encodeFirstDraftMessage(selectionMessage(identityA, 0, blockSelection())),
    );
    await expect(selection).resolves.toMatchObject({ selectionRevision: 0 });
    expect(accept).toHaveBeenCalledTimes(1);
    expect(server.documentSessionCount(documentOne)).toBe(2);

    const failed = waitForMessage(
      socketA,
      (message) => message.type === "editor-transaction-persistence-failed",
    );
    blocked.resolve({
      ok: false,
      reason: "unavailable",
      retryable: true,
      message: "database unavailable",
    });
    await failed;
    expect(server.documentSessionCount(documentOne)).toBe(2);
  });

  it("rejects impersonation and unsubscribes only the matching live session", async () => {
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
    });
    const identityA = {
      ...session("shared-a", documentOne),
      actorId: "actor-shared",
    };
    const identityB = {
      ...session("shared-b", documentOne),
      actorId: "actor-shared",
    };
    const socketA = await connectSession(server, identityA);
    const socketB = await connectSession(server, identityB);
    sockets.push(socketA, socketB);
    socketA.send(
      encodeFirstDraftMessage(participantMessage(identityA, 0, true)),
    );
    const joinedB = waitForMessage(
      socketA,
      (message) => message.type === "first-draft-participant-update",
    );
    socketB.send(
      encodeFirstDraftMessage(participantMessage(identityB, 0, true)),
    );
    await joinedB;

    const impersonationError = waitForMessage(
      socketA,
      (message) => message.type === "first-draft-protocol-error",
    );
    const peerSilence = expectNoMessage(
      socketB,
      (message) => message.type === "first-draft-selection-update",
      50,
    );
    socketA.send(
      encodeFirstDraftMessage(selectionMessage(identityB, 1, blockSelection())),
    );
    await expect(impersonationError).resolves.toMatchObject({
      code: "unauthorized-presence",
      fatal: false,
    });
    await peerSilence;

    const leftA = waitForMessage(
      socketB,
      (message) =>
        message.type === "first-draft-participant-update" && !message.active,
    );
    const noFalseLeave = expectNoMessage(
      socketB,
      (message) =>
        message.type === "first-draft-participant-update" &&
        !message.active &&
        message.subject.sessionId === identityB.sessionId,
      60,
    );
    const unsubscribed = waitForMessage(
      socketA,
      (message) => message.type === "first-draft-document-unsubscribed",
    );
    socketA.send(
      encodeFirstDraftMessage({
        type: "unsubscribe-first-draft-document",
        documentId: identityA.documentId,
      }),
    );
    await expect(leftA).resolves.toMatchObject({
      subject: subject(identityA),
      active: false,
    });
    await unsubscribed;
    await noFalseLeave;
    expect(server.documentSessionCount(documentOne)).toBe(1);
  });

  it("fans out an accepted canonical frame only after persistence to peers in the authorized document", async () => {
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
    });
    const sender = await connectSession(server, session("sender", documentOne));
    const peer = await connectSession(server, session("peer", documentOne));
    const outsider = await connectSession(
      server,
      session("outsider", documentTwo),
    );
    sockets.push(sender, peer, outsider);
    const frame = await createTextTransactionFrame("room-transaction");
    const peerFrame = waitForRawFrame(peer);
    const senderAccepted = waitForMessage(
      sender,
      (message) => message.type === "editor-transaction-accepted",
    );
    const outsiderSilence = expectNoRawFrame(outsider);

    sender.send(frame);

    expect(decodeFirstDraftMessage(await peerFrame)).toMatchObject({
      ok: true,
      message: {
        type: "first-draft-accepted-transaction-replay",
        transaction: { transactionId: "room-transaction" },
      },
    });
    await Promise.all([senderAccepted, outsiderSilence]);
  });

  it("queues one accepted transaction across the page-to-WebSocket subscription gap", async () => {
    const loading = deferred<{
      readonly ok: true;
      readonly bootstrap: ReturnType<
        typeof createFirstDraftBootstrapFromSnapshot
      >;
    }>();
    let loaderCalls = 0;
    server = await startEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
      documentLoader: {
        loadBootstrap: async () => {
          loaderCalls += 1;
          return loaderCalls === 1
            ? loading.promise
            : {
                ok: true as const,
                bootstrap: createFirstDraftBootstrapFromSnapshot({
                  documentId: documentOne,
                  revision: 0,
                  snapshot: testDocumentSnapshot,
                }),
              };
        },
        loadAcceptedTransactions: async (_documentId, revision) => {
          return {
            ok: true as const,
            requestedRevision: revision,
            currentRevision: revision,
            transactions: [],
          };
        },
      },
    });
    const joiningIdentity = session("gap-joining", documentOne);
    const joining = await openSocket(server);
    sockets.push(joining);
    await authenticateSession(joining, joiningIdentity);
    let replayCount = 0;
    joining.on("message", (data, isBinary) => {
      if (!isBinary) return;
      const decoded = decodeFirstDraftMessage(toArrayBufferView(data));
      if (
        decoded.ok &&
        decoded.message.type === "first-draft-accepted-transaction-replay"
      ) {
        replayCount += 1;
      }
    });
    const replay = waitForMessage(
      joining,
      (message) => message.type === "first-draft-accepted-transaction-replay",
    );
    const caughtUp = waitForMessage(
      joining,
      (message) => message.type === "first-draft-document-caught-up",
    );
    joining.send(
      encodeFirstDraftMessage({
        type: "subscribe-first-draft-document",
        documentId: documentOne,
      }),
    );
    await vi.waitFor(() => expect(loaderCalls).toBe(1));

    const author = await connectSession(
      server,
      session("gap-author", documentOne),
    );
    sockets.push(author);
    const accepted = waitForMessage(
      author,
      (message) => message.type === "editor-transaction-accepted",
    );
    author.send(await createTextTransactionFrame("gap-transaction"));
    await expect(accepted).resolves.toMatchObject({
      baseRevision: 0,
      revision: 1,
    });

    loading.resolve({
      ok: true,
      bootstrap: createFirstDraftBootstrapFromSnapshot({
        documentId: documentOne,
        revision: 0,
        snapshot: testDocumentSnapshot,
      }),
    });
    await expect(replay).resolves.toMatchObject({
      transactionId: "gap-transaction",
      baseRevision: 0,
      revision: 1,
    });
    await expect(caughtUp).resolves.toMatchObject({
      requestedRevision: 0,
      revision: 1,
    });
    await delay(20);
    expect(replayCount).toBe(1);
  });

  it("applies peer content only after blocked persistence accepts it", async () => {
    const blocked =
      deferred<
        Awaited<ReturnType<FirstDraftTransactionPersistence["accept"]>>
      >();
    const persistence: FirstDraftTransactionPersistence = {
      accept: vi.fn(() => blocked.promise),
    };
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence,
    });
    const sender = await connectSession(
      server,
      session("blocked-a", documentOne),
    );
    const peer = await connectSession(
      server,
      session("blocked-b", documentOne),
    );
    sockets.push(sender, peer);
    const peerEditor = initializeEditableEditor({
      definition: firstDraftDefinition(),
      snapshot: createFirstDraftSnapshot(),
    });
    const failures = vi.fn();
    const protocolErrors = vi.fn();
    const peerConnection = createFirstDraftMessageDispatcher(
      peer as unknown as FirstDraftConnectionSocket,
    );
    const dispose = attachFirstDraftRemoteTransactions(
      peerConnection,
      peerEditor,
      { onPersistenceFailed: failures, onProtocolError: protocolErrors },
    );
    const initialText = text(peerEditor, textBlockId);
    const frame = await createTextTransactionFrame("blocked-transaction");
    const accepted = waitForMessage(
      sender,
      (message) => message.type === "editor-transaction-accepted",
    );

    sender.send(frame);
    await waitFor(() => vi.mocked(persistence.accept).mock.calls.length === 1);
    let acceptanceObserved = false;
    void accepted.then(() => {
      acceptanceObserved = true;
    });
    await delay(20);
    expect(acceptanceObserved).toBe(false);
    expect(text(peerEditor, textBlockId)).toBe(initialText);

    blocked.resolve({
      ok: true,
      status: "accepted",
      accepted: {
        documentId: documentOne,
        transactionId: "blocked-transaction",
        baseRevision: 0,
        revision: 1,
        acceptedAt: 100,
      },
      transaction: decodeProposedTransaction(frame),
    });
    await expect(accepted).resolves.toMatchObject({
      type: "editor-transaction-accepted",
      baseRevision: 0,
      revision: 1,
    });
    await delay(30);
    expect(protocolErrors).not.toHaveBeenCalled();
    await waitFor(() => text(peerEditor, textBlockId) === `X${initialText}`);
    expect(text(peerEditor, textBlockId)).toBe(`X${initialText}`);
    expect(failures).not.toHaveBeenCalled();
    dispose();
    peerConnection.dispose();
    peerEditor.dispose();
  });

  it("persists and publishes successive causal content transactions in document receive order", async () => {
    const first =
      deferred<
        Awaited<ReturnType<FirstDraftTransactionPersistence["accept"]>>
      >();
    const second =
      deferred<
        Awaited<ReturnType<FirstDraftTransactionPersistence["accept"]>>
      >();
    const accept = vi
      .fn<FirstDraftTransactionPersistence["accept"]>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: { accept },
    });
    const senderIdentity = session("causal-a", documentOne);
    const sender = await connectSession(server, senderIdentity);
    const peer = await connectSession(server, session("causal-b", documentOne));
    sockets.push(sender, peer);
    const peerEditor = initializeEditableEditor({
      definition: firstDraftDefinition(),
      snapshot: createFirstDraftSnapshot(),
    });
    let applied = 0;
    const connection = createFirstDraftMessageDispatcher(
      peer as unknown as FirstDraftConnectionSocket,
    );
    const dispose = attachFirstDraftRemoteTransactions(connection, peerEditor, {
      onApplied: () => {
        applied += 1;
      },
    });
    const initialText = text(peerEditor, textBlockId);
    const [typed, pasted] = await createSuccessiveTextTransactionFrames();
    const acceptanceOrder: string[] = [];
    const acceptedA = waitForMessage(
      sender,
      (
        message,
      ): message is Extract<
        FirstDraftMessage,
        { type: "editor-transaction-accepted" }
      > =>
        message.type === "editor-transaction-accepted" &&
        message.transactionId === "causal-typed",
    ).then((message) => {
      acceptanceOrder.push(message.transactionId);
      return message;
    });
    const acceptedB = waitForMessage(
      sender,
      (
        message,
      ): message is Extract<
        FirstDraftMessage,
        { type: "editor-transaction-accepted" }
      > =>
        message.type === "editor-transaction-accepted" &&
        message.transactionId === "causal-pasted",
    ).then((message) => {
      acceptanceOrder.push(message.transactionId);
      return message;
    });

    try {
      sender.send(typed);
      sender.send(pasted);
      await delay(20);
      expect(text(peerEditor, textBlockId)).toBe(initialText);
      expect(applied).toBe(0);
      expect(accept).toHaveBeenCalledTimes(1);
      expect(accept.mock.calls[0]?.[0].transaction.transactionId).toBe(
        "causal-typed",
      );

      const participant = waitForMessage(
        peer,
        (message) => message.type === "first-draft-participant-update",
      );
      sender.send(
        encodeFirstDraftMessage(participantMessage(senderIdentity, 0, true)),
      );
      await expect(participant).resolves.toMatchObject({ active: true });
      const selection = waitForMessage(
        peer,
        (message) => message.type === "first-draft-selection-update",
      );
      sender.send(
        encodeFirstDraftMessage(
          selectionMessage(senderIdentity, 0, blockSelection()),
        ),
      );
      await expect(selection).resolves.toMatchObject({ selectionRevision: 0 });
      expect(accept).toHaveBeenCalledTimes(1);

      first.resolve(
        acceptedResult(
          documentOne,
          "causal-typed",
          0,
          1,
          decodeProposedTransaction(typed),
        ),
      );
      await expect(acceptedA).resolves.toMatchObject({ revision: 1 });
      await waitFor(() => text(peerEditor, textBlockId) === `T${initialText}`);
      await waitFor(() => accept.mock.calls.length === 2);
      expect(accept.mock.calls[1]?.[0].transaction.transactionId).toBe(
        "causal-pasted",
      );
      expect(server.persistenceTailCount()).toBe(1);
      expect(text(peerEditor, textBlockId)).toBe(`T${initialText}`);
      expect(applied).toBe(1);

      second.resolve(
        acceptedResult(
          documentOne,
          "causal-pasted",
          1,
          2,
          decodeProposedTransaction(pasted),
        ),
      );
      await expect(acceptedB).resolves.toMatchObject({ revision: 2 });
      await waitFor(
        () => text(peerEditor, textBlockId) === `TPASTED${initialText}`,
      );
      expect(acceptanceOrder).toEqual(["causal-typed", "causal-pasted"]);
      expect(text(peerEditor, textBlockId)).toBe(`TPASTED${initialText}`);
      expect(applied).toBe(2);
      await waitFor(() => server?.persistenceTailCount() === 0);
    } finally {
      dispose();
      connection.dispose();
      peerEditor.dispose();
    }
  });

  it("persists another document independently of a blocked document tail", async () => {
    const blocked =
      deferred<
        Awaited<ReturnType<FirstDraftTransactionPersistence["accept"]>>
      >();
    const accept = vi.fn<FirstDraftTransactionPersistence["accept"]>(
      ({ documentId, transaction }) =>
        documentId === documentOne
          ? blocked.promise
          : Promise.resolve(
              acceptedResult(
                documentId,
                transaction.transactionId,
                0,
                1,
                transaction,
              ),
            ),
    );
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: { accept },
    });
    const socketA = await connectSession(
      server,
      session("isolated-a", documentOne),
    );
    const socketB = await connectSession(
      server,
      session("isolated-b", documentTwo),
    );
    sockets.push(socketA, socketB);
    const acceptedB = waitForMessage(
      socketB,
      (message) => message.type === "editor-transaction-accepted",
    );

    socketA.send(await createTextTransactionFrame("blocked-document-a"));
    await waitFor(() => accept.mock.calls.length === 1);
    socketB.send(await createTextTransactionFrame("independent-document-b"));

    await expect(acceptedB).resolves.toMatchObject({
      documentId: documentTwo,
      transactionId: "independent-document-b",
    });
    expect(accept).toHaveBeenCalledTimes(2);
    expect(server.persistenceTailCount()).toBe(1);
    blocked.resolve(
      acceptedResult(
        documentOne,
        "blocked-document-a",
        0,
        1,
        accept.mock.calls[0]![0].transaction,
      ),
    );
    await waitFor(() => server?.persistenceTailCount() === 0);
  });

  it("settles failed tails, removes them, and lets later work start", async () => {
    const accept = vi
      .fn<FirstDraftTransactionPersistence["accept"]>()
      .mockRejectedValueOnce(new Error("database disconnected"))
      .mockImplementationOnce(({ documentId, transaction }) =>
        Promise.resolve(
          acceptedResult(
            documentId,
            transaction.transactionId,
            0,
            1,
            transaction,
          ),
        ),
      );
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: { accept },
    });
    const socket = await connectSession(
      server,
      session("failure-tail", documentOne),
    );
    sockets.push(socket);
    const failed = waitForMessage(
      socket,
      (message) => message.type === "editor-transaction-persistence-failed",
    );
    socket.send(await createTextTransactionFrame("rejected-tail"));
    await expect(failed).resolves.toMatchObject({ reason: "unavailable" });
    await waitFor(() => server?.persistenceTailCount() === 0);

    const accepted = waitForMessage(
      socket,
      (message) => message.type === "editor-transaction-accepted",
    );
    socket.send(await createTextTransactionFrame("after-rejected-tail"));
    await expect(accepted).resolves.toMatchObject({
      transactionId: "after-rejected-tail",
    });
    expect(accept).toHaveBeenCalledTimes(2);
    await waitFor(() => server?.persistenceTailCount() === 0);
  });

  it("does not broadcast a transaction rejected by persistence", async () => {
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: {
        accept: async () => ({
          ok: false,
          reason: "invalid",
          retryable: false,
          message: "Canonical validation failed",
        }),
      },
    });
    const sender = await connectSession(
      server,
      session("failed-a", documentOne),
    );
    const peer = await connectSession(server, session("failed-b", documentOne));
    sockets.push(sender, peer);
    const peerSilence = expectNoRawFrame(peer);
    const failed = waitForMessage(
      sender,
      (message) => message.type === "editor-transaction-persistence-failed",
    );

    sender.send(await createTextTransactionFrame("failed-transaction"));

    await expect(failed).resolves.toMatchObject({
      reason: "invalid",
      retryable: false,
    });
    await peerSilence;
  });

  it("rejects malformed frames before fanout without closing unrelated clients", async () => {
    const diagnostics = vi.fn();
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
      onProtocolDiagnostic: diagnostics,
    });
    const sender = await connectSession(server, session("sender", documentOne));
    const peer = await connectSession(server, session("peer", documentOne));
    sockets.push(sender, peer);
    const error = waitForMessage(
      sender,
      (message) => message.type === "first-draft-protocol-error",
    );
    const peerSilence = expectNoRawFrame(peer);

    sender.send(new Uint8Array([0x46, 0x44, 0x54, 0xff, 0, 0, 0, 1, 0]));

    await expect(error).resolves.toMatchObject({
      type: "first-draft-protocol-error",
      code: "invalid-message",
      fatal: false,
    });
    await peerSilence;
    expect(peer.readyState).toBe(WebSocket.OPEN);
    expect(diagnostics).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["A then B", ["a", "b"] as const],
    ["B then A", ["b", "a"] as const],
  ])(
    "converges genuinely concurrent same-offset edits in server receive order %s",
    async (_label, receiveOrder) => {
      server = await startTestEditorRealtimeServer({
        config: testConfig(),
        persistence: acceptingPersistence(),
      });
      const socketA = await connectSession(
        server,
        session(`concurrent-a-${receiveOrder.join("")}`, documentOne),
      );
      const socketB = await connectSession(
        server,
        session(`concurrent-b-${receiveOrder.join("")}`, documentOne),
      );
      sockets.push(socketA, socketB);
      const framesA: ArrayBuffer[] = [];
      const framesB: ArrayBuffer[] = [];
      const snapshot = createFirstDraftSnapshot();
      const runtimeA = createContentRuntimeCapture();
      const runtimeB = createContentRuntimeCapture();
      const editorA = initializeEditableEditor({
        definition: firstDraftDefinition(),
        snapshot,
        onContentRuntime: runtimeA.capture,
        onChange: handleTransaction({
          readyState: WebSocket.OPEN,
          send: (frame) => framesA.push(frame.slice(0)),
        }),
        createTransactionId: ids(`concurrent-a-${receiveOrder.join("")}`),
      });
      const editorB = initializeEditableEditor({
        definition: firstDraftDefinition(),
        snapshot,
        onContentRuntime: runtimeB.capture,
        onChange: handleTransaction({
          readyState: WebSocket.OPEN,
          send: (frame) => framesB.push(frame.slice(0)),
        }),
        createTransactionId: ids(`concurrent-b-${receiveOrder.join("")}`),
      });
      const editingLeaseA = runtimeA
        .read()
        .acquireBlockContent(textBlockId, "paragraph", "active-editing");
      const editingLeaseB = runtimeB
        .read()
        .acquireBlockContent(textBlockId, "paragraph", "active-editing");
      let appliedByA = 0;
      let appliedByB = 0;
      const errors = vi.fn();
      const connectionA = createFirstDraftMessageDispatcher(
        socketA as unknown as FirstDraftConnectionSocket,
      );
      const connectionB = createFirstDraftMessageDispatcher(
        socketB as unknown as FirstDraftConnectionSocket,
      );
      const disposeA = attachFirstDraftRemoteTransactions(
        connectionA,
        editorA,
        {
          onApplied: () => {
            appliedByA += 1;
          },
          onProtocolError: errors,
        },
      );
      const disposeB = attachFirstDraftRemoteTransactions(
        connectionB,
        editorB,
        {
          onApplied: () => {
            appliedByB += 1;
          },
          onProtocolError: errors,
        },
      );

      try {
        const initialText = text(editorA, textBlockId);
        expect(
          editorA.insertText({ blockId: textBlockId, offset: 0, text: "A" }),
        ).toBe(true);
        expect(
          editorB.insertText({ blockId: textBlockId, offset: 0, text: "B" }),
        ).toBe(true);
        expect(framesA).toHaveLength(1);
        expect(framesB).toHaveLength(1);
        expect(text(editorA, textBlockId)).toBe(`A${initialText}`);
        expect(text(editorB, textBlockId)).toBe(`B${initialText}`);

        for (const sender of receiveOrder) {
          if (sender === "a") socketA.send(framesA[0]!);
          else socketB.send(framesB[0]!);
        }
        await waitFor(
          () =>
            errors.mock.calls.length > 0 ||
            (appliedByA === 1 && appliedByB === 1),
        );
        expect(errors).not.toHaveBeenCalled();
        expect([appliedByA, appliedByB]).toEqual([1, 1]);
        expect(text(editorA, textBlockId)).toBe(text(editorB, textBlockId));

        const converged = text(editorA, textBlockId);
        expect(converged).toContain("A");
        expect(converged).toContain("B");
        expect(converged.length).toBe(initialText.length + 2);
        expect(framesA).toHaveLength(1);
        expect(framesB).toHaveLength(1);
        expect(errors).not.toHaveBeenCalled();
        expect(socketA.readyState).toBe(WebSocket.OPEN);
        expect(socketB.readyState).toBe(WebSocket.OPEN);
      } finally {
        editingLeaseA.release();
        editingLeaseB.release();
        disposeA();
        disposeB();
        connectionA.dispose();
        connectionB.dispose();
        editorA.dispose();
        editorB.dispose();
      }
    },
  );

  it("collaborates through accepted transactions across two real clients without echo", async () => {
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
    });
    const socketA = await connectSession(server, session("a", documentOne));
    const socketB = await connectSession(server, session("b", documentOne));
    sockets.push(socketA, socketB);
    let sentByB = 0;
    const senderA: EditorTransactionWebSocket = {
      get readyState() {
        return socketA.readyState;
      },
      send(frame) {
        socketA.send(frame);
      },
    };
    const senderB: EditorTransactionWebSocket = {
      get readyState() {
        return socketB.readyState;
      },
      send(frame) {
        sentByB += 1;
        socketB.send(frame);
      },
    };
    const editorA = addEditorBlockOperations(
      initializeEditableEditor({
        definition: firstDraftDefinition(),
        snapshot: createFirstDraftSnapshot(),
        onChange: handleTransaction(senderA),
        createTransactionId: ids("session-a"),
      }),
    );
    const editorB = addEditorBlockOperations(
      initializeEditableEditor({
        definition: firstDraftDefinition(),
        snapshot: createFirstDraftSnapshot(),
        onChange: handleTransaction(senderB),
        createTransactionId: ids("session-b"),
      }),
    );
    let appliedByA = 0;
    let appliedByB = 0;
    const protocolErrors = vi.fn();
    const connectionA = createFirstDraftMessageDispatcher(
      socketA as unknown as FirstDraftConnectionSocket,
    );
    const connectionB = createFirstDraftMessageDispatcher(
      socketB as unknown as FirstDraftConnectionSocket,
    );
    const disposeReceiverA = attachFirstDraftRemoteTransactions(
      connectionA,
      editorA,
      {
        onProtocolError: protocolErrors,
        onApplied: () => {
          appliedByA += 1;
        },
      },
    );
    const disposeReceiverB = attachFirstDraftRemoteTransactions(
      connectionB,
      editorB,
      {
        onProtocolError: protocolErrors,
        onApplied: () => {
          appliedByB += 1;
        },
      },
    );

    try {
      const initialText = text(editorA, textBlockId);
      expect(
        editorA.insertText({ blockId: textBlockId, offset: 0, text: "X" }),
      ).toBe(true);
      await waitFor(() => text(editorB, textBlockId) === `X${initialText}`);
      expect(text(editorA, textBlockId)).toBe(`X${initialText}`);
      expect(appliedByA).toBe(0);
      expect(appliedByB).toBe(1);
      expect(sentByB).toBe(0);

      expect(
        editorA.updateBlockMetadata([
          {
            blockId: metadataBlockId,
            values: { checked: true, collaborator: "Ada" },
          },
        ]),
      ).toBe(true);
      await waitFor(
        () =>
          editorB.getBlock(metadataBlockId)?.metadata?.collaborator === "Ada",
      );
      expect(editorB.getBlock(metadataBlockId)?.metadata?.checked).toBe(true);

      const inserted = editorA.insertBlock({
        blockId: textBlockId,
        blockType: "paragraph",
        createBlockId: () => createdBlockId,
      });
      expect(inserted.ok).toBe(true);
      await waitFor(() => editorB.getBlock(createdBlockId)?.tombstone === null);
      expect(editorB.getRootBlockIds()).toContain(createdBlockId);
      expect(
        editorA.insertText({
          blockId: createdBlockId,
          offset: 0,
          text: "Accepted multi-block change",
        }),
      ).toBe(true);
      await waitFor(
        () => text(editorB, createdBlockId) === "Accepted multi-block change",
      );

      expect(editorA.undo()).toEqual({ status: "applied" });
      await waitFor(() => text(editorB, createdBlockId) === "");
      expect(editorA.redo()).toEqual({ status: "applied" });
      await waitFor(
        () => text(editorB, createdBlockId) === "Accepted multi-block change",
      );
      expect(
        editorB.getRootBlockIds().filter((id) => id === createdBlockId),
      ).toHaveLength(1);
      expect(sentByB).toBe(0);
      expect(protocolErrors).not.toHaveBeenCalled();
    } finally {
      disposeReceiverB();
      disposeReceiverA();
      connectionB.dispose();
      connectionA.dispose();
      editorB.dispose();
      editorA.dispose();
    }
  });
});

const testDocumentSnapshot = createFirstDraftSnapshot();

function startTestEditorRealtimeServer(
  options: Omit<
    Parameters<typeof startEditorRealtimeServer>[0],
    "documentLoader"
  >,
) {
  return startEditorRealtimeServer({
    ...options,
    documentLoader: {
      loadBootstrap: async (documentId) => ({
        ok: true as const,
        bootstrap: createFirstDraftBootstrapFromSnapshot({
          documentId,
          revision: 0,
          snapshot: testDocumentSnapshot,
        }),
      }),
      loadAcceptedTransactions: async (_documentId, revision) => ({
        ok: true,
        requestedRevision: revision,
        currentRevision: revision,
        transactions: [],
      }),
    },
  });
}

function testConfig() {
  return {
    host: "127.0.0.1",
    port: 0,
    authMode: "dev-shared" as const,
    devSharedToken: authenticationToken,
    nodeEnv: "test",
    postgresUrl: "postgres://unused-in-injected-tests",
  };
}

function session(name: string, documentId: string): FirstDraftSessionIdentity {
  return {
    actorId: `actor-${name}`,
    clientId: `client-${name}`,
    sessionId: `session-${name}`,
    documentId,
  };
}

function subject(identity: FirstDraftSessionIdentity) {
  return {
    actorId: identity.actorId,
    clientId: identity.clientId,
    sessionId: identity.sessionId,
  };
}

function participantMessage(
  identity: FirstDraftSessionIdentity,
  presenceRevision: number,
  active: boolean,
) {
  return {
    type: "first-draft-participant-update" as const,
    documentId: identity.documentId,
    subject: subject(identity),
    presenceRevision,
    active,
    metadata: { displayName: identity.actorId, color: "#123abc" },
  };
}

function selectionMessage(
  identity: FirstDraftSessionIdentity,
  selectionRevision: number,
  selection: ReturnType<typeof blockSelection> | { readonly kind: "none" },
) {
  return {
    type: "first-draft-selection-update" as const,
    documentId: identity.documentId,
    subject: subject(identity),
    selectionRevision,
    selection,
  };
}

function blockSelection() {
  return {
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
}

function acceptingPersistence(): FirstDraftTransactionPersistence {
  const revisions = new Map<string, number>();
  return {
    accept: async ({ documentId, transaction }) => {
      const baseRevision = revisions.get(documentId) ?? 0;
      revisions.set(documentId, baseRevision + 1);
      return {
        ok: true,
        status: "accepted",
        accepted: {
          documentId,
          transactionId: transaction.transactionId,
          baseRevision,
          revision: baseRevision + 1,
          acceptedAt: baseRevision + 1,
        },
        transaction,
      };
    },
  };
}

function manualTimeoutScheduler(): EditorRealtimeTimeoutScheduler & {
  advanceBy(milliseconds: number): void;
  pendingCount(): number;
  callbackCount(): number;
} {
  let currentTime = 0;
  let nextId = 1;
  let callbacks = 0;
  const tasks = new Map<
    number,
    { readonly deadline: number; readonly callback: () => void }
  >();
  return {
    now: () => currentTime,
    setTimeout(callback, delayMs) {
      const id = nextId++;
      tasks.set(id, { deadline: currentTime + delayMs, callback });
      return id;
    },
    clearTimeout(handle) {
      if (typeof handle === "number") tasks.delete(handle);
    },
    advanceBy(milliseconds) {
      currentTime += milliseconds;
      while (true) {
        const due = [...tasks.entries()]
          .filter(([, task]) => task.deadline <= currentTime)
          .sort(
            ([leftId, left], [rightId, right]) =>
              left.deadline - right.deadline || leftId - rightId,
          )[0];
        if (!due) return;
        tasks.delete(due[0]);
        callbacks += 1;
        due[1].callback();
      }
    },
    pendingCount: () => tasks.size,
    callbackCount: () => callbacks,
  };
}

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function openSocket(server: EditorRealtimeServer): Promise<WebSocket> {
  const socket = new WebSocket(
    `${server.url.replace("http://", "ws://")}/editor-realtime`,
  );
  socket.binaryType = "arraybuffer";
  await once(socket, "open");
  return socket;
}

async function connectSession(
  server: EditorRealtimeServer,
  identity: FirstDraftSessionIdentity,
): Promise<WebSocket> {
  const socket = await openSocket(server);
  await authenticateSession(socket, identity);
  await subscribeSession(socket, identity);
  return socket;
}

async function authenticateSession(
  socket: WebSocket,
  identity: FirstDraftSessionIdentity,
): Promise<void> {
  const connected = waitForMessage(
    socket,
    (message) => message.type === "first-draft-session-connected",
  );
  socket.send(
    encodeFirstDraftMessage({
      type: "connect-first-draft-session",
      authenticationToken,
      ...identity,
    }),
  );
  await expect(connected).resolves.toEqual({
    type: "first-draft-session-connected",
    ...identity,
  });
}

async function subscribeSession(
  socket: WebSocket,
  identity: FirstDraftSessionIdentity,
) {
  const subscribed = waitForMessage(
    socket,
    (message) => message.type === "first-draft-document-caught-up",
  );
  const participants = waitForMessage(
    socket,
    (message) => message.type === "first-draft-participant-snapshot",
  );
  const selections = waitForMessage(
    socket,
    (message) => message.type === "first-draft-selection-snapshot",
  );
  socket.send(
    encodeFirstDraftMessage({
      type: "subscribe-first-draft-document",
      documentId: identity.documentId,
    }),
  );
  return Promise.all([subscribed, participants, selections]);
}

function waitForMessage<T extends FirstDraftMessage>(
  socket: WebSocket,
  predicate: (message: FirstDraftMessage) => message is T,
): Promise<T>;
function waitForMessage(
  socket: WebSocket,
  predicate: (message: FirstDraftMessage) => boolean,
): Promise<FirstDraftMessage>;
function waitForMessage(
  socket: WebSocket,
  predicate: (message: FirstDraftMessage) => boolean,
): Promise<FirstDraftMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (!isBinary) return;
      const decoded = decodeFirstDraftMessage(toArrayBufferView(data));
      if (!decoded.ok || !predicate(decoded.message)) return;
      cleanup();
      resolve(decoded.message);
    };
    const onClose = () => {
      cleanup();
      reject(
        new Error("Socket closed before the expected First Draft message"),
      );
    };
    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("close", onClose);
    };
    socket.on("message", onMessage);
    socket.on("close", onClose);
  });
}

function waitForRawFrame(socket: WebSocket): Promise<ArrayBuffer> {
  return new Promise((resolve) => {
    socket.once("message", (data) => {
      const view = toArrayBufferView(data);
      const copy = new Uint8Array(view.byteLength);
      copy.set(view);
      resolve(copy.buffer);
    });
  });
}

function expectNoRawFrame(socket: WebSocket, duration = 100): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = () => {
      cleanup();
      reject(new Error("Unexpected WebSocket frame"));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, duration);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
    };
    socket.on("message", onMessage);
  });
}

function expectNoMessage(
  socket: WebSocket,
  predicate: (message: FirstDraftMessage) => boolean,
  duration = 100,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (!isBinary) return;
      const decoded = decodeFirstDraftMessage(toArrayBufferView(data));
      if (!decoded.ok || !predicate(decoded.message)) return;
      cleanup();
      reject(new Error(`Unexpected ${decoded.message.type} message`));
    };
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, duration);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
    };
    socket.on("message", onMessage);
  });
}

async function createTextTransactionFrame(
  transactionId: string,
): Promise<ArrayBuffer> {
  let frame: ArrayBuffer | null = null;
  const editor = initializeEditableEditor({
    definition: firstDraftDefinition(),
    snapshot: createFirstDraftSnapshot(),
    onChange: handleTransaction({
      readyState: 1,
      send: (nextFrame) => {
        frame = nextFrame;
      },
    }),
    createTransactionId: () => transactionId,
  });
  expect(
    editor.insertText({ blockId: textBlockId, offset: 0, text: "X" }),
  ).toBe(true);
  await waitFor(() => frame !== null);
  editor.dispose();
  if (frame === null) throw new Error("Expected transaction frame");
  return frame;
}

async function createSuccessiveTextTransactionFrames(): Promise<
  readonly [ArrayBuffer, ArrayBuffer]
> {
  const frames: ArrayBuffer[] = [];
  const transactionIds = ["causal-typed", "causal-pasted"];
  const editor = initializeEditableEditor({
    definition: firstDraftDefinition(),
    snapshot: createFirstDraftSnapshot(),
    onChange: handleTransaction({
      readyState: 1,
      send: (frame) => frames.push(frame.slice(0)),
    }),
    createTransactionId: () =>
      transactionIds.shift() ?? "unexpected-transaction",
  });
  expect(
    editor.insertText({ blockId: textBlockId, offset: 0, text: "T" }),
  ).toBe(true);
  expect(
    editor.insertText({ blockId: textBlockId, offset: 1, text: "PASTED" }),
  ).toBe(true);
  await waitFor(() => frames.length === 2);
  editor.dispose();
  if (frames.length !== 2)
    throw new Error("Expected two successive transactions");
  return [frames[0]!, frames[1]!];
}

function acceptedResult(
  documentId: string,
  transactionId: string,
  baseRevision: number,
  revision: number,
  transaction: ReturnType<typeof decodeProposedTransaction>,
) {
  return {
    ok: true as const,
    status: "accepted" as const,
    accepted: {
      documentId,
      transactionId,
      baseRevision,
      revision,
      acceptedAt: revision,
    },
    transaction,
  };
}

function decodeProposedTransaction(frame: ArrayBuffer) {
  const decoded = decodeFirstDraftMessage(frame);
  if (!decoded.ok || decoded.message.type !== "proposed-editor-transaction") {
    throw new Error("Expected a proposed First Draft transaction frame");
  }
  return decoded.message.transaction;
}

function firstDraftDefinition() {
  return createFirstDraftEditorDefinition(createFirstDraftViewStateStore());
}

type TestContentRuntime = ReturnType<
  NonNullable<EditableEditorDefinition["content"]>["createRuntime"]
>;

function captureDefinitionContentRuntime(
  definition: EditableEditorDefinition,
  capture: (runtime: TestContentRuntime) => void,
): EditableEditorDefinition {
  const content = definition.content;
  if (!content) throw new Error("First Draft has no content runtime");
  return {
    ...definition,
    content: {
      createRuntime(source) {
        const runtime = content.createRuntime(source);
        capture(runtime);
        return runtime;
      },
    },
  };
}

function createContentRuntimeCapture(): {
  readonly capture: (runtime: TestContentRuntime) => void;
  readonly read: () => TestContentRuntime;
} {
  let current: TestContentRuntime | null = null;
  return {
    capture: (runtime) => {
      current = runtime;
    },
    read: () => {
      if (!current) throw new Error("Content runtime was not created");
      return current;
    },
  };
}

function ids(prefix: string): () => string {
  let sequence = 0;
  return () => `${prefix}:${++sequence}`;
}

function text(
  editor: ReturnType<typeof initializeEditableEditor>,
  blockId: ReturnType<typeof asBlockId>,
): string {
  const content = editor.readBlockContent(blockId, "paragraph");
  if (!content) throw new Error(`Missing content for ${blockId}`);
  return extractPlainTextFromRichTextDocument(content);
}

function toArrayBufferView(data: WebSocket.RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (!Array.isArray(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  const bytes = new Uint8Array(
    data.reduce((total, entry) => total + entry.byteLength, 0),
  );
  let offset = 0;
  for (const entry of data) {
    bytes.set(entry, offset);
    offset += entry.byteLength;
  }
  return bytes;
}

async function waitFor(
  predicate: () => boolean,
  timeout = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for accepted collaboration");
    }
    await delay(10);
  }
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return;
  if (socket.readyState === WebSocket.CLOSING) {
    await once(socket, "close");
    return;
  }
  const closed = once(socket, "close");
  socket.close(1000, "test complete");
  await closed;
}
