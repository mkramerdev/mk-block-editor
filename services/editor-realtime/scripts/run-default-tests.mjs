import { spawnSync } from "node:child_process";
import process from "node:process";

// TURBO_HASH is a built-in variable supplied to commands run by Turbo.
// eslint-disable-next-line turbo/no-undeclared-env-vars
const commands = process.env.TURBO_HASH
  ? [["exec", "vitest", "run"]]
  : [
      ["run", "build:dependencies"],
      ["exec", "vitest", "run"],
    ];

for (const arguments_ of commands) {
  const result = spawnSync("pnpm", arguments_, {
    shell: process.platform === "win32",
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
