import { describe, expect, it, vi } from "vitest";
import { createBlockLocalProseMirrorState } from "../block-editor/state/create-block-local-state.ts";
import type { BlockDomKeyBehaviorEvent } from "../block-editor/options/key-behavior.ts";
import { createBlockKeyBindings } from "./block/bindings.ts";
import { TextSelection } from "../prosemirror/index.ts";
import { setCompositionMeta } from "../plugins/input/composition.ts";
import { createBlockLocalProseMirrorSchema } from "../schema/block-local/schema.ts";
import {
  testBlockId,
  textEnd,
  textStart,
  withCaret,
} from "../testing/block-editor-test-support.ts";

describe("block-local keymap", () => {
  it("does not expose semantic selection navigation or consume a range", () => {
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
    });
    const initial = createBlockLocalProseMirrorState({
      blockId: testBlockId,
      blockType: "paragraph",
      doc: "abcd",
    });
    const range = initial.apply(
      initial.tr.setSelection(TextSelection.create(initial.doc, 2, 4)),
    );

    expect(bindings.Home).toBeUndefined();
    expect(bindings.End).toBeUndefined();
    expect(bindings.Enter?.(range)).toBe(false);
    expect(bindings.Backspace?.(range)).toBe(false);
    expect(bindings.Delete?.(range)).toBe(false);
  });

  it("emits structural Enter with canonical offsets for a local text range", () => {
    const emitBlockKeyBehavior = vi.fn(() => ({
      ok: true as const,
      handled: true as const,
    }));
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "textBlock",
      emitBlockKeyBehavior,
    });
    const initial = createBlockLocalProseMirrorState({
      blockId: testBlockId,
      blockType: "textBlock",
      doc: "abcd",
    });
    const range = initial.apply(
      initial.tr.setSelection(TextSelection.create(initial.doc, 2, 4)),
    );

    expect(bindings.Enter?.(range)).toBe(true);
    expect(emitBlockKeyBehavior).toHaveBeenCalledOnce();
    expect(emitBlockKeyBehavior).toHaveBeenCalledWith({
      key: "enter",
      cursorOffset: 3,
      selectionRange: { from: 1, to: 3 },
    });
  });

  it("handles one Backspace at text start with one backspace key behavior", () => {
    const emitBlockKeyBehavior = vi.fn(() => ({
      ok: true as const,
      handled: true as const,
    }));
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
      emitBlockKeyBehavior,
    });
    const state = createBlockLocalProseMirrorState({
      blockId: testBlockId,
      blockType: "paragraph",
      doc: "world",
    });

    expect(bindings.Backspace?.(withCaret(state, textStart()))).toBe(true);

    expect(emitBlockKeyBehavior).toHaveBeenCalledTimes(1);
    expect(emitBlockKeyBehavior).toHaveBeenCalledWith({
      key: "backspace",
      cursorOffset: 0,
    });
  });

  it("leaves ordinary character deletion to the native block-local editing path", () => {
    const emitBlockKeyBehavior = vi.fn(() => ({
      ok: true as const,
      handled: true as const,
    }));
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
      emitBlockKeyBehavior,
    });
    let state = createBlockLocalProseMirrorState({
      blockId: testBlockId,
      blockType: "paragraph",
      doc: "world",
    });

    state = withCaret(state, 3);
    const dispatch = vi.fn();
    expect(bindings.Backspace?.(state, dispatch)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(state.doc.textContent).toBe("world");
    expect(emitBlockKeyBehavior).not.toHaveBeenCalled();
  });

  it("routes Delete only from the canonical end of a collapsed text block", () => {
    const keyEvents: BlockDomKeyBehaviorEvent[] = [];
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
      emitBlockKeyBehavior: recordKeyBehavior(keyEvents),
    });
    const state = createBlockLocalProseMirrorState({
      blockId: testBlockId,
      blockType: "paragraph",
      doc: "A😀B",
    });

    expect(bindings.Delete?.(withCaret(state, 2))).toBe(false);
    expect(bindings.Delete?.(withCaret(state, textEnd(state)))).toBe(true);
    expect(keyEvents).toStrictEqual([{ key: "delete", cursorOffset: 3 }]);
  });

  it("does not route structural Delete for a range or during composition", () => {
    const keyEvents: BlockDomKeyBehaviorEvent[] = [];
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
      emitBlockKeyBehavior: recordKeyBehavior(keyEvents),
    });
    const initial = createBlockLocalProseMirrorState({
      blockId: testBlockId,
      blockType: "paragraph",
      doc: "abc",
    });
    const range = initial.apply(
      initial.tr.setSelection(TextSelection.create(initial.doc, 2, 4)),
    );
    const composing = initial.apply(setCompositionMeta(initial.tr, true));

    expect(bindings.Delete?.(range)).toBe(false);
    expect(bindings.Delete?.(withCaret(composing, textEnd(composing)))).toBe(
      false,
    );
    expect(keyEvents).toStrictEqual([]);
  });

  it("uses canonical size for Unicode, inline atoms, and hard breaks", () => {
    const keyEvents: BlockDomKeyBehaviorEvent[] = [];
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
      emitBlockKeyBehavior: recordKeyBehavior(keyEvents),
    });
    const state = createMentionBlockState({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "mention", metadata: { id: "u1" } },
            { type: "hard_break" },
            { type: "text", text: "😀" },
          ],
        },
      ],
    });

    expect(bindings.Delete?.(withCaret(state, textEnd(state)))).toBe(true);
    expect(keyEvents).toStrictEqual([{ key: "delete", cursorOffset: 3 }]);
  });

  it("leaves Unicode grapheme deletion to the native block-local editing path", () => {
    const keyEvents: BlockDomKeyBehaviorEvent[] = [];
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
      emitBlockKeyBehavior: recordKeyBehavior(keyEvents),
    });
    let state = createBlockLocalProseMirrorState({
      blockId: testBlockId,
      blockType: "paragraph",
      doc: "a😀b",
    });

    state = state.apply(
      state.tr.setSelection(TextSelection.create(state.doc, 4)),
    );
    const dispatch = vi.fn();
    expect(bindings.Backspace?.(state, dispatch)).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
    expect(keyEvents).toStrictEqual([]);
  });

  it("routes Enter and Backspace through key behavior", () => {
    const emitBlockKeyBehavior = vi.fn(() => ({
      ok: true as const,
      handled: true as const,
    }));
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
      emitBlockKeyBehavior,
    });
    const state = createBlockLocalProseMirrorState({
      blockId: testBlockId,
      blockType: "paragraph",
      doc: "abc",
    });

    expect(bindings.Enter?.(withCaret(state, 2))).toBe(true);
    expect(bindings.Backspace?.(withCaret(state, textStart()))).toBe(true);

    expect(emitBlockKeyBehavior).toHaveBeenCalledTimes(2);
    expect(emitBlockKeyBehavior).toHaveBeenNthCalledWith(1, {
      key: "enter",
      cursorOffset: 1,
    });
    expect(emitBlockKeyBehavior).toHaveBeenNthCalledWith(2, {
      key: "backspace",
      cursorOffset: 0,
    });
  });

  it("emits Enter key behavior with the caret offset without mutating local content", () => {
    const keyEvents: BlockDomKeyBehaviorEvent[] = [];
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
      emitBlockKeyBehavior: recordKeyBehavior(keyEvents),
    });
    let state = withCaret(
      createBlockLocalProseMirrorState({
        blockId: testBlockId,
        blockType: "paragraph",
        doc: "abc",
      }),
      2,
    );

    expect(
      bindings.Enter?.(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);

    expect(state.doc.textContent).toBe("abc");
    expect(keyEvents).toStrictEqual([{ key: "enter", cursorOffset: 1 }]);
  });

  it("does not dispatch structural Enter while IME composition owns it", () => {
    const keyEvents: BlockDomKeyBehaviorEvent[] = [];
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
      emitBlockKeyBehavior: recordKeyBehavior(keyEvents),
    });
    const initial = createBlockLocalProseMirrorState({
      blockId: testBlockId,
      blockType: "paragraph",
      doc: "abc",
    });
    const composing = initial.apply(setCompositionMeta(initial.tr, true));

    expect(bindings.Enter?.(withCaret(composing, 2))).toBe(false);
    expect(keyEvents).toStrictEqual([]);
  });

  it("inserts literal newlines inside neutral rich-text blocks with Shift Enter", () => {
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
    });
    let state = withCaret(
      createBlockLocalProseMirrorState({
        blockId: testBlockId,
        blockType: "paragraph",
        doc: "ab",
      }),
      2,
    );

    expect(
      bindings["Shift-Enter"]?.(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);

    expect(state.doc.firstChild?.type.name).toBe("paragraph");
    expect(state.doc.firstChild?.child(1)?.type.name).toBe("hard_break");
    expect(state.doc.textContent).toBe("ab");
  });

  it("emits Backspace key behavior at the start of an empty block", () => {
    const keyEvents: BlockDomKeyBehaviorEvent[] = [];
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
      emitBlockKeyBehavior: recordKeyBehavior(keyEvents),
    });
    const emptyState = createBlockLocalProseMirrorState({
      blockId: testBlockId,
      blockType: "paragraph",
      doc: "",
    });

    expect(bindings.Backspace?.(withCaret(emptyState, textStart()))).toBe(true);
    expect(keyEvents).toStrictEqual([{ key: "backspace", cursorOffset: 0 }]);
  });

  it("deletes an adjacent inline atom through a block-local transaction", () => {
    const keyEvents: BlockDomKeyBehaviorEvent[] = [];
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
      emitBlockKeyBehavior: recordKeyBehavior(keyEvents),
    });
    const mentionDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "mention",
              metadata: { id: "u1" },
            },
            { type: "text", text: " " },
          ],
        },
      ],
    };
    const mentionState = createMentionBlockState(mentionDoc);
    let state = withCaret(mentionState, textEnd(mentionState));

    expect(
      bindings.Backspace?.(state, (transaction) => {
        state = state.apply(transaction);
      }),
    ).toBe(true);

    let deleteState = withCaret(
      createMentionBlockState(mentionDoc),
      textStart(),
    );
    expect(
      bindings.Delete?.(deleteState, (transaction) => {
        deleteState = deleteState.apply(transaction);
      }),
    ).toBe(true);

    expect(state.doc.textContent).toBe("");
    expect(deleteState.doc.textContent).toBe("");
    expect(keyEvents).toStrictEqual([]);
  });

  it("does not dispatch Backspace while IME composition owns it", () => {
    const keyEvents: BlockDomKeyBehaviorEvent[] = [];
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
      emitBlockKeyBehavior: recordKeyBehavior(keyEvents),
    });
    const initial = createBlockLocalProseMirrorState({
      blockId: testBlockId,
      blockType: "paragraph",
      doc: "abc",
    });
    const composing = initial.apply(setCompositionMeta(initial.tr, true));
    expect(bindings.Backspace?.(withCaret(composing, 2))).toBe(false);
    expect(keyEvents).toStrictEqual([]);
  });

  it("does not infer shortcuts from installed inline marks", () => {
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
    });
    expect(bindings["Mod-b"]).toBeUndefined();
    expect(bindings["Mod-i"]).toBeUndefined();
    expect(bindings["Mod-`"]).toBeUndefined();
  });

  it("does not install undo or redo shortcuts in the base block keymap", () => {
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
    });

    expect(bindings["Mod-z"]).toBeUndefined();
    expect(bindings["Shift-Mod-z"]).toBeUndefined();
    expect(bindings["Mod-y"]).toBeUndefined();
  });

  it("does not mutate local split content when the host refuses Enter", () => {
    const state = withCaret(
      createBlockLocalProseMirrorState({
        blockId: testBlockId,
        blockType: "paragraph",
        doc: "abc",
      }),
      2,
    );
    const bindings = createBlockKeyBindings({
      blockId: testBlockId,
      blockType: "paragraph",
      emitBlockKeyBehavior: () => ({
        ok: false,
        handled: true,
        reason: "rejected",
      }),
    });

    expect(
      bindings.Enter?.(state, () => {
        throw new Error("split should not dispatch local ProseMirror content");
      }),
    ).toBe(false);
    expect(state.doc.textContent).toBe("abc");
  });
});

function recordKeyBehavior(
  events: BlockDomKeyBehaviorEvent[],
): (event: BlockDomKeyBehaviorEvent) => { ok: true; handled: true } {
  return (event) => {
    events.push(event);
    return { ok: true, handled: true };
  };
}

const mentionSchema = createBlockLocalProseMirrorSchema({
  inlineAtoms: [{ type: "mention" }],
});

function createMentionBlockState(doc: Record<string, unknown>) {
  return createBlockLocalProseMirrorState({
    blockId: testBlockId,
    blockType: "paragraph",
    doc,
    schema: mentionSchema,
  });
}
