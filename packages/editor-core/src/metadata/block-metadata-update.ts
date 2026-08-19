import type { BlockDefinition } from "../definitions/block-definition.ts";
import type { BlockType } from "../document/model/block.ts";
import type { VersionedBlock } from "../document/model/block-version.ts";
import type { BlockId } from "../kernel/identity/ids.ts";
import { cloneJsonValue } from "../kernel/json/json-value.ts";
import {
  jsonValuesEqual,
  type MutableJsonObject,
} from "../kernel/json/json-value.ts";
import type { UpdateBlockMetadataOperation } from "../operations/language/logical-operations.ts";
import { validateUpdateBlockMetadataOperation } from "./operation-validation.ts";
import { normalizeBlockMetadata } from "./block-metadata.ts";
import { validateBlockMetadataForDefinitionWithChildren } from "./validation.ts";

export interface ApplyBlockMetadataUpdatesInput {
  readonly operation: UpdateBlockMetadataOperation;
  readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly getDirectChildIds: (blockId: BlockId) => readonly BlockId[];
}

export type ApplyBlockMetadataUpdatesResult =
  | {
      readonly ok: true;
      readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
      readonly affectedBlockIds: readonly BlockId[];
    }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Applies one atomic shallow metadata update without persistence provenance. */
export function applyBlockMetadataUpdates(
  input: ApplyBlockMetadataUpdatesInput,
): ApplyBlockMetadataUpdatesResult {
  const validation = validateUpdateBlockMetadataOperation(input.operation);
  if (!validation.valid) return { ok: false, errors: validation.errors };

  const nextBlocks = { ...input.blocks } as Record<BlockId, VersionedBlock>;
  const metadataByBlock = new Map<BlockId, MutableJsonObject>();
  const affectedBlockIds: BlockId[] = [];
  const affected = new Set<BlockId>();
  const errors: string[] = [];

  const requestedBlockIds = new Set([
    ...input.operation.updates.map((update) => update.blockId),
    ...(input.operation.deletions ?? []).map((deletion) => deletion.blockId),
  ]);
  for (const blockId of requestedBlockIds) {
    const block = input.blocks[blockId];
    if (!block || block.tombstone) {
      errors.push(
        `metadata update targets missing or tombstoned block ${blockId}`,
      );
      continue;
    }
    if (!input.blockDefinitions[block.type]) {
      errors.push(`block ${blockId} has unknown block type ${block.type}`);
      continue;
    }
    metadataByBlock.set(block.id, cloneJsonValue(block.metadata ?? {}));
  }
  if (errors.length > 0) return { ok: false, errors };

  for (const update of input.operation.updates) {
    const metadata = metadataByBlock.get(update.blockId)!;
    for (const [field, value] of Object.entries(update.values)) {
      metadata[field] = cloneJsonValue(value);
    }
  }
  for (const deletion of input.operation.deletions ?? []) {
    const metadata = metadataByBlock.get(deletion.blockId)!;
    for (const field of deletion.fields) delete metadata[field];
  }

  for (const blockId of requestedBlockIds) {
    const block = input.blocks[blockId]!;
    const definition = input.blockDefinitions[block.type];
    if (!definition) continue;
    const metadata = normalizeBlockMetadata(metadataByBlock.get(blockId)!);
    errors.push(
      ...validateBlockMetadataForDefinitionWithChildren(
        metadata,
        definition,
        { blockId, directChildIds: input.getDirectChildIds(blockId) },
        `block ${blockId} metadata`,
      ),
    );
    if (jsonValuesEqual(block.metadata ?? null, metadata ?? null)) continue;
    const { metadata: _metadata, ...blockWithoutMetadata } = block;
    void _metadata;
    const next: VersionedBlock = {
      ...blockWithoutMetadata,
      ...(metadata === undefined ? {} : { metadata }),
      metadataVersion: incrementMetadataVersion(block.metadataVersion),
    };
    nextBlocks[blockId] = next;
    if (!affected.has(block.id)) {
      affected.add(block.id);
      affectedBlockIds.push(block.id);
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    blocks: nextBlocks,
    affectedBlockIds,
  };
}

function incrementMetadataVersion(value: string): string {
  const version = Number(value);
  return Number.isFinite(version) ? String(version + 1) : "2";
}
