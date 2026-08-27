import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/first-draft.css"), "utf8");
const slashMenuCss = [...css.matchAll(/\.first-draft-slash-menu[^{}]*\{[^}]*\}/gu)]
  .map(([rule]) => rule)
  .join("\n");

describe("First Draft slash menu CSS", () => {
  it("keeps product height and available viewport height as independent constraints", () => {
    expect(css).toMatch(/--first-draft-slash-menu-max-block-size:\s*15rem/u);
    expect(css).toMatch(
      /max-block-size:\s*min\(\s*var\(--first-draft-slash-menu-max-block-size,\s*15rem\),\s*var\(--first-draft-slash-menu-available-block-size,\s*100dvh\)\s*\)/u,
    );
    expect(css).toMatch(/overflow-y:\s*auto/u);
    expect(css).toMatch(/overscroll-behavior:\s*contain/u);
  });

  it("uses the First Draft surface and text contract without legacy slash-menu tokens", () => {
    const menu = declarationsFor(/^\.first-draft-slash-menu\s*\{([^}]*)\}/mu);
    const option = declarationsFor(
      /^\.first-draft-slash-menu__option\s*\{([^}]*)\}/mu,
    );
    const selected = declarationsFor(
      /^\.first-draft-slash-menu__option\[aria-selected="true"\]\s*\{([^}]*)\}/mu,
    );
    const focused = declarationsFor(
      /^\.first-draft-slash-menu__option:focus-visible\s*\{([^}]*)\}/mu,
    );

    expect(menu).toMatch(/border:\s*1px solid var\(--color-border\)/u);
    expect(menu).toMatch(/background:\s*var\(--color-foreground\)/u);
    expect(menu).toMatch(/color:\s*var\(--color-text\)/u);
    expect(option).toMatch(
      /grid-template-columns:\s*auto minmax\(0,\s*1fr\) auto/u,
    );
    expect(option).toMatch(/border:\s*1px solid transparent/u);
    expect(option).toMatch(/background:\s*transparent/u);
    expect(option).toMatch(/color:\s*var\(--color-text\)/u);
    expect(selected).toMatch(
      /border-color:\s*var\(--color-border-highlight\)/u,
    );
    expect(selected).toMatch(/background:\s*var\(--color-bg-light\)/u);
    expect(selected).toMatch(/color:\s*var\(--color-text\)/u);
    expect(focused).toMatch(
      /border-color:\s*var\(--color-border-highlight\)/u,
    );
    expect(focused).toMatch(
      /outline:\s*1px solid var\(--color-border-highlight\)/u,
    );
    expect(slashMenuCss).not.toMatch(
      /--fd-(?:panel|control|accent|shadow)/u,
    );
    expect(slashMenuCss).not.toMatch(
      /color:\s*var\(--color-foreground\)/u,
    );
    expect(slashMenuCss).not.toMatch(
      /(?:gradient|backdrop-filter|box-shadow)/u,
    );
    expect(slashMenuCss).not.toMatch(/(?:#[\da-f]{3,8}|rgba?\(|hsla?\(|oklch\()/iu);
  });

  it("keeps icons, labels, categories, and the empty state compact and semantic", () => {
    const icon = declarationsFor(
      /^\.first-draft-slash-menu__icon\s*\{([^}]*)\}/mu,
    );
    const svg = declarationsFor(
      /^\.first-draft-slash-menu__icon svg\s*\{([^}]*)\}/mu,
    );
    const label = declarationsFor(
      /^\.first-draft-slash-menu__label\s*\{([^}]*)\}/mu,
    );
    const category = declarationsFor(
      /^\.first-draft-slash-menu__category\s*\{([^}]*)\}/mu,
    );
    const empty = declarationsFor(
      /^\.first-draft-slash-menu__empty\s*\{([^}]*)\}/mu,
    );

    expect(icon).toMatch(/display:\s*inline-grid/u);
    expect(icon).toMatch(/inline-size:\s*1\.25rem/u);
    expect(icon).toMatch(/block-size:\s*1\.25rem/u);
    expect(icon).toMatch(/color:\s*var\(--color-muted\)/u);
    expect(svg).toMatch(/inline-size:\s*1rem/u);
    expect(svg).toMatch(/block-size:\s*1rem/u);
    expect(label).toMatch(/min-inline-size:\s*0/u);
    expect(label).toMatch(/text-overflow:\s*ellipsis/u);
    expect(category).toMatch(/color:\s*var\(--color-muted\)/u);
    expect(category).toMatch(/white-space:\s*nowrap/u);
    expect(empty).toMatch(/color:\s*var\(--color-muted\)/u);
    expect(empty).not.toMatch(/background\s*:/u);
  });

  it("uses a transparent, narrow scrollbar with existing border variables", () => {
    const menu = declarationsFor(/^\.first-draft-slash-menu\s*\{([^}]*)\}/mu);
    const scrollbar = declarationsFor(
      /^\.first-draft-slash-menu::-webkit-scrollbar\s*\{([^}]*)\}/mu,
    );
    const track = declarationsFor(
      /^\.first-draft-slash-menu::-webkit-scrollbar-track\s*\{([^}]*)\}/mu,
    );
    const thumb = declarationsFor(
      /^\.first-draft-slash-menu::-webkit-scrollbar-thumb\s*\{([^}]*)\}/mu,
    );
    const hover = declarationsFor(
      /^\.first-draft-slash-menu::-webkit-scrollbar-thumb:hover\s*\{([^}]*)\}/mu,
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
    expect(hover).toMatch(
      /background:\s*var\(--color-border-highlight\)/u,
    );
  });
});

function declarationsFor(pattern: RegExp): string {
  const match = pattern.exec(css);
  if (!match?.[1]) throw new Error(`Missing CSS rule ${pattern}`);
  return match[1];
}
