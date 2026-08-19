import type { BlockType } from "@repo/editor-core/document";
import {
  createBlockRichTextContentFromPlainText,
  isRichTextDocument,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { EditorYjsFragmentContext } from "@repo/editor-yjs";
import {
  EDITOR_YJS_ORIGINS,
  ensureCanonicalYjsBlockContent,
} from "@repo/editor-yjs";

export interface EnsureYjsBlockContentOptions {
  readonly blockType: BlockType;
  readonly doc?:
    | RichTextDocumentNodeJson
    | string
    | Record<string, unknown>
    | null;
  readonly origin?: unknown;
}

export function ensureYjsBlockContent(
  context: EditorYjsFragmentContext,
  options: EnsureYjsBlockContentOptions,
): boolean {
  const content =
    typeof options.doc === "string"
      ? createBlockRichTextContentFromPlainText(options.blockType, options.doc)
      : isRichTextDocument(options.doc)
        ? options.doc
        : createBlockRichTextContentFromPlainText(options.blockType, "");
  return ensureCanonicalYjsBlockContent(
    context,
    content,
    options.origin ?? EDITOR_YJS_ORIGINS.CONTENT_BOOTSTRAP,
  );
}
