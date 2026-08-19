import { describe, expect, it } from "vitest";
import {
  createFirstDraftTableColumnId,
  createFirstDraftTableColumnIds,
} from "./model.ts";

describe("First Draft table column identities", () => {
  it("retries duplicate and empty metadata identities", () => {
    const candidates = ["existing", "", "new-column"];

    expect(
      createFirstDraftTableColumnId(
        ["existing"],
        () => candidates.shift() ?? "new-column",
      ),
    ).toBe("new-column");
  });

  it("allocates a unique set even when the identity source repeats", () => {
    const candidates = ["a", "a", "b", "b", "c"];

    expect(
      createFirstDraftTableColumnIds(3, () => candidates.shift() ?? "c"),
    ).toEqual(["a", "b", "c"]);
  });

  it("fails clearly when the bounded identity source is exhausted", () => {
    expect(() =>
      createFirstDraftTableColumnId(["duplicate"], () => "duplicate"),
    ).toThrow("unable to allocate a unique table column id");
  });
});
