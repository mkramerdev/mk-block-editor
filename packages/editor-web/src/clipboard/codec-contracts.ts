import type { BlockType } from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type {
  CanonicalBlockFragment,
  CanonicalBlockRecord,
} from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";

export interface EditorClipboardImportLimits {
  readonly maxCanonicalPayloadBytes: number;
  readonly maxHtmlBytes: number;
  readonly maxPlainTextBytes: number;
  readonly maxFragmentBlocks: number;
  readonly maxNestingDepth: number;
  readonly maxMetadataBytes: number;
  readonly maxRichTextBytes: number;
  readonly maxChildrenPerNode: number;
}

export interface EditorHtmlImportHandler {
  readonly id: string;
  readonly elements?: readonly string[];
  parse(
    node: HTMLElement,
    context: EditorHtmlImportContext,
  ): CanonicalBlockFragment | null | undefined;
}

export interface EditorHtmlImportContext {
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly plainTextBlockType?: BlockType;
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
    block: CanonicalBlockRecord,
    context: EditorHtmlExportContext,
  ): Node | null | undefined;
}

export interface EditorHtmlExportContext {
  readonly document: Document;
  readonly fragment: CanonicalBlockFragment;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  exportChildren(blockId: BlockId): DocumentFragment;
  exportTextContent(block: CanonicalBlockRecord): DocumentFragment | null;
}

export interface EditorPlainTextImportContext {
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly defaultTextBlockType: BlockType;
  readonly limits: EditorClipboardImportLimits;
}

export interface EditorPlainTextImportHandler {
  readonly id: string;
  importText(
    text: string,
    context: EditorPlainTextImportContext,
  ): CanonicalBlockFragment | null | undefined;
}

export interface EditorPlainTextExportContext {
  readonly fragment: CanonicalBlockFragment;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly childrenByParentId: ReadonlyMap<
    BlockId,
    readonly CanonicalBlockRecord[]
  >;
  exportChildren(blockId: BlockId): string;
}

export interface EditorPlainTextExportHandler {
  readonly id: string;
  exportBlock(
    block: CanonicalBlockRecord,
    context: EditorPlainTextExportContext,
  ): string | null | undefined;
}
