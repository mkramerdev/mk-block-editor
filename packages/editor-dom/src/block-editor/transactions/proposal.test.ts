import { describe, expect, it, vi } from "vitest";
import { boldMarkDefinition } from "@repo/editor-core/content/marks";
import { asBlockId } from "@repo/editor-core/kernel";
import { createBlockLocalProseMirrorSchema } from "../../schema/block-local/schema.ts";
import type { Transaction } from "../../prosemirror/index.ts";
import { createBlockLocalProseMirrorState } from "../state/create-block-local-state.ts";
import type { ProseMirrorStateProposal } from "./proposal.ts";
import { deriveProseMirrorOperations } from "./proposal.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000000101");
describe("deriveProseMirrorOperations", () => {
  it("derives text insertion and deletion operations", () => {
    const state = createBlockLocalProseMirrorState({
      blockId,
      blockType: "paragraph",
      doc: "abcd",
      schema: createBlockLocalProseMirrorSchema({
        inlineMarks: [boldMarkDefinition],
      }),
    });

    const insertion = derive(state, state.tr.insertText("X", 3));
    const deletion = derive(state, state.tr.delete(2, 4));

    expect(insertion.operations).toMatchObject([
      { kind: "insertInlineContent", position: { offset: 2 } },
    ]);
    expect(deletion.operations).toMatchObject([
      {
        kind: "deleteInlineRange",
        range: { from: { offset: 1 }, to: { offset: 3 } },
      },
    ]);
  });

  it("converts a typed character without serializing the complete document", () => {
    const state = createBlockLocalProseMirrorState({
      blockId,
      blockType: "paragraph",
      doc: "abcd",
    });
    const serializeCompleteDocument = vi.spyOn(state.doc, "toJSON");

    const insertion = derive(state, state.tr.insertText("X", 3));

    expect(insertion.operations).toEqual([
      {
        kind: "insertInlineContent",
        blockId,
        blockType: "paragraph",
        target: { kind: "text" },
        position: { blockId, offset: 2 },
        content: [{ type: "text", text: "X" }],
      },
    ]);
    expect(serializeCompleteDocument).not.toHaveBeenCalled();
  });

  it("preserves mark changes as logical mark operations", () => {
    const state = createBlockLocalProseMirrorState({
      blockId,
      blockType: "paragraph",
      doc: "abcd",
      schema: createBlockLocalProseMirrorSchema({
        inlineMarks: [boldMarkDefinition],
      }),
    });
    const mark = state.schema.marks.strong?.create();
    expect(mark).toBeDefined();

    const batch = derive(state, state.tr.addMark(2, 4, mark!));

    expect(batch.operations).toMatchObject([
      {
        kind: "addInlineMark",
        range: { from: { offset: 1 }, to: { offset: 3 } },
        markName: "strong",
      },
    ]);
  });

  it("keeps disjoint steps granular and uses intermediate coordinates", () => {
    const state = createBlockLocalProseMirrorState({
      blockId,
      blockType: "paragraph",
      doc: "abcd",
    });
    const transaction = state.tr.insertText("X", 2).insertText("Y", 5);

    const batch = derive(state, transaction);

    expect(batch.operations).toHaveLength(2);
    expect(batch.operations).toMatchObject([
      { kind: "insertInlineContent", position: { offset: 1 } },
      { kind: "insertInlineContent", position: { offset: 4 } },
    ]);
  });

  it("converts range replacement and paste-shaped insertion directly", () => {
    const state = createBlockLocalProseMirrorState({
      blockId,
      blockType: "paragraph",
      doc: "abcd",
    });

    expect(derive(state, state.tr.insertText("XY", 2, 4)).operations).toEqual([
      {
        kind: "replaceInlineRange",
        blockId,
        blockType: "paragraph",
        target: { kind: "text" },
        range: {
          from: { blockId, offset: 1 },
          to: { blockId, offset: 3 },
        },
        content: [{ type: "text", text: "XY" }],
        deletedContent: [{ type: "text", text: "bc" }],
      },
    ]);
    expect(derive(state, state.tr.insertText("pasted", 3)).operations).toMatchObject([
      {
        kind: "insertInlineContent",
        position: { offset: 2 },
        content: [{ type: "text", text: "pasted" }],
      },
    ]);
  });

  it("preserves marked text, hard breaks, and inline atoms in inserted fragments", () => {
    const schema = createBlockLocalProseMirrorSchema({
      inlineMarks: [boldMarkDefinition],
      inlineAtoms: [{ type: "mention" }],
    });
    const state = createBlockLocalProseMirrorState({
      blockId,
      blockType: "paragraph",
      doc: "ab",
      schema,
    });
    const strong = schema.marks.strong!.create();
    const fragment = [
      schema.text("X", [strong]),
      schema.nodes.hard_break!.create(),
      schema.nodes.mention!.create({ metadata: { id: "user-1" } }),
    ];

    expect(derive(state, state.tr.replaceWith(2, 2, fragment)).operations).toEqual([
      {
        kind: "insertInlineContent",
        blockId,
        blockType: "paragraph",
        target: { kind: "text" },
        position: { blockId, offset: 1 },
        content: [
          { type: "text", text: "X", marks: [{ type: "strong" }] },
          { type: "hard_break" },
          { type: "mention", metadata: { id: "user-1" } },
        ],
      },
    ]);
  });

  it("fails explicitly for an unsupported ProseMirror step", () => {
    const state = createBlockLocalProseMirrorState({
      blockId,
      blockType: "paragraph",
      doc: "abcd",
    });
    const transaction = state.tr;
    const unsupported = {
      constructor: { name: "UnsupportedStep" },
    } as unknown as Transaction["steps"][number];
    Object.defineProperty(transaction, "steps", { value: [unsupported] });
    Object.defineProperty(transaction, "docs", { value: [state.doc] });
    const result = deriveProseMirrorOperations({
      blockId,
      blockType: "paragraph",
      proposal: {
        previousState: state,
        proposedState: state,
        transactions: [transaction],
        base: {
          graphRevision: 1,
          blockId,
          blockType: "paragraph",
          contentRevision: 1,
        },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      transactionIndex: 0,
      stepIndex: 0,
      message: expect.stringContaining("Unsupported ProseMirror step"),
    });
  });

  it("returns forward operations without proposal inverses", () => {
    const state = createBlockLocalProseMirrorState({
      blockId,
      blockType: "paragraph",
      doc: "abcd",
    });
    const transaction = state.tr.insertText("X", 2).delete(4, 5);
    const derived = derive(state, transaction);

    expect(derived.operations).toHaveLength(2);
    expect(Object.keys(derived)).toEqual(["ok", "operations"]);
  });
});

function derive(
  previousState: ReturnType<typeof createBlockLocalProseMirrorState>,
  transaction: Transaction,
) {
  const applied = previousState.applyTransaction(transaction);
  const result = deriveProseMirrorOperations({
    blockId,
    blockType: "paragraph",
    proposal: {
      previousState,
      proposedState: applied.state,
      transactions: applied.transactions,
      base: {
        graphRevision: 1,
        blockId,
        blockType: "paragraph",
        contentRevision: 1,
      },
    } satisfies ProseMirrorStateProposal,
  });
  if (!result.ok) throw new Error(result.message);
  return result;
}
