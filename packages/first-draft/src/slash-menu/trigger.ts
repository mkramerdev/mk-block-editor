import type { EditorTypingTriggerDefinition } from "@repo/editor-web/typing-triggers";
import { isFirstDraftTypingTriggerAllowed } from "../typing-trigger-menu/index.ts";

export const firstDraftSlashTypingTrigger = Object.freeze({
  id: "slash",
  trigger: "/",
  isAllowed: isFirstDraftTypingTriggerAllowed,
} satisfies EditorTypingTriggerDefinition);
