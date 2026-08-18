import type { BlockLocalDomPluginOptions } from "../../block-editor/options/plugin-options.ts";
import {
  proseMirrorPositionToCanonicalOffset,
  readBlockTextContentSize,
} from "../../caret/coordinates/offset-codec.ts";
import { keymap, type Command } from "../../prosemirror/index.ts";
import { isComposing } from "../../plugins/input/composition.ts";
import { emitKeyBehavior } from "./host-behavior.ts";
import {
  inlineAtomDeleteRangeBackward,
  inlineAtomDeleteRangeForward,
} from "./inline-atom-delete.ts";
import { insertSoftBreak } from "./soft-break.ts";

export type BlockKeyBindings = Record<string, Command>;

export function createBlockKeyBindings(
  options: BlockLocalDomPluginOptions,
): BlockKeyBindings {
  return {
    Enter(state) {
      if (
        !state.selection.$from.parent.inlineContent ||
        !state.selection.$from.sameParent(state.selection.$to)
      )
        return false;
      const composing = isComposing(state);
      if (composing) return false;
      if (!state.selection.empty) return false;
      return emitKeyBehavior(
        options,
        state,
        "enter",
        proseMirrorPositionToCanonicalOffset(state.selection.head, state),
      );
    },
    Backspace(state, dispatch) {
      if (
        !state.selection.$from.parent.inlineContent ||
        !state.selection.$from.sameParent(state.selection.$to)
      )
        return false;
      if (isComposing(state)) return false;
      const inlineAtomRange = inlineAtomDeleteRangeBackward(state);
      if (inlineAtomRange) {
        dispatch?.(state.tr.delete(inlineAtomRange.from, inlineAtomRange.to));
        return true;
      }

      // Ordinary text/range deletion is claimed from beforeinput using the
      // browser-provided target range. Unsupported browsers retain native DOM
      // editing and ProseMirror's compatibility recovery path.
      if (!state.selection.empty) return false;
      if (state.selection.$from.parentOffset > 0) return false;
      return emitKeyBehavior(options, state, "backspace", 0);
    },
    Delete(state, dispatch) {
      if (
        !state.selection.$from.parent.inlineContent ||
        !state.selection.$from.sameParent(state.selection.$to)
      )
        return false;
      if (isComposing(state)) return false;
      const inlineAtomRange = inlineAtomDeleteRangeForward(state);
      if (inlineAtomRange) {
        dispatch?.(state.tr.delete(inlineAtomRange.from, inlineAtomRange.to));
        return true;
      }
      if (!state.selection.empty) return false;
      if (
        state.selection.$from.parentOffset !==
        state.selection.$from.parent.content.size
      )
        return false;
      const cursorOffset = readBlockTextContentSize(state);
      return emitKeyBehavior(options, state, "delete", cursorOffset);
    },
    Tab(state) {
      return emitKeyBehavior(
        options,
        state,
        "tab",
        proseMirrorPositionToCanonicalOffset(state.selection.head, state),
      );
    },
    "Shift-Tab"(state) {
      return emitKeyBehavior(
        options,
        state,
        "shiftTab",
        proseMirrorPositionToCanonicalOffset(state.selection.head, state),
      );
    },
    "Shift-Enter": insertSoftBreak,
  };
}

export function createBlockKeymap(options: BlockLocalDomPluginOptions) {
  return keymap(createBlockKeyBindings(options));
}
