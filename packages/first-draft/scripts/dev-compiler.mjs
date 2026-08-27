import { copyFile, mkdir, watch } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const packageRoot = resolve(import.meta.dirname, "..");
const sourceCss = resolve(packageRoot, "src/first-draft.css");
const outputDirectory = resolve(packageRoot, "dist");
const outputCss = resolve(outputDirectory, "first-draft.css");

await mkdir(outputDirectory, { recursive: true });
await copyFile(sourceCss, outputCss);

const compiler = spawn(
  process.execPath,
  [
    resolve(packageRoot, "node_modules/typescript/bin/tsc"),
    "-p",
    "tsconfig.build.json",
    "--watch",
    "--preserveWatchOutput",
  ],
  { cwd: packageRoot, stdio: "inherit" },
);

const cssWatcher = watch(sourceCss);
let stopping = false;

async function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  await cssWatcher.return();
  compiler.kill();
  process.exitCode = exitCode;
}

compiler.once("exit", (code, signal) => {
  if (stopping) return;
  void stop(signal ? 1 : (code ?? 1));
});

process.once("SIGINT", () => void stop());
process.once("SIGTERM", () => void stop());

for await (const event of cssWatcher) {
  if (event.eventType === "change") await copyFile(sourceCss, outputCss);
}
