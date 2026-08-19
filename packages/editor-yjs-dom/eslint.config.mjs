import { config } from "@repo/eslint-config/base";

const browserGlobals = {
  CSSStyleDeclaration: "readonly",
  document: "readonly",
  Element: "readonly",
  FocusEvent: "readonly",
  HTMLElement: "readonly",
  MouseEvent: "readonly",
  Node: "readonly",
  PointerEvent: "readonly",
  TouchEvent: "readonly",
  window: "readonly",
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
                "editor-yjs-dom is a DOM/Yjs binding package, not a React rendering package.",
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
              name: "y-websocket",
              message:
                "Concrete Yjs transport providers belong in runtime adapters or services.",
            },
            {
              name: "@repo/editor-core",
              message: "Use focused editor-core subpaths from editor-yjs-dom.",
            },
            {
              name: "@repo/editor-dom",
              message:
                "Use narrow editor-dom subpaths from editor-yjs-dom, usually /block, /schema, /plugins, or /prosemirror.",
            },
          ],
          patterns: [
            {
              regex:
                "^@repo/editor-core/(?!(?:kernel|document|definitions|selection|operations|codecs|metadata|content)$|content/(?:rich-text|marks|inline-atoms)$).+",
              message:
                "editor-yjs-dom may only import editor-core contracts through explicit domain subpaths.",
            },
            {
              group: [
                "@repo/editor-react",
                "@repo/editor-react/*",
                "@repo/editor-web",
                "@repo/editor-web/*",
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
              ],
              message:
                "editor-yjs-dom must stay a DOM collaboration adapter and must not import runtime, React, storage, native, direct ProseMirror packages, or concrete Yjs providers.",
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
