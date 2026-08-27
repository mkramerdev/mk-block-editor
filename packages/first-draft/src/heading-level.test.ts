import { describe, expect, it } from "vitest";
import {
  FIRST_DRAFT_HEADING_LEVELS,
  isFirstDraftHeadingLevel,
  normalizeFirstDraftHeadingLevel,
  validateFirstDraftHeadingMetadata,
} from "./heading-level.ts";

describe("First Draft heading levels", () => {
  it("defines exactly the three supported ordinary and toggle-heading levels", () => {
    expect(FIRST_DRAFT_HEADING_LEVELS).toEqual([1, 2, 3]);
    expect(FIRST_DRAFT_HEADING_LEVELS.every(isFirstDraftHeadingLevel)).toBe(
      true,
    );
  });

  it("normalizes missing presentation metadata without accepting unsupported levels", () => {
    expect(normalizeFirstDraftHeadingLevel(undefined)).toBe(1);
    expect(normalizeFirstDraftHeadingLevel(2)).toBe(2);
    expect(normalizeFirstDraftHeadingLevel(99)).toBe(1);
    expect(normalizeFirstDraftHeadingLevel("2")).toBe(1);
  });

  it("rejects unsupported canonical heading metadata", () => {
    expect(validateFirstDraftHeadingMetadata({ metadata: undefined })).toEqual(
      [],
    );
    expect(
      validateFirstDraftHeadingMetadata({ metadata: { level: 3 } }),
    ).toEqual([]);
    expect(
      validateFirstDraftHeadingMetadata({ metadata: { level: 99 } }),
    ).toEqual(["heading level must be 1, 2, or 3"]);
  });
});
