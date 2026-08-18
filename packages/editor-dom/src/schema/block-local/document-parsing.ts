import type { BlockType } from "@repo/editor-core/document";
import type { JsonObject } from "@repo/editor-core/kernel";
import {
  isRichTextDocument,
  normalizeRichTextDocument,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import { canonicalRichTextToProseMirrorJson } from "../inline/atom-json.ts";
import type { PMNode, Schema } from "../../prosemirror/index.ts";
import type { BlockLocalDocumentMappingOptions } from "./document-mapping.ts";
import {
  getBlockLocalTextNodeAttrs,
  getBlockLocalTextNodeName,
} from "./document-mapping.ts";
import {
  createEmptyBlockLocalProseMirrorDocument,
  createTextBlockLocalProseMirrorDocument,
} from "./document-materialization.ts";
import { blockLocalProseMirrorSchema } from "./schema.ts";

export function parseBlockLocalProseMirrorDocument(
  input: unknown,
  blockType: BlockType,
  schema: Schema = blockLocalProseMirrorSchema,
  options: BlockLocalDocumentMappingOptions = {},
): PMNode {
  return (
    tryParseBlockLocalProseMirrorDocument(input, blockType, schema, options) ??
    createEmptyBlockLocalProseMirrorDocument(blockType, schema, options)
  );
}

/**
 * Materializes content that has already crossed the canonical rich-text trust
 * boundary. Unlike the general parser, this path deliberately does not
 * normalize or validate the projection again.
 */
export function materializeCanonicalBlockLocalProseMirrorDocument(
  input: RichTextDocumentNodeJson,
  blockType: BlockType,
  schema: Schema = blockLocalProseMirrorSchema,
  options: BlockLocalDocumentMappingOptions = {},
): PMNode {
  const nodeName = getBlockLocalTextNodeName(blockType, options);
  const attrs = getBlockLocalTextNodeAttrs(blockType, options);
  const blockLocal = {
    ...input,
    content: input.content.map((child, index) =>
      index === 0
        ? {
            ...child,
            type: nodeName,
            ...(attrs === undefined ? {} : { attrs }),
          }
        : child,
    ),
  } as JsonObject;
  return schema.nodeFromJSON(canonicalRichTextToProseMirrorJson(blockLocal));
}

export function tryParseBlockLocalProseMirrorDocument(
  input: unknown,
  blockType: BlockType,
  schema: Schema = blockLocalProseMirrorSchema,
  options: BlockLocalDocumentMappingOptions = {},
): PMNode | null {
  if (!input)
    return createEmptyBlockLocalProseMirrorDocument(blockType, schema, options);
  if (typeof input === "string")
    return createTextBlockLocalProseMirrorDocument(
      blockType,
      input,
      schema,
      options,
    );
  if (isRichTextDocument(input)) {
    try {
      return schema.nodeFromJSON(
        canonicalRichTextToProseMirrorJson(
          normalizeBlockLocalRichTextDocument(
            input,
            blockType,
            options,
          ) as JsonObject,
        ),
      );
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeBlockLocalRichTextDocument(
  input: RichTextDocumentNodeJson,
  blockType: BlockType,
  options: BlockLocalDocumentMappingOptions,
): Record<string, unknown> {
  const normalized = normalizeRichTextDocument(blockType, input);
  const nodeName = getBlockLocalTextNodeName(blockType, options);
  const attrs = getBlockLocalTextNodeAttrs(blockType, options);
  return {
    ...normalized,
    content: normalized.content.map((child, index) =>
      index === 0
        ? {
            ...child,
            type: nodeName,
            ...(attrs === undefined ? {} : { attrs }),
          }
        : child,
    ),
  };
}
