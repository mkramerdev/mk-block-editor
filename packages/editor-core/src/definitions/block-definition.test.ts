import { describe, expect, it } from "vitest";
import type { BlockType } from "../document/model/block.ts";
import type { BlockDefinition } from "./block-definition.ts";
import {
  assertValidBlockDefinition,
  assertValidBlockDefinitions,
} from "./validation.ts";

const paragraphDefinition: BlockDefinition = {
  kind: "text",
  type: "paragraph",
  rootLayout: "normal",
  split: { default: "paragraph" },
};

const quoteDefinition: BlockDefinition = {
  kind: "wrapper",
  type: "quote",
  rootLayout: "normal",
  content: { required: ["paragraph"] },
  contentBoundary: false,
};

const validBlockDefinitions: Readonly<Record<BlockType, BlockDefinition>> = {
  paragraph: paragraphDefinition,
  quote: quoteDefinition,
};

describe("block definition validation", () => {
  it("accepts valid definitions without replacing their objects", () => {
    expect(assertValidBlockDefinitions(validBlockDefinitions)).toBeUndefined();
    expect(validBlockDefinitions.paragraph).toBe(paragraphDefinition);
    expect(validBlockDefinitions.quote).toBe(quoteDefinition);
  });

  it("rejects a collection key and type mismatch", () => {
    expect(() =>
      assertValidBlockDefinitions({ other: paragraphDefinition }),
    ).toThrow("must declare matching type other");
  });

  it("rejects a non-object definition", () => {
    expect(() =>
      assertValidBlockDefinition(
        "paragraph",
        null as unknown as BlockDefinition,
      ),
    ).toThrow("must be an object");
  });

  it("rejects an invalid kind", () => {
    expect(() =>
      assertValidBlockDefinition("paragraph", {
        ...paragraphDefinition,
        kind: "other",
      } as unknown as BlockDefinition),
    ).toThrow("kind must be text, atomic, or wrapper");
  });

  it("rejects an invalid root layout", () => {
    expect(() =>
      assertValidBlockDefinition("paragraph", {
        ...paragraphDefinition,
        rootLayout: "wide",
      } as unknown as BlockDefinition),
    ).toThrow("rootLayout must be the string normal or full");
  });

  it("accepts an opaque platform renderer slot without importing its type", () => {
    const renderer = () => null;
    expect(
      assertValidBlockDefinition("paragraph", {
        ...paragraphDefinition,
        renderer,
      } as unknown as BlockDefinition),
    ).toBeUndefined();
  });

  it("validates definition-owned conversion metadata behavior", () => {
    expect(() =>
      assertValidBlockDefinition("paragraph", {
        ...paragraphDefinition,
        conversion: { metadata: "target-defaults" },
      }),
    ).not.toThrow();
    expect(() =>
      assertValidBlockDefinition("paragraph", {
        ...paragraphDefinition,
        conversion: { metadata: "preserve" },
      } as unknown as BlockDefinition),
    ).toThrow("conversion must declare metadata target-defaults");
  });

  it("rejects unsupported fields", () => {
    expect(() =>
      assertValidBlockDefinition("paragraph", {
        ...paragraphDefinition,
        unsupportedField: true,
      } as BlockDefinition),
    ).toThrow("contains unsupported field unsupportedField");
  });

  it("rejects fields owned by another kind", () => {
    expect(() =>
      assertValidBlockDefinition("paragraph", {
        ...paragraphDefinition,
        replaceWith: "paragraph",
      }),
    ).toThrow("text block definition paragraph must not declare replaceWith");
  });

  it("requires wrapper content", () => {
    expect(() =>
      assertValidBlockDefinition("quote", {
        kind: "wrapper",
        type: "quote",
        rootLayout: "normal",
        contentBoundary: false,
      }),
    ).toThrow("must declare content");
  });

  it("requires wrapper contentBoundary to be boolean", () => {
    expect(() =>
      assertValidBlockDefinition("quote", {
        ...quoteDefinition,
        contentBoundary: undefined,
      }),
    ).toThrow("must declare boolean contentBoundary");
  });

  it("requires at least one wrapper child", () => {
    expect(() =>
      assertValidBlockDefinition("quote", {
        ...quoteDefinition,
        content: { required: [] },
      }),
    ).toThrow("must require at least one child");
  });

  it("rejects an unavailable wrapper child type", () => {
    expect(() =>
      assertValidBlockDefinitions({
        paragraph: paragraphDefinition,
        quote: {
          ...quoteDefinition,
          content: { required: ["missing"] },
        },
      }),
    ).toThrow("content type missing is not available");
  });

  it("requires a default split result", () => {
    expect(() =>
      assertValidBlockDefinitions({
        paragraph: { ...paragraphDefinition, split: { quote: "paragraph" } },
        quote: quoteDefinition,
      }),
    ).toThrow("must declare a default split result");
  });

  it("requires split parents to be wrappers", () => {
    expect(() =>
      assertValidBlockDefinitions({
        paragraph: {
          ...paragraphDefinition,
          split: { default: "paragraph", paragraph: "paragraph" },
        },
      }),
    ).toThrow("split parent type paragraph is not a wrapper");
  });

  it("requires atomic replacements to have text behavior", () => {
    const atom: BlockDefinition = {
      kind: "atomic",
      type: "atom",
      rootLayout: "normal",
      replaceWith: "quote",
    };
    expect(() =>
      assertValidBlockDefinitions({
        paragraph: paragraphDefinition,
        quote: quoteDefinition,
        atom,
      }),
    ).toThrow("replaceWith type quote is not text");
  });

  it("requires defaultContent to initialize the wrapper minimum", () => {
    expect(() =>
      assertValidBlockDefinitions({
        paragraph: paragraphDefinition,
        quote: { ...quoteDefinition, defaultContent: "other" },
        other: { ...paragraphDefinition, type: "other", split: undefined },
      }),
    ).toThrow("does not initialize its required minimum");
  });

  it("rejects invalid underflow child behavior", () => {
    const columns: BlockDefinition = {
      kind: "wrapper",
      type: "columns",
      rootLayout: "normal",
      content: { required: ["paragraph", "paragraph"] },
      contentBoundary: false,
      underflow: { kind: "promote-single-child-contents" },
    };
    expect(() =>
      assertValidBlockDefinitions({ paragraph: paragraphDefinition, columns }),
    ).toThrow("underflow child type paragraph must be a wrapper");
  });

  it("validates compound-wrapper child roles declaratively", () => {
    const body: BlockDefinition = {
      kind: "wrapper",
      type: "body",
      rootLayout: "normal",
      content: { required: ["paragraph"], additional: "paragraph" },
      contentBoundary: false,
    };
    const compound: BlockDefinition = {
      kind: "wrapper",
      type: "compound",
      rootLayout: "normal",
      content: { required: ["paragraph", "body"] },
      contentBoundary: false,
      compound: {
        kind: "primary-text-with-promoted-content",
        primaryTextChildType: "paragraph",
        contentWrapperChildType: "body",
        emptyPrimary: "remove-wrapper",
      },
    };
    expect(() =>
      assertValidBlockDefinitions({
        paragraph: paragraphDefinition,
        body,
        compound,
      }),
    ).not.toThrow();
    expect(() =>
      assertValidBlockDefinitions({
        paragraph: paragraphDefinition,
        body,
        compound: {
          ...compound,
          compound: {
            ...compound.compound!,
            contentWrapperChildType: "paragraph",
          },
        },
      }),
    ).toThrow("compound policy must match its two required children");
  });

  it("validates typed list containers, item parents, and primary split mappings", () => {
    const definitions: Readonly<Record<BlockType, BlockDefinition>> = {
      paragraph: {
        ...paragraphDefinition,
        split: { default: "paragraph", item: "item" },
      },
      list: {
        kind: "wrapper",
        type: "list",
        rootLayout: "normal",
        content: { required: ["item"], additional: "item" },
        contentBoundary: false,
        defaultContent: "item",
        list: { kind: "container", itemType: "item" },
      },
      item: {
        kind: "wrapper",
        type: "item",
        rootLayout: "normal",
        content: { required: ["paragraph"], additional: "block" },
        contentBoundary: false,
        parents: { allowed: ["list"] },
        list: {
          kind: "item",
          containerType: "list",
          primaryTextChildType: "paragraph",
          emptyEnter: "lift-primary-out-of-container",
        },
      },
    };
    expect(() => assertValidBlockDefinitions(definitions)).not.toThrow();
    expect(() =>
      assertValidBlockDefinitions({
        ...definitions,
        item: {
          ...definitions.item!,
          parents: { allowed: ["item"] },
        },
      }),
    ).toThrow("must allow only parent list");
  });

  it("rejects recursive required construction", () => {
    const recursive: BlockDefinition = {
      kind: "wrapper",
      type: "recursive",
      rootLayout: "normal",
      content: { required: ["recursive"] },
      contentBoundary: false,
    };
    expect(() => assertValidBlockDefinitions({ recursive })).toThrow(
      "nonterminating required content cycle includes recursive",
    );
  });
});
