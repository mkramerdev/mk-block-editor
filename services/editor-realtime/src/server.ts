import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from "node:http";
import { isDeepStrictEqual } from "node:util";
import {
  decodeFirstDraftMessage,
  encodeFirstDraftMessage,
  FIRST_DRAFT_PROTOCOL_VERSION,
  MAX_FIRST_DRAFT_FRAME_BYTES,
  type ConnectFirstDraftSessionMessage,
  type FirstDraftAcceptedTransactionReplayMessage,
  type FirstDraftCollaborationSubject,
  type FirstDraftParticipantPresence,
  type FirstDraftParticipantUpdateMessage,
  type FirstDraftSelectionPresence,
  type FirstDraftSelectionUpdateMessage,
  type FirstDraftServerMessage,
  type FirstDraftSessionIdentity,
} from "@repo/editor-first-draft/protocol";
import {
  type AcceptFirstDraftTransactionResult,
  type FirstDraftTransactionPersistence,
  type FirstDraftDocumentLoader,
} from "@repo/editor-first-draft/server";
import { WebSocket, WebSocketServer } from "ws";
import {
  createEditorRealtimeAuthenticator,
  type EditorRealtimeAuthenticator,
} from "./auth.ts";
import {
  loadEditorRealtimeConfig,
  type EditorRealtimeConfig,
} from "./config.ts";

const EDITOR_REALTIME_PATH = "/editor-realtime";
export const EDITOR_SELECTION_PRESENCE_INACTIVITY_MS = 30_000;

export interface EditorRealtimeTimeoutScheduler {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

interface ClientState {
  readonly socket: WebSocket;
  phase: "awaiting-session" | "authenticating" | "active";
  session: FirstDraftSessionIdentity | null;
  subscribed: boolean;
  subscriptionLoading: boolean;
  acceptedReplayQueue: FirstDraftAcceptedTransactionReplayMessage[];
  finalized: boolean;
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
  close(): Promise<void>;
}

export interface CreateEditorRealtimeServerOptions {
  readonly persistence: FirstDraftTransactionPersistence;
  readonly documentLoader: FirstDraftDocumentLoader;
  readonly readiness?: EditorRealtimeReadiness;
  readonly config?: EditorRealtimeConfig;
  readonly authenticator?: EditorRealtimeAuthenticator;
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
  const authenticator =
    options.authenticator ?? createEditorRealtimeAuthenticator(config);
  const selectionPresenceScheduler =
    options.selectionPresenceScheduler ?? systemTimeoutScheduler;
  const clients = new Set<ClientState>();
  const rooms = new Map<string, DocumentRoom>();
  const inFlightPersistence = new Set<Promise<void>>();
  const persistenceTails = new Map<string, Promise<void>>();
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
    webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
      webSocketServer.emit("connection", webSocket, request);
    });
  });

  webSocketServer.on("connection", (socket) => {
    const state: ClientState = {
      socket,
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
        authenticator,
        selectionPresenceScheduler,
        rooms,
        persistence: options.persistence,
        documentLoader: options.documentLoader,
        inFlightPersistence,
        persistenceTails,
        onProtocolDiagnostic: options.onProtocolDiagnostic,
        onPersistenceDiagnostic: options.onPersistenceDiagnostic,
      }).catch((error: unknown) => {
        reportProtocolError({
          state,
          code: "internal-error",
          message: error instanceof Error ? error.message : String(error),
          fatal: true,
          onProtocolDiagnostic: options.onProtocolDiagnostic,
        });
      });
    });
    socket.on("close", () => finalizeClient(clients, rooms, state));
    socket.on("error", () => finalizeClient(clients, rooms, state));
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
  readonly authenticator: EditorRealtimeAuthenticator;
  readonly selectionPresenceScheduler: EditorRealtimeTimeoutScheduler;
  readonly rooms: Map<string, DocumentRoom>;
  readonly persistence: FirstDraftTransactionPersistence;
  readonly documentLoader: FirstDraftDocumentLoader;
  readonly inFlightPersistence: Set<Promise<void>>;
  readonly persistenceTails: Map<string, Promise<void>>;
  readonly onProtocolDiagnostic?: (
    diagnostic: EditorRealtimeProtocolDiagnostic,
  ) => void;
  readonly onPersistenceDiagnostic?: (
    diagnostic: EditorRealtimePersistenceDiagnostic,
  ) => void;
}): Promise<void> {
  const { state } = input;
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
    await establishSession({
      state,
      frame,
      authenticator: input.authenticator,
      rooms: input.rooms,
      onProtocolDiagnostic: input.onProtocolDiagnostic,
    });
    return;
  }

  const session = state.session;
  if (!session) {
    reportProtocolError({
      state,
      code: "invalid-session-state",
      message: "Authenticated session identity is unavailable",
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
      message.documentId,
      input.documentLoader,
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
        : "Subscribe to the authenticated document before publishing realtime state",
      fatal: false,
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
  readonly rooms: Map<string, DocumentRoom>;
  readonly onPersistenceDiagnostic?: (
    diagnostic: EditorRealtimePersistenceDiagnostic,
  ) => void;
}): void {
  const encodedTransaction = input.frame.slice();
  const documentId = input.session.documentId;
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
    input.inFlightPersistence.delete(tail);
    if (input.persistenceTails.get(documentId) === tail) {
      input.persistenceTails.delete(documentId);
    }
  });
  input.persistenceTails.set(documentId, tail);
  input.inFlightPersistence.add(tail);
}

async function establishSession(input: {
  readonly state: ClientState;
  readonly frame: Uint8Array;
  readonly authenticator: EditorRealtimeAuthenticator;
  readonly rooms: Map<string, DocumentRoom>;
  readonly onProtocolDiagnostic?: (
    diagnostic: EditorRealtimeProtocolDiagnostic,
  ) => void;
}): Promise<void> {
  if (input.state.phase === "authenticating") {
    reportProtocolError({
      state: input.state,
      code: "authentication-in-progress",
      message: "The First Draft session handshake is still being authenticated",
      fatal: true,
      onProtocolDiagnostic: input.onProtocolDiagnostic,
    });
    return;
  }
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
  input.state.phase = "authenticating";
  const connection = decoded.message satisfies ConnectFirstDraftSessionMessage;
  const authentication =
    await input.authenticator.authenticateAndAuthorizeSession(connection);
  if (!authentication.ok) {
    reportProtocolError({
      state: input.state,
      code: authentication.code,
      message: authentication.message,
      fatal: true,
      onProtocolDiagnostic: input.onProtocolDiagnostic,
    });
    return;
  }
  if (input.state.finalized) return;
  input.state.phase = "active";
  input.state.session = Object.freeze({
    actorId: authentication.actorId,
    clientId: authentication.clientId,
    sessionId: authentication.sessionId,
    documentId: authentication.documentId,
  });
  sendFirstDraftMessage(input.state.socket, {
    type: "first-draft-session-connected",
    ...input.state.session,
  });
}

async function subscribeToDocument(
  rooms: Map<string, DocumentRoom>,
  state: ClientState,
  documentId: string,
  documentLoader: FirstDraftDocumentLoader,
  selectionPresenceScheduler: EditorRealtimeTimeoutScheduler,
  onProtocolDiagnostic?: (diagnostic: EditorRealtimeProtocolDiagnostic) => void,
): Promise<void> {
  if (!authorizedDocument(state, documentId)) {
    reportProtocolError({
      state,
      code: "unauthorized-document",
      message: "The authenticated session cannot subscribe to this document",
      fatal: false,
      onProtocolDiagnostic,
    });
    return;
  }
  if (state.subscribed || state.subscriptionLoading) {
    reportProtocolError({
      state,
      code: "document-subscription-active",
      message: "The authenticated session already has a document subscription",
      fatal: false,
      onProtocolDiagnostic,
    });
    return;
  }
  const room = ensureRoom(rooms, documentId, selectionPresenceScheduler);
  room.clients.add(state);
  state.subscriptionLoading = true;
  state.acceptedReplayQueue = [];
  const loaded = await documentLoader.loadBootstrap(documentId);
  state.subscriptionLoading = false;
  if (state.finalized) return;
  if (!loaded.ok) {
    room.clients.delete(state);
    if (room.clients.size === 0) deleteRoom(rooms, documentId, room);
    state.acceptedReplayQueue = [];
    reportProtocolError({
      state,
      code: `document-load-${loaded.reason}`,
      message: loaded.message,
      fatal: true,
      onProtocolDiagnostic,
    });
    return;
  }
  const initialRevision = loaded.bootstrap.revision;
  const replayByRevision = new Map<number, FirstDraftAcceptedTransactionReplayMessage>();
  for (const accepted of state.acceptedReplayQueue) {
    if (accepted.revision <= initialRevision) continue;
    const existing = replayByRevision.get(accepted.revision);
    if (existing && existing.transactionId !== accepted.transactionId) {
      reportProtocolError({
        state,
        code: "revision-replay-conflict",
        message: "Accepted transaction replay contains conflicting revisions",
        fatal: true,
        onProtocolDiagnostic,
      });
      return;
    }
    replayByRevision.set(accepted.revision, accepted);
  }
  const replay = [...replayByRevision.values()].sort((left, right) => left.revision - right.revision);
  let replayRevision = initialRevision;
  for (const accepted of replay) {
    if (accepted.baseRevision !== replayRevision || accepted.revision !== replayRevision + 1) {
      reportProtocolError({
        state,
        code: "revision-replay-non-contiguous",
        message: "Accepted transaction replay is not contiguous",
        fatal: true,
        onProtocolDiagnostic,
      });
      return;
    }
    replayRevision = accepted.revision;
  }
  state.acceptedReplayQueue = [];
  state.subscribed = true;
  sendFirstDraftMessage(state.socket, {
    type: "first-draft-document-loaded",
    documentId,
    revision: initialRevision,
    bootstrap: loaded.bootstrap,
  });
  for (const accepted of replay) sendFirstDraftMessage(state.socket, accepted);
  sendFirstDraftMessage(state.socket, {
    type: "first-draft-document-caught-up",
    documentId,
    requestedRevision: initialRevision,
    revision: replayRevision,
  });
  sendSnapshots(state.socket, documentId, room);
}

function broadcastAcceptedTransaction(
  rooms: ReadonlyMap<string, DocumentRoom>,
  sender: ClientState,
  message: FirstDraftAcceptedTransactionReplayMessage,
): void {
  for (const client of rooms.get(message.documentId)?.clients ?? []) {
    if (client === sender) continue;
    if (client.subscriptionLoading) {
      client.acceptedReplayQueue.push(message);
    } else if (client.subscribed && client.socket.readyState === WebSocket.OPEN) {
      sendFirstDraftMessage(client.socket, message);
    }
  }
}

function unsubscribeFromDocument(
  rooms: Map<string, DocumentRoom>,
  state: ClientState,
  documentId: string,
): void {
  if (!authorizedDocument(state, documentId)) return;
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
  if (!authorizeEphemeralMessage(state, message, onProtocolDiagnostic)) return;
  const room = rooms.get(message.documentId);
  if (!room) return;
  const key = subjectKey(message.subject);
  const previous = room.participants.get(key);
  if (previous && message.presenceRevision <= previous.presenceRevision) {
    if (
      message.presenceRevision === previous.presenceRevision &&
      JSON.stringify(message) !==
        JSON.stringify({
          type: message.type,
          documentId: message.documentId,
          ...previous,
        })
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
  room.participants.set(key, {
    subject: message.subject,
    presenceRevision: message.presenceRevision,
    active: message.active,
    metadata: message.metadata,
  });
  if (!message.active) removeSelectionPresence(room, key);
  broadcastMessage(room, state, message);
  if (message.active) sendSnapshots(state.socket, message.documentId, room);
  else broadcastSelectionSnapshot(room, message.documentId, state);
}

function applySelectionUpdate(
  rooms: Map<string, DocumentRoom>,
  state: ClientState,
  message: FirstDraftSelectionUpdateMessage,
  onProtocolDiagnostic?: (diagnostic: EditorRealtimeProtocolDiagnostic) => void,
): void {
  if (!authorizeEphemeralMessage(state, message, onProtocolDiagnostic)) return;
  const room = rooms.get(message.documentId);
  if (!room) return;
  const key = subjectKey(message.subject);
  const previous = room.selections.get(key);
  if (
    previous &&
    message.selectionRevision <= previous.latest.selectionRevision
  ) {
    if (
      message.selectionRevision === previous.latest.selectionRevision &&
      !isDeepStrictEqual(message.selection, previous.latest.selection)
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
  const next = {
    subject: message.subject,
    selectionRevision: message.selectionRevision,
    selection: message.selection,
  } satisfies FirstDraftSelectionPresence;
  if (previous && isDeepStrictEqual(next.selection, previous.latest.selection)) {
    previous.latest = next;
    if (previous.active) broadcastMessage(room, state, message);
    return;
  }
  activateSelectionPresence(room, message.documentId, key, next);
  broadcastMessage(room, state, message);
}

function authorizeEphemeralMessage(
  state: ClientState,
  message: {
    readonly documentId: string;
    readonly subject: FirstDraftCollaborationSubject;
  },
  onProtocolDiagnostic?: (diagnostic: EditorRealtimeProtocolDiagnostic) => void,
): boolean {
  const valid =
    state.subscribed &&
    authorizedDocument(state, message.documentId) &&
    sameSubject(state.session, message.subject);
  if (valid) return true;
  reportProtocolError({
    state,
    code: "unauthorized-presence",
    message: "Presence requires the authenticated subscribed session identity",
    fatal: false,
    onProtocolDiagnostic,
  });
  return false;
}

function authorizedDocument(state: ClientState, documentId: string): boolean {
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
  state: ClientState,
): void {
  if (state.finalized) return;
  state.finalized = true;
  clients.delete(state);
  removeSessionFromRoom(rooms, state);
}

function removeSessionFromRoom(
  rooms: Map<string, DocumentRoom>,
  state: ClientState,
): void {
  const session = state.session;
  if (!session || !state.subscribed) return;
  state.subscribed = false;
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
  if (room.clients.size === 0)
    deleteRoom(rooms, session.documentId, room);
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

function isEditorRealtimeUpgrade(request: IncomingMessage): boolean {
  const url = new URL(request.url ?? "/", "http://localhost");
  return url.pathname === EDITOR_REALTIME_PATH;
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
