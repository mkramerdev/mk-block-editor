import {
  validateAndCloneInlineAtomMetadata,
  type InlineMetadataFieldDefinition,
} from "@repo/editor-core/content/inline-atoms";
import type { JsonObject } from "@repo/editor-core/kernel";
import type { EditableEditorDefinition, InlineAtomDefinition } from "./contracts.ts";
import type { CompiledCanonicalEditorDefinition } from "./compiled-editor-definition.ts";
import { createImmutableMap } from "./immutable-map.ts";

export interface CompiledEditorInlineAtoms {
  readonly definitions: ReadonlyMap<string, InlineAtomDefinition>;
}

const reservedAtomNodeTypes = new Set([
  "doc",
  "text",
  "hard_break",
  "paragraph",
]);
export function compileEditorInlineAtoms(
  definition: EditableEditorDefinition,
): CompiledEditorInlineAtoms {
  if (!Array.isArray(definition.inlineAtoms)) {
    throw new Error(
      "EditableEditorDefinition.inlineAtoms must be an array of inline atom definitions.",
    );
  }
  const definitions = new Map<string, InlineAtomDefinition>();
  for (const atom of definition.inlineAtoms) {
    assertValidInlineAtomDefinition(atom);
    if (definitions.has(atom.type)) {
      throw new Error(
        `Editor inline atom ${atom.type} is registered more than once.`,
      );
    }
    const metadata: Record<string, InlineMetadataFieldDefinition> = {};
    for (const name of Object.keys(atom.metadata)) {
      const field = atom.metadata[name]!;
      metadata[name] = Object.freeze({
        type: field.type,
        ...(field.required === undefined ? {} : { required: field.required }),
      });
    }
    definitions.set(
      atom.type,
      Object.freeze({ ...atom, metadata: Object.freeze(metadata) }),
    );
  }
  const compiled = Object.freeze({
    definitions: createImmutableMap(definitions),
  });
  return compiled;
}

export function resolveEditorInlineAtomDefinition(
  compiled: CompiledCanonicalEditorDefinition,
  type: string,
): InlineAtomDefinition | null {
  return compiled.inlineAtomRegistry.definitions.get(type) ?? null;
}

export function validateEditorInlineAtomOccurrence(
  compiled: CompiledCanonicalEditorDefinition,
  occurrence: unknown,
  label = "inline atom",
): JsonObject {
  if (!isRecord(occurrence)) {
    throw new Error(`${label} must be an object.`);
  }
  const unexpected = Object.keys(occurrence).filter(
    (key) => key !== "type" && key !== "metadata" && key !== "marks",
  );
  if (unexpected.length > 0) {
    throw new Error(
      `${label} contains unsupported fields: ${unexpected.join(", ")}.`,
    );
  }
  if (typeof occurrence.type !== "string") {
    throw new Error(`${label}.type must be a string.`);
  }
  const atom = resolveEditorInlineAtomDefinition(compiled, occurrence.type);
  if (!atom) {
    throw new Error(`${label}.type ${occurrence.type} is not registered.`);
  }
  const validation = validateAndCloneInlineAtomMetadata(
    occurrence.metadata,
    atom.metadata,
    `${label}.metadata`,
  );
  if (!validation.valid) {
    throw new Error(validation.errors.join("; "));
  }
  return validation.value;
}

function assertValidInlineAtomDefinition(
  definition: InlineAtomDefinition,
): void {
  if (!definition || typeof definition !== "object") {
    throw new Error("Editor inline atom definition must be an object.");
  }
  const unsupported = Object.keys(definition).filter(
    (field) => field !== "type" && field !== "metadata" && field !== "render",
  );
  if (unsupported.length > 0) {
    throw new Error(
      `Editor inline atom definition includes unsupported fields: ${unsupported.join(", ")}.`,
    );
  }
  if (
    typeof definition.type !== "string" ||
    !/^[a-z][a-z0-9_]*$/.test(definition.type) ||
    reservedAtomNodeTypes.has(definition.type)
  ) {
    throw new Error(
      `Editor inline atom type ${String(definition.type)} is empty, malformed, or reserved.`,
    );
  }
  if (!isRecord(definition.metadata)) {
    throw new Error(
      `Editor inline atom ${definition.type} must declare metadata.`,
    );
  }
  for (const [name, field] of Object.entries(definition.metadata)) {
    assertValidMetadataField(definition.type, name, field);
  }
  if (typeof definition.render !== "function") {
    throw new Error(
      `Editor inline atom ${definition.type} must provide a renderer.`,
    );
  }
}

function assertValidMetadataField(
  atomType: string,
  name: string,
  field: InlineMetadataFieldDefinition,
): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !isRecord(field)) {
    throw new Error(
      `Editor inline atom ${atomType} has malformed metadata field ${name}.`,
    );
  }
  const unexpected = Object.keys(field).filter(
    (key) => key !== "type" && key !== "required",
  );
  const validTypes = new Set([
    "string",
    "number",
    "boolean",
    "object",
    "array",
    "null",
    "json",
  ]);
  if (
    unexpected.length > 0 ||
    typeof field.type !== "string" ||
    !validTypes.has(field.type) ||
    (field.required !== undefined && typeof field.required !== "boolean")
  ) {
    throw new Error(
      `Editor inline atom ${atomType} has malformed metadata field ${name}.`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
