import { createServer } from "node:http";
import { createFirstDraftSnapshot } from "@repo/editor-first-draft/fixture";
import type {
  AcceptFirstDraftTransactionInput,
  AcceptFirstDraftTransactionResult,
  FirstDraftTransactionPersistence,
} from "@repo/editor-first-draft/server";
import {
  createFirstDraftPostgresPersistence,
  recreateFirstDraftPostgresDatabase,
  seedFirstDraftPostgresDocument,
} from "@repo/editor-first-draft/server";
import { Pool } from "pg";
import { startEditorRealtimeServer } from "../src/server.js";

const postgresUrl =
  process.env.EDITOR_DOCUMENT_POSTGRES_URL ??
  "postgres://editor:editor@127.0.0.1:5435/editor_document";
const realtimePort = Number(process.env.EDITOR_REALTIME_TEST_PORT ?? "4465");
const controlPort = Number(
  process.env.EDITOR_REALTIME_TEST_CONTROL_PORT ?? "4467",
);
const browserDocuments = Object.freeze([
  "01890f07-1c00-7000-8000-000000030001",
  "01890f07-1c00-7000-8000-000000030002",
  "01890f07-1c00-7000-8000-000000030003",
  "01890f07-1c00-7000-8000-000000030004",
  "01890f07-1c00-7000-8000-000000030005",
  "01890f07-1c00-7000-8000-000000030006",
  "01890f07-1c00-7000-8000-000000030007",
  "01890f07-1c00-7000-8000-000000030008",
  "01890f07-1c00-7000-8000-000000030009",
  "01890f07-1c00-7000-8000-000000030010",
  "01890f07-1c00-7000-8000-000000030011",
  "01890f07-1c00-7000-8000-000000030012",
  "01890f07-1c00-7000-8000-000000031001",
  "01890f07-1c00-7000-8000-000000031002",
  "01890f07-1c00-7000-8000-000000031003",
  "01890f07-1c00-7000-8000-000000031004",
  "01890f07-1c00-7000-8000-000000031005",
  "01890f07-1c00-7000-8000-000000031006",
  "01890f07-1c00-7000-8000-000000031007",
  "01890f07-1c00-7000-8000-000000031008",
  "01890f07-1c00-7000-8000-000000031009",
  "01890f07-1c00-7000-8000-000000031010",
  "01890f07-1c00-7000-8000-000000031011",
  "01890f07-1c00-7000-8000-000000031012",
  "01890f07-1c00-7000-8000-000000039001",
  "01890f07-1c00-7000-8000-000000039002",
  "01890f07-1c00-7000-8000-000000039003",
  "01890f07-1c00-7000-8000-000000039004",
  "01890f07-1c00-7000-8000-000000039005",
]);
await recreateFirstDraftPostgresDatabase(postgresUrl);
const databasePool = new Pool({ connectionString: postgresUrl });
await prepareBrowserDocuments();
const postgresPersistence = createFirstDraftPostgresPersistence({
  connectionString: postgresUrl,
});
const pending = new Map<
  string,
  {
    readonly input: AcceptFirstDraftTransactionInput;
    readonly resolve: (result: AcceptFirstDraftTransactionResult) => void;
  }
>();
let failNextPersistence = false;
const settledTransactionIds: string[] = [];

const persistence: FirstDraftTransactionPersistence = {
  accept: (input) =>
    new Promise((resolve) => {
      pending.set(input.transaction.transactionId, { input, resolve });
    }),
};

let realtime = await startRealtime();

async function startRealtime() {
  return startEditorRealtimeServer({
    config: {
      host: "127.0.0.1",
      port: realtimePort,
      authMode: "dev-shared",
      devSharedToken: "dev-editor-realtime-token",
      nodeEnv: "test",
      postgresUrl,
    },
    persistence,
    documentLoader: postgresPersistence,
    readiness: postgresPersistence,
    onProtocolDiagnostic: (diagnostic) => {
      console.error("First Draft browser protocol diagnostic", diagnostic);
    },
  });
}

const control = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/healthz") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        ok: true,
        pending: pending.size,
        startedTransactionIds: [...pending.keys()],
        settledTransactionIds,
        persistenceTails: realtime.persistenceTailCount(),
      }),
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/release-one") {
    void releaseOnePendingTransaction().then(
      (transactionId) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ transactionId }));
      },
      (error: unknown) => {
        console.error("First Draft browser persistence release failed", error);
        response.writeHead(500);
        response.end();
      },
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/release") {
    void releasePendingTransactions().then(
      () => {
        response.writeHead(204);
        response.end();
      },
      (error: unknown) => {
        console.error("First Draft browser persistence release failed", error);
        response.writeHead(500);
        response.end();
      },
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/restart") {
    void restartRealtime().then(
      () => {
        response.writeHead(204);
        response.end();
      },
      (error: unknown) => {
        console.error("First Draft browser realtime restart failed", error);
        response.writeHead(500);
        response.end();
      },
    );
    return;
  }
  if (request.method === "POST" && url.pathname === "/fail-next") {
    failNextPersistence = true;
    response.writeHead(204);
    response.end();
    return;
  }
  if (request.method === "GET" && url.pathname === "/document-state") {
    void readDocumentState(url.searchParams.get("documentId")).then(
      (state) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(state));
      },
      (error: unknown) => {
        console.error("First Draft browser state query failed", error);
        response.writeHead(500);
        response.end();
      },
    );
    return;
  }
  response.writeHead(404);
  response.end();
});

await new Promise<void>((resolve) =>
  control.listen(controlPort, "127.0.0.1", resolve),
);

async function shutdown() {
  await realtime.close();
  await new Promise<void>((resolve, reject) =>
    control.close((error) => (error ? reject(error) : resolve())),
  );
  await postgresPersistence.close();
  await deleteBrowserDocuments();
  await databasePool.end();
}

process.once("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.once("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

async function prepareBrowserDocuments(): Promise<void> {
  for (const documentId of browserDocuments) {
    await seedFirstDraftPostgresDocument({
      client: databasePool,
      documentId,
      snapshot: createFirstDraftSnapshot(),
    });
  }
}

async function deleteBrowserDocuments(): Promise<void> {
  await databasePool.query(
    "DELETE FROM public.editor_documents WHERE document_id = ANY($1::uuid[])",
    [browserDocuments],
  );
}

async function restartRealtime(): Promise<void> {
  await releasePendingTransactions();
  await realtime.close();
  realtime = await startRealtime();
}

async function readDocumentState(documentId: string | null) {
  if (
    !documentId ||
    !browserDocuments.some((candidate) => candidate === documentId)
  ) {
    throw new Error("Unknown First Draft browser document");
  }
  const [document, transactions, blocks] = await Promise.all([
    databasePool.query(
      "SELECT document_id, revision FROM public.editor_documents WHERE document_id = $1",
      [documentId],
    ),
    databasePool.query(
      `SELECT document_id, transaction_id, base_revision, revision, accepted_at
       FROM public.editor_transactions
       WHERE document_id = $1 ORDER BY revision`,
      [documentId],
    ),
    databasePool.query(
      `SELECT block_id, block_type, parent_block_id, tombstone_json,
              read_projection_json, content_checkpoint_base64, updated_at
       FROM public.editor_blocks
       WHERE document_id = $1 ORDER BY block_id`,
      [documentId],
    ),
  ]);
  return {
    document: document.rows[0] ?? null,
    transactions: transactions.rows,
    blocks: blocks.rows,
  };
}

async function releasePendingTransactions(): Promise<void> {
  while (pending.size > 0 || realtime.persistenceTailCount() > 0) {
    if (pending.size > 0) {
      await releaseOnePendingTransaction();
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function releaseOnePendingTransaction(): Promise<string> {
  const entry = pending.entries().next().value as
    | readonly [
        string,
        {
          readonly input: AcceptFirstDraftTransactionInput;
          readonly resolve: (result: AcceptFirstDraftTransactionResult) => void;
        },
      ]
    | undefined;
  if (!entry) throw new Error("No First Draft persistence call is pending");
  const [transactionId, item] = entry;
  const result = await postgresPersistence.accept(
    failNextPersistence
      ? {
          ...item.input,
          documentId: "01890f07-1c00-7000-8000-000000039999",
        }
      : item.input,
  );
  failNextPersistence = false;
  pending.delete(transactionId);
  item.resolve(result);
  settledTransactionIds.push(transactionId);
  return transactionId;
}
