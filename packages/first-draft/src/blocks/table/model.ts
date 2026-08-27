import { createBlockId, type JsonObject } from "@repo/editor-core/kernel";

export const TABLE_COLUMN_IDS_FIELD = "columnIds" as const;
export const TABLE_COLUMN_WIDTHS_FIELD = "columnWidths" as const;
export const FIRST_DRAFT_TABLE_DEFAULT_WIDTH = 0;
export const FIRST_DRAFT_TABLE_DEFAULT_VIEW_ID = "";
const MAX_TABLE_ID_ALLOCATION_ATTEMPTS = 100;

export type FirstDraftTableColumnIdResolution =
  | {
      readonly kind: "canonical";
      readonly ids: readonly string[];
    }
  | {
      readonly kind: "synthetic-presentation";
      readonly ids: readonly string[];
    };

export interface NormalizedFirstDraftTableColumns {
  readonly columnIds: readonly string[];
  readonly columnWidths: Readonly<Record<string, number>>;
  readonly replacedInvalidIdentities: boolean;
}

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

export function resolveFirstDraftTableColumnIds(
  metadata: Readonly<Record<string, unknown>> | undefined,
  count: number,
): FirstDraftTableColumnIdResolution {
  const ids = metadata?.[TABLE_COLUMN_IDS_FIELD];
  return Array.isArray(ids) &&
    ids.length === count &&
    ids.every((id) => typeof id === "string" && id.length > 0) &&
    new Set(ids).size === ids.length
    ? { kind: "canonical", ids }
    : {
        kind: "synthetic-presentation",
        ids: Array.from({ length: count }, (_, index) => `column-${index + 1}`),
      };
}

/** Prepares canonical identities and width metadata without mutating source. */
export function normalizeFirstDraftTableColumns(
  metadata: Readonly<Record<string, unknown>> | undefined,
  count: number,
  createId: () => string = createBlockId,
): NormalizedFirstDraftTableColumns {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error("table column count must be a positive integer");
  }
  const resolution = resolveFirstDraftTableColumnIds(metadata, count);
  const columnIds =
    resolution.kind === "canonical"
      ? resolution.ids
      : createFirstDraftTableColumnIds(count, createId);
  return {
    columnIds,
    columnWidths: remapFirstDraftTableColumnWidths(
      metadata,
      resolution,
      columnIds,
    ),
    replacedInvalidIdentities: resolution.kind !== "canonical",
  };
}

/** Resolves safe presentation widths through the same positional rules used by normalization. */
export function resolveFirstDraftTablePresentationColumnWidths(
  metadata: Readonly<Record<string, unknown>> | undefined,
  resolution: FirstDraftTableColumnIdResolution,
): Readonly<Record<string, number>> {
  return remapFirstDraftTableColumnWidths(
    metadata,
    resolution,
    resolution.ids,
  );
}

function remapFirstDraftTableColumnWidths(
  metadata: Readonly<Record<string, unknown>> | undefined,
  resolution: FirstDraftTableColumnIdResolution,
  columnIds: readonly string[],
): Readonly<Record<string, number>> {
  const rawWidths = metadata?.[TABLE_COLUMN_WIDTHS_FIELD];
  if (!rawWidths || typeof rawWidths !== "object" || Array.isArray(rawWidths)) {
    return {};
  }
  const widths = rawWidths as Readonly<Record<string, unknown>>;
  const rawIds = metadata?.[TABLE_COLUMN_IDS_FIELD];
  const sourceIds: readonly (string | null)[] =
    resolution.kind === "canonical"
      ? resolution.ids
      : positionalWidthSourceIds(rawIds, resolution.ids);
  return Object.fromEntries(
    sourceIds.flatMap((sourceId, index) => {
      const targetId = columnIds[index];
      const width = sourceId === null ? undefined : widths[sourceId];
      return targetId &&
        typeof width === "number" &&
        Number.isFinite(width) &&
        width > 0
        ? [[targetId, width] as const]
        : [];
    }),
  );
}

function positionalWidthSourceIds(
  rawIds: unknown,
  presentationIds: readonly string[],
): readonly (string | null)[] {
  if (rawIds === undefined) return presentationIds;
  if (!Array.isArray(rawIds) || rawIds.length !== presentationIds.length) {
    return presentationIds.map(() => null);
  }
  const counts = new Map<string, number>();
  for (const value of rawIds) {
    if (typeof value === "string" && value.length > 0) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return rawIds.map((value) =>
    typeof value === "string" && value.length > 0 && counts.get(value) === 1
      ? value
      : null,
  );
}
