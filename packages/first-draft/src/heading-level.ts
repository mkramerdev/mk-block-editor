import type { JsonObject } from "@repo/editor-core/kernel";

export const FIRST_DRAFT_HEADING_LEVELS = [1, 2, 3] as const;

export type FirstDraftHeadingLevel =
  (typeof FIRST_DRAFT_HEADING_LEVELS)[number];

export function isFirstDraftHeadingLevel(
  value: unknown,
): value is FirstDraftHeadingLevel {
  return value === 1 || value === 2 || value === 3;
}

export function normalizeFirstDraftHeadingLevel(
  value: unknown,
): FirstDraftHeadingLevel {
  return isFirstDraftHeadingLevel(value) ? value : 1;
}

export function validateFirstDraftHeadingMetadata({
  metadata,
}: {
  readonly metadata: JsonObject | undefined;
}): readonly string[] {
  return metadata?.level === undefined ||
    isFirstDraftHeadingLevel(metadata.level)
    ? []
    : ["heading level must be 1, 2, or 3"];
}
