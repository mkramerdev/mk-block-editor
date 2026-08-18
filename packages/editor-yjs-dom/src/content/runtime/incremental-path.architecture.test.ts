import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ordinary content commit architecture", () => {
  it("has no staging, projection rewrite, or per-edit checkpoint path", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/content/runtime/runtime.ts"),
      "utf8",
    );

    expect(source).not.toContain("createStagingContext");
    expect(source).not.toContain("captureCheckpoints");
    expect(source).not.toContain("compensateAppliedBlocks");
    expect(source).not.toContain("applyPreparedContent");
    expect(source).not.toContain("abortContentCommit");

    const ordinaryCommit = source.slice(
      source.indexOf("    commitContent(validated)"),
      source.indexOf("    publishContentCommit(applied)"),
    );
    expect(ordinaryCommit).not.toContain("new Doc");
    expect(ordinaryCommit).not.toContain("encodeCheckpoint");
    expect(ordinaryCommit).not.toContain("readContextProjection");
    expect(ordinaryCommit.match(/writeExplicitProjection\(/gu)).toHaveLength(1);
    expect(ordinaryCommit).toContain("} else if (block.introduced) {");
    expect(ordinaryCommit).toContain(
      "applyPlannedCanonicalYjsContentMutation(plan)",
    );
  });
});
