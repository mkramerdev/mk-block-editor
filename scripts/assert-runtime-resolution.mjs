import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const consumer = process.argv[2];
const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const runtimeImports = {
  "editor-realtime": [
    "@repo/editor-core/kernel",
    "@repo/editor-web/editor",
    "@repo/editor-first-draft/server",
  ],
  "playground-react": [
    "@repo/editor-web/editor",
    "@repo/editor-web/styles.css",
    "@repo/editor-first-draft/editor",
    "@repo/editor-first-draft/first-draft.css",
  ],
  playground: [],
};

assert.ok(consumer && Object.hasOwn(runtimeImports, consumer));

const imports = runtimeImports[consumer];
const nodeResolutions = resolveWithNode(imports);
for (const [specifier, resolved] of Object.entries(nodeResolutions)) {
  assertCompiledPackageOutput(specifier, resolved);
  console.log(`[runtime-resolution:node] ${specifier} -> ${resolved}`);
}

if (consumer === "playground-react") {
  await assertViteResolutions(imports);
}

if (imports.length === 0) {
  console.log(
    `[runtime-resolution] ${consumer} has no workspace runtime imports`,
  );
}

function resolveWithNode(specifiers) {
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `console.log(JSON.stringify(Object.fromEntries(${JSON.stringify(
        specifiers,
      )}.map((specifier) => [specifier, import.meta.resolve(specifier)]))))`,
    ],
    { cwd: process.cwd(), encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

async function assertViteResolutions(specifiers) {
  const requireFromConsumer = createRequire(
    path.join(process.cwd(), "package.json"),
  );
  const viteEntry = requireFromConsumer.resolve("vite");
  const { createServer } = await import(pathToFileURL(viteEntry).href);
  const server = await createServer({
    root: process.cwd(),
    configFile: false,
    server: { middlewareMode: true },
  });
  try {
    for (const specifier of specifiers) {
      const resolution =
        await server.environments.client.pluginContainer.resolveId(
          specifier,
          path.join(process.cwd(), "src", "__runtime-resolution__.tsx"),
        );
      assert.ok(resolution, `Vite did not resolve ${specifier}`);
      const resolved = resolution.id.split("?")[0];
      assertCompiledPackageOutput(specifier, resolved);
      console.log(`[runtime-resolution:vite] ${specifier} -> ${resolved}`);
    }
  } finally {
    await server.close();
  }
}

function assertCompiledPackageOutput(specifier, resolution) {
  const normalized = fileURLToPathIfNeeded(resolution).replaceAll("\\", "/");
  const relative = path
    .relative(workspaceRoot, fileURLToPathIfNeeded(resolution))
    .replaceAll("\\", "/");
  assert.match(
    normalized,
    /\/packages\/[^/]+\/dist\//,
    `${specifier} resolved outside package dist: ${relative}`,
  );
  assert.doesNotMatch(
    normalized,
    /\/packages\/[^/]+\/src\//,
    `${specifier} resolved to package source: ${relative}`,
  );
}

function fileURLToPathIfNeeded(value) {
  return value.startsWith("file:") ? fileURLToPath(value) : value;
}
