import { act, render, waitFor } from "@testing-library/react";
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
import type { EditableEditorRuntimePort } from "../runtime/document/render-port.ts";
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
    act(() => settleTextRange(editor, blockId, 1, blockId, 4));
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

describe("editable canonical clipboard paste", () => {
  it("settles a cross-block paste at its logical end in canonical focus, the shared view, and history", async () => {
    const sourceFirst = "clipboard-source-first" as BlockId;
    const sourceLast = "clipboard-source-last" as BlockId;
    const target = "clipboard-target" as BlockId;
    const editor = initializeEditableEditor({
      definition: editableCopyDefinition,
      snapshot: createTestEditorSnapshot([
        { id: sourceFirst, type: "paragraph", text: "one" },
        { id: sourceLast, type: "paragraph", text: "two" },
        { id: target, type: "paragraph", text: "leftright" },
      ]),
    });
    const runtime = editor as EditableEditorRuntimePort;
    const view = render(<EditorDocument editor={editor} />);

    act(() =>
      settleTextRange(editor, sourceFirst, 0, sourceLast, 3),
    );
    const clipboard = new MemoryDataTransfer();
    const copy = clipboardEvent("copy", clipboard);
    textRoot(view.container, sourceFirst).dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(true);
    expect(clipboard.getData("text/plain")).toBe("one\ntwo");

    act(() => {
      expect(editor.focusText(target, { offset: 4 }).status).not.toBe(
        "rejected",
      );
    });
    expectCanonicalCollapsedCaret(runtime, target, 4);
    const prePasteRootIds = editor.getRootBlockIds();
    const paste = clipboardEvent("paste", clipboard);
    act(() => runtime.readActiveTextView()!.dom.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(true);

    const pastedRoots = editor.getRootBlockIds();
    const targetIndex = pastedRoots.indexOf(target);
    const trailingId = pastedRoots[targetIndex + 1];
    if (!trailingId) throw new Error("Expected trailing pasted text block");
    expect(editor.readBlockPlainText(target, "paragraph")).toBe("leftone");
    expect(editor.readBlockPlainText(trailingId, "paragraph")).toBe(
      "tworight",
    );
    expectCanonicalCollapsedCaret(runtime, trailingId, 3);

    await waitFor(() => {
      expect(runtime.readActiveTextView()).not.toBeNull();
      expect(runtime.readTextSelectionOffset(trailingId)).toBe(3);
    });
    expect(runtime.readActiveTextView()?.state.selection.empty).toBe(true);
    expect(
      (
        editor as unknown as {
          readonly history: readonly unknown[];
        }
      ).history,
    ).toHaveLength(1);
    expect(view.container.querySelectorAll(".ProseMirror")).toHaveLength(1);
    expect(
      view.container.querySelectorAll('[contenteditable="true"]'),
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll('[data-editor-input-owner="true"]'),
    ).toHaveLength(1);

    const sharedView = runtime.readActiveTextView();
    if (!sharedView) throw new Error("Expected active shared editor view");
    act(() => sharedView.dispatch(sharedView.state.tr.insertText("!")));
    await waitFor(() =>
      expect(editor.readBlockPlainText(trailingId, "paragraph")).toBe(
        "two!right",
      ),
    );

    act(() => expect(editor.undo()).toEqual({ status: "applied" }));
    expect(editor.readBlockPlainText(trailingId, "paragraph")).toBe(
      "tworight",
    );
    expectCanonicalCollapsedCaret(runtime, trailingId, 3);

    act(() => expect(editor.undo()).toEqual({ status: "applied" }));
    expect(editor.getRootBlockIds()).toEqual(prePasteRootIds);
    expect(editor.readBlockPlainText(sourceFirst, "paragraph")).toBe("one");
    expect(editor.readBlockPlainText(sourceLast, "paragraph")).toBe("two");
    expect(editor.readBlockPlainText(target, "paragraph")).toBe("leftright");

    act(() => expect(editor.redo()).toEqual({ status: "applied" }));
    expect(editor.readBlockPlainText(target, "paragraph")).toBe("leftone");
    expect(editor.readBlockPlainText(trailingId, "paragraph")).toBe(
      "tworight",
    );
    expectCanonicalCollapsedCaret(runtime, trailingId, 3);
    act(() => expect(editor.redo()).toEqual({ status: "applied" }));
    expect(editor.readBlockPlainText(trailingId, "paragraph")).toBe(
      "two!right",
    );

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
  act(() => settleTextRange(editor, blockId, 1, blockId, 4));
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
  anchorBlockId: BlockId,
  anchorOffset: number,
  focusBlockId: BlockId,
  focusOffset: number,
) {
  const runtime = resolveEditorRuntimePort(editor);
  const anchor = point(anchorBlockId, anchorOffset);
  const focus = point(focusBlockId, focusOffset);
  const settled = runtime.selectionController.extendSelection(
    anchor,
    focus,
    runtime,
    runtime.getSelectionGraphRevision(),
    { publication: { kind: "silent" }, cause: "programmatic-edit" },
  );
  if (!settled) throw new Error("Expected canonical text selection");

  function point(pointBlockId: BlockId, offset: number) {
    const stable = createWebSelectionTextAnchorAtOffset({
      contentRuntime: runtime.contentRuntime,
      blockId: pointBlockId,
      blockType: "paragraph",
      textOffset: offset,
    });
    if (!stable.ok) throw new Error(stable.message);
    const result = createEditorLogicalSelectionPoint({
      graph: runtime,
      blockId: pointBlockId,
      textOffset: stable.textOffset,
      textAnchor: stable.textAnchor,
    });
    if (!result) throw new Error("Expected selection point");
    return result;
  }
}

function expectCanonicalCollapsedCaret(
  editor: EditableEditorRuntimePort,
  expectedBlockId: BlockId,
  expectedOffset: number,
): void {
  const canonical = editor.selectionController.getCanonicalSnapshot();
  expect(canonical.kind).toBe("document");
  if (canonical.kind !== "document") return;
  const { anchor, focus } = canonical.snapshot.documentSelection;
  expect(anchor).toMatchObject({
    blockId: expectedBlockId,
    textOffset: expectedOffset,
  });
  expect(focus).toMatchObject({
    blockId: expectedBlockId,
    textOffset: expectedOffset,
  });
}

function textRoot(container: HTMLElement, id: BlockId): HTMLElement {
  const root = container.querySelector<HTMLElement>(
    `[data-editor-block-id="${id}"] [data-editor-text-root="true"]`,
  );
  if (!root) throw new Error(`Expected mounted text root ${id}`);
  return root;
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
