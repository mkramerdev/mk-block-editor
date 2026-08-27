import { describe, expect, it } from "vitest";
import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { CanonicalBlockFragment } from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import { serializeCanonicalFragmentHtml } from "./canonical-html-export.ts";

const wrapperId = "html-wrapper" as BlockId;
const textId = "html-text" as BlockId;
const atomicId = "html-atomic" as BlockId;
const definitions: Readonly<Record<string, BlockDefinition>> = {
  textBlock: { kind: "text", type: "textBlock" },
  wrapperBlock: { kind: "wrapper", type: "wrapperBlock", content: { required: [], additional: "block" } },
  atomicBlock: { kind: "atomic", type: "atomicBlock" },
};

function fragment(rootBlockIds: readonly BlockId[]): CanonicalBlockFragment {
  const includeWrapper = rootBlockIds.includes(wrapperId);
  const includeAtomic = rootBlockIds.includes(atomicId);
  return {
    blocks: [
      ...(includeWrapper
        ? [
            { id: wrapperId, type: "wrapperBlock", parentId: null },
            {
              id: textId,
              type: "textBlock",
              parentId: wrapperId,
              content: createBlockRichTextContentFromPlainText(
                "textBlock",
                "Neutral",
              ),
              plainText: "Neutral",
            },
          ]
        : []),
      ...(includeAtomic
        ? [{ id: atomicId, type: "atomicBlock", parentId: null }]
        : []),
    ],
    rootBlockIds,
    start: { kind: "block", blockId: rootBlockIds[0]! },
    end: { kind: "block", blockId: rootBlockIds.at(-1)! },
  };
}

describe("canonical neutral HTML export", () => {
  it("uses handlers before fallback and preserves only their declared data", () => {
    expect(serializeCanonicalFragmentHtml(fragment([wrapperId]), {
      blockDefinitions: definitions,
      inlineMarks: [],
      htmlExportHandlers: [{
        id: "custom-wrapper",
        preserveDataAttributes: ["data-custom-wrapper"],
        export(block, context) {
          if (block.id !== wrapperId) return null;
          const element = context.document.createElement("article");
          element.dataset.customWrapper = "true";
          element.dataset.editorInternal = "removed";
          element.append(context.exportChildren(block.id));
          return element;
        },
      }],
    })).toBe('<article data-custom-wrapper="true"><p>Neutral</p></article>');
  });

  it("uses neutral text, wrapper recursion, and unsupported atomic fallbacks", () => {
    expect(serializeCanonicalFragmentHtml(fragment([wrapperId, atomicId]), {
      blockDefinitions: definitions,
      inlineMarks: [],
    })).toBe("<p>Neutral</p>");
    expect(serializeCanonicalFragmentHtml(fragment([atomicId]), {
      blockDefinitions: definitions,
      inlineMarks: [],
    })).toBe("");
  });
});
