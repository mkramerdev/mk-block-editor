import { act, renderHook } from "@testing-library/react";
import type { BlockId, BlockType } from "@repo/editor-core/kernel";
import type {
  CommittedSelectionSnapshot,
  SelectionCompositionSessionSnapshot,
  SelectionController,
} from "@repo/editor-react/selection";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EditorRuntimePort } from "../../../runtime/document/render-port.ts";
import { useCommittedSelectionTextInput } from "./committed-selection-text-input.ts";

const semanticInsertion = vi.hoisted(() => vi.fn());

vi.mock("./committed-selection-input", () => ({
  applyTextInsertionToCommittedSelection: semanticInsertion,
}));

const blockId = "composition-host" as BlockId;
const blockType = "paragraph" as BlockType;

describe("committed selection browser input", () => {
  beforeEach(() => {
    semanticInsertion.mockReset();
  });

  it("claims supported text only after semantic acceptance", () => {
    const fixture = browserFixture();
    semanticInsertion
      .mockReturnValueOnce({ accepted: false, changed: false })
      .mockReturnValueOnce({ accepted: true, changed: true });
    const hook = renderHook(() =>
      useCommittedSelectionTextInput(fixture.options(null)),
    );

    const rejected = beforeInput("insertText", "first");
    act(() => fixture.shell.dispatchEvent(rejected));
    expect(rejected.defaultPrevented).toBe(false);

    const accepted = beforeInput("insertReplacementText", "second");
    act(() => fixture.shell.dispatchEvent(accepted));
    expect(accepted.defaultPrevented).toBe(true);
    expect(semanticInsertion).toHaveBeenCalledTimes(2);
    expect(semanticInsertion.mock.calls[1]?.[0]).toMatchObject({
      editor: fixture.editor,
      selection: fixture.selection,
      text: "second",
      expectedSelectionRevision: fixture.selection.revision,
    });

    hook.unmount();
    fixture.dispose();
  });

  it("leaves paste and composition beforeinput to their single owners", () => {
    const fixture = browserFixture();
    const hook = renderHook(() =>
      useCommittedSelectionTextInput(fixture.options(null)),
    );

    for (const inputType of [
      "insertFromPaste",
      "insertCompositionText",
      "insertFromComposition",
    ]) {
      const event = beforeInput(inputType, "draft");
      act(() => fixture.shell.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
    }
    expect(semanticInsertion).not.toHaveBeenCalled();

    hook.unmount();
    fixture.dispose();
  });

  it("leaves mounted input at a collapsed canonical caret to ProseMirror", () => {
    const fixture = browserFixture({ collapsed: true });
    const textRoot = document.createElement("div");
    textRoot.setAttribute("contenteditable", "true");
    textRoot.dataset.editorTextRoot = "true";
    const text = document.createTextNode("draft");
    textRoot.append(text);
    fixture.shell.append(textRoot);
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const hook = renderHook(() =>
      useCommittedSelectionTextInput(fixture.options(null)),
    );

    const event = beforeInput("insertText", "x");
    act(() => textRoot.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(semanticInsertion).not.toHaveBeenCalled();

    hook.unmount();
    selection?.removeAllRanges();
    fixture.dispose();
  });

  it("leaves a mounted native range to its real ProseMirror input owner", () => {
    const fixture = browserFixture();
    const textRoot = document.createElement("div");
    textRoot.setAttribute("contenteditable", "true");
    textRoot.dataset.editorTextRoot = "true";
    const text = document.createTextNode("draft");
    textRoot.append(text);
    fixture.shell.append(textRoot);
    const selection = document.getSelection();
    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, 4);
    selection?.removeAllRanges();
    selection?.addRange(range);
    const hook = renderHook(() =>
      useCommittedSelectionTextInput(fixture.options(null)),
    );

    const event = beforeInput("insertText", "x");
    act(() => textRoot.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(false);
    expect(semanticInsertion).not.toHaveBeenCalled();

    hook.unmount();
    selection?.removeAllRanges();
    fixture.dispose();
  });

  it("does not claim text or composition events from controls outside the block list", () => {
    const fixture = browserFixture();
    const outside = document.createElement("input");
    document.body.append(outside);
    const hook = renderHook(() =>
      useCommittedSelectionTextInput(fixture.options(null)),
    );

    const input = beforeInput("insertText", "outside");
    act(() => outside.dispatchEvent(input));
    act(() => outside.dispatchEvent(compositionEvent("compositionstart")));

    expect(input.defaultPrevented).toBe(false);
    expect(semanticInsertion).not.toHaveBeenCalled();
    expect(fixture.beginCompositionSession).not.toHaveBeenCalled();
    expect(fixture.pin).not.toHaveBeenCalled();

    hook.unmount();
    outside.remove();
    fixture.dispose();
  });

  it("leaves interactive controls inside the document to their native input owner", () => {
    const fixture = browserFixture();
    const objectUi = document.createElement("form");
    objectUi.dataset.editorObjectUi = "true";
    const input = document.createElement("input");
    objectUi.append(input);
    fixture.shell.append(objectUi);
    const hook = renderHook(() =>
      useCommittedSelectionTextInput(fixture.options(null)),
    );

    const text = beforeInput("insertText", "https://example.com/file.pdf");
    act(() => input.dispatchEvent(text));
    act(() => input.dispatchEvent(compositionEvent("compositionstart")));

    expect(text.defaultPrevented).toBe(false);
    expect(semanticInsertion).not.toHaveBeenCalled();
    expect(fixture.beginCompositionSession).not.toHaveBeenCalled();
    expect(fixture.pin).not.toHaveBeenCalled();

    hook.unmount();
    fixture.dispose();
  });

  it("pins once and lets compositionend perform the one final commit", async () => {
    const fixture = browserFixture();
    semanticInsertion.mockReturnValue({ accepted: true, changed: true });
    const hook = renderHook(() =>
      useCommittedSelectionTextInput(fixture.options(null)),
    );

    act(() =>
      fixture.shell.dispatchEvent(compositionEvent("compositionstart")),
    );
    expect(fixture.pin).toHaveBeenCalledTimes(1);
    expect(fixture.pin).toHaveBeenLastCalledWith(true);

    const insertFromComposition = beforeInput("insertFromComposition", "final");
    act(() => fixture.shell.dispatchEvent(insertFromComposition));
    expect(semanticInsertion).not.toHaveBeenCalled();

    fixture.completeWithDraft("final");
    await act(async () => {
      fixture.shell.dispatchEvent(compositionEvent("compositionend"));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(semanticInsertion).toHaveBeenCalledOnce();
    expect(semanticInsertion.mock.calls[0]?.[0]).toMatchObject({
      text: "final",
      expectedSelectionRevision: fixture.selection.revision,
      provenance: {
        kind: "typing",
        text: "final",
        inputType: "composition",
      },
    });
    expect(fixture.pin.mock.calls).toEqual([[true], [false]]);
    expect(fixture.restore).not.toHaveBeenCalled();

    hook.unmount();
    expect(fixture.pin).toHaveBeenCalledTimes(2);
    fixture.dispose();
  });

  it("starts composition from the canonical mounted caret", () => {
    const fixture = browserFixture({ missingCanonicalSelection: true });
    const hook = renderHook(() =>
      useCommittedSelectionTextInput(fixture.options(null)),
    );

    act(() =>
      fixture.shell.dispatchEvent(compositionEvent("compositionstart")),
    );

    expect(fixture.pin).toHaveBeenCalledWith(true);
    hook.unmount();
    fixture.dispose();
  });

  it("rejects composition focus attempts from a block outside the committed caret", () => {
    const fixture = browserFixture();
    const conflictingShell = document.createElement("div");
    conflictingShell.dataset.editorBlockShell = "true";
    conflictingShell.dataset.editorBlockId = "conflicting-composition-host";
    document.body.append(conflictingShell);
    const hook = renderHook(() =>
      useCommittedSelectionTextInput(fixture.options(null)),
    );

    act(() =>
      conflictingShell.dispatchEvent(compositionEvent("compositionstart")),
    );
    expect(fixture.beginCompositionSession).not.toHaveBeenCalled();
    expect(fixture.pin).not.toHaveBeenCalled();

    act(() =>
      fixture.shell.dispatchEvent(compositionEvent("compositionstart")),
    );
    expect(fixture.beginCompositionSession).toHaveBeenCalledOnce();
    expect(fixture.pin).toHaveBeenCalledOnce();

    act(() =>
      conflictingShell.dispatchEvent(compositionEvent("compositionstart")),
    );
    expect(fixture.beginCompositionSession).toHaveBeenCalledOnce();
    expect(fixture.pin).toHaveBeenCalledOnce();

    hook.unmount();
    conflictingShell.remove();
    fixture.dispose();
  });

  it("cancels, restores, and releases the composition host once", () => {
    const fixture = browserFixture();
    const hook = renderHook(() =>
      useCommittedSelectionTextInput(fixture.options(null)),
    );

    act(() =>
      fixture.shell.dispatchEvent(compositionEvent("compositionstart")),
    );
    act(() =>
      fixture.shell.dispatchEvent(compositionEvent("compositioncancel")),
    );

    expect(fixture.cancelCompositionSession).toHaveBeenCalledOnce();
    expect(fixture.restore).toHaveBeenCalledOnce();
    expect(fixture.pin.mock.calls).toEqual([[true], [false]]);

    hook.unmount();
    expect(fixture.restore).toHaveBeenCalledOnce();
    expect(fixture.pin).toHaveBeenCalledTimes(2);
    fixture.dispose();
  });
});

function browserFixture(
  options: {
    readonly missingCanonicalSelection?: boolean;
    readonly collapsed?: boolean;
  } = {},
) {
  const shell = document.createElement("div");
  shell.dataset.editorBlockShell = "true";
  shell.dataset.editorBlockId = blockId;
  document.body.append(shell);

  const selection = {
    revision: 4,
    endpoints: {
      anchor: {
        blockId,
        textOffset: 0,
        textAnchor: { kind: "block-relative-text" },
      },
      head: {
        blockId,
        textOffset: options.collapsed ? 0 : 2,
        textAnchor: { kind: "block-relative-text" },
      },
    },
    blocks: [{ blockId }],
  } as unknown as CommittedSelectionSnapshot;
  const pin = vi.fn();
  const restore = vi.fn();
  let composition: SelectionCompositionSessionSnapshot | null = null;
  let completedText: string | null = null;
  const cancelCompositionSession = vi.fn((revision: number) => {
    if (composition?.revision !== revision) return false;
    composition = null;
    return true;
  });
  const beginCompositionSession = vi.fn(() => {
    composition = {
      revision: 11,
    } as SelectionCompositionSessionSnapshot;
    return composition;
  });
  const controller = {
    getCommittedSnapshot: () =>
      options.missingCanonicalSelection ? null : selection,
    getCanonicalSnapshot: () => ({
      kind: "document",
      revision: selection.revision,
      snapshot: selection,
    }),
    getPresentationSnapshot: () => ({ composition }),
    beginCompositionSession,
    completeCompositionSession: (revision: number) => {
      if (composition?.revision !== revision) return null;
      composition = null;
      return {
        revision,
        frozenSelection: selection,
        selectionRevision: selection.revision,
        baseTokens: [],
        hasUnpublishedDraft: completedText !== null,
        latestText: completedText,
      };
    },
    cancelCompositionSession,
  } as unknown as SelectionController;
  const editor = {
    readActiveTextView: () => null,
    isTextProjectionActive: (id: BlockId) => id === blockId,
    setTextCompositionPinned: (id: BlockId, pinned: boolean) => {
      if (id === blockId) pin(pinned);
    },
    restoreCommittedTextProjectionAfterComposition: (id: BlockId) => {
      if (id === blockId) restore();
    },
    getSelectionGraphRevision: () => 3,
    getBlock: (id: BlockId) =>
      id === blockId
        ? {
            id: blockId,
            type: blockType,
            tombstone: false,
          }
        : null,
    contentRuntime: {
      readContentBaseToken: () => ({
        graphRevision: 3,
        blockId,
        blockType,
        contentRevision: 1,
      }),
    },
  } as unknown as EditorRuntimePort;

  return {
    shell,
    selection,
    editor,
    pin,
    restore,
    beginCompositionSession,
    cancelCompositionSession,
    options: (
      presentationComposition: SelectionCompositionSessionSnapshot | null,
    ) => ({
      enabled: true,
      listElement: shell,
      editor,
      selectionController: controller,
      composition: presentationComposition,
    }),
    completeWithDraft: (text: string) => {
      completedText = text;
    },
    dispose: () => shell.remove(),
  };
}

function beforeInput(inputType: string, data: string): InputEvent {
  return new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType,
    data,
  });
}

function compositionEvent(type: string): CompositionEvent {
  return new CompositionEvent(type, {
    bubbles: true,
    cancelable: true,
  });
}
