import { act, render, waitFor } from "@testing-library/react";
import type { BlockId } from "@repo/editor-core/kernel";
import { wholeSelection } from "@repo/editor-core/selection";
import { blockTextCoordinateCodec } from "@repo/editor-dom/caret";
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
const repeatedPasteDefinition = {
  ...editableCopyDefinition,
  blocks: {
    ...editableCopyDefinition.blocks,
    divider: {
      ...editableCopyDefinition.blocks.divider!,
      selection: wholeSelection(),
    },
  },
} satisfies typeof testEditableEditorDefinition;

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
  it("reidentifies the same canonical payload for every destination-owned paste", () => {
    const sourceFirst = "repeated-paste-source-first" as BlockId;
    const sourceLast = "repeated-paste-source-last" as BlockId;
    const firstTarget = "repeated-paste-target-one" as BlockId;
    const secondTarget = "repeated-paste-target-two" as BlockId;
    const editor = initializeEditableEditor({
      definition: repeatedPasteDefinition,
      snapshot: createTestEditorSnapshot([
        { id: sourceFirst, type: "paragraph", text: "one" },
        { id: sourceLast, type: "paragraph", text: "two" },
        { id: firstTarget, type: "divider" },
        { id: secondTarget, type: "divider" },
      ]),
    });
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    act(() => settleTextRange(editor, sourceFirst, 0, sourceLast, 3));
    const clipboard = new MemoryDataTransfer();
    textRoot(rendered.container, sourceFirst).dispatchEvent(
      clipboardEvent("copy", clipboard),
    );

    act(() => settleBlockSelection(editor, firstTarget));
    const firstPaste = clipboardEvent("paste", clipboard);
    act(() =>
      blockShell(rendered.container, firstTarget).dispatchEvent(firstPaste),
    );
    expect(firstPaste.defaultPrevented).toBe(true);
    const firstIds = editor
      .getRootBlockIds()
      .filter(
        (blockId) => ![sourceFirst, sourceLast, secondTarget].includes(blockId),
      );
    expect(firstIds).toHaveLength(2);
    expect(
      firstIds.map((blockId) =>
        editor.readBlockPlainText(blockId, "paragraph"),
      ),
    ).toEqual(["one", "two"]);

    act(() => settleBlockSelection(editor, secondTarget));
    const beforeSecondPaste = editor.getRootBlockIds();
    const secondPaste = clipboardEvent("paste", clipboard);
    act(() =>
      blockShell(rendered.container, secondTarget).dispatchEvent(secondPaste),
    );
    expect(secondPaste.defaultPrevented).toBe(true);
    const secondIds = editor
      .getRootBlockIds()
      .filter(
        (blockId) =>
          !beforeSecondPaste.includes(blockId) && blockId !== secondTarget,
      );
    expect(secondIds).toHaveLength(2);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4);
    expect(
      secondIds.map((blockId) =>
        editor.readBlockPlainText(blockId, "paragraph"),
      ),
    ).toEqual(["one", "two"]);
    expectCanonicalCollapsedCaret(runtime, secondIds[1]!, 3);
    expect(
      (editor as unknown as { readonly history: readonly unknown[] }).history,
    ).toHaveLength(2);

    const committedSecondIds = [...secondIds];
    act(() => expect(editor.undo()).toEqual({ status: "applied" }));
    expect(editor.getRootBlockIds()).toEqual(beforeSecondPaste);
    act(() => expect(editor.redo()).toEqual({ status: "applied" }));
    expect(editor.getRootBlockIds()).toEqual(
      expect.arrayContaining(committedSecondIds),
    );
    expect(
      editor
        .getRootBlockIds()
        .filter((blockId) => committedSecondIds.includes(blockId)),
    ).toEqual(committedSecondIds);

    rendered.unmount();
    editor.dispose();
  });

  it.each([
    {
      name: "plain text",
      clipboard: { "text/html": "", "text/plain": "imported" },
      expectedText: "imported",
    },
    {
      name: "semantic HTML",
      clipboard: {
        "text/html": "<p>imported</p>",
        "text/plain": "fallback",
      },
      expectedText: "imported",
    },
  ] satisfies readonly {
    readonly name: string;
    readonly clipboard: Readonly<Record<string, string>>;
    readonly expectedText: string;
  }[])(
    "reidentifies repeated $name imports per paste attempt",
    ({ clipboard, expectedText }) => {
      const firstTarget = `repeated-${expectedText}-target-one` as BlockId;
      const secondTarget = `repeated-${expectedText}-target-two` as BlockId;
      const editor = initializeEditableEditor({
        definition: repeatedPasteDefinition,
        snapshot: createTestEditorSnapshot([
          { id: firstTarget, type: "divider" },
          { id: secondTarget, type: "divider" },
        ]),
      });
      const rendered = render(<EditorDocument editor={editor} />);
      const payload = new MemoryDataTransfer(clipboard);

      act(() => settleBlockSelection(editor, firstTarget));
      const firstPaste = clipboardEvent("paste", payload);
      act(() =>
        blockShell(rendered.container, firstTarget).dispatchEvent(firstPaste),
      );
      expect(firstPaste.defaultPrevented).toBe(true);
      const firstId = editor
        .getRootBlockIds()
        .find((blockId) => blockId !== secondTarget);
      if (!firstId) throw new Error("Expected first imported block");
      expect(editor.readBlockPlainText(firstId, "paragraph")).toBe(
        expectedText,
      );

      act(() => settleBlockSelection(editor, secondTarget));
      const secondPaste = clipboardEvent("paste", payload);
      act(() =>
        blockShell(rendered.container, secondTarget).dispatchEvent(secondPaste),
      );
      expect(secondPaste.defaultPrevented).toBe(true);
      const secondId = editor
        .getRootBlockIds()
        .find((blockId) => blockId !== firstId);
      if (!secondId) throw new Error("Expected second imported block");
      expect(secondId).not.toBe(firstId);
      expect(editor.readBlockPlainText(secondId, "paragraph")).toBe(
        expectedText,
      );
      expect(
        (editor as unknown as { readonly history: readonly unknown[] }).history,
      ).toHaveLength(2);

      rendered.unmount();
      editor.dispose();
    },
  );

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

    act(() => settleTextRange(editor, sourceFirst, 0, sourceLast, 3));
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
    expect(editor.readBlockPlainText(trailingId, "paragraph")).toBe("tworight");
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
    expect(editor.readBlockPlainText(trailingId, "paragraph")).toBe("tworight");
    expectCanonicalCollapsedCaret(runtime, trailingId, 3);

    act(() => expect(editor.undo()).toEqual({ status: "applied" }));
    expect(editor.getRootBlockIds()).toEqual(prePasteRootIds);
    expect(editor.readBlockPlainText(sourceFirst, "paragraph")).toBe("one");
    expect(editor.readBlockPlainText(sourceLast, "paragraph")).toBe("two");
    expect(editor.readBlockPlainText(target, "paragraph")).toBe("leftright");

    act(() => expect(editor.redo()).toEqual({ status: "applied" }));
    expect(editor.readBlockPlainText(target, "paragraph")).toBe("leftone");
    expect(editor.readBlockPlainText(trailingId, "paragraph")).toBe("tworight");
    expectCanonicalCollapsedCaret(runtime, trailingId, 3);
    act(() => expect(editor.redo()).toEqual({ status: "applied" }));
    expect(editor.readBlockPlainText(trailingId, "paragraph")).toBe(
      "two!right",
    );

    view.unmount();
    editor.dispose();
  });
});

describe("editable canonical clipboard cut", () => {
  it.each(["forward", "backward"] as const)(
    "settles a %s partial cross-block cut at the canonical start in every selection layer",
    async (direction) => {
      const first = `cut-${direction}-first` as BlockId;
      const middle = `cut-${direction}-middle` as BlockId;
      const last = `cut-${direction}-last` as BlockId;
      const editor = initializeEditableEditor({
        definition: editableCopyDefinition,
        snapshot: createTestEditorSnapshot([
          { id: first, type: "paragraph", text: "alpha" },
          { id: middle, type: "paragraph", text: "middle" },
          { id: last, type: "paragraph", text: "omega" },
        ]),
      });
      const runtime = editor as EditableEditorRuntimePort;
      const rendered = render(<EditorDocument editor={editor} />);

      act(() => {
        expect(editor.focusText(last, { offset: 2 }).status).not.toBe(
          "rejected",
        );
      });
      const sharedView = runtime.readActiveTextView();
      if (!sharedView) throw new Error("Expected active shared editor view");
      act(() => {
        if (direction === "forward") {
          settleTextRange(editor, first, 2, last, 2, "backward", "forward");
        } else {
          settleTextRange(editor, last, 2, first, 2, "forward", "backward");
        }
      });
      if (direction === "forward") {
        expectCanonicalRange(runtime, first, 2, last, 2);
      } else {
        expectCanonicalRange(runtime, last, 2, first, 2);
      }

      let contentAtFirstClipboardWrite: readonly string[] | null = null;
      const clipboard = new MemoryDataTransfer({}, () => {
        contentAtFirstClipboardWrite ??= [
          editor.readBlockPlainText(first, "paragraph"),
          editor.readBlockPlainText(middle, "paragraph"),
          editor.readBlockPlainText(last, "paragraph"),
        ];
      });
      const cut = clipboardEvent("cut", clipboard);
      act(() => sharedView.dom.dispatchEvent(cut));

      expect(cut.defaultPrevented).toBe(true);
      expect(contentAtFirstClipboardWrite).toEqual([
        "alpha",
        "middle",
        "omega",
      ]);
      expect(clipboard.getData("text/plain")).toBe("pha\nmiddle\nom");
      expect(editor.getRootBlockIds()).toEqual([first]);
      expect(editor.readBlockPlainText(first, "paragraph")).toBe("alega");
      expect(editor.getBlock(last)).toBeNull();
      expectCanonicalCollapsedCaret(runtime, first, 2);

      await waitFor(() => {
        expect(runtime.readActiveTextView()).toBe(sharedView);
        expect(sharedView.dom.parentElement).toBe(
          textSlot(rendered.container, first),
        );
        expect(runtime.readTextSelectionOffset(first)).toBe(2);
      });
      expect(runtime.isTextProjectionActive(first)).toBe(true);
      expect(runtime.isTextProjectionActive(last)).toBe(false);
      expect(textProjection(rendered.container, first).hidden).toBe(true);
      expect(sharedView.state.selection.empty).toBe(true);
      expect(
        blockTextCoordinateCodec.proseMirrorPositionToCanonicalOffset(
          sharedView.state.selection.head,
          sharedView.state,
        ),
      ).toBe(2);

      const nativeSelection = document.getSelection();
      expect(nativeSelection?.isCollapsed).toBe(true);
      expect(nativeSelection?.focusNode).not.toBeNull();
      expect(sharedView.dom.contains(nativeSelection!.focusNode)).toBe(true);
      expect(
        blockTextCoordinateCodec.domPointToCanonicalOffset(
          sharedView,
          nativeSelection!.focusNode!,
          nativeSelection!.focusOffset,
        ),
      ).toBe(2);
      expect(rendered.container.querySelectorAll(".ProseMirror")).toHaveLength(
        1,
      );
      expect(
        rendered.container.querySelectorAll('[contenteditable="true"]'),
      ).toHaveLength(1);
      expect(
        rendered.container.querySelectorAll('[data-editor-input-owner="true"]'),
      ).toHaveLength(1);
      expect(
        (
          editor as unknown as {
            readonly history: readonly unknown[];
          }
        ).history,
      ).toHaveLength(1);
      expectRecordedDocumentSelectionBefore(
        editor,
        direction === "forward" ? first : last,
        2,
        direction === "forward" ? last : first,
        2,
      );

      act(() => expect(editor.undo()).toEqual({ status: "applied" }));
      expect(editor.getRootBlockIds()).toEqual([first, middle, last]);
      expect(editor.readBlockPlainText(first, "paragraph")).toBe("alpha");
      expect(editor.readBlockPlainText(middle, "paragraph")).toBe("middle");
      expect(editor.readBlockPlainText(last, "paragraph")).toBe("omega");
      expectCanonicalRangeDirection(runtime, direction);

      act(() => expect(editor.redo()).toEqual({ status: "applied" }));
      expect(editor.getRootBlockIds()).toEqual([first]);
      expect(editor.readBlockPlainText(first, "paragraph")).toBe("alega");
      expect(editor.getBlock(last)).toBeNull();
      expectCanonicalCollapsedCaret(runtime, first, 2);
      await waitFor(() => {
        expect(runtime.readActiveTextView()).toBe(sharedView);
        expect(sharedView.dom.parentElement).toBe(
          textSlot(rendered.container, first),
        );
        expect(runtime.readTextSelectionOffset(first)).toBe(2);
      });

      rendered.unmount();
      editor.dispose();
    },
  );

  it("does not mutate twice when the keyboard fallback is followed by a native cut event", async () => {
    const first = "keyboard-cut-first" as BlockId;
    const last = "keyboard-cut-last" as BlockId;
    const editor = initializeEditableEditor({
      definition: editableCopyDefinition,
      snapshot: createTestEditorSnapshot([
        { id: first, type: "paragraph", text: "alpha" },
        { id: last, type: "paragraph", text: "omega" },
      ]),
    });
    const runtime = editor as EditableEditorRuntimePort;
    const rendered = render(<EditorDocument editor={editor} />);
    act(() => {
      expect(editor.focusText(last, { offset: 2 }).status).not.toBe("rejected");
      settleTextRange(editor, first, 2, last, 2, "backward", "forward");
    });
    const sharedView = runtime.readActiveTextView();
    if (!sharedView) throw new Error("Expected active shared editor view");

    const shortcut = new KeyboardEvent("keydown", {
      key: "x",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    act(() => sharedView.dom.dispatchEvent(shortcut));
    expect(editor.readBlockPlainText(first, "paragraph")).toBe("alega");
    expect(editor.getBlock(last)).toBeNull();
    expectCanonicalCollapsedCaret(runtime, first, 2);

    const nativeCut = clipboardEvent("cut", new MemoryDataTransfer());
    act(() => sharedView.dom.dispatchEvent(nativeCut));
    expect(editor.readBlockPlainText(first, "paragraph")).toBe("alega");
    expect(editor.getBlock(last)).toBeNull();
    expectCanonicalCollapsedCaret(runtime, first, 2);
    expect(
      (
        editor as unknown as {
          readonly history: readonly unknown[];
        }
      ).history,
    ).toHaveLength(1);
    await waitFor(() => expect(runtime.readTextSelectionOffset(first)).toBe(2));

    rendered.unmount();
    editor.dispose();
  });

  it.each(["Backspace", "Delete"] as const)(
    "uses the Cut composition for cross-block %s without replacing block-local deletion",
    async (key) => {
      const first = `range-${key}-first` as BlockId;
      const last = `range-${key}-last` as BlockId;
      const editor = initializeEditableEditor({
        definition: editableCopyDefinition,
        snapshot: createTestEditorSnapshot([
          { id: first, type: "paragraph", text: "alpha" },
          { id: last, type: "paragraph", text: "omega" },
        ]),
      });
      const runtime = editor as EditableEditorRuntimePort;
      const rendered = render(<EditorDocument editor={editor} />);
      act(() => {
        expect(editor.focusText(last, { offset: 2 }).status).not.toBe(
          "rejected",
        );
        settleTextRange(editor, first, 2, last, 2, "backward", "forward");
      });
      const sharedView = runtime.readActiveTextView();
      if (!sharedView) throw new Error("Expected active shared editor view");
      const event = new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
      });

      act(() => sharedView.dom.dispatchEvent(event));

      expect(event.defaultPrevented).toBe(true);
      expect(editor.getRootBlockIds()).toEqual([first]);
      expect(editor.readBlockPlainText(first, "paragraph")).toBe("alega");
      expect(editor.getBlock(last)).toBeNull();
      expectCanonicalCollapsedCaret(runtime, first, 2);
      expect(
        (
          editor as unknown as {
            readonly history: readonly unknown[];
          }
        ).history,
      ).toHaveLength(1);
      await waitFor(() =>
        expect(runtime.readTextSelectionOffset(first)).toBe(2),
      );

      rendered.unmount();
      editor.dispose();
    },
  );
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
  anchorAffinity: "forward" | "backward" | null = null,
  focusAffinity: "forward" | "backward" | null = null,
) {
  const runtime = resolveEditorRuntimePort(editor);
  const anchor = point(anchorBlockId, anchorOffset, anchorAffinity);
  const focus = point(focusBlockId, focusOffset, focusAffinity);
  const settled = runtime.selectionController.extendSelection(
    anchor,
    focus,
    runtime,
    runtime.getSelectionGraphRevision(),
    { publication: { kind: "silent" }, cause: "programmatic-edit" },
  );
  if (!settled) throw new Error("Expected canonical text selection");

  function point(
    pointBlockId: BlockId,
    offset: number,
    affinity: "forward" | "backward" | null,
  ) {
    const stable = createWebSelectionTextAnchorAtOffset({
      contentRuntime: runtime.contentRuntime,
      blockId: pointBlockId,
      blockType: "paragraph",
      textOffset: offset,
      affinity,
    });
    if (!stable.ok) throw new Error(stable.message);
    const result = createEditorLogicalSelectionPoint({
      graph: runtime,
      blockId: pointBlockId,
      textOffset: stable.textOffset,
      textAnchor: stable.textAnchor,
      affinity,
    });
    if (!result) throw new Error("Expected selection point");
    return result;
  }
}

function settleBlockSelection(editor: Editor, blockId: BlockId): void {
  const runtime = resolveEditorRuntimePort(editor);
  const point = createEditorLogicalSelectionPoint({
    graph: runtime,
    blockId,
    textOffset: 0,
  });
  if (!point) throw new Error(`Expected block selection point ${blockId}`);
  const settled = runtime.selectionController.extendSelection(
    point,
    point,
    runtime,
    runtime.getSelectionGraphRevision(),
    { publication: { kind: "silent" }, cause: "programmatic-edit" },
  );
  if (!settled)
    throw new Error(`Expected canonical block selection ${blockId}`);
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

function expectCanonicalRange(
  editor: EditableEditorRuntimePort,
  anchorBlockId: BlockId,
  anchorOffset: number,
  focusBlockId: BlockId,
  focusOffset: number,
): void {
  const canonical = editor.selectionController.getCanonicalSnapshot();
  expect(canonical.kind).toBe("document");
  if (canonical.kind !== "document") return;
  expect(canonical.snapshot.documentSelection.anchor).toMatchObject({
    blockId: anchorBlockId,
    textOffset: anchorOffset,
  });
  expect(canonical.snapshot.documentSelection.focus).toMatchObject({
    blockId: focusBlockId,
    textOffset: focusOffset,
  });
}

function expectCanonicalRangeDirection(
  editor: EditableEditorRuntimePort,
  direction: "forward" | "backward",
): void {
  const canonical = editor.selectionController.getCanonicalSnapshot();
  expect(canonical.kind).toBe("document");
  if (canonical.kind !== "document") return;
  expect(canonical.snapshot.documentSelection.direction).toBe(direction);
  expect(canonical.snapshot.documentSelection.anchor).not.toEqual(
    canonical.snapshot.documentSelection.focus,
  );
}

function expectRecordedDocumentSelectionBefore(
  editor: Editor,
  anchorBlockId: BlockId,
  anchorOffset: number,
  focusBlockId: BlockId,
  focusOffset: number,
): void {
  const history = (
    editor as unknown as {
      readonly history: readonly {
        readonly selectionBefore:
          | { readonly kind: "none" }
          | {
              readonly kind: "document";
              readonly selection: {
                readonly anchor: {
                  readonly blockId: BlockId;
                  readonly textOffset: number;
                };
                readonly focus: {
                  readonly blockId: BlockId;
                  readonly textOffset: number;
                };
              };
            };
      }[];
    }
  ).history;
  const recorded = history[0]?.selectionBefore;
  expect(recorded?.kind).toBe("document");
  if (recorded?.kind !== "document") return;
  expect(recorded.selection.anchor).toMatchObject({
    blockId: anchorBlockId,
    textOffset: anchorOffset,
  });
  expect(recorded.selection.focus).toMatchObject({
    blockId: focusBlockId,
    textOffset: focusOffset,
  });
}

function textRoot(container: HTMLElement, id: BlockId): HTMLElement {
  const root = container.querySelector<HTMLElement>(
    `[data-editor-block-id="${id}"] [data-editor-text-root="true"]`,
  );
  if (!root) throw new Error(`Expected mounted text root ${id}`);
  return root;
}

function textSlot(container: HTMLElement, id: BlockId): HTMLElement {
  const slot = container.querySelector<HTMLElement>(
    `[data-editor-block-id="${id}"] [data-editor-text-slot="true"]`,
  );
  if (!slot) throw new Error(`Expected mounted text slot ${id}`);
  return slot;
}

function textProjection(container: HTMLElement, id: BlockId): HTMLElement {
  const projection = container.querySelector<HTMLElement>(
    `[data-editor-block-id="${id}"] [data-editor-text-projection="true"]`,
  );
  if (!projection) throw new Error(`Expected mounted text projection ${id}`);
  return projection;
}

function blockShell(container: HTMLElement, id: BlockId): HTMLElement {
  const shell = container.querySelector<HTMLElement>(
    `[data-editor-block-id="${id}"]`,
  );
  if (!shell) throw new Error(`Expected mounted block shell ${id}`);
  return shell;
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

  constructor(
    initial: Readonly<Record<string, string>> = {},
    private readonly onSetData?: () => void,
  ) {
    for (const [format, value] of Object.entries(initial)) {
      this.values.set(format, value);
    }
  }

  setData(format: string, value: string): void {
    this.onSetData?.();
    this.values.set(format, value);
  }

  getData(format: string): string {
    return this.values.get(format) ?? "";
  }

  asDataTransfer(): DataTransfer {
    return this as unknown as DataTransfer;
  }
}
