import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/first-draft.css"), "utf8");

describe("First Draft text focus ownership", () => {
  it("uses the dark palette as the only surface theme", () => {
    const surface = /^\.first-draft-example\s*\{([^}]*)\}/u.exec(css)?.[1];

    expect(surface).toBeDefined();
    expect(surface).toMatch(/--fd-background:\s*oklch\(0\.225 0 0\)/u);
    expect(surface).toMatch(/--fd-foreground:\s*oklch\(0\.875 0 0\)/u);
    expect(surface).toMatch(/--fd-accent:\s*#60a5fa/u);
    expect(surface).toMatch(/color-scheme:\s*dark/u);
    expect(css).not.toMatch(/color-scheme:\s*light/u);
    expect(css).not.toMatch(/\.dark\s+\.first-draft-example/u);
  });

  it("retains the intentional product focus ring on paragraph and heading wrappers", () => {
    expect(css).toMatch(
      /:is\(\.paragraph-block__paragraph,\s*\.heading-block__heading\):focus-within\s*\{\s*outline:\s*2px solid var\(--fd-accent\);/u,
    );
  });

  it("retains object and table-cell focus indicators", () => {
    expect(css).toMatch(/\.bookmark-block__object[\s\S]*:focus/u);
    expect(css).toMatch(/\.table-block__cell:focus-within/u);
  });

  it("does not restore a table-only text-root width patch", () => {
    expect(css).not.toMatch(/\.table-block__cell\s*>\s*\.editor-web-text/u);
  });
});
