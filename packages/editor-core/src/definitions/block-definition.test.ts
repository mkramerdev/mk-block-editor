import { describe, expect, it } from "vitest";
import type { BlockDefinition } from "./block-definition.ts";
import {
  assertValidBlockDefinition,
  assertValidBlockDefinitions,
} from "./validation.ts";

const definitions: Readonly<Record<string, BlockDefinition>> = {
  textBlock: { kind: "text", type: "textBlock", defaultMetadata: { tone: "neutral" } },
  atomicBlock: { kind: "atomic", type: "atomicBlock" },
  wrapperBlock: {
    kind: "wrapper",
    type: "wrapperBlock",
    content: { required: ["block"], additional: "block" },
    defaultContent: "textBlock",
    contentBoundary: false,
  },
  childTextBlock: {
    kind: "text",
    type: "childTextBlock",
    parents: { allowed: ["wrapperBlock"] },
  },
};

describe("product-neutral block definition validation", () => {
  it("accepts text, atomic, and wrapper definitions with generic constraints", () => {
    expect(assertValidBlockDefinitions(definitions)).toBeUndefined();
  });

  it("rejects presentation and product-policy fields", () => {
    for (const field of [
      "renderer",
      "rootLayout",
      "split",
      "list",
      "conversion",
      "replaceWith",
      "underflow",
      "compound",
      "rangeDeletion",
    ]) {
      expect(() =>
        assertValidBlockDefinition("textBlock", {
          ...definitions.textBlock!,
          [field]: {},
        } as BlockDefinition),
      ).toThrow(`unsupported field ${field}`);
    }
  });

  it("requires wrapper-only fields to remain on wrappers", () => {
    expect(() =>
      assertValidBlockDefinition("textBlock", {
        ...definitions.textBlock!,
        content: { required: ["block"] },
      } as BlockDefinition),
    ).toThrow("text block definition textBlock must not declare content");
  });

  it("validates metadata, parent references, and terminating defaults", () => {
    expect(() =>
      assertValidBlockDefinitions({
        textBlock: definitions.textBlock!,
        childTextBlock: {
          ...definitions.childTextBlock!,
          parents: { allowed: ["missingWrapper"] },
        },
      }),
    ).toThrow("must be an available wrapper");
    expect(() =>
      assertValidBlockDefinitions({
        recursiveWrapper: {
          kind: "wrapper",
          type: "recursiveWrapper",
          content: { required: ["block"] },
          defaultContent: "recursiveWrapper",
          contentBoundary: false,
        },
      }),
    ).toThrow("recursive defaultContent cycle");
  });
});
