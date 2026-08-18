import type { BlockDefinition } from "../definitions/block-definition.ts";
import type { BlockId } from "../kernel/identity/ids.ts";
import type { JsonObject } from "../kernel/json/json-value.ts";
import { validateJsonObject } from "../kernel/json/json-value.ts";
import { validateBlockMetadata } from "./block-metadata.ts";
export {
  normalizeBlockMetadata,
  validateBlockMetadata,
} from "./block-metadata.ts";

export function validateBlockMetadataForDefinition(
  value: unknown,
  _definition: Pick<BlockDefinition, "type">,
  label = "block metadata",
): readonly string[] {
  return value === undefined ? [] : validateBlockMetadata(value, label);
}

export function validateBlockMetadataForDefinitionWithChildren(
  value: unknown,
  definition: BlockDefinition,
  context: {
    readonly blockId: BlockId;
    readonly directChildIds: readonly BlockId[];
  },
  label = "block metadata",
): readonly string[] {
  const errors = validateBlockMetadataForDefinition(value, definition, label);
  if (errors.length > 0 || !definition.validateMetadata) return errors;
  return definition.validateMetadata({
    metadata: value as JsonObject | undefined,
    blockId: context.blockId,
    directChildIds: context.directChildIds,
  });
}

export function validateBlockMetadataFieldValueForDefinition(
  value: unknown,
  label = "metadata field",
): readonly string[] {
  return validateJsonObject({ value }, "metadata").map((error) =>
    error.replace(/^metadata\.value/u, label).replace(/^metadata/u, label),
  );
}

export function validateBlockMetadataFieldDeletionForDefinition(): readonly string[] {
  return [];
}
