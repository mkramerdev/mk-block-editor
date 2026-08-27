import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = join(import.meta.dirname, "../..");
const sourceRoot = join(packageRoot, "src");

describe("Editor Web single-runtime public contract", () => {
  it("removes the read-runtime entry point rather than forwarding it", () => {
    const manifest = JSON.parse(
      readFileSync(join(packageRoot, "package.json"), "utf8"),
    ) as { readonly exports: Readonly<Record<string, unknown>> };

    expect(manifest.exports).not.toHaveProperty("./read-runtime");
    expect(existsSync(join(sourceRoot, "api/read-runtime.ts"))).toBe(false);
    expect(
      existsSync(join(sourceRoot, "bundle-fixtures/read-runtime-entry.tsx")),
    ).toBe(false);
  });

  it("exports only the inactive canonical text primitive", () => {
    const blockRendererApi = readFileSync(
      join(sourceRoot, "api/block-renderer.ts"),
      "utf8",
    );
    expect(blockRendererApi).toContain("InactiveTextBlockPrimitive");
    expect(blockRendererApi).not.toContain("ReadTextBlockPrimitive");
  });

  it("publishes no read-editor contracts from document or definition APIs", () => {
    const publicContracts = [
      readFileSync(join(sourceRoot, "api/document-runtime.ts"), "utf8"),
      readFileSync(join(sourceRoot, "api/editor-definition.ts"), "utf8"),
    ].join("\n");
    expect(publicContracts).toContain("EditorDocumentRuntime");
    expect(publicContracts).toContain("EditableEditorDefinition");
    expect(publicContracts).not.toMatch(/ReadEditor|ReadEditorDefinition/u);
  });
});
