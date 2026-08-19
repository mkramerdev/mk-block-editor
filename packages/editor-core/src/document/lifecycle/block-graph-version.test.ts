import { describe, expect, it } from "vitest";
import {
  INITIAL_BLOCK_GRAPH_VERSION,
  assertValidBlockGraphVersion,
} from "./block-graph-version.ts";

describe("block graph version invariants", () => {
  it("accepts initial and later integer versions", () => {
    expect(() =>
      assertValidBlockGraphVersion(INITIAL_BLOCK_GRAPH_VERSION),
    ).not.toThrow();
    expect(() => assertValidBlockGraphVersion(2)).not.toThrow();
    expect(() => assertValidBlockGraphVersion(100)).not.toThrow();
  });

  it.each([
    0,
    -1,
    0.5,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ])("rejects invalid version %s", (value) => {
    expect(() => assertValidBlockGraphVersion(value)).toThrow(
      /blockGraphVersion/,
    );
  });
});
