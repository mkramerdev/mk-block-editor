import { describe, expect, it } from "vitest";
import { loadEditorRealtimeConfig } from "./config.ts";

describe("editor realtime configuration", () => {
  it("uses the local editor PostgreSQL database in development", () => {
    expect(loadEditorRealtimeConfig({ NODE_ENV: "development" }).postgresUrl).toBe(
      "postgres://postgres:postgres@127.0.0.1:5435/editor_document",
    );
  });

  it("requires an explicit PostgreSQL URL in production", () => {
    expect(() => loadEditorRealtimeConfig({ NODE_ENV: "production" })).toThrow(
      "EDITOR_DOCUMENT_POSTGRES_URL is required",
    );
  });
});
