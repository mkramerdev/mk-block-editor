import { describe, expect, it } from "vitest";
import { normalizeHeadingLevel } from "./heading-level.ts";

describe("normalizeHeadingLevel", () => {
  it.each([
    [undefined, 1],
    [null, 1],
    ["2.9", 2],
    [3, 3],
    [-5, 1],
    [99, 6],
    [Number.NaN, 1],
    [Number.POSITIVE_INFINITY, 1],
  ])("normalizes %j to %i", (input, expected) => {
    expect(normalizeHeadingLevel(input)).toBe(expected);
  });
});
