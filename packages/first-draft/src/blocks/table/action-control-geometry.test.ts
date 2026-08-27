import { describe, expect, it } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  tableColumnActionControlLayouts,
  tableColumnCarrierLayouts,
  tableRowCarrierLaneLayout,
  tableRowCarrierLayouts,
  type TableActionControlRect,
} from "./action-control-geometry.tsx";

const rect = (
  left: number,
  top: number,
  width: number,
  height: number,
): TableActionControlRect => ({ left, top, width, height });

describe("First Draft table action control geometry", () => {
  it("keeps full-height row carriers in flow while exposing normal gutter triggers", () => {
    const first = "row-1" as BlockId;
    const second = "row-2" as BlockId;
    const result = tableRowCarrierLayouts(
      rect(0, 0, 800, 300),
      rect(0, 0, 800, 240),
      rect(100, 40, 624, 160),
      [
        [first, rect(100, 40, 624, 40)],
        [second, rect(100, 80, 624, 56)],
      ],
    );

    expect(result.lane).toEqual({ left: 100, top: 40, width: 624 });
    expect(result.carriers.get(first)).toEqual({
      width: 624,
      height: 40,
    });
    expect(result.carriers.get(second)).toEqual({
      width: 624,
      height: 56,
    });
    expect(result.triggers.get(first)).toEqual({
      left: 80,
      top: 40,
      width: 20,
      height: 40,
    });
    expect(result.triggers.get(second)).toEqual({
      left: 80,
      top: 80,
      width: 20,
      height: 56,
    });
    expect("top" in result.carriers.get(first)!).toBe(false);
  });

  it("keeps row carriers measurable when horizontal clipping removes the trigger gutter", () => {
    const rowIds = ["row-1" as BlockId, "row-2" as BlockId] as const;
    const rows = rowIds.map(
      (id, index) =>
        [id, rect(-40, 40 + index * 40, 528, 40)] as const,
    );

    for (const grid of [
      rect(0, 40, 528, 80),
      rect(12, 40, 528, 80),
      rect(-400, 40, 200, 80),
      rect(900, 40, 200, 80),
    ]) {
      const result = tableRowCarrierLayouts(
        rect(0, 0, 800, 300),
        rect(0, 0, 800, 240),
        grid,
        rows,
      );
      expect(result.lane).not.toBeNull();
      expect(result.lane).toMatchObject({
        left: grid.left,
        width: grid.width,
      });
      expect(result.carriers.size).toBe(2);
      expect(
        [...result.carriers.values()].every(
          (carrier) =>
            carrier.width === grid.width &&
            carrier.height === 40,
        ),
      ).toBe(true);
      expect(result.triggers.size).toBe(0);
    }
  });

  it("removes the row lane only for foundationally non-measurable geometry", () => {
    expect(
      tableRowCarrierLaneLayout(
        rect(0, 0, 800, 300),
        rect(0, 0, 800, 240),
        rect(100, 40, 0, 120),
      ),
    ).toBeNull();
    expect(
      tableRowCarrierLaneLayout(
        rect(0, 0, 800, 300),
        rect(0, 0, 0, 240),
        rect(100, 40, 528, 120),
      ),
    ).toBeNull();
  });

  it("derives horizontally scrolled and partially visible columns", () => {
    const layouts = tableColumnActionControlLayouts(
      rect(0, 0, 500, 300),
      rect(100, 0, 300, 240),
      rect(50, 40, 528, 120),
      ["a", "b", "c"],
      [176, 176, 176],
    );
    expect(layouts.get("a")).toEqual({
      left: 100,
      top: 20,
      width: 126,
      height: 20,
    });
    expect(layouts.get("b")).toEqual({
      left: 226,
      top: 20,
      width: 174,
      height: 20,
    });
    expect(layouts.has("c")).toBe(false);
  });

  it("tracks complete and resized visible column widths", () => {
    const initial = tableColumnActionControlLayouts(
      rect(0, 0, 500, 300),
      rect(100, 0, 300, 240),
      rect(100, 40, 176, 120),
      ["a"],
      [176],
    );
    expect(initial.get("a")).toEqual({
      left: 100,
      top: 20,
      width: 176,
      height: 20,
    });

    const resized = tableColumnActionControlLayouts(
      rect(0, 0, 500, 300),
      rect(100, 0, 300, 240),
      rect(100, 40, 240, 120),
      ["a"],
      [240],
    );
    expect(resized.get("a")?.width).toBe(240);
  });

  it("keeps full-width horizontal carriers in flow while clipping only triggers", () => {
    const result = tableColumnCarrierLayouts(
      rect(0, 0, 800, 300),
      rect(100, 0, 500, 240),
      rect(50, 40, 624, 160),
      ["token-a", "token-b", "token-c"],
      [160, 208, 256],
    );
    expect(result.lane).toEqual({ left: 50, top: 40, height: 160 });
    expect(result.carriers.get("token-a")).toEqual({
      width: 160,
      height: 160,
    });
    expect(result.carriers.get("token-b")).toEqual({
      width: 208,
      height: 160,
    });
    expect(result.carriers.get("token-c")).toEqual({
      width: 256,
      height: 160,
    });
    expect([...result.triggers.values()]).toEqual([
      { left: 100, top: 20, width: 110, height: 20 },
      { left: 210, top: 20, width: 208, height: 20 },
      { left: 418, top: 20, width: 182, height: 20 },
    ]);
  });

  it("keeps complete column carriers while vertical clipping removes only triggers", () => {
    const result = tableColumnCarrierLayouts(
      rect(0, 0, 800, 300),
      rect(100, 240, 500, 40),
      rect(100, 40, 624, 160),
      ["token-a", "token-b", "token-c"],
      [176, 208, 240],
    );
    expect([...result.carriers.values()]).toEqual([
      { width: 176, height: 160 },
      { width: 208, height: 160 },
      { width: 240, height: 160 },
    ]);
    expect(result.triggers.size).toBe(0);
  });

  it("keeps the column trigger band inside the horizontal scroller cross axis", () => {
    const viewport = rect(100, 20, 300, 240);
    const result = tableColumnCarrierLayouts(
      rect(0, 0, 700, 300),
      viewport,
      rect(100, 40, 176, 120),
      ["token-a"],
      [176],
    );
    const trigger = result.triggers.get("token-a")!;
    const triggerCenterY = trigger.top + trigger.height / 2;
    expect(triggerCenterY).toBeGreaterThanOrEqual(viewport.top);
    expect(triggerCenterY).toBeLessThanOrEqual(
      viewport.top + viewport.height,
    );
  });

  it("returns no layout for zero or unavailable geometry", () => {
    expect(
      tableColumnActionControlLayouts(
        rect(0, 0, 0, 0),
        rect(0, 0, 0, 0),
        rect(0, 0, 0, 0),
        ["a"],
        [0],
      ).size,
    ).toBe(0);
    expect(
      tableRowCarrierLayouts(
        rect(0, 0, 100, 100),
        rect(0, 0, 100, 100),
        rect(10, 0, 90, 100),
        [["row-1" as BlockId, rect(10, 0, 90, 20)]],
      ).triggers.get("row-1" as BlockId),
    ).toBeUndefined();
  });
});
