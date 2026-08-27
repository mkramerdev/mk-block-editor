import type { EditorKeybindingRuntimeContext } from "./document-resolver.ts";
import {
  hasConfiguredBlockKeybinding,
  resolveDocumentKeybinding,
} from "./document-resolver.ts";
import { readEditorKeybindingPlatform } from "./chord.ts";
import type { ResolvedNativeFocusTarget } from "../document/native-focus-coordinator.ts";

export interface EditorDocumentInputRouting {
  readonly keydown: (
    event: KeyboardEvent,
    nativeFocus: ResolvedNativeFocusTarget,
  ) => void;
  readonly beforeinput: (
    event: InputEvent,
    nativeFocus: ResolvedNativeFocusTarget,
  ) => void;
}

export function createEditorDocumentInputRouting(
  doc: Document,
  runtime: EditorKeybindingRuntimeContext,
): EditorDocumentInputRouting {
  const { definition, store, editor } = runtime;
  return {
    keydown: (event, nativeFocus) => {
      if (event.defaultPrevented || !nativeFocus) return;
      const platform = readEditorKeybindingPlatform(doc.defaultView);
      if (
        (event.isComposing && !isEditorHistoryKeyboardEvent(event)) ||
        hasConfiguredBlockKeybinding(event, runtime, platform) ||
        isGlobalSelectionKeyOwner(
          event,
          editor.selection.getSnapshot().kind !== "none",
        )
      ) {
        return;
      }
      const result = resolveDocumentKeybinding(
        event,
        { definition, store, editor },
        platform,
      );
      if (result.kind === "handled") event.preventDefault();
    },
    beforeinput: (event, nativeFocus) => {
      if (
        event.inputType !== "historyUndo" &&
        event.inputType !== "historyRedo"
      ) {
        return;
      }
      if (!nativeFocus) return;
      event.preventDefault();
      if (event.inputType === "historyUndo") {
        editor.undo();
      } else {
        editor.redo();
      }
    },
  };
}

function isEditorHistoryKeyboardEvent(event: KeyboardEvent): boolean {
  if (event.altKey || (!event.ctrlKey && !event.metaKey)) return false;
  const key = event.key.toLowerCase();
  return key === "z" || key === "y";
}

function isGlobalSelectionKeyOwner(
  event: KeyboardEvent,
  selectionOwned: boolean,
): boolean {
  if (!selectionOwned) return false;
  return (
    event.key === "Backspace" ||
    event.key === "Delete" ||
    (event.shiftKey &&
      (event.key === "ArrowLeft" ||
        event.key === "ArrowRight" ||
        event.key === "ArrowUp" ||
        event.key === "ArrowDown"))
  );
}
