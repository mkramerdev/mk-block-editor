import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const ignoredDirectoryNames = new Set([
  ".git",
  ".next",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
]);

test(
  "focused development commands start from clean package output",
  { timeout: 180_000 },
  async () => {
    const fixtureRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "mk-block-editor-dev-fixture-"),
    );
    try {
      copyWorkspace(fixtureRoot);
      runChecked("pnpm install --offline --frozen-lockfile", fixtureRoot);

      const failingSourcePath = path.join(
        fixtureRoot,
        "packages/editor-core/src/api/kernel.ts",
      );
      const validSource = fs.readFileSync(failingSourcePath, "utf8");
      fs.writeFileSync(
        failingSourcePath,
        `${validSource}\nconst developmentBuildFailure: string = 1;\n`,
      );
      const failedStartup = run("pnpm dev:realtime", fixtureRoot);
      assert.notEqual(failedStartup.status, 0);
      assert.match(failedStartup.stdout + failedStartup.stderr, /TS2322/);
      assert.doesNotMatch(
        failedStartup.stdout + failedStartup.stderr,
        /@repo\/editor-realtime:dev:consumer/,
      );
      fs.writeFileSync(failingSourcePath, validSource);

      const realtime = startDevelopmentCommand(fixtureRoot, "dev:realtime");
      try {
        await realtime.waitFor("editor realtime listening", 90_000);
        const ready = await fetchEventually(
          "http://127.0.0.1:4455/readyz",
          realtime.output,
        );
        assert.equal(ready.status, 200);
        assertPackageOutputs(fixtureRoot);
        assert.equal(
          fs.existsSync(
            path.join(fixtureRoot, "services/editor-realtime/dist"),
          ),
          false,
          "realtime development must not build service output",
        );
        assertBuildBeforeConsumer(realtime.output(), [
          "@repo/editor-core:build",
          "@repo/editor-first-draft:build",
          "@repo/editor-realtime:dev:consumer",
        ]);
      } finally {
        realtime.stop();
      }

      removeFixturePackageOutput(fixtureRoot);
      const react = startDevelopmentCommand(
        fixtureRoot,
        "dev:playground-react",
      );
      try {
        await react.waitFor("Local", 90_000);
        const response = await fetchEventually(
          "http://localhost:3001/",
          react.output,
        );
        assert.equal(response.status, 200);
        assertPackageOutputs(fixtureRoot);
        assert.equal(
          fs.existsSync(path.join(fixtureRoot, "apps/playground-react/dist")),
          false,
          "Vite development must not build application output",
        );
        assertBuildBeforeConsumer(react.output(), [
          "@repo/editor-core:build",
          "@repo/editor-first-draft:build",
          "playground-react:dev:consumer",
        ]);
      } finally {
        react.stop();
      }

      const next = startDevelopmentCommand(fixtureRoot, "dev:playground");
      try {
        await next.waitFor("Ready", 90_000);
        const response = await fetchEventually(
          "http://localhost:3000/",
          next.output,
        );
        assert.equal(response.status, 200);
        assert.equal(
          fs.existsSync(
            path.join(fixtureRoot, "apps/playground/.next/BUILD_ID"),
          ),
          false,
          "next dev must not require a production Next.js build",
        );
        assert.match(next.output(), /playground:dev:consumer: \$ next dev/);
        assert.doesNotMatch(next.output(), /playground:build: \$ next build/);
      } finally {
        next.stop();
      }
    } finally {
      assert.ok(
        path.basename(fixtureRoot).startsWith("mk-block-editor-dev-fixture-"),
      );
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
    }
  },
);

function copyWorkspace(fixtureRoot) {
  fs.cpSync(workspaceRoot, fixtureRoot, {
    recursive: true,
    filter(source) {
      if (source === workspaceRoot) return true;
      const relative = path.relative(workspaceRoot, source);
      return !relative
        .split(path.sep)
        .some((part) => ignoredDirectoryNames.has(part));
    },
  });
}

function runChecked(command, cwd) {
  const result = run(command, cwd);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function run(command, cwd) {
  return spawnSync(command, {
    cwd,
    encoding: "utf8",
    shell: true,
    timeout: 90_000,
  });
}

function startDevelopmentCommand(cwd, script) {
  const child = spawn(`pnpm ${script}`, {
    cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });
  return {
    output: () => output,
    async waitFor(fragment, timeout) {
      const deadline = Date.now() + timeout;
      while (!output.includes(fragment)) {
        assert.equal(child.exitCode, null, output);
        assert.ok(Date.now() < deadline, output);
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
    stop() {
      if (child.exitCode !== null) return;
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
          stdio: "ignore",
        });
      } else {
        child.kill("SIGTERM");
      }
    },
  };
}

function assertPackageOutputs(fixtureRoot) {
  for (const relativePath of [
    "packages/editor-core/dist/api/kernel.js",
    "packages/editor-web/dist/api/editor.js",
    "packages/editor-web/dist/index.css",
    "packages/first-draft/dist/server/index.js",
    "packages/first-draft/dist/first-draft.css",
  ]) {
    assert.equal(
      fs.existsSync(path.join(fixtureRoot, relativePath)),
      true,
      `${relativePath} was not generated`,
    );
  }
}

async function fetchEventually(url, developmentOutput) {
  let error;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      return await fetch(url);
    } catch (nextError) {
      error = nextError;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  assert.fail(`${error}\n${developmentOutput()}`);
}

function assertBuildBeforeConsumer(output, markers) {
  let previous = -1;
  for (const marker of markers) {
    const index = output.indexOf(marker);
    assert.ok(index > previous, `${marker} was out of order\n${output}`);
    previous = index;
  }
}

function removeFixturePackageOutput(fixtureRoot) {
  for (const packageName of [
    "editor-core",
    "editor-dom",
    "editor-react",
    "editor-web",
    "editor-yjs",
    "editor-yjs-dom",
    "first-draft",
  ]) {
    const output = path.resolve(fixtureRoot, "packages", packageName, "dist");
    assert.ok(output.startsWith(path.resolve(fixtureRoot, "packages")));
    fs.rmSync(output, { recursive: true, force: true });
  }
}
