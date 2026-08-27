import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles/editor.css"), "utf8");

describe("generic text-root style contract", () => {
  it("fills the containing block without contributing an oversized min-content width", () => {
    expect(css).toMatch(
      /\.editor-web-text\s*\{[\s\S]*display:\s*block;[\s\S]*inline-size:\s*100%;[\s\S]*min-inline-size:\s*0;[\s\S]*max-inline-size:\s*100%;[\s\S]*overflow-wrap:\s*anywhere;/u,
    );
  });

  it("suppresses outlines only on semantic text roots", () => {
    expect(css).toMatch(
      /\[data-editor-text-root="true"\]:focus,\s*\[data-editor-text-root="true"\]:focus-visible\s*\{\s*outline:\s*none;/u,
    );
    expect(css).not.toMatch(
      /(?:^|\n)\s*(?:button|a|\[role="button"\])[^{]*\{[^}]*outline:\s*none/mu,
    );
  });

  it("normalizes every immediate block-local text node to inherited typography", () => {
    for (const selector of [
      "p",
      "h1",
      "h2",
      "h3",
      "blockquote",
      "pre",
    ]) {
      expect(css).toContain(`.editor-web-text > ${selector}`);
    }
    expect(css).toMatch(
      /\.editor-web-text > pre\s*\{[\s\S]*font:\s*inherit;[\s\S]*color:\s*inherit;[\s\S]*line-height:\s*inherit;[\s\S]*letter-spacing:\s*inherit;[\s\S]*margin:\s*0;/u,
    );
    expect(css).not.toContain("!important");
  });
});
