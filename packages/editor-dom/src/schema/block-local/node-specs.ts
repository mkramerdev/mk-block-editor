import type { DOMOutputSpec, NodeSpec } from "../../prosemirror/index.ts";
import { normalizeHeadingLevel } from "@repo/editor-core/document";

export type BlockTextNodeName = "paragraph" | "heading";

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
  heading: {
    content: "inline*",
    group: "block",
    defining: true,
    attrs: { level: { default: 1 } },
    parseDOM: [1, 2, 3, 4, 5, 6].map((level) => ({
      tag: `h${level}`,
      attrs: { level },
    })),
    toDOM: (node): DOMOutputSpec => {
      const level = normalizeHeadingLevel(node.attrs.level);
      return [
        `h${level}`,
        { "data-block-node": "heading", "data-level": String(level) },
        0,
      ];
    },
  },
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
