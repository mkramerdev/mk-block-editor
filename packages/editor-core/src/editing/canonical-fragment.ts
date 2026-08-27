import {
  createBlockRichTextContentFromPlainText,
  extractPlainTextFromRichTextDocument,
  validateRichTextDocumentNodeJson,
} from "../content/rich-text/rich-inline-content.ts";
import type { RichTextDocumentNodeJson } from "../content/rich-text/rich-inline-types.ts";
import type { BlockDefinition } from "../definitions/block-definition.ts";
import { blockDefinitionAcceptsSequence } from "../definitions/structural-queries.ts";
import type { BlockId } from "../kernel/identity/ids.ts";
import { cloneJsonValue, jsonValuesEqual } from "../kernel/json/json-value.ts";
import type { JsonObject } from "../kernel/json/json-value.ts";
import { createBlockRecord } from "../metadata/block-record.ts";
import { normalizeBlockMetadata } from "../metadata/block-metadata.ts";
import { validateBlockMetadataForDefinitionWithChildren } from "../metadata/validation.ts";
import type { Block, BlockType } from "../document/model/block.ts";
import { planBlockTreeCreation } from "./block-editing/creation-planner.ts";

export interface CanonicalBlockRecord {
  readonly id: BlockId;
  readonly type: BlockType;
  readonly parentId: BlockId | null;
  readonly metadata?: JsonObject;
  readonly content?: RichTextDocumentNodeJson;
  readonly plainText?: string;
}

export type CanonicalFragmentBoundary =
  | {
      readonly kind: "block";
      readonly blockId: BlockId;
    }
  | {
      readonly kind: "text";
      readonly blockId: BlockId;
    };

export interface CanonicalBlockFragment {
  readonly blocks: readonly CanonicalBlockRecord[];
  readonly rootBlockIds: readonly BlockId[];
  readonly start: CanonicalFragmentBoundary;
  readonly end: CanonicalFragmentBoundary;
}

const canonicalBlockFragmentCandidate: unique symbol = Symbol(
  "canonical-block-fragment-candidate",
);

/** Fresh outgoing fragment data that has not crossed a validation boundary. */
export interface CanonicalBlockFragmentCandidate {
  readonly kind: "canonical-block-fragment-candidate";
  readonly blocks: readonly CanonicalBlockRecord[];
  readonly rootBlockIds: readonly BlockId[];
  readonly start: CanonicalFragmentBoundary;
  readonly end: CanonicalFragmentBoundary;
  readonly [canonicalBlockFragmentCandidate]: true;
}

export interface CreateCanonicalBlockRecordOptions {
  readonly id?: BlockId;
  readonly type: BlockType;
  readonly parentId?: BlockId | null;
  readonly metadata?: JsonObject;
  readonly content?: RichTextDocumentNodeJson;
  readonly plainText?: string;
}

export interface CanonicalFragmentValidationOptions {
  readonly blockDefinitions?: Readonly<Record<BlockType, BlockDefinition>>;
}

export interface CreateCanonicalBlockFragmentOptions extends CanonicalFragmentValidationOptions {
  readonly blocks: readonly CanonicalBlockRecord[];
  readonly rootBlockIds: readonly BlockId[];
  readonly start: CanonicalFragmentBoundary;
  readonly end: CanonicalFragmentBoundary;
}

export type CreateCanonicalBlockFragmentCandidateOptions = Omit<
  CreateCanonicalBlockFragmentOptions,
  keyof CanonicalFragmentValidationOptions
>;

export interface DuplicateCanonicalBlockSubtreesOptions extends CanonicalFragmentValidationOptions {
  readonly blocks: Readonly<Record<BlockId, Block>>;
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
  readonly rootBlockIds: readonly BlockId[];
  readonly readContent: (
    blockId: BlockId,
    blockType: BlockType,
  ) => RichTextDocumentNodeJson | null;
}

export interface MaterializeCanonicalBlockCreationOptions extends CanonicalFragmentValidationOptions {
  readonly type: BlockType;
  readonly metadata?: JsonObject;
  readonly defaultContentCount?: number;
  readonly content?: RichTextDocumentNodeJson;
  readonly plainText?: string;
  readonly initialText?: string;
  readonly createBlockId?: () => BlockId;
  readonly reservedBlockIds?: ReadonlySet<BlockId>;
  readonly isBlockIdReserved?: (blockId: BlockId) => boolean;
}

export interface MaterializedCanonicalBlockCreation {
  readonly fragment: CanonicalBlockFragment;
  readonly rootBlockId: BlockId;
  readonly selectionBlockId: BlockId | null;
}

export interface ReidentifyCanonicalBlockFragmentOptions extends CanonicalFragmentValidationOptions {
  readonly fragment: CanonicalBlockFragment;
  readonly allocateBlockId: () => BlockId;
}

/** Creates one detached canonical record with an ordinary newly allocated block ID. */
export function createCanonicalBlockRecord(
  options: CreateCanonicalBlockRecordOptions,
): CanonicalBlockRecord {
  const block = createBlockRecord({
    ...(options.id === undefined ? {} : { id: options.id }),
    type: options.type,
    parentId: options.parentId,
    metadata: options.metadata,
  });
  return {
    id: block.id,
    type: block.type,
    parentId: block.parentId,
    ...(block.metadata === undefined ? {} : { metadata: block.metadata }),
    ...(options.content === undefined
      ? {}
      : { content: cloneJsonValue(options.content) }),
    ...(options.plainText === undefined
      ? {}
      : { plainText: options.plainText }),
  };
}

/**
 * Finalizes a detached fragment. The input is validated as-is; malformed input
 * is rejected and is never repaired or reordered.
 */
export function createCanonicalBlockFragment(
  options: CreateCanonicalBlockFragmentOptions,
): CanonicalBlockFragment {
  const fragment: CanonicalBlockFragment = {
    blocks: [...options.blocks],
    rootBlockIds: [...options.rootBlockIds],
    start: { ...options.start },
    end: { ...options.end },
  };
  assertValidCanonicalBlockFragment(fragment, options);
  return fragment;
}

/** Creates fresh outgoing data without asserting that it is a valid fragment. */
export function createCanonicalBlockFragmentCandidate(
  options: CreateCanonicalBlockFragmentCandidateOptions,
): CanonicalBlockFragmentCandidate {
  return {
    kind: "canonical-block-fragment-candidate",
    blocks: [...options.blocks],
    rootBlockIds: [...options.rootBlockIds],
    start: { ...options.start },
    end: { ...options.end },
    [canonicalBlockFragmentCandidate]: true,
  };
}

/**
 * Reidentifies detached structure for one destination-owned insertion attempt.
 * Content and metadata remain immutable shared values; only structural identity
 * records and fragment boundaries are replaced.
 */
export function reidentifyCanonicalBlockFragment(
  options: ReidentifyCanonicalBlockFragmentOptions,
): CanonicalBlockFragment {
  assertValidCanonicalBlockFragment(options.fragment, options);
  const sourceIds = new Set(options.fragment.blocks.map((block) => block.id));
  const allocatedIds = new Set<BlockId>();
  const mappedIds = new Map<BlockId, BlockId>();
  for (const block of options.fragment.blocks) {
    const allocated = options.allocateBlockId();
    if (sourceIds.has(allocated)) {
      throw new Error(
        `fragment reidentification reused source block id ${allocated}`,
      );
    }
    if (allocatedIds.has(allocated)) {
      throw new Error(
        `fragment reidentification allocated duplicate block id ${allocated}`,
      );
    }
    allocatedIds.add(allocated);
    mappedIds.set(block.id, allocated);
  }

  const mapId = (sourceId: BlockId): BlockId => {
    const mapped = mappedIds.get(sourceId);
    if (!mapped) {
      throw new Error(
        `fragment reidentification cannot map missing block ${sourceId}`,
      );
    }
    return mapped;
  };
  const blocks = options.fragment.blocks.map(
    (block): CanonicalBlockRecord => ({
      ...block,
      id: mapId(block.id),
      parentId: block.parentId === null ? null : mapId(block.parentId),
    }),
  );
  return createCanonicalBlockFragment({
    blocks,
    rootBlockIds: options.fragment.rootBlockIds.map(mapId),
    start: {
      ...options.fragment.start,
      blockId: mapId(options.fragment.start.blockId),
    },
    end: {
      ...options.fragment.end,
      blockId: mapId(options.fragment.end.blockId),
    },
    ...(options.blockDefinitions
      ? { blockDefinitions: options.blockDefinitions }
      : {}),
  });
}

/**
 * Materializes an application-created block tree directly as detached
 * canonical content. Identity allocation happens here; insertion must preserve
 * the resulting IDs.
 */
export function materializeCanonicalBlockCreation(
  options: MaterializeCanonicalBlockCreationOptions,
): MaterializedCanonicalBlockCreation {
  if (!options.blockDefinitions) {
    throw new Error(
      "block definitions are required to materialize block creation",
    );
  }
  const creation = planBlockTreeCreation({
    blockDefinitions: options.blockDefinitions,
    type: options.type,
    parentId: null,
    metadata: options.metadata,
    defaultContentCount: options.defaultContentCount,
    selection: true,
    createBlockId: options.createBlockId,
    reservedBlockIds: options.reservedBlockIds,
    isBlockIdReserved: options.isBlockIdReserved,
  });
  const records = creation.nodes.map((node): CanonicalBlockRecord => {
    const definition = options.blockDefinitions![node.type];
    if (!definition) throw new Error(`unknown block type ${node.type}`);
    if (definition.kind !== "text") {
      return {
        id: node.id,
        type: node.type,
        parentId: node.parentId,
        ...(node.metadata === undefined ? {} : { metadata: node.metadata }),
      };
    }
    const isInitialTextTarget =
      options.initialText !== undefined &&
      node.id === creation.selectionBlockId;
    const isRoot = node.id === creation.rootBlockId;
    const content = isInitialTextTarget
      ? createBlockRichTextContentFromPlainText(node.type, options.initialText!)
      : isRoot && options.content !== undefined
        ? options.content
        : createBlockRichTextContentFromPlainText(node.type, "");
    const plainText = isInitialTextTarget
      ? options.initialText!
      : isRoot && options.content !== undefined
        ? (options.plainText ??
          extractPlainTextFromRichTextDocument(options.content))
        : "";
    return {
      id: node.id,
      type: node.type,
      parentId: node.parentId,
      ...(node.metadata === undefined ? {} : { metadata: node.metadata }),
      content,
      plainText,
    };
  });
  const fragment = createCanonicalBlockFragment({
    blocks: records,
    rootBlockIds: [creation.rootBlockId],
    start: { kind: "block", blockId: creation.rootBlockId },
    end: { kind: "block", blockId: creation.rootBlockId },
    blockDefinitions: options.blockDefinitions,
  });
  return {
    fragment,
    rootBlockId: creation.rootBlockId,
    selectionBlockId: creation.selectionBlockId,
  };
}

/** Materializes complete live subtrees with entirely new detached identities. */
export function duplicateCanonicalBlockSubtrees(
  options: DuplicateCanonicalBlockSubtreesOptions,
): CanonicalBlockFragment {
  if (!options.blockDefinitions) {
    throw new Error("block definitions are required to duplicate subtrees");
  }
  const sourceIds: BlockId[] = [];
  const seen = new Set<BlockId>();
  const visit = (sourceId: BlockId): void => {
    if (seen.has(sourceId)) {
      throw new Error(`duplicate subtree input repeats block ${sourceId}`);
    }
    const source = options.blocks[sourceId];
    if (!source || source.tombstone) {
      throw new Error(`cannot duplicate missing block ${sourceId}`);
    }
    seen.add(sourceId);
    sourceIds.push(sourceId);
    for (const childId of options.childIdsByParentId[sourceId] ?? []) {
      if (options.blocks[childId]?.parentId !== sourceId) {
        throw new Error(
          `subtree child ${childId} does not belong to ${sourceId}`,
        );
      }
      visit(childId);
    }
  };
  for (const rootId of options.rootBlockIds) visit(rootId);

  const allocatedBySourceId = new Map(
    sourceIds.map((sourceId) => {
      const source = options.blocks[sourceId]!;
      return [
        sourceId,
        createBlockRecord({
          type: source.type,
          metadata: source.metadata,
        }),
      ] as const;
    }),
  );
  const rootSourceIds = new Set(options.rootBlockIds);
  const records = sourceIds.map((sourceId): CanonicalBlockRecord => {
    const source = options.blocks[sourceId]!;
    const allocated = allocatedBySourceId.get(sourceId)!;
    const definition = options.blockDefinitions![source.type];
    if (!definition) throw new Error(`unknown block type ${source.type}`);
    const parentId = rootSourceIds.has(sourceId)
      ? null
      : source.parentId === null
        ? null
        : (allocatedBySourceId.get(source.parentId)?.id ?? null);
    if (!rootSourceIds.has(sourceId) && parentId === null) {
      throw new Error(
        `subtree block ${sourceId} has a parent outside the input`,
      );
    }
    if (definition.kind !== "text") {
      return {
        id: allocated.id,
        type: allocated.type,
        parentId,
        ...(allocated.metadata === undefined
          ? {}
          : { metadata: allocated.metadata }),
      };
    }
    const content = options.readContent(sourceId, source.type);
    if (!content) throw new Error(`text block ${sourceId} has no content`);
    const validation = validateRichTextDocumentNodeJson(
      content,
      `source block ${sourceId} content`,
    );
    if (!validation.valid) throw new Error(validation.errors.join("; "));
    return {
      id: allocated.id,
      type: allocated.type,
      parentId,
      ...(allocated.metadata === undefined
        ? {}
        : { metadata: allocated.metadata }),
      content: cloneJsonValue(content),
      plainText: extractPlainTextFromRichTextDocument(content),
    };
  });
  const rootBlockIds = options.rootBlockIds.map(
    (sourceId) => allocatedBySourceId.get(sourceId)!.id,
  );
  return createCanonicalBlockFragment({
    blocks: records,
    rootBlockIds,
    start: { kind: "block", blockId: rootBlockIds[0]! },
    end: {
      kind: "block",
      blockId: rootBlockIds[rootBlockIds.length - 1]!,
    },
    blockDefinitions: options.blockDefinitions,
  });
}

export function assertValidCanonicalBlockFragment(
  fragment: CanonicalBlockFragment,
  options: CanonicalFragmentValidationOptions = {},
): void {
  const errors = validateCanonicalBlockFragment(fragment, options);
  if (errors.length > 0) {
    throw new Error(`Invalid canonical block fragment: ${errors.join("; ")}`);
  }
}

export function validateCanonicalBlockFragment(
  fragment: CanonicalBlockFragment,
  options: CanonicalFragmentValidationOptions = {},
): readonly string[] {
  const errors: string[] = [];
  if (fragment.blocks.length === 0) {
    return ["fragment must contain at least one block"];
  }

  const blockById = new Map<BlockId, CanonicalBlockRecord>();
  for (const block of fragment.blocks) {
    if (blockById.has(block.id)) {
      errors.push(`fragment contains duplicate block id ${block.id}`);
      continue;
    }
    blockById.set(block.id, block);
  }

  const rootIds = new Set<BlockId>();
  for (const rootId of fragment.rootBlockIds) {
    if (rootIds.has(rootId)) {
      errors.push(`fragment contains duplicate root id ${rootId}`);
      continue;
    }
    rootIds.add(rootId);
    const root = blockById.get(rootId);
    if (!root) errors.push(`fragment root ${rootId} is missing from blocks`);
    else if (root.parentId !== null) {
      errors.push(`fragment root ${rootId} must have parentId null`);
    }
  }
  if (fragment.rootBlockIds.length === 0) {
    errors.push("fragment must contain at least one root");
  }

  const childrenByParentId = new Map<BlockId, BlockId[]>();
  for (const block of fragment.blocks) {
    if (block.parentId === null) {
      if (!rootIds.has(block.id)) {
        errors.push(`root record ${block.id} is missing from rootBlockIds`);
      }
      continue;
    }
    if (!blockById.has(block.parentId)) {
      errors.push(
        `fragment block ${block.id} has missing parent ${block.parentId}`,
      );
      continue;
    }
    if (rootIds.has(block.id)) {
      errors.push(`non-root block ${block.id} is listed as a root`);
    }
    const children = childrenByParentId.get(block.parentId) ?? [];
    children.push(block.id);
    childrenByParentId.set(block.parentId, children);
  }

  const visiting = new Set<BlockId>();
  const visited = new Set<BlockId>();
  const canonicalIds: BlockId[] = [];
  const visit = (blockId: BlockId): void => {
    if (visiting.has(blockId)) {
      errors.push(`fragment contains a parent cycle at ${blockId}`);
      return;
    }
    if (visited.has(blockId)) return;
    visiting.add(blockId);
    visited.add(blockId);
    canonicalIds.push(blockId);
    for (const childId of childrenByParentId.get(blockId) ?? []) visit(childId);
    visiting.delete(blockId);
  };
  for (const rootId of fragment.rootBlockIds) {
    if (blockById.has(rootId)) visit(rootId);
  }
  for (const block of fragment.blocks) {
    if (!visited.has(block.id)) {
      const chain = parentChain(block.id, blockById);
      if (chain.cycle) {
        errors.push(`fragment contains a parent cycle at ${chain.cycle}`);
      } else {
        errors.push(`fragment block ${block.id} is unreachable from its roots`);
      }
    }
  }
  if (
    canonicalIds.length === fragment.blocks.length &&
    canonicalIds.some((id, index) => fragment.blocks[index]?.id !== id)
  ) {
    errors.push(
      "fragment blocks must be in parent-before-child canonical reading order",
    );
  }

  validateBoundary("start", fragment.start, blockById, options, errors);
  validateBoundary("end", fragment.end, blockById, options, errors);
  validateRecords(fragment, blockById, childrenByParentId, options, errors);
  return errors;
}

function validateRecords(
  fragment: CanonicalBlockFragment,
  blockById: ReadonlyMap<BlockId, CanonicalBlockRecord>,
  childrenByParentId: ReadonlyMap<BlockId, readonly BlockId[]>,
  options: CanonicalFragmentValidationOptions,
  errors: string[],
): void {
  const definitions = options.blockDefinitions;
  for (const block of fragment.blocks) {
    let normalizedMetadata: JsonObject | undefined;
    try {
      normalizedMetadata = normalizeBlockMetadata(block.metadata);
      if (
        (block.metadata === undefined) !== (normalizedMetadata === undefined) ||
        (block.metadata !== undefined &&
          !jsonValuesEqual(block.metadata, normalizedMetadata))
      ) {
        errors.push(`fragment block ${block.id} metadata is not normalized`);
      }
    } catch (error) {
      errors.push(
        `fragment block ${block.id} has invalid metadata: ${errorMessage(error)}`,
      );
    }

    const definition = definitions?.[block.type];
    if (definitions && !definition) {
      errors.push(`fragment block ${block.id} has unknown type ${block.type}`);
      continue;
    }
    const children = childrenByParentId.get(block.id) ?? [];
    if (definition) {
      if (definition.parents) {
        const parent =
          block.parentId === null ? null : blockById.get(block.parentId);
        if (!parent || !definition.parents.allowed.includes(parent.type)) {
          errors.push(
            `fragment block ${block.id} has invalid direct parent for type ${block.type}`,
          );
        }
      }
      errors.push(
        ...validateBlockMetadataForDefinitionWithChildren(
          block.metadata,
          definition,
          { blockId: block.id, directChildIds: children },
          `fragment block ${block.id} metadata`,
        ),
      );
      const childTypes = children.flatMap((id) => {
        const child = blockById.get(id);
        return child ? [child.type] : [];
      });
      if (
        !blockDefinitionAcceptsSequence(definitions, definition, childTypes)
      ) {
        errors.push(
          `fragment block ${block.id} has invalid wrapper child sequence`,
        );
      }
      if (definition.kind === "text") {
        validateTextRecord(block, errors);
      } else {
        validateNonTextRecord(block, errors);
      }
    } else if (block.content !== undefined || block.plainText !== undefined) {
      validateTextRecord(block, errors);
    }
  }
}

function validateTextRecord(
  block: CanonicalBlockRecord,
  errors: string[],
): void {
  if (block.content === undefined) {
    errors.push(`text fragment block ${block.id} is missing rich-text content`);
    return;
  }
  if (block.plainText === undefined) {
    errors.push(`text fragment block ${block.id} is missing plain text`);
    return;
  }
  const validation = validateRichTextDocumentNodeJson(
    block.content,
    `fragment block ${block.id} content`,
  );
  if (!validation.valid) {
    errors.push(...validation.errors);
    return;
  }
  const extracted = extractPlainTextFromRichTextDocument(block.content);
  if (extracted !== block.plainText) {
    errors.push(
      `text fragment block ${block.id} plain text does not match rich-text content`,
    );
  }
}

function validateNonTextRecord(
  block: CanonicalBlockRecord,
  errors: string[],
): void {
  if (block.content !== undefined || block.plainText !== undefined) {
    errors.push(
      `non-text fragment block ${block.id} must not carry text content`,
    );
  }
}

function validateBoundary(
  edge: "start" | "end",
  boundary: CanonicalFragmentBoundary,
  blockById: ReadonlyMap<BlockId, CanonicalBlockRecord>,
  options: CanonicalFragmentValidationOptions,
  errors: string[],
): void {
  const block = blockById.get(boundary.blockId);
  if (!block) {
    errors.push(
      `fragment ${edge} boundary refers to missing block ${boundary.blockId}`,
    );
    return;
  }
  if (
    boundary.kind === "text" &&
    (options.blockDefinitions
      ? options.blockDefinitions[block.type]?.kind !== "text"
      : block.content === undefined)
  ) {
    errors.push(
      `fragment ${edge} text boundary refers to non-text block ${block.id}`,
    );
  }
}

function parentChain(
  blockId: BlockId,
  blockById: ReadonlyMap<BlockId, CanonicalBlockRecord>,
): { readonly cycle: BlockId | null } {
  const seen = new Set<BlockId>();
  let current: BlockId | null = blockId;
  while (current !== null) {
    if (seen.has(current)) return { cycle: current };
    seen.add(current);
    current = blockById.get(current)?.parentId ?? null;
  }
  return { cycle: null };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
