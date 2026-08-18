import {
  richTextDocumentContentSize,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { BlockType } from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type {
  StructuralEditRange,
  StructuralEditRangeBlock,
} from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorSelectionGraphReader } from "../graph/reader.ts";
import type { EditorSelectionSnapshot } from "../model/types.ts";
import { createEditorSelectionContentCompletenessChecker } from "../completeness/effective-content-completeness.ts";

export interface ResolveStructuralEditRangeOptions {
  readonly snapshot: EditorSelectionSnapshot;
  readonly graph: EditorSelectionGraphReader;
  readonly graphRevision: number;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly readBlockContent: (
    blockId: BlockId,
    blockType: BlockType,
  ) => RichTextDocumentNodeJson | null;
}

/**
 * Converts authoritative selection-model output into the platform-independent
 * range consumed by deleteRange. Browser selection is deliberately absent.
 */
export function resolveStructuralEditRange(
  options: ResolveStructuralEditRangeOptions,
): StructuralEditRange | null {
  if (
    options.snapshot.phase !== "committed" ||
    options.snapshot.graphRevision !== options.graphRevision
  )
    return null;

  const blocks: StructuralEditRangeBlock[] = [];
  const appended = new Set<BlockId>();
  const rangeById = new Map(
    options.snapshot.rangeBlocks.map((selected) => [
      selected.blockId,
      selected,
    ]),
  );
  const hasCompleteContent = createEditorSelectionContentCompletenessChecker({
    graph: options.graph,
    rangeById,
    blockDefinitions: options.blockDefinitions,
    readTextContentSize: (blockId, blockType) => {
      const content = options.readBlockContent(blockId, blockType);
      return content ? richTextDocumentContentSize(content) : null;
    },
  });
  const structuralRemovalRootIds = new Set(
    options.snapshot.rangeBlocks.flatMap((selected) =>
      selectionRemovesCompleteBlock(selected) ||
      selectionRemovesCompleteListItem(selected, options, hasCompleteContent)
        ? [selected.blockId]
        : [],
    ),
  );
  const actionableRangeBlockIds = options.snapshot.rangeBlocks.flatMap(
    (selected) => {
      if (selected.coverage === "none") return [];
      const block = options.graph.getBlock(selected.blockId);
      if (!block || block.tombstone) return [];
      if (
        hasSelectedAncestor(
          options.graph,
          block.parentId,
          structuralRemovalRootIds,
        )
      ) {
        return [];
      }
      const definition = options.blockDefinitions[block.type];
      return structuralRemovalRootIds.has(selected.blockId) ||
        definition?.kind === "text"
        ? [selected.blockId]
        : [];
    },
  );
  const firstActionableBlockId = actionableRangeBlockIds[0] ?? null;
  const lastActionableBlockId = actionableRangeBlockIds.at(-1) ?? null;
  const append = (entry: StructuralEditRangeBlock) => {
    if (appended.has(entry.blockId)) return;
    appended.add(entry.blockId);
    blocks.push(entry);
  };

  for (const selected of options.snapshot.rangeBlocks) {
    if (selected.coverage === "none") continue;
    const block = options.graph.getBlock(selected.blockId);
    if (!block || block.tombstone || block.type !== selected.blockType)
      return null;
    if (
      hasSelectedAncestor(
        options.graph,
        block.parentId,
        structuralRemovalRootIds,
      )
    )
      continue;
    const definition = options.blockDefinitions[block.type];
    if (!definition) return null;

    if (structuralRemovalRootIds.has(selected.blockId)) {
      append({
        kind: "block",
        blockId: block.id,
        blockType: block.type,
        parentId: block.parentId,
      });
      continue;
    }

    if (definition.kind !== "text") {
      // Wrapper content is represented by its selected descendants.
      continue;
    }
    const content = options.readBlockContent(block.id, block.type);
    if (!content) return null;
    const size = richTextDocumentContentSize(content);
    if (selected.coverage === "complete-content") {
      const isBoundary =
        block.id === firstActionableBlockId ||
        block.id === lastActionableBlockId;
      append(
        isBoundary
          ? {
              kind: "content",
              blockId: block.id,
              blockType: block.type,
              parentId: block.parentId,
              expectedContentVersion: block.contentVersion,
            }
          : {
              kind: "block",
              blockId: block.id,
              blockType: block.type,
              parentId: block.parentId,
            },
      );
      continue;
    }
    const from = selected.startOffset ?? 0;
    const to = selected.endOffset ?? size;
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to < from ||
      to > size
    )
      return null;
    append({
      kind: "text",
      blockId: block.id,
      blockType: block.type,
      parentId: block.parentId,
      from,
      to,
      expectedContentVersion: block.contentVersion,
    });
  }

  if (blocks.length === 0) return null;
  const first = blocks[0]!;
  const last = blocks.at(-1)!;
  return Object.freeze({
    graphRevision: options.graphRevision,
    selectionRevision:
      options.snapshot.sourceSelectionRevision ??
      options.snapshot.selectionRevision,
    blocks: Object.freeze(blocks),
    start: boundaryFor(first, "start", options),
    end: boundaryFor(last, "end", options),
  });
}

function selectionRemovesCompleteListItem(
  selected: EditorSelectionSnapshot["rangeBlocks"][number],
  options: ResolveStructuralEditRangeOptions,
  hasCompleteContent: (blockId: BlockId) => boolean,
): boolean {
  const block = options.graph.getBlock(selected.blockId);
  if (!block || block.tombstone || block.type !== selected.blockType)
    return false;
  return (
    options.blockDefinitions[block.type]?.list?.kind === "item" &&
    hasCompleteContent(block.id)
  );
}

function selectionRemovesCompleteBlock(
  selected: EditorSelectionSnapshot["rangeBlocks"][number],
): boolean {
  return (
    selected.coverage === "complete-block" ||
    (selected.coverageResult.delete !== undefined &&
      typeof selected.coverageResult.delete === "object" &&
      selected.coverageResult.delete !== null &&
      "removeBlock" in selected.coverageResult.delete &&
      selected.coverageResult.delete.removeBlock === true)
  );
}

function hasSelectedAncestor(
  graph: EditorSelectionGraphReader,
  parentId: BlockId | null,
  selectedBlockIds: ReadonlySet<BlockId>,
): boolean {
  const visited = new Set<BlockId>();
  let current = parentId;
  while (current && !visited.has(current)) {
    if (selectedBlockIds.has(current)) return true;
    visited.add(current);
    current = graph.getParentId(current);
  }
  return false;
}

function boundaryFor(
  selected: StructuralEditRangeBlock,
  edge: "start" | "end",
  options: ResolveStructuralEditRangeOptions,
): StructuralEditRange["start"] {
  if (selected.kind === "block") {
    return { kind: "block", blockId: selected.blockId };
  }
  if (selected.kind === "text") {
    return {
      kind: "text",
      blockId: selected.blockId,
      offset: edge === "start" ? selected.from : selected.to,
    };
  }
  const content = options.readBlockContent(
    selected.blockId,
    selected.blockType,
  );
  return {
    kind: "text",
    blockId: selected.blockId,
    offset:
      edge === "start" || !content ? 0 : richTextDocumentContentSize(content),
  };
}
