import { describe, expect, it } from "vitest";
import {
  filterFirstDraftPeople,
  firstDraftPeople,
  normalizeFirstDraftPersonQuery,
  readFirstDraftPerson,
} from "./people.ts";

describe("First Draft people catalog", () => {
  it("uses immutable opaque identities and returns null for unknown people", () => {
    expect(readFirstDraftPerson("person-001")?.displayName).toBe("Maya Chen");
    expect(readFirstDraftPerson("Maya Chen")).toBeNull();
    expect(readFirstDraftPerson("person-deleted")).toBeNull();
    expect(Object.isFrozen(firstDraftPeople)).toBe(true);
    expect(firstDraftPeople.every(Object.isFrozen)).toBe(true);
    expect(
      firstDraftPeople.every(({ keywords }) => Object.isFrozen(keywords)),
    ).toBe(true);
  });

  it("normalizes compatibility characters, whitespace, and case", () => {
    expect(normalizeFirstDraftPersonQuery("  ＭＡＹＡ   ChEn ")).toBe(
      "maya chen",
    );
  });

  it("returns the complete catalog in catalog order for an empty query", () => {
    expect(filterFirstDraftPeople("   ")).toEqual(firstDraftPeople);
  });

  it("ranks exact names, full-name prefixes, and word prefixes deterministically", () => {
    expect(filterFirstDraftPeople("Maya Chen").map(({ id }) => id)).toEqual([
      "person-001",
    ]);
    expect(filterFirstDraftPeople("maya c")[0]?.id).toBe("person-001");
    expect(filterFirstDraftPeople("WEB")[0]?.id).toBe("person-002");
    expect(
      filterFirstDraftPeople("ma")
        .map(({ id }) => id)
        .slice(0, 2),
    ).toEqual(["person-001", "person-004"]);
  });

  it("supports case-insensitive role, keyword, and contains fallbacks", () => {
    expect(filterFirstDraftPeople("ENGINEER")[0]?.id).toBe("person-002");
    expect(filterFirstDraftPeople("road")[0]?.id).toBe("person-004");
    expect(filterFirstDraftPeople("alyst")[0]?.id).toBe("person-005");
    expect(filterFirstDraftPeople("isha")[0]?.id).toBe("person-003");
  });
});
