import {
  isRichTextDocument,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { BlockType } from "@repo/editor-core/document";
import type { JsonObject } from "@repo/editor-core/kernel";
import {
  INLINE_ATOM_SEMANTIC_HTML_ATTRIBUTE,
  parseInlineAtomSemanticHtmlEnvelope,
  type InlineMetadataFieldDefinition,
} from "@repo/editor-core/content/inline-atoms";
import {
  DOMParser as PMDOMParser,
  DOMSerializer,
  type PMNode,
  type Schema,
} from "../../prosemirror/index.ts";
import type { BlockLocalDocumentMappingOptions } from "../../schema/block-local/document-mapping.ts";
import { tryParseBlockLocalProseMirrorDocument } from "../../schema/block-local/document-parsing.ts";
import { blockLocalProseMirrorSchema } from "../../schema/block-local/schema.ts";
import { proseMirrorRichTextToCanonicalJson } from "../../schema/inline/atom-json.ts";

let blockLocalDomParser: PMDOMParser | null = null;
let blockLocalDomSerializer: DOMSerializer | null = null;

export interface SemanticHtmlProseMirrorOptions {
  schema?: Schema;
  documentMapping?: BlockLocalDocumentMappingOptions;
  inlineAtoms?: readonly {
    readonly type: string;
    readonly metadata: Readonly<Record<string, InlineMetadataFieldDefinition>>;
  }[];
}

export function parseSemanticTextBlockContent(
  node: HTMLElement,
  options: SemanticHtmlProseMirrorOptions = {},
): RichTextDocumentNodeJson | null {
  try {
    const parsed = blockLocalProseMirrorDomParser(
      options.schema,
      options.inlineAtoms,
    ).parse(node);
    return readClipboardProseMirrorJson(
      proseMirrorRichTextToCanonicalJson(parsed.toJSON()),
    );
  } catch {
    return null;
  }
}

export function serializeBlockRichTextContentHtml(
  content: JsonObject,
  blockType: BlockType,
  options: SemanticHtmlProseMirrorOptions = {},
): string | null {
  const doc = getHtmlDocument();
  if (!doc) return null;
  try {
    const schema = options.schema ?? blockLocalProseMirrorSchema;
    const pmDoc = tryParseBlockLocalProseMirrorDocument(
      content,
      blockType,
      schema,
      options.documentMapping,
    );
    if (!pmDoc) return null;
    return serializePmNodeContent(pmDoc, doc, schema);
  } catch {
    return null;
  }
}

function readClipboardProseMirrorJson(
  value: unknown,
): RichTextDocumentNodeJson | null {
  return isRichTextDocument(value) ? value : null;
}

function blockLocalProseMirrorDomParser(
  schema = blockLocalProseMirrorSchema,
  inlineAtoms: SemanticHtmlProseMirrorOptions["inlineAtoms"] = [],
): PMDOMParser {
  if (inlineAtoms.length > 0) {
    const standard = PMDOMParser.fromSchema(schema);
    return new PMDOMParser(schema, [
      ...inlineAtoms.flatMap((definition) =>
        schema.nodes[definition.type]
          ? [
              {
                tag: `span[${INLINE_ATOM_SEMANTIC_HTML_ATTRIBUTE}]`,
                node: definition.type,
                getAttrs(node: HTMLElement) {
                  const payload = node.getAttribute(
                    INLINE_ATOM_SEMANTIC_HTML_ATTRIBUTE,
                  );
                  if (!payload) return false;
                  const atom = parseInlineAtomSemanticHtmlEnvelope({
                    payload,
                    definitions: inlineAtoms,
                  });
                  return atom?.type === definition.type
                    ? { metadata: atom.metadata }
                    : false;
                },
              },
            ]
          : [],
      ),
      ...standard.rules,
    ]);
  }
  if (schema !== blockLocalProseMirrorSchema) return PMDOMParser.fromSchema(schema);
  blockLocalDomParser ??= PMDOMParser.fromSchema(blockLocalProseMirrorSchema);
  return blockLocalDomParser;
}

function blockLocalProseMirrorDomSerializer(
  schema = blockLocalProseMirrorSchema,
): DOMSerializer {
  if (schema !== blockLocalProseMirrorSchema)
    return DOMSerializer.fromSchema(schema);
  blockLocalDomSerializer ??= DOMSerializer.fromSchema(
    blockLocalProseMirrorSchema,
  );
  return blockLocalDomSerializer;
}

function getHtmlDocument(): Document | null {
  return (globalThis as { document?: Document }).document ?? null;
}

function serializePmNodeContent(
  pmDoc: PMNode,
  doc: Document,
  schema: Schema,
): string {
  const container = doc.createElement("div");
  container.append(
    blockLocalProseMirrorDomSerializer(schema).serializeFragment(
      pmDoc.content,
      { document: doc },
    ),
  );
  return container.innerHTML;
}
