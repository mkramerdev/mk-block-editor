import type { BlockType } from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type { JsonObject } from "../../kernel/json/json-value.ts";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import {
  blockDefinitionAcceptsParent,
  blockDefinitionAcceptsSequence,
  minimumChildTypes,
} from "../../definitions/structural-queries.ts";
import { cloneJsonValue } from "../../kernel/json/json-value.ts";
import { createBlockRecord } from "../../metadata/block-record.ts";
import { blockCreationSelectionTargetKind } from "./creation-selection.ts";
import { createCollisionSafeBlockIdAllocator } from "./block-id-allocator.ts";

export interface PlanBlockTreeCreationInput {
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly type: BlockType;
  readonly metadata?: JsonObject;
  /**
   * Requests an exact number of direct children using only the available
   * definition's defaultContent type. Required child types still come from
   * the definition and the resulting sequence must satisfy its content rule.
   */
  readonly defaultContentCount?: number;
  readonly parentId?: BlockId | null;
  readonly rootBlockId?: BlockId;
  readonly selection?: boolean;
  readonly createBlockId?: () => BlockId;
  readonly reservedBlockIds?: ReadonlySet<BlockId>;
  readonly isBlockIdReserved?: (blockId: BlockId) => boolean;
}

export interface PlannedBlockTreeNode {
  readonly id: BlockId;
  readonly type: BlockType;
  readonly parentId: BlockId | null;
  readonly metadata?: JsonObject;
}

export interface BlockTreeCreationPlan {
  readonly rootBlockId: BlockId;
  readonly nodes: readonly PlannedBlockTreeNode[];
  readonly selectionBlockId: BlockId | null;
}

export function planBlockTreeCreation(
  input: PlanBlockTreeCreationInput,
): BlockTreeCreationPlan {
  const idAllocator = createCollisionSafeBlockIdAllocator({
    ...(input.createBlockId ? { createBlockId: input.createBlockId } : {}),
    ...(input.reservedBlockIds
      ? { reservedBlockIds: input.reservedBlockIds }
      : {}),
    ...(input.isBlockIdReserved
      ? { isBlockIdReserved: input.isBlockIdReserved }
      : {}),
    purpose: "block creation",
  });
  const nodes: PlannedBlockTreeNode[] = [];
  const allocate = (type: BlockType, preferred?: BlockId): BlockId => {
    try {
      return createBlockRecord({
        id:
          preferred === undefined
            ? idAllocator.allocateBlockId()
            : idAllocator.reserveBlockId(preferred),
        type,
      }).id;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("block id ")) {
        throw new Error(`block creation id ${preferred} is already reserved`);
      }
      throw new Error("unable to allocate unique ids for block creation");
    }
  };

  const append = (
    type: BlockType,
    parentId: BlockId | null,
    metadata: JsonObject | undefined,
    preferredId: BlockId | undefined,
    ancestors: ReadonlySet<BlockType>,
    defaultContentCount?: number,
  ): BlockId => {
    const definition = input.blockDefinitions[type];
    if (!definition) throw new Error(`unknown block type ${type}`);
    if (ancestors.has(type)) {
      throw new Error(`recursive block creation cycle includes ${type}`);
    }
    const id = allocate(type, preferredId);
    const materializedMetadata = materializeBlockCreationMetadata(
      definition,
      metadata,
    );
    nodes.push(
      createBlockRecord({
        id,
        type,
        parentId,
        metadata: materializedMetadata,
      }),
    );
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(type);
    const minimumChildren = minimumChildTypes(
      input.blockDefinitions,
      definition,
    );
    const childTypes = [...minimumChildren];
    if (defaultContentCount !== undefined) {
      if (!Number.isInteger(defaultContentCount) || defaultContentCount < 0) {
        throw new Error("defaultContentCount must be a non-negative integer");
      }
      if (defaultContentCount < minimumChildren.length) {
        throw new Error(
          `block definition ${type} requires at least ${minimumChildren.length} direct children`,
        );
      }
      if (defaultContentCount > minimumChildren.length) {
        if (!definition.defaultContent) {
          throw new Error(
            `block definition ${type} does not declare defaultContent for additional children`,
          );
        }
        childTypes.push(
          ...Array.from(
            { length: defaultContentCount - minimumChildren.length },
            () => definition.defaultContent!,
          ),
        );
      }
      if (
        !blockDefinitionAcceptsSequence(
          input.blockDefinitions,
          definition,
          childTypes,
        )
      ) {
        throw new Error(
          `block definition ${type} rejects ${defaultContentCount} default children`,
        );
      }
    }
    for (const childType of childTypes) {
      append(childType, id, undefined, undefined, nextAncestors);
    }
    return id;
  };

  const rootBlockId = append(
    input.type,
    input.parentId ?? null,
    input.metadata,
    input.rootBlockId,
    new Set(),
    input.defaultContentCount,
  );
  const rootDefinition = input.blockDefinitions[input.type]!;
  if (
    (input.parentId === undefined || input.parentId === null) &&
    !blockDefinitionAcceptsParent(rootDefinition, null)
  ) {
    throw new Error(`block definition ${input.type} cannot be created at root`);
  }
  const primarySelectionNode = input.selection
    ? nodes.find((node) => {
        const definition = input.blockDefinitions[node.type];
        return Boolean(
          definition &&
          (definition.kind === "text" || definition.kind === "atomic") &&
          blockCreationSelectionTargetKind(definition) !== null,
        );
      })
    : undefined;
  const wrapperSelectionNode =
    input.selection && !primarySelectionNode
      ? nodes.find((node) => {
          const definition = input.blockDefinitions[node.type];
          return (
            definition?.kind === "wrapper" &&
            blockCreationSelectionTargetKind(definition) === "block"
          );
        })
      : undefined;
  const selectionBlockId =
    primarySelectionNode?.id ?? wrapperSelectionNode?.id ?? null;
  return {
    rootBlockId,
    nodes,
    selectionBlockId,
  };
}

export function materializeBlockCreationMetadata(
  definition: BlockDefinition,
  metadata: JsonObject | undefined,
): JsonObject | undefined {
  const value = metadata ?? definition.defaultMetadata;
  return value === undefined ? undefined : cloneJsonValue(value);
}
