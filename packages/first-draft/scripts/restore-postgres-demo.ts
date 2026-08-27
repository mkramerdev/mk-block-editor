import { Pool } from "pg";
import { createFirstDraftDefaultSnapshot } from "../src/first-draft-fixture.ts";
import {
  assertFirstDraftPostgresSchema,
  restoreFirstDraftPostgresDocument,
} from "../src/server/index.ts";

const connectionString = requiredEnvironment(
  "EDITOR_DOCUMENT_POSTGRES_URL",
);
const documentId = requiredEnvironment("FIRST_DRAFT_DOCUMENT_ID");
const allowedDocumentIds = new Set(
  requiredEnvironment("EDITOR_REALTIME_PUBLIC_DOCUMENT_IDS")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean),
);
if (!allowedDocumentIds.has(documentId)) {
  throw new Error(
    "FIRST_DRAFT_DOCUMENT_ID must be explicitly present in EDITOR_REALTIME_PUBLIC_DOCUMENT_IDS",
  );
}
const target = new URL(connectionString);
const databaseName = decodeURIComponent(target.pathname.replace(/^\/+/, ""));
if (
  (target.protocol !== "postgres:" && target.protocol !== "postgresql:") ||
  databaseName.length === 0 ||
  databaseName === "postgres" ||
  databaseName.startsWith("template")
) {
  throw new Error("First Draft document restore target is invalid");
}

console.log(
  `Restoring only First Draft document ${documentId} in PostgreSQL database ${databaseName} on ${target.hostname}`,
);
const pool = new Pool({ connectionString });
try {
  await assertFirstDraftPostgresSchema(pool);
  const result = await restoreFirstDraftPostgresDocument({
    client: pool,
    documentId,
    snapshot: createFirstDraftDefaultSnapshot(),
  });
  console.log(
    `Restored First Draft document ${result.documentId} (${result.blockCount} blocks)`,
  );
} finally {
  await pool.end();
}

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for document restore`);
  return value;
}
