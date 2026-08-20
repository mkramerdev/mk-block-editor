import { createCollisionSafeBlockIdAllocator } from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";

interface BlockIdentityOwner {
  getBlock(blockId: BlockId): unknown | null;
}

/** Creates one operation-local allocator that also protects every owned id. */
export function createFirstDraftBlockIdAllocator(
  owner: BlockIdentityOwner,
  options: {
    readonly createId?: () => BlockId;
    readonly reservedBlockIds?: ReadonlySet<BlockId>;
    readonly purpose: string;
  },
): () => BlockId {
  return createCollisionSafeBlockIdAllocator({
    ...(options.createId ? { createBlockId: options.createId } : {}),
    ...(options.reservedBlockIds
      ? { reservedBlockIds: options.reservedBlockIds }
      : {}),
    isBlockIdReserved: (blockId) => owner.getBlock(blockId) !== null,
    purpose: options.purpose,
  }).allocateBlockId;
}
