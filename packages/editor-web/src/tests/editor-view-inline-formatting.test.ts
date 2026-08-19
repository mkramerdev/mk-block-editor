import { describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { createBlockLocalProseMirrorState } from "@repo/editor-dom/block-editor";
import { EditorView } from "@repo/editor-dom/prosemirror";
import { setEditorViewCaretSilently } from "../document/inline/editor-view-inline-formatting.ts";

describe("editor view inline formatting caret helpers", () => {
  it("does not dispatch when restoring an unchanged caret", () => {
    const state = createBlockLocalProseMirrorState({
      blockId: "01890f07-1c00-7000-8000-000000000001" as BlockId,
      blockType: "paragraph",
      doc: "",
    });
    const editorDom = document.createElement("div");
    document.body.append(editorDom);
    const view = new EditorView({ mount: editorDom }, { state });
    const updateState = vi.spyOn(view, "updateState");
    const focus = vi.spyOn(view, "focus");

    try {
      setEditorViewCaretSilently(view, 0);

      expect(updateState).not.toHaveBeenCalled();
      expect(focus).not.toHaveBeenCalled();
    } finally {
      view.destroy();
      editorDom.remove();
    }
  });

  it("directly installs a collapsed caret projection without semantic dispatch", () => {
    const blockId = "01890f07-1c00-7000-8000-000000000002" as BlockId;
    const state = createBlockLocalProseMirrorState({
      blockId,
      blockType: "paragraph",
      doc: "abcdef",
    });
    const editorDom = document.createElement("div");
    document.body.append(editorDom);

    const view = new EditorView({ mount: editorDom }, { state });
    const updateState = vi.spyOn(view, "updateState");
    const focus = vi.spyOn(view, "focus");

    try {
      setEditorViewCaretSilently(view, 3);
      expect(updateState).toHaveBeenCalledTimes(1);
      const projected = updateState.mock.calls[0]?.[0];
      expect(projected?.selection.empty).toBe(true);
      expect(focus).not.toHaveBeenCalled();
    } finally {
      view.destroy();
      editorDom.remove();
    }
  });
});
