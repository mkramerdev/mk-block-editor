import type { NodeSpec } from "../../prosemirror/index.ts";

export function createInlineAtomNodeSpecs(
  definitions: readonly { readonly type: string }[],
): Record<string, NodeSpec> {
  return Object.fromEntries(
    definitions.map((definition) => [
      definition.type,
      createInlineAtomNodeSpec(definition),
    ]),
  );
}

export function createInlineAtomNodeSpec(
  definition: { readonly type: string },
): NodeSpec {
  return {
    inline: true,
    group: "inline",
    atom: true,
    selectable: true,
    attrs: {
      metadata: {},
    },
    leafText: () => "\uFFFC",
    toDOM: () => [
      "span",
      {
        "data-inline-atom-type": definition.type,
      },
    ],
  };
}
