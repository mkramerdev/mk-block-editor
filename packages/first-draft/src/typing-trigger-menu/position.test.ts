import { describe, expect, it } from "vitest";
import { placeFirstDraftTypingTriggerMenu } from "./position.ts";

describe("First Draft typing-trigger menu placement", () => {
  const viewport = { left: 20, top: 100, width: 500, height: 400 };

  it("opens above only when that side has more usable space", () => {
    expect(
      placeFirstDraftTypingTriggerMenu(
        { left: 100, top: 390, width: 1, height: 20 },
        { width: 200, height: 120 },
        viewport,
      ),
    ).toMatchObject({ placement: "top", top: 264, availableHeight: 276 });
    expect(
      placeFirstDraftTypingTriggerMenu(
        { left: 100, top: 290, width: 1, height: 20 },
        { width: 200, height: 120 },
        viewport,
      )?.placement,
    ).toBe("bottom");
  });

  it("clamps to visual viewport offsets on both horizontal edges", () => {
    expect(
      placeFirstDraftTypingTriggerMenu(
        { left: 10, top: 180, width: 1, height: 20 },
        { width: 200, height: 100 },
        viewport,
      )?.left,
    ).toBe(28);
    expect(
      placeFirstDraftTypingTriggerMenu(
        { left: 500, top: 180, width: 1, height: 20 },
        { width: 200, height: 100 },
        viewport,
      )?.left,
    ).toBe(312);
  });

  it("uses rendered height for upward placement and publishes side capacity", () => {
    expect(
      placeFirstDraftTypingTriggerMenu(
        { left: 100, top: 500, width: 1, height: 20 },
        { width: 200, height: 120 },
        { left: 0, top: 0, width: 800, height: 700 },
      ),
    ).toMatchObject({ placement: "top", top: 374, availableHeight: 486 });
  });
});
