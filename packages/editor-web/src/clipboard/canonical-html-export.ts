import {
  sanitizeInlineMarkAttrs,
  type InlineMarkDefinition,
} from "@repo/editor-core/content/marks";
import {
  isRichTextDocument,
  type RichTextInlineNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { BlockType } from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type {
  CanonicalBlockFragment,
  CanonicalBlockRecord,
} from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import { sanitizeEditorLinkUrl } from "@repo/editor-core/content/urls";
import type {
  EditorHtmlExportContext,
  EditorHtmlExportHandler,
} from "./codec-contracts.ts";
import {
  INLINE_ATOM_SEMANTIC_HTML_ATTRIBUTE,
  serializeInlineAtomSemanticHtmlEnvelope,
  type InlineMetadataFieldDefinition,
} from "@repo/editor-core/content/inline-atoms";
import {
  readValidatedClipboardFragment,
  validateClipboardFragment,
  type ValidatedClipboardFragment,
} from "./validated-fragment.ts";

type CanonicalHtmlExportOptions = {
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly inlineMarks: readonly InlineMarkDefinition[];
  readonly inlineAtoms?: readonly {
    readonly type: string;
    readonly metadata: Readonly<Record<string, InlineMetadataFieldDefinition>>;
  }[];
  readonly htmlExportHandlers?: readonly EditorHtmlExportHandler[];
};

export function serializeCanonicalFragmentHtml(
  fragment: CanonicalBlockFragment,
  options: CanonicalHtmlExportOptions,
): string | null {
  return serializeValidatedCanonicalFragmentHtml(
    validateClipboardFragment(fragment, options.blockDefinitions),
    options,
  );
}

/** Package-internal exporter for a fragment validated in this operation. */
export function serializeValidatedCanonicalFragmentHtml(
  validated: ValidatedClipboardFragment,
  options: CanonicalHtmlExportOptions,
): string | null {
  const fragment = readValidatedClipboardFragment(validated);
  const doc = globalThis.document;
  if (!doc) return null;
  const blocks = new Map(fragment.blocks.map((block) => [block.id, block]));
  const children = new Map<BlockId, CanonicalBlockRecord[]>();
  for (const block of fragment.blocks) {
    if (block.parentId === null) continue;
    const siblings = children.get(block.parentId) ?? [];
    siblings.push(block);
    children.set(block.parentId, siblings);
  }
  const markDefinitions = new Map(
    options.inlineMarks.map((definition) => [definition.name, definition]),
  );

  const exportTextContent = (
    block: CanonicalBlockRecord,
  ): DocumentFragment | null => {
    if (!block.content || !isRichTextDocument(block.content)) return null;
    const result = doc.createDocumentFragment();
    const content = block.content.content[0]?.content ?? [];
    for (const inline of content) result.append(exportInline(inline));
    const wrapper = doc.createElement("p");
    wrapper.append(result);
    const fragmentResult = doc.createDocumentFragment();
    fragmentResult.append(wrapper);
    return fragmentResult;
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
    document: doc,
    fragment,
    blockDefinitions: options.blockDefinitions,
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
    if (definition.kind === "text") return exportTextContent(block);
    if (definition.kind === "atomic") return null;
    return exportChildren(block.id);
  };
  const exportInline = (inline: RichTextInlineNodeJson): Node => {
    let node: Node;
    if (inline.type === "text") node = doc.createTextNode(String(inline.text));
    else if (inline.type === "hard_break") node = doc.createElement("br");
    else {
      const atom = doc.createElement("span");
      atom.setAttribute("data-inline-atom-type", inline.type);
      const definition = options.inlineAtoms?.find(
        (candidate) => candidate.type === inline.type,
      );
      const envelope = definition
        ? serializeInlineAtomSemanticHtmlEnvelope({
            type: inline.type,
            metadata: inline.metadata,
            fields: definition.metadata,
          })
        : null;
      if (envelope) {
        atom.setAttribute(INLINE_ATOM_SEMANTIC_HTML_ATTRIBUTE, envelope);
      }
      atom.textContent = "\uFFFC";
      node = atom;
    }
    for (const mark of [...(inline.marks ?? [])].reverse()) {
      const definition = markDefinitions.get(mark.type);
      if (!definition) continue;
      const wrapper = createMarkElement(doc, definition, mark.attrs ?? {});
      if (!wrapper) continue;
      wrapper.append(node);
      node = wrapper;
    }
    return node;
  };

  const container = doc.createElement("div");
  for (const rootId of fragment.rootBlockIds) {
    const root = blocks.get(rootId);
    if (!root) return null;
    const exported = exportBlock(root);
    if (exported) container.append(exported);
  }
  const preservedDataAttributes = new Set(
    (options.htmlExportHandlers ?? []).flatMap(
      (handler) => handler.preserveDataAttributes ?? [],
    ),
  );
  sanitizeSemanticDom(container, preservedDataAttributes);
  if (
    fragment.rootBlockIds.length === 1 &&
    fragment.start.kind === "text" &&
    fragment.end.kind === "text" &&
    fragment.start.blockId === fragment.end.blockId
  ) {
    return container.firstElementChild?.innerHTML ?? container.innerHTML;
  }
  return container.innerHTML;
}

function createMarkElement(
  doc: Document,
  definition: InlineMarkDefinition,
  attrs: Readonly<Record<string, unknown>>,
): HTMLElement | null {
  if (definition.name === "strong") return doc.createElement("strong");
  if (definition.name === "em") return doc.createElement("em");
  if (definition.name === "code") return doc.createElement("code");
  if (definition.name === "underline") return doc.createElement("u");
  if (definition.name === "strikethrough") return doc.createElement("s");
  if (definition.name !== "link") return null;
  const sanitized = sanitizeInlineMarkAttrs(definition, attrs);
  const href = sanitizeEditorLinkUrl(sanitized?.href);
  const link = doc.createElement("a");
  if (href) link.href = href;
  if (typeof sanitized?.title === "string") link.title = sanitized.title;
  link.rel = "noopener noreferrer";
  return link;
}

function sanitizeSemanticDom(
  root: ParentNode,
  preservedDataAttributes: ReadonlySet<string>,
): void {
  for (const node of Array.from(
    root.querySelectorAll(
      "script,style,meta,link,iframe,object,embed,template,[hidden]",
    ),
  ))
    node.remove();
  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (
        name.startsWith("on") ||
        name === "style" ||
        name === "srcdoc" ||
        name === "srcset" ||
        name === "contenteditable" ||
        (name.startsWith("data-") &&
          name !== INLINE_ATOM_SEMANTIC_HTML_ATTRIBUTE &&
          !preservedDataAttributes.has(name))
      ) {
        element.removeAttribute(attribute.name);
      }
    }
    for (const name of [
      "href",
      "src",
      "action",
      "formaction",
      "poster",
      "cite",
      "xlink:href",
    ]) {
      if (!element.hasAttribute(name)) continue;
      const sanitized = sanitizeEditorLinkUrl(element.getAttribute(name));
      if (sanitized && (name === "href" || !sanitized.startsWith("mailto:")))
        element.setAttribute(name, sanitized);
      else element.removeAttribute(name);
    }
  }
}
