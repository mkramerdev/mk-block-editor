import { config } from "@repo/eslint-config/react-internal";

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
              name: "react-dom",
              message: "editor-react must stay render-platform agnostic.",
            },
            {
              name: "react-native",
              message:
                "React Native-specific code belongs outside editor-react.",
            },
            {
              name: "yjs",
              message: "Yjs document ownership belongs outside editor-react.",
            },
            {
              name: "y-prosemirror",
              message: "ProseMirror/Yjs bindings belong outside editor-react.",
            },
            {
              name: "y-websocket",
              message: "Concrete Yjs providers belong outside editor-react.",
            },
          ],
          patterns: [
            {
              group: [
                "@repo/editor-dom",
                "@repo/editor-dom/*",
                "@repo/editor-web",
                "@repo/editor-web/*",
                "@repo/editor-yjs",
                "@repo/editor-yjs/*",
                "@repo/editor-yjs-dom",
                "@repo/editor-yjs-dom/*",
                "@repo/editor-yjs-native",
                "@repo/editor-yjs-native/*",
                "@repo/editor-storage-sqlite",
                "@repo/editor-storage-sqlite/*",
                "@repo/editor-demo-postgres",
                "@repo/editor-demo-postgres/*",
                "@repo/editor-mobile",
                "@repo/editor-mobile/*",
                "@repo/editor-native",
                "@repo/editor-native/*",
                "prosemirror-*",
                "y-websocket/*",
              ],
              message:
                "editor-react owns session/runtime orchestration only; DOM, storage, and collaboration adapters belong in their packages.",
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
      "react/prop-types": "off",
    },
  },
];
