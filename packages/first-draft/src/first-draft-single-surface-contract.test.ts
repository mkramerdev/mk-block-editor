import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = process.cwd();

describe("First Draft single editable surface contract", () => {
  it("exports bootstrap directly and deletes both obsolete read boundaries", () => {
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { exports: Record<string, unknown> };

    expect(manifest.exports["./bootstrap"]).toEqual({
      types: "./dist/bootstrap/index.d.ts",
      import: "./dist/bootstrap/index.js",
    });
    expect(manifest.exports).not.toHaveProperty("./read");
    expect(manifest.exports).not.toHaveProperty("./read-model");
    expect(existsSync(join(packageRoot, "src/read"))).toBe(false);
    expect(existsSync(join(packageRoot, "src/read-model"))).toBe(false);
  });

  it("contains no production dependency on the generic read runtime", () => {
    const productionFiles = productionSourceFiles();
    const production = productionFiles
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(production).not.toContain("@repo/editor-web/read-runtime");
    expect(production).not.toContain("FirstDraftReadSurface");
    expect(production).not.toContain("createFirstDraftReadDefinition");
    expect(production).not.toContain("firstDraftReadBlockDefinitions");
    expect(production).not.toContain("ReadTabsRenderer");
    expect(production).not.toContain("ReadTableRenderer");
  });
});

function productionSourceFiles(): readonly string[] {
  return execFileSync("rg", ["--files", "src", "-g", "*.ts", "-g", "*.tsx"], {
    cwd: packageRoot,
    encoding: "utf8",
  })
    .trim()
    .split(/\r?\n/u)
    .filter((file) => !/\.test\.tsx?$/u.test(file))
    .map((file) => join(packageRoot, file));
}
