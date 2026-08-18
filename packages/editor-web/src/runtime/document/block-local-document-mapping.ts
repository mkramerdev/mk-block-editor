import {
  normalizeHeadingLevel,
  type VersionedBlock,
} from "@repo/editor-core/document";
import type { BlockLocalDocumentMappingOptions } from "@repo/editor-dom/schema";

/** Maps neutral canonical text into product-semantic, block-local editor DOM. */
export function createBlockPresentationDocumentMapping(
  readBlock: () => Pick<VersionedBlock, "type" | "metadata"> | null,
): BlockLocalDocumentMappingOptions {
  return {
    blockTextNodeNames: { heading: "heading" },
    resolveBlockTextNodeAttrs: (blockType) =>
      blockType === "heading"
        ? { level: normalizeHeadingLevel(readBlock()?.metadata?.level) }
        : undefined,
  };
}
