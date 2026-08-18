import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  BlockSelectionModel,
  BlockSelectionProjectionCategory,
} from "@repo/editor-core/selection";

export interface EditorSelectionGraphReader {
  getBlock(blockId: BlockId): VersionedBlock | null;
  getParentId(blockId: BlockId): BlockId | null;
  getRootBlockIds(): readonly BlockId[];
  getChildBlockIds(parentId: BlockId): readonly BlockId[];
  readBlockSelectionModel(blockId: BlockId): BlockSelectionModel | null;
}

export interface EditorBlockSelectionTarget {
  readonly block: VersionedBlock;
  readonly selection: BlockSelectionModel;
  readonly category: BlockSelectionProjectionCategory;
  readonly canStartSelection: boolean;
  readonly selectable: boolean;
}

export function readEditorBlockSelectionTarget(
  graph: EditorSelectionGraphReader,
  blockId: BlockId,
): EditorBlockSelectionTarget | null {
  const block = graph.getBlock(blockId);
  if (!block || block.tombstone) return null;
  const selection = graph.readBlockSelectionModel(blockId);
  if (!selection) return null;
  return Object.freeze({
    block,
    selection,
    category: selection.projection.category,
    canStartSelection: selection.projection.canStartSelection,
    selectable: selection.projection.selectable,
  });
}

export function canStartSelectionFromBlock(
  target: EditorBlockSelectionTarget | null | undefined,
): boolean {
  return Boolean(target?.canStartSelection);
}

export function canTargetEditorBlockSelection(
  target: EditorBlockSelectionTarget,
): boolean {
  return target.selectable;
}
