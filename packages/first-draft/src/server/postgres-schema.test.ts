import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertSafeFirstDraftResetTarget } from "./postgres-reset.ts";
import { FIRST_DRAFT_POSTGRES_SCHEMA_SQL } from "./postgres-schema.ts";

const packageRoot = resolve(import.meta.dirname, "../..");
const repositoryRoot = resolve(packageRoot, "../..");

describe("the canonical First Draft PostgreSQL schema", () => {
  it("owns exactly the three authoritative editor tables in public", () => {
    const tables = [
      ...FIRST_DRAFT_POSTGRES_SCHEMA_SQL.matchAll(
        /CREATE TABLE public\.([a-z0-9_]+)/gu,
      ),
    ].map((match) => match[1]);

    expect(tables).toEqual([
      "editor_documents",
      "editor_blocks",
      "editor_transactions",
    ]);
    expect(FIRST_DRAFT_POSTGRES_SCHEMA_SQL).toContain(
      "content_checkpoint_base64 TEXT",
    );
    expect(FIRST_DRAFT_POSTGRES_SCHEMA_SQL).not.toContain("hydration_cache");
    expect(FIRST_DRAFT_POSTGRES_SCHEMA_SQL).not.toMatch(
      /workspace_id|schema_version|editor_schema_metadata|product_editor_view_state|ALTER TABLE/iu,
    );
  });

  it("is the schema source used by development, acceptance, and browser setup", () => {
    const firstDraftPackage = source("packages/first-draft/package.json");
    const realtimePackage = source("services/editor-realtime/package.json");
    const seed = source(
      "packages/first-draft/scripts/seed-postgres-example.ts",
    );
    const browserServer = source(
      "services/editor-realtime/test/first-draft-browser-server.ts",
    );
    const rootPackage = source("package.json");
    const combined = [
      firstDraftPackage,
      realtimePackage,
      seed,
      browserServer,
      rootPackage,
    ].join("\n");

    expect(firstDraftPackage).not.toContain("@repo/editor-demo-postgres");
    expect(realtimePackage).not.toContain("@repo/editor-demo-postgres");
    expect(seed).toContain("seedFirstDraftPostgresDocument");
    expect(browserServer).toContain("recreateFirstDraftPostgresDatabase");
    expect(rootPackage).toContain('"db:reset:first-draft"');
    expect(combined).not.toMatch(
      /editor_playwright|PGOPTIONS|search_path|skipSchemaBootstrap|editor_schema_metadata|schema_version/iu,
    );
  });

  it("allows only explicit local development or test reset targets", () => {
    expect(
      assertSafeFirstDraftResetTarget(
        "postgres://postgres:postgres@127.0.0.1:5435/editor_document",
      ),
    ).toEqual({ databaseName: "editor_document" });
    expect(
      assertSafeFirstDraftResetTarget(
        "postgres://postgres:postgres@localhost:5435/editor_document_browser_test",
      ),
    ).toEqual({ databaseName: "editor_document_browser_test" });
    expect(() =>
      assertSafeFirstDraftResetTarget(
        "postgres://postgres:postgres@database.example.com/editor_document_test",
      ),
    ).toThrow("refuses non-local");
    expect(() =>
      assertSafeFirstDraftResetTarget(
        "postgres://postgres:postgres@127.0.0.1/editor_document_production",
      ),
    ).toThrow("production-like");
    expect(() =>
      assertSafeFirstDraftResetTarget(
        "postgres://postgres:postgres@127.0.0.1/postgres",
      ),
    ).toThrow("production-like");
  });
});

function source(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), "utf8");
}
