"use client";

import { useSyncExternalStore } from "react";
import type {
  EditableEditor,
  EditorTypingTriggerSession,
} from "../document/contracts.ts";

/** Headless subscription adapter. Product code owns all presentation. */
export function useEditorTypingTriggerSession(
  editor: Pick<
    EditableEditor,
    "getTypingTriggerSession" | "subscribeTypingTriggerSession"
  >,
): EditorTypingTriggerSession | null {
  return useSyncExternalStore(
    editor.subscribeTypingTriggerSession,
    editor.getTypingTriggerSession,
    readServerTypingTriggerSession,
  );
}

function readServerTypingTriggerSession(): null {
  return null;
}
