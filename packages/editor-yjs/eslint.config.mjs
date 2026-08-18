import { config } from "@repo/eslint-config/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        "document",
        "window",
        "HTMLElement",
        "Element",
        "Node",
        "navigator",
        "localStorage",
        "WebSocket",
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              message:
                "editor-yjs is platform-neutral and cannot import React.",
            },
            {
              name: "react-dom",
              message: "editor-yjs must stay DOM-free.",
            },
            {
              name: "react-native",
              message: "Native bindings belong in editor-yjs-native.",
            },
            {
              name: "y-prosemirror",
              message: "ProseMirror/Yjs bindings belong in editor-yjs-dom.",
            },
            {
              name: "@repo/editor-core",
              message:
                "editor-yjs may import shared identifiers and operation contracts through focused editor-core subpaths only.",
            },
            {
              name: "y-websocket",
              message:
                "Concrete Yjs provider implementations belong in runtime adapters or services.",
            },
            {
              name: "y-protocols",
              message:
                "Concrete Yjs provider/protocol implementations belong in runtime adapters or services.",
            },
          ],
          patterns: [
            {
              group: [
                "@repo/editor-core/*",
                "!@repo/editor-core/kernel",
                "!@repo/editor-core/document",
                "!@repo/editor-core/definitions",
                "!@repo/editor-core/content",
                "!@repo/editor-core/content/rich-text",
                "!@repo/editor-core/operations",
              ],
              message:
                "editor-yjs may import shared identifiers and operation contracts through focused editor-core subpaths only.",
            },
            {
              group: [
                "@repo/editor-react",
                "@repo/editor-react/*",
                "@repo/editor-dom",
                "@repo/editor-dom/*",
                "@repo/editor-web",
                "@repo/editor-web/*",
                "@repo/editor-yjs-dom",
                "@repo/editor-yjs-dom/*",
                "@repo/editor-storage-sqlite",
                "@repo/editor-storage-sqlite/*",
                "@repo/editor-demo-postgres",
                "@repo/editor-demo-postgres/*",
                "@repo/editor-mobile",
                "@repo/editor-mobile/*",
                "@repo/editor-native",
                "@repo/editor-native/*",
                "@repo/editor-yjs-native",
                "@repo/editor-yjs-native/*",
                "prosemirror-*",
                "y-websocket/*",
                "y-protocols/*",
              ],
              message:
                "editor-yjs owns platform-neutral Yjs contracts only; UI, DOM/native bindings, storage adapters, and page runtimes belong elsewhere.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
