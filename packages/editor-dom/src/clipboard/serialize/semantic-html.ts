import type {
  CanonicalBlockFragment,
  CanonicalBlockRecord,
} from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import { normalizeHeadingLevel } from "@repo/editor-core/document";
import type {
  EditorHtmlCodecOptions,
  EditorHtmlExportContext,
} from "../model/parser-options.ts";
import { sanitizeSemanticDom } from "../parse/sanitization.ts";
import { serializeBlockRichTextContentHtml } from "./prosemirror-html.ts";

export function serializeCanonicalFragmentHtml(
  fragment: CanonicalBlockFragment,
  options: EditorHtmlCodecOptions,
): string | null {
  const doc = (globalThis as { document?: Document }).document;
  if (!doc) return null;
  const blocks = new Map(fragment.blocks.map((block) => [block.id, block]));
  const children = new Map<BlockId, CanonicalBlockRecord[]>();
  for (const block of fragment.blocks) {
    if (block.parentId === null) continue;
    const siblings = children.get(block.parentId) ?? [];
    siblings.push(block);
    children.set(block.parentId, siblings);
  }

  const exportTextContent = (
    block: CanonicalBlockRecord,
  ): DocumentFragment | null => {
    if (!block.content) return null;
    const html = serializeBlockRichTextContentHtml(
      block.content,
      block.type,
      options,
    );
    if (html === null) return null;
    const template = doc.createElement("template");
    template.innerHTML = html;
    sanitizeSemanticDom(template.content);
    if (block.type === "heading") {
      const level = readHeadingLevel(block);
      const first = template.content.firstElementChild;
      if (first) {
        const heading = doc.createElement(`h${level}`);
        heading.append(...Array.from(first.childNodes));
        first.replaceWith(heading);
      }
    }
    return template.content;
  };

  const exportChildren = (blockId: BlockId): DocumentFragment => {
    const result = doc.createDocumentFragment();
    for (const child of children.get(blockId) ?? []) {
      const exported = exportBlock(child);
      if (exported) result.append(exported);
    }
    return result;
  };

  const context: EditorHtmlExportContext = {
    ...options,
    document: doc,
    fragment,
    exportChildren,
    exportTextContent,
  };

  const exportBlock = (block: CanonicalBlockRecord): Node | null => {
    for (const handler of options.htmlExportHandlers ?? []) {
      const exported = handler.export(block, context);
      if (exported !== undefined && exported !== null) return exported;
    }
    const definition = options.blockDefinitions[block.type];
    if (!definition) return null;
    if (definition.kind === "text") return exportTextBlock(block);
    if (definition.kind === "atomic") {
      return block.type === "divider" ? doc.createElement("hr") : null;
    }
    if (block.type === "quote") {
      const quote = doc.createElement("blockquote");
      quote.append(exportChildren(block.id));
      return quote;
    }
    if (block.type === "code") {
      const pre = doc.createElement("pre");
      const code = doc.createElement("code");
      code.textContent = readableDescendantText(block.id, children).join("\n");
      pre.append(code);
      return pre;
    }
    return exportChildren(block.id);
  };

  const exportTextBlock = (block: CanonicalBlockRecord): Node | null => {
    const content = exportTextContent(block);
    if (!content) return null;
    if (content.childNodes.length === 1) return content.firstChild;
    const paragraph = doc.createElement("p");
    paragraph.append(content);
    return paragraph;
  };

  const container = doc.createElement("div");
  for (const rootId of fragment.rootBlockIds) {
    const root = blocks.get(rootId);
    if (!root) return null;
    const exported = exportBlock(root);
    if (exported) container.append(exported);
  }
  sanitizeSemanticDom(container);

  if (
    fragment.rootBlockIds.length === 1 &&
    fragment.start.kind === "text" &&
    fragment.end.kind === "text" &&
    fragment.start.blockId === fragment.end.blockId
  ) {
    const first = container.firstElementChild;
    return first ? first.innerHTML : container.innerHTML;
  }
  return container.innerHTML;
}

function readHeadingLevel(block: CanonicalBlockRecord): number {
  return normalizeHeadingLevel(block.metadata?.["level"]);
}

function readableDescendantText(
  blockId: BlockId,
  children: ReadonlyMap<BlockId, readonly CanonicalBlockRecord[]>,
): string[] {
  const result: string[] = [];
  for (const child of children.get(blockId) ?? []) {
    if (child.plainText !== undefined) result.push(child.plainText);
    result.push(...readableDescendantText(child.id, children));
  }
  return result;
}
