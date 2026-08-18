import type { VersionedBlock } from "@repo/editor-core/document";
import { getCanonicalBlockOrder } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorCommandState, EditorManifestState } from "../state/command-state.ts";
import type { EditorSnapshotReconciliation } from "../api/contracts.ts";

export function editorManifestStatesEqual(previous: EditorManifestState, next: EditorManifestState): boolean {
  return (
    previous.blockGraphVersion === next.blockGraphVersion &&
    previous.blocks === next.blocks &&
    previous.rootBlockIds === next.rootBlockIds &&
    previous.childIdsByParentId === next.childIdsByParentId &&
    previous.createdAt === next.createdAt &&
    previous.updatedAt === next.updatedAt
  );
}

export function manifestDataMatchesCurrentState(
  current: EditorCommandState,
  data: EditorSnapshotReconciliation,
): boolean {
  const currentOrder = getCanonicalBlockOrder(current);
  const nextOrder = getCanonicalBlockOrder(data);
  if (currentOrder.length !== nextOrder.length) return false;
  for (let index = 0; index < nextOrder.length; index += 1) {
    const blockId = nextOrder[index];
    if (!blockId || currentOrder[index] !== blockId) return false;
    if (!blocksEquivalent(current.blocks[blockId], data.blocks[blockId])) return false;
  }
  return true;
}

export function blocksEquivalent(left: VersionedBlock | undefined, right: VersionedBlock | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.id === right.id &&
    left.type === right.type &&
    left.parentId === right.parentId &&
    JSON.stringify(left.tombstone ?? null) === JSON.stringify(right.tombstone ?? null) &&
    JSON.stringify(left.metadata ?? null) === JSON.stringify(right.metadata ?? null);
}

export function isLiveBlockInRecord(
  blocks: Readonly<Record<BlockId, VersionedBlock>>,
  blockId: BlockId | null | undefined,
): blockId is BlockId {
  if (!blockId) return false;
  const block = blocks[blockId];
  return Boolean(block && !block.tombstone);
}

export function parentKey(parentId: BlockId | null): string {
  return parentId ?? "root";
}

export function sameBlockIdList(left: readonly BlockId[], right: readonly BlockId[]): boolean {
  if (left === right) return true;
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export function clampIndex(value: number | undefined, length: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, Math.trunc(value ?? 0)), length);
}
