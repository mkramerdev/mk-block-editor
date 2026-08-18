import type { EditorTypingTriggerDefinition } from "@repo/editor-web/typing-triggers";
import { isFirstDraftTypingTriggerAllowed } from "../typing-trigger-menu/index.ts";

export const firstDraftMentionTypingTrigger = Object.freeze({
  id: "mention",
  trigger: "@",
  isAllowed: isFirstDraftTypingTriggerAllowed,
} satisfies EditorTypingTriggerDefinition);
