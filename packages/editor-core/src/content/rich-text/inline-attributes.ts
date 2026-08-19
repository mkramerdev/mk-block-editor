import { cloneJsonValue } from "../../kernel/json/json-value.ts";
import { sanitizeEditorLinkUrl } from "../urls/editor-url.ts";

export type InlineTextContext = "text";

export type InlineAttributePrimitive = string | number | boolean | null;

export type InlineAttributeJson =
  | InlineAttributePrimitive
  | readonly InlineAttributeJson[]
  | { readonly [key: string]: InlineAttributeJson };

export interface InlineAttributeContract {
  default: InlineAttributeJson;
  required?: boolean;
  sanitize?: "safe-url" | "string" | "json";
  trim?: boolean;
}

export interface InlineCommandMetadata {
  id: string;
  kind: "toggle-mark" | "set-mark-value" | "insert-inline-atom";
}

export const richTextContexts = [
  "text",
] as const satisfies readonly InlineTextContext[];

export function sanitizeInlineAttrValue(
  value: unknown,
  contract: InlineAttributeContract,
): InlineAttributeJson {
  if (contract.sanitize === "json")
    return sanitizeInlineJsonAttr(value, contract.default);
  if (contract.sanitize === "safe-url") return sanitizeInlineUrl(value);
  if (contract.sanitize === "string") {
    if (value === null && contract.default === null) return null;
    const stringValue =
      typeof value === "string"
        ? value
        : String(value ?? contract.default ?? "");
    return contract.trim === false ? stringValue : stringValue.trim();
  }
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  )
    return value;
  return contract.default;
}

export function isInlineAttributePrimitive(
  value: InlineAttributeJson,
): value is InlineAttributePrimitive {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  );
}

function sanitizeInlineJsonAttr(
  value: unknown,
  fallback: InlineAttributeJson,
): InlineAttributeJson {
  if (value === undefined) return cloneJsonValue(fallback);
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeInlineJsonAttr(entry, null));
  }
  if (!isRecord(value)) return cloneJsonValue(fallback);
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, sanitizeInlineJsonAttr(entry, null)]),
  );
}

function sanitizeInlineUrl(value: unknown): string | null {
  return sanitizeEditorLinkUrl(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
