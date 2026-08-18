import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(process.cwd(), "src/styles/editor.css"), "utf8");

function declaration(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "u").exec(css);
  if (!match) throw new Error(`Missing CSS selector: ${selector}`);
  return match[1]!;
}

function zIndex(selector: string): number {
  const value = /z-index:\s*(-?\d+)/u.exec(declaration(selector))?.[1];
  if (!value) throw new Error(`Missing z-index for: ${selector}`);
  return Number(value);
}

describe("selection paint stacking contract", () => {
  it("places range underlays below text and overlay primitives above surfaces", () => {
    const underlay = zIndex(".editor-web-selection-paint-band--underlay");
    const foreground = zIndex(".editor-web-text");
    const overlay = zIndex(".editor-web-selection-paint-band--overlay");

    expect(underlay).toBeLessThan(foreground);
    expect(overlay).toBeGreaterThan(foreground);
    expect(declaration(".editor-web-selection-paint-layer")).not.toMatch(
      /z-index/u,
    );
    expect(declaration('[data-editor-object-root="true"]')).not.toMatch(
      /z-index/u,
    );
  });

  it("keeps both bands non-interactive and preserves forced-color range paint", () => {
    expect(declaration(".editor-web-selection-paint-band")).toMatch(
      /pointer-events:\s*none/u,
    );
    expect(css).toMatch(
      /@media\s*\(forced-colors:\s*active\)[\s\S]*text-fragment[\s\S]*background:\s*Highlight/u,
    );
  });

  it("defensively suppresses native range paint only for ordinary canonical-global roots", () => {
    expect(css).toMatch(
      /data-editor-native-selection-paint-mode="hidden-for-global-selection"[\s\S]*data-editor-text-root="true"[\s\S]*::selection[\s\S]*background:\s*transparent/u,
    );
    expect(css).toMatch(
      /:not\([\s\S]*data-editor-block-internal-selection-host="true"[\s\S]*\)[\s\S]*::selection/u,
    );
    expect(css).not.toMatch(
      /data-editor-native-selection-paint-mode="composition-owned"[\s\S]*::selection/u,
    );
    const nativeSuppression = css.slice(
      css.indexOf("/* Defensive paint containment"),
      css.indexOf(".editor-web-selection-paint-rect"),
    );
    expect(nativeSuppression).not.toMatch(/user-select:\s*none/u);
    expect(css).toMatch(
      /@media\s*\(forced-colors:\s*active\)[\s\S]*hidden-for-global-selection[\s\S]*::selection[\s\S]*forced-color-adjust:\s*none/u,
    );
  });
});
