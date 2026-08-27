import { once } from "node:events";
import { extractPlainTextFromRichTextDocument } from "@repo/editor-core/content/rich-text";
import { asBlockId } from "@repo/editor-core/kernel";
import {
  createFirstDraftEditorDefinition,
  createFirstDraftViewStateStore,
} from "@repo/editor-first-draft/definition";
import { createFirstDraftSnapshot } from "@repo/editor-first-draft/fixture";
import { createFirstDraftBootstrapFromSnapshot } from "@repo/editor-first-draft/bootstrap";
import {
  createFirstDraftMessageDispatcher,
  createFirstDraftOutboundPublisher,
  decodeFirstDraftMessage,
  encodeFirstDraftMessage,
  attachFirstDraftRemoteTransactions as attachFirstDraftRemoteTransactionsRaw,
  type FirstDraftMessage,
  type FirstDraftConnectionSocket,
  type FirstDraftOutboundPublisher,
  type FirstDraftOutboundSocket,
  type FirstDraftRemoteRefreshEditor,
  type FirstDraftRemoteTransactionClientOptions,
  type FirstDraftRemoteTransactionEditor,
  type FirstDraftParticipantUpdateMessage,
  type FirstDraftSelectionUpdateMessage,
  type FirstDraftSessionIdentity,
} from "@repo/editor-first-draft/transport";
import type { FirstDraftTransactionPersistence } from "@repo/editor-first-draft/server";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import {
  initializeEditableEditor as initializeCompiledEditor,
  type EditorSemanticChange,
} from "@repo/editor-web/editor";
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

const documentOne = "document-one";
const documentTwo = "document-two";
const textBlockId = asBlockId("fd-paragraph-intro");
const metadataBlockId = asBlockId("fd-check-unchecked");
const createdBlockId = asBlockId("phase-1-live-created-block");
type BlockInternalSelection = Extract<
  Extract<
    FirstDraftSelectionUpdateMessage["selection"],
    { readonly kind: "selection" }
  >["selection"],
  { readonly kind: "block-internal" }
>;

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

  it("establishes one anonymous binary session and cleans up its document room", async () => {
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
      protocolVersion: 6,
    });
    const serverOnlyError = waitForMessage(
      socket,
      (message) => message.type === "first-draft-protocol-error",
    );
    socket.send(
      encodeFirstDraftMessage({
        type: "connect-first-draft-session",
        ...session("replacement", documentTwo),
      }),
    );
    await expect(serverOnlyError).resolves.toMatchObject({
      code: "invalid-client-message",
      fatal: false,
    });
    expect(server.documentSessionCount(documentOne)).toBe(1);
    expect(server.documentSessionCount(documentTwo)).toBe(0);

    await closeSocket(socket);
    await waitFor(() => server?.documentSessionCount(documentOne) === 0);
  });

  it("rejects malformed sessions, document switches, and non-binary messages", async () => {
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
    });
    const malformed = await openSocket(server);
    sockets.push(malformed);
    const malformedError = waitForMessage(
      malformed,
      (message) => message.type === "first-draft-protocol-error",
    );
    const removedCredential = ["authentication", "Token"].join("");
    malformed.send(
      encodeFirstDraftMessage({
        type: "connect-first-draft-session",
        ...session("malformed", documentOne),
        [removedCredential]: "removed-token",
      } as unknown as FirstDraftMessage),
    );
    await expect(malformedError).resolves.toMatchObject({
      type: "first-draft-protocol-error",
      code: "session-connection-required",
      fatal: true,
    });
    expect(server.documentSessionCount(documentOne)).toBe(0);

    const wrongDocument = await openSocket(server);
    sockets.push(wrongDocument);
    await establishSession(
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
      code: "session-document-mismatch",
      fatal: false,
    });
    expect(server.documentSessionCount(documentTwo)).toBe(0);

    const subscriptionError = waitForMessage(
      wrongDocument,
      (message) => message.type === "first-draft-protocol-error",
    );
    wrongDocument.send(await createTextTransactionFrame("before-subscription"));
    await expect(subscriptionError).resolves.toMatchObject({
      code: "document-subscription-required",
      fatal: false,
    });

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

  it("accepts only allowlisted public documents without disclosing private existence", async () => {
    server = await startTestEditorRealtimeServer({
      config: {
        ...testConfig(),
        publicDocumentIds: [documentOne],
      },
      persistence: acceptingPersistence(),
    });
    const allowed = await openSocket(server);
    sockets.push(allowed);
    await establishSession(allowed, session("allowed", documentOne));

    const denied = await openSocket(server);
    sockets.push(denied);
    const unavailable = waitForMessage(
      denied,
      (message) => message.type === "first-draft-protocol-error",
    );
    denied.send(
      encodeFirstDraftMessage({
        type: "connect-first-draft-session",
        ...session("private", documentTwo),
      }),
    );
    await expect(unavailable).resolves.toMatchObject({
      code: "document-not-available",
      message: "The requested collaboration document is not available",
      fatal: true,
    });
  });

  it("validates browser origins during WebSocket upgrade", async () => {
    server = await startTestEditorRealtimeServer({
      config: {
        ...testConfig(),
        allowedOrigins: ["https://portfolio.example.com"],
      },
      persistence: acceptingPersistence(),
    });
    const approved = await openSocket(
      server,
      "https://portfolio.example.com",
    );
    sockets.push(approved);
    await expectUpgradeRejected(
      server,
      "https://attacker.example.com",
      403,
    );
  });

  it("enforces global and per-address connection caps and releases tracking", async () => {
    server = await startTestEditorRealtimeServer({
      config: {
        ...testConfig(),
        limits: {
          ...testConfig().limits,
          globalConnections: 1,
          connectionsPerAddress: 10,
        },
      },
      persistence: acceptingPersistence(),
    });
    const firstSocket = await openSocket(server);
    sockets.push(firstSocket);
    await expectUpgradeRejected(server, undefined, 503);
    expect(server.trackedRemoteAddressCount()).toBe(1);
    await closeSocket(firstSocket);
    sockets.splice(sockets.indexOf(firstSocket), 1);
    await waitFor(() => server?.trackedRemoteAddressCount() === 0);
    const replacement = await openSocket(server);
    sockets.push(replacement);
    await server.close();
    server = null;

    server = await startTestEditorRealtimeServer({
      config: {
        ...testConfig(),
        limits: {
          ...testConfig().limits,
          globalConnections: 10,
          connectionsPerAddress: 1,
        },
      },
      persistence: acceptingPersistence(),
    });
    const perAddress = await openSocket(server);
    sockets.push(perAddress);
    await expectUpgradeRejected(server, undefined, 429);
  });

  it("enforces per-document session, message, and transaction limits", async () => {
    server = await startTestEditorRealtimeServer({
      config: {
        ...testConfig(),
        limits: {
          ...testConfig().limits,
          sessionsPerDocument: 1,
          messagesPerWindow: 100,
          transactionsPerWindow: 1,
        },
      },
      persistence: acceptingPersistence(),
    });
    const firstIdentity = session("limited-a", documentOne);
    const firstSocket = await connectSession(server, firstIdentity);
    sockets.push(firstSocket);

    const secondSocket = await openSocket(server);
    sockets.push(secondSocket);
    const documentLimit = waitForMessage(
      secondSocket,
      (message) => message.type === "first-draft-protocol-error",
    );
    secondSocket.send(
      encodeFirstDraftMessage({
        type: "connect-first-draft-session",
        ...session("limited-b", documentOne),
      }),
    );
    await expect(documentLimit).resolves.toMatchObject({
      code: "document-not-available",
      fatal: true,
    });

    const accepted = waitForMessage(
      firstSocket,
      (message) => message.type === "editor-transaction-accepted",
    );
    firstSocket.send(await createTextTransactionFrame("limited-first"));
    await accepted;
    const transactionLimit = waitForMessage(
      firstSocket,
      (message) => message.type === "first-draft-protocol-error",
    );
    firstSocket.send(await createTextTransactionFrame("limited-second"));
    await expect(transactionLimit).resolves.toMatchObject({
      code: "transaction-rate-limit",
      fatal: true,
    });

    const messageServer = await startTestEditorRealtimeServer({
      config: {
        ...testConfig(),
        port: 0,
        limits: {
          ...testConfig().limits,
          messagesPerWindow: 1,
        },
      },
      persistence: acceptingPersistence(),
    });
    try {
      const messageSocket = await openSocket(messageServer);
      const identity = session("message-rate", documentTwo);
      await establishSession(messageSocket, identity);
      const messageLimit = waitForMessage(
        messageSocket,
        (message) => message.type === "first-draft-protocol-error",
      );
      messageSocket.send(
        encodeFirstDraftMessage({
          type: "subscribe-first-draft-document",
          documentId: documentTwo,
        }),
      );
      await expect(messageLimit).resolves.toMatchObject({
        code: "message-rate-limit",
        fatal: true,
      });
      await closeSocket(messageSocket);
    } finally {
      await messageServer.close();
    }
  });

  it("accepts exactly 600 transactions, resets the window, and rejects transaction 601", async () => {
    const scheduler = manualTimeoutScheduler();
    const accept = vi.fn(acceptingPersistence().accept);
    const persistence: FirstDraftTransactionPersistence = { accept };
    server = await startTestEditorRealtimeServer({
      config: testConfig({
        messagesPerWindow: 5_000,
        transactionsPerWindow: 600,
        transactionWindowMs: 60_000,
        pendingTransactionsPerDocument: 1_000,
      }),
      persistence,
      selectionPresenceScheduler: scheduler,
    });
    const socket = await connectSession(
      server,
      session("transaction-boundary", documentOne),
    );
    sockets.push(socket);
    const frame = await createTextTransactionFrame("transaction-boundary");
    let accepted = 0;
    socket.on("message", (data, isBinary) => {
      if (!isBinary) return;
      const decoded = decodeFirstDraftMessage(toArrayBufferView(data));
      if (decoded.ok && decoded.message.type === "editor-transaction-accepted") {
        accepted += 1;
      }
    });

    for (let index = 0; index < 600; index += 1) socket.send(frame);
    await waitFor(() => accepted === 600);
    expect(accept).toHaveBeenCalledTimes(600);

    scheduler.advanceBy(60_000);
    for (let index = 0; index < 600; index += 1) socket.send(frame);
    await waitFor(() => accepted === 1_200);
    const rejected = waitForMessage(
      socket,
      (message) => message.type === "first-draft-protocol-error",
    );
    socket.send(frame);
    await expect(rejected).resolves.toMatchObject({
      code: "transaction-rate-limit",
      fatal: true,
    });
    expect(accept).toHaveBeenCalledTimes(1_200);
  });

  it("accepts exactly 2400 inbound messages, resets the window, and rejects message 2401", async () => {
    const scheduler = manualTimeoutScheduler();
    server = await startTestEditorRealtimeServer({
      config: testConfig({
        messagesPerWindow: 2_400,
        messageWindowMs: 60_000,
      }),
      persistence: acceptingPersistence(),
      selectionPresenceScheduler: scheduler,
    });
    const identity = session("message-boundary", documentOne);
    const socket = await connectSession(server, identity);
    const peer = await connectSession(server, session("message-peer", documentOne));
    sockets.push(socket, peer);
    const revisionZero = encodeFirstDraftMessage(
      participantMessage(identity, 0, true),
    );
    const revisionOne = encodeFirstDraftMessage(
      participantMessage(identity, 1, true),
    );
    const firstBoundary = waitForMessage(
      peer,
      (message) =>
        message.type === "first-draft-participant-update" &&
        message.presenceRevision === 1,
    );
    socket.send(revisionZero);
    for (let index = 0; index < 2_396; index += 1) socket.send(revisionZero);
    socket.send(revisionOne);
    await firstBoundary;

    scheduler.advanceBy(60_000);
    const revisionTwo = encodeFirstDraftMessage(
      participantMessage(identity, 2, true),
    );
    const revisionThree = encodeFirstDraftMessage(
      participantMessage(identity, 3, true),
    );
    const secondBoundary = waitForMessage(
      peer,
      (message) =>
        message.type === "first-draft-participant-update" &&
        message.presenceRevision === 3,
    );
    socket.send(revisionTwo);
    for (let index = 0; index < 2_398; index += 1) socket.send(revisionTwo);
    socket.send(revisionThree);
    await secondBoundary;
    const rejected = waitForMessage(
      socket,
      (message) => message.type === "first-draft-protocol-error",
    );
    socket.send(revisionThree);
    await expect(rejected).resolves.toMatchObject({
      code: "message-rate-limit",
      fatal: true,
    });
    expect(peer.readyState).toBe(WebSocket.OPEN);
  });

  it("counts raw malformed and presence traffic against an exact byte window and resets it", async () => {
    const scheduler = manualTimeoutScheduler();
    const identityA = session("byte-limit-a", documentOne);
    const connectFrame = encodeFirstDraftMessage({
      type: "connect-first-draft-session",
      ...identityA,
    });
    const subscribeFrame = encodeFirstDraftMessage({
      type: "subscribe-first-draft-document",
      documentId: documentOne,
    });
    const participantFrame = encodeFirstDraftMessage(
      participantMessage(identityA, 0, true),
    );
    const selectionFrame = encodeFirstDraftMessage(
      selectionMessage(identityA, 0, blockSelection()),
    );
    const exactBytes =
      connectFrame.byteLength +
      subscribeFrame.byteLength +
      selectionFrame.byteLength +
      participantFrame.byteLength;
    server = await startTestEditorRealtimeServer({
      config: testConfig({
        bytesPerWindow: exactBytes,
        byteWindowMs: 60_000,
      }),
      persistence: acceptingPersistence(),
      selectionPresenceScheduler: scheduler,
    });
    const first = await connectSession(server, identityA);
    sockets.push(first);
    const participantAccepted = waitForMessage(
      first,
      (message) =>
        message.type === "first-draft-participant-snapshot" &&
        message.participants.some(({ subject: candidate }) =>
          firstDraftSubjectsEqual(candidate, subject(identityA)),
        ),
    );
    first.send(selectionFrame);
    first.send(participantFrame);
    await participantAccepted;
    const exhausted = waitForMessage(
      first,
      (message) => message.type === "first-draft-protocol-error",
    );
    first.send(Uint8Array.of(0));
    await expect(exhausted).resolves.toMatchObject({
      code: "byte-rate-limit",
      fatal: true,
    });

    const identityB = session("byte-limit-b", documentOne);
    const second = await connectSession(server, identityB);
    sockets.push(second);
    const secondParticipantAccepted = waitForMessage(
      second,
      (message) =>
        message.type === "first-draft-participant-snapshot" &&
        message.participants.some(({ subject: candidate }) =>
          firstDraftSubjectsEqual(candidate, subject(identityB)),
        ),
    );
    second.send(
      encodeFirstDraftMessage(participantMessage(identityB, 0, true)),
    );
    await secondParticipantAccepted;
    scheduler.advanceBy(60_000);
    const malformed = waitForMessage(
      second,
      (message) =>
        message.type === "first-draft-protocol-error" &&
        message.code === "invalid-message",
    );
    second.send(Uint8Array.of(0));
    await expect(malformed).resolves.toMatchObject({ fatal: false });
    expect(second.readyState).toBe(WebSocket.OPEN);
  });

  it("charges malformed binary traffic to both the general message and byte budgets", async () => {
    const identity = session("malformed-budget", documentOne);
    const connectFrame = encodeFirstDraftMessage({
      type: "connect-first-draft-session",
      ...identity,
    });
    const subscribeFrame = encodeFirstDraftMessage({
      type: "subscribe-first-draft-document",
      documentId: documentOne,
    });
    server = await startTestEditorRealtimeServer({
      config: testConfig({
        messagesPerWindow: 3,
        bytesPerWindow:
          connectFrame.byteLength + subscribeFrame.byteLength + 1,
      }),
      persistence: acceptingPersistence(),
    });
    const socket = await connectSession(server, identity);
    sockets.push(socket);
    const malformed = waitForMessage(
      socket,
      (message) =>
        message.type === "first-draft-protocol-error" &&
        message.code === "invalid-message",
    );
    socket.send(Uint8Array.of(0));
    await malformed;

    const exhausted = waitForMessage(
      socket,
      (message) => message.type === "first-draft-protocol-error",
    );
    socket.send(Uint8Array.of(0));
    await expect(exhausted).resolves.toMatchObject({
      code: "message-rate-limit",
      fatal: true,
    });
  });

  it("accepts a proposed transaction at its exact frame boundary and rejects one byte over before persistence", async () => {
    const exactFrame = await createTextTransactionFrame("frame-boundary");
    const transaction = decodeProposedTransaction(exactFrame);
    const oversizedFrame = encodeFirstDraftMessage({
      type: "proposed-editor-transaction",
      transaction: {
        ...transaction,
        content: transaction.content.map((entry, index) =>
          index === 0
            ? {
                ...entry,
                readProjection: appendToFirstRichTextNode(
                  entry.readProjection,
                  "Z",
                ),
              }
            : entry,
        ),
      },
    });
    expect(oversizedFrame.byteLength).toBe(exactFrame.byteLength + 1);
    const accept = vi.fn(acceptingPersistence().accept);
    server = await startTestEditorRealtimeServer({
      config: testConfig({ clientFrameBytes: exactFrame.byteLength }),
      persistence: { accept },
    });
    const socket = await connectSession(
      server,
      session("frame-boundary", documentOne),
    );
    sockets.push(socket);
    const accepted = waitForMessage(
      socket,
      (message) => message.type === "editor-transaction-accepted",
    );
    socket.send(exactFrame);
    await accepted;
    expect(accept).toHaveBeenCalledOnce();

    const rejected = waitForMessage(
      socket,
      (message) => message.type === "first-draft-protocol-error",
    );
    socket.send(oversizedFrame);
    await expect(rejected).resolves.toMatchObject({
      code: "client-frame-too-large",
      fatal: true,
    });
    expect(accept).toHaveBeenCalledOnce();
  });

  it("rejects an oversized fragmented client message before decode or persistence admission", async () => {
    const accept = vi.fn(acceptingPersistence().accept);
    server = await startTestEditorRealtimeServer({
      config: testConfig({ clientFrameBytes: 1_024 }),
      persistence: { accept },
    });
    const socket = await connectSession(
      server,
      session("fragmented-frame", documentOne),
    );
    sockets.push(socket);
    const rejected = waitForMessage(
      socket,
      (message) => message.type === "first-draft-protocol-error",
    );
    const firstFragment = new Uint8Array(700).fill(0x41);
    const secondFragment = new Uint8Array(700).fill(0x42);
    socket.send(firstFragment, { binary: true, fin: false });
    socket.send(secondFragment, { binary: true, fin: true });

    await expect(rejected).resolves.toMatchObject({
      code: "client-frame-too-large",
      fatal: true,
    });
    expect(accept).not.toHaveBeenCalled();
  });

  it("admits backlog capacity exactly, isolates documents, rejects overflow, and restores capacity after success", async () => {
    const first = deferred<
      Awaited<ReturnType<FirstDraftTransactionPersistence["accept"]>>
    >();
    const second = deferred<
      Awaited<ReturnType<FirstDraftTransactionPersistence["accept"]>>
    >();
    let documentOneInvocation = 0;
    const accept = vi.fn<FirstDraftTransactionPersistence["accept"]>(
      ({ documentId, transaction }) => {
        if (documentId === documentTwo) {
          return Promise.resolve(
            acceptedResult(documentId, transaction.transactionId, 0, 1, transaction),
          );
        }
        documentOneInvocation += 1;
        if (documentOneInvocation === 1) return first.promise;
        if (documentOneInvocation === 2) return second.promise;
        return Promise.resolve(
          acceptedResult(documentId, transaction.transactionId, 2, 3, transaction),
        );
      },
    );
    server = await startTestEditorRealtimeServer({
      config: testConfig({ pendingTransactionsPerDocument: 2 }),
      persistence: { accept },
    });
    const overloaded = await connectSession(
      server,
      session("backlog-one", documentOne),
    );
    const independent = await connectSession(
      server,
      session("backlog-two", documentTwo),
    );
    sockets.push(overloaded, independent);
    const frameOne = await createTextTransactionFrame("backlog-one");
    const frameTwo = await createTextTransactionFrame("backlog-two");
    const frameRejected = await createTextTransactionFrame("backlog-rejected");
    overloaded.send(frameOne);
    overloaded.send(frameTwo);
    await waitFor(() => server?.pendingPersistenceCount(documentOne) === 2);
    expect(accept).toHaveBeenCalledOnce();

    const independentAccepted = waitForMessage(
      independent,
      (message) => message.type === "editor-transaction-accepted",
    );
    independent.send(await createTextTransactionFrame("independent-document"));
    await independentAccepted;
    expect(server.pendingPersistenceCount(documentTwo)).toBe(0);

    const overflow = waitForMessage(
      overloaded,
      (message) => message.type === "first-draft-protocol-error",
    );
    overloaded.send(frameRejected);
    await expect(overflow).resolves.toMatchObject({
      code: "persistence-backlog-limit",
      fatal: true,
    });
    expect(
      accept.mock.calls.some(
        ([input]) => input.transaction.transactionId === "backlog-rejected",
      ),
    ).toBe(false);

    first.resolve(
      acceptedResult(
        documentOne,
        "backlog-one",
        0,
        1,
        decodeProposedTransaction(frameOne),
      ),
    );
    await waitFor(() => documentOneInvocation === 2);
    second.resolve(
      acceptedResult(
        documentOne,
        "backlog-two",
        1,
        2,
        decodeProposedTransaction(frameTwo),
      ),
    );
    await waitFor(() => server?.pendingPersistenceCount(documentOne) === 0);

    const replacement = await connectSession(
      server,
      session("backlog-replacement", documentOne),
    );
    sockets.push(replacement);
    const replacementAccepted = waitForMessage(
      replacement,
      (message) => message.type === "editor-transaction-accepted",
    );
    replacement.send(await createTextTransactionFrame("backlog-restored"));
    await replacementAccepted;
    expect(server.pendingPersistenceCount(documentOne)).toBe(0);
  });

  it.each(["returned failure", "thrown error"] as const)(
    "restores backlog capacity after a %s",
    async (failureKind) => {
      const failureId = failureKind === "returned failure" ? "returned" : "thrown";
      let invocation = 0;
      const accept = vi.fn<FirstDraftTransactionPersistence["accept"]>(
        ({ documentId, transaction }) => {
          invocation += 1;
          if (invocation === 1) {
            if (failureKind === "thrown error") {
              return Promise.reject(new Error("persistence exploded"));
            }
            return Promise.resolve({
              ok: false,
              reason: "invalid",
              retryable: false,
              message: "semantic rejection",
            });
          }
          return Promise.resolve(
            acceptedResult(documentId, transaction.transactionId, 0, 1, transaction),
          );
        },
      );
      const isolatedServer = await startTestEditorRealtimeServer({
        config: { ...testConfig({ pendingTransactionsPerDocument: 1 }), port: 0 },
        persistence: { accept },
      });
      try {
        const socket = await connectSession(
          isolatedServer,
          session(`backlog-${failureId}`, documentOne),
        );
        const failed = waitForMessage(
          socket,
          (message) =>
            message.type === "editor-transaction-persistence-failed",
        );
        socket.send(await createTextTransactionFrame(`failed-${failureId}`));
        await failed;
        await waitFor(
          () => isolatedServer.pendingPersistenceCount(documentOne) === 0,
        );
        const accepted = waitForMessage(
          socket,
          (message) => message.type === "editor-transaction-accepted",
        );
        socket.send(await createTextTransactionFrame(`restored-${failureId}`));
        await accepted;
        expect(accept).toHaveBeenCalledTimes(2);
        await closeSocket(socket);
      } finally {
        await isolatedServer.close();
      }
    },
  );

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
    await establishSession(socketB, identityB);
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

  it("treats reordered participant retries as equal and rejects real same-revision changes", async () => {
    const diagnostics = vi.fn();
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
      onProtocolDiagnostic: diagnostics,
    });
    const identityA = session("ordered-participant-a", documentOne);
    const identityB = session("ordered-participant-b", documentOne);
    const socketA = await connectSession(server, identityA);
    const socketB = await connectSession(server, identityB);
    sockets.push(socketA, socketB);

    const initial = participantMessage(identityA, 0, true);
    const initialFrame = encodeFirstDraftMessage(initial);
    const firstUpdate = waitForMessage(
      socketB,
      (message) => message.type === "first-draft-participant-update",
    );
    socketA.send(initialFrame);
    await expect(firstUpdate).resolves.toMatchObject({
      ...initial,
      metadata: {
        displayName: expect.stringMatching(/^Visitor [a-z0-9]{6}$/u),
        color: expect.stringMatching(/^#[0-9a-f]{6}$/u),
      },
    });

    const reordered = {
      metadata: { color: "#123abc", displayName: identityA.actorId },
      active: true,
      presenceRevision: 0,
      subject: {
        sessionId: identityA.sessionId,
        clientId: identityA.clientId,
        actorId: identityA.actorId,
      },
      documentId: identityA.documentId,
      type: "first-draft-participant-update",
    } satisfies FirstDraftParticipantUpdateMessage;
    const reorderedFrame = encodeFirstDraftMessage(reordered);
    const initialJson = encodedMetadataText(initialFrame);
    const reorderedJson = encodedMetadataText(reorderedFrame);
    expect(initialJson.indexOf('"type"')).toBeLessThan(
      initialJson.indexOf('"metadata"'),
    );
    expect(reorderedJson.indexOf('"metadata"')).toBeLessThan(
      reorderedJson.indexOf('"type"'),
    );
    expect(initialJson.indexOf('"actorId"')).toBeLessThan(
      initialJson.indexOf('"sessionId"'),
    );
    expect(reorderedJson.indexOf('"sessionId"')).toBeLessThan(
      reorderedJson.indexOf('"actorId"'),
    );
    expect(initialJson.indexOf('"displayName"')).toBeLessThan(
      initialJson.indexOf('"color"'),
    );
    expect(reorderedJson.indexOf('"color"')).toBeLessThan(
      reorderedJson.indexOf('"displayName"'),
    );

    const retrySilence = expectNoMessage(
      socketB,
      (message) => message.type === "first-draft-participant-update",
      50,
    );
    socketA.send(reorderedFrame);
    await retrySilence;
    expect(diagnostics).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "presence-revision-conflict" }),
    );

    const identityC = session("ordered-participant-c", documentOne);
    const socketC = await openSocket(server);
    sockets.push(socketC);
    await establishSession(socketC, identityC);
    const [, snapshot] = await subscribeSession(socketC, identityC);
    expect(snapshot).toMatchObject({
      participants: [
        expect.objectContaining({
          subject: subject(identityA),
          presenceRevision: 0,
          active: true,
          metadata: {
            displayName: expect.stringMatching(/^Visitor [a-z0-9]{6}$/u),
            color: expect.stringMatching(/^#[0-9a-f]{6}$/u),
          },
        }),
      ],
    });

    const higherUpdate = waitForMessage(
      socketB,
      (message) =>
        message.type === "first-draft-participant-update" &&
        message.presenceRevision === 1,
    );
    socketA.send(
      encodeFirstDraftMessage(participantMessage(identityA, 1, true)),
    );
    await higherUpdate;

    const conflicts: FirstDraftParticipantUpdateMessage[] = [
      participantMessage(identityA, 1, false),
    ];
    for (const conflict of conflicts) {
      const error = waitForMessage(
        socketA,
        (message) => message.type === "first-draft-protocol-error",
      );
      const peerSilence = expectNoMessage(
        socketB,
        (message) => message.type === "first-draft-participant-update",
        50,
      );
      socketA.send(encodeFirstDraftMessage(conflict));
      await expect(error).resolves.toMatchObject({
        code: "presence-revision-conflict",
      });
      await peerSilence;
    }

    const spoofedMetadataSilence = expectNoMessage(
      socketB,
      (message) => message.type === "first-draft-participant-update",
      50,
    );
    socketA.send(
      encodeFirstDraftMessage({
        ...participantMessage(identityA, 1, true),
        metadata: { displayName: "Different", color: "#abcdef" },
      }),
    );
    await spoofedMetadataSilence;

    const identityD = session("ordered-participant-d", documentOne);
    const socketD = await openSocket(server);
    sockets.push(socketD);
    await establishSession(socketD, identityD);
    const [, finalSnapshot] = await subscribeSession(socketD, identityD);
    expect(finalSnapshot).toMatchObject({
      participants: [
        expect.objectContaining({
          subject: subject(identityA),
          presenceRevision: 1,
          active: true,
          metadata: {
            displayName: expect.stringMatching(/^Visitor [a-z0-9]{6}$/u),
            color: expect.stringMatching(/^#[0-9a-f]{6}$/u),
          },
        }),
      ],
    });
  });

  it("uses JSON semantics for block-internal selection retries", async () => {
    const diagnostics = vi.fn();
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
      onProtocolDiagnostic: diagnostics,
    });
    const identityA = session("ordered-selection-a", documentOne);
    const identityB = session("ordered-selection-b", documentOne);
    const socketA = await connectSession(server, identityA);
    const socketB = await connectSession(server, identityB);
    sockets.push(socketA, socketB);

    const initialSelection = blockInternalSelection({
      outer: { first: 1, second: { enabled: true, label: "cell" } },
      order: [1, 2],
    });
    const initialFrame = encodeFirstDraftMessage(
      selectionMessage(identityA, 0, initialSelection),
    );
    const firstUpdate = waitForMessage(
      socketB,
      (message) => message.type === "first-draft-selection-update",
    );
    socketA.send(initialFrame);
    await firstUpdate;

    const reorderedSelection = blockInternalSelection({
      order: [1, 2],
      outer: { second: { label: "cell", enabled: true }, first: 1 },
    });
    const reorderedFrame = encodeFirstDraftMessage(
      selectionMessage(identityA, 0, reorderedSelection),
    );
    const initialJson = encodedMetadataText(initialFrame);
    const reorderedJson = encodedMetadataText(reorderedFrame);
    expect(initialJson.indexOf('"first"')).toBeLessThan(
      initialJson.indexOf('"second"'),
    );
    expect(reorderedJson.indexOf('"second"')).toBeLessThan(
      reorderedJson.indexOf('"first"'),
    );

    const retrySilence = expectNoMessage(
      socketB,
      (message) => message.type === "first-draft-selection-update",
      50,
    );
    socketA.send(reorderedFrame);
    await retrySilence;
    expect(diagnostics).not.toHaveBeenCalledWith(
      expect.objectContaining({ code: "selection-revision-conflict" }),
    );

    const identityC = session("ordered-selection-c", documentOne);
    const socketC = await openSocket(server);
    sockets.push(socketC);
    await establishSession(socketC, identityC);
    const [, , snapshot] = await subscribeSession(socketC, identityC);
    expect(snapshot).toMatchObject({
      selections: [
        expect.objectContaining({
          subject: subject(identityA),
          selectionRevision: 0,
          selection: initialSelection,
        }),
      ],
    });

    const conflict = waitForMessage(
      socketA,
      (message) => message.type === "first-draft-protocol-error",
    );
    const conflictSilence = expectNoMessage(
      socketB,
      (message) => message.type === "first-draft-selection-update",
      50,
    );
    socketA.send(
      encodeFirstDraftMessage(
        selectionMessage(
          identityA,
          0,
          blockInternalSelection({
            outer: { first: 1, second: { enabled: true, label: "cell" } },
            order: [2, 1],
          }),
        ),
      ),
    );
    await expect(conflict).resolves.toMatchObject({
      code: "selection-revision-conflict",
    });
    await conflictSilence;
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
    await establishSession(socketC, identityC);
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
      code: "presence-session-mismatch",
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

  it("fans out an accepted canonical frame only after persistence to peers in the established document", async () => {
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
    await establishSession(joining, joiningIdentity);
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

  it("holds reconnect catch-up behind persistence already admitted on the old socket", async () => {
    const persistenceGate = deferred<void>();
    const diagnostics = vi.fn();
    let persisted:
      | {
          readonly transaction: ReturnType<typeof decodeProposedTransaction>;
          readonly acceptedAt: number;
        }
      | undefined;
    const accept = vi.fn<FirstDraftTransactionPersistence["accept"]>(
      async ({ documentId, transaction }) => {
        await persistenceGate.promise;
        persisted = { transaction, acceptedAt: 1 };
        return acceptedResult(documentId, transaction.transactionId, 0, 1, transaction);
      },
    );
    const loadAcceptedTransactions = vi.fn(async (_documentId: string, revision: number) => ({
      ok: true as const,
      requestedRevision: revision,
      currentRevision: persisted ? 1 : 0,
      transactions: persisted
        ? [
            {
              transactionId: persisted.transaction.transactionId,
              baseRevision: 0,
              revision: 1,
              acceptedAt: persisted.acceptedAt,
              transaction: persisted.transaction,
            },
          ]
        : [],
    }));
    server = await startEditorRealtimeServer({
      config: testConfig(),
      persistence: { accept },
      documentLoader: {
        loadBootstrap: async () => ({
          ok: true as const,
          bootstrap: createFirstDraftBootstrapFromSnapshot({
            documentId: documentOne,
            revision: 0,
            snapshot: testDocumentSnapshot,
          }),
        }),
        loadAcceptedTransactions,
      },
      onProtocolDiagnostic: diagnostics,
    });
    const identity = session("persistence-barrier", documentOne);
    const oldSocket = await connectSession(server, identity);
    sockets.push(oldSocket);
    const frame = await createTextTransactionFrame("persistence-barrier:transaction");
    oldSocket.send(frame);
    await vi.waitFor(() => expect(accept).toHaveBeenCalledOnce());
    await closeSocket(oldSocket);

    const replacement = await openSocket(server);
    sockets.push(replacement);
    await establishSession(replacement, session("persistence-barrier-replacement", documentOne));
    const received: FirstDraftMessage[] = [];
    replacement.on("message", (data, isBinary) => {
      if (!isBinary) return;
      const decoded = decodeFirstDraftMessage(toArrayBufferView(data));
      if (decoded.ok) received.push(decoded.message);
    });
    const caughtUp = waitForMessage(
      replacement,
      (message) => message.type === "first-draft-document-caught-up",
    ).catch((error: unknown) => error);
    replacement.send(
      encodeFirstDraftMessage({
        type: "subscribe-first-draft-document",
        documentId: documentOne,
        knownRevision: 0,
      }),
    );
    await delay(20);
    expect(loadAcceptedTransactions).not.toHaveBeenCalled();

    persistenceGate.resolve();
    await delay(20);
    expect(diagnostics.mock.calls).toEqual([]);
    await expect(caughtUp).resolves.toMatchObject({
      requestedRevision: 0,
      revision: 1,
    });
    expect(received).toContainEqual(
      expect.objectContaining({
        type: "first-draft-accepted-transaction-replay",
        transactionId: "persistence-barrier:transaction",
        baseRevision: 0,
        revision: 1,
      }),
    );
    expect(loadAcceptedTransactions).toHaveBeenCalledWith(documentOne, 0);
    expect(diagnostics).not.toHaveBeenCalled();
  });

  it("resumes from a known revision with contiguous replay and no full bootstrap", async () => {
    const firstFrame = await createTextTransactionFrame("resume-one");
    const secondFrame = await createTextTransactionFrame("resume-two");
    const firstTransaction = decodeProposedTransaction(firstFrame);
    const secondTransaction = decodeProposedTransaction(secondFrame);
    const loadAcceptedTransactions = vi.fn(async () => ({
      ok: true as const,
      requestedRevision: 3,
      currentRevision: 5,
      transactions: [
        {
          transactionId: "resume-one",
          baseRevision: 3,
          revision: 4,
          acceptedAt: 4,
          transaction: firstTransaction,
        },
        {
          transactionId: "resume-two",
          baseRevision: 4,
          revision: 5,
          acceptedAt: 5,
          transaction: secondTransaction,
        },
      ],
    }));
    server = await startEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
      documentLoader: {
        loadBootstrap: async () => {
          throw new Error("resume path must not load a bootstrap");
        },
        loadAcceptedTransactions,
      },
    });
    const identity = session("resume", documentOne);
    const socket = await openSocket(server);
    sockets.push(socket);
    await establishSession(socket, identity);
    const messages: FirstDraftMessage[] = [];
    socket.on("message", (data, isBinary) => {
      if (!isBinary) return;
      const decoded = decodeFirstDraftMessage(toArrayBufferView(data));
      if (decoded.ok) messages.push(decoded.message);
    });
    const caughtUp = waitForMessage(
      socket,
      (message) => message.type === "first-draft-document-caught-up",
    );
    socket.send(
      encodeFirstDraftMessage({
        type: "subscribe-first-draft-document",
        documentId: documentOne,
        knownRevision: 3,
      }),
    );
    await expect(caughtUp).resolves.toMatchObject({
      requestedRevision: 3,
      revision: 5,
    });
    expect(loadAcceptedTransactions).toHaveBeenCalledWith(documentOne, 3);
    expect(
      messages
        .filter(
          (message) =>
            message.type === "first-draft-accepted-transaction-replay",
        )
        .map((message) => message.transactionId),
    ).toEqual(["resume-one", "resume-two"]);
    expect(
      messages.some(
        (message) => message.type === "first-draft-document-loaded",
      ),
    ).toBe(false);
  });

  it("activates an already-current known revision without replay or presence before catch-up", async () => {
    server = await startEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
      documentLoader: {
        loadBootstrap: async () => {
          throw new Error("current resume must not load a bootstrap");
        },
        loadAcceptedTransactions: async (_documentId, revision) => ({
          ok: true as const,
          requestedRevision: revision,
          currentRevision: revision,
          transactions: [],
        }),
      },
    });
    const identity = session("already-current", documentOne);
    const socket = await openSocket(server);
    sockets.push(socket);
    await establishSession(socket, identity);
    const messages: FirstDraftMessage[] = [];
    socket.on("message", (data, isBinary) => {
      if (!isBinary) return;
      const decoded = decodeFirstDraftMessage(toArrayBufferView(data));
      if (decoded.ok) messages.push(decoded.message);
    });
    const caughtUp = waitForMessage(
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
        documentId: documentOne,
        knownRevision: 8,
      }),
    );
    await expect(caughtUp).resolves.toMatchObject({
      requestedRevision: 8,
      revision: 8,
    });
    await Promise.all([participants, selections]);
    expect(
      messages.filter(
        (message) =>
          message.type === "first-draft-accepted-transaction-replay",
      ),
    ).toEqual([]);
    const caughtIndex = messages.findIndex(
      (message) => message.type === "first-draft-document-caught-up",
    );
    const participantIndex = messages.findIndex(
      (message) => message.type === "first-draft-participant-snapshot",
    );
    const selectionIndex = messages.findIndex(
      (message) => message.type === "first-draft-selection-snapshot",
    );
    expect(caughtIndex).toBeGreaterThanOrEqual(0);
    expect(participantIndex).toBeGreaterThan(caughtIndex);
    expect(selectionIndex).toBeGreaterThan(participantIndex);
  });

  it.each([
    ["missing", true],
    ["unavailable", false],
  ] as const)(
    "maps a %s replay load failure intentionally",
    async (reason, fatal) => {
      server = await startEditorRealtimeServer({
        config: testConfig(),
        persistence: acceptingPersistence(),
        documentLoader: {
          loadBootstrap: async () => {
            throw new Error("unexpected bootstrap");
          },
          loadAcceptedTransactions: async () => ({
            ok: false as const,
            reason,
            message: "Safe replay failure",
          }),
        },
      });
      const identity = session(`replay-${reason}`, documentOne);
      const socket = await openSocket(server);
      sockets.push(socket);
      await establishSession(socket, identity);
      const error = waitForMessage(
        socket,
        (message) => message.type === "first-draft-protocol-error",
      );
      socket.send(
        encodeFirstDraftMessage({
          type: "subscribe-first-draft-document",
          documentId: documentOne,
          knownRevision: 1,
        }),
      );
      await expect(error).resolves.toMatchObject({
        code: `document-replay-${reason}`,
        fatal,
      });
    },
  );

  it("deduplicates a transaction returned by persistence and queued during replay loading", async () => {
    const loading = deferred<{
      readonly ok: true;
      readonly requestedRevision: number;
      readonly currentRevision: number;
      readonly transactions: readonly [{
        readonly transactionId: string;
        readonly baseRevision: number;
        readonly revision: number;
        readonly acceptedAt: number;
        readonly transaction: ReturnType<typeof decodeProposedTransaction>;
      }];
    }>();
    const persistence = acceptingPersistence();
    server = await startEditorRealtimeServer({
      config: testConfig(),
      persistence,
      documentLoader: {
        loadBootstrap: async (documentId) => ({
          ok: true as const,
          bootstrap: createFirstDraftBootstrapFromSnapshot({
            documentId,
            revision: 0,
            snapshot: testDocumentSnapshot,
          }),
        }),
        loadAcceptedTransactions: async () => loading.promise,
      },
    });
    const joiningIdentity = session("resume-race", documentOne);
    const joining = await openSocket(server);
    sockets.push(joining);
    await establishSession(joining, joiningIdentity);
    let replayCount = 0;
    joining.on("message", (data, isBinary) => {
      if (!isBinary) return;
      const decoded = decodeFirstDraftMessage(toArrayBufferView(data));
      if (
        decoded.ok &&
        decoded.message.type === "first-draft-accepted-transaction-replay"
      ) replayCount += 1;
    });
    joining.send(
      encodeFirstDraftMessage({
        type: "subscribe-first-draft-document",
        documentId: documentOne,
        knownRevision: 0,
      }),
    );
    const author = await connectSession(
      server,
      session("resume-race-author", documentOne),
    );
    sockets.push(author);
    const frame = await createTextTransactionFrame("resume-race-transaction");
    const accepted = waitForMessage(
      author,
      (message) => message.type === "editor-transaction-accepted",
    );
    author.send(frame);
    await expect(accepted).resolves.toMatchObject({ revision: 1 });
    const caughtUp = waitForMessage(
      joining,
      (message) => message.type === "first-draft-document-caught-up",
    );
    loading.resolve({
      ok: true,
      requestedRevision: 0,
      currentRevision: 1,
      transactions: [
        {
          transactionId: "resume-race-transaction",
          baseRevision: 0,
          revision: 1,
          acceptedAt: 1,
          transaction: decodeProposedTransaction(frame),
        },
      ],
    });
    await expect(caughtUp).resolves.toMatchObject({ revision: 1 });
    await delay(20);
    expect(replayCount).toBe(1);
  });

  it.each([
    [
      "conflicting revisions",
      [
        ["conflict-a", 0, 1],
        ["conflict-b", 0, 1],
      ] as const,
      "revision-replay-conflict",
    ],
    [
      "a revision gap",
      [["gap", 1, 2]] as const,
      "revision-replay-non-contiguous",
    ],
  ])("fails safely on %s", async (_label, entries, expectedCode) => {
    const frames = await Promise.all(
      entries.map(([transactionId]) =>
        createTextTransactionFrame(transactionId),
      ),
    );
    server = await startEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
      documentLoader: {
        loadBootstrap: async () => {
          throw new Error("unexpected bootstrap");
        },
        loadAcceptedTransactions: async () => ({
          ok: true as const,
          requestedRevision: 0,
          currentRevision: 2,
          transactions: entries.map(
            ([transactionId, baseRevision, revision], index) => ({
              transactionId,
              baseRevision,
              revision,
              acceptedAt: revision,
              transaction: decodeProposedTransaction(frames[index]!),
            }),
          ),
        }),
      },
    });
    const identity = session(`invalid-${expectedCode}`, documentOne);
    const socket = await openSocket(server);
    sockets.push(socket);
    await establishSession(socket, identity);
    const error = waitForMessage(
      socket,
      (message) => message.type === "first-draft-protocol-error",
    );
    socket.send(
      encodeFirstDraftMessage({
        type: "subscribe-first-draft-document",
        documentId: documentOne,
        knownRevision: 0,
      }),
    );
    await expect(error).resolves.toMatchObject({
      code: expectedCode,
      fatal: true,
    });
  });

  it("uses an explicit authoritative resynchronization when a revision is ahead", async () => {
    const loadBootstrap = vi.fn(async (documentId: string) => ({
      ok: true as const,
      bootstrap: createFirstDraftBootstrapFromSnapshot({
        documentId,
        revision: 2,
        snapshot: testDocumentSnapshot,
      }),
    }));
    server = await startEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
      documentLoader: {
        loadBootstrap,
        loadAcceptedTransactions: async () => ({
          ok: false as const,
          reason: "revision-unavailable" as const,
          resynchronizationReason: "revision-ahead" as const,
          message: "unavailable",
        }),
      },
    });
    const identity = session("ahead", documentOne);
    const socket = await openSocket(server);
    sockets.push(socket);
    await establishSession(socket, identity);
    const resynchronized = waitForMessage(
      socket,
      (message) =>
        message.type === "first-draft-document-resynchronized",
    );
    const caughtUp = waitForMessage(
      socket,
      (message) => message.type === "first-draft-document-caught-up",
    );
    socket.send(
      encodeFirstDraftMessage({
        type: "subscribe-first-draft-document",
        documentId: documentOne,
        knownRevision: 9,
      }),
    );
    await expect(resynchronized).resolves.toMatchObject({
      requestedRevision: 9,
      revision: 2,
      reason: "revision-ahead",
    });
    await expect(caughtUp).resolves.toMatchObject({
      requestedRevision: 2,
      revision: 2,
    });
    expect(loadBootstrap).toHaveBeenCalledOnce();
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
      const outboundA = createImmediateTestOutbound({
        readyState: WebSocket.OPEN,
        send: (frame) => framesA.push(frame.slice(0)),
      });
      const outboundB = createImmediateTestOutbound({
        readyState: WebSocket.OPEN,
        send: (frame) => framesB.push(frame.slice(0)),
      });
      const editorA = initializeEditableEditor({
        definition: firstDraftDefinition(),
        snapshot,
        onContentRuntime: runtimeA.capture,
        onChange: outboundA.onChange,
        createTransactionId: ids(`concurrent-a-${receiveOrder.join("")}`),
      });
      const editorB = initializeEditableEditor({
        definition: firstDraftDefinition(),
        snapshot,
        onContentRuntime: runtimeB.capture,
        onChange: outboundB.onChange,
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
        outboundA.publisher,
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
        outboundB.publisher,
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
        outboundA.publisher.dispose();
        outboundB.publisher.dispose();
        editorA.dispose();
        editorB.dispose();
      }
    },
  );

  it("accepts a real delayed aggregate after a same-block remote transaction and both clients converge", async () => {
    const acceptedTransactions: Array<{
      readonly revision: number;
      readonly transaction: Parameters<
        FirstDraftTransactionPersistence["accept"]
      >[0]["transaction"];
    }> = [];
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: {
        accept: async ({ documentId, transaction }) => {
          const revision = acceptedTransactions.length + 1;
          acceptedTransactions.push({ revision, transaction });
          return {
            ok: true,
            status: "accepted",
            accepted: {
              documentId,
              transactionId: transaction.transactionId,
              baseRevision: revision - 1,
              revision,
              acceptedAt: revision,
            },
            transaction,
          };
        },
      },
    });
    const socketA = await connectSession(
      server,
      session("aggregate-a", documentOne),
    );
    const socketB = await connectSession(
      server,
      session("aggregate-b", documentOne),
    );
    sockets.push(socketA, socketB);
    const sourceIdsA: string[] = [];
    const publishedSelectionsA = vi.fn();
    let transactionFramesA = 0;
    const publisherA = createFirstDraftOutboundPublisher();
    publisherA.attachGeneration({
      generationId: "aggregate-generation-a",
      socket: {
        get readyState() {
          return socketA.readyState;
        },
        send(frame) {
          transactionFramesA += 1;
          socketA.send(frame);
        },
      },
      createTransactionId: ids("aggregate-a-outbound"),
      publishSelection: publishedSelectionsA,
    });
    publisherA.generationCaughtUp();
    const outboundB = createImmediateTestOutbound({
      get readyState() {
        return socketB.readyState;
      },
      send(frame) {
        socketB.send(frame);
      },
    });
    const runtimeA = createContentRuntimeCapture();
    const runtimeB = createContentRuntimeCapture();
    const editorA = initializeEditableEditor({
      definition: firstDraftDefinition(),
      snapshot: createFirstDraftSnapshot(),
      onContentRuntime: runtimeA.capture,
      createTransactionId: ids("aggregate-a-source"),
      onChange: (change) => {
        sourceIdsA.push(change.transactionId);
        publisherA.submitFinalized(change);
      },
    });
    const editorB = initializeEditableEditor({
      definition: firstDraftDefinition(),
      snapshot: createFirstDraftSnapshot(),
      onContentRuntime: runtimeB.capture,
      createTransactionId: ids("aggregate-b-source"),
      onChange: outboundB.onChange,
    });
    const editingLeaseA = runtimeA
      .read()
      .acquireBlockContent(textBlockId, "paragraph", "active-editing");
    const editingLeaseB = runtimeB
      .read()
      .acquireBlockContent(textBlockId, "paragraph", "active-editing");
    const protocolErrors = vi.fn();
    const revisionsA: number[] = [];
    const revisionsB: number[] = [];
    let remoteApplicationsA = 0;
    let remoteApplicationsB = 0;
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
        onProtocolError: protocolErrors,
        onApplied: () => {
          remoteApplicationsA += 1;
        },
        onRevisionAdvanced: (revision) => revisionsA.push(revision),
      },
      publisherA,
    );
    const disposeB = attachFirstDraftRemoteTransactions(
      connectionB,
      editorB,
      {
        onProtocolError: protocolErrors,
        onApplied: () => {
          remoteApplicationsB += 1;
        },
        onRevisionAdvanced: (revision) => revisionsB.push(revision),
      },
      outboundB.publisher,
    );

    try {
      expect(
        editorA.insertText({ blockId: textBlockId, offset: 0, text: "A" }),
      ).toBe(true);
      expect(
        editorA.insertText({ blockId: textBlockId, offset: 1, text: "C" }),
      ).toBe(true);
      expect(sourceIdsA).toHaveLength(2);
      expect(transactionFramesA).toBe(0);
      expect(publisherA.getSnapshot().pendingEntries).toBe(2);

      expect(
        editorB.insertText({ blockId: textBlockId, offset: 0, text: "B" }),
      ).toBe(true);
      await waitFor(() => remoteApplicationsA === 1);
      expect(publisherA.getSnapshot().pendingEntries).toBe(2);

      publisherA.flush("manual");
      await waitFor(
        () =>
          remoteApplicationsB === 1 &&
          publisherA.getSnapshot().outstanding.length === 0,
      );

      expect(protocolErrors).not.toHaveBeenCalled();
      expect(transactionFramesA).toBe(1);
      expect(publishedSelectionsA).toHaveBeenCalledOnce();
      expect(acceptedTransactions).toHaveLength(2);
      expect(acceptedTransactions.map(({ revision }) => revision)).toEqual([
        1, 2,
      ]);
      expect(revisionsA).toEqual([1, 2]);
      expect(revisionsB).toEqual([1, 2]);
      expect(text(editorA, textBlockId)).toBe(text(editorB, textBlockId));
      expect(text(editorA, textBlockId)).toContain("A");
      expect(text(editorA, textBlockId)).toContain("B");
      expect(text(editorA, textBlockId)).toContain("C");
      const aggregate = acceptedTransactions[1]!.transaction;
      expect(aggregate.transactionId).toBe("aggregate-a-outbound:1");
      expect(sourceIdsA).not.toContain(aggregate.transactionId);
      expect(
        acceptedTransactions.some(({ transaction }) =>
          sourceIdsA.includes(transaction.transactionId),
        ),
      ).toBe(false);
    } finally {
      editingLeaseB.release();
      editingLeaseA.release();
      disposeB();
      disposeA();
      connectionB.dispose();
      connectionA.dispose();
      outboundB.publisher.dispose();
      publisherA.dispose();
      editorB.dispose();
      editorA.dispose();
    }
  });

  it("collaborates through accepted transactions across two real clients without echo", async () => {
    server = await startTestEditorRealtimeServer({
      config: testConfig(),
      persistence: acceptingPersistence(),
    });
    const socketA = await connectSession(server, session("a", documentOne));
    const socketB = await connectSession(server, session("b", documentOne));
    sockets.push(socketA, socketB);
    let sentByB = 0;
    const senderA: FirstDraftOutboundSocket = {
      get readyState() {
        return socketA.readyState;
      },
      send(frame) {
        socketA.send(frame);
      },
    };
    const senderB: FirstDraftOutboundSocket = {
      get readyState() {
        return socketB.readyState;
      },
      send(frame) {
        sentByB += 1;
        socketB.send(frame);
      },
    };
    const outboundA = createImmediateTestOutbound(senderA);
    const outboundB = createImmediateTestOutbound(senderB);
    const editorA = addEditorBlockOperations(
      initializeEditableEditor({
        definition: firstDraftDefinition(),
        snapshot: createFirstDraftSnapshot(),
        onChange: outboundA.onChange,
        createTransactionId: ids("session-a"),
      }),
    );
    const editorB = addEditorBlockOperations(
      initializeEditableEditor({
        definition: firstDraftDefinition(),
        snapshot: createFirstDraftSnapshot(),
        onChange: outboundB.onChange,
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
      outboundA.publisher,
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
      outboundB.publisher,
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
      outboundB.publisher.dispose();
      outboundA.publisher.dispose();
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

function testConfig(
  limitOverrides: Partial<EditorRealtimeServer["config"]["limits"]> = {},
) {
  return {
    host: "127.0.0.1",
    port: 0,
    nodeEnv: "test",
    postgresUrl: "postgres://unused-in-injected-tests",
    publicDocumentIds: [documentOne, documentTwo],
    allowedOrigins: ["http://localhost:3000"],
    limits: {
      globalConnections: 100,
      connectionsPerAddress: 100,
      sessionsPerDocument: 100,
      messagesPerWindow: 10_000,
      messageWindowMs: 60_000,
      transactionsPerWindow: 10_000,
      transactionWindowMs: 60_000,
      bytesPerWindow: 256 * 1_024 * 1_024,
      byteWindowMs: 60_000,
      clientFrameBytes: 2 * 1_024 * 1_024,
      pendingTransactionsPerDocument: 100,
      ...limitOverrides,
    },
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

function firstDraftSubjectsEqual(
  left: ReturnType<typeof subject>,
  right: ReturnType<typeof subject>,
): boolean {
  return (
    left.actorId === right.actorId &&
    left.clientId === right.clientId &&
    left.sessionId === right.sessionId
  );
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
  selection: FirstDraftSelectionUpdateMessage["selection"],
) {
  return {
    type: "first-draft-selection-update" as const,
    documentId: identity.documentId,
    subject: subject(identity),
    selectionRevision,
    selection,
  };
}

function blockInternalSelection(
  payload: BlockInternalSelection["payload"],
): FirstDraftSelectionUpdateMessage["selection"] {
  return {
    kind: "selection",
    selection: {
      kind: "block-internal",
      blockId: textBlockId,
      subsystem: "test-block-internal",
      payload,
    },
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

async function openSocket(
  server: EditorRealtimeServer,
  origin?: string,
): Promise<WebSocket> {
  const socket = new WebSocket(
    `${server.url.replace("http://", "ws://")}/editor-realtime`,
    origin ? { origin } : undefined,
  );
  socket.binaryType = "arraybuffer";
  await once(socket, "open");
  return socket;
}

function expectUpgradeRejected(
  server: EditorRealtimeServer,
  origin: string | undefined,
  expectedStatus: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `${server.url.replace("http://", "ws://")}/editor-realtime`,
      origin ? { origin } : undefined,
    );
    socket.once("unexpected-response", (_request, response) => {
      const status = response.statusCode;
      response.resume();
      if (status === expectedStatus) resolve();
      else reject(
        new Error(`Expected upgrade status ${expectedStatus}, received ${status}`),
      );
    });
    socket.once("open", () => {
      socket.close();
      reject(new Error("Expected the WebSocket upgrade to be rejected"));
    });
    socket.once("error", () => undefined);
  });
}

async function connectSession(
  server: EditorRealtimeServer,
  identity: FirstDraftSessionIdentity,
): Promise<WebSocket> {
  const socket = await openSocket(server);
  await establishSession(socket, identity);
  await subscribeSession(socket, identity);
  return socket;
}

async function establishSession(
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
    const onClose = (code: number, reason: Buffer) => {
      cleanup();
      reject(
        new Error(
          `Socket closed before the expected First Draft message (${code}: ${reason.toString()})`,
        ),
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

function encodedMetadataText(frame: ArrayBuffer): string {
  const view = new DataView(frame);
  const metadataLength = view.getUint32(4);
  return new TextDecoder().decode(new Uint8Array(frame, 8, metadataLength));
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

function createImmediateTestOutbound(socket: FirstDraftOutboundSocket): {
  readonly publisher: FirstDraftOutboundPublisher;
  readonly onChange: (change: EditorSemanticChange) => void;
} {
  const publisher = createFirstDraftOutboundPublisher();
  publisher.attachGeneration({
    generationId: crypto.randomUUID(),
    socket,
    createTransactionId: () => crypto.randomUUID(),
    publishSelection: () => undefined,
  });
  publisher.generationCaughtUp();
  return {
    publisher,
    onChange(change) {
      publisher.submitFinalized(change);
      publisher.flush("manual");
    },
  };
}

type TestRemoteTransactionOptions = Omit<
  FirstDraftRemoteTransactionClientOptions,
  "documentId" | "initialRevision" | "outbox" | "onApplied"
> & {
  readonly documentId?: string;
  readonly initialRevision?: number;
  readonly onApplied?: FirstDraftRemoteTransactionClientOptions["onApplied"];
};

function attachFirstDraftRemoteTransactions(
  connection: Parameters<typeof attachFirstDraftRemoteTransactionsRaw>[0],
  editor: FirstDraftRemoteTransactionEditor & FirstDraftRemoteRefreshEditor,
  options: TestRemoteTransactionOptions,
  retainedOutbox?: FirstDraftOutboundPublisher,
): () => void {
  const publisher = retainedOutbox ?? createFirstDraftOutboundPublisher();
  const detach = attachFirstDraftRemoteTransactionsRaw(connection, editor, {
    ...options,
    documentId: options.documentId ?? documentOne,
    initialRevision: options.initialRevision ?? 0,
    outbox: publisher,
    onApplied: options.onApplied,
  });
  return () => {
    detach();
    if (!retainedOutbox) publisher.dispose();
  };
}

async function createTextTransactionFrame(
  transactionId: string,
): Promise<ArrayBuffer> {
  let frame: ArrayBuffer | null = null;
  const outbound = createImmediateTestOutbound({
    readyState: 1,
    send: (nextFrame) => {
      frame = nextFrame;
    },
  });
  const editor = initializeEditableEditor({
    definition: firstDraftDefinition(),
    snapshot: createFirstDraftSnapshot(),
    onChange: outbound.onChange,
    createTransactionId: () => transactionId,
  });
  expect(
    editor.insertText({ blockId: textBlockId, offset: 0, text: "X" }),
  ).toBe(true);
  await waitFor(() => frame !== null);
  editor.dispose();
  outbound.publisher.dispose();
  if (frame === null) throw new Error("Expected transaction frame");
  return frame;
}

async function createSuccessiveTextTransactionFrames(): Promise<
  readonly [ArrayBuffer, ArrayBuffer]
> {
  const frames: ArrayBuffer[] = [];
  const transactionIds = ["causal-typed", "causal-pasted"];
  const outbound = createImmediateTestOutbound({
    readyState: 1,
    send: (frame) => frames.push(frame.slice(0)),
  });
  const editor = initializeEditableEditor({
    definition: firstDraftDefinition(),
    snapshot: createFirstDraftSnapshot(),
    onChange: outbound.onChange,
    createTransactionId: () =>
      transactionIds.shift() ?? "unexpected-transaction",
  });
  expect(
    editor.insertText({ blockId: textBlockId, offset: 0, text: "T" }),
  ).toBe(true);
  const firstTransaction = decodeProposedTransaction(frames[0]!);
  outbound.publisher.acceptLocal(
    {
      type: "editor-transaction-accepted",
      documentId: documentOne,
      transactionId: firstTransaction.transactionId,
      baseRevision: 0,
      revision: 1,
      acceptedAt: 1,
    },
    0,
  );
  expect(
    editor.insertText({ blockId: textBlockId, offset: 1, text: "PASTED" }),
  ).toBe(true);
  await waitFor(() => frames.length === 2);
  editor.dispose();
  outbound.publisher.dispose();
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

function appendToFirstRichTextNode(
  projection: ReturnType<typeof decodeProposedTransaction>["content"][number]["readProjection"],
  suffix: string,
): ReturnType<typeof decodeProposedTransaction>["content"][number]["readProjection"] {
  const copy = structuredClone(projection) as unknown;
  const append = (value: unknown): boolean => {
    if (!value || typeof value !== "object") return false;
    const record = value as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      record.text += suffix;
      return true;
    }
    for (const child of Object.values(record)) {
      if (Array.isArray(child)) {
        for (const entry of child) if (append(entry)) return true;
      } else if (append(child)) {
        return true;
      }
    }
    return false;
  };
  if (!append(copy)) throw new Error("Expected a rich-text text node");
  return copy as ReturnType<
    typeof decodeProposedTransaction
  >["content"][number]["readProjection"];
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
