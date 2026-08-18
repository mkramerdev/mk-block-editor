import {
  createCanonicalBlockFragment,
  type CanonicalBlockFragment,
} from "@repo/editor-core/editing";
import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import { createBlockRecord } from "@repo/editor-core/metadata";
import {
  hasInvalidClipboardText,
  resolveEditorClipboardImportLimits,
  utf8ByteLength,
} from "../limits.ts";
import type { PlainTextFragmentImportOptions } from "../model/parser-options.ts";

export function parsePlainTextCanonicalFragment(
  plainText: string,
  options: PlainTextFragmentImportOptions,
): CanonicalBlockFragment | null {
  if (plainText.length === 0) return null;
  const limits = resolveEditorClipboardImportLimits(options.limits);
  if (
    utf8ByteLength(plainText) > limits.maxPlainTextBytes ||
    hasInvalidClipboardText(plainText)
  )
    return null;
  const lines = normalizeImportedPlainText(plainText).split("\n");
  if (lines.length > limits.maxFragmentBlocks) return null;
  const definition = options.blockDefinitions[options.blockType];
  if (!definition || definition.kind !== "text") return null;
  const blocks = lines.map((line) => {
    const block = createBlockRecord({ type: options.blockType });
    return {
      id: block.id,
      type: block.type,
      parentId: null,
      content: createBlockRichTextContentFromPlainText(block.type, line),
      plainText: line,
    };
  });
  return createCanonicalBlockFragment({
    blocks,
    rootBlockIds: blocks.map((block) => block.id),
    start: { kind: "text", blockId: blocks[0]!.id },
    end: { kind: "text", blockId: blocks[blocks.length - 1]!.id },
    blockDefinitions: options.blockDefinitions,
  });
}

export function normalizeImportedPlainText(plainText: string): string {
  return plainText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u00a0/g, " ")
    .trim();
}
