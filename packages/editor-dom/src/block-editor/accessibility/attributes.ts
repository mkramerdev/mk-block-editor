import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";

export interface BlockEditorAttributeOptions {
  blockId: BlockId;
  blockType: BlockType;
  label?: string;
  spellcheck?: boolean;
}

/** Attributes for the single neutral block-local rich-text editor. */
export function getBlockEditorAttributes(
  options: BlockEditorAttributeOptions,
): Record<string, string> {
  return {
    "data-block-id": options.blockId,
    "data-block-type": options.blockType,
    role: "textbox",
    "aria-multiline": "true",
    ...(options.label ? { "aria-label": options.label } : {}),
    spellcheck: String(options.spellcheck ?? false),
  };
}
