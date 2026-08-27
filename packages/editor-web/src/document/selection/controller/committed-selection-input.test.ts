import { afterEach, describe, expect, it, vi } from "vitest";
import { asBlockId } from "@repo/editor-core/kernel";
import { createEditorLogicalSelectionPoint } from "@repo/editor-react/selection";
import type { EditableEditorRuntimePort } from "../../../runtime/document/render-port.ts";
import { createTestEditorSnapshot } from "../../../tests/editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "../../../tests/test-editor-definition.ts";
import { initializeTestEditableEditor } from "../../../tests/test-editor-initializers.ts";
import type { EditableEditorDefinition } from "../../../runtime/definition/contracts.ts";
import { createWebSelectionTextAnchorAtOffset } from "../anchors/text-anchor.ts";
import { applyTextInsertionToCommittedSelection } from "./committed-selection-input.ts";

const firstId = asBlockId("01890f07-1c00-7000-8000-000000000971");
const secondId = asBlockId("01890f07-1c00-7000-8000-000000000972");
const editors: EditableEditorRuntimePort[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose();
});

describe("applyTextInsertionToCommittedSelection", () => {
  it("carries typing provenance through a cross-block replacement and opens from its final selection", () => {
    const changes = vi.fn();
    const editor = createEditor({
      typingTriggers: [{ id: "mention", trigger: "@" }],
      onChange: changes,
    });
    const selection = commitCrossBlockSelection(editor, 0, 1);

    const result = applyTextInsertionToCommittedSelection({
      editor,
      selection,
      text: "@",
      expectedSelectionRevision: selection.revision,
      provenance: { kind: "typing", text: "@", inputType: "text" },
    });

    expect(result).toEqual({ accepted: true, changed: true });
    expect(editor.getRootBlockIds()).toEqual([firstId]);
    expect(editor.readBlockPlainText(firstId, "textBlock")).toBe("@ef");
    expect(editor.canUndo).toBe(true);
    expect(editor.getTypingTriggerSession()).toMatchObject({
      triggerId: "mention",
      blockId: firstId,
      range: { from: 0, to: 1 },
      selection: { blockId: firstId, offset: 1 },
    });
    expect(changes).toHaveBeenCalledOnce();
    expect(changes.mock.calls[0]?.[0]).not.toHaveProperty("provenance");
    expect(
      editor.selectionController.getCommittedSnapshot()?.revision,
    ).not.toBe(selection.revision);
  });

  it("rejects a stale selection revision without mutation or history", () => {
    const editor = createEditor({
      typingTriggers: [{ id: "mention", trigger: "@" }],
    });
    const selection = commitCrossBlockSelection(editor);

    const result = applyTextInsertionToCommittedSelection({
      editor,
      selection,
      text: "@",
      expectedSelectionRevision: selection.revision + 1,
      provenance: { kind: "typing", text: "@", inputType: "text" },
    });

    expect(result).toMatchObject({
      accepted: false,
      changed: false,
      reason: "stale-selection",
    });
    expect(editor.readBlockPlainText(firstId, "textBlock")).toBe("abc");
    expect(editor.readBlockPlainText(secondId, "textBlock")).toBe("def");
    expect(editor.canUndo).toBe(false);
    expect(editor.getTypingTriggerSession()).toBeNull();
  });

  it("does not create a typing edge for a programmatic structural insertion", () => {
    const editor = createEditor({
      typingTriggers: [{ id: "mention", trigger: "@" }],
    });
    const selection = commitCrossBlockSelection(editor);

    expect(
      applyTextInsertionToCommittedSelection({
        editor,
        selection,
        text: "日本🙂",
        expectedSelectionRevision: selection.revision,
        provenance: null,
      }),
    ).toEqual({ accepted: true, changed: true });
    expect(editor.readBlockPlainText(firstId, "textBlock")).toBe("a日本🙂ef");
    const canonical = editor.selectionController.canonical.getSnapshot();
    expect(
      canonical.kind === "document"
        ? canonical.snapshot.documentSelection.focus?.textOffset
        : null,
    ).toBe(4);
    expect(editor.getTypingTriggerSession()).toBeNull();
  });

  it("restores Unicode composition content through structural undo and redo", () => {
    const baseline = "hello café café 🙂 ❤️ 👨‍👩‍👧‍👦 🇯🇵 日本語 العربية world";
    const editor = createEditor({ firstText: baseline });
    const selection = commitCollapsedSelection(
      editor,
      firstId,
      Array.from(baseline).length,
    );

    expect(
      applyTextInsertionToCommittedSelection({
        editor,
        selection,
        text: "日本🙂",
        expectedSelectionRevision: selection.revision,
        provenance: {
          kind: "typing",
          text: "日本🙂",
          inputType: "composition",
        },
      }),
    ).toEqual({ accepted: true, changed: true });
    expect(editor.readBlockPlainText(firstId, "textBlock")).toBe(
      `${baseline}日本🙂`,
    );

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.readBlockPlainText(firstId, "textBlock")).toBe(baseline);
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(editor.readBlockPlainText(firstId, "textBlock")).toBe(
      `${baseline}日本🙂`,
    );
  });
});

function createEditor(
  options: {
    readonly typingTriggers?: EditableEditorDefinition["typingTriggers"];
    readonly onChange?: (change: unknown) => void;
    readonly firstText?: string;
  } = {},
): EditableEditorRuntimePort {
  const editor = initializeTestEditableEditor({
    definition: {
      ...testEditableEditorDefinition,
      typingTriggers: options.typingTriggers ?? [],
    },
    snapshot: createTestEditorSnapshot([
      { id: firstId, type: "textBlock", text: options.firstText ?? "abc" },
      { id: secondId, type: "textBlock", text: "def" },
    ]),
    onChange: options.onChange,
  }) as EditableEditorRuntimePort;
  editors.push(editor);
  return editor;
}

function commitCrossBlockSelection(
  editor: EditableEditorRuntimePort,
  firstOffset = 1,
  secondOffset = 1,
) {
  const anchor = point(editor, firstId, firstOffset);
  const focus = point(editor, secondId, secondOffset);
  const settled = editor.selectionController.extendSelection(
    anchor,
    focus,
    editor,
    editor.getSelectionGraphRevision(),
    { publication: { kind: "silent" }, cause: "programmatic-edit" },
  );
  if (!settled) throw new Error("Expected selection to settle");
  const selection = editor.selectionController.getCommittedSnapshot();
  if (!selection) throw new Error("Expected committed selection");
  return selection;
}

function commitCollapsedSelection(
  editor: EditableEditorRuntimePort,
  blockId: typeof firstId,
  offset: number,
) {
  const caret = point(editor, blockId, offset);
  const settled = editor.selectionController.extendSelection(
    caret,
    caret,
    editor,
    editor.getSelectionGraphRevision(),
    { publication: { kind: "silent" }, cause: "programmatic-edit" },
  );
  if (!settled) throw new Error("Expected selection to settle");
  const selection = editor.selectionController.getCommittedSnapshot();
  if (!selection) throw new Error("Expected committed selection");
  return selection;
}

function point(
  editor: EditableEditorRuntimePort,
  blockId: typeof firstId,
  offset: number,
) {
  const anchor = createWebSelectionTextAnchorAtOffset({
    contentRuntime: editor.contentRuntime,
    blockId,
    blockType: "textBlock",
    textOffset: offset,
  });
  if (!anchor.ok) throw new Error(anchor.message);
  const point = createEditorLogicalSelectionPoint({
    graph: editor,
    blockId,
    textOffset: anchor.textOffset,
    textAnchor: anchor.textAnchor,
  });
  if (!point) throw new Error("Expected logical point");
  return point;
}
