import type {
  Block,
  BlockType,
  BlockVersionMetadata,
  VersionedBlock,
} from "../document/model/block.ts";
import type { BlockId } from "../kernel/identity/ids.ts";
import { createBlockId } from "../kernel/identity/uuid.ts";
import type { JsonObject } from "../kernel/json/json-value.ts";
import { normalizeBlockMetadata } from "./block-metadata.ts";

export interface CreateBlockRecordOptions {
  id?: BlockId;
  type: BlockType;
  parentId?: BlockId | null;
  tombstone?: Block["tombstone"];
  metadata?: JsonObject;
}

export function createBlockRecord(options: CreateBlockRecordOptions): Block {
  const metadata = normalizeBlockMetadata(options.metadata);
  return {
    id: options.id ?? createBlockId(),
    type: options.type,
    parentId: options.parentId ?? null,
    tombstone: options.tombstone ?? null,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

export interface CreateVersionedBlockRecordOptions
  extends CreateBlockRecordOptions {
  readonly metadataVersion?: BlockVersionMetadata["metadataVersion"];
  readonly contentVersion?: BlockVersionMetadata["contentVersion"];
  readonly version?: Partial<BlockVersionMetadata>;
}

export function createVersionedBlockRecord(
  options: CreateVersionedBlockRecordOptions,
): VersionedBlock {
  return {
    ...createBlockRecord(options),
    metadataVersion:
      options.version?.metadataVersion ?? options.metadataVersion ?? "1",
    contentVersion:
      options.version?.contentVersion ?? options.contentVersion ?? null,
  };
}
