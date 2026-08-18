import type { EditorTypingTriggerActivationContext } from "@repo/editor-web/typing-triggers";
import { firstDraftBlockModelDefinitions } from "../server/block-definitions.ts";

export function isFirstDraftTypingTriggerAllowed(
  context: EditorTypingTriggerActivationContext,
): boolean {
  if (
    firstDraftBlockModelDefinitions[
      context.blockType as keyof typeof firstDraftBlockModelDefinitions
    ]?.kind !== "text"
  ) {
    return false;
  }
  if (context.textBeforeTrigger.length === 0) return true;
  const preceding = Array.from(context.textBeforeTrigger).at(-1);
  return preceding === " " || preceding === "\n" || preceding === "\r";
}
