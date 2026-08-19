import { createBlockId, type JsonObject } from "@repo/editor-core/kernel";

export const TABLE_COLUMN_IDS_FIELD = "columnIds" as const;
export const TABLE_COLUMN_WIDTHS_FIELD = "columnWidths" as const;
export const FIRST_DRAFT_TABLE_DEFAULT_WIDTH = 0;
export const FIRST_DRAFT_TABLE_DEFAULT_VIEW_ID = "";
const MAX_TABLE_ID_ALLOCATION_ATTEMPTS = 100;

export function createFirstDraftTableColumnId(
  existingColumnIds: readonly string[],
  createId: () => string = createBlockId,
): string {
  const existing = new Set(existingColumnIds);
  for (
    let attempt = 0;
    attempt < MAX_TABLE_ID_ALLOCATION_ATTEMPTS;
    attempt += 1
  ) {
    const candidate = createId();
    if (candidate.length > 0 && !existing.has(candidate)) return candidate;
  }
  throw new Error("unable to allocate a unique table column id");
}

export function createFirstDraftTableColumnIds(
  count: number,
  createId: () => string = createBlockId,
): readonly string[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("table column count must be a positive integer");
  }
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    ids.push(createFirstDraftTableColumnId(ids, createId));
  }
  return ids;
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
