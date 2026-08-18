import type { BlockId } from "@repo/editor-core/kernel";

export type FirstDraftHoveredBlockId = BlockId | null;

export interface FirstDraftBlockHoverStore {
  getHoveredBlockId(): FirstDraftHoveredBlockId;
  setHoveredBlockId(blockId: FirstDraftHoveredBlockId): void;
  subscribeBlock(blockId: BlockId, listener: () => void): () => void;
}

export function createFirstDraftBlockHoverStore(
  initialHoveredBlockId: FirstDraftHoveredBlockId = null,
): FirstDraftBlockHoverStore {
  let hoveredBlockId = initialHoveredBlockId;
  const listenersByBlock = new Map<BlockId, Set<() => void>>();

  return {
    getHoveredBlockId: () => hoveredBlockId,

    setHoveredBlockId(nextBlockId) {
      const previousBlockId = hoveredBlockId;
      if (previousBlockId === nextBlockId) return;
      hoveredBlockId = nextBlockId;
      if (previousBlockId) notify(listenersByBlock.get(previousBlockId));
      if (nextBlockId) notify(listenersByBlock.get(nextBlockId));
    },

    subscribeBlock(blockId, listener) {
      const listeners = listenersByBlock.get(blockId) ?? new Set();
      listeners.add(listener);
      listenersByBlock.set(blockId, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) listenersByBlock.delete(blockId);
      };
    },
  };
}

function notify(listeners: Set<() => void> | undefined): void {
  if (!listeners) return;
  for (const listener of [...listeners]) listener();
}
