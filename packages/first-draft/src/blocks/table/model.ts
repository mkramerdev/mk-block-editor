import { createBlockId, type JsonObject } from "@repo/editor-core/kernel";

export const TABLE_COLUMN_IDS_FIELD = "columnIds" as const;
export const TABLE_COLUMN_WIDTHS_FIELD = "columnWidths" as const;
export const FIRST_DRAFT_TABLE_DEFAULT_WIDTH = 0;
export const FIRST_DRAFT_TABLE_DEFAULT_VIEW_ID = "";

export function createFirstDraftTableColumnIds(
  count: number,
  createId: () => string = createBlockId,
): readonly string[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("table column count must be a positive integer");
  }
  const ids = Array.from({ length: count }, () => createId());
  if (new Set(ids).size !== ids.length || ids.some((id) => !id)) {
    throw new Error("table column ids must be unique non-empty strings");
  }
  return Object.freeze(ids);
}

export function createFirstDraftTableMetadata(
  columnIds: readonly string[],
): JsonObject {
  if (
    columnIds.length < 1 ||
    new Set(columnIds).size !== columnIds.length ||
    columnIds.some((id) => typeof id !== "string" || id.length === 0)
  ) {
    throw new Error("table metadata requires unique column ids");
  }
  return {
    width: FIRST_DRAFT_TABLE_DEFAULT_WIDTH,
    viewId: FIRST_DRAFT_TABLE_DEFAULT_VIEW_ID,
    [TABLE_COLUMN_IDS_FIELD]: [...columnIds],
  };
}

export function readFirstDraftTableColumnIds(
  metadata: Readonly<Record<string, unknown>> | undefined,
  count: number,
): readonly string[] {
  const ids = metadata?.[TABLE_COLUMN_IDS_FIELD];
  return Array.isArray(ids) &&
    ids.length === count &&
    ids.every((id) => typeof id === "string") &&
    new Set(ids).size === ids.length
    ? ids
    : Array.from({ length: count }, (_, index) => `column-${index + 1}`);
}
