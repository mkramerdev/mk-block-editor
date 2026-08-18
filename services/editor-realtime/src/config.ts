export type EditorRealtimeAuthMode = "dev-shared" | "jwt-jwks";

export interface EditorRealtimeConfig {
  readonly host: string;
  readonly port: number;
  readonly authMode: EditorRealtimeAuthMode;
  readonly devSharedToken?: string;
  readonly jwksUrl?: string;
  readonly jwtIssuer?: string;
  readonly jwtAudience?: string;
  readonly nodeEnv: string;
  readonly postgresUrl: string;
}

const DEVELOPMENT_POSTGRES_URL =
  "postgres://editor:editor@127.0.0.1:5435/editor_document";

export function loadEditorRealtimeConfig(
  env: Record<string, string | undefined> = process.env,
): EditorRealtimeConfig {
  const nodeEnv = env.NODE_ENV ?? "development";
  const authMode = readAuthMode(env.EDITOR_REALTIME_AUTH_MODE);
  const devSharedToken =
    readOptionalString(env.EDITOR_REALTIME_DEV_SHARED_TOKEN) ??
    (nodeEnv === "production" ? undefined : "dev-editor-realtime-token");

  return {
    host: readOptionalString(env.EDITOR_REALTIME_HOST) ?? "0.0.0.0",
    port: readPort(env.EDITOR_REALTIME_PORT),
    authMode,
    ...(devSharedToken === undefined ? {} : { devSharedToken }),
    ...optionalProperty("jwksUrl", env.EDITOR_REALTIME_JWKS_URL),
    ...optionalProperty("jwtIssuer", env.EDITOR_REALTIME_JWT_ISSUER),
    ...optionalProperty("jwtAudience", env.EDITOR_REALTIME_JWT_AUDIENCE),
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

function optionalProperty<Name extends string>(
  name: Name,
  value: string | undefined,
): { readonly [Key in Name]?: string } {
  const parsed = readOptionalString(value);
  return parsed === undefined
    ? {}
    : ({ [name]: parsed } as {
        readonly [Key in Name]?: string;
      });
}

function readAuthMode(value: string | undefined): EditorRealtimeAuthMode {
  if (value === undefined || value === "") return "dev-shared";
  if (value === "dev-shared" || value === "jwt-jwks") return value;
  throw new Error("EDITOR_REALTIME_AUTH_MODE must be dev-shared or jwt-jwks");
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
