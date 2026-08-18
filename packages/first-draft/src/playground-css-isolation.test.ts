import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(
  resolve(process.cwd(), "../../apps/playground-react/src/styles.css"),
  "utf8",
);

describe("React playground typography isolation", () => {
  it("scopes landing-page element typography away from First Draft content", () => {
    expect(css).not.toMatch(/^\s*(?:h1|p|code)\s*\{/gmu);
    expect(css).toMatch(/\.playground-home h1\s*\{/u);
    expect(css).toMatch(/\.playground-home p\s*\{/u);
    expect(css).toMatch(/\.playground-home code\s*\{/u);
    expect(css).not.toMatch(/\.first-draft-example[^{]*\b(?:h1|p|code)\b/u);
  });

  it("locks only the First Draft route to the dynamic viewport", () => {
    const route = /^\.first-draft-route\s*\{([^}]*)\}/mu.exec(css)?.[1];
    const editor = /^\.first-draft-route__editor\s*\{([^}]*)\}/mu.exec(
      css,
    )?.[1];

    expect(route).toMatch(/block-size:\s*100dvh/u);
    expect(route).toMatch(/grid-template-rows:\s*auto minmax\(0, 1fr\)/u);
    expect(route).toMatch(/overflow:\s*hidden/u);
    expect(editor).toMatch(/min-block-size:\s*0/u);
    expect(css).not.toMatch(/^body\s*\{[^}]*overflow:\s*hidden/mu);
    expect(css).not.toMatch(/^#root\s*\{[^}]*overflow:\s*hidden/mu);
  });
});
