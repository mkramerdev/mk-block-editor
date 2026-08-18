import type { BlockType } from "@repo/editor-core/document";
import type { CanonicalBlockFragment } from "@repo/editor-core/editing";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { Schema } from "../../prosemirror/index.ts";
import type { BlockLocalDocumentMappingOptions } from "../../schema/block-local/document-mapping.ts";
import type { SemanticHtmlProseMirrorOptions } from "../serialize/prosemirror-html.ts";
import type { EditorClipboardImportLimits } from "../limits.ts";
import type { InlineMetadataFieldDefinition } from "@repo/editor-core/content/inline-atoms";

export interface EditorHtmlCodecOptions extends SemanticHtmlProseMirrorOptions {
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  schema?: Schema;
  documentMapping?: BlockLocalDocumentMappingOptions;
  isBlockType?: (value: unknown) => value is BlockType;
  htmlImportHandlers?: readonly EditorHtmlImportHandler[];
  htmlExportHandlers?: readonly EditorHtmlExportHandler[];
  plainTextBlockType?: BlockType;
  limits?: Partial<EditorClipboardImportLimits>;
  inlineAtoms?: readonly {
    readonly type: string;
    readonly metadata: Readonly<Record<string, InlineMetadataFieldDefinition>>;
  }[];
}

export interface PlainTextFragmentImportOptions {
  blockType: BlockType;
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  limits?: Partial<EditorClipboardImportLimits>;
}

export interface EditorHtmlImportHandler {
  readonly id: string;
  readonly elements?: readonly string[];
  parse(
    node: HTMLElement,
    context: EditorHtmlImportContext,
  ): CanonicalBlockFragment | null | undefined;
}

export interface EditorHtmlImportContext extends EditorHtmlCodecOptions {
  parseChildren(node: HTMLElement): CanonicalBlockFragment | null;
  parseTextBlock(
    node: HTMLElement,
    blockType: BlockType,
    metadata?: import("@repo/editor-core/kernel").JsonObject,
  ): CanonicalBlockFragment | null;
}

export interface EditorHtmlExportHandler {
  readonly id: string;
  /** Exact semantic data attributes this handler intentionally exports. */
  readonly preserveDataAttributes?: readonly `data-${string}`[];
  export(
    block: import("@repo/editor-core/editing").CanonicalBlockRecord,
    context: EditorHtmlExportContext,
  ): Node | null | undefined;
}

export interface EditorHtmlExportContext extends EditorHtmlCodecOptions {
  readonly document: Document;
  readonly fragment: CanonicalBlockFragment;
  exportChildren(
    blockId: import("@repo/editor-core/kernel").BlockId,
  ): DocumentFragment;
  exportTextContent(
    block: import("@repo/editor-core/editing").CanonicalBlockRecord,
  ): DocumentFragment | null;
}
