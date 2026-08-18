import { describe, expect, it } from "vitest";
import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { CanonicalBlockFragment } from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import { serializeCanonicalFragmentHtml } from "./canonical-html-export.ts";

describe("canonical semantic HTML export", () => {
  it("preserves only handler-declared semantic data attributes", () => {
    const listId = "html-list" as BlockId;
    const textId = "html-text" as BlockId;
    const definitions: Readonly<Record<string, BlockDefinition>> = {
      paragraph: { kind: "text", type: "paragraph", rootLayout: "normal" },
      semanticList: {
        kind: "wrapper",
        type: "semanticList",
        rootLayout: "normal",
        contentBoundary: false,
        content: { required: ["paragraph"], additional: "paragraph" },
      },
    };
    const fragment: CanonicalBlockFragment = {
      blocks: [
        { id: listId, type: "semanticList", parentId: null },
        {
          id: textId,
          type: "paragraph",
          parentId: listId,
          content: createBlockRichTextContentFromPlainText("paragraph", "Task"),
          plainText: "Task",
        },
      ],
      rootBlockIds: [listId],
      start: { kind: "block", blockId: listId },
      end: { kind: "block", blockId: listId },
    };

    expect(
      serializeCanonicalFragmentHtml(fragment, {
        blockDefinitions: definitions,
        inlineMarks: [],
        htmlExportHandlers: [
          {
            id: "semantic-list",
            preserveDataAttributes: ["data-semantic-list"],
            export(block, context) {
              if (block.type !== "semanticList") return null;
              const list = context.document.createElement("ul");
              list.dataset.semanticList = "true";
              list.dataset.editorBlockId = block.id;
              list.append(context.exportChildren(block.id));
              return list;
            },
          },
        ],
      }),
    ).toBe('<ul data-semantic-list="true"><p>Task</p></ul>');
  });
});
