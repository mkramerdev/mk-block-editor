import { describe, expect, it } from "vitest";
import { createRectangularSelectionPaintSegments } from "./selection-paint-segment.ts";

const rowIds = ["row-1", "row-2", "row-3"] as const;
const cells = new Map([
  ["row-1", ["a", "b", "c"]],
  ["row-2", ["d", "e", "f"]],
  ["row-3", ["g", "h", "i"]],
] as const);

function segments(anchorCellId: string, headCellId: string) {
  return createRectangularSelectionPaintSegments(
    rowIds,
    (rowId) => cells.get(rowId) ?? [],
    anchorCellId,
    headCellId,
  );
}

describe("createRectangularSelectionPaintSegments", () => {
  it("assigns only the outside edges of a horizontal range", () => {
    expect([...segments("d", "f")]).toEqual([
      ["d", { top: true, right: false, bottom: true, left: true }],
      ["e", { top: true, right: false, bottom: true, left: false }],
      ["f", { top: true, right: true, bottom: true, left: false }],
    ]);
  });

  it("assigns only the outside edges of a vertical range", () => {
    expect([...segments("b", "h")]).toEqual([
      ["b", { top: true, right: true, bottom: false, left: true }],
      ["e", { top: false, right: true, bottom: false, left: true }],
      ["h", { top: false, right: true, bottom: true, left: true }],
    ]);
  });

  it("normalizes a backward rectangle and removes internal edges", () => {
    expect([...segments("i", "e")]).toEqual([
      ["e", { top: true, right: false, bottom: false, left: true }],
      ["f", { top: true, right: true, bottom: false, left: false }],
      ["h", { top: false, right: false, bottom: true, left: true }],
      ["i", { top: false, right: true, bottom: true, left: false }],
    ]);
  });

  it("assigns all four edges to a one-cell range", () => {
    expect([...segments("e", "e")]).toEqual([
      ["e", { top: true, right: true, bottom: true, left: true }],
    ]);
  });

  it("returns no segments when either endpoint is outside the grid", () => {
    expect(segments("missing", "e").size).toBe(0);
    expect(segments("e", "missing").size).toBe(0);
  });
});
