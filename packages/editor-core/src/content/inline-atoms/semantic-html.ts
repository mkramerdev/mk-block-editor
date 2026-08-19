import type { JsonObject } from "../../kernel/json/json-value.ts";
import { validateAndCloneInlineAtomMetadata } from "./schema.ts";
import type { InlineMetadataFieldDefinition } from "./types.ts";

export const INLINE_ATOM_SEMANTIC_HTML_ATTRIBUTE = "data-editor-inline-atom";

interface InlineAtomSemanticHtmlEnvelope {
  readonly version: 1;
  readonly type: string;
  readonly metadata: JsonObject;
}

export function serializeInlineAtomSemanticHtmlEnvelope(input: {
  readonly type: string;
  readonly metadata: unknown;
  readonly fields: Readonly<Record<string, InlineMetadataFieldDefinition>>;
}): string | null {
  const metadata = validateAndCloneInlineAtomMetadata(
    input.metadata,
    input.fields,
  );
  if (!metadata.valid) return null;
  return encodeURIComponent(
    JSON.stringify({
      version: 1,
      type: input.type,
      metadata: metadata.value,
    } satisfies InlineAtomSemanticHtmlEnvelope),
  );
}

export function parseInlineAtomSemanticHtmlEnvelope(input: {
  readonly payload: string;
  readonly definitions: readonly {
    readonly type: string;
    readonly metadata: Readonly<Record<string, InlineMetadataFieldDefinition>>;
  }[];
}): { readonly type: string; readonly metadata: JsonObject } | null {
  try {
    const value = JSON.parse(decodeURIComponent(input.payload)) as unknown;
    if (
      !isRecord(value) ||
      value.version !== 1 ||
      typeof value.type !== "string"
    )
      return null;
    const definition = input.definitions.find(
      (candidate) => candidate.type === value.type,
    );
    if (!definition) return null;
    const metadata = validateAndCloneInlineAtomMetadata(
      value.metadata,
      definition.metadata,
    );
    return metadata.valid
      ? { type: definition.type, metadata: metadata.value }
      : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
