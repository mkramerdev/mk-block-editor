import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { domPointerDragActiveAttribute } from "@mk-drag-and-drop/react";

const css = readFileSync(join(process.cwd(), "src/first-draft.css"), "utf8");
const editorWebCss = readFileSync(
  join(process.cwd(), "..", "editor-web", "src", "styles", "editor.css"),
  "utf8",
);

function declarationsFor(rule: RegExp): string {
  const declarations = rule.exec(css)?.[1];
  expect(declarations).toBeDefined();
  return declarations ?? "";
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

describe("First Draft empty-wrapper add-text control", () => {
  it("styles an ordinary full-width button with keyboard and forced-color focus", () => {
    const button = declarationsFor(
      /^\.first-draft-example \.empty-wrapper-add-text-button\s*\{([^}]*)\}/mu,
    );
    expect(button).toMatch(/appearance:\s*none/u);
    expect(button).toMatch(/inline-size:\s*100%/u);
    expect(button).toMatch(/margin:\s*0\s*;/u);
    expect(button).toMatch(/padding:\s*0\.5rem\s*;/u);
    expect(button).toMatch(/font-size:\s*1rem\s*;/u);
    expect(button).toMatch(/line-height:\s*1\.25\s*;/u);
    expect(button).not.toMatch(/(?:^|[;\s])block-size\s*:/u);
    expect(button).not.toMatch(/(?:^|[;\s])min-block-size\s*:/u);
    expect(button).toMatch(/cursor:\s*pointer/u);
    expect(css).toMatch(
      /\.empty-wrapper-add-text-button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--fd-accent\)/u,
    );
    expect(css).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.empty-wrapper-add-text-button[\s\S]*?color:\s*ButtonText/u,
    );
    expect(css).not.toContain(".placeholder-block__button");
  });
});

describe("First Draft append-paragraph surfaces", () => {
  it("shares invisible in-flow styling and turns bottom padding into the root surface", () => {
    const document = declarationsFor(
      /^\.first-draft-example \.editor-web-document\s*\{([^}]*)\}/mu,
    );
    const surface = declarationsFor(
      /^\.first-draft-example \.first-draft-append-paragraph-surface\s*\{([^}]*)\}/mu,
    );
    const root = declarationsFor(
      /^\.first-draft-example\s+\.first-draft-append-paragraph-surface\[data-scope="root"\]\s*\{([^}]*)\}/mu,
    );

    expect(document).toMatch(/padding:\s*4rem 0 0/u);
    expect(surface).toMatch(/appearance:\s*none/u);
    expect(surface).toMatch(/display:\s*block/u);
    expect(root).toMatch(
      /inline-size:\s*calc\(\s*100%\s*-\s*var\(--editor-side-left-width\)\s*-\s*var\(--editor-side-right-width\)\s*\)/u,
    );
    expect(root).not.toMatch(/inline-size:\s*auto/u);
    expect(root).toMatch(/block-size:\s*16rem/u);
    expect(root).toMatch(
      /margin-inline:\s*var\(--editor-side-left-width\) var\(--editor-side-right-width\)/u,
    );
    expect(surface).toMatch(/border:\s*0/u);
    expect(surface).toMatch(/padding:\s*0/u);
    expect(surface).toMatch(/background:\s*transparent/u);
    expect(surface).toMatch(/box-shadow:\s*none/u);
    expect(surface).toMatch(/cursor:\s*text/u);
    expect(surface).not.toMatch(/position:\s*(?:absolute|fixed)/u);
    expect(surface).not.toMatch(
      /(?:display:\s*none|visibility:\s*hidden|opacity\s*:)/u,
    );
  });

  it("lets column lanes grow their trailing surface without horizontal overflow", () => {
    const lane = declarationsFor(
      /^\.first-draft-example \.columns-block__lane\s*\{([^}]*)\}/mu,
    );
    const column = declarationsFor(
      /^\.first-draft-example\s+\.first-draft-append-paragraph-surface\[data-scope="column"\]\s*\{([^}]*)\}/mu,
    );

    expect(lane).toMatch(/display:\s*flex/u);
    expect(lane).toMatch(/flex-direction:\s*column/u);
    expect(lane).toMatch(/block-size:\s*100%/u);
    expect(lane).toMatch(/min-inline-size:\s*0/u);
    expect(column).toMatch(/flex:\s*1 0 1rem/u);
    expect(column).toMatch(/inline-size:\s*100%/u);
    expect(column).not.toMatch(/position\s*:/u);
    expect(css).toMatch(
      /\.columns-block__lane\s*>\s*\[data-editor-block-shell="true"\]\s*\{[^}]*flex:\s*none/u,
    );
  });
});

describe("First Draft atomic focus presentation", () => {
  it("leaves divider focus to selection paint without changing other native focus rings", () => {
    const nativeFocusRule = declarationsFor(
      /^\.first-draft-example \.empty-wrapper-add-text-button:focus-visible\s*\{([^}]*)\}/mu,
    );
    expect(nativeFocusRule).toMatch(/outline:\s*2px solid var\(--fd-accent\)/u);
    expect(css).not.toMatch(/\.divider-block__rule:focus-visible/u);
    expect(css).toMatch(
      /\.editor-web-selection-paint-rect\[data-editor-selection-paint="atomic-surface"\]\s*\{[^}]*outline:\s*2px solid/u,
    );
  });
});

describe("First Draft surface stacking", () => {
  it("uses one isolated surface for the toolbar, controls, and popovers", () => {
    const surface = declarationsFor(/^\.first-draft-example\s*\{([^}]*)\}/mu);
    const genericBlockList = /^\.editor-web-block-list\s*\{([^}]*)\}/mu.exec(
      editorWebCss,
    )?.[1];
    const firstDraftBlockList = declarationsFor(
      /^\.first-draft-example \.editor-web-block-list\s*\{([^}]*)\}/mu,
    );
    const toolbar = declarationsFor(
      /^\.first-draft-example__toolbar\s*\{([^}]*)\}/mu,
    );
    const documentLayers = declarationsFor(
      /^\.first-draft-example \[data-editor-document-layer-host="true"\]\s*\{([^}]*)\}/mu,
    );
    const controls = declarationsFor(
      /^\.first-draft-example \.first-draft-block-controls\s*\{([^}]*)\}/mu,
    );
    const iconWrap = declarationsFor(
      /^\.callout-block__icon-wrap\s*\{([^}]*)\}/mu,
    );
    const iconButton = declarationsFor(
      /^\.first-draft-example \.callout-block__icon-button\s*\{([^}]*)\}/mu,
    );
    const picker = declarationsFor(
      /^\.first-draft-example \.callout-block__picker\s*\{([^}]*)\}/mu,
    );
    const stack = (declarations: string) =>
      Number(/z-index:\s*(-?\d+)/u.exec(declarations)?.[1]);

    expect(surface).toMatch(/position:\s*relative/u);
    expect(surface).toMatch(/isolation:\s*isolate/u);
    expect(genericBlockList).toMatch(/isolation:\s*isolate/u);
    expect(firstDraftBlockList).toMatch(/isolation:\s*auto/u);
    expect(stack(controls)).toBe(12);
    expect(stack(toolbar)).toBe(20);
    expect(stack(documentLayers)).toBe(30);
    expect(stack(controls)).toBeLessThan(stack(toolbar));
    expect(stack(toolbar)).toBeLessThan(stack(documentLayers));
    expect(iconWrap).toMatch(/position:\s*relative/u);
    expect(iconWrap).not.toMatch(/z-index\s*:/u);
    expect(iconWrap).not.toMatch(/isolation\s*:/u);
    expect(iconWrap).not.toMatch(
      /(?:^|[;\s])(?:transform|filter|backdrop-filter|contain|opacity)\s*:/u,
    );
    expect(iconButton).toMatch(/position:\s*relative/u);
    expect(stack(iconButton)).toBe(13);
    expect(picker).toMatch(/position:\s*absolute/u);
    expect(stack(picker)).toBe(25);
    expect(stack(iconButton)).toBeLessThan(stack(toolbar));
    expect(stack(toolbar)).toBeLessThan(stack(picker));
  });

  it("keeps every document-layer popup above the toolbar", () => {
    const toolbar = declarationsFor(
      /^\.first-draft-example__toolbar\s*\{([^}]*)\}/mu,
    );
    const toolbarStack = Number(/z-index:\s*(-?\d+)/u.exec(toolbar)?.[1]);
    const popupSelectors = [
      ".first-draft-selection-menu",
      ".first-draft-link-popover",
      ".first-draft-slash-menu",
      ".first-draft-mention-menu",
      ".first-draft-table-action-menu",
      ".first-draft-block-action-menu",
      ".first-draft-tabs-action-menu",
    ] as const;

    for (const selector of popupSelectors) {
      const declarations = [...css.matchAll(/([^{}]+)\{([^}]*)\}/gu)].find(
        (match) =>
          (match[1] ?? "").includes(selector) &&
          /z-index:\s*-?\d+/u.test(match[2] ?? ""),
      )?.[2];
      expect(declarations, `Missing popup rule ${selector}`).toBeTruthy();
      const popupStack = Number(
        /z-index:\s*(-?\d+)/u.exec(declarations ?? "")?.[1],
      );
      expect(popupStack, selector).toBeGreaterThan(toolbarStack);
    }
  });
});

describe("First Draft document block drag overlay", () => {
  it("keeps common overlay infrastructure visually transparent", () => {
    const overlay = declarationsFor(
      /^\.first-draft-document-block-drag-overlay\s*\{([^}]*)\}/mu,
    );
    const block = declarationsFor(
      /^\.first-draft-document-block-drag-overlay__block\s*\{([^}]*)\}/mu,
    );

    expect(overlay).toMatch(/background:\s*transparent/u);
    expect(overlay).not.toMatch(/background-(?:color|image)\s*:/u);
    expect(overlay).not.toMatch(/box-shadow\s*:/u);
    expect(overlay).toMatch(/border:\s*0/u);
    expect(overlay).toMatch(/border-radius:\s*0/u);
    expect(block).not.toMatch(/background(?:-color|-image)?\s*:/u);
    expect(block).not.toMatch(/box-shadow\s*:/u);
    expect(block).not.toMatch(/border(?:-radius)?\s*:/u);
    expect(css).not.toMatch(
      /\[data-first-draft-preview-block-type=["']paragraph["']\][^{]*\{[^}]*(?:background|box-shadow)\s*:/u,
    );
    expect(css).not.toMatch(
      /\[data-first-draft-preview-block-type=["']paragraph["']\][^{]*\{[^}]*background[^}]*!important/u,
    );

    for (const declarations of [
      declarationsFor(
        /^\.first-draft-example \.code-block__presentation\s*\{([^}]*)\}/mu,
      ),
      declarationsFor(/^\.callout-block__callout\s*\{([^}]*)\}/mu),
    ]) {
      expect(declarations).toMatch(/background:\s*var\(--color-foreground\)/u);
    }
  });

  it("keeps only the top-left corner opaque and makes the other three corners transparent", () => {
    const overlay = declarationsFor(
      /^\.first-draft-document-block-drag-overlay\s*\{([^}]*)\}/mu,
    );
    const diagonalFade =
      /linear-gradient\(\s*to bottom right,\s*rgb\(0 0 0 \/ 100%\) 0%,\s*rgb\(0 0 0 \/ 0%\) 50%\s*\)/u;

    expect(overlay).toMatch(
      new RegExp(`-webkit-mask-image:\\s*${diagonalFade.source}`, "u"),
    );
    expect(overlay).toMatch(
      new RegExp(`(?:^|[;\\s])mask-image:\\s*${diagonalFade.source}`, "u"),
    );
  });

  it("removes document-flow margins only from top-level preview presentations", () => {
    const declarations = declarationsFor(
      /^\.first-draft-document-block-drag-overlay\s+\[data-first-draft-preview-visual-root="true"\]\s*\{([^}]*)\}/mu,
    );

    expect(declarations).toMatch(/margin:\s*0 !important/u);
    expect(css).not.toMatch(
      /\.first-draft-document-block-drag-overlay\s+\*\s*\{[^}]*margin\s*:/u,
    );
  });
});

describe("First Draft package-owned active pointer cursor", () => {
  it("uses the public root marker to override every descendant cursor", () => {
    expect(domPointerDragActiveAttribute).toBe("data-dnd-pointer-drag-active");
    const selectors = [
      `:root[${domPointerDragActiveAttribute}="true"]`,
      `:root[${domPointerDragActiveAttribute}="true"] *`,
      `:root[${domPointerDragActiveAttribute}="true"] *::before`,
      `:root[${domPointerDragActiveAttribute}="true"] *::after`,
    ];
    const declarations = declarationsFor(
      new RegExp(
        `^${selectors.map(escapeRegExp).join(",\\s*")}\\s*\\{([^}]*)\\}`,
        "mu",
      ),
    );

    expect(declarations.trim()).toBe("cursor: grabbing !important;");
    expect(css.match(/cursor:\s*grabbing\b/gu)).toHaveLength(1);
    expect(
      declarationsFor(
        /^\.first-draft-example \.first-draft-block-drag-handle\s*\{([^}]*)\}/mu,
      ),
    ).toMatch(/cursor:\s*grab/u);
    expect(css).not.toMatch(
      /\.first-draft-block-drag-handle:active\s*\{[^}]*cursor:\s*grabbing/u,
    );
    expect(
      declarationsFor(
        /^\.first-draft-document-block-drag-overlay\s*\{([^}]*)\}/mu,
      ),
    ).not.toMatch(/cursor\s*:/u);
  });
});

describe("First Draft inline links", () => {
  it("restores an accent-colored underline inside mounted text roots", () => {
    const inlineLinkRule =
      /^\.first-draft-example \[data-editor-text-root="true"\] a\[href\],\s*\.first-draft-example \[data-editor-text-root="true"\] a\[href\]:visited\s*\{([^}]*)\}/mu.exec(
        css,
      )?.[1];

    expect(inlineLinkRule).toBeDefined();
    expect(inlineLinkRule).toMatch(/color:\s*var\(--fd-accent\)/u);
    expect(inlineLinkRule).toMatch(/text-decoration-line:\s*underline/u);
    expect(inlineLinkRule).toMatch(/text-decoration-color:\s*currentColor/u);
  });

  it("keeps hover and keyboard focus treatments within the text-root scope", () => {
    expect(css).toMatch(
      /\.first-draft-example \[data-editor-text-root="true"\] a\[href\]:hover\s*\{[^}]*text-decoration-thickness:\s*0\.12em/u,
    );
    expect(css).toMatch(
      /\.first-draft-example \[data-editor-text-root="true"\] a\[href\]:focus-visible\s*\{[^}]*outline:\s*2px solid currentColor/u,
    );
    expect(css).not.toMatch(
      /^\.first-draft-example\s+a(?:\[href\])?(?=[\s,:{])/mu,
    );
  });

  it("uses system link and focus colors in forced-colors mode", () => {
    expect(css).toMatch(
      /@media \(forced-colors: active\)\s*\{[\s\S]*?\[data-editor-text-root="true"\] a\[href\][\s\S]*?color:\s*LinkText;[\s\S]*?text-decoration-color:\s*LinkText/u,
    );
    expect(css).toMatch(
      /@media \(forced-colors: active\)\s*\{[\s\S]*?\[data-editor-text-root="true"\] a\[href\]:focus-visible[\s\S]*?outline-color:\s*Highlight/u,
    );
  });
});

describe("First Draft columns presentation", () => {
  it("keeps direct column shells in a weighted horizontal grid with a safe auto-column fallback", () => {
    const grid = declarationsFor(
      /^\.first-draft-example \.columns-block__grid,\s*\.first-draft-document-block-drag-overlay \.columns-block__grid\s*\{([^}]*)\}/mu,
    );
    expect(grid).toMatch(/display:\s*grid/u);
    expect(grid).toMatch(
      /grid-template-columns:\s*var\(--columns-block-tracks,\s*none\)/u,
    );
    expect(grid).toMatch(/grid-auto-flow:\s*column/u);
    expect(grid).toMatch(/grid-auto-columns:\s*minmax\(0,\s*1fr\)/u);
    expect(grid).not.toMatch(/border(?:-radius)?\s*:/u);
    expect(css).toMatch(
      /\.columns-block__grid\s*>\s*\[data-editor-block-shell="true"\]\[data-editor-block-type="column"\]\s*\{/u,
    );
    expect(css).not.toMatch(
      /\.columns-block__grid\s*>\s*\.columns-block__lane/u,
    );
  });

  it("keeps the track-matched resize overlay outside normal grid placement", () => {
    const overlay = declarationsFor(
      /^\.first-draft-example \.columns-block__resize-overlay,\s*\.first-draft-document-block-drag-overlay \.columns-block__resize-overlay\s*\{([^}]*)\}/mu,
    );
    expect(overlay).toMatch(/position:\s*absolute/u);
    expect(overlay).toMatch(/inset:\s*0/u);
    expect(overlay).toMatch(
      /grid-template-columns:\s*var\(--columns-block-tracks\)/u,
    );
    expect(overlay).toMatch(/pointer-events:\s*none/u);
  });

  it("centers one persistent divider inside the exact resize-handle boundary", () => {
    const boundary = declarationsFor(
      /^\.first-draft-example \.columns-block__boundary,\s*\.first-draft-document-block-drag-overlay \.columns-block__boundary\s*\{([^}]*)\}/mu,
    );
    const divider = declarationsFor(
      /^\.first-draft-example \.columns-block__divider,\s*\.first-draft-document-block-drag-overlay \.columns-block__divider\s*\{([^}]*)\}/mu,
    );
    const handle = declarationsFor(
      /^\.first-draft-example \.columns-block__resize-handle\s*\{([^}]*)\}/mu,
    );

    expect(boundary).toMatch(/position:\s*relative/u);
    expect(boundary).toMatch(/inline-size:\s*1rem/u);
    expect(boundary).toMatch(/justify-self:\s*end/u);
    expect(boundary).toMatch(/translate:\s*1rem 0/u);
    expect(divider).toMatch(/inset-inline-start:\s*50%/u);
    expect(divider).toMatch(/inline-size:\s*1px/u);
    expect(divider).toMatch(/translate:\s*-50% 0/u);
    expect(divider).toMatch(/background:\s*var\(--color-border\)/u);
    expect(handle).toMatch(/position:\s*absolute/u);
    expect(handle).toMatch(/inset:\s*0/u);
    expect(handle).toMatch(/pointer-events:\s*auto/u);
    expect(handle).not.toMatch(/(?:border|background)\s*:/u);
    expect(css).not.toMatch(/\.columns-block__resize-handle::after/u);
  });

  it("keeps dividers visible while only the nested resize control changes state or hides responsively", () => {
    expect(css).toMatch(
      /\.columns-block__boundary:has\(> \.columns-block__resize-handle:hover\)[\s\S]*?> \.columns-block__divider,[\s\S]*?background:\s*var\(--fd-accent\)/u,
    );
    expect(css).toMatch(
      /@media \(max-width:\s*700px\)[\s\S]*?\.columns-block__resize-handle\s*\{[^}]*visibility:\s*hidden/u,
    );
    expect(css).not.toMatch(
      /@media \(max-width:\s*700px\)[\s\S]*?\.columns-block__resize-overlay\s*\{[^}]*display:\s*none/u,
    );
  });
});

describe("First Draft tabs presentation", () => {
  it("uses transparent inactive pills and a filled active pill without an underline", () => {
    const tabs = declarationsFor(
      /^\.first-draft-example \.tabs-block__tabs\s*\{([^}]*)\}/mu,
    );
    const tab = declarationsFor(
      /^\.first-draft-example \.tabs-block__tab\s*\{([^}]*)\}/mu,
    );
    const active = declarationsFor(
      /^\.first-draft-example \.tabs-block__tab\[aria-selected="true"\]\s*\{([^}]*)\}/mu,
    );
    const hover = declarationsFor(
      /^\.first-draft-example \.tabs-block__tab:not\(\[aria-selected="true"\]\):hover\s*\{([^}]*)\}/mu,
    );

    expect(tabs).toMatch(
      /--tabs-block-pill-background:\s*var\(--color-bg-light\)/u,
    );
    expect(tabs).not.toMatch(/var\(--fd-accent\)/u);
    expect(tab).toMatch(/border-radius:\s*999px/u);
    expect(tab).toMatch(/background:\s*transparent/u);
    expect(tab).toMatch(/color:\s*var\(--color-muted\)/u);
    expect(tab).toMatch(/font-weight:\s*500/u);
    expect(tab).not.toMatch(/border-block-end/u);
    expect(active).toMatch(/background:\s*var\(--color-bg-light\)/u);
    expect(active).not.toMatch(/border-block-end/u);
    expect(active).toMatch(/color:\s*var\(--color-text\)/u);
    expect(active).not.toMatch(/font-weight/u);
    expect(hover).toMatch(/background:\s*var\(--color-bg-light\)/u);
    expect(hover).not.toMatch(/color:/u);
  });

  it("keeps pill dimensions stable and places the hover-only add control after the tablist", () => {
    const header = declarationsFor(
      /^\.first-draft-example \.tabs-block__header\s*\{([^}]*)\}/mu,
    );
    const tablist = declarationsFor(
      /^\.first-draft-example \.tabs-block__tablist\s*\{([^}]*)\}/mu,
    );
    const add = declarationsFor(
      /^\.first-draft-example \.tabs-block__add\s*\{([^}]*)\}/mu,
    );
    expect(header).toMatch(/overflow-x:\s*auto/u);
    expect(tablist).toMatch(/flex:\s*0 0 auto/u);
    expect(tablist).not.toMatch(/overflow-x/u);
    expect(add).toMatch(/opacity:\s*0/u);
    expect(add).toMatch(/pointer-events:\s*none/u);
    expect(add).toMatch(/border:\s*0/u);
    expect(add).toMatch(/background:\s*transparent/u);
    expect(css).toMatch(
      /\.tabs-block__header:hover \.tabs-block__add,[\s\S]*?opacity:\s*1;[\s\S]*?pointer-events:\s*auto/u,
    );
    expect(css).toMatch(
      /\.tabs-block__add:hover\s*\{[^}]*background:\s*var\(--color-bg-light\);[^}]*color:\s*var\(--color-text\)/u,
    );
  });

  it("keeps visible focus and a fixed, height-constrained document-layer menu", () => {
    expect(css).toMatch(
      /\.tabs-block__tab:focus-visible,[\s\S]*?outline:\s*2px solid var\(--fd-accent\)/u,
    );
    const menu = declarationsFor(
      /^\.first-draft-tabs-action-menu\s*\{([^}]*)\}/mu,
    );
    expect(menu).toMatch(/position:\s*fixed/u);
    expect(menu).toMatch(
      /var\(--first-draft-tabs-menu-available-block-size,\s*100dvh\)/u,
    );
  });

  it("keeps the active background while the text-sized rename field is open", () => {
    const rename = declarationsFor(
      /^\.first-draft-example \.tabs-block__rename\s*\{([^}]*)\}/mu,
    );
    expect(rename).toMatch(/field-sizing:\s*content/u);
    expect(rename).toMatch(/inline-size:\s*auto/u);
    expect(rename).toMatch(/border:\s*0/u);
    expect(rename).toMatch(
      /background:\s*var\(--tabs-block-pill-background\)/u,
    );
    expect(rename).toMatch(/outline:\s*none/u);
    expect(rename).toMatch(/padding:\s*0\.45rem 0\.8rem/u);
  });

  it("provides forced-colors treatment for pills, inputs, and the menu", () => {
    expect(css).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.tabs-block__tab[\s\S]*?forced-color-adjust:\s*none/u,
    );
    expect(css).toMatch(
      /@media \(forced-colors: active\)[\s\S]*?\.first-draft-tabs-action-menu[\s\S]*?background:\s*Canvas/u,
    );
  });
});

describe("First Draft block-control hover corridor", () => {
  it("uses exactly two configurable control rails on desktop", () => {
    const hoverZone = declarationsFor(
      /^\.first-draft-example \.first-draft-block-control-hover-zone\s*\{([^}]*)\}/mu,
    );
    const widthExpression =
      /--first-draft-block-hover-zone-inline-size:\s*calc\(([\s\S]*?)\);/u.exec(
        hoverZone,
      )?.[1];
    const railExpression =
      /var\(--first-draft-block-controls-inline-size,\s*2\.75rem\)/gu;

    expect(widthExpression).toBeDefined();
    expect(widthExpression?.match(railExpression)).toHaveLength(2);
    expect(hoverZone).toMatch(
      /inset-inline-start:\s*calc\(\s*-1 \* var\(--first-draft-block-hover-zone-inline-size\)\s*\)/u,
    );
    expect(hoverZone).toMatch(
      /inline-size:\s*var\(--first-draft-block-hover-zone-inline-size\)/u,
    );
    expect(hoverZone).not.toMatch(
      /(?:var\(--first-draft-block-controls-inline-size,\s*2\.75rem\)[\s+]+){4}/u,
    );
  });

  it("retains full-height transparent pointer coverage below visible controls", () => {
    const hoverZone = declarationsFor(
      /^\.first-draft-example \.first-draft-block-control-hover-zone\s*\{([^}]*)\}/mu,
    );
    const controls = declarationsFor(
      /^\.first-draft-example \.first-draft-block-controls\s*\{([^}]*)\}/mu,
    );
    const zoneStack = Number(/z-index:\s*(-?\d+)/u.exec(hoverZone)?.[1]);
    const controlsStack = Number(/z-index:\s*(-?\d+)/u.exec(controls)?.[1]);

    expect(hoverZone).toMatch(/inset-block:\s*0/u);
    expect(hoverZone).toMatch(/background:\s*transparent/u);
    expect(hoverZone).toMatch(/pointer-events:\s*auto/u);
    expect(zoneStack).toBe(0);
    expect(controlsStack).toBe(12);
    expect(zoneStack).toBeLessThan(controlsStack);
  });

  it("preserves the one-control-rail mobile override", () => {
    const mobileZone = declarationsFor(
      /^\s*\.first-draft-example\s+\.editor-web-block\s*>\s*\.first-draft-block-control-hover-zone,\s*\.first-draft-example\s+\.table-block__chrome-anchor\s*>\s*\.first-draft-block-control-hover-zone\s*\{([^}]*)\}/mu,
    );
    const mediaStart = css.indexOf("@media (max-width: 700px)");
    const mobileRuleStart = css.indexOf(
      ".editor-web-block\n    > .first-draft-block-control-hover-zone",
      mediaStart,
    );

    expect(mediaStart).toBeGreaterThanOrEqual(0);
    expect(mobileRuleStart).toBeGreaterThan(mediaStart);
    expect(mobileZone).toMatch(
      /--first-draft-block-hover-zone-inline-size:\s*var\(\s*--first-draft-block-controls-inline-size,\s*2\.75rem\s*\)/u,
    );
    expect(mobileZone).not.toMatch(/calc\(/u);
    expect(mobileZone).toMatch(/inset-inline-start:\s*0/u);
  });
});

describe("First Draft text focus ownership", () => {
  it("stacks toggle disclosure buttons above the pointer-active hover gutter", () => {
    const chevrons = declarationsFor(
      /^\.first-draft-example \.toggle-heading-block__chevron,\s*\.first-draft-example \.toggle-list-item-block__chevron\s*\{([^}]*)\}/mu,
    );
    const hoverZone = declarationsFor(
      /^\.first-draft-example \.first-draft-block-control-hover-zone\s*\{([^}]*)\}/mu,
    );
    const chevronSvg = declarationsFor(
      /^\.first-draft-example \.toggle-heading-block__chevron svg,\s*\.first-draft-example \.toggle-list-item-block__chevron svg\s*\{([^}]*)\}/mu,
    );
    const chevronStack = Number(/z-index:\s*(-?\d+)/u.exec(chevrons)?.[1]);
    const hoverZoneStack = Number(/z-index:\s*(-?\d+)/u.exec(hoverZone)?.[1]);

    expect(chevrons).toMatch(/position:\s*relative/u);
    expect(chevronStack).toBe(1);
    expect(hoverZone).toMatch(/position:\s*absolute/u);
    expect(hoverZoneStack).toBe(0);
    expect(chevronStack).toBeGreaterThan(hoverZoneStack);
    expect(hoverZone).toMatch(/pointer-events:\s*auto/u);
    expect(chevronSvg).toMatch(/pointer-events:\s*none/u);
  });

  it("sizes toggle glyphs from summary typography without changing the control geometry", () => {
    const layouts = declarationsFor(
      /^\.first-draft-example \.toggle-heading-block__toggle,\s*\.first-draft-example \.toggle-list-item-block__toggle\s*\{([^}]*)\}/mu,
    );
    const headingLevel = (level: 1 | 2 | 3) =>
      declarationsFor(
        new RegExp(
          String.raw`^\.first-draft-example\s+\.toggle-heading-block__toggle:has\(\s*> \[data-editor-block-type="heading"\] \[data-editor-heading-level="${level}"\]\s*\)\s*\{([^}]*)\}`,
          "mu",
        ),
      );
    const listItem = declarationsFor(
      /^\.toggle-list-item-block__toggle\s*\{([^}]*)\}/mu,
    );
    const chevrons = declarationsFor(
      /^\.first-draft-example \.toggle-heading-block__chevron,\s*\.first-draft-example \.toggle-list-item-block__chevron\s*\{([^}]*)\}/mu,
    );
    const glyphs = declarationsFor(
      /^\.first-draft-example \.toggle-heading-block__chevron svg,\s*\.first-draft-example \.toggle-list-item-block__chevron svg\s*\{([^}]*)\}/mu,
    );
    const body = declarationsFor(
      /^\.first-draft-example\s+:is\(\.toggle-heading-block__toggle, \.toggle-list-item-block__toggle\)\s*> \[data-editor-block-type="toggleHeadingBody"\],\s*\.first-draft-example\s+:is\(\.toggle-heading-block__toggle, \.toggle-list-item-block__toggle\)\s*> \[data-editor-block-type="toggleListItemBody"\]\s*\{([^}]*)\}/mu,
    );

    expect(layouts).toMatch(/--fd-toggle-chevron-control-size:\s*1\.5rem/u);
    expect(layouts).toMatch(/--fd-toggle-chevron-icon-size:\s*1rem/u);
    expect(layouts).toMatch(
      /grid-template-columns:\s*1\.5rem minmax\(0,\s*1fr\)/u,
    );
    expect(headingLevel(1)).toMatch(
      /--fd-toggle-chevron-icon-size:\s*1\.5rem/u,
    );
    expect(headingLevel(2)).toMatch(
      /--fd-toggle-chevron-icon-size:\s*1\.25rem/u,
    );
    expect(headingLevel(3)).toMatch(
      /--fd-toggle-chevron-icon-size:\s*1\.25rem/u,
    );
    expect(listItem).toMatch(/--fd-toggle-chevron-icon-size:\s*1rem/u);
    expect(chevrons).toMatch(
      /inline-size:\s*var\(--fd-toggle-chevron-control-size\)/u,
    );
    expect(chevrons).toMatch(
      /block-size:\s*var\(--fd-toggle-chevron-control-size\)/u,
    );
    expect(chevrons).toMatch(/padding:\s*0/u);
    expect(chevrons).toMatch(/align-items:\s*center/u);
    expect(chevrons).toMatch(/justify-content:\s*center/u);
    expect(glyphs).toMatch(
      /inline-size:\s*var\(--fd-toggle-chevron-icon-size\)/u,
    );
    expect(glyphs).toMatch(
      /block-size:\s*var\(--fd-toggle-chevron-icon-size\)/u,
    );
    expect(glyphs).toMatch(/pointer-events:\s*none/u);
    expect(body).not.toMatch(/margin-inline-start/u);
    expect(body).toMatch(/padding:\s*0\.5rem 0 0\.5rem 1rem/u);
    expect(body).toMatch(
      /border-inline-start:\s*1px solid var\(--color-border\)/u,
    );
    expect(css).toMatch(
      /\.toggle-heading-block__chevron svg\[data-expanded="true"\],[\s\S]*?transform:\s*rotate\(90deg\)/u,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.toggle-heading-block__chevron svg,[\s\S]*?transition:\s*none/u,
    );
  });

  it("uses the product color namespace as the only surface theme", () => {
    const surface = /^\.first-draft-example\s*\{([^}]*)\}/u.exec(css)?.[1];

    expect(surface).toBeDefined();
    expect(surface).toMatch(/--color-background:\s*#000000/u);
    expect(surface).toMatch(/--color-foreground:\s*#0b0b0b/u);
    expect(surface).toMatch(/--color-border:\s*#222222/u);
    expect(surface).toMatch(/--color-border-highlight:\s*#484848/u);
    expect(surface).toMatch(/--color-text:\s*#ffffff/u);
    expect(surface).toMatch(/--color-muted:\s*#808080/u);
    expect(surface).toMatch(/--fd-accent:\s*#60a5fa/u);
    expect(surface).toMatch(/color:\s*var\(--color-text\)/u);
    expect(surface).toMatch(/background:\s*var\(--color-background\)/u);
    expect(surface).toMatch(/border:\s*1px solid var\(--color-border\)/u);
    expect(css).not.toMatch(/--fd-(?:background|foreground|border|muted):/u);
    expect(css).not.toMatch(/color-scheme:\s*light/u);
    expect(css).not.toMatch(/\.dark\s+\.first-draft-example/u);
  });

  it("does not draw a focus ring around active paragraph or heading wrappers", () => {
    expect(css).not.toMatch(
      /:is\(\.paragraph-block__paragraph,\s*\.heading-block__heading\):focus-within/u,
    );
  });

  it("keeps block controls borderless until their hover surface appears", () => {
    const controls =
      /^\.first-draft-example \.first-draft-block-control-button\s*\{([^}]*)\}/mu.exec(
        css,
      )?.[1];
    const hover =
      /^\.first-draft-example button\.first-draft-block-control-button:hover\s*\{([^}]*)\}/mu.exec(
        css,
      )?.[1];

    expect(controls).toMatch(/border:\s*0/u);
    expect(controls).toMatch(/background:\s*transparent/u);
    expect(controls).toMatch(/inline-size:\s*1\.5rem/u);
    expect(controls).toMatch(/block-size:\s*1\.5rem/u);
    expect(css).toMatch(
      /\.first-draft-example \.first-draft-block-control-button svg\s*\{[^}]*inline-size:\s*1\.125rem;[^}]*block-size:\s*1\.125rem/u,
    );
    expect(hover).toMatch(/background:\s*var\(--color-bg-light\)/u);
    expect(hover).toMatch(/color:\s*var\(--color-text\)/u);
    expect(hover).not.toMatch(/border(?:-color)?:/u);
  });

  it("does not isolate focused table-cell text", () => {
    const focusedCell =
      /^\.first-draft-example \.table-block__cell:focus-within\s*\{([^}]*)\}/mu.exec(
        css,
      )?.[1];
    expect(focusedCell).toMatch(/box-shadow:\s*inset/u);
    expect(focusedCell).not.toMatch(/z-index/u);
    expect(focusedCell).not.toMatch(/isolation/u);
    expect(focusedCell).not.toMatch(/transform/u);
  });

  it("keeps one stable callout icon footprint in the editor renderer", () => {
    const icon =
      /^\.first-draft-example \.callout-block__icon\s*\{([^}]*)\}/mu.exec(
        css,
      )?.[1];

    expect(icon).toMatch(/inline-size:\s*2rem/u);
    expect(icon).toMatch(/block-size:\s*2rem/u);
    expect(icon).toMatch(/font-size:\s*1\.25rem/u);
    expect(icon).toMatch(/line-height:\s*1/u);
  });

  it("renders the callout icon picker as a compact two-by-two icon grid", () => {
    const picker = declarationsFor(
      /^\.first-draft-example \.callout-block__picker\s*\{([^}]*)\}/mu,
    );
    const option = declarationsFor(
      /^\.first-draft-example \.callout-block__picker button\s*\{([^}]*)\}/mu,
    );
    const hoveredOption = declarationsFor(
      /^\.first-draft-example \.callout-block__picker button:hover\s*\{([^}]*)\}/mu,
    );

    expect(picker).toMatch(/display:\s*grid/u);
    expect(picker).toMatch(/grid-template-columns:\s*repeat\(2,\s*2rem\)/u);
    expect(picker).toMatch(/gap:\s*0\.25rem/u);
    expect(picker).toMatch(/inline-size:\s*max-content/u);
    expect(picker).not.toMatch(/min-inline-size/u);
    expect(option).toMatch(/display:\s*grid/u);
    expect(option).toMatch(/inline-size:\s*2rem/u);
    expect(option).toMatch(/block-size:\s*2rem/u);
    expect(option).toMatch(/place-items:\s*center/u);
    expect(option).toMatch(/padding:\s*0/u);
    expect(option).toMatch(/font-size:\s*1\.25rem/u);
    expect(option).toMatch(/line-height:\s*1/u);
    expect(hoveredOption).toMatch(/background:\s*var\(--color-bg-light\)/u);
  });

  it("uses the two-part flex callout layout with explicit icon/body spacing", () => {
    const callout = declarationsFor(
      /^\.callout-block__callout\s*\{([^}]*)\}/mu,
    );
    const body = declarationsFor(/^\.callout-block__body\s*\{([^}]*)\}/mu);
    const iconWrap = declarationsFor(
      /^\.callout-block__icon-wrap\s*\{([^}]*)\}/mu,
    );

    expect(callout).toMatch(/display:\s*flex/u);
    expect(callout).toMatch(/padding:\s*0 0\.75rem/u);
    expect(callout).not.toMatch(/display:\s*grid/u);
    expect(callout).toMatch(/gap:\s*0\.75rem/u);
    expect(callout).not.toMatch(/grid-/u);
    expect(body).toMatch(/flex:\s*1/u);
    expect(body).toMatch(/min-width:\s*0/u);
    expect(body).toMatch(/padding:\s*0\.75rem 0/u);
    expect(body).not.toMatch(/margin/u);
    expect(body).not.toMatch(/padding-(?:left|right|inline)/u);
    expect(iconWrap).toMatch(/position:\s*relative/u);
    expect(iconWrap).not.toMatch(/z-index/u);
    expect(iconWrap).toMatch(/align-self:\s*flex-start/u);
    expect(iconWrap).toMatch(
      /margin-top:\s*var\(--fd-callout-icon-margin-top\)/u,
    );
    expect(iconWrap).not.toMatch(/padding/u);
    expect(iconWrap).not.toMatch(/(?:^|[;\s])(?:block-size|height):/u);
    expect(iconWrap).not.toMatch(/position:\s*absolute/u);
    expect(css).not.toContain("--fd-callout-icon-padding-block-start");
    expect(css).not.toMatch(
      /\.callout-block__callout\s*>\s*\[data-editor-block-shell/u,
    );
    expect(css).not.toMatch(
      /\.callout-block__callout[^,{]*\[data-editor-block-shell="true"\](?::first-child|:last-child)/u,
    );
  });

  it("aligns the callout icon from only the first direct heading shell", () => {
    for (const [level, offset] of [
      ["1", "1.625rem"],
      ["2", "1.125rem"],
      ["3", "0.625rem"],
    ] as const) {
      expect(css).toMatch(
        new RegExp(
          String.raw`\.callout-block__callout:has\(\s*> \.callout-block__body\s*> \[data-editor-block-type="heading"\]:first-child\s*\[data-editor-heading-level="${level}"\]\s*\)\s*\{[^}]*--fd-callout-icon-margin-top:\s*${offset.replace(".", "\\.")}`,
          "u",
        ),
      );
    }
    expect(css).not.toMatch(
      /\.callout-block__callout:has\([^)]*> \.callout-block__body[^)]*> \[data-editor-block-type="heading"\](?!:first-child)/u,
    );
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
    expect(documentScroll).toMatch(
      /scrollbar-color:\s*var\(--color-border\) transparent/u,
    );
    expect(css).toMatch(
      /\.first-draft-example__document-scroll::-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent/u,
    );
    expect(css).toMatch(
      /\.first-draft-example__document-scroll::-webkit-scrollbar-thumb\s*\{[^}]*background-color:\s*var\(--color-border\)/u,
    );
    expect(css).toMatch(
      /\.first-draft-example__document-scroll::-webkit-scrollbar-thumb:hover\s*\{[^}]*background-color:\s*var\(--color-border-highlight\)/u,
    );
    expect(hoverBoundary).not.toMatch(/overflow(?:-y)?:\s*(?:auto|scroll)/u);
    expect(editorDocument).not.toMatch(/overflow-y:\s*(?:auto|scroll)/u);
    expect(css).not.toContain("first-draft-block-hover-tracker");
  });

  it("leaves only the inner table element horizontally scrollable", () => {
    const rootTableShell =
      /\.first-draft-example\s+\.editor-web-block-list\s*>\s*\.editor-web-block\[data-editor-root-layout="full"\]\[data-editor-block-type="table"\]\s*\{([^}]*)\}/u.exec(
        css,
      )?.[1];
    const tableScroll =
      /^\.first-draft-example \.table-block__scroll\s*\{([^}]*)\}/mu.exec(
        css,
      )?.[1];
    const genericFullLayout =
      /\.editor-web-block-list\s*>\s*\.editor-web-block\[data-editor-root-layout="full"\]\s*\{([^}]*)\}/u.exec(
        editorWebCss,
      )?.[1];

    expect(rootTableShell).toBeDefined();
    expect(rootTableShell).toMatch(/overflow-x:\s*clip/u);
    expect(rootTableShell).toMatch(/overscroll-behavior-x:\s*auto/u);
    expect(rootTableShell).not.toMatch(/overflow-x:\s*(?:auto|hidden)/u);
    expect(tableScroll).toMatch(/position:\s*relative/u);
    expect(tableScroll).toMatch(/overflow-x:\s*auto/u);
    expect(genericFullLayout).toMatch(/overflow-x:\s*auto/u);
    expect(genericFullLayout).toMatch(/overscroll-behavior-x:\s*contain/u);
    expect(css).not.toMatch(
      /\.first-draft-example\s+\.editor-web-block-list\s*>\s*\.editor-web-block\[data-editor-root-layout="full"\]\s*\{[^}]*overflow-x:\s*clip/u,
    );
  });

  it("uses one editor surface for the toolbar and document rows", () => {
    const surface = /^\.first-draft-example\s*\{([^}]*)\}/u.exec(css)?.[1];

    expect(surface).toMatch(/grid-template-rows:\s*auto minmax\(0, 1fr\)/u);
    expect(css).not.toContain("first-draft-example--read-only");
  });

  it("keeps measured block drop targets out of document flow", () => {
    const target =
      /^\.first-draft-example \.first-draft-block-drop-target\s*\{([^}]*)\}/mu.exec(
        css,
      )?.[1];
    const paint =
      /^\.first-draft-example \.first-draft-block-drop-target::before\s*\{([^}]*)\}/mu.exec(
        css,
      )?.[1];

    expect(target).toMatch(/position:\s*relative/u);
    expect(target).toMatch(/block-size:\s*0/u);
    expect(target).toMatch(/min-block-size:\s*0/u);
    expect(paint).toMatch(/position:\s*absolute/u);
    expect(paint).toMatch(/inset-block-start:\s*-1px/u);
    expect(paint).toMatch(/block-size:\s*2px/u);
  });

  it("keeps custom ordered markers without CSS-counter numbering", () => {
    expect(css).not.toContain("counter-reset: first-draft-ordered-list-item");
    expect(css).not.toContain(
      "counter-increment: first-draft-ordered-list-item",
    );
    expect(css).not.toContain(
      'content: counter(first-draft-ordered-list-item) "."',
    );
    expect(css).toMatch(
      /\.first-draft-example\s+\.list-item-block__marker\s*\{[\s\S]*?user-select:\s*none/u,
    );
    expect(css).toMatch(
      /\.first-draft-example[\s\S]*?\[data-list-kind="ordered"\][\s\S]*?>\s*\.list-item-block__marker\s*\{[\s\S]*?font-variant-numeric:\s*tabular-nums/u,
    );
  });
});

describe("First Draft list layout", () => {
  const listContainerRule =
    /\.first-draft-example\s+:is\(\s*ol\[data-editor-block-type="orderedList"\],\s*ul\[data-editor-block-type="bulletList"\],\s*ul\[data-editor-block-type="checklist"\]\s*\)\[data-editor-block-shell="true"\]\s*\{([^}]*)\}/u;
  const listItemRule =
    /\.first-draft-example\s+:is\(\.list-item-block__item,\s*\.checklist-block__item\)\s*\{([^}]*)\}/u;

  it("defines one shared logical geometry for all list presentations", () => {
    const surface = declarationsFor(/^\.first-draft-example\s*\{([^}]*)\}/u);

    expect(surface).toMatch(/--first-draft-list-container-indent:\s*0\.5rem/u);
    expect(surface).toMatch(/--first-draft-list-marker-track-size:\s*1\.5rem/u);
    expect(surface).toMatch(/--first-draft-list-content-gap:\s*0\.5rem/u);
  });

  it("indents bullet, ordered, and checklist containers identically", () => {
    const containers = declarationsFor(listContainerRule);
    const checklist = declarationsFor(
      /^\.first-draft-example ul\[data-editor-block-type="checklist"\]\s*\{([^}]*)\}/mu,
    );

    expect(containers).toMatch(/margin-block:\s*0/u);
    expect(containers).toMatch(
      /padding-inline-start:\s*var\(--first-draft-list-container-indent\)/u,
    );
    expect(containers).not.toMatch(/padding-inline-start:\s*0(?:[;\s]|$)/u);
    expect(checklist).toMatch(/list-style:\s*none/u);
    expect(checklist).not.toMatch(/padding-inline-start/u);
  });

  it("shares marker tracks and content gaps across ordinary and checklist items", () => {
    const items = declarationsFor(listItemRule);

    expect(items).toMatch(/display:\s*grid/u);
    expect(items).toMatch(
      /grid-template-columns:\s*var\(--first-draft-list-marker-track-size\)\s*minmax\(0,\s*1fr\)/u,
    );
    expect(items).toMatch(/gap:\s*var\(--first-draft-list-content-gap\)/u);
    expect(items).not.toMatch(/1\.4rem|0\.35rem/u);
  });

  it("centers native checkboxes without physical-coordinate workarounds", () => {
    const containers = declarationsFor(listContainerRule);
    const items = declarationsFor(listItemRule);
    const checkbox = declarationsFor(
      /^\.first-draft-example \.checklist-block__item > input\s*\{([^}]*)\}/mu,
    );
    const marker = declarationsFor(
      /^\.first-draft-example \.list-item-block__marker\s*\{([^}]*)\}/mu,
    );
    const orderedMarker = declarationsFor(
      /\.first-draft-example\s+\.list-item-block__item\[data-list-kind="ordered"\]\s*> \.list-item-block__marker\s*\{([^}]*)\}/u,
    );

    expect(checkbox).toMatch(/inline-size:\s*1rem/u);
    expect(checkbox).toMatch(/block-size:\s*1rem/u);
    expect(checkbox).toMatch(/justify-self:\s*center/u);
    expect(checkbox).toMatch(/margin:\s*0/u);
    expect(marker).toMatch(/display:\s*grid/u);
    expect(marker).toMatch(/place-items:\s*center/u);
    expect(orderedMarker).toMatch(/font-variant-numeric:\s*tabular-nums/u);

    const alignedRules = [containers, items, checkbox].join("\n");
    expect(alignedRules).not.toMatch(
      /(?:^|[;\s])(?:padding-left|margin-left|left)\s*:/u,
    );
    expect(alignedRules).not.toMatch(/translateX\s*\(/u);
  });

  it("scopes checked decoration to the checkbox-adjacent primary paragraph presentation", () => {
    expect(css).toMatch(
      /\.checklist-block__item\[data-checked="true"\]\s*>\s*input\s*\+\s*\[data-editor-block-type="paragraph"\]\s*>\s*\.paragraph-block__paragraph\s*\{[^}]*color:\s*var\(--color-muted\)[^}]*text-decoration:\s*line-through/u,
    );
    expect(css).not.toMatch(
      /\.checklist-block__item\[data-checked="true"\]\s*>\s*\[data-editor-block-shell="true"\]/u,
    );
  });
});

describe("First Draft table append controls", () => {
  it("uses explicit normal-flow grid rails without a dead-area gap", () => {
    const frame =
      /^\.first-draft-example \.table-block__frame\s*\{([^}]*)\}/mu.exec(
        css,
      )?.[1];
    const columnZone =
      /^\.first-draft-example \.table-block__append-zone--column\s*\{([^}]*)\}/mu.exec(
        css,
      )?.[1];
    const rowZone =
      /^\.first-draft-example \.table-block__append-zone--row\s*\{([^}]*)\}/mu.exec(
        css,
      )?.[1];
    const append =
      /^\.first-draft-example \.table-block__append\s*\{([^}]*)\}/mu.exec(
        css,
      )?.[1];

    expect(frame).toMatch(/display:\s*grid/u);
    expect(frame).toMatch(/grid-template-columns:/u);
    expect(frame).toMatch(/grid-template-rows:/u);
    expect(frame).not.toMatch(/(?:^|\s)gap\s*:/u);
    expect(frame).not.toMatch(/padding-(?:inline|block)/u);
    expect(columnZone).toMatch(/grid-column:\s*2/u);
    expect(columnZone).toMatch(/grid-row:\s*1/u);
    expect(columnZone).toMatch(
      /padding-inline:\s*var\(--first-draft-table-append-control-gap\)/u,
    );
    expect(rowZone).toMatch(/grid-column:\s*1/u);
    expect(rowZone).toMatch(/grid-row:\s*2/u);
    expect(rowZone).toMatch(
      /padding-block-start:\s*var\(--first-draft-table-append-control-gap\)/u,
    );
    expect(append).not.toMatch(/position:\s*absolute/u);
  });

  it("scopes final-column and final-row reveals to their matching rails", () => {
    expect(css).toMatch(
      /\.table-block__frame:has\(\s*\.table-block__row\s*>\s*\[data-editor-block-type="tableCell"\]:last-child:hover\s*\)\s*>\s*\.table-block__append-zone--column\s*>\s*\.table-block__append--column/u,
    );
    expect(css).toMatch(
      /\.table-block__frame:has\(\s*\.table-block__grid\s*>\s*\[data-editor-block-type="tableRow"\]:last-child:hover\s*\)\s*>\s*\.table-block__append-zone--row\s*>\s*\.table-block__append--row/u,
    );
    expect(css).not.toMatch(
      /\.table-block__cell:hover[\s\S]*?\.table-block__append/u,
    );
  });

  it("keeps each control visible across its zone and keyboard focus", () => {
    expect(css).toMatch(
      /\.table-block__append-zone--column:hover\s*>\s*\.table-block__append--column/u,
    );
    expect(css).toMatch(
      /\.table-block__append-zone--column:focus-within\s*>\s*\.table-block__append--column/u,
    );
    expect(css).toMatch(
      /\.table-block__append-zone--row:hover\s*>\s*\.table-block__append--row/u,
    );
    expect(css).toMatch(
      /\.table-block__append-zone--row:focus-within\s*>\s*\.table-block__append--row/u,
    );
    expect(css).toMatch(
      /\.table-block__resize-handle:last-child:hover[\s\S]*?\.table-block__append--column/u,
    );
    expect(css).toMatch(
      /\.table-block__append:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--color-border-highlight\)/u,
    );
  });

  it("uses axis-oriented resize cursors for the append controls", () => {
    expect(css).toMatch(
      /\.table-block__append--row\s*\{[^}]*cursor:\s*row-resize/u,
    );
    expect(css).toMatch(
      /\.table-block__append--column\s*\{[^}]*cursor:\s*col-resize/u,
    );
  });

  it("only hides non-interactive controls on fine hover pointers", () => {
    expect(css).toMatch(
      /@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*\.first-draft-example \.table-block__append\s*\{\s*opacity:\s*0;\s*pointer-events:\s*none;/u,
    );
    expect(css).toMatch(
      /\.table-block__append-zone--column:focus-within[\s\S]*?\{\s*opacity:\s*1;\s*pointer-events:\s*auto;/u,
    );
    expect(css).toMatch(
      /\.table-block__append-zone--row:focus-within[\s\S]*?\{\s*opacity:\s*1;\s*pointer-events:\s*auto;/u,
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.first-draft-example \.table-block__append\s*\{\s*transition:\s*none;/u,
    );
  });

  it("keeps the frame and both control rails inside the horizontal scroller", () => {
    const scroll =
      /^\.first-draft-example \.table-block__scroll\s*\{([^}]*)\}/mu.exec(
        css,
      )?.[1];

    expect(scroll).toMatch(/overflow-x:\s*auto/u);
    expect(css).toMatch(
      /\.table-block__grid-stack\s*\{[^}]*grid-column:\s*1;[^}]*grid-row:\s*1;/u,
    );
    expect(css).toMatch(
      /\.table-block__append-corner\s*\{[^}]*grid-column:\s*2;[^}]*grid-row:\s*2;/u,
    );
  });
});
