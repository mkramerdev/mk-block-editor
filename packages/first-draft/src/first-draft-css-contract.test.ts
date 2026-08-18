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

  it("does not draw a focus ring around active paragraph or heading wrappers", () => {
    expect(css).not.toMatch(
      /:is\(\.paragraph-block__paragraph,\s*\.heading-block__heading\):focus-within/u,
    );
  });

  it("retains object and table-cell focus indicators", () => {
    expect(css).toMatch(/\.bookmark-block__object[\s\S]*:focus/u);
    expect(css).toMatch(/\.table-block__cell:focus-within/u);
  });

  it("does not restore a table-only text-root width patch", () => {
    expect(css).not.toMatch(/\.table-block__cell\s*>\s*\.editor-web-text/u);
  });

  it("assigns scrolling only to the First Draft document container", () => {
    const documentScroll =
      /^\.first-draft-example__document-scroll\s*\{([^}]*)\}/mu.exec(css)?.[1];
    const hoverBoundary =
      /^\.first-draft-block-hover-boundary\s*\{([^}]*)\}/mu.exec(css)?.[1];
    const editorDocument =
      /^\.first-draft-example \.editor-web-document\s*\{([^}]*)\}/mu.exec(
        css,
      )?.[1];

    expect(documentScroll).toMatch(/overflow-y:\s*auto/u);
    expect(documentScroll).toMatch(/overflow-x:\s*clip/u);
    expect(documentScroll).toMatch(/overscroll-behavior-y:\s*contain/u);
    expect(documentScroll).toMatch(/scrollbar-gutter:\s*stable/u);
    expect(hoverBoundary).not.toMatch(/overflow(?:-y)?:\s*(?:auto|scroll)/u);
    expect(editorDocument).not.toMatch(/overflow-y:\s*(?:auto|scroll)/u);
    expect(css).not.toContain("first-draft-block-hover-tracker");
  });
});
