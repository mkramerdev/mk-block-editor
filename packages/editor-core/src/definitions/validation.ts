import type { BlockType } from "../document/model/block.ts";
import { validateJsonObject } from "../kernel/json/json-value.ts";
import type { BlockDefinition } from "./block-definition.ts";
import { minimumChildTypes } from "./structural-queries.ts";

const definitionFields = new Set([
  "type",
  "selection",
  "kind",
  "content",
  "contentBoundary",
  "defaultContent",
  "data",
  "defaultMetadata",
  "parents",
  "validateMetadata",
]);

export function assertValidBlockDefinitions(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
): void {
  for (const [type, definition] of Object.entries(blockDefinitions)) {
    assertValidBlockDefinition(type, definition);
  }

  for (const [type, definition] of Object.entries(blockDefinitions)) {
    for (const parentType of definition.parents?.allowed ?? []) {
      const parent = blockDefinitions[parentType];
      if (!parent || parent.kind !== "wrapper") {
        throw new Error(
          `block definition ${type} allowed parent ${parentType} must be an available wrapper`,
        );
      }
    }
    if (definition.kind !== "wrapper") continue;
    const content = definition.content;
    if (!content) {
      throw new Error(`wrapper definition ${definition.type} is missing content`);
    }
    for (const childType of [
      ...content.required,
      ...(content.additional === undefined ? [] : [content.additional]),
    ]) {
      if (childType !== "block" && !blockDefinitions[childType]) {
        throw new Error(
          `block definition ${type} content type ${childType} is not available`,
        );
      }
    }
    const defaultType = definition.defaultContent;
    if (defaultType !== undefined) {
      if (!blockDefinitions[defaultType]) {
        throw new Error(
          `block definition ${type} defaultContent type ${defaultType} is not available`,
        );
      }
      if (!minimumChildTypes(blockDefinitions, definition).includes(defaultType)) {
        throw new Error(
          `block definition ${type} defaultContent type ${defaultType} does not initialize its required minimum`,
        );
      }
      if (
        content.additional !== undefined &&
        content.additional !== "block" &&
        content.additional !== defaultType
      ) {
        throw new Error(
          `block definition ${type} additional children do not accept defaultContent type ${defaultType}`,
        );
      }
    }
  }

  assertTerminatingConstructionGraph(blockDefinitions);
}

export function assertValidBlockDefinition(
  type: BlockType,
  definition: BlockDefinition,
): void {
  if (!isRecord(definition)) {
    throw new Error(`block definition ${type} must be an object`);
  }
  if (definition.type !== type) {
    throw new Error(`block definition ${type} must declare matching type ${type}`);
  }
  if (
    definition.kind !== "text" &&
    definition.kind !== "atomic" &&
    definition.kind !== "wrapper"
  ) {
    throw new Error(`block definition ${type} kind must be text, atomic, or wrapper`);
  }
  for (const field of Object.keys(definition)) {
    if (!definitionFields.has(field)) {
      throw new Error(`block definition ${type} contains unsupported field ${field}`);
    }
  }
  if (definition.data !== undefined && !isRecord(definition.data)) {
    throw new Error(`block definition ${type} data must be an object`);
  }
  if (definition.defaultMetadata !== undefined) {
    const errors = validateJsonObject(
      definition.defaultMetadata,
      `block definition ${type} defaultMetadata`,
    );
    if (errors.length > 0) throw new Error(errors.join("; "));
  }
  if (definition.selection !== undefined && !isRecord(definition.selection)) {
    throw new Error(`block definition ${type} selection must be an object`);
  }
  if (
    definition.validateMetadata !== undefined &&
    typeof definition.validateMetadata !== "function"
  ) {
    throw new Error(`block definition ${type} validateMetadata must be a function`);
  }
  validateParents(type, definition.parents);

  if (definition.kind !== "wrapper") {
    rejectOwnedFields(type, definition.kind, definition, [
      "content",
      "contentBoundary",
      "defaultContent",
    ]);
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(definition, "content")) {
    throw new Error(`wrapper block definition ${type} must declare content`);
  }
  if (
    !Object.prototype.hasOwnProperty.call(definition, "contentBoundary") ||
    typeof definition.contentBoundary !== "boolean"
  ) {
    throw new Error(
      `wrapper block definition ${type} must declare boolean contentBoundary`,
    );
  }
  const content = definition.content;
  if (!isRecord(content)) {
    throw new Error(
      `wrapper block definition ${type} content must be a required content object`,
    );
  }
  if (
    Object.keys(content).some(
      (field) => field !== "required" && field !== "additional",
    )
  ) {
    throw new Error(`block definition ${type} content contains unsupported fields`);
  }
  if (!Array.isArray(content.required)) {
    throw new Error(`wrapper block definition ${type} required must be an array`);
  }
  if (
    !content.required.every(
      (requiredType) =>
        typeof requiredType === "string" && requiredType.length > 0,
    )
  ) {
    throw new Error(
      `block definition ${type} required child types must be strings`,
    );
  }
  if (
    content.additional !== undefined &&
    (typeof content.additional !== "string" || content.additional.length === 0)
  ) {
    throw new Error(
      `block definition ${type} additional child type must be a string`,
    );
  }
}

function validateParents(
  type: BlockType,
  parents: BlockDefinition["parents"],
): void {
  if (parents === undefined) return;
  if (
    !isRecord(parents) ||
    Object.keys(parents).some((field) => field !== "allowed") ||
    !Array.isArray(parents.allowed) ||
    parents.allowed.length === 0 ||
    !parents.allowed.every(
      (parentType) => typeof parentType === "string" && parentType.length > 0,
    )
  ) {
    throw new Error(
      `block definition ${type} parents must declare a non-empty allowed type array`,
    );
  }
}

function rejectOwnedFields(
  type: BlockType,
  kind: BlockDefinition["kind"],
  definition: BlockDefinition,
  fields: readonly string[],
): void {
  for (const field of fields) {
    if (Object.prototype.hasOwnProperty.call(definition, field)) {
      throw new Error(`${kind} block definition ${type} must not declare ${field}`);
    }
  }
}

function assertTerminatingConstructionGraph(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
): void {
  const visiting = new Set<BlockType>();
  const visited = new Set<BlockType>();
  const visit = (type: BlockType, pathUsesDefault: boolean): void => {
    if (visiting.has(type)) {
      throw new Error(
        pathUsesDefault
          ? `recursive defaultContent cycle includes ${type}`
          : `nonterminating required content cycle includes ${type}`,
      );
    }
    if (visited.has(type)) return;
    visiting.add(type);
    const definition = blockDefinitions[type];
    if (!definition) throw new Error(`block definitions are missing ${type}`);
    if (definition.kind === "wrapper") {
      if (!definition.content) {
        throw new Error(`wrapper definition ${definition.type} is missing content`);
      }
      for (const requiredType of definition.content.required) {
        if (requiredType === "block") {
          if (!definition.defaultContent) {
            throw new Error(
              `block definition ${type} requires available defaultContent for block wildcard`,
            );
          }
          visit(definition.defaultContent, true);
        } else {
          visit(requiredType, pathUsesDefault);
        }
      }
    }
    visiting.delete(type);
    visited.add(type);
  };
  for (const type of Object.keys(blockDefinitions)) visit(type, false);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
