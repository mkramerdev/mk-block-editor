import { describe, expect, it } from "vitest";
import {
  normalizeBlockMetadata,
  validateBlockMetadataFieldDeletionForDefinition,
  validateBlockMetadataFieldValueForDefinition,
  validateBlockMetadataForDefinition,
} from "./validation.ts";

describe("generic block metadata normalization", () => {
  it("returns undefined for absent metadata", () => {
    expect(normalizeBlockMetadata(undefined)).toBeUndefined();
  });

  it("returns undefined for empty metadata", () => {
    expect(normalizeBlockMetadata({})).toBeUndefined();
  });

  it("clones and preserves non-empty generic metadata", () => {
    const metadata = {
      label: " Cover ",
      icon: { id: "spark", tone: "accent" },
      flags: [true, false, null],
    };

    const normalized = normalizeBlockMetadata(metadata);

    expect(normalized).toStrictEqual(metadata);
    expect(normalized).not.toBe(metadata);
  });

  it("does not mutate input when returned metadata is changed", () => {
    const metadata = {
      attrs: { tone: "info" },
      items: [{ id: "one", enabled: true }],
    };

    const normalized = normalizeBlockMetadata(metadata);

    expect(normalized?.attrs).not.toBe(metadata.attrs);
    expect(normalized?.items).not.toBe(metadata.items);
    expect(metadata).toStrictEqual({
      attrs: { tone: "info" },
      items: [{ id: "one", enabled: true }],
    });
  });

  it("does not perform block-type-specific metadata validation", () => {
    expect(
      normalizeBlockMetadata({
        src: " javascript:alert(1) ",
        label: " Cover ",
        level: 99,
        checked: "caller-owned",
        tabId: "tab-a",
        icon: { id: "spark", tone: "accent" },
      }),
    ).toStrictEqual({
      src: " javascript:alert(1) ",
      label: " Cover ",
      level: 99,
      checked: "caller-owned",
      tabId: "tab-a",
      icon: { id: "spark", tone: "accent" },
    });
  });

  it.each([
    ["null", null, "block metadata must be a JSON object"],
    [
      "function values",
      { onClick: () => undefined },
      ".onClick must be a JSON value",
    ],
    ["symbol values", { icon: Symbol("spark") }, ".icon must be a JSON value"],
    [
      "undefined values",
      { missing: undefined },
      ".missing must be a JSON value",
    ],
    ["NaN", { count: Number.NaN }, ".count must be a finite JSON number"],
    [
      "Infinity",
      { count: Number.POSITIVE_INFINITY },
      ".count must be a finite JSON number",
    ],
    [
      "root class instances",
      new (class InvalidMetadata {
        readonly tone = "info";
      })(),
      "block metadata must be a JSON object",
    ],
    [
      "nested class instances",
      {
        nested: new (class InvalidNestedMetadata {
          readonly tone = "info";
        })(),
      },
      ".nested must be a JSON value",
    ],
  ])("rejects %s", (_name, value, expectedError) => {
    expect(() => normalizeBlockMetadata(value)).toThrow(expectedError);
  });

  it("rejects circular metadata", () => {
    const metadata: Record<string, unknown> = {};
    metadata.self = metadata;

    expect(() => normalizeBlockMetadata(metadata)).toThrow(
      ".self must not contain circular references",
    );
  });

  it("rejects symbol-keyed metadata", () => {
    const metadata: Record<string | symbol, unknown> = { icon: "spark" };
    metadata[Symbol("hidden")] = "ignored";

    expect(() => normalizeBlockMetadata(metadata)).toThrow(
      "block metadata[Symbol(hidden)] must not use a symbol key",
    );
  });
});

describe("author-owned block data validation", () => {
  const definition = {
    type: "asset",
    data: { productSpecific: true },
  };

  it("accepts arbitrary durable metadata keys without enumerating product fields", () => {
    expect(
      validateBlockMetadataForDefinition(
        { title: "Cover", extra: true },
        definition,
      ),
    ).toStrictEqual([]);
    expect(validateBlockMetadataForDefinition({}, definition)).toStrictEqual(
      [],
    );
    expect(
      validateBlockMetadataFieldValueForDefinition(1.5, "count"),
    ).toStrictEqual([]);
  });

  it("rejects non-durable JSON values in json metadata fields", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(
      validateBlockMetadataFieldValueForDefinition(circular, "payload"),
    ).toContain("payload.self must not contain circular references");
    expect(
      validateBlockMetadataFieldValueForDefinition(
        { bad: undefined },
        "payload",
      ),
    ).toContain("payload.bad must be a JSON value");
  });

  it("does not attach ownership semantics to field deletion", () => {
    expect(validateBlockMetadataFieldDeletionForDefinition()).toStrictEqual([]);
  });
});
