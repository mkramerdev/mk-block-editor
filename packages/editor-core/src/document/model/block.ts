import type { BlockId } from "../../kernel/identity/ids.ts";
import {
  jsonValuesEqual,
  type JsonObject,
} from "../../kernel/json/json-value.ts";

export type BlockType = string;

export type BlockMetadata = JsonObject;

export interface Block {
  readonly id: BlockId;
  readonly type: BlockType;
  readonly parentId: BlockId | null;
  readonly tombstone: {
    readonly deletedAt: number;
    readonly reason: "user-delete" | "move-replace" | "schema-compaction";
  } | null;
  readonly metadata?: BlockMetadata;
}

export interface OrderedBlockGraph<BlockRecord extends Block = Block> {
  readonly blocks: Readonly<Record<BlockId, BlockRecord>>;
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
}

const emptyBlockMetadata: JsonObject = Object.freeze({});

/**
 * Compares canonical, non-version block state.
 *
 * This intentionally ignores metadataVersion and contentVersion. Empty
 * metadata is equivalent to absent metadata because canonical block metadata
 * construction normalizes an empty object to absence.
 */
export function blocksHaveEqualCanonicalState(
  left: Block,
  right: Block,
): boolean {
  if (left === right) return true;
  return (
    left.id === right.id &&
    left.type === right.type &&
    left.parentId === right.parentId &&
    jsonValuesEqual(left.tombstone, right.tombstone) &&
    jsonValuesEqual(
      left.metadata ?? emptyBlockMetadata,
      right.metadata ?? emptyBlockMetadata,
    )
  );
}

export type { BlockVersionMetadata, VersionedBlock } from "./block-version.ts";
