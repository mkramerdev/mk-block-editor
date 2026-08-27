import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId, JsonObject } from "@repo/editor-core/kernel";
import { describe, expect, it } from "vitest";
import {
  COLUMN_LAYOUT_WEIGHT_UNIT,
  resolveColumnLayoutPresentation,
  resizeAdjacentColumnWeights,
} from "./model.ts";

const id = (value: string) => value as BlockId;
const columnsId = id("columns");

describe("First Draft column layout presentation", () => {
  it("uses ordered canonical weights when every live column is resize-valid", () => {
    const layout = resolveColumnLayoutPresentation({
      columnsId,
      records: [column("left", 750_000), column("right", 1_250_000)],
    });

    expect(layout).toEqual({
      columns: [
        { id: id("left"), weight: 750_000 },
        { id: id("right"), weight: 1_250_000 },
      ],
      resizeValid: true,
      tracks: "minmax(0, 750000fr) minmax(0, 1250000fr)",
    });
  });

  it.each([
    ["missing", undefined],
    ["zero", { layoutWeight: 0 }],
    ["negative", { layoutWeight: -1 }],
    ["fractional", { layoutWeight: 1.5 }],
  ] as const)(
    "keeps two malformed columns side by side for %s metadata",
    (_name, metadata) => {
      const records = [
        columnRecord("left", metadata),
        column("right", COLUMN_LAYOUT_WEIGHT_UNIT),
      ];
      const before = structuredClone(records);
      const layout = resolveColumnLayoutPresentation({ columnsId, records });

      expect(layout.resizeValid).toBe(false);
      expect(layout.tracks).toBe("repeat(2, minmax(0, 1fr))");
      expect(records).toEqual(before);
    },
  );

  it("falls back for duplicate identities and any visible column count", () => {
    const duplicate = column("same", COLUMN_LAYOUT_WEIGHT_UNIT);
    expect(
      resolveColumnLayoutPresentation({
        columnsId,
        records: [duplicate, duplicate],
      }),
    ).toMatchObject({
      resizeValid: false,
      tracks: "repeat(2, minmax(0, 1fr))",
    });
    expect(
      resolveColumnLayoutPresentation({
        columnsId,
        records: [columnRecord("one", undefined)],
      }),
    ).toMatchObject({
      resizeValid: false,
      tracks: "repeat(1, minmax(0, 1fr))",
    });
    expect(
      resolveColumnLayoutPresentation({
        columnsId,
        records: [
          columnRecord("one", undefined),
          columnRecord("two", undefined),
          columnRecord("three", undefined),
        ],
      }),
    ).toMatchObject({
      resizeValid: false,
      tracks: "repeat(3, minmax(0, 1fr))",
    });
  });

  it("ignores unavailable, deleted, misplaced, and non-column records", () => {
    const deleted = column("deleted", COLUMN_LAYOUT_WEIGHT_UNIT, {
      tombstone: { deletedAt: 1, reason: "user-delete" },
    });
    const misplaced = column("misplaced", COLUMN_LAYOUT_WEIGHT_UNIT, {
      parentId: id("other-columns"),
    });
    const wrongType = column("wrong-type", COLUMN_LAYOUT_WEIGHT_UNIT, {
      type: "paragraph",
    });
    const layout = resolveColumnLayoutPresentation({
      columnsId,
      records: [null, deleted, misplaced, wrongType],
    });

    expect(layout).toEqual({
      columns: [],
      resizeValid: false,
      tracks: "minmax(0, 1fr)",
    });
  });

  it("preserves positive pair weight and enforces the presentation minimum during resize", () => {
    const columns = [
      { id: id("left"), weight: 1_000_000 },
      { id: id("right"), weight: 1_000_000 },
    ];
    expect(resizeAdjacentColumnWeights({
      columns,
      leftIndex: 0,
      leftWidth: 300,
      rightWidth: 300,
      delta: 60,
      minimumWidth: 160,
    })).toEqual([
      { id: id("left"), weight: 1_200_000 },
      { id: id("right"), weight: 800_000 },
    ]);
    const clamped = resizeAdjacentColumnWeights({
      columns,
      leftIndex: 0,
      leftWidth: 300,
      rightWidth: 300,
      delta: -1_000,
      minimumWidth: 160,
    });
    expect(clamped?.[0]?.weight).toBe(533_333);
    expect(clamped?.[1]?.weight).toBe(1_466_667);
    expect((clamped?.[0]?.weight ?? 0) + (clamped?.[1]?.weight ?? 0)).toBe(
      2_000_000,
    );
  });
});

function column(
  blockId: string,
  weight: number,
  overrides: Partial<VersionedBlock> = {},
): VersionedBlock {
  return columnRecord(blockId, { layoutWeight: weight }, overrides);
}

function columnRecord(
  blockId: string,
  metadata: JsonObject | undefined,
  overrides: Partial<VersionedBlock> = {},
): VersionedBlock {
  return {
    id: id(blockId),
    type: "column",
    parentId: columnsId,
    tombstone: null,
    metadataVersion: "metadata-1",
    contentVersion: null,
    ...(metadata ? { metadata } : {}),
    ...overrides,
  };
}
