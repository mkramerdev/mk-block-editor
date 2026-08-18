import type { JsonObject } from "../../kernel/json/json-value.ts";

export type InlineMetadataValueType =
  | "string"
  | "number"
  | "boolean"
  | "object"
  | "array"
  | "null"
  | "json";

export interface InlineMetadataFieldDefinition {
  readonly type: InlineMetadataValueType;
  readonly required?: boolean;
}

export type InlineAtomMetadata = JsonObject;
