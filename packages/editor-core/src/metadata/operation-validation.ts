import type { EditorModelOperationValidationResult } from "../operations/transactions/validation-result.ts";
import type { BlockId } from "../kernel/identity/ids.ts";
import { validateAllowedKeys } from "../kernel/json/allowed-keys.ts";
import { validateJsonObject } from "../kernel/json/json-value.ts";
import { isStructuralKey } from "../kernel/identity/uuid.ts";

export const EDITOR_BLOCK_METADATA_UPDATE_MAX_BYTES = 256 * 1024;
export const EDITOR_BLOCK_METADATA_UPDATE_MAX_DEPTH = 32;

export function validateUpdateBlockMetadataOperation(
  operation: unknown,
): EditorModelOperationValidationResult {
  const errors = validateUpdateBlockMetadataOperationErrors(operation);
  return { valid: errors.length === 0, errors };
}

function validateUpdateBlockMetadataOperationErrors(
  operation: unknown,
): string[] {
  if (!isRecord(operation)) return ["operation must be an object"];
  if (operation.kind !== "updateBlockMetadata") {
    return [
      `unsupported logical block metadata operation kind ${String(operation.kind)}`,
    ];
  }
  const jsonErrors = validateJsonObject(operation, "operation");
  const errors = [
    ...jsonErrors,
    ...validateAllowedKeys(
      operation,
      ["kind", "updates", "deletions"],
      "operation",
    ),
  ];
  if (!Array.isArray(operation.updates)) {
    errors.push("operation.updates must be an array");
    return errors;
  }
  const deletions = operation.deletions;
  if (deletions !== undefined && !Array.isArray(deletions)) {
    errors.push("operation.deletions must be an array");
    return errors;
  }
  if (operation.updates.length === 0 && (deletions?.length ?? 0) === 0)
    errors.push("operation must contain at least one update or deletion");
  const exceedsDepth =
    jsonErrors.length === 0 &&
    jsonDepthExceeds(operation, EDITOR_BLOCK_METADATA_UPDATE_MAX_DEPTH);
  if (exceedsDepth) {
    errors.push(
      `operation exceeds maximum JSON depth ${EDITOR_BLOCK_METADATA_UPDATE_MAX_DEPTH}`,
    );
  }
  if (
    jsonErrors.length === 0 &&
    !exceedsDepth &&
    utf8ByteLength(JSON.stringify(operation)) >
      EDITOR_BLOCK_METADATA_UPDATE_MAX_BYTES
  ) {
    errors.push(
      `operation exceeds ${EDITOR_BLOCK_METADATA_UPDATE_MAX_BYTES} UTF-8 bytes`,
    );
  }
  const updateBlockIds = new Set<string>();
  for (const [index, update] of operation.updates.entries()) {
    validateUpdate(update, index, updateBlockIds, errors);
  }
  const deletionBlockIds = new Set<string>();
  for (const [index, deletion] of (deletions ?? []).entries()) {
    validateDeletion(deletion, index, deletionBlockIds, errors);
  }
  return errors;
}

function validateUpdate(
  update: unknown,
  index: number,
  blockIds: Set<string>,
  errors: string[],
): void {
  const path = `operation.updates[${index}]`;
  if (!isRecord(update)) {
    errors.push(`${path} must be an object`);
    return;
  }
  errors.push(...validateAllowedKeys(update, ["blockId", "values"], path));
  validateUniqueBlockId(update.blockId, path, blockIds, errors);
  if (!isRecord(update.values)) {
    errors.push(`${path}.values must be a JSON object`);
    return;
  }
  for (const field of Object.keys(update.values)) {
    if (!isMetadataFieldName(field)) {
      errors.push(`${path}.values contains invalid metadata field ${field}`);
    }
  }
}

function validateDeletion(
  deletion: unknown,
  index: number,
  blockIds: Set<string>,
  errors: string[],
): void {
  const path = `operation.deletions[${index}]`;
  if (!isRecord(deletion)) {
    errors.push(`${path} must be an object`);
    return;
  }
  errors.push(...validateAllowedKeys(deletion, ["blockId", "fields"], path));
  validateUniqueBlockId(deletion.blockId, path, blockIds, errors);
  if (!Array.isArray(deletion.fields) || deletion.fields.length === 0) {
    errors.push(`${path}.fields must be a non-empty array`);
    return;
  }
  const fields = new Set<string>();
  for (const [fieldIndex, field] of deletion.fields.entries()) {
    if (!isMetadataFieldName(field)) {
      errors.push(`${path}.fields[${fieldIndex}] is invalid`);
    } else if (fields.has(field)) {
      errors.push(`${path}.fields[${fieldIndex}] is duplicated`);
    }
    if (typeof field === "string") fields.add(field);
  }
}

function validateUniqueBlockId(
  value: unknown,
  path: string,
  blockIds: Set<string>,
  errors: string[],
): void {
  if (!isBlockId(value)) {
    errors.push(`${path}.blockId must be a structural key`);
    return;
  }
  if (blockIds.has(value)) errors.push(`${path}.blockId is duplicated`);
  blockIds.add(value);
}

function jsonDepthExceeds(value: unknown, maximum: number): boolean {
  const pending: { readonly value: unknown; readonly nestingLevel: number }[] =
    [{ value, nestingLevel: 0 }];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (current.value === null || typeof current.value !== "object") continue;
    if (current.nestingLevel > maximum) return true;
    const entries = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value);
    for (const entry of entries) {
      pending.push({ value: entry, nestingLevel: current.nestingLevel + 1 });
    }
  }
  return false;
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function isBlockId(value: unknown): value is BlockId {
  return typeof value === "string" && isStructuralKey(value);
}

function isMetadataFieldName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 256 &&
    !value.includes(".") &&
    !value.includes("[") &&
    !value.includes("]") &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127;
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
