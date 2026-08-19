import { type BlockType } from "@repo/editor-core/document";
import {
  createCanonicalBlockFragment,
  type CanonicalBlockFragment,
} from "@repo/editor-core/editing";
import { createBlockRecord } from "@repo/editor-core/metadata";
import {
  createBlockRichTextContentFromPlainText,
  extractPlainTextFromRichTextDocument,
} from "@repo/editor-core/content/rich-text";
import type { JsonObject } from "@repo/editor-core/kernel";
import { parseSemanticTextBlockContent } from "../serialize/prosemirror-html.ts";
import type {
  EditorHtmlCodecOptions,
  EditorHtmlImportHandler,
  EditorHtmlImportContext,
} from "../model/parser-options.ts";
import {
  hasInvalidClipboardText,
  resolveEditorClipboardImportLimits,
  utf8ByteLength,
} from "../limits.ts";
import { parseClipboardHtmlDocument } from "./html-document.ts";
import {
  normalizeImportedPlainText,
  normalizeWhitespace,
} from "./plain-text.ts";
import { sanitizeClipboardDocument } from "./sanitization.ts";

export function parseHtmlCanonicalFragment(
  html: string,
  plainText = "",
  options: EditorHtmlCodecOptions,
): CanonicalBlockFragment | null {
  if (!html.trim()) return null;
  const limits = resolveEditorClipboardImportLimits(options.limits);
  if (
    utf8ByteLength(html) > limits.maxHtmlBytes ||
    hasInvalidClipboardText(html)
  )
    return null;
  const doc = parseClipboardHtmlDocument(html);
  if (!doc) return null;
  sanitizeClipboardDocument(doc);
  const body = doc.body;
  const parsedNodes = Array.from(body.childNodes).map((node) =>
    htmlNodeToCanonicalFragment(node, options, limits, 1),
  );
  if (parsedNodes.includes(rejectedHtmlImport)) return null;
  const fragments = parsedNodes.filter(
    (fragment): fragment is CanonicalBlockFragment =>
      fragment !== null && fragment !== rejectedHtmlImport,
  );
  if (fragments.length > 0) {
    const combined = combineFragments(fragments, options);
    return fragmentWithinLimits(combined, limits) ? combined : null;
  }
  const bodyText = normalizeWhitespace(body.textContent ?? plainText);
  return bodyText && options.plainTextBlockType
    ? textFragment(bodyText, options.plainTextBlockType, options)
    : null;
}

export function createTextHtmlImportHandler(options: {
  readonly id: string;
  readonly blockType: BlockType;
  readonly tags: readonly string[];
  readonly metadata?: (node: HTMLElement) => JsonObject | undefined;
}): EditorHtmlImportHandler {
  const tags = new Set(options.tags.map((tag) => tag.toLowerCase()));
  return {
    id: options.id,
    elements: [...tags],
    parse(node, context) {
      return tags.has(node.tagName.toLowerCase())
        ? context.parseTextBlock(
            node,
            options.blockType,
            options.metadata?.(node),
          )
        : null;
    },
  };
}

function htmlNodeToCanonicalFragment(
  node: Node,
  options: EditorHtmlCodecOptions,
  limits: ReturnType<typeof resolveEditorClipboardImportLimits>,
  nestingLevel: number,
): CanonicalBlockFragment | typeof rejectedHtmlImport | null {
  if (nestingLevel > limits.maxNestingDepth) return rejectedHtmlImport;
  if (node.nodeType === Node.TEXT_NODE) {
    const text = normalizeWhitespace(node.textContent ?? "");
    return text && options.plainTextBlockType
      ? textFragment(text, options.plainTextBlockType, options)
      : null;
  }
  if (!(node instanceof HTMLElement)) return null;

  let rejectedChildren = false;
  const context: EditorHtmlImportContext = {
    ...options,
    parseChildren(childNode) {
      const parsed = Array.from(childNode.childNodes).map((child) =>
        htmlNodeToCanonicalFragment(child, options, limits, nestingLevel + 1),
      );
      if (parsed.includes(rejectedHtmlImport)) {
        rejectedChildren = true;
        return null;
      }
      const fragments = parsed.filter(
        (fragment): fragment is CanonicalBlockFragment =>
          fragment !== null && fragment !== rejectedHtmlImport,
      );
      return fragments.length > 0 ? combineFragments(fragments, options) : null;
    },
    parseTextBlock(childNode, blockType, metadata) {
      return htmlTextBlockToCanonicalFragment(
        childNode,
        blockType,
        metadata,
        options,
      );
    },
  };
  for (const parser of options.htmlImportHandlers ?? []) {
    const parsed = parser.parse(node, context);
    if (parsed) return parsed;
    if (
      parser.elements?.some(
        (element) => element.toLowerCase() === node.tagName.toLowerCase(),
      )
    )
      return rejectedHtmlImport;
  }
  const children = context.parseChildren(node);
  return rejectedChildren ? rejectedHtmlImport : children;
}

const rejectedHtmlImport = Symbol("rejected-html-import");

function htmlTextBlockToCanonicalFragment(
  node: HTMLElement,
  blockType: BlockType,
  metadata: JsonObject | undefined,
  options: EditorHtmlCodecOptions,
): CanonicalBlockFragment | null {
  const plainText = normalizeImportedPlainText(
    node.textContent ?? "",
  ).trimEnd();
  if (!plainText && node.querySelector("br") === null) return null;
  const content = parseSemanticTextBlockContent(node, options);
  const block = createBlockRecord({ type: blockType, metadata });
  const canonicalContent =
    content ?? createBlockRichTextContentFromPlainText(blockType, plainText);
  return createCanonicalBlockFragment({
    blocks: [
      {
        id: block.id,
        type: block.type,
        parentId: null,
        ...(block.metadata === undefined ? {} : { metadata: block.metadata }),
        content: canonicalContent,
        plainText: extractPlainTextFromRichTextDocument(canonicalContent),
      },
    ],
    rootBlockIds: [block.id],
    start: { kind: "text", blockId: block.id },
    end: { kind: "text", blockId: block.id },
    blockDefinitions: options.blockDefinitions,
  });
}

function textFragment(
  plainText: string,
  blockType: BlockType,
  options: EditorHtmlCodecOptions,
): CanonicalBlockFragment {
  const block = createBlockRecord({ type: blockType });
  const content = createBlockRichTextContentFromPlainText(blockType, plainText);
  return createCanonicalBlockFragment({
    blocks: [
      { id: block.id, type: block.type, parentId: null, content, plainText },
    ],
    rootBlockIds: [block.id],
    start: { kind: "text", blockId: block.id },
    end: { kind: "text", blockId: block.id },
    blockDefinitions: options.blockDefinitions,
  });
}

function combineFragments(
  fragments: readonly CanonicalBlockFragment[],
  options: EditorHtmlCodecOptions,
): CanonicalBlockFragment {
  return createCanonicalBlockFragment({
    blocks: fragments.flatMap((fragment) => fragment.blocks),
    rootBlockIds: fragments.flatMap((fragment) => fragment.rootBlockIds),
    start: fragments[0]!.start,
    end: fragments[fragments.length - 1]!.end,
    blockDefinitions: options.blockDefinitions,
  });
}

function fragmentWithinLimits(
  fragment: CanonicalBlockFragment,
  limits: ReturnType<typeof resolveEditorClipboardImportLimits>,
): boolean {
  if (fragment.blocks.length > limits.maxFragmentBlocks) return false;
  const depthById = new Map<string, number>();
  for (const block of fragment.blocks) {
    const depth =
      block.parentId === null
        ? 1
        : (depthById.get(block.parentId) ?? Infinity) + 1;
    if (!Number.isFinite(depth) || depth > limits.maxNestingDepth) return false;
    depthById.set(block.id, depth);
    if (
      block.metadata !== undefined &&
      utf8ByteLength(JSON.stringify(block.metadata)) > limits.maxMetadataBytes
    )
      return false;
    if (
      block.content !== undefined &&
      utf8ByteLength(JSON.stringify(block.content)) > limits.maxRichTextBytes
    )
      return false;
  }
  const childCounts = new Map<string, number>();
  for (const block of fragment.blocks) {
    if (block.parentId === null) continue;
    const count = (childCounts.get(block.parentId) ?? 0) + 1;
    if (count > limits.maxChildrenPerNode) return false;
    childCounts.set(block.parentId, count);
  }
  return true;
}
