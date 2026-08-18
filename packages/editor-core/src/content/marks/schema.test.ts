import { describe, expect, it } from "vitest";
import {
  boldMarkDefinition,
  codeMarkDefinition,
  findInlineMarkDefinition,
  inlineMarkDefinitionByName,
  isInlineMarkName,
  italicMarkDefinition,
  linkMarkDefinition,
  primitiveInlineMarkDefinitions,
  sanitizeInlineMarkAttrs,
  strikethroughMarkDefinition,
  underlineMarkDefinition,
} from "./schema.ts";

describe("inline mark schema definitions", () => {
  it("owns explicit reusable mark contracts in the model layer", () => {
    expect(
      primitiveInlineMarkDefinitions.map((definition) => definition.name),
    ).toStrictEqual([
      "strong",
      "em",
      "code",
      "link",
      "underline",
      "strikethrough",
    ]);
    expect(inlineMarkDefinitionByName).toMatchObject({
      strong: boldMarkDefinition,
      em: italicMarkDefinition,
      code: codeMarkDefinition,
      link: linkMarkDefinition,
      underline: underlineMarkDefinition,
      strikethrough: strikethroughMarkDefinition,
    });

    for (const definition of primitiveInlineMarkDefinitions) {
      expect(definition.command.id).toContain(definition.name);
      expect(definition.contexts).toContain("text");
      expect(definition.contexts).toStrictEqual(["text"]);
      expect(definition.blockPolicy.requireText).toBe(true);
      expect("clipboard" in definition).toBe(false);
      expect("toolbar" in definition).toBe(false);
      expect("menu" in definition).toBe(false);
      expect("keybindings" in definition).toBe(false);
      expect("valueEditor" in definition).toBe(false);
    }

    expect(linkMarkDefinition).toMatchObject({
      valueKind: "value",
      command: { id: "inline.mark.link.set", kind: "set-mark-value" },
      attrs: {
        href: expect.objectContaining({ required: true, sanitize: "safe-url" }),
        title: expect.objectContaining({ default: null, sanitize: "string" }),
        target: expect.objectContaining({ default: null, sanitize: "string" }),
      },
    });
  });

  it("sanitizes value-bearing marks from their definition contract", () => {
    expect(
      sanitizeInlineMarkAttrs(linkMarkDefinition, {
        href: " javascript:alert(1) ",
      }),
    ).toBeNull();
    expect(
      sanitizeInlineMarkAttrs(linkMarkDefinition, {
        href: "https://example.test",
        title: 42,
      }),
    ).toStrictEqual({
      href: "https://example.test",
      title: "42",
      target: null,
    });
  });

  it("exposes exact lookup helpers", () => {
    expect(
      findInlineMarkDefinition(primitiveInlineMarkDefinitions, "strong"),
    ).toStrictEqual(boldMarkDefinition);
    expect(
      findInlineMarkDefinition([italicMarkDefinition], "strong"),
    ).toBeNull();
    expect(isInlineMarkName("strong")).toBe(true);
    expect(isInlineMarkName("unknown")).toBe(false);
    expect(
      sanitizeInlineMarkAttrs(boldMarkDefinition, undefined),
    ).toStrictEqual({});
    expect(sanitizeInlineMarkAttrs(boldMarkDefinition, undefined)).not.toBe(
      boldMarkDefinition.defaultAttrs,
    );
  });
});
