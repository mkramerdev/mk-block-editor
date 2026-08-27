import { describe, expect, it } from "vitest";
import { loadEditorRealtimeConfig } from "./config.ts";

describe("editor realtime configuration", () => {
  it("loads only the server and PostgreSQL settings", () => {
    expect(
      loadEditorRealtimeConfig({
        NODE_ENV: "test",
        EDITOR_REALTIME_HOST: "127.0.0.1",
        EDITOR_REALTIME_PORT: "0",
        EDITOR_DOCUMENT_POSTGRES_URL: "postgres://example.test/editor",
        EDITOR_REALTIME_PUBLIC_DOCUMENT_IDS: "document-one,document-two",
        EDITOR_REALTIME_ALLOWED_ORIGINS:
          "https://portfolio.example.com,http://localhost:3000",
      }),
    ).toEqual({
      host: "127.0.0.1",
      port: 0,
      nodeEnv: "test",
      postgresUrl: "postgres://example.test/editor",
      publicDocumentIds: ["document-one", "document-two"],
      allowedOrigins: [
        "https://portfolio.example.com",
        "http://localhost:3000",
      ],
      limits: {
        globalConnections: 100,
        connectionsPerAddress: 10,
        sessionsPerDocument: 50,
        messagesPerWindow: 2_400,
        messageWindowMs: 60_000,
        transactionsPerWindow: 600,
        transactionWindowMs: 60_000,
        bytesPerWindow: 64 * 1_024 * 1_024,
        byteWindowMs: 60_000,
        clientFrameBytes: 2 * 1_024 * 1_024,
        pendingTransactionsPerDocument: 64,
      },
    });
  });

  it("uses the local editor PostgreSQL database in development", () => {
    const config = loadEditorRealtimeConfig({ NODE_ENV: "development" });
    expect(config.postgresUrl).toBe(
      "postgres://editor:editor@127.0.0.1:5435/editor_document",
    );
    expect(config.allowedOrigins).toEqual([
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://localhost:3001",
      "http://127.0.0.1:3001",
    ]);
  });

  it("loads the canonical count, byte, client-frame, and backlog controls", () => {
    const limits = loadEditorRealtimeConfig({
      NODE_ENV: "test",
      EDITOR_REALTIME_MAX_MESSAGES_PER_WINDOW: "2401",
      EDITOR_REALTIME_MESSAGE_WINDOW_MS: "60001",
      EDITOR_REALTIME_MAX_TRANSACTIONS_PER_WINDOW: "601",
      EDITOR_REALTIME_TRANSACTION_WINDOW_MS: "60002",
      EDITOR_REALTIME_MAX_BYTES_PER_WINDOW: "1048577",
      EDITOR_REALTIME_BYTE_WINDOW_MS: "60003",
      EDITOR_REALTIME_MAX_CLIENT_FRAME_BYTES: "524289",
      EDITOR_REALTIME_MAX_PENDING_TRANSACTIONS_PER_DOCUMENT: "65",
    }).limits;
    expect(limits).toMatchObject({
      messagesPerWindow: 2_401,
      messageWindowMs: 60_001,
      transactionsPerWindow: 601,
      transactionWindowMs: 60_002,
      bytesPerWindow: 1_048_577,
      byteWindowMs: 60_003,
      clientFrameBytes: 524_289,
      pendingTransactionsPerDocument: 65,
    });
  });

  it("requires an explicit PostgreSQL URL in production", () => {
    expect(() => loadEditorRealtimeConfig({ NODE_ENV: "production" })).toThrow(
      "EDITOR_DOCUMENT_POSTGRES_URL is required",
    );
  });

  it("requires public documents and browser origins in production", () => {
    const base = {
      NODE_ENV: "production",
      EDITOR_DOCUMENT_POSTGRES_URL: "postgres://example.test/editor",
    };
    expect(() => loadEditorRealtimeConfig(base)).toThrow(
      "EDITOR_REALTIME_PUBLIC_DOCUMENT_IDS is required",
    );
    expect(() =>
      loadEditorRealtimeConfig({
        ...base,
        EDITOR_REALTIME_PUBLIC_DOCUMENT_IDS: "document-one",
      }),
    ).toThrow("EDITOR_REALTIME_ALLOWED_ORIGINS is required");
  });
});
