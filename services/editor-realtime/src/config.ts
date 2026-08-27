import { MAX_FIRST_DRAFT_CLIENT_FRAME_BYTES } from "@repo/editor-first-draft/protocol";

export interface EditorRealtimeConfig {
  readonly host: string;
  readonly port: number;
  readonly nodeEnv: string;
  readonly postgresUrl: string;
  readonly publicDocumentIds: readonly string[];
  readonly allowedOrigins: readonly string[];
  readonly limits: EditorRealtimeLimits;
}

export interface EditorRealtimeLimits {
  readonly globalConnections: number;
  readonly connectionsPerAddress: number;
  readonly sessionsPerDocument: number;
  readonly messagesPerWindow: number;
  readonly messageWindowMs: number;
  readonly transactionsPerWindow: number;
  readonly transactionWindowMs: number;
  readonly bytesPerWindow: number;
  readonly byteWindowMs: number;
  readonly clientFrameBytes: number;
  readonly pendingTransactionsPerDocument: number;
}

const DEVELOPMENT_POSTGRES_URL =
  "postgres://editor:editor@127.0.0.1:5435/editor_document";
const DEVELOPMENT_DOCUMENT_ID = "01890f07-1c00-7000-8000-000000040001";

export function loadEditorRealtimeConfig(
  env: Record<string, string | undefined> = process.env,
): EditorRealtimeConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const postgresUrl =
    readOptionalString(env.EDITOR_DOCUMENT_POSTGRES_URL) ??
    (nodeEnv === "production"
      ? readRequiredString(undefined, "EDITOR_DOCUMENT_POSTGRES_URL")
      : DEVELOPMENT_POSTGRES_URL);

  const publicDocumentIds = readList(
    env.EDITOR_REALTIME_PUBLIC_DOCUMENT_IDS,
    nodeEnv === "production" ? [] : [DEVELOPMENT_DOCUMENT_ID],
  );
  const allowedOrigins = readOrigins(
    env.EDITOR_REALTIME_ALLOWED_ORIGINS,
    nodeEnv === "production"
      ? []
      : [
          "http://localhost:3000",
          "http://127.0.0.1:3000",
          "http://localhost:3001",
          "http://127.0.0.1:3001",
        ],
  );
  if (nodeEnv === "production" && publicDocumentIds.length === 0) {
    throw new Error("EDITOR_REALTIME_PUBLIC_DOCUMENT_IDS is required");
  }
  if (nodeEnv === "production" && allowedOrigins.length === 0) {
    throw new Error("EDITOR_REALTIME_ALLOWED_ORIGINS is required");
  }

  return {
    host: readOptionalString(env.EDITOR_REALTIME_HOST) ?? "0.0.0.0",
    port: readPort(env.EDITOR_REALTIME_PORT),
    nodeEnv,
    postgresUrl,
    publicDocumentIds,
    allowedOrigins,
    limits: {
      globalConnections: readPositiveInteger(
        env.EDITOR_REALTIME_MAX_CONNECTIONS,
        "EDITOR_REALTIME_MAX_CONNECTIONS",
        100,
      ),
      connectionsPerAddress: readPositiveInteger(
        env.EDITOR_REALTIME_MAX_CONNECTIONS_PER_ADDRESS,
        "EDITOR_REALTIME_MAX_CONNECTIONS_PER_ADDRESS",
        10,
      ),
      sessionsPerDocument: readPositiveInteger(
        env.EDITOR_REALTIME_MAX_SESSIONS_PER_DOCUMENT,
        "EDITOR_REALTIME_MAX_SESSIONS_PER_DOCUMENT",
        50,
      ),
      messagesPerWindow: readPositiveInteger(
        env.EDITOR_REALTIME_MAX_MESSAGES_PER_WINDOW,
        "EDITOR_REALTIME_MAX_MESSAGES_PER_WINDOW",
        2_400,
      ),
      messageWindowMs: readPositiveInteger(
        env.EDITOR_REALTIME_MESSAGE_WINDOW_MS,
        "EDITOR_REALTIME_MESSAGE_WINDOW_MS",
        60_000,
      ),
      transactionsPerWindow: readPositiveInteger(
        env.EDITOR_REALTIME_MAX_TRANSACTIONS_PER_WINDOW,
        "EDITOR_REALTIME_MAX_TRANSACTIONS_PER_WINDOW",
        600,
      ),
      transactionWindowMs: readPositiveInteger(
        env.EDITOR_REALTIME_TRANSACTION_WINDOW_MS,
        "EDITOR_REALTIME_TRANSACTION_WINDOW_MS",
        60_000,
      ),
      bytesPerWindow: readPositiveInteger(
        env.EDITOR_REALTIME_MAX_BYTES_PER_WINDOW,
        "EDITOR_REALTIME_MAX_BYTES_PER_WINDOW",
        64 * 1_024 * 1_024,
      ),
      byteWindowMs: readPositiveInteger(
        env.EDITOR_REALTIME_BYTE_WINDOW_MS,
        "EDITOR_REALTIME_BYTE_WINDOW_MS",
        60_000,
      ),
      clientFrameBytes: readPositiveInteger(
        env.EDITOR_REALTIME_MAX_CLIENT_FRAME_BYTES,
        "EDITOR_REALTIME_MAX_CLIENT_FRAME_BYTES",
        MAX_FIRST_DRAFT_CLIENT_FRAME_BYTES,
      ),
      pendingTransactionsPerDocument: readPositiveInteger(
        env.EDITOR_REALTIME_MAX_PENDING_TRANSACTIONS_PER_DOCUMENT,
        "EDITOR_REALTIME_MAX_PENDING_TRANSACTIONS_PER_DOCUMENT",
        64,
      ),
    },
  };
}

function readList(
  value: string | undefined,
  fallback: readonly string[],
): readonly string[] {
  const parsed = value
    ?.split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return Object.freeze([...(parsed?.length ? new Set(parsed) : fallback)]);
}

function readOrigins(
  value: string | undefined,
  fallback: readonly string[],
): readonly string[] {
  return readList(value, fallback).map((entry) => {
    const url = new URL(entry);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.origin !== entry
    ) {
      throw new Error(
        "EDITOR_REALTIME_ALLOWED_ORIGINS must contain HTTP(S) origins",
      );
    }
    return url.origin;
  });
}

function readPositiveInteger(
  value: string | undefined,
  name: string,
  fallback: number,
): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive safe integer`);
  }
  return parsed;
}

function readRequiredString(value: string | undefined, name: string): string {
  const parsed = readOptionalString(value);
  if (parsed === undefined) throw new Error(`${name} is required`);
  return parsed;
}

function readPort(value: string | undefined): number {
  if (value === undefined || value === "") return 4455;
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65_535) {
    throw new Error(
      "EDITOR_REALTIME_PORT must be an integer between 0 and 65535",
    );
  }
  return port;
}

function readOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
