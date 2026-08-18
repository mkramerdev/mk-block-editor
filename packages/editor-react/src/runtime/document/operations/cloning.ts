import { cloneJsonValue } from "@repo/editor-core/kernel";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { EditorBlockContentOperationBatch } from "@repo/editor-core/operations";

export function cloneContentOperationBatches(
  batches: readonly EditorBlockContentOperationBatch[],
): readonly EditorBlockContentOperationBatch[] {
  return cloneJsonValue(batches);
}

export function cloneBlockForEditorPatch(
  block: VersionedBlock,
): VersionedBlock {
  return cloneJsonValue(block);
}
