import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import type { BlockType } from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import {
  createCanonicalBlockFragment,
  createCanonicalBlockRecord,
  type CanonicalBlockFragment,
} from "@repo/editor-core/editing";

/** Materializes one browser-authored text input as ordinary canonical content. */
export function materializeCanonicalTextInput(options: {
  readonly text: string;
  readonly blockType: BlockType;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
}): CanonicalBlockFragment | null {
  if (options.text.length === 0) return null;
  const definition = options.blockDefinitions[options.blockType];
  if (!definition || definition.kind !== "text") return null;
  const content = createBlockRichTextContentFromPlainText(
    options.blockType,
    options.text,
  );
  const record = createCanonicalBlockRecord({
    type: options.blockType,
    content,
    plainText: options.text,
  });
  return createCanonicalBlockFragment({
    blocks: [record],
    rootBlockIds: [record.id],
    start: { kind: "text", blockId: record.id },
    end: { kind: "text", blockId: record.id },
    blockDefinitions: options.blockDefinitions,
  });
}
