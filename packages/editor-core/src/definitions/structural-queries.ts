import type { BlockType } from "../document/model/block.ts";
import type { BlockDefinition } from "./block-definition.ts";

export interface RestorativeDefaultRelationship {
  readonly defaultType: BlockType;
  readonly replacementType: BlockType;
}

/**
 * Resolves the definition-level relationship used by wrappers whose empty
 * state is represented by one replaceable atomic child.
 */
export function resolveRestorativeDefault(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  definition: BlockDefinition,
): RestorativeDefaultRelationship | null {
  if (definition.kind !== "wrapper" || !definition.defaultContent) return null;
  const defaultDefinition = blockDefinitions[definition.defaultContent];
  if (
    defaultDefinition?.kind !== "atomic" ||
    defaultDefinition.replaceWith === undefined
  ) {
    return null;
  }
  const replacementDefinition = blockDefinitions[defaultDefinition.replaceWith];
  if (replacementDefinition?.kind !== "text") return null;
  return Object.freeze({
    defaultType: definition.defaultContent,
    replacementType: defaultDefinition.replaceWith,
  });
}

export function blockDefinitionAcceptsChildren(
  definition: BlockDefinition,
): boolean {
  return definition.kind === "wrapper";
}

export function blockDefinitionAcceptsParent(
  definition: BlockDefinition,
  parentType: BlockType | null,
): boolean {
  const allowed = definition.parents?.allowed;
  return allowed === undefined
    ? true
    : parentType !== null && allowed.includes(parentType);
}

export function requiredChildTypes(
  definition: BlockDefinition,
): readonly BlockType[] {
  return definition.kind === "wrapper" && definition.content
    ? definition.content.required
    : [];
}

export function minimumChildTypes(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  definition: BlockDefinition,
): readonly BlockType[] {
  if (definition.kind !== "wrapper") return [];
  const content = definition.content;
  if (!content) {
    throw new Error(`wrapper definition ${definition.type} is missing content`);
  }
  return content.required.map((requiredType) => {
    if (requiredType !== "block") return requiredType;
    const defaultType = definition.defaultContent;
    if (!defaultType || !blockDefinitions[defaultType]) {
      throw new Error(
        `block definition ${definition.type} requires available defaultContent for block wildcard`,
      );
    }
    return defaultType;
  });
}

export function requiredChildTypeAt(
  definition: BlockDefinition,
  index: number,
): BlockType | null {
  if (!Number.isInteger(index) || index < 0 || definition.kind !== "wrapper") {
    return null;
  }
  const requiredType = definition.content?.required[index];
  return requiredType === undefined || requiredType === "block"
    ? null
    : requiredType;
}

export function isRequiredBlockWildcardAt(
  definition: BlockDefinition,
  index: number,
): boolean {
  return (
    Number.isInteger(index) &&
    index >= 0 &&
    definition.kind === "wrapper" &&
    definition.content?.required[index] === "block"
  );
}

export function additionalChildType(
  definition: BlockDefinition,
): BlockType | "block" | null {
  return definition.kind === "wrapper"
    ? (definition.content?.additional ?? null)
    : null;
}

export function blockDefinitionAcceptsChildType(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  definition: BlockDefinition,
  childType: BlockType,
): boolean {
  const content = definition.content;
  if (
    !blockDefinitions[childType] ||
    definition.kind !== "wrapper" ||
    !content
  ) {
    return false;
  }
  return (
    content.required.some(
      (requiredType) => requiredType === "block" || requiredType === childType,
    ) ||
    content.additional === "block" ||
    content.additional === childType
  );
}

export function blockDefinitionAcceptsSequence(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  definition: BlockDefinition,
  childTypes: readonly BlockType[],
): boolean {
  if (definition.kind === "text" || definition.kind === "atomic") {
    return childTypes.length === 0;
  }
  if (definition.kind !== "wrapper" || !definition.content) return false;
  const { required, additional } = definition.content;
  if (childTypes.length < required.length) return false;
  if (additional === undefined && childTypes.length !== required.length) {
    return false;
  }
  for (const [index, childType] of childTypes.entries()) {
    const childDefinition = blockDefinitions[childType];
    if (
      !childDefinition ||
      !blockDefinitionAcceptsParent(childDefinition, definition.type)
    )
      return false;
    const accepted = index < required.length ? required[index] : additional;
    if (accepted !== "block" && accepted !== childType) return false;
  }
  const restorativeDefault = resolveRestorativeDefault(
    blockDefinitions,
    definition,
  );
  if (
    restorativeDefault &&
    childTypes.includes(restorativeDefault.defaultType) &&
    (childTypes.length !== 1 ||
      childTypes[0] !== restorativeDefault.defaultType)
  ) {
    return false;
  }
  return true;
}

export function blockDefinitionAcceptsInsertion(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  definition: BlockDefinition,
  currentChildTypes: readonly BlockType[],
  insertionIndex: number,
  childType: BlockType,
): boolean {
  if (
    !Number.isInteger(insertionIndex) ||
    insertionIndex < 0 ||
    insertionIndex > currentChildTypes.length
  ) {
    return false;
  }
  const restorativeDefault = resolveRestorativeDefault(
    blockDefinitions,
    definition,
  );
  if (
    restorativeDefault &&
    currentChildTypes.length === 1 &&
    currentChildTypes[0] === restorativeDefault.defaultType &&
    childType !== restorativeDefault.defaultType
  ) {
    return blockDefinitionAcceptsSequence(blockDefinitions, definition, [
      childType,
    ]);
  }
  const candidate = [...currentChildTypes];
  candidate.splice(insertionIndex, 0, childType);
  return blockDefinitionAcceptsSequence(
    blockDefinitions,
    definition,
    candidate,
  );
}

export function blockDefinitionAcceptsBefore(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  definition: BlockDefinition,
  currentChildTypes: readonly BlockType[],
  siblingIndex: number,
  childType: BlockType,
): boolean {
  return blockDefinitionAcceptsInsertion(
    blockDefinitions,
    definition,
    currentChildTypes,
    siblingIndex,
    childType,
  );
}

export function blockDefinitionAcceptsAfter(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  definition: BlockDefinition,
  currentChildTypes: readonly BlockType[],
  siblingIndex: number,
  childType: BlockType,
): boolean {
  return blockDefinitionAcceptsInsertion(
    blockDefinitions,
    definition,
    currentChildTypes,
    siblingIndex + 1,
    childType,
  );
}
