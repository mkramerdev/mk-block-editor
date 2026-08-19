import { describe, expect, it } from "vitest";
import { applyLogicalContentOperationToRichTextDocument } from "./content-operations.ts";
import { rebaseLogicalContentOperationByExpectedContent } from "./content-rebase.ts";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import type { BlockType } from "../../document/model/block.ts";
import { contentSelection } from "../../selection/block-selection.ts";
import { boldMarkDefinition } from "../marks/schema.ts";
import { asBlockId } from "../../kernel/identity/uuid.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000000101");
const blockDefinitions: Readonly<Record<BlockType, BlockDefinition>> = {
  paragraph: {
    type: "paragraph",
    kind: "text",
    rootLayout: "normal",
    selection: contentSelection(),
  },
};
const applyOptions = { blockDefinitions, inlineMarks: [boldMarkDefinition] };

describe("logical rich content rebase", () => {
  it("relocates expected deleted content only through the explicit rebase helper", () => {
    const current = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "R" },
            { type: "text", text: "abc", marks: [{ type: "strong" }] },
          ],
        },
      ],
    };
    const operation = {
      kind: "deleteInlineRange",
      blockId,
      blockType: "paragraph",
      target: { kind: "text" },
      range: { from: { blockId, offset: 0 }, to: { blockId, offset: 3 } },
      deletedContent: [
        { type: "text", text: "abc", marks: [{ type: "strong" }] },
      ],
    } as const;

    expect(
      applyLogicalContentOperationToRichTextDocument(
        "paragraph",
        current,
        operation,
        applyOptions,
      ),
    ).toBeNull();

    const rebased = rebaseLogicalContentOperationByExpectedContent(
      "paragraph",
      current,
      operation,
    );
    expect(rebased).toMatchObject({
      range: { from: { offset: 1 }, to: { offset: 4 } },
    });
    expect(
      applyLogicalContentOperationToRichTextDocument(
        "paragraph",
        current,
        rebased!,
        applyOptions,
      ),
    ).toStrictEqual({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "R" }] }],
    });
  });
});
