import { defineConfig } from "vitest/config";

process.env.EDITOR_DOCUMENT_POSTGRES_URL ??=
  "postgres://editor:editor@127.0.0.1:5435/editor_document";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/*.postgres.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
