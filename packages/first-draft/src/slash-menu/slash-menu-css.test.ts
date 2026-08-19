import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(resolve(process.cwd(), "src/first-draft.css"), "utf8");

describe("First Draft slash menu CSS", () => {
  it("keeps product height and available viewport height as independent constraints", () => {
    expect(css).toMatch(/--first-draft-slash-menu-max-block-size:\s*15rem/u);
    expect(css).toMatch(
      /max-block-size:\s*min\(\s*var\(--first-draft-slash-menu-max-block-size,\s*15rem\),\s*var\(--first-draft-slash-menu-available-block-size,\s*100dvh\)\s*\)/u,
    );
    expect(css).toMatch(/overflow-y:\s*auto/u);
    expect(css).toMatch(/overscroll-behavior:\s*contain/u);
  });
});
