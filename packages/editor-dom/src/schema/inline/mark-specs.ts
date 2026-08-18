import type { InlineMarkDefinition } from "@repo/editor-core/content/marks";
import type { DOMOutputSpec, MarkSpec } from "../../prosemirror/index.ts";
import { inlineMarkDomAdapters } from "./dom-adapters.ts";

export function createInlineMarkSpecs(
  definitions: readonly InlineMarkDefinition[] = [],
): Record<string, MarkSpec> {
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.name,
      createInlineMarkSpec(definition),
    ]),
  );
}

function createInlineMarkSpec(definition: InlineMarkDefinition): MarkSpec {
  const adapter = inlineMarkDomAdapters[definition.name];
  const base: MarkSpec = {
    inclusive: definition.inclusive,
    excludes: definition.excludes,
    attrs:
      Object.keys(definition.attrs).length > 0
        ? Object.fromEntries(
            Object.entries(definition.attrs).map(([name, contract]) => [
              name,
              { default: contract.default },
            ]),
          )
        : undefined,
    parseDOM: adapter.parseDOM(definition),
    toDOM: (mark): DOMOutputSpec => adapter.toDOM(definition, mark.attrs),
  };
  if (definition.code) base.code = true;
  return base;
}
