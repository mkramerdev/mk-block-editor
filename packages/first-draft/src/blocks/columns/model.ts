import type { BlockId, JsonObject } from "@repo/editor-core/kernel";

export const COLUMN_LAYOUT_WEIGHT_FIELD = "layoutWeight" as const;
export const COLUMN_LAYOUT_WEIGHT_UNIT = 1_000_000;
export const COLUMN_PREFERRED_MIN_WIDTH_PX = 160;

export interface OrderedColumnWeight {
  readonly id: BlockId;
  readonly weight: number;
}

export function readColumnLayoutWeight(metadata: unknown): number | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return null;
  const value = (metadata as Record<string, unknown>)[
    COLUMN_LAYOUT_WEIGHT_FIELD
  ];
  return isWeight(value) ? value : null;
}

export function createDefaultColumnMetadata(): JsonObject {
  return { [COLUMN_LAYOUT_WEIGHT_FIELD]: COLUMN_LAYOUT_WEIGHT_UNIT };
}

export function validateColumnMetadata(
  metadata: JsonObject | undefined,
): readonly string[] {
  return readColumnLayoutWeight(metadata) === null
    ? Object.freeze([
        "column metadata layoutWeight must be a positive finite integer",
      ])
    : Object.freeze([]);
}

export function columnWeightsToGridTracks(
  columns: readonly OrderedColumnWeight[],
): string | null {
  if (
    columns.length < 2 ||
    new Set(columns.map(({ id }) => id)).size !== columns.length ||
    columns.some(({ weight }) => !isWeight(weight))
  )
    return null;
  return columns.map(({ weight }) => `minmax(0, ${weight}fr)`).join(" ");
}

export function resizeAdjacentColumnWeights(input: {
  readonly columns: readonly OrderedColumnWeight[];
  readonly leftIndex: number;
  readonly leftWidth: number;
  readonly rightWidth: number;
  readonly delta: number;
  readonly minimumWidth?: number;
}): readonly OrderedColumnWeight[] | null {
  const left = input.columns[input.leftIndex];
  const right = input.columns[input.leftIndex + 1];
  const minimum = input.minimumWidth ?? COLUMN_PREFERRED_MIN_WIDTH_PX;
  if (
    !left ||
    !right ||
    input.leftWidth <= 0 ||
    input.rightWidth <= 0 ||
    input.leftWidth + input.rightWidth < minimum * 2
  )
    return null;
  const delta = Math.min(
    input.rightWidth - minimum,
    Math.max(minimum - input.leftWidth, input.delta),
  );
  const pairWeight = left.weight + right.weight;
  const nextLeft = Math.max(
    1,
    Math.min(
      pairWeight - 1,
      Math.round(
        (pairWeight * (input.leftWidth + delta)) /
          (input.leftWidth + input.rightWidth),
      ),
    ),
  );
  return input.columns.map((column, index) =>
    index === input.leftIndex
      ? { ...column, weight: nextLeft }
      : index === input.leftIndex + 1
        ? { ...column, weight: pairWeight - nextLeft }
        : column,
  );
}

function isWeight(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  );
}
