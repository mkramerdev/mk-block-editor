import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/first-draft.css"), "utf8");
const tableMenuCss = [
  ...css.matchAll(/\.first-draft-table-action-menu[^{}]*\{[^}]*\}/gu),
]
  .map(([matchedRule]) => matchedRule)
  .join("\n");

describe("First Draft table action menu CSS", () => {
  it("keeps the trigger overlay and wrappers absolute and out of layout", () => {
    const overlay = rule(
      ".first-draft-example .table-block__action-control-overlay",
    );
    const zone = rule(
      ".first-draft-example .table-block__action-control-zone",
    );
    const bridge = rule(
      ".first-draft-example .table-block__action-control-bridge",
    );
    const trigger = rule(
      ".first-draft-example .table-block__action-trigger",
    );
    expect(overlay).toMatch(/position:\s*absolute/u);
    expect(overlay).toMatch(/pointer-events:\s*none/u);
    expect(overlay).toMatch(/z-index:\s*13/u);
    expect(zone).toMatch(/position:\s*absolute/u);
    expect(zone).toMatch(/pointer-events:\s*none/u);
    expect(bridge).toMatch(/position:\s*absolute/u);
    expect(bridge).toMatch(/inset:\s*0/u);
    expect(bridge).toMatch(/z-index:\s*0/u);
    expect(bridge).toMatch(/background:\s*transparent/u);
    expect(bridge).toMatch(/pointer-events:\s*auto/u);
    expect(bridge).not.toMatch(/display:\s*none/u);
    expect(bridge).not.toMatch(/visibility:\s*hidden/u);
    expect(bridge).not.toMatch(/transition:/u);
    expect(trigger).toMatch(/position:\s*relative/u);
    expect(trigger).toMatch(/z-index:\s*1/u);
    expect(trigger).toMatch(/pointer-events:\s*auto/u);
    expect(rule(".first-draft-example .table-block__grid")).toMatch(
      /overflow:\s*hidden/u,
    );
  });

  it("keeps persistent triggers visually quiet until a presentation owner is active", () => {
    const trigger = rule(".first-draft-example .table-block__action-trigger");
    expect(trigger).toMatch(/opacity:\s*0/u);
    expect(trigger).toMatch(/opacity\s+140ms\s+ease-in-out/u);
    expect(trigger).toMatch(/background-color\s+140ms\s+ease-in-out/u);
    expect(trigger).not.toMatch(/display:\s*none/u);
    expect(trigger).not.toMatch(/visibility:\s*hidden/u);
    expect(trigger).toMatch(/background:\s*var\(--color-foreground\)/u);
    expect(trigger).toMatch(/color:\s*var\(--color-muted\)/u);
    expect(css).toMatch(
      /table-block__action-control-zone:hover[\s\S]*table-block__action-trigger[\s\S]*opacity:\s*1/u,
    );
    expect(css).toMatch(
      /table-block__action-control-zone:focus-within[\s\S]*table-block__action-trigger[\s\S]*opacity:\s*1/u,
    );
    expect(css).toMatch(
      /table-block__action-control-zone\[data-cell-hovered="true"\][\s\S]*table-block__action-trigger[\s\S]*opacity:\s*1/u,
    );
    expect(css).toMatch(
      /table-block__action-control-zone\[data-control-hovered="true"\][\s\S]*table-block__action-trigger[\s\S]*opacity:\s*1/u,
    );
    expect(css).toMatch(
      /table-block__action-control-zone\[data-open="true"\][\s\S]*table-block__action-trigger[\s\S]*opacity:\s*1/u,
    );
  });

  it("lightens drag handles and keeps their ellipsis visible across hover, open, and drag states", () => {
    const activeHandle = rule(
      `.first-draft-example .table-block__action-trigger:hover,
      .first-draft-example .table-block__action-trigger:focus-visible,
      .first-draft-example .table-block__action-trigger[data-open="true"]`,
    );

    expect(activeHandle).toMatch(
      /border-color:\s*var\(--color-border-highlight\)/u,
    );
    expect(activeHandle).toMatch(/background:\s*var\(--color-bg-light\)/u);
    expect(activeHandle).toMatch(/color:\s*var\(--color-text\)/u);
    expect(activeHandle).not.toMatch(
      /(?:background|color):\s*var\(--color-foreground\)/u,
    );

    for (const selector of [
      ".table-block__row-drag-overlay-trigger",
      ".table-block__column-drag-overlay-trigger",
    ]) {
      const overlayHandle = rule(selector);
      expect(overlayHandle).toMatch(
        /border:\s*1px solid var\(--color-border-highlight\)/u,
      );
      expect(overlayHandle).toMatch(
        /background:\s*var\(--color-bg-light\)/u,
      );
      expect(overlayHandle).toMatch(/color:\s*var\(--color-text\)/u);
    }
  });

  it("uses muted add icons that share the drag-handle hover treatment", () => {
    const append = rule(".first-draft-example .table-block__append");
    const activeAppend = rule(
      `.first-draft-example .table-block__append:hover,
      .first-draft-example .table-block__append:focus-visible`,
    );

    expect(append).toMatch(/background:\s*var\(--color-foreground\)/u);
    expect(append).toMatch(/color:\s*var\(--color-muted\)/u);
    expect(activeAppend).toMatch(
      /border-color:\s*var\(--color-border-highlight\)/u,
    );
    expect(activeAppend).toMatch(/background:\s*var\(--color-bg-light\)/u);
    expect(activeAppend).toMatch(/color:\s*var\(--color-text\)/u);
    expect(css).toMatch(
      /\.first-draft-example \.table-block__append:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-border-highlight\)/u,
    );
  });

  it("uses one shared thickness with axis-specific long dimensions and icon orientation", () => {
    const overlay = rule(
      ".first-draft-example .table-block__action-control-overlay",
    );
    const trigger = rule(".first-draft-example .table-block__action-trigger");
    const rowTrigger = rule(
      ".first-draft-example .table-block__action-control-zone--row > .table-block__action-trigger",
    );
    const columnTrigger = rule(
      ".first-draft-example .table-block__action-control-zone--column > .table-block__action-trigger",
    );
    const rowIcon = rule(
      ".first-draft-example .table-block__action-control-zone--row .table-block__action-trigger svg",
    );
    const columnIcon = rule(
      ".first-draft-example .table-block__action-control-zone--column .table-block__action-trigger svg",
    );
    const genericIcon = rule(
      ".first-draft-example .table-block__action-trigger svg",
    );

    expect(overlay).toMatch(
      /--first-draft-table-action-trigger-thickness:\s*1rem/u,
    );
    expect(trigger).not.toMatch(/inline-size:\s*1\.25rem/u);
    expect(trigger).not.toMatch(/block-size:\s*1\.25rem/u);
    expect(rowTrigger).toMatch(
      /inline-size:\s*var\(--first-draft-table-action-trigger-thickness\)/u,
    );
    expect(rowTrigger).toMatch(/block-size:\s*100%/u);
    expect(columnTrigger).toMatch(/inline-size:\s*100%/u);
    expect(columnTrigger).toMatch(
      /block-size:\s*var\(--first-draft-table-action-trigger-thickness\)/u,
    );
    expect(rowIcon).toMatch(/transform:\s*rotate\(90deg\)/u);
    expect(rowIcon).toMatch(/transform-origin:\s*center/u);
    expect(columnIcon).toMatch(/transform:\s*none/u);
    expect(genericIcon).not.toMatch(/transform:/u);
  });

  it("outlines both pointer-inert table drag overlays", () => {
    for (const [wrapperSelector, bodySelector] of [
      [
        ".table-block__row-drag-overlay",
        ".table-block__row-drag-overlay-body",
      ],
      [
        ".table-block__column-drag-overlay",
        ".table-block__column-drag-overlay-body",
      ],
    ] as const) {
      const overlay = rule(wrapperSelector);
      const body = rule(bodySelector);
      expect(overlay).toMatch(/box-sizing:\s*border-box/u);
      expect(overlay).toMatch(/overflow:\s*visible/u);
      expect(overlay).toMatch(/pointer-events:\s*none/u);
      expect(body).toMatch(/inline-size:\s*100%/u);
      expect(body).toMatch(/block-size:\s*100%/u);
      expect(body).toMatch(/border:\s*1px\s+solid\s+var\(--fd-accent\)/u);
      expect(body).toMatch(/border-radius:\s*0\.3rem/u);
    }
    const rowOverlay = rule(".table-block__row-drag-overlay");
    const rowOverlayTrigger = rule(
      ".table-block__row-drag-overlay-trigger",
    );
    expect(rowOverlay).toMatch(/position:\s*relative/u);
    expect(rowOverlay).not.toMatch(/justify-content:\s*flex-end/u);
    expect(rowOverlayTrigger).toMatch(/position:\s*absolute/u);
    expect(rowOverlayTrigger).toMatch(
      /inset-inline-end:\s*calc\(100%\s*\+\s*0\.25rem\)/u,
    );
    expect(rowOverlayTrigger).toMatch(/inset-block:\s*0/u);
  });

  it("keeps carriers pointer-inert and removes temporary diagnostics", () => {
    for (const selector of [
      ".first-draft-example .table-block__row-carrier-lane",
      ".first-draft-example .table-block__row-carrier",
      ".first-draft-example .table-block__column-carrier-lane",
      ".first-draft-example .table-block__column-carrier",
    ]) {
      const carrier = rule(selector);
      expect(carrier).toMatch(/pointer-events:\s*none/u);
    }
    expect(css).not.toContain("table-block__carrier--debug");
    expect(css).not.toContain("table-block__carrier-debug-badge");
    expect(css).not.toMatch(/box-shadow:\s*inset\s+0\s+0\s+0\s+2px\s+red/u);
  });

  it("blanks placeholder children without hiding cell geometry or borders", () => {
    const placeholder = rule(
      ".first-draft-example .table-block__cell[data-table-drag-placeholder]",
    );
    const focusedPlaceholder = rule(
      ".first-draft-example .table-block__cell[data-table-drag-placeholder]:focus-within",
    );
    const children = rule(
      ".first-draft-example .table-block__cell[data-table-drag-placeholder] > *",
    );
    expect(placeholder).toMatch(/background:\s*transparent/u);
    expect(placeholder).not.toMatch(/opacity:\s*0/u);
    expect(placeholder).not.toMatch(/visibility:\s*hidden/u);
    expect(placeholder).not.toMatch(/display:\s*none/u);
    expect(placeholder).not.toMatch(/border(?:-color)?:\s*transparent/u);
    expect(focusedPlaceholder).toMatch(/box-shadow:\s*none/u);
    expect(children).toMatch(/opacity:\s*0/u);

    const cell = rule(`:is(
    .first-draft-example,
    .first-draft-document-block-drag-overlay,
    .first-draft-table-drag-overlay
  )
  .table-block__cell`);
    expect(cell).toMatch(/display:\s*grid/u);
    expect(cell).toMatch(/border-block-start:\s*1px\s+solid/u);
    expect(cell).toMatch(/border-inline-start:\s*1px\s+solid/u);
    expect(cell).toMatch(/padding:\s*0\.35rem\s+0\.5rem/u);
    expect(css).toMatch(
      /@media \(forced-colors: active\)[\s\S]*table-block__cell\[data-table-drag-placeholder\][\s\S]*background:\s*transparent/u,
    );
  });

  it("shares only pure table cell visuals with unfaded table drag overlays", () => {
    const sharedCell = rule(`:is(
    .first-draft-example,
    .first-draft-document-block-drag-overlay,
    .first-draft-table-drag-overlay
  )
  .table-block__cell`);
    expect(sharedCell).toMatch(/border-block-start:\s*1px\s+solid/u);
    expect(sharedCell).toMatch(/border-inline-start:\s*1px\s+solid/u);
    expect(sharedCell).toMatch(/padding:\s*0\.35rem\s+0\.5rem/u);
    expect(sharedCell).not.toMatch(/var\(--fd-accent\)/u);
    expect(sharedCell).not.toMatch(/focus|selection|resize|pointer-events/u);

    for (const selector of [
      ".table-block__row-drag-overlay",
      ".table-block__column-drag-overlay",
    ]) {
      const overlay = rule(selector);
      expect(overlay).not.toMatch(/mask|filter|opacity/u);
    }
    expect(css).toMatch(
      /\.first-draft-document-block-drag-overlay\s*\{[\s\S]*?mask-image:/u,
    );
    expect(css).not.toMatch(
      /\.first-draft-table-drag-overlay[^{}]*\{[^}]*(?:mask|filter|opacity):/u,
    );
  });

  it("suppresses only editing controls while a recognized drag is active", () => {
    const match = /([^{}]*data-first-draft-active-drag-group[^{}]*)\{([^}]*)\}/u.exec(
      css,
    );
    expect(match).not.toBeNull();
    const selectors = match?.[1] ?? "";
    const declarations = match?.[2] ?? "";
    for (const selector of [
      ".first-draft-block-controls",
      ".first-draft-block-control-button",
      ".table-block__action-control-zone",
      ".table-block__action-control-bridge",
      ".table-block__action-trigger",
      ".table-block__append",
      ".table-block__resize-handle",
    ]) {
      expect(selectors).toContain(selector);
    }
    expect(declarations).toMatch(/opacity:\s*0\s*!important/u);
    expect(declarations).toMatch(/pointer-events:\s*none\s*!important/u);
    expect(declarations).toMatch(/transition:\s*none\s*!important/u);
    expect(declarations).not.toMatch(/display:\s*none/u);
    for (const excluded of [
      ".table-block__action-control-overlay",
      ".table-block__row-carrier-lane",
      ".table-block__row-carrier",
      ".table-block__column-carrier-lane",
      ".table-block__column-carrier",
      ".table-block__row-drag-overlay",
      ".table-block__column-drag-overlay",
      ".table-block__cell",
      "data-table-drag-placeholder",
    ]) {
      expect(selectors).not.toContain(excluded);
    }
  });

  it("uses the established fixed document-layer menu and constrained scrolling", () => {
    const menu = rulesForSelector(".first-draft-table-action-menu");
    expect(menu).toMatch(/position:\s*fixed/u);
    expect(menu).toMatch(/z-index:\s*45/u);
    expect(menu).toMatch(
      /max-block-size:\s*min\(\s*14rem,\s*var\(--first-draft-table-menu-available-block-size,\s*100dvh\)\s*\)/u,
    );
    expect(menu).toMatch(/overflow-y:\s*auto/u);
    expect(menu).not.toMatch(/transform:/u);
    expect(css).toMatch(
      /@media \(forced-colors: active\)[\s\S]*first-draft-table-action-menu/u,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*table-block__action-trigger/u,
    );
    expect(css).toMatch(
      /@media \(forced-colors: active\)[\s\S]*table-block__action-trigger[\s\S]*background:\s*Highlight/u,
    );
  });

  it("uses the slash-menu theme contract, compact icon rows, and a transparent scrollbar", () => {
    const menu = rulesForSelector(".first-draft-table-action-menu");
    const item = rulesForSelector(".first-draft-table-action-menu__item");
    const active = rulesForSelector(
      '.first-draft-table-action-menu__item[data-active="true"]',
    );
    const focused = rulesForSelector(
      ".first-draft-table-action-menu__item:focus-visible",
    );
    const icon = rulesForSelector(".first-draft-table-action-menu__icon");
    const svg = rulesForSelector(".first-draft-table-action-menu__icon svg");
    const label = rulesForSelector(".first-draft-table-action-menu__label");
    const scrollbar = rulesForSelector(
      ".first-draft-table-action-menu::-webkit-scrollbar",
    );
    const track = rulesForSelector(
      ".first-draft-table-action-menu::-webkit-scrollbar-track",
    );
    const thumb = rulesForSelector(
      ".first-draft-table-action-menu::-webkit-scrollbar-thumb",
    );

    expect(menu).toMatch(/background:\s*var\(--color-foreground\)/u);
    expect(menu).toMatch(/color:\s*var\(--color-text\)/u);
    expect(menu).toMatch(/scrollbar-width:\s*thin/u);
    expect(menu).toMatch(
      /scrollbar-color:\s*var\(--color-border-highlight\) transparent/u,
    );
    expect(item).toMatch(
      /grid-template-columns:\s*auto minmax\(0,\s*1fr\)/u,
    );
    expect(item).toMatch(/background:\s*transparent/u);
    expect(active).toMatch(
      /border-color:\s*var\(--color-border-highlight\)/u,
    );
    expect(active).toMatch(/background:\s*var\(--color-bg-light\)/u);
    expect(focused).toMatch(
      /outline:\s*1px solid var\(--color-border-highlight\)/u,
    );
    expect(icon).toMatch(/inline-size:\s*1\.25rem/u);
    expect(icon).toMatch(/color:\s*var\(--color-muted\)/u);
    expect(svg).toMatch(/inline-size:\s*1rem/u);
    expect(label).toMatch(/min-inline-size:\s*0/u);
    expect(label).toMatch(/text-overflow:\s*ellipsis/u);
    expect(scrollbar).toMatch(/inline-size:\s*0\.5rem/u);
    expect(track).toMatch(/background:\s*transparent/u);
    expect(thumb).toMatch(/background:\s*var\(--color-border\)/u);
    expect(thumb).toMatch(/background-clip:\s*padding-box/u);
    expect(tableMenuCss).not.toMatch(
      /--fd-(?:panel|control|accent|shadow|danger)/u,
    );
    expect(tableMenuCss).not.toMatch(
      /color:\s*var\(--color-foreground\)/u,
    );
    expect(tableMenuCss).not.toMatch(/(?:gradient|backdrop-filter|box-shadow)/u);
  });

  it("includes the shared column control band in the horizontal scroller", () => {
    const object = rule(".first-draft-example .table-block__object");
    const scroll = rule(".first-draft-example .table-block__scroll");
    const chromeAnchor = rule(
      ".first-draft-example .table-block__chrome-anchor",
    );
    expect(object).toMatch(
      /--first-draft-table-column-control-band-size:\s*1\.25rem/u,
    );
    expect(scroll).toMatch(/position:\s*relative/u);
    expect(scroll).toMatch(/display:\s*grid/u);
    expect(scroll).toMatch(
      /grid-template-columns:\s*var\(--first-draft-layout-grid-template-columns\)/u,
    );
    expect(scroll).toMatch(
      /padding:\s*var\(--first-draft-table-column-control-band-size\)\s+0\s+0/u,
    );
    expect(scroll).toMatch(/overflow-x:\s*auto/u);
    expect(scroll).toMatch(/overflow-y:\s*clip/u);
    expect(chromeAnchor).toMatch(/position:\s*absolute/u);
    expect(chromeAnchor).toMatch(/grid-column:\s*2/u);
    expect(chromeAnchor).toMatch(/inset-block:\s*0/u);
    expect(chromeAnchor).not.toMatch(/transform:/u);
    expect(object).toMatch(
      /calc\(2rem\s*-\s*var\(--first-draft-table-column-control-band-size\)\)/u,
    );
  });
});

function rule(selector: string): string {
  const escaped = selector
    .trim()
    .split(/\s+/u)
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
    .join("\\s+");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u").exec(css);
  if (!match?.[1]) throw new Error(`Missing CSS rule ${selector}`);
  return match[1];
}

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
