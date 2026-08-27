import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import type { EditorChangeCallback } from "@repo/editor-web/document-runtime";
import { createFirstDraftViewStateStore } from "../blocks/view-state.tsx";
import { createFirstDraftEditorDefinition } from "../first-draft-definition.tsx";
import { createFirstDraftSnapshot } from "../first-draft-fixture.ts";
import { initializeTestEditableEditor } from "../test-editor.ts";
import {
  insertFirstDraftAdjacentParagraph,
  readFirstDraftAdjacentParagraphAvailability,
} from "./adjacent-paragraph.ts";

const id = (value: string) => value as BlockId;
const editors: Array<{ dispose(): void }> = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose();
  vi.restoreAllMocks();
});

describe("First Draft adjacent paragraph operations", () => {
  it.each(["before", "after"] as const)(
    "inserts %s an ordinary root block at its exact live boundary with one undo entry",
    (direction) => {
      const onChange = vi.fn();
      const editor = createEditor(onChange);
      const targetId = id("fd-paragraph-intro");
      const before = editor.getRootBlockIds();
      const targetIndex = before.indexOf(targetId);

      const result = insertFirstDraftAdjacentParagraph(
        editor,
        targetId,
        direction,
      );

      expect(result.ok).toBe(true);
      const after = editor.getRootBlockIds();
      expect(after).toHaveLength(before.length + 1);
      const createdId =
        after[targetIndex + (direction === "after" ? 1 : 0)]!;
      expect(editor.getBlock(createdId)).toMatchObject({
        id: createdId,
        type: "paragraph",
        parentId: null,
      });
      expect(result).toMatchObject({
        transaction: {
          transaction: {
            selection: { kind: "text-offset", blockId: createdId, offset: 0 },
          },
        },
      });
      expect(onChange).toHaveBeenCalledOnce();
      expect(editor.undo()).toEqual({ status: "applied" });
      expect(editor.getRootBlockIds()).toEqual(before);
      expect(editor.undo()).toEqual({ status: "history-empty" });
    },
  );

  it("inserts beside a column child without escaping its accepting column", () => {
    const onChange = vi.fn();
    const editor = createEditor(onChange);
    const columnId = id("fd-column-left");
    const targetId = id("fd-column-left-heading");
    const before = editor.getChildBlockIds(columnId);

    const result = insertFirstDraftAdjacentParagraph(
      editor,
      targetId,
      "after",
    );

    expect(result.ok).toBe(true);
    const after = editor.getChildBlockIds(columnId);
    const createdId = after[before.indexOf(targetId) + 1]!;
    expect(editor.getBlock(createdId)).toMatchObject({
      type: "paragraph",
      parentId: columnId,
    });
    expect(onChange).toHaveBeenCalledOnce();
  });

  it("preserves the established list-aware exit without inserting a paragraph into the list", () => {
    const onChange = vi.fn();
    const editor = createEditor(onChange);
    const listId = id("fd-bullet-list");
    const itemId = id("fd-bullet-2");
    const paragraphId = id("fd-bullet-2-text");
    const rootIndex = editor.getRootBlockIds().indexOf(listId);

    expect(
      readFirstDraftAdjacentParagraphAvailability(editor, itemId, "after"),
    ).toEqual({ kind: "available" });
    const result = insertFirstDraftAdjacentParagraph(
      editor,
      itemId,
      "after",
    );

    expect(result.ok).toBe(true);
    expect(editor.getBlock(itemId)).toBeNull();
    expect(editor.getBlock(paragraphId)).toMatchObject({ parentId: null });
    expect(editor.getRootBlockIds()[rootIndex + 1]).toBe(paragraphId);
    expect(
      editor
        .getChildBlockIds(listId)
        .map((childId) => editor.getBlock(childId)?.type),
    ).not.toContain("paragraph");
    expect(onChange).toHaveBeenCalledOnce();
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.getParentId(paragraphId)).toBe(itemId);
  });

  it.each([
    ["column wrapper", "fd-column-left"],
    ["tab pane", "fd-tab-overview"],
  ] as const)("disables adjacent paragraphs for a constrained %s child", (_, target) => {
    const onChange = vi.fn();
    const editor = createEditor(onChange);
    const targetId = id(target);

    expect(
      readFirstDraftAdjacentParagraphAvailability(editor, targetId, "before"),
    ).toEqual({ kind: "disabled" });
    expect(
      readFirstDraftAdjacentParagraphAvailability(editor, targetId, "after"),
    ).toEqual({ kind: "disabled" });
    expect(
      insertFirstDraftAdjacentParagraph(editor, targetId, "after"),
    ).toMatchObject({ ok: false, handled: true, reason: "invalid-input" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports a stale target without attempting a transaction", () => {
    const onChange = vi.fn();
    const editor = createEditor(onChange);
    const missingId = id("missing-block");
    expect(
      readFirstDraftAdjacentParagraphAvailability(editor, missingId, "after"),
    ).toEqual({ kind: "stale" });
    expect(
      insertFirstDraftAdjacentParagraph(editor, missingId, "after"),
    ).toMatchObject({ ok: false, handled: false, reason: "stale-plan" });
    expect(onChange).not.toHaveBeenCalled();
  });
});

function createEditor(onChange: EditorChangeCallback) {
  const viewState = createFirstDraftViewStateStore();
  const editor = addEditorBlockOperations(
    initializeTestEditableEditor({
      definition: createFirstDraftEditorDefinition(viewState),
      snapshot: createFirstDraftSnapshot(),
      onChange,
    }),
  );
  editors.push(editor);
  return editor;
}
