import { describe, expect, it } from "vitest";
import {
  applyLogicalContentOperationToRichTextDocument,
  createInverseLogicalContentOperation,
  isValidPlainTextOperation,
  validateLogicalContentOperation,
} from "./content-operations.ts";
import { contentSelection } from "../../selection/block-selection.ts";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import {
  boldMarkDefinition,
  italicMarkDefinition,
  linkMarkDefinition,
} from "../marks/schema.ts";
import { asBlockId } from "../../kernel/identity/uuid.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000000101");
const testBlockDefinitions: Readonly<Record<BlockType, BlockDefinition>> = {
  paragraph: {
    type: "paragraph",
    kind: "text",
    selection: contentSelection(),
    root: false,
  },
};
const testInlineMarks = [
  boldMarkDefinition,
  italicMarkDefinition,
  linkMarkDefinition,
] as const;
const applyOptions = {
  blockDefinitions: testBlockDefinitions,
  inlineMarks: testInlineMarks,
};

describe("logical rich content operations", () => {
  it("recognizes the exact plain-text delete and replace shapes", () => {
    const range = {
      from: { blockId, offset: 1 },
      to: { blockId, offset: 2 },
    };

    expect(
      isValidPlainTextOperation({
        kind: "deleteInlineRange",
        blockId,
        blockType: "paragraph",
        target: { kind: "text" },
        range,
      }),
    ).toBe(true);
    expect(
      isValidPlainTextOperation({
        kind: "replaceInlineRange",
        blockId,
        blockType: "paragraph",
        target: { kind: "text" },
        range,
        content: [{ type: "text", text: "x" }],
      }),
    ).toBe(true);
  });

  it("creates inverses for exact delete and replace operations", () => {
    const before = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello" }] },
      ],
    };
    const after = {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
    };

    const operation = {
      kind: "replaceInlineRange" as const,
      blockId,
      blockType: "paragraph",
      target: { kind: "text" as const },
      range: {
        from: { blockId, offset: 1 },
        to: { blockId, offset: 5 },
      },
      content: [{ type: "text" as const, text: "i" }],
      deletedContent: [{ type: "text" as const, text: "ello" }],
    };
    expect(operation).toStrictEqual({
      kind: "replaceInlineRange",
      blockId,
      blockType: "paragraph",
      target: { kind: "text" },
      range: {
        from: { blockId, offset: 1 },
        to: { blockId, offset: 5 },
      },
      content: [{ type: "text", text: "i" }],
      deletedContent: [{ type: "text", text: "ello" }],
    });

    const inverse = createInverseLogicalContentOperation(operation!);
    expect(inverse).toStrictEqual({
      kind: "replaceInlineRange",
      blockId,
      blockType: "paragraph",
      target: { kind: "text" },
      range: {
        from: { blockId, offset: 1 },
        to: { blockId, offset: 2 },
      },
      content: [{ type: "text", text: "ello" }],
      deletedContent: [{ type: "text", text: "i" }],
    });
    expect(
      applyLogicalContentOperationToRichTextDocument(
        "paragraph",
        after,
        inverse!,
        applyOptions,
      ),
    ).toStrictEqual(before);
    expect(inverse?.kind === "replaceInlineRange" && inverse.content).toBe(
      operation.deletedContent,
    );
    expect(
      inverse?.kind === "replaceInlineRange" && inverse.deletedContent,
    ).toBe(operation.content);
  });

  it("returns null for invalid non-rich input instead of normalizing it to empty rich text", () => {
    const operation = {
      kind: "insertInlineContent",
      blockId,
      blockType: "paragraph",
      target: { kind: "text" },
      position: { blockId, offset: 0 },
      content: [{ type: "text", text: "A" }],
    } as const;

    expect(
      applyLogicalContentOperationToRichTextDocument(
        "paragraph",
        { tabs: [] },
        operation,
        applyOptions,
      ),
    ).toBeNull();
  });

  it("does not relocate stale delete or replace ranges inside exact apply", () => {
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
    const deleteOperation = {
      kind: "deleteInlineRange",
      blockId,
      blockType: "paragraph",
      target: { kind: "text" },
      range: { from: { blockId, offset: 0 }, to: { blockId, offset: 3 } },
      deletedContent: [
        { type: "text", text: "abc", marks: [{ type: "strong" }] },
      ],
    } as const;
    const replaceOperation = {
      ...deleteOperation,
      kind: "replaceInlineRange",
      content: [{ type: "text", text: "z" }],
    } as const;

    expect(
      applyLogicalContentOperationToRichTextDocument(
        "paragraph",
        current,
        deleteOperation,
        applyOptions,
      ),
    ).toBeNull();
    expect(
      applyLogicalContentOperationToRichTextDocument(
        "paragraph",
        current,
        replaceOperation,
        applyOptions,
      ),
    ).toBeNull();
  });

  it("rejects non-text coordinate targets", () => {
    expect(
      validateLogicalContentOperation({
        kind: "insertInlineContent",
        blockId,
        blockType: "paragraph",
        target: { kind: "nested-content", groupIndex: 0, itemIndex: 0 },
        position: { blockId, offset: 0 },
        content: [{ type: "text", text: "A" }],
      }).errors,
    ).toStrictEqual([
      "operation.target.kind must be text",
      "operation.target.groupIndex is not supported",
      "operation.target.itemIndex is not supported",
    ]);
  });
});
