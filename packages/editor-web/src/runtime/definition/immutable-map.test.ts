import { describe, expect, it } from "vitest";
import { createImmutableMap, createImmutableSet } from "./immutable-map.ts";

describe("immutable collection facades", () => {
  it("copies maps and exposes no collection mutators", () => {
    const source = new Map([["one", 1]]);
    const immutable = createImmutableMap(source);
    source.set("two", 2);

    expect([...immutable]).toStrictEqual([["one", 1]]);
    expect("set" in immutable).toBe(false);
    expect("delete" in immutable).toBe(false);
    expect("clear" in immutable).toBe(false);
  });

  it("copies sets and exposes no collection mutators", () => {
    const source = new Set(["one"]);
    const immutable = createImmutableSet(source);
    source.add("two");

    expect([...immutable]).toStrictEqual(["one"]);
    expect("add" in immutable).toBe(false);
    expect("delete" in immutable).toBe(false);
    expect("clear" in immutable).toBe(false);
  });
});
