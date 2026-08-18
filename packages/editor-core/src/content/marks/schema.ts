import type {
  InlineAttributeContract,
  InlineAttributePrimitive,
} from "../rich-text/inline-attributes.ts";
import {
  isInlineAttributePrimitive,
  richTextContexts,
  sanitizeInlineAttrValue,
} from "../rich-text/inline-attributes.ts";
import type { InlineMarkDefinition, InlineMarkName } from "./types.ts";

const textBlockPolicy = {
  requireText: true,
} as const satisfies InlineMarkDefinition["blockPolicy"];

const noAttrs = {} as const satisfies Readonly<
  Record<string, InlineAttributeContract>
>;
const noDefaults = {} as const satisfies Readonly<
  Record<string, InlineAttributePrimitive>
>;

function booleanMark(input: {
  name: Exclude<InlineMarkName, "link">;
  code?: boolean;
  blockPolicy?: InlineMarkDefinition["blockPolicy"];
}): InlineMarkDefinition {
  const commandId = `inline.mark.${input.name}.toggle`;
  return {
    name: input.name,
    valueKind: "boolean",
    attrs: noAttrs,
    defaultAttrs: noDefaults,
    contexts: richTextContexts,
    blockPolicy: input.blockPolicy ?? textBlockPolicy,
    inclusive: true,
    code: input.code,
    command: { id: commandId, kind: "toggle-mark" },
  };
}

export type { InlineMarkName };

export const boldMarkDefinition = booleanMark({ name: "strong" });
export const italicMarkDefinition = booleanMark({ name: "em" });
export const codeMarkDefinition = booleanMark({ name: "code", code: true });
export const linkMarkDefinition = {
  name: "link",
  valueKind: "value",
  attrs: {
    href: { default: "", required: true, sanitize: "safe-url" },
    title: { default: null, sanitize: "string" },
    target: { default: null, sanitize: "string" },
  },
  defaultAttrs: { href: "", title: null, target: null },
  contexts: richTextContexts,
  blockPolicy: textBlockPolicy,
  inclusive: false,
  command: { id: "inline.mark.link.set", kind: "set-mark-value" },
} as const satisfies InlineMarkDefinition<"link">;
export const underlineMarkDefinition = booleanMark({ name: "underline" });
export const strikethroughMarkDefinition = booleanMark({
  name: "strikethrough",
});

export const primitiveInlineMarkDefinitions = [
  boldMarkDefinition,
  italicMarkDefinition,
  codeMarkDefinition,
  linkMarkDefinition,
  underlineMarkDefinition,
  strikethroughMarkDefinition,
] as const satisfies readonly InlineMarkDefinition[];

export const inlineMarkDefinitionByName = Object.freeze(
  Object.fromEntries(
    primitiveInlineMarkDefinitions.map((definition) => [
      definition.name,
      definition,
    ]),
  ),
) as Readonly<Record<InlineMarkName, InlineMarkDefinition>>;

export function findInlineMarkDefinition(
  inlineMarks: readonly InlineMarkDefinition[],
  markName: InlineMarkName,
): InlineMarkDefinition | null {
  return inlineMarks.find((definition) => definition.name === markName) ?? null;
}

export function isInlineMarkName(value: unknown): value is InlineMarkName {
  return (
    typeof value === "string" &&
    Object.prototype.hasOwnProperty.call(inlineMarkDefinitionByName, value)
  );
}

export function sanitizeInlineMarkAttrs(
  definition: InlineMarkDefinition,
  attrs: Readonly<Record<string, unknown>> | null | undefined,
): Record<string, InlineAttributePrimitive> | null {
  const sanitized: Record<string, InlineAttributePrimitive> = {};
  for (const [attrName, contract] of Object.entries(definition.attrs)) {
    const rawValue =
      attrs?.[attrName] ??
      definition.defaultAttrs[attrName] ??
      contract.default;
    const value = sanitizeInlineAttrValue(rawValue, contract);
    if (value === null && contract.required) return null;
    if (!isInlineAttributePrimitive(value)) return null;
    sanitized[attrName] = value;
  }
  return sanitized;
}
