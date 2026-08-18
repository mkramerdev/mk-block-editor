import type { BlockMetadata } from "../document/model/block.ts";
import { cloneJsonValue, validateJsonObject } from "../kernel/json/json-value.ts";

export function validateBlockMetadata(value: unknown, label = "block metadata"): readonly string[] {
  return validateJsonObject(value, label);
}

export function normalizeBlockMetadata(
  metadata: unknown,
): BlockMetadata | undefined {
  if (metadata === undefined) return undefined;
  assertValidBlockMetadata(metadata);
  return Object.keys(metadata).length > 0 ? cloneJsonValue(metadata) : undefined;
}

function assertValidBlockMetadata(metadata: unknown): asserts metadata is BlockMetadata {
  const errors = validateBlockMetadata(metadata);
  if (errors.length > 0) {
    throw new Error(`Invalid block metadata: ${errors.join("; ")}`);
  }
}
