import type { BlockId } from "../../kernel/identity/ids.ts";
import type { JsonObject } from "../../kernel/json/json-value.ts";

export type BlockType = string;

export type BlockMetadata = JsonObject;

export interface Block {
  id: BlockId;
  type: BlockType;
  parentId: BlockId | null;
  tombstone: {
    deletedAt: number;
    reason: "user-delete" | "move-replace" | "schema-compaction";
  } | null;
  metadata?: BlockMetadata;
}

export interface OrderedBlockGraph<BlockRecord extends Block = Block> {
  readonly blocks: Readonly<Record<BlockId, BlockRecord>>;
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
}

export type { BlockVersionMetadata, VersionedBlock } from "./block-version.ts";
