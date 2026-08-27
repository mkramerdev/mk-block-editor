import { config } from "@repo/eslint-config/react-internal";

/** @type {import("eslint").Linter.Config[]} */
export default [
  { ignores: [".next/**", ".turbo/**", "next-env.d.ts"] },
  ...config,
];
