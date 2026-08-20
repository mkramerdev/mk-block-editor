import type { BlockId } from "../../kernel/identity/ids.ts";
import { asBlockId, createBlockId } from "../../kernel/identity/uuid.ts";

const MAX_BLOCK_ID_ALLOCATION_ATTEMPTS = 100;

export interface CollisionSafeBlockIdAllocator {
  allocateBlockId(): BlockId;
  reserveBlockId(blockId: BlockId): BlockId;
}

export interface CreateCollisionSafeBlockIdAllocatorOptions {
  readonly createBlockId?: () => BlockId;
  readonly reservedBlockIds?: ReadonlySet<BlockId>;
  readonly isBlockIdReserved?: (blockId: BlockId) => boolean;
  readonly purpose: string;
}

/** Owns one bounded block-id reservation set for a single prepared operation. */
export function createCollisionSafeBlockIdAllocator(
  options: CreateCollisionSafeBlockIdAllocatorOptions,
): CollisionSafeBlockIdAllocator {
  const createCandidate = options.createBlockId ?? createBlockId;
  const reserved = new Set(options.reservedBlockIds ?? []);
  const unavailable = (blockId: BlockId) =>
    reserved.has(blockId) || options.isBlockIdReserved?.(blockId) === true;

  return {
    allocateBlockId() {
      for (
        let attempt = 0;
        attempt < MAX_BLOCK_ID_ALLOCATION_ATTEMPTS;
        attempt += 1
      ) {
        let candidate: BlockId;
        try {
          candidate = asBlockId(createCandidate());
        } catch {
          continue;
        }
        if (unavailable(candidate)) continue;
        reserved.add(candidate);
        return candidate;
      }
      throw new Error(
        `unable to allocate a unique block id for ${options.purpose}`,
      );
    },
    reserveBlockId(blockId) {
      const candidate = asBlockId(blockId);
      if (unavailable(candidate)) {
        throw new Error(
          `block id ${candidate} is already reserved for ${options.purpose}`,
        );
      }
      reserved.add(candidate);
      return candidate;
    },
  };
}
