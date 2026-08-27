import { describe, expect, it, vi } from "vitest";
import { fixedPopoverPositionForAnchor } from "./fixed-popover.ts";

describe("fixedPopoverPositionForAnchor", () => {
  it("chooses top when both sides fit and top has more space", () => {
    expect(positionFor(domRect(120, 260, 20, 20), 100)).toMatchObject({
      top: 154,
      placement: "top",
      availableHeight: 246,
    });
  });

  it("chooses bottom when both sides fit and bottom has more space", () => {
    expect(positionFor(domRect(120, 120, 20, 20), 100)).toMatchObject({
      top: 146,
      placement: "bottom",
      availableHeight: 246,
    });
  });

  it("chooses the roomier side and reports its height when neither side fits", () => {
    expect(positionFor(domRect(120, 190, 20, 20), 300)).toMatchObject({
      placement: "bottom",
      availableHeight: 176,
    });
    expect(positionFor(domRect(120, 210, 20, 20), 300)).toMatchObject({
      placement: "top",
      availableHeight: 196,
    });
  });

  it("uses bottom as the exact-space tie-breaker", () => {
    expect(positionFor(domRect(120, 190, 20, 20), 100, 400)).toMatchObject({
      top: 216,
      placement: "bottom",
      availableHeight: 176,
    });
  });

  it("keeps placement independent of measured menu height", () => {
    const anchorRect = domRect(120, 260, 20, 20);
    expect(positionFor(anchorRect, 40).placement).toBe("top");
    expect(positionFor(anchorRect, 220).placement).toBe("top");
    expect(positionFor(anchorRect, 600).placement).toBe("top");
  });

  it("clamps to an offset visual viewport and exposes available height", () => {
    const anchor = document.createElement("button");
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(
      domRect(390, 120, 20, 20),
    );
    expect(
      fixedPopoverPositionForAnchor(anchor, window, {
        width: 160,
        height: 100,
        gap: 6,
        margin: 8,
        viewport: { left: 40, top: 20, width: 400, height: 300 },
      }),
    ).toEqual({
      left: 272,
      top: 146,
      placement: "bottom",
      availableHeight: 166,
    });
  });

  it("subtracts gap and margin once on both sides", () => {
    const result = fixedPopoverPositionForAnchor(
      anchorWithRect(domRect(100, 100, 20, 20)),
      window,
      {
        width: 80,
        height: 40,
        gap: 7,
        margin: 11,
        viewport: { left: 0, top: 0, width: 300, height: 238 },
      },
    );
    expect(result).toMatchObject({
      top: 127,
      placement: "bottom",
      availableHeight: 100,
    });
  });

  it("flips above and uses resized menu dimensions", () => {
    const anchor = document.createElement("button");
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(
      domRect(100, 260, 20, 20),
    );
    expect(
      fixedPopoverPositionForAnchor(anchor, window, {
        width: 120,
        height: 80,
        viewport: { left: 0, top: 0, width: 320, height: 300 },
      }),
    ).toEqual({
      left: 100,
      top: 174,
      placement: "top",
      availableHeight: 246,
    });
    expect(
      fixedPopoverPositionForAnchor(anchor, window, {
        width: 260,
        height: 240,
        viewport: { left: 0, top: 0, width: 320, height: 300 },
      }).left,
    ).toBe(52);
  });
});

function positionFor(
  anchorRect: DOMRect,
  height: number,
  viewportHeight = 400,
) {
  return fixedPopoverPositionForAnchor(anchorWithRect(anchorRect), window, {
    width: 120,
    height,
    gap: 6,
    margin: 8,
    viewport: { left: 0, top: 0, width: 400, height: viewportHeight },
  });
}

function anchorWithRect(rect: DOMRect): HTMLElement {
  const anchor = document.createElement("button");
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(rect);
  return anchor;
}

function domRect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}
