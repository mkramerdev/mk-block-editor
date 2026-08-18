import {
  sanitizeInlineMarkAttrs,
  type InlineMarkName,
} from "@repo/editor-core/content/marks";
import type { InlineMarkDefinition } from "@repo/editor-core/content/marks";
import type { DOMOutputSpec, MarkSpec } from "../../prosemirror/index.ts";

export interface InlineMarkDomAdapter {
  parseDOM(definition: InlineMarkDefinition): MarkSpec["parseDOM"];
  toDOM(
    definition: InlineMarkDefinition,
    attrs: Readonly<Record<string, unknown>>,
  ): DOMOutputSpec;
}

export const inlineMarkDomAdapters = {
  strong: {
    parseDOM: () => [
      { tag: "strong" },
      { tag: "b", getAttrs: () => null },
      {
        style: "font-weight",
        getAttrs: (value) => (isBoldFontWeight(value) ? null : false),
      },
    ],
    toDOM: () => ["strong", 0],
  },
  em: {
    parseDOM: () => [
      { tag: "em" },
      { tag: "i", getAttrs: () => null },
      {
        style: "font-style",
        getAttrs: (value) =>
          String(value).toLowerCase() === "italic" ? null : false,
      },
    ],
    toDOM: () => ["em", 0],
  },
  code: {
    parseDOM: () => [{ tag: "code" }],
    toDOM: () => ["code", 0],
  },
  link: {
    parseDOM: (definition) => [
      {
        tag: "a[href]",
        getAttrs: (node) => {
          if (!(node instanceof HTMLElement)) return false;
          return (
            sanitizeInlineMarkAttrs(definition, {
              href: node.getAttribute("href") ?? "",
              title: node.getAttribute("title"),
            }) ?? false
          );
        },
      },
    ],
    toDOM: (definition, attrs) => {
      const sanitized = sanitizeInlineMarkAttrs(definition, attrs);
      const href = sanitized?.href;
      return [
        "a",
        {
          href: typeof href === "string" ? href : "",
          title:
            typeof sanitized?.title === "string" ? sanitized.title : undefined,
          rel: "noopener noreferrer",
        },
        0,
      ];
    },
  },
  underline: {
    parseDOM: () => [
      { tag: "u" },
      {
        style: "text-decoration",
        getAttrs: (value) =>
          String(value).toLowerCase().includes("underline") ? null : false,
      },
    ],
    toDOM: () => ["u", 0],
  },
  strikethrough: {
    parseDOM: () => [
      { tag: "s" },
      { tag: "del" },
      {
        style: "text-decoration",
        getAttrs: (value) =>
          String(value).toLowerCase().includes("line-through") ? null : false,
      },
    ],
    toDOM: () => ["s", 0],
  },
} satisfies Record<InlineMarkName, InlineMarkDomAdapter>;

function isBoldFontWeight(value: unknown): boolean {
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "bold" || normalized === "bolder") return true;
  const numeric = Number.parseInt(normalized, 10);
  return Number.isFinite(numeric) && numeric >= 500;
}
