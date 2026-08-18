import { describe, expect, it } from "vitest";
import {
  cloneJsonValue,
  jsonValuesEqual,
  validateJsonObject,
} from "./json-value.ts";

describe("JSON value helpers", () => {
  it("deep-clones arrays and objects without sharing nested references", () => {
    const source = {
      marks: [{ type: "link", attrs: { href: "/docs" } }],
      count: 1,
    };
    const clone = cloneJsonValue(source);

    expect(clone).toStrictEqual(source);
    expect(clone).not.toBe(source);
    expect(clone.marks).not.toBe(source.marks);
    expect(clone.marks[0]?.attrs).not.toBe(source.marks[0]?.attrs);
  });

  it("compares JSON values structurally without considering object property order", () => {
    expect(
      jsonValuesEqual({ a: [1, true, null] }, { a: [1, true, null] }),
    ).toBe(true);
    expect(jsonValuesEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
    expect(
      jsonValuesEqual(
        { outer: { first: 1, second: { x: true, y: null } } },
        { outer: { second: { y: null, x: true }, first: 1 } },
      ),
    ).toBe(true);
    expect(
      jsonValuesEqual(
        [{ first: 1, second: { x: true, y: null } }],
        [{ second: { y: null, x: true }, first: 1 }],
      ),
    ).toBe(true);
    expect(jsonValuesEqual([1, 2], [2, 1])).toBe(false);
    expect(jsonValuesEqual({ value: null }, {})).toBe(false);
    expect(jsonValuesEqual({ value: 1 }, { value: "1" })).toBe(false);
    expect(jsonValuesEqual([1, { a: "x" }], [1, { a: "y" }])).toBe(false);
    expect(jsonValuesEqual(null, null)).toBe(true);
    expect(jsonValuesEqual(null, {})).toBe(false);
  });

  it("does not treat values outside the persisted JSON domain as equal", () => {
    const date = new Date(0);
    const sparse = new Array(1);
    const nonFinite = Number.NaN;

    expect(jsonValuesEqual(date, date)).toBe(false);
    expect(jsonValuesEqual(sparse, sparse)).toBe(false);
    expect(jsonValuesEqual(nonFinite, nonFinite)).toBe(false);
    expect(jsonValuesEqual(undefined, undefined)).toBe(false);
  });

  it("rejects prototype-related keys and clones them without prototype mutation", () => {
    const source = JSON.parse(
      '{"__proto__":{"polluted":true},"constructor":1,"prototype":2}',
    ) as Record<string, unknown>;
    const clone = cloneJsonValue(source);

    expect(validateJsonObject(source)).toHaveLength(3);
    expect(Object.prototype).not.toHaveProperty("polluted");
    expect(Object.prototype.hasOwnProperty.call(clone, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(clone)).toBe(Object.prototype);
  });
});
