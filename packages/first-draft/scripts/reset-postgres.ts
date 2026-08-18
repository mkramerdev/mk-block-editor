import { createFirstDraftSnapshot } from "../src/first-draft-fixture.ts";
import {
  FIRST_DRAFT_DEVELOPMENT_POSTGRES_URL,
  assertFirstDraftPostgresSchema,
  recreateFirstDraftPostgresDatabase,
  seedFirstDraftPostgresDocument,
} from "../src/server/index.ts";
import { Pool } from "pg";

const connectionString =
  process.env.EDITOR_DOCUMENT_POSTGRES_URL ??
  FIRST_DRAFT_DEVELOPMENT_POSTGRES_URL;
const documentId =
  process.env.FIRST_DRAFT_SEED_DOCUMENT_ID ??
  "01890f07-1c00-7000-8000-000000040001";

await recreateFirstDraftPostgresDatabase(connectionString);
const pool = new Pool({ connectionString });
try {
  await assertFirstDraftPostgresSchema(pool);
  const result = await seedFirstDraftPostgresDocument({
    client: pool,
    documentId,
    snapshot: createFirstDraftSnapshot(),
  });
  await assertFirstDraftPostgresSchema(pool);
  console.log(
    `Reset First Draft PostgreSQL and seeded document ${result.documentId} (${result.blockCount} blocks)`,
  );
  console.log(`First Draft document ID: ${result.documentId}`);
} finally {
  await pool.end();
}
