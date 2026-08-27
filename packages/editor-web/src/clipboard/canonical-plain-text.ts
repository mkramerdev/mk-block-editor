import type { BlockType } from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type {
  CanonicalBlockFragment,
  CanonicalBlockRecord,
} from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  createCanonicalBlockFragment,
  createCanonicalBlockRecord,
} from "@repo/editor-core/editing";
import { createBlockRecord } from "@repo/editor-core/metadata";
import {
  createBlockRichTextContentFromPlainText,
  richTextDocumentWithInlineContent,
  type RichTextInlineNodeJson,
} from "@repo/editor-core/content/rich-text";
import type {
  EditorClipboardImportLimits,
  EditorPlainTextExportContext,
  EditorPlainTextExportHandler,
  EditorPlainTextImportHandler,
} from "./codec-contracts.ts";
import {
  hasInvalidClipboardText,
  resolveEditorClipboardImportLimits,
  utf8ByteLength,
} from "./limits.ts";
import {
  readValidatedClipboardFragment,
  validateClipboardFragment,
  type ValidatedClipboardFragment,
} from "./validated-fragment.ts";

export interface CanonicalPlainTextCodecOptions {
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly defaultTextBlockType: BlockType;
  readonly importHandlers?: readonly EditorPlainTextImportHandler[];
  readonly exportHandlers?: readonly EditorPlainTextExportHandler[];
  readonly limits?: Partial<EditorClipboardImportLimits>;
}

export function importCanonicalFragmentPlainText(
  text: string,
  options: CanonicalPlainTextCodecOptions,
): CanonicalBlockFragment | null {
  const limits = resolveEditorClipboardImportLimits(options.limits);
  if (
    utf8ByteLength(text) > limits.maxPlainTextBytes ||
    hasInvalidClipboardText(text)
  )
    return null;
  const definition = options.blockDefinitions[options.defaultTextBlockType];
  if (!definition || definition.kind !== "text") return null;
  const context = {
    blockDefinitions: options.blockDefinitions,
    defaultTextBlockType: options.defaultTextBlockType,
    limits,
  };
  for (const handler of options.importHandlers ?? []) {
    const imported = handler.importText(text, context);
    if (imported) return imported;
  }
  if (text.length === 0) return null;
  const lines = normalizeLineEndings(text).split("\n");
  if (lines.length > limits.maxFragmentBlocks) return null;
  const blocks = lines.map((line) => {
    const block = createBlockRecord({ type: options.defaultTextBlockType });
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

export function exportCanonicalFragmentPlainText(
  fragment: CanonicalBlockFragment,
  options: CanonicalPlainTextCodecOptions,
): string {
  return exportValidatedCanonicalFragmentPlainText(
    validateClipboardFragment(fragment, options.blockDefinitions),
    options,
  );
}

/** Package-internal exporter for a fragment validated in this operation. */
export function exportValidatedCanonicalFragmentPlainText(
  validated: ValidatedClipboardFragment,
  options: CanonicalPlainTextCodecOptions,
): string {
  const fragment = readValidatedClipboardFragment(validated);
  const childrenByParentId = new Map<BlockId, CanonicalBlockRecord[]>();
  const blockById = new Map(fragment.blocks.map((block) => [block.id, block]));
  for (const block of fragment.blocks) {
    if (block.parentId === null) continue;
    const children = childrenByParentId.get(block.parentId) ?? [];
    children.push(block);
    childrenByParentId.set(block.parentId, children);
  }
  const context: EditorPlainTextExportContext = {
    fragment,
    blockDefinitions: options.blockDefinitions,
    childrenByParentId,
    exportChildren,
  };
  function exportBlock(block: CanonicalBlockRecord): string {
    for (const handler of options.exportHandlers ?? []) {
      const exported = handler.exportBlock(block, context);
      if (exported !== undefined && exported !== null)
        return normalizeLineEndings(exported);
    }
    const definition = options.blockDefinitions[block.type];
    if (!definition) return "";
    if (definition.kind === "text") return block.plainText ?? "";
    if (definition.kind === "wrapper") return exportChildren(block.id);
    // Unsupported atomic blocks are predictably omitted unless a definition-
    // owned export contribution handles them.
    return "";
  }
  function exportChildren(blockId: BlockId): string {
    return (childrenByParentId.get(blockId) ?? [])
      .map(exportBlock)
      .filter((value) => value.length > 0)
      .join("\n");
  }
  return normalizeLineEndings(
    fragment.rootBlockIds
      .map((id) => blockById.get(id))
      .flatMap((block) => (block ? [exportBlock(block)] : []))
      .join("\n"),
  );
}

/** Definition-owned importer for editors whose clipboard surface is one text block. */
export function createSingleTextBlockPlainTextImportHandler(options?: {
  readonly id?: string;
  readonly blockType?: BlockType;
}): EditorPlainTextImportHandler {
  return {
    id: options?.id ?? "core.single-text-block",
    importText(
      text: string,
      context: import("./codec-contracts.ts").EditorPlainTextImportContext,
    ) {
      const normalized = normalizeLineEndings(text);
      if (
        utf8ByteLength(normalized) > context.limits.maxPlainTextBytes ||
        utf8ByteLength(normalized) > context.limits.maxRichTextBytes
      ) {
        return null;
      }
      const blockType = options?.blockType ?? context.defaultTextBlockType;
      const definition = context.blockDefinitions[blockType];
      if (!definition || definition.kind !== "text") return null;
      const inline: RichTextInlineNodeJson[] = [];
      const parts = normalized.split("\n");
      for (const [index, part] of parts.entries()) {
        if (part) inline.push({ type: "text", text: part });
        if (index < parts.length - 1) inline.push({ type: "hard_break" });
      }
      const base = createBlockRichTextContentFromPlainText(blockType, "");
      const block = createCanonicalBlockRecord({
        type: blockType,
        content: richTextDocumentWithInlineContent(blockType, base, inline),
        plainText: normalized,
      });
      return createCanonicalBlockFragment({
        blocks: [block],
        rootBlockIds: [block.id],
        start: { kind: "text", blockId: block.id },
        end: { kind: "text", blockId: block.id },
        blockDefinitions: context.blockDefinitions,
      });
    },
  };
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
