import { createBlockId, type BlockId } from "@repo/editor-core/kernel";

const MAX_BLOCK_ID_ALLOCATION_ATTEMPTS = 100;

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
  const createId = options.createId ?? createBlockId;
  const allocated = new Set(options.reservedBlockIds ?? []);
  return () => {
    for (
      let attempt = 0;
      attempt < MAX_BLOCK_ID_ALLOCATION_ATTEMPTS;
      attempt += 1
    ) {
      const candidate = createId();
      if (allocated.has(candidate) || owner.getBlock(candidate) !== null) {
        continue;
      }
      allocated.add(candidate);
      return candidate;
    }
    throw new Error(
      `unable to allocate a unique block id for ${options.purpose}`,
    );
  };
}
