import { describe, expect, it, vi } from "vitest";
import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorBlockCommandExecutionContext } from "@repo/editor-web/document-runtime";
import {
  firstDraftTableCellBoundaryCommands,
  TABLE_CELL_BOUNDARY_BACKSPACE_COMMAND_ID,
  TABLE_CELL_BOUNDARY_DELETE_COMMAND_ID,
} from "./table-cell-boundary-commands.ts";

const backspace = command(TABLE_CELL_BOUNDARY_BACKSPACE_COMMAND_ID);
const forwardDelete = command(TABLE_CELL_BOUNDARY_DELETE_COMMAND_ID);

describe("First Draft table-cell boundary command policy", () => {
  it.each([
    ["empty first cell", "", 0],
    ["non-empty first cell", "content", 0],
  ])("consumes Backspace at offset zero in an %s", (_name, text, offset) => {
    const fixture = context({ text, from: offset, to: offset });
    expect(backspace.execute(fixture.value)).toBe(true);
    expectNoMutation(fixture);
  });

  it.each([
    ["after offset zero", { from: 1, to: 1 }],
    ["with a canonical range", { from: 0, to: 1 }],
    ["with a ProseMirror range", { from: 0, to: 0, nativeEmpty: false }],
    ["during composition", { from: 0, to: 0, composing: true }],
    ["in an ordinary paragraph", { from: 0, to: 0, blockType: "paragraph" }],
  ])("lets Backspace fall through %s", (_name, options) => {
    const fixture = context({ text: "text", ...options });
    expect(backspace.execute(fixture.value)).toBe(false);
    expectNoMutation(fixture);
  });

  it("consumes Delete only at the canonical end of a collapsed table cell", () => {
    const end = context({ text: "Ada", from: 3, to: 3 });
    expect(forwardDelete.execute(end.value)).toBe(true);
    expectNoMutation(end);

    for (const fixture of [
      context({ text: "Ada", from: 2, to: 2 }),
      context({ text: "Ada", from: 2, to: 3 }),
      context({ text: "Ada", from: 3, to: 3, nativeEmpty: false }),
      context({ text: "Ada", from: 3, to: 3, composing: true }),
      context({ text: "Ada", from: 3, to: 3, blockType: "paragraph" }),
    ]) {
      expect(forwardDelete.execute(fixture.value)).toBe(false);
      expectNoMutation(fixture);
    }
  });
});

function command(id: string) {
  const result = firstDraftTableCellBoundaryCommands.find(
    (candidate) => candidate.id === id,
  );
  if (!result) throw new Error(`Missing command ${id}`);
  return result;
}

function context(options: {
  readonly text: string;
  readonly from: number;
  readonly to: number;
  readonly nativeEmpty?: boolean;
  readonly composing?: boolean;
  readonly blockType?: string;
}) {
  const executeStructuralTransaction = vi.fn();
  const dispatchProseMirrorTransaction = vi.fn();
  const readBlockContent = vi.fn(() =>
    createBlockRichTextContentFromPlainText(
      options.blockType ?? "tableCell",
      options.text,
    ),
  );
  const value = {
    blockId: "cell" as BlockId,
    blockType: options.blockType ?? "tableCell",
    textSelection: { from: options.from, to: options.to },
    view: {
      composing: options.composing ?? false,
      state: { selection: { empty: options.nativeEmpty ?? true } },
    },
    editor: { readBlockContent },
    executeStructuralTransaction,
    dispatchProseMirrorTransaction,
  } as unknown as EditorBlockCommandExecutionContext;
  return {
    value,
    executeStructuralTransaction,
    dispatchProseMirrorTransaction,
    readBlockContent,
  };
}

function expectNoMutation(fixture: ReturnType<typeof context>): void {
  expect(fixture.executeStructuralTransaction).not.toHaveBeenCalled();
  expect(fixture.dispatchProseMirrorTransaction).not.toHaveBeenCalled();
}
