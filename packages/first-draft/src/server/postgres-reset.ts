import { Pool } from "pg";
import { installFirstDraftPostgresSchema } from "./postgres-schema.ts";

export const FIRST_DRAFT_DEVELOPMENT_POSTGRES_URL =
  "postgres://editor:editor@127.0.0.1:5435/editor_document";

/** Destructively recreates only a clearly named local development/test database. */
export async function recreateFirstDraftPostgresDatabase(
  connectionString: string,
): Promise<void> {
  const target = safeResetTarget(connectionString);
  const maintenanceUrl = new URL(connectionString);
  maintenanceUrl.pathname = "/postgres";
  const maintenancePool = new Pool({
    connectionString: maintenanceUrl.toString(),
  });
  try {
    await maintenancePool.query(
      `SELECT pg_terminate_backend(pid)
       FROM pg_catalog.pg_stat_activity
       WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [target.databaseName],
    );
    await maintenancePool.query(
      `DROP DATABASE IF EXISTS ${quoteIdentifier(target.databaseName)}`,
    );
    await maintenancePool.query(
      `CREATE DATABASE ${quoteIdentifier(target.databaseName)}`,
    );
  } finally {
    await maintenancePool.end();
  }

  const targetPool = new Pool({ connectionString });
  try {
    await installFirstDraftPostgresSchema(targetPool);
  } finally {
    await targetPool.end();
  }
}

export function assertSafeFirstDraftResetTarget(connectionString: string): {
  readonly databaseName: string;
} {
  return safeResetTarget(connectionString);
}

function safeResetTarget(connectionString: string): {
  readonly databaseName: string;
} {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("First Draft reset requires an explicit PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("First Draft reset target must use PostgreSQL");
  }
  if (!isLocalHost(url.hostname)) {
    throw new Error("First Draft reset refuses non-local PostgreSQL hosts");
  }
  const databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
  const developmentName =
    databaseName === "editor_document" ||
    /(?:^|[_-])(?:dev|development|test|testing)(?:$|[_-])/iu.test(databaseName);
  if (
    !developmentName ||
    /(?:^|[_-])(?:prod|production|stage|staging)(?:$|[_-])/iu.test(databaseName)
  ) {
    throw new Error(
      `First Draft reset refuses production-like database ${databaseName || "<empty>"}`,
    );
  }
  return { databaseName };
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "127.0.0.1" ||
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]"
  );
}

function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/gu, '""')}"`;
}
