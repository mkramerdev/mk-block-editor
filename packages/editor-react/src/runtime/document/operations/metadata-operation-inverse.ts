import type { VersionedBlock } from "@repo/editor-core/document";
import {
  cloneJsonValue,
  type BlockId,
  type JsonObject,
} from "@repo/editor-core/kernel";
import type {
  BlockMetadataDeletion,
  BlockMetadataUpdate,
  UpdateBlockMetadataOperation,
} from "@repo/editor-core/operations";

export function createInverseBlockMetadataOperation(
  operation: UpdateBlockMetadataOperation,
  blocks: Readonly<Record<BlockId, VersionedBlock>>,
): UpdateBlockMetadataOperation | null {
  const fieldsByBlock = new Map<BlockId, Set<string>>();
  for (const update of operation.updates) {
    const fields = fieldsByBlock.get(update.blockId) ?? new Set<string>();
    fieldsByBlock.set(update.blockId, fields);
    for (const field of Object.keys(update.values)) fields.add(field);
  }
  for (const deletion of operation.deletions ?? []) {
    const fields = fieldsByBlock.get(deletion.blockId) ?? new Set<string>();
    fieldsByBlock.set(deletion.blockId, fields);
    for (const field of deletion.fields) fields.add(field);
  }

  const updates: BlockMetadataUpdate[] = [];
  const deletions: BlockMetadataDeletion[] = [];
  for (const [blockId, fields] of fieldsByBlock) {
    const block = blocks[blockId];
    if (!block || block.tombstone) return null;
    const metadata = block.metadata ?? {};
    const values: JsonObject = {};
    const absentFields: string[] = [];
    for (const field of fields) {
      if (Object.hasOwn(metadata, field)) {
        values[field] = cloneJsonValue(metadata[field]!);
      } else {
        absentFields.push(field);
      }
    }
    if (Object.keys(values).length > 0) updates.push({ blockId, values });
    if (absentFields.length > 0) {
      deletions.push({ blockId, fields: absentFields });
    }
  }

  return {
    kind: "updateBlockMetadata",
    updates,
    ...(deletions.length > 0 ? { deletions } : {}),
  };
}
