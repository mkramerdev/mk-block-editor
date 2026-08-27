import { describe, expect, it } from "vitest";
import type { BlockDefinition } from "./block-definition.ts";
import {
  blockDefinitionAcceptsInsertion,
  blockDefinitionAcceptsSequence,
} from "./structural-queries.ts";

const definitions: Readonly<Record<string, BlockDefinition>> = {
  textBlock: { kind: "text", type: "textBlock" },
  alternateTextBlock: { kind: "text", type: "alternateTextBlock" },
  wrapperBlock: {
    kind: "wrapper",
    type: "wrapperBlock",
    content: { required: ["block"], additional: "block" },
    defaultContent: "textBlock",
    contentBoundary: false,
  },
  fixedWrapper: {
    kind: "wrapper",
    type: "fixedWrapper",
    content: { required: ["textBlock"] },
    contentBoundary: false,
  },
};

describe("generic structural definition queries", () => {
  it("checks opaque child sequences without product-type branches", () => {
    expect(
      blockDefinitionAcceptsSequence(definitions, definitions.wrapperBlock!, [
        "alternateTextBlock",
        "textBlock",
      ]),
    ).toBe(true);
    expect(
      blockDefinitionAcceptsSequence(definitions, definitions.fixedWrapper!, [
        "alternateTextBlock",
      ]),
    ).toBe(false);
  });

  it("checks insertion against the same generic sequence contract", () => {
    expect(
      blockDefinitionAcceptsInsertion(
        definitions,
        definitions.wrapperBlock!,
        ["textBlock"],
        1,
        "alternateTextBlock",
      ),
    ).toBe(true);
  });
});
