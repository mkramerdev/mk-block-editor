import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  BlockDomKeyBehaviorKey,
  BlockDomKeyBehaviorResult,
  BlockDomTextSelectionRange,
} from "@repo/editor-dom/block-editor";
import type { EditorRuntimePort } from "./render-port.ts";

export interface ExecuteCoreBlockKeyBehaviorInput {
  readonly editor: EditorRuntimePort;
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly key: BlockDomKeyBehaviorKey;
  readonly cursorOffset: number;
  readonly selectionRange?: BlockDomTextSelectionRange;
  readonly isComposing?: boolean;
}

/** Executes canonical Enter, Backspace, and forward Delete core behavior. */
export function executeCoreBlockKeyBehavior(
  input: ExecuteCoreBlockKeyBehaviorInput,
): BlockDomKeyBehaviorResult {
  if (
    input.isComposing ||
    (input.key !== "enter" &&
      input.key !== "backspace" &&
      input.key !== "delete")
  ) {
    return { ok: false, handled: false, reason: "unhandled" };
  }
  if (
    input.key === "backspace" &&
    (input.cursorOffset !== 0 || input.selectionRange !== undefined)
  ) {
    throw new Error(
      "Same-block Backspace cannot enter the document structural command channel",
    );
  }
  if (input.key === "delete" && input.selectionRange !== undefined) {
    throw new Error(
      "Same-block Delete cannot enter the document structural command channel",
    );
  }
  return input.editor.executeCoreBlockKeyBehavior({
    blockId: input.blockId,
    blockType: input.blockType,
    key: input.key,
    cursorOffset: input.cursorOffset,
    ...(input.selectionRange === undefined
      ? {}
      : { selectionRange: input.selectionRange }),
  })
    ? { ok: true, handled: true }
    : { ok: false, handled: false, reason: "unhandled" };
}
