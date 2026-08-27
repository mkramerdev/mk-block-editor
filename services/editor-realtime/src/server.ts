import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import {
  decodeFirstDraftMessage,
  encodeFirstDraftMessage,
  firstDraftParticipantPresencesEqual,
  firstDraftSelectionPresencesEqual,
  firstDraftSelectionValuesEqual,
  FIRST_DRAFT_PROTOCOL_VERSION,
  isValidFirstDraftDocumentId,
  MAX_FIRST_DRAFT_FRAME_BYTES,
  type FirstDraftAcceptedTransactionReplayMessage,
  type FirstDraftCollaborationSubject,
  type FirstDraftParticipantPresence,
  type FirstDraftParticipantUpdateMessage,
  type FirstDraftSelectionPresence,
  type FirstDraftSelectionUpdateMessage,
  type FirstDraftServerMessage,
  type FirstDraftSessionIdentity,
  type SubscribeFirstDraftDocumentMessage,
} from "@repo/editor-first-draft/protocol";
import {
  type AcceptFirstDraftTransactionResult,
  type FirstDraftTransactionPersistence,
  type FirstDraftDocumentLoader,
} from "@repo/editor-first-draft/server";
import { WebSocket, WebSocketServer } from "ws";
import {
  loadEditorRealtimeConfig,
  type EditorRealtimeConfig,
} from "./config.ts";

const EDITOR_REALTIME_PATH = "/editor-realtime";
export const EDITOR_SELECTION_PRESENCE_INACTIVITY_MS = 30_000;
const MAX_LOADING_REPLAY_QUEUE_TRANSACTIONS = 2_048;

export interface EditorRealtimeTimeoutScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface ClientState {
  readonly socket: WebSocket;
  readonly remoteAddress: string;
  readonly messageRate: RateWindow;
  readonly transactionRate: RateWindow;
  readonly byteRate: RateWindow;
  phase: "awaiting-session" | "active";
  session: FirstDraftSessionIdentity | null;
  subscribed: boolean;
  subscriptionLoading: boolean;
  acceptedReplayQueue: FirstDraftAcceptedTransactionReplayMessage[];
  finalized: boolean;
}

interface RateWindow {
  startedAt: number;
  count: number;
}

interface DocumentRoom {
  readonly clients: Set<ClientState>;
  readonly participants: Map<string, FirstDraftParticipantPresence>;
  readonly selections: Map<string, SelectionPresenceState>;
  readonly selectionPresenceScheduler: EditorRealtimeTimeoutScheduler;
}

interface SelectionPresenceState {
  latest: FirstDraftSelectionPresence;
  active: boolean;
  deadline: number | null;
  generation: number;
  timer: unknown | null;
}

export interface EditorRealtimeProtocolDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly fatal: boolean;
  readonly session: FirstDraftSessionIdentity | null;
}

export interface EditorRealtimePersistenceDiagnostic {
  readonly documentId: string;
  readonly transactionId: string;
  readonly result: AcceptFirstDraftTransactionResult;
  readonly error?: unknown;
}

export interface EditorRealtimeServer {
  readonly httpServer: HttpServer;
  readonly webSocketServer: WebSocketServer;
  readonly config: EditorRealtimeConfig;
  readonly url: string;
  documentSessionCount(documentId: string): number;
  persistenceTailCount(): number;
  pendingPersistenceCount(documentId: string): number;
  trackedRemoteAddressCount(): number;
  close(): Promise<void>;
}

export interface CreateEditorRealtimeServerOptions {
  readonly persistence: FirstDraftTransactionPersistence;
  readonly documentLoader: FirstDraftDocumentLoader;
  readonly readiness?: EditorRealtimeReadiness;
  readonly config?: EditorRealtimeConfig;
  readonly selectionPresenceScheduler?: EditorRealtimeTimeoutScheduler;
  readonly onProtocolDiagnostic?: (
    diagnostic: EditorRealtimeProtocolDiagnostic,
  ) => void;
  readonly onPersistenceDiagnostic?: (
    diagnostic: EditorRealtimePersistenceDiagnostic,
  ) => void;
}

export interface EditorRealtimeReadiness {
  assertReady(): Promise<void>;
  checkReadiness(): Promise<{
    readonly ok: boolean;
    readonly issues: readonly string[];
  }>;
}

export async function startEditorRealtimeServer(
  options: CreateEditorRealtimeServerOptions,
): Promise<EditorRealtimeServer> {
  await options.readiness?.assertReady();
  const config = options.config ?? loadEditorRealtimeConfig();
  const selectionPresenceScheduler =
    options.selectionPresenceScheduler ?? systemTimeoutScheduler;
  const publicDocumentIds = new Set(config.publicDocumentIds);
  const allowedOrigins = new Set(config.allowedOrigins);
  for (const documentId of publicDocumentIds) {
    if (!isValidFirstDraftDocumentId(documentId)) {
      throw new Error("EDITOR_REALTIME_PUBLIC_DOCUMENT_IDS is invalid");
    }
  }
  if (config.nodeEnv === "production" && publicDocumentIds.size === 0) {
    throw new Error("EDITOR_REALTIME_PUBLIC_DOCUMENT_IDS is required");
  }
  if (config.nodeEnv === "production" && allowedOrigins.size === 0) {
    throw new Error("EDITOR_REALTIME_ALLOWED_ORIGINS is required");
  }
  const clients = new Set<ClientState>();
  const remoteAddressCounts = new Map<string, number>();
  const rooms = new Map<string, DocumentRoom>();
  const inFlightPersistence = new Set<Promise<void>>();
  const persistenceTails = new Map<string, Promise<void>>();
  const pendingPersistenceCounts = new Map<string, number>();
  const httpServer = createServer((request, response) => {
    void handleHttpRequest(request, response, options.readiness);
  });
  const webSocketServer = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_FIRST_DRAFT_FRAME_BYTES,
  });

  httpServer.on("upgrade", (request, socket, head) => {
    if (!isEditorRealtimeUpgrade(request)) {
      socket.destroy();
      return;
    }
    const origin = request.headers.origin;
    if (
      (origin === undefined && config.nodeEnv === "production") ||
      (origin !== undefined && !allowedOrigins.has(origin))
    ) {
      rejectUpgrade(socket, 403, "WebSocket origin is not allowed");
      options.onProtocolDiagnostic?.({
        code: "origin-not-allowed",
        message: "WebSocket upgrade origin was rejected",
        fatal: true,
        session: null,
      });
      return;
    }
    const remoteAddress = normalizeRemoteAddress(request.socket.remoteAddress);
    if (clients.size >= config.limits.globalConnections) {
      rejectUpgrade(socket, 503, "WebSocket capacity is unavailable");
      return;
    }
    if (
      (remoteAddressCounts.get(remoteAddress) ?? 0) >=
      config.limits.connectionsPerAddress
    ) {
      rejectUpgrade(socket, 429, "WebSocket capacity is unavailable");
      return;
    }
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  webSocketServer.on("connection", (socket, request) => {
    const remoteAddress = normalizeRemoteAddress(request.socket.remoteAddress);
    remoteAddressCounts.set(
      remoteAddress,
      (remoteAddressCounts.get(remoteAddress) ?? 0) + 1,
    );
    const now = selectionPresenceScheduler.now();
    const state: ClientState = {
      socket,
      remoteAddress,
      messageRate: { startedAt: now, count: 0 },
      transactionRate: { startedAt: now, count: 0 },
      byteRate: { startedAt: now, count: 0 },
      phase: "awaiting-session",
      session: null,
      subscribed: false,
      subscriptionLoading: false,
      acceptedReplayQueue: [],
      finalized: false,
    };
    clients.add(state);
    socket.on("message", (data, isBinary) => {
      void handleSocketMessage({
        state,
        data,
        isBinary,
        selectionPresenceScheduler,
        rooms,
        persistence: options.persistence,
        documentLoader: options.documentLoader,
        inFlightPersistence,
        persistenceTails,
        pendingPersistenceCounts,
        config,
        publicDocumentIds,
        clients,
        onProtocolDiagnostic: options.onProtocolDiagnostic,
        onPersistenceDiagnostic: options.onPersistenceDiagnostic,
      }).catch((error: unknown) => {
        options.onProtocolDiagnostic?.({
          code: "internal-error",
          message: error instanceof Error ? error.message : String(error),
          fatal: true,
          session: state.session,
        });
        sendFirstDraftMessage(state.socket, {
          type: "first-draft-protocol-error",
          code: "internal-error",
          message: "First Draft realtime service encountered an internal error",
          fatal: true,
        });
        state.socket.close(1011, "internal-error");
      });
    });
    socket.on("close", () =>
      finalizeClient(clients, rooms, remoteAddressCounts, state),
    );
    socket.on("error", () =>
      finalizeClient(clients, rooms, remoteAddressCounts, state),
    );
  });

  await listen(httpServer, config);
  const address = httpServer.address();
  const port =
    typeof address === "object" && address ? address.port : config.port;
  const host = config.host === "0.0.0.0" ? "127.0.0.1" : config.host;

  return {
    httpServer,
    webSocketServer,
    config,
    url: `http://${host}:${port}`,
    documentSessionCount: (documentId) =>
      rooms.get(documentId)?.clients.size ?? 0,
    persistenceTailCount: () => persistenceTails.size,
    pendingPersistenceCount: (documentId) =>
      pendingPersistenceCounts.get(documentId) ?? 0,
    trackedRemoteAddressCount: () => remoteAddressCounts.size,
    close: () =>
      closeServer(
        httpServer,
        webSocketServer,
        clients,
        rooms,
        inFlightPersistence,
      ),
  };
}

async function handleSocketMessage(input: {
  readonly state: ClientState;
  readonly data: WebSocket.RawData;
  readonly isBinary: boolean;
  readonly selectionPresenceScheduler: EditorRealtimeTimeoutScheduler;
  readonly rooms: Map<string, DocumentRoom>;
  readonly persistence: FirstDraftTransactionPersistence;
  readonly documentLoader: FirstDraftDocumentLoader;
  readonly inFlightPersistence: Set<Promise<void>>;
  readonly persistenceTails: Map<string, Promise<void>>;
  readonly pendingPersistenceCounts: Map<string, number>;
  readonly config: EditorRealtimeConfig;
  readonly publicDocumentIds: ReadonlySet<string>;
  readonly clients: ReadonlySet<ClientState>;
  readonly onProtocolDiagnostic?: (
    diagnostic: EditorRealtimeProtocolDiagnostic,
  ) => void;
  readonly onPersistenceDiagnostic?: (
    diagnostic: EditorRealtimePersistenceDiagnostic,
  ) => void;
}): Promise<void> {
  const { state } = input;
  if (
    !consumeRateWindow(
      state.messageRate,
      input.selectionPresenceScheduler.now(),
      input.config.limits.messageWindowMs,
      input.config.limits.messagesPerWindow,
    )
  ) {
    reportProtocolError({
      state,
      code: "message-rate-limit",
      message: "First Draft message rate limit exceeded",
      fatal: true,
      onProtocolDiagnostic: input.onProtocolDiagnostic,
    });
    return;
  }
  const rawByteLength = rawDataByteLength(input.data);
  if (
    !consumeRateWindow(
      state.byteRate,
      input.selectionPresenceScheduler.now(),
      input.config.limits.byteWindowMs,
      input.config.limits.bytesPerWindow,
      rawByteLength,
    )
  ) {
    reportProtocolError({
      state,
      code: "byte-rate-limit",
      message: "First Draft inbound byte rate limit exceeded",
      fatal: true,
      onProtocolDiagnostic: input.onProtocolDiagnostic,
    });
    return;
  }
  if (rawByteLength > input.config.limits.clientFrameBytes) {
    reportProtocolError({
      state,
      code: "client-frame-too-large",
      message: "First Draft inbound client frame exceeds its configured limit",
      fatal: true,
      onProtocolDiagnostic: input.onProtocolDiagnostic,
    });
    return;
  }
  if (!input.isBinary) {
    reportProtocolError({
      state,
      code: "binary-frame-required",
      message: "First Draft accepts only its versioned binary protocol",
      fatal: state.phase !== "active",
      onProtocolDiagnostic: input.onProtocolDiagnostic,
    });
    return;
  }
  const frame = rawDataToBytes(input.data);
  if (frame.byteLength > MAX_FIRST_DRAFT_FRAME_BYTES) {
    reportProtocolError({
      state,
      code: "frame-too-large",
      message: "First Draft frame exceeds the configured payload limit",
      fatal: true,
      onProtocolDiagnostic: input.onProtocolDiagnostic,
    });
    return;
  }

  if (state.phase !== "active") {
    establishSession({
      state,
      frame,
      clients: input.clients,
      publicDocumentIds: input.publicDocumentIds,
      maximumSessionsPerDocument:
        input.config.limits.sessionsPerDocument,
      onProtocolDiagnostic: input.onProtocolDiagnostic,
    });
    return;
  }

  const session = state.session;
  if (!session) {
    reportProtocolError({
      state,
      code: "invalid-session-state",
      message: "Established session identity is unavailable",
      fatal: true,
      onProtocolDiagnostic: input.onProtocolDiagnostic,
    });
    return;
  }
  const decoded = decodeFirstDraftMessage(frame);
  if (!decoded.ok) {
    reportProtocolError({
      state,
      code: "invalid-message",
      message: decoded.error,
      fatal: false,
      onProtocolDiagnostic: input.onProtocolDiagnostic,
    });
    return;
  }
  const message = decoded.message;
  if (message.type === "subscribe-first-draft-document") {
    await subscribeToDocument(
      input.rooms,
      state,
      message,
      input.documentLoader,
      input.persistenceTails,
      input.selectionPresenceScheduler,
      input.onProtocolDiagnostic,
    );
    return;
  }
  if (message.type === "unsubscribe-first-draft-document") {
    unsubscribeFromDocument(input.rooms, state, message.documentId);
    return;
  }
  if (message.type === "first-draft-participant-update") {
    applyParticipantUpdate(
      input.rooms,
      state,
      message,
      input.onProtocolDiagnostic,
    );
    return;
  }
  if (message.type === "first-draft-selection-update") {
    applySelectionUpdate(
      input.rooms,
      state,
      message,
      input.onProtocolDiagnostic,
    );
    return;
  }
  if (message.type !== "proposed-editor-transaction" || !state.subscribed) {
    reportProtocolError({
      state,
      code: state.subscribed
        ? "invalid-client-message"
        : "document-subscription-required",
      message: state.subscribed
        ? "The message variant is not valid from a First Draft client"
        : "Subscribe to the established session document before publishing realtime state",
      fatal: false,
      onProtocolDiagnostic: input.onProtocolDiagnostic,
    });
    return;
  }
  if (
    !consumeRateWindow(
      state.transactionRate,
      input.selectionPresenceScheduler.now(),
      input.config.limits.transactionWindowMs,
      input.config.limits.transactionsPerWindow,
    )
  ) {
    reportProtocolError({
      state,
      code: "transaction-rate-limit",
      message: "First Draft transaction rate limit exceeded",
      fatal: true,
      onProtocolDiagnostic: input.onProtocolDiagnostic,
    });
    return;
  }
  const documentId = session.documentId;
  if (
    (input.pendingPersistenceCounts.get(documentId) ?? 0) >=
    input.config.limits.pendingTransactionsPerDocument
  ) {
    reportProtocolError({
      state,
      code: "persistence-backlog-limit",
      message: "First Draft document persistence backlog limit exceeded",
      fatal: true,
      onProtocolDiagnostic: input.onProtocolDiagnostic,
    });
    return;
  }
  startPersistence({
    state,
    frame,
    session,
    transaction: message.transaction,
    persistence: input.persistence,
    inFlightPersistence: input.inFlightPersistence,
    persistenceTails: input.persistenceTails,
    pendingPersistenceCounts: input.pendingPersistenceCounts,
    rooms: input.rooms,
    onPersistenceDiagnostic: input.onPersistenceDiagnostic,
  });
}

function startPersistence(input: {
  readonly state: ClientState;
  readonly frame: Uint8Array;
  readonly session: FirstDraftSessionIdentity;
  readonly transaction: Parameters<
    FirstDraftTransactionPersistence["accept"]
  >[0]["transaction"];
  readonly persistence: FirstDraftTransactionPersistence;
  readonly inFlightPersistence: Set<Promise<void>>;
  readonly persistenceTails: Map<string, Promise<void>>;
  readonly pendingPersistenceCounts: Map<string, number>;
  readonly rooms: Map<string, DocumentRoom>;
  readonly onPersistenceDiagnostic?: (
    diagnostic: EditorRealtimePersistenceDiagnostic,
  ) => void;
}): void {
  const documentId = input.session.documentId;
  input.pendingPersistenceCounts.set(
    documentId,
    (input.pendingPersistenceCounts.get(documentId) ?? 0) + 1,
  );
  let encodedTransaction: Uint8Array;
  try {
    encodedTransaction = input.frame.slice();
  } catch (error) {
    decrementPendingPersistence(input.pendingPersistenceCounts, documentId);
    throw error;
  }
  const previousTail = input.persistenceTails.get(documentId);
  const persistence = (previousTail ?? Promise.resolve())
    .catch(() => undefined)
    .then(() =>
      input.persistence.accept({
        documentId,
        transaction: input.transaction,
        encodedTransaction,
      }),
    )
    .then((result) => {
      input.onPersistenceDiagnostic?.({
        documentId,
        transactionId: input.transaction.transactionId,
        result,
      });
      if (result.ok) {
        sendFirstDraftMessage(input.state.socket, {
          type: "editor-transaction-accepted",
          ...result.accepted,
        });
        if (result.status === "accepted") {
          broadcastAcceptedTransaction(input.rooms, input.state, {
            type: "first-draft-accepted-transaction-replay",
            documentId,
            transactionId: result.accepted.transactionId,
            baseRevision: result.accepted.baseRevision,
            revision: result.accepted.revision,
            acceptedAt: result.accepted.acceptedAt,
            transaction: result.transaction,
          });
        }
        return;
      }
      sendFirstDraftMessage(input.state.socket, {
        type: "editor-transaction-persistence-failed",
        documentId,
        transactionId: input.transaction.transactionId,
        reason: result.reason,
        retryable: result.retryable,
        message: result.message,
      });
    })
    .catch((error: unknown) => {
      const result: AcceptFirstDraftTransactionResult = {
        ok: false,
        reason: "unavailable",
        retryable: true,
        message: "First Draft transaction persistence is unavailable",
      };
      input.onPersistenceDiagnostic?.({
        documentId,
        transactionId: input.transaction.transactionId,
        result,
        error,
      });
      sendFirstDraftMessage(input.state.socket, {
        type: "editor-transaction-persistence-failed",
        documentId,
        transactionId: input.transaction.transactionId,
        reason: result.reason,
        retryable: result.retryable,
        message: result.message,
      });
    });
  const tail: Promise<void> = persistence.finally(() => {
    decrementPendingPersistence(input.pendingPersistenceCounts, documentId);
    input.inFlightPersistence.delete(tail);
    if (input.persistenceTails.get(documentId) === tail) {
      input.persistenceTails.delete(documentId);
    }
  });
  input.persistenceTails.set(documentId, tail);
  input.inFlightPersistence.add(tail);
}

function establishSession(input: {
  readonly state: ClientState;
  readonly frame: Uint8Array;
  readonly clients: ReadonlySet<ClientState>;
  readonly publicDocumentIds: ReadonlySet<string>;
  readonly maximumSessionsPerDocument: number;
  readonly onProtocolDiagnostic?: (
    diagnostic: EditorRealtimeProtocolDiagnostic,
  ) => void;
}): void {
  const decoded = decodeFirstDraftMessage(input.frame);
  if (!decoded.ok || decoded.message.type !== "connect-first-draft-session") {
    reportProtocolError({
      state: input.state,
      code: "session-connection-required",
      message: decoded.ok
        ? "The first frame must establish a First Draft session"
        : decoded.error,
      fatal: true,
      onProtocolDiagnostic: input.onProtocolDiagnostic,
    });
    return;
  }
  const requestedDocumentId = decoded.message.documentId;
  const documentSessions = [...input.clients].filter(
    (client) =>
      client !== input.state &&
      !client.finalized &&
      client.session?.documentId === requestedDocumentId,
  ).length;
  if (
    !input.publicDocumentIds.has(requestedDocumentId) ||
    documentSessions >= input.maximumSessionsPerDocument
  ) {
    reportProtocolError({
      state: input.state,
      code: "document-not-available",
      message: "The requested collaboration document is not available",
      fatal: true,
      onProtocolDiagnostic: input.onProtocolDiagnostic,
    });
    return;
  }
  if (input.state.finalized) return;
  input.state.phase = "active";
  input.state.session = Object.freeze({
    actorId: decoded.message.actorId,
    clientId: decoded.message.clientId,
    sessionId: decoded.message.sessionId,
    documentId: decoded.message.documentId,
  });
  sendFirstDraftMessage(input.state.socket, {
    type: "first-draft-session-connected",
    ...input.state.session,
  });
}

async function subscribeToDocument(
  rooms: Map<string, DocumentRoom>,
  state: ClientState,
  message: SubscribeFirstDraftDocumentMessage,
  documentLoader: FirstDraftDocumentLoader,
  persistenceTails: ReadonlyMap<string, Promise<void>>,
  selectionPresenceScheduler: EditorRealtimeTimeoutScheduler,
  onProtocolDiagnostic?: (diagnostic: EditorRealtimeProtocolDiagnostic) => void,
): Promise<void> {
  const { documentId, knownRevision } = message;
  if (!matchesSessionDocument(state, documentId)) {
    reportProtocolError({
      state,
      code: "session-document-mismatch",
      message: "The established session cannot subscribe to another document",
      fatal: false,
      onProtocolDiagnostic,
    });
    return;
  }
  if (state.subscribed || state.subscriptionLoading) {
    reportProtocolError({
      state,
      code: "document-subscription-active",
      message: "The established session already has a document subscription",
      fatal: false,
      onProtocolDiagnostic,
    });
    return;
  }
  const room = ensureRoom(rooms, documentId, selectionPresenceScheduler);
  room.clients.add(state);
  state.subscriptionLoading = true;
  state.acceptedReplayQueue = [];
  const admittedPersistenceBarrier = persistenceTails.get(documentId);
  if (admittedPersistenceBarrier) {
    await admittedPersistenceBarrier.catch(() => undefined);
    if (state.finalized) return;
  }
  if (knownRevision === undefined) {
    const loaded = await documentLoader.loadBootstrap(documentId);
    if (state.finalized) return;
    if (!loaded.ok) {
      failDocumentSubscription(
        rooms,
        room,
        state,
        documentId,
        `document-load-${loaded.reason}`,
        loaded.message,
        loaded.reason !== "unavailable",
        onProtocolDiagnostic,
      );
      return;
    }
    const merged = mergeAcceptedReplay(
      documentId,
      loaded.bootstrap.revision,
      [],
      state.acceptedReplayQueue,
    );
    if (!merged.ok) {
      failReplaySubscription(
        rooms,
        room,
        state,
        documentId,
        merged,
        onProtocolDiagnostic,
      );
      return;
    }
    activateSubscription(state);
    sendFirstDraftMessage(state.socket, {
      type: "first-draft-document-loaded",
      documentId,
      revision: loaded.bootstrap.revision,
      bootstrap: loaded.bootstrap,
    });
    finishSubscription(
      state,
      room,
      documentId,
      loaded.bootstrap.revision,
      merged,
    );
    return;
  }

  const loadedReplay = await documentLoader.loadAcceptedTransactions(
    documentId,
    knownRevision,
  );
  if (state.finalized) return;
  if (loadedReplay.ok) {
    const persisted = loadedReplay.transactions.map(
      (accepted): FirstDraftAcceptedTransactionReplayMessage => ({
        type: "first-draft-accepted-transaction-replay",
        documentId,
        ...accepted,
      }),
    );
    const merged = mergeAcceptedReplay(
      documentId,
      knownRevision,
      persisted,
      state.acceptedReplayQueue,
      loadedReplay.currentRevision,
    );
    if (!merged.ok) {
      failReplaySubscription(
        rooms,
        room,
        state,
        documentId,
        merged,
        onProtocolDiagnostic,
      );
      return;
    }
    activateSubscription(state);
    finishSubscription(
      state,
      room,
      documentId,
      knownRevision,
      merged,
    );
    return;
  }
  if (loadedReplay.reason !== "revision-unavailable") {
    failDocumentSubscription(
      rooms,
      room,
      state,
      documentId,
      `document-replay-${loadedReplay.reason}`,
      loadedReplay.message,
      loadedReplay.reason !== "unavailable",
      onProtocolDiagnostic,
    );
    return;
  }

  const resynchronized = await documentLoader.loadBootstrap(documentId);
  if (state.finalized) return;
  if (!resynchronized.ok) {
    failDocumentSubscription(
      rooms,
      room,
      state,
      documentId,
      `document-resynchronization-${resynchronized.reason}`,
      resynchronized.message,
      resynchronized.reason !== "unavailable",
      onProtocolDiagnostic,
    );
    return;
  }
  const merged = mergeAcceptedReplay(
    documentId,
    resynchronized.bootstrap.revision,
    [],
    state.acceptedReplayQueue,
  );
  if (!merged.ok) {
    failReplaySubscription(
      rooms,
      room,
      state,
      documentId,
      merged,
      onProtocolDiagnostic,
    );
    return;
  }
  activateSubscription(state);
  sendFirstDraftMessage(state.socket, {
    type: "first-draft-document-resynchronized",
    documentId,
    requestedRevision: knownRevision,
    revision: resynchronized.bootstrap.revision,
    reason:
      loadedReplay.resynchronizationReason ?? "revision-unavailable",
    bootstrap: resynchronized.bootstrap,
  });
  finishSubscription(
    state,
    room,
    documentId,
    resynchronized.bootstrap.revision,
    merged,
  );
}

type ReplayMergeResult =
  | {
      readonly ok: true;
      readonly replay: readonly FirstDraftAcceptedTransactionReplayMessage[];
      readonly revision: number;
    }
  | {
      readonly ok: false;
      readonly code:
        | "revision-replay-conflict"
        | "revision-replay-non-contiguous";
      readonly message: string;
    };

function mergeAcceptedReplay(
  documentId: string,
  startingRevision: number,
  persisted: readonly FirstDraftAcceptedTransactionReplayMessage[],
  queued: readonly FirstDraftAcceptedTransactionReplayMessage[],
  persistedHead?: number,
): ReplayMergeResult {
  const byRevision = new Map<
    number,
    FirstDraftAcceptedTransactionReplayMessage
  >();
  const revisionByTransactionId = new Map<string, number>();
  for (const accepted of [...persisted, ...queued]) {
    if (
      accepted.documentId !== documentId ||
      accepted.revision <= startingRevision
    ) {
      continue;
    }
    const existingRevision = revisionByTransactionId.get(
      accepted.transactionId,
    );
    if (
      existingRevision !== undefined &&
      existingRevision !== accepted.revision
    ) {
      return {
        ok: false,
        code: "revision-replay-conflict",
        message: "Accepted transaction identity appears at conflicting revisions",
      };
    }
    const existing = byRevision.get(accepted.revision);
    if (existing && existing.transactionId !== accepted.transactionId) {
      return {
        ok: false,
        code: "revision-replay-conflict",
        message: "Accepted transaction replay contains conflicting revisions",
      };
    }
    revisionByTransactionId.set(accepted.transactionId, accepted.revision);
    byRevision.set(accepted.revision, existing ?? accepted);
  }
  const replay = [...byRevision.values()].sort(
    (left, right) => left.revision - right.revision,
  );
  let revision = startingRevision;
  for (const accepted of replay) {
    if (
      accepted.baseRevision !== revision ||
      accepted.revision !== revision + 1
    ) {
      return {
        ok: false,
        code: "revision-replay-non-contiguous",
        message: "Accepted transaction replay is not contiguous",
      };
    }
    revision = accepted.revision;
  }
  if (persistedHead !== undefined && revision < persistedHead) {
    return {
      ok: false,
      code: "revision-replay-non-contiguous",
      message: "Accepted transaction replay does not reach its persisted head",
    };
  }
  return { ok: true, replay, revision };
}

function activateSubscription(state: ClientState): void {
  state.subscriptionLoading = false;
  state.acceptedReplayQueue = [];
  state.subscribed = true;
}

function finishSubscription(
  state: ClientState,
  room: DocumentRoom,
  documentId: string,
  requestedRevision: number,
  merged: Extract<ReplayMergeResult, { readonly ok: true }>,
): void {
  for (const accepted of merged.replay) {
    sendFirstDraftMessage(state.socket, accepted);
  }
  sendFirstDraftMessage(state.socket, {
    type: "first-draft-document-caught-up",
    documentId,
    requestedRevision,
    revision: merged.revision,
  });
  sendSnapshots(state.socket, documentId, room);
}

function failReplaySubscription(
  rooms: Map<string, DocumentRoom>,
  room: DocumentRoom,
  state: ClientState,
  documentId: string,
  failure: Extract<ReplayMergeResult, { readonly ok: false }>,
  onProtocolDiagnostic?: (diagnostic: EditorRealtimeProtocolDiagnostic) => void,
): void {
  failDocumentSubscription(
    rooms,
    room,
    state,
    documentId,
    failure.code,
    failure.message,
    true,
    onProtocolDiagnostic,
  );
}

function failDocumentSubscription(
  rooms: Map<string, DocumentRoom>,
  room: DocumentRoom,
  state: ClientState,
  documentId: string,
  code: string,
  message: string,
  fatal: boolean,
  onProtocolDiagnostic?: (diagnostic: EditorRealtimeProtocolDiagnostic) => void,
): void {
  room.clients.delete(state);
  if (room.clients.size === 0) deleteRoom(rooms, documentId, room);
  state.subscriptionLoading = false;
  state.acceptedReplayQueue = [];
  reportProtocolError({
    state,
    code,
    message,
    fatal,
    onProtocolDiagnostic,
  });
}

function broadcastAcceptedTransaction(
  rooms: ReadonlyMap<string, DocumentRoom>,
  sender: ClientState,
  message: FirstDraftAcceptedTransactionReplayMessage,
): void {
  for (const client of rooms.get(message.documentId)?.clients ?? []) {
    if (client === sender) continue;
    if (client.subscriptionLoading) {
      if (
        client.acceptedReplayQueue.length >=
        MAX_LOADING_REPLAY_QUEUE_TRANSACTIONS
      ) {
        sendFirstDraftMessage(client.socket, {
          type: "first-draft-protocol-error",
          code: "subscription-replay-queue-limit",
          message: "First Draft subscription replay capacity was exceeded",
          fatal: true,
        });
        client.socket.close(1008, "subscription-replay-queue-limit");
        continue;
      }
      client.acceptedReplayQueue.push(message);
    } else if (
      client.subscribed &&
      client.socket.readyState === WebSocket.OPEN
    ) {
      sendFirstDraftMessage(client.socket, message);
    }
  }
}

function unsubscribeFromDocument(
  rooms: Map<string, DocumentRoom>,
  state: ClientState,
  documentId: string,
): void {
  if (!matchesSessionDocument(state, documentId)) return;
  removeSessionFromRoom(rooms, state);
  sendFirstDraftMessage(state.socket, {
    type: "first-draft-document-unsubscribed",
    documentId,
  });
}

function applyParticipantUpdate(
  rooms: Map<string, DocumentRoom>,
  state: ClientState,
  message: FirstDraftParticipantUpdateMessage,
  onProtocolDiagnostic?: (diagnostic: EditorRealtimeProtocolDiagnostic) => void,
): void {
  if (!validateEphemeralSessionMessage(state, message, onProtocolDiagnostic))
    return;
  const room = rooms.get(message.documentId);
  if (!room) return;
  const key = subjectKey(message.subject);
  const previous = room.participants.get(key);
  const next = {
    subject: message.subject,
    presenceRevision: message.presenceRevision,
    active: message.active,
    metadata: normalizedParticipantMetadata(state.session),
  } satisfies FirstDraftParticipantPresence;
  if (previous && next.presenceRevision <= previous.presenceRevision) {
    if (
      next.presenceRevision === previous.presenceRevision &&
      !firstDraftParticipantPresencesEqual(next, previous)
    ) {
      reportProtocolError({
        state,
        code: "presence-revision-conflict",
        message: "One presence revision cannot carry different state",
        fatal: false,
        onProtocolDiagnostic,
      });
    }
    return;
  }
  room.participants.set(key, next);
  if (!message.active) removeSelectionPresence(room, key);
  broadcastMessage(room, state, {
    type: "first-draft-participant-update",
    documentId: message.documentId,
    ...next,
  });
  if (message.active) sendSnapshots(state.socket, message.documentId, room);
  else broadcastSelectionSnapshot(room, message.documentId, state);
}

function applySelectionUpdate(
  rooms: Map<string, DocumentRoom>,
  state: ClientState,
  message: FirstDraftSelectionUpdateMessage,
  onProtocolDiagnostic?: (diagnostic: EditorRealtimeProtocolDiagnostic) => void,
): void {
  if (!validateEphemeralSessionMessage(state, message, onProtocolDiagnostic))
    return;
  const room = rooms.get(message.documentId);
  if (!room) return;
  const key = subjectKey(message.subject);
  const previous = room.selections.get(key);
  const next = {
    subject: message.subject,
    selectionRevision: message.selectionRevision,
    selection: message.selection,
  } satisfies FirstDraftSelectionPresence;
  if (previous && next.selectionRevision <= previous.latest.selectionRevision) {
    if (
      next.selectionRevision === previous.latest.selectionRevision &&
      !firstDraftSelectionPresencesEqual(next, previous.latest)
    ) {
      reportProtocolError({
        state,
        code: "selection-revision-conflict",
        message: "One selection revision cannot carry different state",
        fatal: false,
        onProtocolDiagnostic,
      });
    }
    return;
  }
  if (
    previous &&
    firstDraftSelectionValuesEqual(next.selection, previous.latest.selection)
  ) {
    previous.latest = next;
    if (previous.active) broadcastMessage(room, state, message);
    return;
  }
  activateSelectionPresence(room, message.documentId, key, next);
  broadcastMessage(room, state, message);
}

function validateEphemeralSessionMessage(
  state: ClientState,
  message: {
    readonly documentId: string;
    readonly subject: FirstDraftCollaborationSubject;
  },
  onProtocolDiagnostic?: (diagnostic: EditorRealtimeProtocolDiagnostic) => void,
): boolean {
  const valid =
    state.subscribed &&
    matchesSessionDocument(state, message.documentId) &&
    sameSubject(state.session, message.subject);
  if (valid) return true;
  reportProtocolError({
    state,
    code: "presence-session-mismatch",
    message: "Presence requires the established subscribed session identity",
    fatal: false,
    onProtocolDiagnostic,
  });
  return false;
}

function matchesSessionDocument(
  state: ClientState,
  documentId: string,
): boolean {
  return state.session?.documentId === documentId;
}

function sameSubject(
  session: FirstDraftSessionIdentity | null,
  subject: FirstDraftCollaborationSubject,
): boolean {
  return (
    session?.actorId === subject.actorId &&
    session.clientId === subject.clientId &&
    session.sessionId === subject.sessionId
  );
}

function subjectKey(subject: FirstDraftCollaborationSubject): string {
  return [subject.actorId, subject.clientId, subject.sessionId]
    .map((part) => `${part.length}:${part}`)
    .join("|");
}

function ensureRoom(
  rooms: Map<string, DocumentRoom>,
  documentId: string,
  selectionPresenceScheduler: EditorRealtimeTimeoutScheduler,
): DocumentRoom {
  let room = rooms.get(documentId);
  if (!room) {
    room = {
      clients: new Set(),
      participants: new Map(),
      selections: new Map(),
      selectionPresenceScheduler,
    };
    rooms.set(documentId, room);
  }
  return room;
}

function sendSnapshots(
  socket: WebSocket,
  documentId: string,
  room: DocumentRoom,
): void {
  sendFirstDraftMessage(socket, {
    type: "first-draft-participant-snapshot",
    documentId,
    participants: [...room.participants.values()].filter(
      (participant) => participant.active,
    ),
  });
  sendFirstDraftMessage(socket, {
    type: "first-draft-selection-snapshot",
    documentId,
    selections: activeSelectionPresences(room),
  });
}

function broadcastSelectionSnapshot(
  room: DocumentRoom,
  documentId: string,
  excluded?: ClientState,
): void {
  const message = {
    type: "first-draft-selection-snapshot" as const,
    documentId,
    selections: activeSelectionPresences(room),
  };
  for (const client of room.clients) {
    if (client === excluded) continue;
    sendFirstDraftMessage(client.socket, message);
  }
}

function broadcastMessage(
  room: DocumentRoom,
  sender: ClientState,
  message: FirstDraftServerMessage,
): number {
  let delivered = 0;
  for (const client of room.clients) {
    if (client === sender || client.socket.readyState !== WebSocket.OPEN)
      continue;
    sendFirstDraftMessage(client.socket, message);
    delivered += 1;
  }
  return delivered;
}

function reportProtocolError(input: {
  readonly state: ClientState;
  readonly code: string;
  readonly message: string;
  readonly fatal: boolean;
  readonly onProtocolDiagnostic?: (
    diagnostic: EditorRealtimeProtocolDiagnostic,
  ) => void;
}): void {
  input.onProtocolDiagnostic?.({
    code: input.code,
    message: input.message,
    fatal: input.fatal,
    session: input.state.session,
  });
  sendFirstDraftMessage(input.state.socket, {
    type: "first-draft-protocol-error",
    code: input.code,
    message: input.message,
    fatal: input.fatal,
  });
  if (input.fatal) input.state.socket.close(1008, input.code);
}

function sendFirstDraftMessage(
  socket: WebSocket,
  message: FirstDraftServerMessage,
): void {
  if (socket.readyState !== WebSocket.OPEN) return;
  socket.send(encodeFirstDraftMessage(message), { binary: true });
}

function finalizeClient(
  clients: Set<ClientState>,
  rooms: Map<string, DocumentRoom>,
  remoteAddressCounts: Map<string, number>,
  state: ClientState,
): void {
  if (state.finalized) return;
  state.finalized = true;
  clients.delete(state);
  const addressCount = remoteAddressCounts.get(state.remoteAddress) ?? 0;
  if (addressCount <= 1) remoteAddressCounts.delete(state.remoteAddress);
  else remoteAddressCounts.set(state.remoteAddress, addressCount - 1);
  removeSessionFromRoom(rooms, state);
}

function removeSessionFromRoom(
  rooms: Map<string, DocumentRoom>,
  state: ClientState,
): void {
  const session = state.session;
  if (!session || (!state.subscribed && !state.subscriptionLoading)) return;
  state.subscribed = false;
  state.subscriptionLoading = false;
  state.acceptedReplayQueue = [];
  const room = rooms.get(session.documentId);
  if (!room) return;
  room.clients.delete(state);
  const key = subjectKey(session);
  const participant = room.participants.get(key);
  room.participants.delete(key);
  removeSelectionPresence(room, key);
  if (participant?.active) {
    const leave: FirstDraftParticipantUpdateMessage = {
      type: "first-draft-participant-update",
      documentId: session.documentId,
      subject: participant.subject,
      presenceRevision: participant.presenceRevision + 1,
      active: false,
      metadata: participant.metadata,
    };
    for (const peer of room.clients) sendFirstDraftMessage(peer.socket, leave);
  }
  broadcastSelectionSnapshot(room, session.documentId);
  if (room.clients.size === 0) deleteRoom(rooms, session.documentId, room);
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  readiness?: EditorRealtimeReadiness,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  if (request.method === "GET" && url.pathname === "/healthz") {
    writeJson(response, 200, {
      ok: true,
      service: "editor-realtime",
      protocol: "first-draft",
      protocolVersion: FIRST_DRAFT_PROTOCOL_VERSION,
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/readyz") {
    const postgres = readiness
      ? await readiness.checkReadiness()
      : { ok: true, issues: [] as readonly string[] };
    writeJson(response, postgres.ok ? 200 : 503, {
      ok: postgres.ok,
      service: "editor-realtime",
      postgres,
    });
    return;
  }
  writeJson(response, 404, {
    ok: false,
    reason: "not-found",
    message: "Not found",
  });
}

function rawDataToBytes(data: WebSocket.RawData): Uint8Array {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (!Array.isArray(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  const byteLength = data.reduce((total, part) => total + part.byteLength, 0);
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const part of data) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

function rawDataByteLength(data: WebSocket.RawData): number {
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (!Array.isArray(data)) return data.byteLength;
  return data.reduce((total, part) => total + part.byteLength, 0);
}

function decrementPendingPersistence(
  counts: Map<string, number>,
  documentId: string,
): void {
  const next = (counts.get(documentId) ?? 0) - 1;
  if (next <= 0) counts.delete(documentId);
  else counts.set(documentId, next);
}

function isEditorRealtimeUpgrade(request: IncomingMessage): boolean {
  const url = new URL(request.url ?? "/", "http://localhost");
  return url.pathname === EDITOR_REALTIME_PATH;
}

function rejectUpgrade(
  socket: { end(data: string): unknown },
  status: 403 | 429 | 503,
  message: string,
): void {
  const reason =
    status === 403
      ? "Forbidden"
      : status === 429
        ? "Too Many Requests"
        : "Service Unavailable";
  const body = `${message}\n`;
  socket.end(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
}

function normalizeRemoteAddress(value: string | undefined): string {
  return value?.trim() || "unknown";
}

function consumeRateWindow(
  state: RateWindow,
  now: number,
  windowMs: number,
  limit: number,
  amount = 1,
): boolean {
  if (now < state.startedAt || now - state.startedAt >= windowMs) {
    state.startedAt = now;
    state.count = 0;
  }
  state.count += amount;
  return state.count <= limit;
}

function normalizedParticipantMetadata(
  session: FirstDraftSessionIdentity | null,
): FirstDraftParticipantPresence["metadata"] {
  const source = session?.actorId ?? "visitor";
  const compact = source.toLowerCase().replace(/[^a-z0-9]/gu, "");
  const suffix = (compact.slice(-6) || "guest").padStart(6, "0");
  const palette = [
    "#4f46e5",
    "#0f766e",
    "#b45309",
    "#be123c",
    "#7e22ce",
    "#0369a1",
  ] as const;
  let hash = 0;
  for (const character of source) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return Object.freeze({
    displayName: `Visitor ${suffix}`,
    color: palette[hash % palette.length]!,
  });
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function listen(
  httpServer: HttpServer,
  config: EditorRealtimeConfig,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      httpServer.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      httpServer.off("error", onError);
      resolve();
    };
    httpServer.once("error", onError);
    httpServer.once("listening", onListening);
    httpServer.listen(config.port, config.host);
  });
}

function closeServer(
  httpServer: HttpServer,
  webSocketServer: WebSocketServer,
  clients: ReadonlySet<ClientState>,
  rooms: Map<string, DocumentRoom>,
  inFlightPersistence: ReadonlySet<Promise<void>>,
): Promise<void> {
  for (const [documentId, room] of rooms) deleteRoom(rooms, documentId, room);
  for (const client of clients) client.socket.close(1001, "server shutdown");
  return new Promise<void>((resolve) => {
    webSocketServer.close(() => httpServer.close(() => resolve()));
  })
    .then(() => Promise.allSettled(inFlightPersistence))
    .then(() => undefined);
}

function activateSelectionPresence(
  room: DocumentRoom,
  documentId: string,
  key: string,
  latest: FirstDraftSelectionPresence,
): void {
  const previous = room.selections.get(key);
  if (previous?.timer !== null && previous?.timer !== undefined) {
    room.selectionPresenceScheduler.clearTimeout(previous.timer);
  }
  const generation = (previous?.generation ?? 0) + 1;
  const deadline =
    room.selectionPresenceScheduler.now() +
    EDITOR_SELECTION_PRESENCE_INACTIVITY_MS;
  const next: SelectionPresenceState = {
    latest,
    active: true,
    deadline,
    generation,
    timer: null,
  };
  room.selections.set(key, next);
  const expire = () => {
    const current = room.selections.get(key);
    if (
      current !== next ||
      !current.active ||
      current.generation !== generation ||
      current.deadline !== deadline
    ) {
      return;
    }
    const remaining = deadline - room.selectionPresenceScheduler.now();
    if (remaining > 0) {
      current.timer = room.selectionPresenceScheduler.setTimeout(
        expire,
        remaining,
      );
      return;
    }
    current.active = false;
    current.deadline = null;
    current.timer = null;
    broadcastSelectionSnapshot(room, documentId);
  };
  next.timer = room.selectionPresenceScheduler.setTimeout(
    expire,
    EDITOR_SELECTION_PRESENCE_INACTIVITY_MS,
  );
}

function activeSelectionPresences(
  room: DocumentRoom,
): FirstDraftSelectionPresence[] {
  return [...room.selections.values()]
    .filter((selection) => selection.active)
    .map((selection) => selection.latest);
}

function removeSelectionPresence(room: DocumentRoom, key: string): void {
  const selection = room.selections.get(key);
  if (!selection) return;
  if (selection.timer !== null) {
    room.selectionPresenceScheduler.clearTimeout(selection.timer);
  }
  room.selections.delete(key);
}

function deleteRoom(
  rooms: Map<string, DocumentRoom>,
  documentId: string,
  room: DocumentRoom,
): void {
  for (const key of room.selections.keys()) removeSelectionPresence(room, key);
  rooms.delete(documentId);
}

const systemTimeoutScheduler: EditorRealtimeTimeoutScheduler = {
  now: () => Date.now(),
  setTimeout(callback, delayMs) {
    const timer = setTimeout(callback, delayMs);
    timer.unref();
    return timer;
  },
  clearTimeout(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};
