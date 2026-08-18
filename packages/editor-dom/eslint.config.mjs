import { config } from "@repo/eslint-config/base";

const browserGlobals = {
  document: "readonly",
  window: "readonly",
  HTMLElement: "readonly",
  Element: "readonly",
  Node: "readonly",
  PointerEvent: "readonly",
  MouseEvent: "readonly",
  Event: "readonly",
  MutationRecord: "readonly",
};

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: browserGlobals,
    },
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "react",
              message:
                "editor-dom is a DOM adapter, not a React rendering package.",
            },
            {
              name: "react-dom",
              message: "React DOM rendering belongs in editor-web.",
            },
            {
              name: "react-native",
              message:
                "Native rendering belongs in editor-native/editor-mobile.",
            },
            {
              name: "yjs",
              message: "Yjs document lifecycle belongs outside editor-dom.",
            },
            {
              name: "y-prosemirror",
              message: "The Yjs/ProseMirror binding belongs in editor-yjs-dom.",
            },
            {
              name: "@repo/editor-core",
              message:
                "Use focused editor-core subpaths from editor-dom instead of the package root.",
            },
          ],
          patterns: [
            {
              group: [
                "@repo/editor-react",
                "@repo/editor-react/*",
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
              ],
              message:
                "editor-dom must stay block-local and must not import runtime, React, storage, or collaboration packages.",
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
