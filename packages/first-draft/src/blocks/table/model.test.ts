import { describe, expect, it } from "vitest";
import {
  createFirstDraftTableColumnId,
  createFirstDraftTableColumnIds,
  normalizeFirstDraftTableColumns,
  resolveFirstDraftTableColumnIds,
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

  it("distinguishes valid stored identities from presentation fallbacks", () => {
    expect(
      resolveFirstDraftTableColumnIds(
        { columnIds: ["first-draft-column-6", "legacy-two"] },
        2,
      ),
    ).toEqual({
      kind: "canonical",
      ids: ["first-draft-column-6", "legacy-two"],
    });
    for (const columnIds of [
      undefined,
      ["", "two"],
      ["same", "same"],
      ["one"],
    ]) {
      expect(
        resolveFirstDraftTableColumnIds(
          columnIds === undefined ? {} : { columnIds },
          2,
        ),
      ).toEqual({
        kind: "synthetic-presentation",
        ids: ["column-1", "column-2"],
      });
    }
  });

  it("normalizes invalid identities while preserving unambiguous widths by position", () => {
    const candidates = ["new-one", "new-two", "new-three"];
    expect(
      normalizeFirstDraftTableColumns(
        {
          columnIds: ["duplicate", "duplicate", "unique"],
          columnWidths: { duplicate: 180, unique: 260, stale: 999 },
        },
        3,
        () => candidates.shift() ?? "exhausted",
      ),
    ).toEqual({
      columnIds: ["new-one", "new-two", "new-three"],
      columnWidths: { "new-three": 260 },
      replacedInvalidIdentities: true,
    });

    const missingCandidates = ["missing-one", "missing-two"];
    expect(
      normalizeFirstDraftTableColumns(
        {
          columnWidths: { "column-1": 200, "column-2": 240, stale: 999 },
        },
        2,
        () => missingCandidates.shift() ?? "exhausted",
      ),
    ).toEqual({
      columnIds: ["missing-one", "missing-two"],
      columnWidths: { "missing-one": 200, "missing-two": 240 },
      replacedInvalidIdentities: true,
    });
  });

  it("preserves valid legacy identities and removes invalid width entries", () => {
    expect(
      normalizeFirstDraftTableColumns(
        {
          columnIds: ["first-draft-column-6", "legacy-two"],
          columnWidths: {
            "first-draft-column-6": 180,
            "legacy-two": Number.NaN,
            stale: 400,
          },
        },
        2,
      ),
    ).toEqual({
      columnIds: ["first-draft-column-6", "legacy-two"],
      columnWidths: { "first-draft-column-6": 180 },
      replacedInvalidIdentities: false,
    });
  });
});
