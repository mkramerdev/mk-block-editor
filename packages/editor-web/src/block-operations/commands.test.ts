import { createBlockLocalProseMirrorState } from "@repo/editor-dom/block-editor";
import type { EditorView } from "@repo/editor-dom/prosemirror";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorExternalStore } from "@repo/editor-react/store";
import { describe, expect, it, vi } from "vitest";
import { testEditableEditorDefinition } from "../tests/test-editor-definition.ts";
import { initializeTestEditableEditor } from "../tests/test-editor-initializers.ts";
import { createTestEditorSnapshot } from "../tests/editor-snapshot-fixtures.ts";
import {
  blockOperationCommands,
  blockOperationKeybindings,
  INDENT_BLOCK_COMMAND_ID,
  OUTDENT_BLOCK_COMMAND_ID,
} from "./commands.ts";
import {
  addEditorBlockOperations,
  type EditorWithBlockOperations,
} from "./editor-extension.ts";

const firstId = "01890f07-1c00-7000-8000-000000009101" as BlockId;
const secondId = "01890f07-1c00-7000-8000-000000009102" as BlockId;

describe("optional block-operation commands", () => {
  it("exports frozen, explicit Tab and Shift-Tab policy", () => {
    expect(blockOperationCommands.map((command) => command.id)).toEqual([
      INDENT_BLOCK_COMMAND_ID,
      OUTDENT_BLOCK_COMMAND_ID,
    ]);
    expect(blockOperationKeybindings).toEqual([
      {
        key: "Tab",
        commandId: INDENT_BLOCK_COMMAND_ID,
        scope: "block",
      },
      {
        key: "Shift-Tab",
        commandId: OUTDENT_BLOCK_COMMAND_ID,
        scope: "block",
      },
    ]);
    expect(Object.isFrozen(blockOperationCommands)).toBe(true);
    expect(Object.isFrozen(blockOperationKeybindings)).toBe(true);
    expect(blockOperationCommands.every(Object.isFrozen)).toBe(true);
    expect(blockOperationKeybindings.every(Object.isFrozen)).toBe(true);
  });

  it("indents and outdents once with selection settled in each transaction", () => {
    const transactions = vi.fn();
    const editor = createEditor(transactions);
    const inserted = editor.insertBlock({
      blockId: firstId,
      blockType: "callout",
    });
    expect(inserted.ok).toBe(true);
    const calloutId = editor.getRootBlockIds()[1]!;
    const settleSelection = vi.spyOn(editor, "setTransactionSelection");
    transactions.mockClear();

    expect(executeCommand(INDENT_BLOCK_COMMAND_ID, editor)).toBe(true);
    expect(editor.getParentId(secondId)).toBe(calloutId);
    expect(settleSelection).toHaveBeenLastCalledWith({
      kind: "text",
      blockId: secondId,
      offset: 0,
    });
    expect(transactions).toHaveBeenCalledOnce();

    expect(editor.undo()).toMatchObject({ status: "applied" });
    expect(editor.getParentId(secondId)).toBeNull();
    expect(editor.redo()).toMatchObject({ status: "applied" });
    expect(editor.getParentId(secondId)).toBe(calloutId);

    transactions.mockClear();
    settleSelection.mockClear();
    expect(executeCommand(OUTDENT_BLOCK_COMMAND_ID, editor)).toBe(true);
    expect(editor.getParentId(secondId)).toBeNull();
    expect(settleSelection).toHaveBeenLastCalledWith({
      kind: "text",
      blockId: secondId,
      offset: 0,
    });
    expect(transactions).toHaveBeenCalledOnce();
    editor.dispose();
  });

  it("returns unhandled without history for invalid indentation", () => {
    const transactions = vi.fn();
    const editor = createEditor(transactions);

    expect(executeCommand(OUTDENT_BLOCK_COMMAND_ID, editor)).toBe(false);
    expect(transactions).not.toHaveBeenCalled();
    expect(editor.canUndo).toBe(false);
    editor.dispose();
  });
});

function createEditor(
  onChange?: (transaction: unknown) => void,
): EditorWithBlockOperations {
  return addEditorBlockOperations(
    initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: firstId, type: "paragraph", text: "first" },
        { id: secondId, type: "paragraph", text: "second" },
      ]),
      onChange,
    }),
    { blockDefinitions: testEditableEditorDefinition.blocks },
  );
}

function executeCommand(
  commandId: string,
  editor: EditorWithBlockOperations,
): boolean {
  const command = blockOperationCommands.find(
    (candidate) => candidate.id === commandId,
  );
  if (!command) throw new Error(`Missing command ${commandId}.`);
  const state = createBlockLocalProseMirrorState({
    blockId: secondId,
    blockType: "paragraph",
    doc: "second",
  });
  const view = { state } as EditorView;
  return command.execute({
    definition: testEditableEditorDefinition,
    store: {} as EditorExternalStore,
    editor,
    blockId: secondId,
    blockType: "paragraph",
    view,
    dispatchProseMirrorTransaction: () => undefined,
    request: { commandId },
  });
}
