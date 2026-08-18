import {
  EDITOR_REDO_COMMAND_ID,
  EDITOR_UNDO_COMMAND_ID,
} from "@repo/editor-react/editor";
import type { EditorKeyBinding } from "../runtime/definition/contracts.ts";

export { conventionalHistoryCommands } from "../runtime/commands/history-commands.ts";
export type {
  EditorKeyBinding,
  EditorKeyChord,
} from "../runtime/definition/contracts.ts";

export const conventionalHistoryKeybindings = Object.freeze([
  Object.freeze({
    key: "Mod-z",
    commandId: EDITOR_UNDO_COMMAND_ID,
    scope: "document" as const,
  }),
  Object.freeze({
    key: "Shift-Mod-z",
    commandId: EDITOR_REDO_COMMAND_ID,
    scope: "document" as const,
  }),
  Object.freeze({
    key: "Mod-y",
    commandId: EDITOR_REDO_COMMAND_ID,
    scope: "document" as const,
  }),
]) satisfies readonly EditorKeyBinding[];
