import { describe, expect, it } from "vitest";
import {
  deriveFirstDraftSelectionMenuPreferredPlacement,
  placeFirstDraftSelectionMenu,
} from "./selection-menu-position.ts";

describe("deriveFirstDraftSelectionMenuPreferredPlacement", () => {
  it("prefers below when the head is visually lower than the anchor", () => {
    expect(
      deriveFirstDraftSelectionMenuPreferredPlacement(
        { left: 20, top: 40, width: 1, height: 18 },
        { left: 20, top: 100, width: 1, height: 18 },
      ),
    ).toBe("below");
  });

  it("prefers above when the head is visually higher than the anchor", () => {
    expect(
      deriveFirstDraftSelectionMenuPreferredPlacement(
        { left: 20, top: 100, width: 1, height: 18 },
        { left: 20, top: 40, width: 1, height: 18 },
      ),
    ).toBe("above");
  });

  it("prefers above for identical caret rectangles", () => {
    const caret = { left: 20, top: 40, width: 1, height: 18 };
    expect(deriveFirstDraftSelectionMenuPreferredPlacement(caret, caret)).toBe(
      "above",
    );
  });

  it("prefers above when vertical caret bands overlap", () => {
    expect(
      deriveFirstDraftSelectionMenuPreferredPlacement(
        { left: 20, top: 40, width: 1, height: 20 },
        { left: 80, top: 55, width: 1, height: 20 },
      ),
    ).toBe("above");
  });

  it("keeps fractional differences within one overlapping row above", () => {
    expect(
      deriveFirstDraftSelectionMenuPreferredPlacement(
        { left: 20, top: 10.25, width: 1, height: 17.75 },
        { left: 80, top: 27.999, width: 1, height: 18.25 },
      ),
    ).toBe("above");
  });

  it("uses visual geometry even when document order would suggest the opposite", () => {
    expect(
      deriveFirstDraftSelectionMenuPreferredPlacement(
        { left: 20, top: 220, width: 1, height: 18 },
        { left: 300, top: 80, width: 1, height: 18 },
      ),
    ).toBe("above");
  });
});

describe("placeFirstDraftSelectionMenu", () => {
  const viewport = { left: 0, top: 0, width: 400, height: 300 };
  const menu = { width: 120, height: 40 };

  it("uses below when below is preferred and fits", () => {
    expect(
      placeFirstDraftSelectionMenu(
        { left: 200, top: 100, width: 2, height: 18 },
        menu,
        viewport,
        "below",
      ),
    ).toEqual({ left: 141, top: 126, placement: "below" });
  });

  it("uses above when above is preferred and fits", () => {
    expect(
      placeFirstDraftSelectionMenu(
        { left: 200, top: 100, width: 2, height: 18 },
        menu,
        viewport,
        "above",
      ),
    ).toEqual({ left: 141, top: 52, placement: "above" });
  });

  it("flips a below preference above near the viewport bottom", () => {
    expect(
      placeFirstDraftSelectionMenu(
        { left: 200, top: 270, width: 2, height: 18 },
        menu,
        viewport,
        "below",
      ),
    ).toEqual({ left: 141, top: 222, placement: "above" });
  });

  it("flips an above preference below near the viewport top", () => {
    expect(
      placeFirstDraftSelectionMenu(
        { left: 200, top: 10, width: 2, height: 18 },
        menu,
        viewport,
        "above",
      ),
    ).toEqual({ left: 141, top: 36, placement: "below" });
  });

  it("retains and clamps the preferred side when neither side fits", () => {
    expect(
      placeFirstDraftSelectionMenu(
        { left: 100, top: 30, width: 2, height: 10 },
        { width: 120, height: 70 },
        { left: 0, top: 0, width: 240, height: 80 },
        "below",
      ),
    ).toEqual({ left: 41, top: 8, placement: "below" });
  });

  it("keeps horizontal centering and viewport clamping unchanged", () => {
    expect(
      placeFirstDraftSelectionMenu(
        { left: 5, top: 100, width: 2, height: 18 },
        { width: 180, height: 50 },
        { left: 10, top: 20, width: 220, height: 180 },
        "above",
      ),
    ).toEqual({ left: 18, top: 42, placement: "above" });
  });

  it("does not clamp an entirely offscreen head back into the viewport", () => {
    expect(
      placeFirstDraftSelectionMenu(
        { left: 100, top: -40, width: 1, height: 16 },
        { width: 180, height: 40 },
        { left: 0, top: 0, width: 320, height: 240 },
        "below",
      ),
    ).toBeNull();
    expect(
      placeFirstDraftSelectionMenu(
        { left: 100, top: 260, width: 1, height: 16 },
        { width: 180, height: 40 },
        { left: 0, top: 0, width: 320, height: 240 },
        "above",
      ),
    ).toBeNull();
  });
});
