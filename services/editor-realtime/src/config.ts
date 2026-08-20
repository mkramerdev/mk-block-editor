export interface EditorRealtimeConfig {
  readonly host: string;
  readonly port: number;
  readonly nodeEnv: string;
  readonly postgresUrl: string;
}

const DEVELOPMENT_POSTGRES_URL =
  "postgres://editor:editor@127.0.0.1:5435/editor_document";

export function loadEditorRealtimeConfig(
  env: Record<string, string | undefined> = process.env,
): EditorRealtimeConfig {
  const nodeEnv = env.NODE_ENV ?? "development";

  return {
    host: readOptionalString(env.EDITOR_REALTIME_HOST) ?? "0.0.0.0",
    port: readPort(env.EDITOR_REALTIME_PORT),
    nodeEnv,
    postgresUrl:
      readOptionalString(env.EDITOR_DOCUMENT_POSTGRES_URL) ??
      (nodeEnv === "production"
        ? readRequiredString(undefined, "EDITOR_DOCUMENT_POSTGRES_URL")
        : DEVELOPMENT_POSTGRES_URL),
  };
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
