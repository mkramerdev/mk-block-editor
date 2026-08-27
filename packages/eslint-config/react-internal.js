import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import { config as baseConfig } from "./base.js";

export const config = [
  ...baseConfig,
  {
    files: ["**/*.{ts,tsx}"],
    ...react.configs.flat.recommended,
    languageOptions: {
      ...react.configs.flat.recommended.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.es2022,
        ...globals.node,
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      ...react.configs.flat.recommended.plugins,
      "react-hooks": reactHooks,
    },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...reactHooks.configs.flat.recommended.rules,
      "react/react-in-jsx-scope": "off",
    },
    settings: {
      react: { version: "detect" },
    },
  },
];
