import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const runtimePackages = [
  "packages/editor-core",
  "packages/editor-dom",
  "packages/editor-react",
  "packages/editor-web",
  "packages/editor-yjs",
  "packages/editor-yjs-dom",
  "packages/first-draft",
];

test("every runtime package export targets dist", () => {
  for (const packageDirectory of runtimePackages) {
    const manifest = readJson(path.join(packageDirectory, "package.json"));
    for (const [subpath, target] of Object.entries(manifest.exports)) {
      for (const [condition, value] of Object.entries(target)) {
        if (condition === "types") continue;
        assert.match(
          value,
          /^\.\/dist\//,
          `${manifest.name} ${subpath} ${condition} must target dist`,
        );
      }
    }
  }
});

test("Node and Vite actually resolve workspace runtime imports to dist", () => {
  for (const [directory, consumer] of [
    ["services/editor-realtime", "editor-realtime"],
    ["apps/playground-react", "playground-react"],
  ]) {
    const result = spawnSync(
      process.execPath,
      [
        path.join(workspaceRoot, "scripts/assert-runtime-resolution.mjs"),
        consumer,
      ],
      { cwd: path.join(workspaceRoot, directory), encoding: "utf8" },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /packages[/\\][^/\\]+[/\\]dist[/\\]/);
    assert.doesNotMatch(result.stdout, /packages[/\\][^/\\]+[/\\]src[/\\]/);
  }
});

test("public development commands prepare dependencies and watch leaf source", () => {
  const root = readJson("package.json");
  for (const name of [
    "dev",
    "dev:realtime",
    "dev:playground-react",
    "dev:playground",
  ]) {
    assert.match(root.scripts[name], /dev:prepare/);
    assert.match(root.scripts[name], /turbo watch dev:consumer/);
  }

  const consumers = [
    ["apps/playground-react/package.json", "vite"],
    ["apps/playground/package.json", "next dev"],
    ["services/editor-realtime/package.json", "tsx src\/index\.ts"],
  ];
  for (const [manifestPath, execution] of consumers) {
    const manifest = readJson(manifestPath);
    assert.equal(manifest.scripts.dev, undefined);
    assert.match(manifest.scripts["dev:consumer"], new RegExp(execution));
    assert.doesNotMatch(manifest.scripts["dev:consumer"], /\bbuild\b/);
  }
});

test("Turbo owns dependency ordering and consumer restarts", () => {
  const turbo = readJson("turbo.json");
  assert.deepEqual(turbo.tasks["dev:prepare"].dependsOn, ["^build"]);
  assert.deepEqual(turbo.tasks["dev:consumer"].dependsOn, ["^build"]);
  assert.equal(turbo.tasks["dev:consumer"].persistent, true);
  assert.equal(turbo.tasks["dev:consumer"].interruptible, true);
});

test("package builds own the exported CSS artifacts", () => {
  const web = readJson("packages/editor-web/package.json");
  const firstDraft = readJson("packages/first-draft/package.json");
  assert.match(web.scripts.build, /src\/styles\/editor\.css.*dist\/index\.css/);
  assert.equal(web.exports["./styles.css"].default, "./dist/index.css");
  assert.match(
    firstDraft.scripts.build,
    /src\/first-draft\.css.*dist\/first-draft\.css/,
  );
  assert.equal(
    firstDraft.exports["./first-draft.css"].default,
    "./dist/first-draft.css",
  );
});

function readJson(relativePath) {
  return JSON.parse(
    fs.readFileSync(path.join(workspaceRoot, relativePath), "utf8"),
  );
}
