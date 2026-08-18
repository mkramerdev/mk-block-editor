import type { BlockType } from "@repo/editor-core/document";
import { textBlockNodeNameForBlockType } from "@repo/editor-core/content/rich-text";

export type BlockLocalTextNodeNameResolver = (blockType: BlockType) => string;
export type BlockLocalTextNodeAttrs = Readonly<Record<string, unknown>> | null;
export type BlockLocalTextNodeAttrsResolver = (
  blockType: BlockType,
) => BlockLocalTextNodeAttrs | undefined;

export interface BlockLocalDocumentMappingOptions {
  blockTextNodeNames?: Readonly<Record<string, string>>;
  resolveBlockTextNodeName?: BlockLocalTextNodeNameResolver;
  blockTextNodeAttrs?: Readonly<Record<string, BlockLocalTextNodeAttrs>>;
  resolveBlockTextNodeAttrs?: BlockLocalTextNodeAttrsResolver;
}

export function getBlockLocalTextNodeAttrs(
  blockType: BlockType,
  options: BlockLocalDocumentMappingOptions = {},
): BlockLocalTextNodeAttrs | undefined {
  const resolved = options.resolveBlockTextNodeAttrs?.(blockType);
  return resolved === undefined
    ? options.blockTextNodeAttrs?.[blockType]
    : resolved;
}

export function getBlockLocalTextNodeName(
  blockType: BlockType,
  options: BlockLocalDocumentMappingOptions = {},
): string {
  return (
    options.resolveBlockTextNodeName?.(blockType) ??
    options.blockTextNodeNames?.[blockType] ??
    textBlockNodeNameForBlockType(blockType)
  );
}
