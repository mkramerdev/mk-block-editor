import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/first-draft.css"), "utf8");
const mentionMenuCss = [
  ...css.matchAll(/\.first-draft-mention-menu[^{}]*\{[^}]*\}/gu),
]
  .map(([matchedRule]) => matchedRule)
  .join("\n");

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

  it("uses the slash-menu surface, text, focus, and scrollbar contract", () => {
    const menu = declarationsFor(/^\.first-draft-mention-menu\s*\{([^}]*)\}/mu);
    const option = declarationsFor(
      /^\.first-draft-mention-menu__option\s*\{([^}]*)\}/mu,
    );
    const selected = declarationsFor(
      /^\.first-draft-mention-menu__option\[aria-selected="true"\]\s*\{([^}]*)\}/mu,
    );
    const focused = declarationsFor(
      /^\.first-draft-mention-menu__option:focus-visible\s*\{([^}]*)\}/mu,
    );
    const avatar = declarationsFor(
      /^\.first-draft-mention-menu__avatar\s*\{([^}]*)\}/mu,
    );
    const track = declarationsFor(
      /^\.first-draft-mention-menu::-webkit-scrollbar-track\s*\{([^}]*)\}/mu,
    );
    const thumb = declarationsFor(
      /^\.first-draft-mention-menu::-webkit-scrollbar-thumb\s*\{([^}]*)\}/mu,
    );

    expect(menu).toMatch(/border:\s*1px solid var\(--color-border\)/u);
    expect(menu).toMatch(/background:\s*var\(--color-foreground\)/u);
    expect(menu).toMatch(/color:\s*var\(--color-text\)/u);
    expect(menu).toMatch(/scrollbar-width:\s*thin/u);
    expect(menu).toMatch(
      /scrollbar-color:\s*var\(--color-border-highlight\) transparent/u,
    );
    expect(option).toMatch(/background:\s*transparent/u);
    expect(option).toMatch(/color:\s*var\(--color-text\)/u);
    expect(selected).toMatch(
      /border-color:\s*var\(--color-border-highlight\)/u,
    );
    expect(selected).toMatch(/background:\s*var\(--color-bg-light\)/u);
    expect(focused).toMatch(
      /outline:\s*1px solid var\(--color-border-highlight\)/u,
    );
    expect(avatar).toMatch(/background:\s*var\(--color-background\)/u);
    expect(avatar).toMatch(/color:\s*var\(--color-muted\)/u);
    expect(track).toMatch(/background:\s*transparent/u);
    expect(thumb).toMatch(/background:\s*var\(--color-border\)/u);
    expect(thumb).toMatch(/background-clip:\s*padding-box/u);
    expect(mentionMenuCss).not.toMatch(
      /--fd-(?:panel|control|accent|shadow)/u,
    );
    expect(mentionMenuCss).not.toMatch(
      /color:\s*var\(--color-foreground\)/u,
    );
    expect(mentionMenuCss).not.toMatch(
      /(?:gradient|backdrop-filter|box-shadow)/u,
    );
  });
});

function declarationsFor(pattern: RegExp): string {
  const match = pattern.exec(css);
  if (!match?.[1]) throw new Error(`Missing CSS rule ${pattern}`);
  return match[1];
}
