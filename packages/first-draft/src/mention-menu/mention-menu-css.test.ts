import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/first-draft.css"), "utf8");

describe("First Draft mention menu CSS", () => {
  it("uses fixed caret placement with independent design and viewport caps", () => {
    expect(css).toMatch(
      /\.first-draft-mention-menu\s*\{[\s\S]*position:\s*fixed/u,
    );
    expect(css).toMatch(/--first-draft-mention-menu-max-block-size:\s*15rem/u);
    expect(css).toMatch(
      /max-block-size:\s*min\(\s*var\(--first-draft-mention-menu-max-block-size,\s*15rem\),\s*var\(--first-draft-mention-menu-available-block-size,\s*100dvh\)\s*\)/u,
    );
    expect(css).toMatch(/\.first-draft-mention-menu[\s\S]*overflow-y:\s*auto/u);
    expect(css).not.toContain("first-draft-example__mention-menu");
  });

  it("drives active styling from the accessible selected state", () => {
    expect(css).toMatch(
      /\.first-draft-mention-menu__option\[aria-selected="true"\]/u,
    );
    expect(css).not.toMatch(/\.first-draft-mention-menu__option:hover/u);
  });
});
