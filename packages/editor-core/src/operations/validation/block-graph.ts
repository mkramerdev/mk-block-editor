import type { BlockDefinition } from "../../definitions/block-definition.ts";
import type { BlockType } from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import { isStructuralKey } from "../../kernel/identity/uuid.ts";
import { validateAllowedKeys } from "../../kernel/json/allowed-keys.ts";
import { validateJsonObject } from "../../kernel/json/json-value.ts";
import {
  validateBlockMetadata,
  validateBlockMetadataForDefinition,
} from "../../metadata/validation.ts";
import type { InlineMarkDefinition } from "../../content/marks/types.ts";
import { validateLogicalContentOperation } from "../../content/rich-text/content-operations.ts";
import type { EditorModelOperationValidationResult } from "../transactions/validation-result.ts";

export interface OperationValidationOptions {
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly inlineMarks?: readonly InlineMarkDefinition[];
}

export function validateBlockGraphOperationBody(
  operation: unknown,
  options: OperationValidationOptions,
): EditorModelOperationValidationResult {
  if (!isRecord(operation))
    return { valid: false, errors: ["operation must be an object"] };
  const errors = [
    ...validateJsonObject(operation, "operation"),
    ...validateAllowedKeys(operation, ["kind", "payload"], "operation"),
  ];
  if (operation.kind !== "transformBlocks")
    errors.push("operation.kind must be transformBlocks");
  if (!isRecord(operation.payload)) {
    errors.push("operation.payload must be an object");
  } else {
    errors.push(
      ...validateTransformBlocksPayload(
        operation.payload,
        options,
        "operation.payload",
      ),
    );
  }
  return { valid: errors.length === 0, errors };
}

export function validateLogicalBlockGraphOperation(
  operation: unknown,
): EditorModelOperationValidationResult {
  if (!isRecord(operation))
    return { valid: false, errors: ["operation must be an object"] };
  const errors = [
    ...validateJsonObject(operation, "operation"),
    ...validateAllowedKeys(
      operation,
      ["kind", "graphKind", "payload"],
      "operation",
    ),
  ];
  if (operation.kind !== "blockGraph")
    errors.push(
      `unsupported logical block graph operation kind ${String(operation.kind)}`,
    );
  if (operation.graphKind !== "transformBlocks")
    errors.push("operation.graphKind must be transformBlocks");
  if (!isRecord(operation.payload)) {
    errors.push("operation.payload must be an object");
  } else {
    errors.push(
      ...validateTransformBlocksPayload(
        operation.payload,
        undefined,
        "operation.payload",
      ),
    );
  }
  return { valid: errors.length === 0, errors };
}

export function validateTransformBlocksPayload(
  payload: Record<string, unknown>,
  options?: OperationValidationOptions,
  label = "payload",
): string[] {
  const errors = validateAllowedKeys(
    payload,
    [
      "targetId",
      "affectedBlockIds",
      "upsertedBlocks",
      "removedBlockIds",
      "rootBlockIds",
      "childIdsByParentId",
      "resolvedPlacements",
      "contentOperations",
    ],
    label,
  );
  if (typeof payload.targetId !== "string" || payload.targetId.trim() === "")
    errors.push(`${label}.targetId is required`);

  const affected = validateBlockIdArray(
    payload.affectedBlockIds,
    `${label}.affectedBlockIds`,
    true,
    errors,
  );
  const removed =
    payload.removedBlockIds === undefined
      ? []
      : validateBlockIdArray(
          payload.removedBlockIds,
          `${label}.removedBlockIds`,
          false,
          errors,
        );
  validateBlockIdArray(
    payload.rootBlockIds,
    `${label}.rootBlockIds`,
    false,
    errors,
  );

  const upsertedIds: BlockId[] = [];
  if (!Array.isArray(payload.upsertedBlocks)) {
    errors.push(`${label}.upsertedBlocks must be an array`);
  } else {
    payload.upsertedBlocks.forEach((block, index) => {
      const blockLabel = `${label}.upsertedBlocks[${index}]`;
      errors.push(...validateBlockSnapshot(block, blockLabel, options));
      if (isRecord(block) && isBlockId(block.id))
        upsertedIds.push(block.id as BlockId);
    });
  }

  if (!isRecord(payload.childIdsByParentId)) {
    errors.push(`${label}.childIdsByParentId must be an object`);
  } else {
    for (const [parentId, children] of Object.entries(
      payload.childIdsByParentId,
    )) {
      if (!isBlockId(parentId))
        errors.push(
          `${label}.childIdsByParentId parent must be a structural key`,
        );
      validateBlockIdArray(
        children,
        `${label}.childIdsByParentId.${parentId}`,
        false,
        errors,
      );
    }
  }

  const contentBlockIds: BlockId[] = [];
  if (payload.contentOperations !== undefined) {
    if (!Array.isArray(payload.contentOperations)) {
      errors.push(`${label}.contentOperations must be an array`);
    } else {
      payload.contentOperations.forEach((batch, index) => {
        const batchLabel = `${label}.contentOperations[${index}]`;
        errors.push(...validateContentOperationBatch(batch, batchLabel));
        if (isRecord(batch) && isBlockId(batch.blockId))
          contentBlockIds.push(batch.blockId as BlockId);
      });
    }
  }

  if (payload.resolvedPlacements !== undefined) {
    if (!Array.isArray(payload.resolvedPlacements)) {
      errors.push(`${label}.resolvedPlacements must be an array`);
    } else {
      payload.resolvedPlacements.forEach((placement, index) =>
        errors.push(
          ...validateResolvedPlacement(
            placement,
            `${label}.resolvedPlacements[${index}]`,
          ),
        ),
      );
    }
  }

  if (hasDuplicates(affected))
    errors.push(`${label}.affectedBlockIds must not contain duplicates`);
  if (hasDuplicates(upsertedIds))
    errors.push(`${label}.upsertedBlocks must not contain duplicate ids`);
  if (hasDuplicates(removed))
    errors.push(`${label}.removedBlockIds must not contain duplicates`);
  if (hasDuplicates(contentBlockIds))
    errors.push(
      `${label}.contentOperations must not contain duplicate blockId batches`,
    );

  const affectedSet = new Set(affected);
  const upsertedSet = new Set(upsertedIds);
  const removedSet = new Set(removed);
  const contentSet = new Set(contentBlockIds);
  if (upsertedIds.some((id) => !affectedSet.has(id)))
    errors.push(
      `${label}.upsertedBlocks ids must be included in affectedBlockIds`,
    );
  if (removed.some((id) => !affectedSet.has(id)))
    errors.push(
      `${label}.removedBlockIds must be included in affectedBlockIds`,
    );
  if (upsertedIds.some((id) => removedSet.has(id)))
    errors.push(`${label}.upsertedBlocks ids must not include removedBlockIds`);
  if (
    affected.some(
      (id) =>
        !upsertedSet.has(id) && !removedSet.has(id) && !contentSet.has(id),
    )
  )
    errors.push(
      `${label}.affectedBlockIds must be covered by upsertedBlocks, removedBlockIds, or contentOperations`,
    );
  if (contentBlockIds.some((id) => !affectedSet.has(id)))
    errors.push(
      `${label}.contentOperations blockId must be included in affectedBlockIds`,
    );
  if (contentBlockIds.some((id) => removedSet.has(id)))
    errors.push(
      `${label}.contentOperations blockId must not reference removedBlockIds`,
    );
  return errors;
}

function validateContentOperationBatch(
  value: unknown,
  label: string,
): string[] {
  if (!isRecord(value)) return [`${label} must be a content operation batch`];
  const errors = [
    ...validateAllowedKeys(value, ["blockId", "operations"], label),
  ];
  if (!isBlockId(value.blockId))
    errors.push(`${label}.blockId must be a structural key`);
  if (!Array.isArray(value.operations) || value.operations.length === 0) {
    errors.push(`${label}.operations must contain logical content operations`);
    return errors;
  }
  value.operations.forEach((operation, index) => {
    const validation = validateLogicalContentOperation(operation);
    if (!validation.valid)
      errors.push(
        ...validation.errors.map(
          (error) => `${label}.operations[${index}]: ${error}`,
        ),
      );
    if (
      isRecord(operation) &&
      isBlockId(value.blockId) &&
      operation.blockId !== value.blockId
    )
      errors.push(
        `${label}.operations[${index}].blockId must match the batch blockId`,
      );
  });
  return errors;
}

function validateBlockSnapshot(
  value: unknown,
  label: string,
  options?: OperationValidationOptions,
): string[] {
  if (!isRecord(value)) return [`${label} must be a block`];
  const errors = [
    ...validateAllowedKeys(
      value,
      [
        "id",
        "type",
        "parentId",
        "metadataVersion",
        "contentVersion",
        "tombstone",
        "metadata",
      ],
      label,
    ),
  ];
  if (!isBlockId(value.id)) errors.push(`${label}.id must be a structural key`);
  const definition =
    options && typeof value.type === "string"
      ? options.blockDefinitions[value.type]
      : undefined;
  if (options && !definition)
    errors.push(`${label}.type must be a supported block type`);
  if (value.parentId !== null && !isBlockId(value.parentId))
    errors.push(`${label}.parentId must be a structural key or null`);
  if (typeof value.metadataVersion !== "string" || value.metadataVersion === "")
    errors.push(`${label}.metadataVersion must be a string`);
  if (value.contentVersion !== null && typeof value.contentVersion !== "string")
    errors.push(`${label}.contentVersion must be a string or null`);
  errors.push(
    ...(definition
      ? validateBlockMetadataForDefinition(
          value.metadata,
          definition,
          `${label}.metadata`,
        )
      : value.metadata === undefined
        ? []
        : validateBlockMetadata(value.metadata, `${label}.metadata`)),
    ...validateTombstone(value.tombstone, `${label}.tombstone`),
  );
  return errors;
}

function validateTombstone(value: unknown, label: string): string[] {
  if (value === null) return [];
  if (!isRecord(value)) return [`${label} must be null or a tombstone object`];
  const errors = [
    ...validateJsonObject(value, label),
    ...validateAllowedKeys(value, ["deletedAt", "reason"], label),
  ];
  if (!Number.isFinite(value.deletedAt) || Number(value.deletedAt) < 0)
    errors.push(`${label}.deletedAt must be a finite non-negative timestamp`);
  if (
    value.reason !== "user-delete" &&
    value.reason !== "move-replace" &&
    value.reason !== "schema-compaction"
  )
    errors.push(`${label}.reason must be a supported tombstone reason`);
  return errors;
}

function validateResolvedPlacement(value: unknown, label: string): string[] {
  if (!isRecord(value)) return [`${label} must be a placement`];
  const errors = [
    ...validateAllowedKeys(
      value,
      [
        "blockId",
        "parentId",
        "childIndex",
        "previousSiblingId",
        "nextSiblingId",
      ],
      label,
    ),
  ];
  for (const field of [
    "blockId",
    "parentId",
    "previousSiblingId",
    "nextSiblingId",
  ]) {
    const candidate = value[field];
    if (
      field === "blockId"
        ? !isBlockId(candidate)
        : candidate !== null && !isBlockId(candidate)
    )
      errors.push(
        `${label}.${field} must be a structural key${field === "blockId" ? "" : " or null"}`,
      );
  }
  if (!Number.isInteger(value.childIndex) || Number(value.childIndex) < 0)
    errors.push(`${label}.childIndex must be a non-negative integer`);
  return errors;
}

function validateBlockIdArray(
  value: unknown,
  label: string,
  requireNonEmpty: boolean,
  errors: string[],
): BlockId[] {
  if (!Array.isArray(value)) {
    errors.push(`${label} must be an array`);
    return [];
  }
  if (requireNonEmpty && value.length === 0)
    errors.push(`${label} must contain block ids`);
  const ids: BlockId[] = [];
  value.forEach((candidate, index) => {
    if (!isBlockId(candidate))
      errors.push(`${label}[${index}] must be a structural key`);
    else ids.push(candidate as BlockId);
  });
  return ids;
}

function isBlockId(value: unknown): value is BlockId {
  return typeof value === "string" && isStructuralKey(value);
}

function hasDuplicates(values: readonly string[]): boolean {
  return new Set(values).size !== values.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
