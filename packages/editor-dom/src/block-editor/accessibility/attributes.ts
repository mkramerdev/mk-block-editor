import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";

export type EditorAriaRole =
  | "document"
  | "textbox"
  | "heading"
  | "separator"
  | "group"
  | "grid"
  | "application";

export interface BlockAccessibilityContract {
  blockType: BlockType;
  role: EditorAriaRole;
  keyboardNavigable: boolean;
  screenReaderLabelRequired: boolean;
}

export interface BlockEditorAttributeOptions {
  blockId: BlockId;
  blockType: BlockType;
  label?: string;
  spellcheck?: boolean;
}

export function getBlockEditorAttributes(
  options: BlockEditorAttributeOptions,
): Record<string, string> {
  const contract = getBlockAccessibilityContract(options.blockType);
  const attributes: Record<string, string> = {
    "data-block-id": options.blockId,
    "data-block-type": options.blockType,
    role: contract.role,
    spellcheck: String(options.spellcheck ?? false),
  };
  if (contract.role === "textbox") {
    attributes["aria-multiline"] = "true";
  }
  if (contract.screenReaderLabelRequired || options.label) {
    attributes["aria-label"] = options.label ?? `${options.blockType} block`;
  }
  return attributes;
}

export function getBlockAccessibilityContract(
  blockType: BlockType,
): BlockAccessibilityContract {
  if (blockType === "heading") {
    return {
      blockType,
      role: "heading",
      keyboardNavigable: true,
      screenReaderLabelRequired: false,
    };
  }
  if (blockType === "divider") {
    return {
      blockType,
      role: "separator",
      keyboardNavigable: true,
      screenReaderLabelRequired: true,
    };
  }
  if (blockType === "database") {
    return {
      blockType,
      role: "application",
      keyboardNavigable: true,
      screenReaderLabelRequired: true,
    };
  }
  if (
    ["bulletListItem", "orderedListItem", "checklistItem"].includes(blockType)
  ) {
    return {
      blockType,
      role: "group",
      keyboardNavigable: true,
      screenReaderLabelRequired: true,
    };
  }
  if (
    ["callout", "toggle", "columns", "column", "tabs", "tabPane"].includes(
      blockType,
    )
  ) {
    return {
      blockType,
      role: "group",
      keyboardNavigable: true,
      screenReaderLabelRequired: true,
    };
  }
  return {
    blockType,
    role: "textbox",
    keyboardNavigable: true,
    screenReaderLabelRequired: false,
  };
}
