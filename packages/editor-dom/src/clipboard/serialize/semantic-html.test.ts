import { describe, expect, it } from "vitest";
import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { CanonicalBlockFragment } from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import { serializeCanonicalFragmentHtml } from "./semantic-html.ts";

const wrapperId = "dom-html-wrapper" as BlockId;
const textId = "dom-html-text" as BlockId;
const atomicId = "dom-html-atomic" as BlockId;
const definitions: Readonly<Record<string, BlockDefinition>> = {
  textBlock: { kind: "text", type: "textBlock" },
  wrapperBlock: { kind: "wrapper", type: "wrapperBlock", contentBoundary: false, content: { required: [], additional: "block" } },
  atomicBlock: { kind: "atomic", type: "atomicBlock" },
};

function fragment(roots: readonly BlockId[]): CanonicalBlockFragment {
  return {
    blocks: [
      { id: wrapperId, type: "wrapperBlock", parentId: null },
      { id: textId, type: "textBlock", parentId: wrapperId, content: createBlockRichTextContentFromPlainText("textBlock", "Neutral"), plainText: "Neutral" },
      { id: atomicId, type: "atomicBlock", parentId: null },
    ],
    rootBlockIds: roots,
    start: { kind: "block", blockId: roots[0]! },
    end: { kind: "block", blockId: roots.at(-1)! },
  };
}

describe("neutral semantic HTML export", () => {
  it("consults a custom handler before generic kind fallback", () => {
    expect(serializeCanonicalFragmentHtml(fragment([wrapperId]), {
      blockDefinitions: definitions,
      htmlExportHandlers: [{
        id: "custom-handler",
        export(block, context) {
          if (block.id !== wrapperId) return null;
          const article = context.document.createElement("article");
          article.append(context.exportChildren(block.id));
          return article;
        },
      }],
    })).toBe("<article><p>Neutral</p></article>");
  });

  it("exports neutral text recursively and omits unsupported atomics", () => {
    expect(serializeCanonicalFragmentHtml(fragment([wrapperId, atomicId]), { blockDefinitions: definitions })).toBe("<p>Neutral</p>");
    expect(serializeCanonicalFragmentHtml(fragment([atomicId]), { blockDefinitions: definitions })).toBe("");
  });
});
