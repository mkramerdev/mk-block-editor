import type { BlockId } from "@repo/editor-core/kernel";
import type {
  EditorBlockSelectionTarget,
  EditorSelectionGraphReader,
} from "./reader.ts";
import {
  canTargetEditorBlockSelection,
  readEditorBlockSelectionTarget,
} from "./reader.ts";

export function collectEditorSelectionTraversalIds(
  graph: EditorSelectionGraphReader,
): readonly BlockId[] {
  const ordered: BlockId[] = [];
  const visited = new Set<BlockId>();
  const visit = (blockId: BlockId): void => {
    if (visited.has(blockId)) return;
    visited.add(blockId);
    const target = readEditorBlockSelectionTarget(graph, blockId);
    if (!target) return;
    ordered.push(blockId);
    for (const childId of graph.getChildBlockIds(blockId)) visit(childId);
  };
  for (const rootId of graph.getRootBlockIds()) visit(rootId);
  return Object.freeze(ordered);
}

export function compareEditorSelectionOrder(
  graph: EditorSelectionGraphReader,
  leftBlockId: BlockId,
  rightBlockId: BlockId,
): number | null {
  if (leftBlockId === rightBlockId) return 0;
  const ordered = collectEditorSelectionTraversalIds(graph);
  const left = ordered.indexOf(leftBlockId);
  const right = ordered.indexOf(rightBlockId);
  return left < 0 || right < 0 ? null : left - right;
}

export function findAdjacentEditorSelectionTarget(
  graph: EditorSelectionGraphReader,
  blockId: BlockId,
  direction: -1 | 1,
  selectableOnly = false,
): EditorBlockSelectionTarget | null {
  const ordered = collectEditorSelectionTraversalIds(graph);
  const from = ordered.indexOf(blockId);
  if (from < 0) return null;
  for (
    let index = from + direction;
    index >= 0 && index < ordered.length;
    index += direction
  ) {
    const target = readEditorBlockSelectionTarget(graph, ordered[index]!);
    if (target && (!selectableOnly || canTargetEditorBlockSelection(target))) {
      return target;
    }
  }
  return null;
}

export function readDirectEditorSelectionTargets(
  graph: EditorSelectionGraphReader,
  parentId: BlockId | null,
): readonly EditorBlockSelectionTarget[] {
  const blockIds =
    parentId === null
      ? graph.getRootBlockIds()
      : graph.getChildBlockIds(parentId);
  return Object.freeze(
    blockIds
      .map((blockId) => readEditorBlockSelectionTarget(graph, blockId))
      .filter(
        (target): target is EditorBlockSelectionTarget => target !== null,
      ),
  );
}
