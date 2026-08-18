import type { EditorKeybindingRuntimeContext } from "./document-resolver.ts";
import {
  hasConfiguredBlockKeybinding,
  resolveDocumentKeybinding,
} from "./document-resolver.ts";
import { readEditorKeybindingPlatform } from "./chord.ts";

export interface EditorDocumentInputRouting {
  readonly keydown: (event: KeyboardEvent) => void;
  readonly beforeinput: (event: InputEvent) => void;
}

export function createEditorDocumentInputRouting(
  doc: Document,
  runtime: EditorKeybindingRuntimeContext,
): EditorDocumentInputRouting {
  const { definition, store, editor } = runtime;
  return {
    keydown: (event) => {
      if (event.defaultPrevented) return;
      const target = event.target;
      if (
        !editor.editable ||
        !editor.ownsNativeFocusTarget(target) ||
        !editor.ownsActiveElement(doc)
      ) {
        return;
      }
      const editableBlockTarget = editor.ownsNativeFocusTarget(target);
      const platform = readEditorKeybindingPlatform(doc.defaultView);
      if (
        (editableBlockTarget
          ? (event.isComposing && !isEditorHistoryKeyboardEvent(event)) ||
            hasConfiguredBlockKeybinding(event, runtime, platform)
          : isNativeTextInputTarget(target)) ||
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
    beforeinput: (event) => {
      if (
        !editor.editable ||
        !editor.ownsNativeFocusTarget(event.target) ||
        !editor.ownsActiveElement(doc)
      ) {
        return;
      }
      if (
        event.inputType !== "historyUndo" &&
        event.inputType !== "historyRedo"
      ) {
        return;
      }
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

function isNativeTextInputTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("input, textarea, select, [contenteditable='true']") !== null
  );
}
