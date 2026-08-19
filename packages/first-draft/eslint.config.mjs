import { config } from "@repo/eslint-config/react-internal";

const featureModules = [
  "src/blocks/**/*.{ts,tsx}",
  "src/block-controls/**/*.{ts,tsx}",
  "src/slash-menu/**/*.{ts,tsx}",
  "src/typing-trigger-menu/**/*.{ts,tsx}",
  "src/mention-menu/**/*.{ts,tsx}",
];

const testModules = [
  "src/**/*.test.{ts,tsx}",
  "src/**/*.spec.{ts,tsx}",
  "src/tests/**/*.{ts,tsx}",
];

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...config,
  {
    files: featureModules,
    ignores: testModules,
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/first-draft-definition",
                "**/first-draft-definition.tsx",
              ],
              message:
                "Feature modules are dependencies of the First Draft composition root and must not import the assembled definition. Use the active editor definition or accept the required lower-level contract as input.",
            },
          ],
        },
      ],
    },
  },
];
