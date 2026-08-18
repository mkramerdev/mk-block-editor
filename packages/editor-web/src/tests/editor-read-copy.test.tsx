import { act, render } from "@testing-library/react";
import type { BlockId } from "@repo/editor-core/kernel";
import { createEditorLogicalSelectionPoint } from "@repo/editor-react/selection";
import { describe, expect, it } from "vitest";
import { createWebSelectionTextAnchorAtOffset } from "../document/selection/anchors/text-anchor.ts";
import { EditorDocument } from "../runtime/document/editor-document-component.tsx";
import {
  initializeTestEditableEditor as initializeEditableEditor,
  initializeTestReadEditor as initializeReadEditor,
} from "./test-editor-initializers.ts";
import type { Editor } from "../runtime/document/contracts.ts";
import { resolveEditorRuntimePort } from "../runtime/document/runtime-port-registry.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import {
  testEditableEditorDefinition,
  testReadEditorDefinition,
} from "./test-editor-definition.ts";

const blockId = "phase-one-read-copy" as BlockId;
const editableCopyDefinition = {
  ...testEditableEditorDefinition,
  defaultRoot: "paragraph",
  contentImport: { plainTextBlockType: "paragraph" },
} satisfies typeof testEditableEditorDefinition;

const readCopyDefinition = {
  ...testReadEditorDefinition,
  defaultRoot: "paragraph",
  contentImport: { plainTextBlockType: "paragraph" },
} satisfies typeof testReadEditorDefinition;

describe("read-only canonical clipboard", () => {
  it("copies the same canonical fragment in read-only and editable modes", () => {
    const readClipboard = copySelectedRange(false);
    const editableClipboard = copySelectedRange(true);

    expect(readClipboard.getData("text/plain")).toBe("ell");
    expect([...readClipboard.values]).toEqual([...editableClipboard.values]);
  });

  it("does not install cut, paste, or mutation behavior in read-only mode", () => {
    const editor = initializeReadEditor({
      definition: readCopyDefinition,
      snapshot: snapshot(),
    });
    const view = render(<EditorDocument editor={editor} />);
    act(() => settleTextRange(editor, 1, 4));
    const before = editor.readBlockContent(blockId, "paragraph");

    const cut = clipboardEvent("cut", new MemoryDataTransfer());
    document.dispatchEvent(cut);
    const pasteData = new MemoryDataTransfer({ "text/plain": "replacement" });
    const paste = clipboardEvent("paste", pasteData);
    document.dispatchEvent(paste);

    expect(cut.defaultPrevented).toBe(false);
    expect(paste.defaultPrevented).toBe(false);
    expect(editor.readBlockContent(blockId, "paragraph")).toEqual(before);
    expect("insertText" in editor).toBe(false);
    expect("undo" in editor).toBe(false);

    view.unmount();
    editor.dispose();
  });
});

function copySelectedRange(editable: boolean): MemoryDataTransfer {
  const editor: Editor = editable
    ? initializeEditableEditor({
        definition: editableCopyDefinition,
        snapshot: snapshot(),
      })
    : initializeReadEditor({
        definition: readCopyDefinition,
        snapshot: snapshot(),
      });
  const view = render(<EditorDocument editor={editor} />);
  act(() => settleTextRange(editor, 1, 4));
  const clipboard = new MemoryDataTransfer();
  const event = clipboardEvent("copy", clipboard);

  const textRoot = view.container.querySelector<HTMLElement>(
    "[data-editor-text-root='true']",
  );
  if (!textRoot) throw new Error("Expected mounted text target");
  textRoot.dispatchEvent(event);

  expect(event.defaultPrevented).toBe(true);
  view.unmount();
  editor.dispose();
  return clipboard;
}

function settleTextRange(
  editor: Editor,
  anchorOffset: number,
  focusOffset: number,
) {
  const runtime = resolveEditorRuntimePort(editor);
  const anchor = point(anchorOffset);
  const focus = point(focusOffset);
  const settled = runtime.selectionController.extendSelection(
    anchor,
    focus,
    runtime,
    runtime.getSelectionGraphRevision(),
    { publication: { kind: "silent" }, cause: "programmatic-edit" },
  );
  if (!settled) throw new Error("Expected canonical text selection");

  function point(offset: number) {
    const stable = createWebSelectionTextAnchorAtOffset({
      contentRuntime: runtime.contentRuntime,
      blockId,
      blockType: "paragraph",
      textOffset: offset,
    });
    if (!stable.ok) throw new Error(stable.message);
    const result = createEditorLogicalSelectionPoint({
      graph: runtime,
      blockId,
      textOffset: stable.textOffset,
      textAnchor: stable.textAnchor,
    });
    if (!result) throw new Error("Expected selection point");
    return result;
  }
}

function snapshot() {
  return createTestEditorSnapshot([
    { id: blockId, type: "paragraph", text: "hello" },
  ]);
}

function clipboardEvent(
  type: "copy" | "cut" | "paste",
  clipboard: MemoryDataTransfer,
): ClipboardEvent {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, "clipboardData", {
    value: clipboard.asDataTransfer(),
  });
  return event as ClipboardEvent;
}

class MemoryDataTransfer {
  readonly values = new Map<string, string>();

  constructor(initial: Readonly<Record<string, string>> = {}) {
    for (const [format, value] of Object.entries(initial)) {
      this.values.set(format, value);
    }
  }

  setData(format: string, value: string): void {
    this.values.set(format, value);
  }

  getData(format: string): string {
    return this.values.get(format) ?? "";
  }

  asDataTransfer(): DataTransfer {
    return this as unknown as DataTransfer;
  }
}
