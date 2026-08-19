import { config } from "@repo/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react-native",
              message:
                "editor-web is browser-only and must not import native runtime packages.",
            },
            {
              name: "y-prosemirror",
              message:
                "Use @repo/editor-yjs-dom as the DOM collaboration adapter boundary.",
            },
            {
              name: "@repo/editor-core",
              importNames: [
                "insertBlockAfter",
                "insertRootBlockAfter",
                "deleteBlockSubtree",
                "exitWrapperFromEmptyBlock",
              ],
              message:
                "Keep mutation orchestration in @repo/editor-react/editor.",
            },
          ],
          patterns: [
            {
              group: [
                "@repo/editor-demo-postgres",
                "@repo/editor-demo-postgres/*",
                "@repo/editor-storage-sqlite",
                "@repo/editor-storage-sqlite/*",
                "@repo/editor-realtime-protocol",
                "@repo/editor-realtime-protocol/*",
                "@repo/local-db",
                "@repo/local-db/*",
                "@repo/local-db-browser",
                "@repo/local-db-browser/*",
                "@repo/editor-mobile",
                "@repo/editor-mobile/*",
                "@repo/editor-native",
                "@repo/editor-native/*",
                "@repo/editor-yjs-native",
                "@repo/editor-yjs-native/*",
              ],
              message:
                "Server and native editor packages must stay out of the browser web package.",
            },
            {
              group: ["prosemirror-*"],
              message:
                "Import ProseMirror symbols through @repo/editor-dom/prosemirror.",
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
