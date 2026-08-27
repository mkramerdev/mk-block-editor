import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import turboPlugin from "eslint-plugin-turbo";
import globals from "globals";
import tseslint from "typescript-eslint";

export const config = [
  {
    ignores: ["dist/**", "coverage/**", "node_modules/**", ".turbo/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    plugins: { turbo: turboPlugin },
    rules: {
      "turbo/no-undeclared-env-vars": "warn",
    },
  },
  {
    files: ["**/*.{js,mjs,cjs,ts,tsx}"],
    languageOptions: {
      globals: {
        ...globals.es2022,
        ...globals.node,
      },
    },
  },
];
