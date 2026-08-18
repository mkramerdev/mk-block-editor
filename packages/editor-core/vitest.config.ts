import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const sourceApiPath = (path: string): string =>
  fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "@repo/editor-core/kernel",
        replacement: sourceApiPath("./src/api/kernel.ts"),
      },
      {
        find: "@repo/editor-core/document",
        replacement: sourceApiPath("./src/api/document.ts"),
      },
      {
        find: "@repo/editor-core/definitions",
        replacement: sourceApiPath("./src/api/definitions.ts"),
      },
      {
        find: "@repo/editor-core/selection",
        replacement: sourceApiPath("./src/api/selection.ts"),
      },
      {
        find: "@repo/editor-core/operations",
        replacement: sourceApiPath("./src/api/operations.ts"),
      },
      {
        find: "@repo/editor-core/editing",
        replacement: sourceApiPath("./src/api/editing.ts"),
      },
      {
        find: "@repo/editor-core/content/rich-text",
        replacement: sourceApiPath("./src/api/content/rich-text.ts"),
      },
      {
        find: "@repo/editor-core/content/marks",
        replacement: sourceApiPath("./src/api/content/marks.ts"),
      },
      {
        find: "@repo/editor-core/content/inline-atoms",
        replacement: sourceApiPath("./src/api/content/inline-atoms.ts"),
      },
      {
        find: "@repo/editor-core/content/urls",
        replacement: sourceApiPath("./src/api/content/urls.ts"),
      },
      {
        find: "@repo/editor-core/content",
        replacement: sourceApiPath("./src/api/content.ts"),
      },
      {
        find: "@repo/editor-core/metadata",
        replacement: sourceApiPath("./src/api/metadata.ts"),
      },
      {
        find: "@repo/editor-core/codecs",
        replacement: sourceApiPath("./src/api/codecs.ts"),
      },
      {
        find: "@repo/editor-core/testing",
        replacement: sourceApiPath("./src/api/testing.ts"),
      },
    ],
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "src/api/**/*.ts",
        "src/codecs/**/*.ts",
        "src/content/**/*.ts",
        "src/editing/**/*.ts",
        "src/definitions/**/*.ts",
        "src/document/**/*.ts",
        "src/kernel/**/*.ts",
        "src/metadata/**/*.ts",
        "src/selection/**/*.ts",
        "src/operations/**/*.ts",
        "src/testing/**/*.ts",
      ],
      exclude: [
        "src/**/*.test.{ts,tsx}",
        "src/**/index.ts",
        "src/kernel/identity/uuid.ts",
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
