import type { BlockId } from "../../kernel/identity/ids.ts";
import type { JsonObject } from "../../kernel/json/json-value.ts";

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

export type { BlockVersionMetadata, VersionedBlock } from "./block-version.ts";
