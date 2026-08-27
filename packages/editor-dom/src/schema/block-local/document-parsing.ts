import type { BlockType } from "@repo/editor-core/document";
import type { JsonObject } from "@repo/editor-core/kernel";
import {
  isRichTextDocument,
  normalizeRichTextDocument,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import { canonicalRichTextToProseMirrorJson } from "../inline/atom-json.ts";
import type { PMNode, Schema } from "../../prosemirror/index.ts";
import {
  createEmptyBlockLocalProseMirrorDocument,
  createTextBlockLocalProseMirrorDocument,
} from "./document-materialization.ts";
import { blockLocalProseMirrorSchema } from "./schema.ts";

export function parseBlockLocalProseMirrorDocument(
  input: unknown,
  blockType: BlockType,
  schema: Schema = blockLocalProseMirrorSchema,
): PMNode {
  return (
    tryParseBlockLocalProseMirrorDocument(input, blockType, schema) ??
    createEmptyBlockLocalProseMirrorDocument(blockType, schema)
  );
}

/**
 * Materializes content that has already crossed the canonical rich-text trust
 * boundary. Unlike the general parser, this path deliberately does not
 * normalize or validate the projection again.
 */
export function materializeCanonicalBlockLocalProseMirrorDocument(
  input: RichTextDocumentNodeJson,
  _blockType: BlockType,
  schema: Schema = blockLocalProseMirrorSchema,
): PMNode {
  const blockLocal = {
    ...input,
    content: input.content.map((child, index) =>
      index === 0
        ? {
            ...child,
            type: "paragraph",
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
): PMNode | null {
  if (!input)
    return createEmptyBlockLocalProseMirrorDocument(blockType, schema);
  if (typeof input === "string")
    return createTextBlockLocalProseMirrorDocument(
      blockType,
      input,
      schema,
    );
  if (isRichTextDocument(input)) {
    try {
      return schema.nodeFromJSON(
        canonicalRichTextToProseMirrorJson(
          normalizeBlockLocalRichTextDocument(
            input,
            blockType,
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
): Record<string, unknown> {
  const normalized = normalizeRichTextDocument(blockType, input);
  return {
    ...normalized,
    content: normalized.content.map((child, index) =>
      index === 0
        ? {
            ...child,
            type: "paragraph",
          }
        : child,
    ),
  };
}
