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
  textBlock: {
    type: "textBlock",
    kind: "text",
    selection: contentSelection(),
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
      blockType: "textBlock",
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
      blockType: "textBlock",
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
      blockType: "textBlock",
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
        "textBlock",
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
      blockType: "textBlock",
      target: { kind: "text" },
      range: {
        from: { blockId, offset: 0 },
        to: { blockId, offset: 1 },
      },
    };

    expect(
      prepareLogicalContentOperations({
        blockType: "textBlock",
        content: richText("A"),
        operations: [operation],
        options,
      }),
    ).toEqual({
      ok: false,
      message: "Logical content operation is not reversibly representable",
    });
  });

  it.each(["undo", "redo"] as const)(
    "rejects mismatched expected content for %s without relocating it",
    (origin) => {
      const requested: EditorLogicalContentOperation = {
        kind: "deleteInlineRange",
        blockId,
        blockType: "textBlock",
        target: { kind: "text" },
        range: {
          from: { blockId, offset: 0 },
          to: { blockId, offset: 2 },
        },
        deletedContent: [{ type: "text", text: "bc" }],
      };
      const prepared = prepareLogicalContentOperations({
        blockType: "textBlock",
        content: richText("abcabc"),
        operations: [requested],
        origin,
        options,
      });

      expect(prepared).toEqual({
        ok: false,
        message: "Logical content operation is inapplicable",
      });
    },
  );

  it("rejects duplicate, incoherent, and syntactically invalid changes", () => {
    const baseToken = {
      graphRevision: 1,
      blockId,
      blockType: "textBlock",
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
    blockType: "textBlock" as const,
    target: { kind: "text" as const },
    position: { blockId: block, offset },
    content: [{ type: "text" as const, text }],
  };
}

function richText(value: string) {
  return createBlockRichTextContentFromPlainText("textBlock", value);
}
