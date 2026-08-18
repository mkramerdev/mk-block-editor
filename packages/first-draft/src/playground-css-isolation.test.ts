import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "../../apps/playground-react/src/styles.css"),
  "utf8",
);

describe("React playground typography isolation", () => {
  it("scopes landing-page element typography away from First Draft content", () => {
    expect(css).not.toMatch(/^\s*(?:h1|p|code)\s*\{/gmu);
    expect(css).toMatch(/\.playground-home h1\s*\{/u);
    expect(css).toMatch(/\.playground-home p\s*\{/u);
    expect(css).toMatch(/\.playground-home code\s*\{/u);
    expect(css).not.toMatch(/\.first-draft-example[^{]*\b(?:h1|p|code)\b/u);
  });
});
