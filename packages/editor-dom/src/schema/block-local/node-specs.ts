import type { DOMOutputSpec, NodeSpec } from "../../prosemirror/index.ts";

export const defaultBlockLocalNodeSpecs: Record<string, NodeSpec> = {
  doc: { content: "block" },
  text: { group: "inline" },
  hard_break: {
    inline: true,
    group: "inline",
    selectable: false,
    parseDOM: [{ tag: "br" }],
    toDOM: (): DOMOutputSpec => ["br"],
  },
  paragraph: textblock("p", { "data-block-node": "paragraph" }),
};

function textblock(
  tagName: string,
  attrs: Record<string, string> = {},
): NodeSpec {
  return {
    content: "inline*",
    group: "block",
    parseDOM: [{ tag: tagName }],
    toDOM: () => [tagName, attrs, 0],
  };
}
