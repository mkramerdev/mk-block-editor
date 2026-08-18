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
                "editor-core must stay runtime-neutral and cannot import React.",
            },
            { name: "react-dom", message: "editor-core must stay DOM-free." },
            {
              name: "react-native",
              message: "editor-core must stay platform-neutral.",
            },
            {
              name: "yjs",
              message: "Yjs lifecycle belongs outside editor-core.",
            },
            {
              name: "y-prosemirror",
              message: "ProseMirror/Yjs bindings belong outside editor-core.",
            },
          ],
          patterns: [
            {
              group: [
                "@repo/editor-react",
                "@repo/editor-react/*",
                "@repo/editor-dom",
                "@repo/editor-dom/*",
                "@repo/editor-web",
                "@repo/editor-web/*",
                "@repo/editor-yjs",
                "@repo/editor-yjs/*",
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
                "y-protocols",
                "y-protocols/*",
                "prosemirror-*",
              ],
              message:
                "editor-core may expose pure contracts only; runtime, DOM, storage, and collaboration adapters belong elsewhere.",
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
