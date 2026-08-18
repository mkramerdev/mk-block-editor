import { describe, expect, it } from "vitest";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import { asBlockId } from "../../kernel/identity/uuid.ts";
import { contentSelection } from "../../selection/block-selection.ts";
import { createBlockRichTextContentFromPlainText } from "../../content/rich-text/rich-inline-content.ts";
import { applyLogicalContentOperationToRichTextDocument } from "../../content/rich-text/content-operations.ts";
import type { EditorLogicalContentOperation } from "../language/logical-operations.ts";
import {
  prepareLogicalContentOperations,
  validateContentCommitInput,
} from "./content-commit.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000000201");
const otherBlockId = asBlockId("01890f07-1c00-7000-8000-000000000202");
const blockDefinitions: Readonly<Record<string, BlockDefinition>> = {
  paragraph: {
    type: "paragraph",
    kind: "text",
    selection: contentSelection(),
    root: false,
  },
};
const options = {
  blockDefinitions,
  inlineMarks: [],
  normalization: { inlineMarks: [], inlineAtoms: [] },
};

describe("canonical content commit preparation", () => {
  it("preserves unaffected canonical nodes instead of cloning the complete block per keystroke", () => {
    const prefix = Object.freeze({ type: "hard_break" as const });
    const suffix = Object.freeze({ type: "text" as const, text: "tail" });
    const content = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph" as const,
          content: [prefix, suffix],
        },
      ],
    };

    const prepared = prepareLogicalContentOperations({
      blockType: "paragraph",
      content,
      operations: [insert(blockId, 5, "!")],
      options,
    });
    if (!prepared.ok) throw new Error(prepared.message);

    expect(prepared.content.content[0]?.content?.[0]).toBe(prefix);
    expect(prepared.content.content[0]?.content?.[1]).not.toBe(suffix);
    expect(prepared.content.content[0]?.content?.[1]).toEqual({
      type: "text",
      text: "tail!",
    });
  });

  it("derives one inverse for a valid insert", () => {
    const operation = insert(blockId, 1, "B");
    const prepared = prepareLogicalContentOperations({
      blockType: "paragraph",
      content: richText("A"),
      operations: [operation],
      options,
    });

    expect(prepared).toMatchObject({
      ok: true,
      operations: [{ kind: "insertInlineContent" }],
      inverseOperations: [{ kind: "deleteInlineRange" }],
    });
    if (!prepared.ok) throw new Error(prepared.message);
    expect(prepared.operations[0]).toBe(operation);
  });

  it("orders multi-operation inverses for undo", () => {
    const prepared = prepareLogicalContentOperations({
      blockType: "paragraph",
      content: richText(""),
      operations: [insert(blockId, 0, "X"), insert(blockId, 1, "Y")],
      options,
    });
    if (!prepared.ok) throw new Error(prepared.message);

    expect(prepared.inverseOperations).toMatchObject([
      { kind: "deleteInlineRange", range: { from: { offset: 1 } } },
      { kind: "deleteInlineRange", range: { from: { offset: 0 } } },
    ]);
    let restored = prepared.content;
    for (const inverse of prepared.inverseOperations) {
      const next = applyLogicalContentOperationToRichTextDocument(
        "paragraph",
        restored,
        inverse,
        options,
      );
      if (!next) throw new Error("prepared inverse was not applicable");
      restored = next;
    }
    expect(restored).toStrictEqual(richText(""));
  });

  it("rejects an applicable operation that has no inverse", () => {
    const operation: EditorLogicalContentOperation = {
      kind: "deleteInlineRange",
      blockId,
      blockType: "paragraph",
      target: { kind: "text" },
      range: {
        from: { blockId, offset: 0 },
        to: { blockId, offset: 1 },
      },
    };

    expect(
      prepareLogicalContentOperations({
        blockType: "paragraph",
        content: richText("A"),
        operations: [operation],
        options,
      }),
    ).toEqual({
      ok: false,
      message: "Logical content operation is not reversibly representable",
    });
  });

  it("records and inverts the effective rebased operation", () => {
    const requested: EditorLogicalContentOperation = {
      kind: "deleteInlineRange",
      blockId,
      blockType: "paragraph",
      target: { kind: "text" },
      range: {
        from: { blockId, offset: 0 },
        to: { blockId, offset: 2 },
      },
      deletedContent: [{ type: "text", text: "bc" }],
    };
    const prepared = prepareLogicalContentOperations({
      blockType: "paragraph",
      content: richText("abcabc"),
      operations: [requested],
      origin: "undo",
      options,
    });
    if (!prepared.ok) throw new Error(prepared.message);

    expect(prepared.operations[0]).toMatchObject({
      range: { from: { offset: 1 }, to: { offset: 3 } },
    });
    expect(prepared.inverseOperations[0]).toMatchObject({
      kind: "insertInlineContent",
      position: { offset: 1 },
    });
    expect(prepared.content).toStrictEqual(richText("aabc"));
  });

  it("rejects duplicate, incoherent, and syntactically invalid changes", () => {
    const baseToken = {
      graphRevision: 1,
      blockId,
      blockType: "paragraph",
      contentRevision: 0,
    } as const;
    const operation = insert(blockId, 0, "X");

    expect(
      validateContentCommitInput({
        graphRevision: 1,
        changes: [
          { baseToken, operations: [operation] },
          { baseToken, operations: [operation] },
        ],
      }),
    ).toMatchObject({ ok: false, reason: "invalid-operation" });
    expect(
      validateContentCommitInput({
        graphRevision: 1,
        changes: [
          {
            baseToken,
            operations: [{ ...operation, blockId: otherBlockId }],
          },
        ],
      }),
    ).toMatchObject({ ok: false, reason: "invalid-operation" });
    expect(
      validateContentCommitInput({
        graphRevision: 1,
        changes: [
          {
            baseToken,
            operations: [
              {
                ...operation,
                position: { blockId, offset: -1 },
              },
            ],
          },
        ],
      }),
    ).toMatchObject({ ok: false, reason: "invalid-operation" });
  });
});

function insert(block: typeof blockId, offset: number, text: string) {
  return {
    kind: "insertInlineContent" as const,
    blockId: block,
    blockType: "paragraph" as const,
    target: { kind: "text" as const },
    position: { blockId: block, offset },
    content: [{ type: "text" as const, text }],
  };
}

function richText(value: string) {
  return createBlockRichTextContentFromPlainText("paragraph", value);
}
