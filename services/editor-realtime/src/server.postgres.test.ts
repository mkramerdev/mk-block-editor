import {
  createFirstDraftPostgresPersistence,
  recreateFirstDraftPostgresDatabase,
} from "@repo/editor-first-draft/server";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startEditorRealtimeServer } from "./server.ts";

const configuredPostgresUrl = process.env.EDITOR_DOCUMENT_POSTGRES_URL?.trim();
const postgresUrl = configuredPostgresUrl
  ? startupTestDatabaseUrl(configuredPostgresUrl)
  : null;

describe.skipIf(postgresUrl === null)(
  "editor realtime canonical PostgreSQL startup",
  () => {
    beforeAll(async () => {
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
              authMode: "dev-shared",
              devSharedToken: "startup-test-token",
              nodeEnv: "test",
              postgresUrl: postgresUrl!,
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
  },
);

function startupTestDatabaseUrl(connectionString: string): string {
  const url = new URL(connectionString);
  url.pathname = "/editor_document_first_draft_startup_test";
  return url.toString();
}
