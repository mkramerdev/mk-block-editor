import { describe, expect, it } from "vitest";
import type { BlockDefinition } from "./block-definition.ts";
import {
  blockDefinitionAcceptsSequence,
  resolveRestorativeDefault,
} from "./structural-queries.ts";

const renderer = () => null;
const definitions: Readonly<Record<string, BlockDefinition>> = {
  paragraph: {
    kind: "text",
    rootLayout: "normal",
    type: "paragraph",
    renderer,
    split: { default: "paragraph" },
  },
  heading: {
    kind: "text",
    rootLayout: "normal",
    type: "heading",
    renderer,
    split: { default: "paragraph" },
  },
  placeholder: {
    kind: "atomic",
    rootLayout: "normal",
    type: "placeholder",
    renderer,
    replaceWith: "paragraph",
  },
  body: {
    kind: "wrapper",
    rootLayout: "normal",
    type: "body",
    renderer,
    content: { required: ["block"], additional: "block" },
    contentBoundary: false,
    defaultContent: "placeholder",
  },
};

describe("restorative default structural semantics", () => {
  it("resolves the wrapper default atom and its editable replacement", () => {
    expect(resolveRestorativeDefault(definitions, definitions.body!)).toEqual({
      defaultType: "placeholder",
      replacementType: "paragraph",
    });
    expect(
      resolveRestorativeDefault(definitions, definitions.paragraph!),
    ).toBeNull();
  });

  it.each([
    [["placeholder"], true],
    [["paragraph"], true],
    [["paragraph", "heading"], true],
    [["placeholder", "paragraph"], false],
    [["paragraph", "placeholder"], false],
    [["placeholder", "placeholder"], false],
  ] as const)("validates the direct child sequence %j", (sequence, valid) => {
    expect(
      blockDefinitionAcceptsSequence(definitions, definitions.body!, sequence),
    ).toBe(valid);
  });
});
