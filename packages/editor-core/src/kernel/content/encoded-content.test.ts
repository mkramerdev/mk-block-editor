import { describe, expect, it } from "vitest";
import { EditorImmutableBinary } from "./encoded-content.ts";

describe("EditorImmutableBinary", () => {
  it("privately owns copied bytes and exposes no mutable storage alias", () => {
    const source = new Uint8Array([1, 2, 3]);
    const value = EditorImmutableBinary.copyOf(source);
    source.fill(9);

    expect(value.equalsBytes(new Uint8Array([1, 2, 3]))).toBe(true);
    expect(Reflect.set(value, "0", 7)).toBe(false);
    expect("buffer" in value).toBe(false);
    expect(Object.isFrozen(value)).toBe(true);
  });

  it("detaches transferred ownership and copies directly into an encoder destination", () => {
    const source = new Uint8Array([4, 5, 6]);
    const value = EditorImmutableBinary.takeOwnership(source);
    const destination = new Uint8Array([0, 0, 0, 0, 0]);
    value.copyInto(destination, 1);

    expect(source.byteLength).toBe(0);
    expect(destination).toEqual(new Uint8Array([0, 4, 5, 6, 0]));
    expect(
      value.equals(EditorImmutableBinary.copyOf(destination.subarray(1, 4))),
    ).toBe(true);
  });
});
