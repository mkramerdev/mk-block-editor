import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");

const firstDraftCss = readFileSync(
  resolve(process.cwd(), "src/first-draft.css"),
  "utf8",
);
const editorCss = readFileSync(
  resolve(packageRoot, "../editor-web/src/styles/editor.css"),
  "utf8",
);

function declaration(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u").exec(css);
  if (!match) throw new Error(`Missing CSS selector: ${selector}`);
  return match[1]!;
}

function zIndex(css: string, selector: string): number {
  const value = /z-index:\s*(-?\d+)/u.exec(declaration(css, selector))?.[1];
  if (!value) throw new Error(`Missing z-index for: ${selector}`);
  return Number(value);
}

describe("First Draft editor layer ownership", () => {
  it("keeps product surfaces below canonical range paint and text above it", () => {
    const hoverZone = zIndex(
      firstDraftCss,
      ".first-draft-example .first-draft-block-control-hover-zone",
    );
    const rangePaint = zIndex(
      editorCss,
      ".editor-web-selection-paint-band--underlay",
    );
    const text = zIndex(editorCss, ".editor-web-text");

    expect(hoverZone).toBeLessThan(rangePaint);
    expect(rangePaint).toBeLessThan(text);
    expect(firstDraftCss).not.toMatch(
      /\.editor-web-block\s*>\s*:not\(\.first-draft-block-controls,[\s\S]*?z-index:\s*2/u,
    );
    expect(
      declaration(firstDraftCss, ".callout-block__callout"),
    ).not.toMatch(/z-index/u);
    expect(declaration(firstDraftCss, ".quote-block__quote")).not.toMatch(
      /z-index/u,
    );
    expect(
      declaration(firstDraftCss, ".first-draft-example .code-block__presentation"),
    ).not.toMatch(/z-index/u);
    expect(
      declaration(firstDraftCss, ".first-draft-example .table-block__grid"),
    ).not.toMatch(/z-index/u);
  });

  it("elevates only controls and interactive overlays above editor text", () => {
    const text = zIndex(editorCss, ".editor-web-text");
    const overlay = zIndex(
      editorCss,
      ".editor-web-selection-paint-band--overlay",
    );
    const controls = zIndex(
      firstDraftCss,
      ".first-draft-example .first-draft-block-controls",
    );
    const badges = zIndex(firstDraftCss, ".first-draft-selection-badge-layer");
    const picker = zIndex(
      firstDraftCss,
      ".first-draft-example .callout-block__picker",
    );
    const calloutIcon = zIndex(firstDraftCss, ".callout-block__icon-wrap");
    const documentLayers = zIndex(
      firstDraftCss,
      '.first-draft-example [data-editor-document-layer-host="true"]',
    );
    const slashMenu = zIndex(firstDraftCss, ".first-draft-slash-menu");

    expect(overlay).toBeGreaterThan(text);
    expect(badges).toBeGreaterThan(overlay);
    expect(controls).toBeGreaterThan(overlay);
    expect(picker).toBeGreaterThan(controls);
    expect(documentLayers).toBeGreaterThan(calloutIcon);
    expect(slashMenu).toBeGreaterThan(documentLayers);
    expect(declaration(editorCss, ".editor-web-selection-paint-band")).toMatch(
      /pointer-events:\s*none/u,
    );
  });
});
