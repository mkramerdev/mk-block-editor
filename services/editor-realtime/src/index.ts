import { config as loadDotenv } from "dotenv";
import { createFirstDraftPostgresPersistence } from "@repo/editor-first-draft/server";
import { loadEditorRealtimeConfig } from "./config.ts";
import { startEditorRealtimeServer } from "./server.ts";

loadDotenv();

const config = loadEditorRealtimeConfig();
const persistence = createFirstDraftPostgresPersistence({
  connectionString: config.postgresUrl,
  onError: (error) => console.error("First Draft persistence failed", error),
});
const server = await startEditorRealtimeServer({
  config,
  persistence,
  documentLoader: persistence,
  readiness: persistence,
  onPersistenceDiagnostic: (diagnostic) => {
    if (!diagnostic.result.ok) {
      console.error("First Draft transaction was not persisted", diagnostic);
    }
  },
});

console.log(`editor realtime listening on ${server.url}/editor-realtime`);

async function shutdown(): Promise<void> {
  await server.close();
  await persistence.close();
}

process.once("SIGINT", () => {
  void shutdown().finally(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().finally(() => process.exit(0));
});

export { loadEditorRealtimeConfig } from "./config.ts";
export { startEditorRealtimeServer } from "./server.ts";
export type { EditorRealtimeConfig } from "./config.ts";
export type { EditorRealtimeServer } from "./server.ts";
