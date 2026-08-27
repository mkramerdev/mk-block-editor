import { describe, expect, it } from "vitest";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import { selectionPaintSegmentsForIds } from "./selection.ts";

describe("projected table selection paint", () => {
  it("keeps selected cell identities and derives edges from projected adjacency", () => {
    const tableId = asBlockId("table");
    const rowA = asBlockId("row-a");
    const rowB = asBlockId("row-b");
    const a = ["a-1", "a-2", "a-3"].map(asBlockId);
    const b = ["b-1", "b-2", "b-3"].map(asBlockId);
    const children = new Map<BlockId, readonly BlockId[]>([
      [tableId, [rowA, rowB]],
      [rowA, [a[1]!, a[2]!, a[0]!]],
      [rowB, [b[1]!, b[2]!, b[0]!]],
    ]);
    const selected = new Set([a[0]!, a[1]!, b[0]!, b[1]!]);

    const segments = selectionPaintSegmentsForIds(
      {
        getParentId: () => null,
        getChildBlockIds: (parentId) => children.get(parentId) ?? [],
      },
      tableId,
      selected,
    );

    expect([...segments.keys()]).toEqual([a[1], a[0], b[1], b[0]]);
    expect(segments.get(a[1]!)).toEqual({
      top: true,
      right: true,
      bottom: false,
      left: true,
    });
    expect(segments.get(a[0]!)).toEqual({
      top: true,
      right: true,
      bottom: false,
      left: true,
    });
    expect(segments.get(b[1]!)).toEqual({
      top: false,
      right: true,
      bottom: true,
      left: true,
    });
    expect(segments.get(b[0]!)).toEqual({
      top: false,
      right: true,
      bottom: true,
      left: true,
    });
  });
});
