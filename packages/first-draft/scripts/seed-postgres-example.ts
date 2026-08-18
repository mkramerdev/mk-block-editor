import { createFirstDraftSnapshot } from "../src/first-draft-fixture.ts";
import {
  FIRST_DRAFT_EDITOR_TABLES,
  FIRST_DRAFT_DEVELOPMENT_POSTGRES_URL,
  assertFirstDraftPostgresSchema,
  installFirstDraftPostgresSchema,
  seedFirstDraftPostgresDocument,
  validateFirstDraftPostgresSchema,
} from "../src/server/index.ts";
import { Pool } from "pg";

const documentId =
  process.env.FIRST_DRAFT_SEED_DOCUMENT_ID ??
  "01890f07-1c00-7000-8000-000000040001";
const connectionString =
  process.env.EDITOR_DOCUMENT_POSTGRES_URL ??
  FIRST_DRAFT_DEVELOPMENT_POSTGRES_URL;
const pool = new Pool({ connectionString });

try {
  const schema = await validateFirstDraftPostgresSchema(pool);
  const isEmptyDatabase =
    !schema.ok &&
    schema.issues.length === FIRST_DRAFT_EDITOR_TABLES.length &&
    schema.issues.every((issue) => issue.startsWith("missing public."));
  if (isEmptyDatabase) await installFirstDraftPostgresSchema(pool);
  await assertFirstDraftPostgresSchema(pool);
  const result = await seedFirstDraftPostgresDocument({
    client: pool,
    documentId,
    snapshot: createFirstDraftSnapshot(),
  });
  console.log(
    `Seeded First Draft PostgreSQL document ${result.documentId} (${result.blockCount} blocks)`,
  );
} catch (error) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  ) {
    console.log(`First Draft PostgreSQL document ${documentId} already exists`);
  } else {
    throw error;
  }
} finally {
  await pool.end();
}
