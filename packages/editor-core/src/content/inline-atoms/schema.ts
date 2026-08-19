import {
  cloneJsonValue,
  validateJsonObject,
  type JsonObject,
  type JsonValue,
} from "../../kernel/json/json-value.ts";
import type { InlineMetadataFieldDefinition } from "./types.ts";

export type InlineAtomMetadataValidationResult =
  | {
      readonly valid: true;
      readonly value: JsonObject;
      readonly errors: readonly [];
    }
  | {
      readonly valid: false;
      readonly value: null;
      readonly errors: readonly string[];
    };

export function validateAndCloneInlineAtomMetadata(
  metadata: unknown,
  fields: Readonly<Record<string, InlineMetadataFieldDefinition>>,
  label = "metadata",
): InlineAtomMetadataValidationResult {
  const jsonErrors = validateJsonObject(metadata, label);
  if (jsonErrors.length > 0) {
    return { valid: false, value: null, errors: [...jsonErrors] };
  }
  const value = metadata as JsonObject;
  const errors: string[] = [];
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(fields, key)) {
      errors.push(`${label}.${key} is not declared`);
    }
  }
  for (const [name, field] of Object.entries(fields)) {
    if (!Object.hasOwn(value, name)) {
      if (field.required) errors.push(`${label}.${name} is required`);
      continue;
    }
    const fieldValue = value[name];
    if (!matchesMetadataFieldType(fieldValue, field.type)) {
      errors.push(`${label}.${name} must be ${metadataTypeLabel(field.type)}`);
      continue;
    }
    if (
      field.required &&
      field.type === "string" &&
      typeof fieldValue === "string" &&
      fieldValue.trim().length === 0
    ) {
      errors.push(`${label}.${name} must be a non-empty string`);
    }
  }
  return errors.length > 0
    ? { valid: false, value: null, errors }
    : {
        valid: true,
        value: cloneJsonValue(value),
        errors: [],
      };
}

function matchesMetadataFieldType(
  value: JsonValue | undefined,
  type: InlineMetadataFieldDefinition["type"],
): boolean {
  if (value === undefined) return false;
  switch (type) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "object":
      return (
        value !== null && typeof value === "object" && !Array.isArray(value)
      );
    case "array":
      return Array.isArray(value);
    case "null":
      return value === null;
    case "json":
      return true;
  }
}

function metadataTypeLabel(
  type: InlineMetadataFieldDefinition["type"],
): string {
  return type === "json" ? "a JSON value" : `a JSON ${type}`;
}
