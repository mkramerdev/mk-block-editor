import type { BlockType } from "../document/model/block.ts";
import { validateJsonObject } from "../kernel/json/json-value.ts";
import type { BlockDefinition } from "./block-definition.ts";
import { minimumChildTypes } from "./structural-queries.ts";

const definitionFields = new Set([
  "type",
  "rootLayout",
  "selection",
  "kind",
  "content",
  "contentBoundary",
  "defaultContent",
  "data",
  "defaultMetadata",
  "split",
  "parents",
  "list",
  "conversion",
  "replaceWith",
  "underflow",
  "compound",
  "rangeDeletion",
  "validateMetadata",
  "renderer",
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
  }

  for (const [type, definition] of Object.entries(blockDefinitions)) {
    if (definition.kind === "text") {
      validateSplitMap(blockDefinitions, type, definition);
    }
    if (definition.kind === "atomic") {
      validateAtomicReplacement(blockDefinitions, type, definition.replaceWith);
    }
    if (definition.kind !== "wrapper") continue;

    const content = definition.content;
    if (!content) {
      throw new Error(
        `wrapper definition ${definition.type} is missing content`,
      );
    }
    for (const requiredType of content.required) {
      if (requiredType !== "block" && !blockDefinitions[requiredType]) {
        throw new Error(
          `block definition ${type} content type ${requiredType} is not available`,
        );
      }
    }
    const additional = content.additional;
    if (
      additional !== undefined &&
      additional !== "block" &&
      !blockDefinitions[additional]
    ) {
      throw new Error(
        `block definition ${type} additional type ${additional} is not available`,
      );
    }
    const defaultType = definition.defaultContent;
    if (defaultType !== undefined) {
      if (!blockDefinitions[defaultType]) {
        throw new Error(
          `block definition ${type} defaultContent type ${defaultType} is not available`,
        );
      }
      const minimum = minimumChildTypes(blockDefinitions, definition);
      if (!minimum.includes(defaultType)) {
        throw new Error(
          `block definition ${type} defaultContent type ${defaultType} does not initialize its required minimum`,
        );
      }
      if (
        additional !== undefined &&
        additional !== "block" &&
        additional !== defaultType
      ) {
        throw new Error(
          `block definition ${type} additional children do not accept defaultContent type ${defaultType}`,
        );
      }
    }
    validateUnderflowPolicy(blockDefinitions, type, definition);
    validateCompoundPolicy(blockDefinitions, type, definition);
    validateListPolicy(blockDefinitions, type, definition);
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
    throw new Error(
      `block definition ${type} must declare matching type ${type}`,
    );
  }
  if (
    !Object.prototype.hasOwnProperty.call(definition, "kind") ||
    (definition.kind !== "text" &&
      definition.kind !== "atomic" &&
      definition.kind !== "wrapper")
  ) {
    throw new Error(
      `block definition ${type} kind must be text, atomic, or wrapper`,
    );
  }
  if (
    !Object.prototype.hasOwnProperty.call(definition, "rootLayout") ||
    (definition.rootLayout !== "normal" && definition.rootLayout !== "full")
  ) {
    throw new Error(
      `block definition ${type} rootLayout must be the string normal or full`,
    );
  }
  for (const field of Object.keys(definition)) {
    if (!definitionFields.has(field)) {
      throw new Error(
        `block definition ${type} contains unsupported field ${field}`,
      );
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
    throw new Error(
      `block definition ${type} validateMetadata must be a function`,
    );
  }
  if (
    definition.conversion !== undefined &&
    (!isRecord(definition.conversion) ||
      Object.keys(definition.conversion).some(
        (field) => field !== "metadata",
      ) ||
      definition.conversion.metadata !== "target-defaults")
  ) {
    throw new Error(
      `block definition ${type} conversion must declare metadata target-defaults`,
    );
  }
  if (definition.parents !== undefined) {
    if (
      !isRecord(definition.parents) ||
      Object.keys(definition.parents).some((field) => field !== "allowed") ||
      !Array.isArray(definition.parents.allowed) ||
      definition.parents.allowed.length === 0 ||
      !definition.parents.allowed.every(
        (parentType) => typeof parentType === "string" && parentType.length > 0,
      )
    ) {
      throw new Error(
        `block definition ${type} parents must declare a non-empty allowed type array`,
      );
    }
  }

  if (definition.kind === "text") {
    rejectOwnedFields(type, "text", definition, [
      "content",
      "contentBoundary",
      "defaultContent",
      "replaceWith",
      "underflow",
      "compound",
      "list",
      "rangeDeletion",
    ]);
    return;
  }
  if (definition.kind === "atomic") {
    rejectOwnedFields(type, "atomic", definition, [
      "content",
      "contentBoundary",
      "defaultContent",
      "split",
      "underflow",
      "compound",
      "list",
      "rangeDeletion",
    ]);
    return;
  }

  rejectOwnedFields(type, "wrapper", definition, ["split", "replaceWith"]);
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
    throw new Error(
      `block definition ${type} content contains unsupported fields`,
    );
  }
  if (!Array.isArray(content.required) || content.required.length === 0) {
    throw new Error(
      `wrapper block definition ${type} must require at least one child`,
    );
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
  if (definition.underflow !== undefined) {
    if (
      !isRecord(definition.underflow) ||
      Object.keys(definition.underflow).some((field) => field !== "kind") ||
      definition.underflow.kind !== "promote-single-child-contents"
    ) {
      throw new Error(
        `wrapper block definition ${type} underflow must declare the promote-single-child-contents policy`,
      );
    }
    if (content.required.length < 2) {
      throw new Error(
        `wrapper block definition ${type} underflow requires a minimum of at least two children`,
      );
    }
  }
  if (definition.compound !== undefined) {
    if (
      !isRecord(definition.compound) ||
      Object.keys(definition.compound).some(
        (field) =>
          field !== "kind" &&
          field !== "primaryTextChildType" &&
          field !== "contentWrapperChildType" &&
          field !== "emptyPrimary",
      ) ||
      definition.compound.kind !== "primary-text-with-promoted-content" ||
      typeof definition.compound.primaryTextChildType !== "string" ||
      typeof definition.compound.contentWrapperChildType !== "string" ||
      definition.compound.emptyPrimary !== "remove-wrapper"
    ) {
      throw new Error(
        `wrapper block definition ${type} compound policy is invalid`,
      );
    }
  }
  if (definition.rangeDeletion !== undefined) {
    if (
      !isRecord(definition.rangeDeletion) ||
      Object.keys(definition.rangeDeletion).some((field) => field !== "kind") ||
      (definition.rangeDeletion.kind !== "unwrap-boundary-contents" &&
        definition.rangeDeletion.kind !== "unwrap-boundary-child" &&
        definition.rangeDeletion.kind !== "unwrap-visible-boundary-child")
    ) {
      throw new Error(
        `wrapper block definition ${type} rangeDeletion policy is invalid`,
      );
    }
  }
}

function validateListPolicy(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  type: BlockType,
  definition: BlockDefinition,
): void {
  const policy = definition.list;
  if (policy === undefined) return;
  if (
    !isRecord(policy) ||
    (policy.kind !== "container" && policy.kind !== "item")
  ) {
    throw new Error(`wrapper block definition ${type} list policy is invalid`);
  }
  if (policy.kind === "container") {
    if (
      Object.keys(policy).some(
        (field) => field !== "kind" && field !== "itemType",
      ) ||
      typeof policy.itemType !== "string"
    ) {
      throw new Error(
        `wrapper block definition ${type} list container policy is invalid`,
      );
    }
    const item = blockDefinitions[policy.itemType];
    if (
      !item ||
      item.kind !== "wrapper" ||
      definition.content?.required.length !== 1 ||
      definition.content.required[0] !== policy.itemType ||
      definition.content.additional !== policy.itemType
    ) {
      throw new Error(
        `list container ${type} must require and repeat only item type ${policy.itemType}`,
      );
    }
    if (item.list?.kind !== "item" || item.list.containerType !== type) {
      throw new Error(
        `list container ${type} and item ${policy.itemType} must declare matching relationships`,
      );
    }
    return;
  }
  if (
    Object.keys(policy).some(
      (field) =>
        field !== "kind" &&
        field !== "containerType" &&
        field !== "primaryTextChildType" &&
        field !== "emptyEnter",
    ) ||
    typeof policy.containerType !== "string" ||
    typeof policy.primaryTextChildType !== "string" ||
    policy.emptyEnter !== "lift-primary-out-of-container"
  ) {
    throw new Error(
      `wrapper block definition ${type} list item policy is invalid`,
    );
  }
  const container = blockDefinitions[policy.containerType];
  const primary = blockDefinitions[policy.primaryTextChildType];
  if (
    !container ||
    container.kind !== "wrapper" ||
    container.list?.kind !== "container" ||
    container.list.itemType !== type
  ) {
    throw new Error(
      `list item ${type} must reference a matching list container`,
    );
  }
  if (
    primary?.kind !== "text" ||
    definition.content?.required[0] !== policy.primaryTextChildType
  ) {
    throw new Error(
      `list item ${type} must begin with primary text child ${policy.primaryTextChildType}`,
    );
  }
  if (
    !definition.parents ||
    definition.parents.allowed.length !== 1 ||
    definition.parents.allowed[0] !== policy.containerType
  ) {
    throw new Error(
      `list item ${type} must allow only parent ${policy.containerType}`,
    );
  }
  if (primary.split?.[type] !== type) {
    throw new Error(
      `list item ${type} primary text split must resolve to the matching item type`,
    );
  }
}

function validateUnderflowPolicy(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  type: BlockType,
  definition: BlockDefinition,
): void {
  if (!definition.underflow) return;
  const content = definition.content;
  if (!content) {
    throw new Error(`wrapper definition ${definition.type} is missing content`);
  }
  const childTypes = new Set([
    ...content.required,
    ...(content.additional === undefined ? [] : [content.additional]),
  ]);
  for (const childType of childTypes) {
    if (childType === "block") {
      throw new Error(
        `wrapper block definition ${type} underflow cannot promote contents from a block wildcard`,
      );
    }
    const childDefinition = blockDefinitions[childType];
    if (!childDefinition || childDefinition.kind !== "wrapper") {
      throw new Error(
        `wrapper block definition ${type} underflow child type ${childType} must be a wrapper`,
      );
    }
  }
}

function validateCompoundPolicy(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  type: BlockType,
  definition: BlockDefinition,
): void {
  const policy = definition.compound;
  if (!policy) return;
  const content = definition.content;
  if (
    !content ||
    content.required.length !== 2 ||
    content.required[0] !== policy.primaryTextChildType ||
    content.required[1] !== policy.contentWrapperChildType
  ) {
    throw new Error(
      `wrapper block definition ${type} compound policy must match its two required children`,
    );
  }
  if (blockDefinitions[policy.primaryTextChildType]?.kind !== "text") {
    throw new Error(
      `wrapper block definition ${type} compound primary child must be text`,
    );
  }
  if (blockDefinitions[policy.contentWrapperChildType]?.kind !== "wrapper") {
    throw new Error(
      `wrapper block definition ${type} compound content child must be a wrapper`,
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
      throw new Error(
        `${kind} block definition ${type} must not declare ${field}`,
      );
    }
  }
}

function validateAtomicReplacement(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  atomicType: BlockType,
  replaceWith: BlockType | undefined,
): void {
  if (replaceWith === undefined) return;
  const replacement = blockDefinitions[replaceWith];
  if (!replacement) {
    throw new Error(
      `atomic block definition ${atomicType} replaceWith type ${replaceWith} is not available`,
    );
  }
  if (replacement.kind !== "text") {
    throw new Error(
      `atomic block definition ${atomicType} replaceWith type ${replaceWith} is not text`,
    );
  }
}

function validateSplitMap(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  textType: BlockType,
  definition: BlockDefinition,
): void {
  const split = definition.split;
  if (!split) return;
  if (!split.default) {
    throw new Error(
      `text block definition ${textType} must declare a default split result`,
    );
  }
  for (const [parentType, resultType] of Object.entries(split)) {
    if (parentType !== "default") {
      const parent = blockDefinitions[parentType];
      if (!parent) {
        throw new Error(
          `text block definition ${textType} split parent type ${parentType} is not available`,
        );
      }
      if (parent.kind !== "wrapper") {
        throw new Error(
          `text block definition ${textType} split parent type ${parentType} is not a wrapper`,
        );
      }
    }
    const result = blockDefinitions[resultType];
    if (!result) {
      throw new Error(
        `text block definition ${textType} split result type ${resultType} is not available`,
      );
    }
    if (result.kind === "atomic") {
      throw new Error(
        `text block definition ${textType} split result type ${resultType} is atomic`,
      );
    }
    if (result.kind === "text") continue;
    const directTextChildren = minimumChildTypes(
      blockDefinitions,
      result,
    ).filter((childType) => blockDefinitions[childType]?.kind === "text");
    if (directTextChildren.length !== 1) {
      throw new Error(
        `text block definition ${textType} split result wrapper ${resultType} must contain exactly one direct editable text child`,
      );
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
      const content = definition.content;
      if (!content) {
        throw new Error(
          `wrapper definition ${definition.type} is missing content`,
        );
      }
      for (const requiredType of content.required) {
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
