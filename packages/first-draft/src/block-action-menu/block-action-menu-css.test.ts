import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/first-draft.css"), "utf8");
const blockMenuRules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/gu)]
  .filter((match) => (match[1] ?? "").includes("first-draft-block-action-menu"))
  .map((match) => `${match[1]} {${match[2]}}`)
  .join("\n");

describe("First Draft block action menu CSS", () => {
  it("shares the fixed action-menu surface and document-layer stacking contract", () => {
    const menu = rulesForSelector(".first-draft-block-action-menu");
    expect(menu).toMatch(/position:\s*fixed/u);
    expect(menu).toMatch(/z-index:\s*45/u);
    expect(menu).toMatch(/inline-size:\s*min\(13rem,\s*calc\(100vw - 16px\)\)/u);
    expect(menu).toMatch(
      /max-block-size:\s*min\(\s*14rem,\s*var\(--first-draft-block-menu-available-block-size,\s*100dvh\)\s*\)/u,
    );
    expect(menu).toMatch(/overflow-y:\s*auto/u);
    expect(menu).toMatch(/overscroll-behavior:\s*contain/u);
    expect(menu).not.toMatch(/(?:gradient|box-shadow|backdrop-filter)/u);
  });

  it("uses the existing First Draft theme for the surface and compact icon rows", () => {
    const menu = rulesForSelector(".first-draft-block-action-menu");
    const item = rulesForSelector(".first-draft-block-action-menu__item");
    const active = rulesForSelector(
      '.first-draft-block-action-menu__item[data-active="true"]',
    );
    const focused = rulesForSelector(
      ".first-draft-block-action-menu__item:focus-visible",
    );
    const icon = rulesForSelector(".first-draft-block-action-menu__icon");
    const label = rulesForSelector(".first-draft-block-action-menu__label");

    expect(menu).toMatch(/border:\s*1px solid var\(--color-border\)/u);
    expect(menu).toMatch(/background:\s*var\(--color-foreground\)/u);
    expect(menu).toMatch(/color:\s*var\(--color-text\)/u);
    expect(item).toMatch(/grid-template-columns:\s*auto minmax\(0,\s*1fr\)/u);
    expect(item).toMatch(/background:\s*transparent/u);
    expect(item).toMatch(/color:\s*var\(--color-text\)/u);
    expect(active).toMatch(/border-color:\s*var\(--color-border-highlight\)/u);
    expect(active).toMatch(/background:\s*var\(--color-bg-light\)/u);
    expect(focused).toMatch(/outline:\s*1px solid var\(--color-border-highlight\)/u);
    expect(icon).toMatch(/color:\s*var\(--color-muted\)/u);
    expect(label).toMatch(/min-inline-size:\s*0/u);
    expect(label).toMatch(/text-overflow:\s*ellipsis/u);
  });

  it("uses a thin themed scrollbar with a transparent gutter", () => {
    const menu = rulesForSelector(".first-draft-block-action-menu");
    const scrollbar = rulesForSelector(
      ".first-draft-block-action-menu::-webkit-scrollbar",
    );
    const track = rulesForSelector(
      ".first-draft-block-action-menu::-webkit-scrollbar-track",
    );
    const thumb = rulesForSelector(
      ".first-draft-block-action-menu::-webkit-scrollbar-thumb",
    );
    const hoverThumb = rulesForSelector(
      ".first-draft-block-action-menu::-webkit-scrollbar-thumb:hover",
    );

    expect(menu).toMatch(/scrollbar-width:\s*thin/u);
    expect(menu).toMatch(
      /scrollbar-color:\s*var\(--color-border-highlight\) transparent/u,
    );
    expect(scrollbar).toMatch(/inline-size:\s*0\.5rem/u);
    expect(track).toMatch(/background:\s*transparent/u);
    expect(thumb).toMatch(/border:\s*2px solid transparent/u);
    expect(thumb).toMatch(/background:\s*var\(--color-border\)/u);
    expect(thumb).toMatch(/background-clip:\s*padding-box/u);
    expect(hoverThumb).toMatch(
      /background:\s*var\(--color-border-highlight\)/u,
    );
  });

  it("does not introduce a separate action-menu palette or raw colors", () => {
    expect(blockMenuRules).not.toMatch(
      /--fd-(?:panel|control|accent|shadow|danger)/u,
    );
    expect(blockMenuRules).not.toMatch(/color:\s*var\(--color-foreground\)/u);
    expect(blockMenuRules).not.toMatch(/#[\da-f]{3,8}|rgba?\(|hsla?\(/iu);
  });
});

function rulesForSelector(selector: string): string {
  const normalized = selector.trim().replace(/\s+/gu, " ");
  const classEnd = normalized.search(/(?=\[|:|\s)/u);
  const base = classEnd < 0 ? normalized : normalized.slice(0, classEnd);
  const remainder = classEnd < 0 ? "" : normalized.slice(classEnd);
  const matches = [...css.matchAll(/([^{}]+)\{([^}]*)\}/gu)]
    .filter((match) => {
      const header = (match[1] ?? "").replace(/\s+/gu, " ");
      return header.includes(base) && (!remainder || header.includes(remainder));
    })
    .map((match) => match[2] ?? "");
  if (matches.length === 0) throw new Error(`Missing CSS rule ${selector}`);
  return matches.join("\n");
}
