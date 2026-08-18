import {
  assertValidBlockGraphVersion,
  getCanonicalBlockOrder,
} from "@repo/editor-core/document";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType } from "@repo/editor-core/document";
import { validateStructuralDocument } from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorSnapshotReconciliation } from "../api/contracts.ts";

const versionedBlockFieldNames = new Set([
  "id",
  "type",
  "parentId",
  "metadataVersion",
  "contentVersion",
  "tombstone",
  "metadata",
]);

export function assertValidEditorSnapshotReconciliation(
  data: Omit<EditorSnapshotReconciliation, "origin">,
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
): void {
  assertValidBlockGraphVersion(data.blockGraphVersion);
  if (
    !data.blocks ||
    typeof data.blocks !== "object" ||
    Array.isArray(data.blocks)
  ) {
    throw new Error("editor snapshot blocks must be a record");
  }

  const blocks = data.blocks as Readonly<Record<BlockId, VersionedBlock>>;
  if (Object.keys(blocks).length === 0) {
    throw new Error("editor snapshot blocks must contain at least one block");
  }
  const canonicalOrder = getCanonicalBlockOrder({
    blocks,
    rootBlockIds: data.rootBlockIds,
    childIdsByParentId: data.childIdsByParentId,
  });
  if (canonicalOrder.length === 0) {
    throw new Error("editor snapshot must contain at least one live block");
  }
  for (const blockId of canonicalOrder) {
    const block = blocks[blockId];
    if (!block) {
      throw new Error(`editor snapshot is missing block record for ${blockId}`);
    }
    if (block.id !== blockId) {
      throw new Error(
        `editor snapshot block record ${blockId} has mismatched id`,
      );
    }
    if (block.tombstone) {
      throw new Error(
        `editor snapshot canonical order references tombstoned block ${blockId}`,
      );
    }
    assertVersionedBlockFieldSet(blockId, block);
  }
  const structuralValidation = validateStructuralDocument({
    blocks,
    rootBlockIds: data.rootBlockIds,
    childIdsByParentId: data.childIdsByParentId,
    blockDefinitions,
  });
  if (!structuralValidation.valid) {
    throw new Error(
      `editor snapshot is structurally invalid: ${structuralValidation.issues
        .map((issue) => issue.message)
        .join("; ")}`,
    );
  }
}

function assertVersionedBlockFieldSet(
  blockId: BlockId,
  block: VersionedBlock,
): void {
  for (const fieldName of Object.keys(
    block as unknown as Record<string, unknown>,
  )) {
    if (versionedBlockFieldNames.has(fieldName)) continue;
    throw new Error(
      `editor snapshot block ${blockId} contains unsupported field ${fieldName}`,
    );
  }
}
