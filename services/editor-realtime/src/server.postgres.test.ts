import {
  createFirstDraftPostgresPersistence,
  recreateFirstDraftPostgresDatabase,
  seedFirstDraftPostgresDocument,
} from "@repo/editor-first-draft/server";
import {
  createFirstDraftEditorDefinition,
  createFirstDraftViewStateStore,
} from "@repo/editor-first-draft/definition";
import { firstDraftBootstrapSnapshot } from "@repo/editor-first-draft/bootstrap";
import { createFirstDraftSnapshot } from "@repo/editor-first-draft/fixture";
import {
  attachFirstDraftRemoteTransactions,
  convertEditorTransactionToTransport,
  createFirstDraftMessageDispatcher,
  createFirstDraftOutboundPublisher,
  decodeFirstDraftMessage,
  encodeFirstDraftMessage,
  type FirstDraftConnectionSocket,
  type FirstDraftMessage,
  type FirstDraftSessionIdentity,
} from "@repo/editor-first-draft/transport";
import { extractPlainTextFromRichTextDocument } from "@repo/editor-core/content/rich-text";
import type { EditorTransportTransaction } from "@repo/editor-first-draft/transport";
import { asBlockId } from "@repo/editor-core/kernel";
import { initializeEditableEditor } from "@repo/editor-web/editor";
import { compileCanonicalEditorDefinition } from "@repo/editor-web/editor-definition";
import { once } from "node:events";
import { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startEditorRealtimeServer } from "./server.ts";

const configuredPostgresUrl = process.env.EDITOR_DOCUMENT_POSTGRES_URL?.trim();
const postgresUrl = configuredPostgresUrl
  ? startupTestDatabaseUrl(configuredPostgresUrl)
  : null;
const replayDocumentId = "01890f07-1c00-7000-8000-000000030001";
const firstSeededBlockId = asBlockId(
  "30000000-0000-4000-8000-000000000001",
);

describe.skipIf(postgresUrl === null)(
  "editor realtime canonical PostgreSQL startup",
  () => {
    beforeEach(async () => {
      await recreateFirstDraftPostgresDatabase(postgresUrl!);
    });

    afterAll(async () => {
      await recreateFirstDraftPostgresDatabase(postgresUrl!);
    });

    it("fails before listening when the configured public schema is incomplete", async () => {
      const pool = new Pool({ connectionString: postgresUrl! });
      await pool.query("DROP TABLE public.editor_transactions");
      await pool.end();
      const persistence = createFirstDraftPostgresPersistence({
        connectionString: postgresUrl!,
      });

      try {
        await expect(
          startEditorRealtimeServer({
            config: {
              host: "127.0.0.1",
              port: 0,
              nodeEnv: "test",
              postgresUrl: postgresUrl!,
              publicDocumentIds: ["document-one"],
              allowedOrigins: ["http://localhost:3000"],
              limits: {
                globalConnections: 10,
                connectionsPerAddress: 10,
                sessionsPerDocument: 10,
                messagesPerWindow: 100,
                messageWindowMs: 60_000,
                transactionsPerWindow: 100,
                transactionWindowMs: 60_000,
                bytesPerWindow: 64 * 1_024 * 1_024,
                byteWindowMs: 60_000,
                clientFrameBytes: 2 * 1_024 * 1_024,
                pendingTransactionsPerDocument: 64,
              },
            },
            persistence,
            documentLoader: persistence,
            readiness: persistence,
          }),
        ).rejects.toThrow(
          "First Draft PostgreSQL schema is incompatible:\nmissing public.editor_transactions.\nRun `pnpm db:reset:first-draft` for local development.",
        );
      } finally {
        await persistence.close();
      }
    });

    it("replays the PostgreSQL suffix and one transaction accepted during loading exactly once", async () => {
      const pool = new Pool({ connectionString: postgresUrl! });
      const persistence = createFirstDraftPostgresPersistence({
        connectionString: postgresUrl!,
      });
      const loading = deferred<void>();
      const replayRead = deferred<void>();
      try {
        await seedFirstDraftPostgresDocument({
          client: pool,
          documentId: replayDocumentId,
          snapshot: createFirstDraftSnapshot(),
        });
        const first = metadataTransaction("postgres-replay-one", "one");
        const second = metadataTransaction("postgres-replay-two", "two");
        await accept(persistence, first);
        await accept(persistence, second);

        const server = await startEditorRealtimeServer({
          config: {
            host: "127.0.0.1",
            port: 0,
            nodeEnv: "test",
            postgresUrl: postgresUrl!,
            publicDocumentIds: [replayDocumentId],
            allowedOrigins: ["http://localhost:3000"],
            limits: {
              globalConnections: 10,
              connectionsPerAddress: 10,
              sessionsPerDocument: 10,
              messagesPerWindow: 100,
              messageWindowMs: 60_000,
              transactionsPerWindow: 100,
              transactionWindowMs: 60_000,
              bytesPerWindow: 64 * 1_024 * 1_024,
              byteWindowMs: 60_000,
              clientFrameBytes: 2 * 1_024 * 1_024,
              pendingTransactionsPerDocument: 64,
            },
          },
          persistence,
          documentLoader: {
            loadBootstrap: (documentId) =>
              persistence.loadBootstrap(documentId),
            async loadAcceptedTransactions(documentId, revision) {
              const result = await persistence.loadAcceptedTransactions(
                documentId,
                revision,
              );
              replayRead.resolve();
              await loading.promise;
              return result;
            },
          },
          readiness: persistence,
        });
        const sockets: WebSocket[] = [];
        try {
          const author = await connectAndSubscribe(server, "author");
          sockets.push(author);
          const joining = await connect(server, "joining");
          sockets.push(joining);
          const received: FirstDraftMessage[] = [];
          joining.on("message", (data, isBinary) => {
            if (!isBinary) return;
            const decoded = decodeFirstDraftMessage(toBytes(data));
            if (decoded.ok) received.push(decoded.message);
          });
          joining.send(
            encodeFirstDraftMessage({
              type: "subscribe-first-draft-document",
              documentId: replayDocumentId,
              knownRevision: 0,
            }),
          );
          await replayRead.promise;

          const thirdAccepted = waitForMessage(
            author,
            (message) => message.type === "editor-transaction-accepted",
          );
          author.send(
            encodeFirstDraftMessage({
              type: "proposed-editor-transaction",
              transaction: metadataTransaction(
                "postgres-replay-during-load",
                "three",
              ),
            }),
          );
          await thirdAccepted;
          const caughtUp = waitForMessage(
            joining,
            (message) => message.type === "first-draft-document-caught-up",
          );
          loading.resolve();
          await expect(caughtUp).resolves.toMatchObject({
            requestedRevision: 0,
            revision: 3,
          });
          expect(
            received
              .filter(
                (message) =>
                  message.type ===
                  "first-draft-accepted-transaction-replay",
              )
              .map((message) => [message.transactionId, message.revision]),
          ).toEqual([
            ["postgres-replay-one", 1],
            ["postgres-replay-two", 2],
            ["postgres-replay-during-load", 3],
          ]);
          expect(
            received.some(
              (message) => message.type === "first-draft-document-loaded",
            ),
          ).toBe(false);
        } finally {
          for (const socket of sockets) socket.close();
          await server.close();
        }
      } finally {
        await persistence.close();
        await pool.end();
      }
    });

    it("resolves a real publisher aggregate from its canonical PostgreSQL replay without resending", async () => {
      const pool = new Pool({ connectionString: postgresUrl! });
      const persistence = createFirstDraftPostgresPersistence({
        connectionString: postgresUrl!,
      });
      const fixture = createFirstDraftSnapshot();
      await seedFirstDraftPostgresDocument({
        client: pool,
        documentId: replayDocumentId,
        snapshot: fixture,
      });
      const seeded = await persistence.loadBootstrap(replayDocumentId);
      if (!seeded.ok) throw new Error(seeded.message);
      const snapshot = firstDraftBootstrapSnapshot(seeded.bootstrap);
      const server = await startEditorRealtimeServer({
        config: postgresTestConfig(),
        persistence,
        documentLoader: persistence,
        readiness: persistence,
      });
      const sockets: WebSocket[] = [];
      const publisher = createFirstDraftOutboundPublisher();
      let publishedFrame: ArrayBuffer | null = null;
      let editor: ReturnType<typeof initializeEditableEditor> | null = null;
      let peerEditor: ReturnType<typeof initializeEditableEditor> | null = null;
      let detachRemote: (() => void) | null = null;
      let dispatcher: ReturnType<typeof createFirstDraftMessageDispatcher> | null = null;
      try {
        const socket = await connectAndSubscribe(server, "aggregate-author");
        sockets.push(socket);
        publisher.attachGeneration({
          generationId: "postgres-aggregate-generation",
          socket: {
            get readyState() {
              return socket.readyState;
            },
            send(frame) {
              publishedFrame = frame.slice(0);
              socket.send(frame);
            },
          },
          createTransactionId: () =>
            "40000000-0000-4000-8000-000000000090",
          publishSelection: () => undefined,
        });
        publisher.generationCaughtUp();
        const sourceTransactionIds = [
          "40000000-0000-4000-8000-000000000091",
          "40000000-0000-4000-8000-000000000092",
          "40000000-0000-4000-8000-000000000093",
        ];
        editor = initializeEditableEditor({
          compiledDefinition: compileCanonicalEditorDefinition(
            createFirstDraftEditorDefinition(
              createFirstDraftViewStateStore(),
            ),
          ),
          snapshot,
          onChange: (change) => publisher.submitFinalized(change),
          createTransactionId: () =>
            sourceTransactionIds.shift() ?? "unexpected-source-transaction",
        });
        const heading = Object.entries(snapshot.content).find(
          ([, content]) =>
            content !== undefined &&
            extractPlainTextFromRichTextDocument(content).startsWith(
              "Welcome",
            ),
        );
        if (!heading) throw new Error("Seeded rich-text heading is unavailable");
        const headingBlockId = asBlockId(heading[0]);
        const initialText = extractPlainTextFromRichTextDocument(heading[1]!);
        expect(
          editor.insertText({
            blockId: headingBlockId,
            offset: 0,
            text: "A",
          }),
        ).toBe(true);
        expect(
          editor.insertText({
            blockId: headingBlockId,
            offset: 1,
            text: "B",
          }),
        ).toBe(true);
        expect(
          editor.insertText({
            blockId: headingBlockId,
            offset: 2,
            text: "C",
          }),
        ).toBe(true);

        let peerChange: Parameters<typeof convertEditorTransactionToTransport>[0] | null = null;
        peerEditor = initializeEditableEditor({
          compiledDefinition: compileCanonicalEditorDefinition(
            createFirstDraftEditorDefinition(createFirstDraftViewStateStore()),
          ),
          snapshot,
          onChange: (change) => {
            peerChange = change;
          },
          createTransactionId: () =>
            "40000000-0000-4000-8000-000000000094",
        });
        expect(
          peerEditor.insertText({
            blockId: headingBlockId,
            offset: initialText.length,
            text: "Z",
          }),
        ).toBe(true);
        if (!peerChange) throw new Error("Expected the peer transaction");
        const peerSocket = await connectAndSubscribe(server, "aggregate-peer");
        sockets.push(peerSocket);
        const peerAccepted = waitForMessage(
          peerSocket,
          (message) => message.type === "editor-transaction-accepted",
        );
        peerSocket.send(
          encodeFirstDraftMessage({
            type: "proposed-editor-transaction",
            transaction: convertEditorTransactionToTransport(peerChange),
          }),
        );
        await expect(peerAccepted).resolves.toMatchObject({
          baseRevision: 0,
          revision: 1,
        });

        const acceptedPromise = waitForMessage(
          socket,
          (message) => message.type === "editor-transaction-accepted",
        );
        publisher.flush("manual");
        const accepted = await acceptedPromise;
        expect(accepted).toMatchObject({
          transactionId: "40000000-0000-4000-8000-000000000090",
          baseRevision: 1,
          revision: 2,
        });
        if (accepted.type !== "editor-transaction-accepted") {
          throw new Error("Expected local aggregate acceptance");
        }
        expect(publisher.getSnapshot().outstanding).toHaveLength(1);
        expect(publishedFrame).not.toBeNull();

        publisher.detachGeneration({ attemptSend: false });
        socket.close();
        const retrySocket = await connect(server, "aggregate-retry");
        sockets.push(retrySocket);
        dispatcher = createFirstDraftMessageDispatcher(
          retrySocket as unknown as FirstDraftConnectionSocket,
        );
        detachRemote = attachFirstDraftRemoteTransactions(dispatcher, editor, {
          documentId: replayDocumentId,
          initialRevision: 0,
          outbox: publisher,
        });
        let retrySends = 0;
        publisher.attachGeneration({
          generationId: "postgres-aggregate-retry-generation",
          socket: {
            get readyState() {
              return retrySocket.readyState;
            },
            send(frame) {
              retrySends += 1;
              retrySocket.send(frame);
            },
          },
          createTransactionId: () =>
            "unexpected-reconnect-aggregate-identity",
          publishSelection: () => undefined,
        });
        const caughtUp = waitForMessage(
          retrySocket,
          (message) => message.type === "first-draft-document-caught-up",
        );
        retrySocket.send(
          encodeFirstDraftMessage({
            type: "subscribe-first-draft-document",
            documentId: replayDocumentId,
            knownRevision: 0,
          }),
        );
        await expect(caughtUp).resolves.toMatchObject({
          requestedRevision: 0,
          revision: 2,
        });
        publisher.generationCaughtUp();
        expect(publisher.getSnapshot().outstanding).toHaveLength(0);
        expect(retrySends).toBe(0);

        const [rows, reloaded] = await Promise.all([
          pool.query(
            `SELECT transaction_id, revision
             FROM public.editor_transactions
             WHERE document_id = $1`,
            [replayDocumentId],
          ),
          persistence.loadBootstrap(replayDocumentId),
        ]);
        expect(rows.rows).toEqual([
          {
            transaction_id: "40000000-0000-4000-8000-000000000094",
            revision: 1,
          },
          {
            transaction_id: "40000000-0000-4000-8000-000000000090",
            revision: 2,
          },
        ]);
        if (!reloaded.ok) throw new Error(reloaded.message);
        expect(reloaded.bootstrap.revision).toBe(2);
        const reloadedSnapshot = firstDraftBootstrapSnapshot(
          reloaded.bootstrap,
        );
        expect(
          extractPlainTextFromRichTextDocument(
            reloadedSnapshot.content[headingBlockId]!,
          ),
        ).toBe(`ABC${initialText}Z`);
        const localProjection = editor.readBlockContent(headingBlockId, "heading");
        if (!localProjection) throw new Error("Local heading projection is unavailable");
        expect(extractPlainTextFromRichTextDocument(localProjection)).toBe(
          `ABC${initialText}Z`,
        );
      } finally {
        detachRemote?.();
        dispatcher?.dispose();
        peerEditor?.dispose();
        editor?.dispose();
        publisher.dispose();
        for (const socket of sockets) socket.close();
        await server.close();
        await persistence.close();
        await pool.end();
      }
    });
  },
);

function postgresTestConfig() {
  return {
    host: "127.0.0.1",
    port: 0,
    nodeEnv: "test",
    postgresUrl: postgresUrl!,
    publicDocumentIds: [replayDocumentId],
    allowedOrigins: ["http://localhost:3000"],
    limits: {
      globalConnections: 10,
      connectionsPerAddress: 10,
      sessionsPerDocument: 10,
      messagesPerWindow: 2_400,
      messageWindowMs: 60_000,
      transactionsPerWindow: 600,
      transactionWindowMs: 60_000,
      bytesPerWindow: 64 * 1_024 * 1_024,
      byteWindowMs: 60_000,
      clientFrameBytes: 2 * 1_024 * 1_024,
      pendingTransactionsPerDocument: 64,
    },
  };
}

function metadataTransaction(
  transactionId: string,
  phase: string,
): EditorTransportTransaction {
  return {
    transactionId,
    historyAction: "command",
    graph: null,
    metadata: {
      kind: "updateBlockMetadata",
      updates: [{ blockId: firstSeededBlockId, values: { phase } }],
    },
    content: [],
  };
}

function accept(
  persistence: ReturnType<typeof createFirstDraftPostgresPersistence>,
  transaction: EditorTransportTransaction,
) {
  const frame = encodeFirstDraftMessage({
    type: "proposed-editor-transaction",
    transaction,
  });
  return persistence.accept({
    documentId: replayDocumentId,
    transaction,
    encodedTransaction: new Uint8Array(frame),
  });
}

async function connect(
  server: Awaited<ReturnType<typeof startEditorRealtimeServer>>,
  name: string,
): Promise<WebSocket> {
  const socket = new WebSocket(
    `${server.url.replace("http://", "ws://")}/editor-realtime`,
  );
  socket.binaryType = "arraybuffer";
  await once(socket, "open");
  const identity: FirstDraftSessionIdentity = {
    actorId: `actor-${name}`,
    clientId: `client-${name}`,
    sessionId: `session-${name}`,
    documentId: replayDocumentId,
  };
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
  await connected;
  return socket;
}

async function connectAndSubscribe(
  server: Awaited<ReturnType<typeof startEditorRealtimeServer>>,
  name: string,
): Promise<WebSocket> {
  const socket = await connect(server, name);
  const caughtUp = waitForMessage(
    socket,
    (message) => message.type === "first-draft-document-caught-up",
  );
  socket.send(
    encodeFirstDraftMessage({
      type: "subscribe-first-draft-document",
      documentId: replayDocumentId,
    }),
  );
  await caughtUp;
  return socket;
}

function waitForMessage(
  socket: WebSocket,
  predicate: (message: FirstDraftMessage) => boolean,
): Promise<FirstDraftMessage> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData, isBinary: boolean) => {
      if (!isBinary) return;
      const decoded = decodeFirstDraftMessage(toBytes(data));
      if (!decoded.ok || !predicate(decoded.message)) return;
      cleanup();
      resolve(decoded.message);
    };
    const onClose = () => {
      cleanup();
      reject(new Error("Socket closed before the expected message"));
    };
    const cleanup = () => {
      socket.off("message", onMessage);
      socket.off("close", onClose);
    };
    socket.on("message", onMessage);
    socket.on("close", onClose);
  });
}

function toBytes(data: WebSocket.RawData): ArrayBufferView {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return Buffer.concat(data);
  return data;
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function startupTestDatabaseUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = "/editor_document_first_draft_startup_test";
  return url.toString();
}
