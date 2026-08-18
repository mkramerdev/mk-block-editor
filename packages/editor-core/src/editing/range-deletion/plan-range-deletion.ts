import {
  isRichTextDocument,
  richTextBlockInlineContent,
  richTextDocumentContentSize,
  sliceRichTextDocument,
} from "../../content/rich-text/rich-inline-content.ts";
import { applyLogicalContentOperationToRichTextDocument } from "../../content/rich-text/content-operations.ts";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import type { BlockType, VersionedBlock } from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import { applyStructuralTransaction } from "../transactions/apply.ts";
import { deleteRange } from "../transactions/primitives/delete-range.ts";
import { moveBlocks } from "../transactions/primitives/move-blocks.ts";
import { removeBlocks } from "../transactions/primitives/remove-blocks.ts";
import { setSelection } from "../transactions/primitives/set-selection.ts";
import type {
  AppliedStructuralTransaction,
  StructuralEditRange,
  StructuralTransactionContext,
  StructuralTransactionOperation,
  StructuralTransactionPlan,
  TransactionReadableContent,
} from "../transactions/types.ts";

export type StructuralRangeDeletionIntent = "cut" | "delete";

export interface PlanStructuralRangeDeletionInput {
  readonly intent: StructuralRangeDeletionIntent;
  readonly range: StructuralEditRange;
  readonly graphRevision: number;
  readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly readContent: (
    blockId: BlockId,
    blockType: BlockType,
  ) => TransactionReadableContent | null;
  readonly validateContent: StructuralTransactionContext["validateContent"];
  readonly resolveVisibleChildBlockIds?: (input: {
    readonly blockId: BlockId;
    readonly blockType: BlockType;
    readonly childBlockIds: readonly BlockId[];
  }) => readonly BlockId[];
}

export type PlanStructuralRangeDeletionResult =
  | { readonly ok: true; readonly plan: StructuralTransactionPlan }
  | {
      readonly ok: false;
      readonly reason: "invalid-range" | "stale-range" | "invalid-result";
      readonly message: string;
    };

class RangeDeletionPlanningFailure extends Error {
  constructor(
    readonly reason: Extract<
      PlanStructuralRangeDeletionResult,
      { ok: false }
    >["reason"],
    message: string,
  ) {
    super(message);
  }
}

/**
 * Resolves deletion-only composition above the raw range-trimming primitive.
 * Open text boundaries are composed first; definition-owned wrapper cleanup is
 * then planned from the post-trim graph and the complete plan is validated.
 */
export function planStructuralRangeDeletion(
  input: PlanStructuralRangeDeletionInput,
): PlanStructuralRangeDeletionResult {
  try {
    if (input.range.graphRevision !== input.graphRevision) {
      return failure("stale-range", "range graph revision changed");
    }
    const operations: StructuralTransactionOperation[] = [];
    const context: StructuralTransactionContext = {
      graphRevision: input.graphRevision,
      blocks: input.blocks,
      rootBlockIds: input.rootBlockIds,
      childIdsByParentId: input.childIdsByParentId,
      blockDefinitions: input.blockDefinitions,
      readContent: input.readContent,
      validateContent: input.validateContent,
    };
    const preview = () => {
      const result = applyStructuralTransaction(
        { origin: rangeDeletionOrigin(input.intent), operations },
        context,
        { validateFinal: false },
      );
      if (!result.ok) {
        throw new RangeDeletionPlanningFailure(
          result.failureKind === "stale-precondition"
            ? "stale-range"
            : "invalid-result",
          result.message,
        );
      }
      return result.transaction;
    };
    const append = (operation: StructuralTransactionOperation) => {
      operations.push(operation);
      return preview();
    };

    const start = input.range.start;
    const end = input.range.end;
    const startEntry = input.range.blocks.find(
      (selected) => selected.blockId === start.blockId,
    );
    const endEntry = input.range.blocks.find(
      (selected) => selected.blockId === end.blockId,
    );
    const startContent =
      start.kind === "text" && startEntry?.kind === "text"
        ? input.readContent(start.blockId, startEntry.blockType)
        : null;
    const endContent =
      end.kind === "text" && endEntry?.kind === "text"
        ? input.readContent(end.blockId, endEntry.blockType)
        : null;
    const startContentSize =
      startContent && isRichTextDocument(startContent.content)
        ? richTextDocumentContentSize(startContent.content)
        : null;
    const endContentSize =
      endContent && isRichTextDocument(endContent.content)
        ? richTextDocumentContentSize(endContent.content)
        : null;
    const hasOpenTextBoundaries =
      start.kind === "text" &&
      end.kind === "text" &&
      start.blockId !== end.blockId &&
      startEntry?.kind === "text" &&
      endEntry?.kind === "text" &&
      startContent !== null &&
      endContent !== null &&
      startContentSize !== null &&
      endContentSize !== null &&
      start.offset > 0 &&
      startEntry.from === start.offset &&
      startEntry.to === startContentSize &&
      endEntry.from === 0 &&
      endEntry.to === end.offset &&
      end.offset < endContentSize;

    if (!hasOpenTextBoundaries) {
      operations.push(deleteRange(input.range));
      const result = applyStructuralTransaction(
        { origin: rangeDeletionOrigin(input.intent), operations },
        context,
        { validateFinal: true },
      );
      if (!result.ok) return failure("invalid-result", result.message);
      return success(input.intent, operations);
    }

    const destination = input.blocks[start.blockId];
    const donor = input.blocks[end.blockId];
    if (!destination || destination.tombstone || !donor || donor.tombstone) {
      return failure("stale-range", "open text boundary is unavailable");
    }
    if (
      destination.type !== startEntry.blockType ||
      donor.type !== endEntry.blockType ||
      startContent.version !== startEntry.expectedContentVersion ||
      endContent.version !== endEntry.expectedContentVersion
    ) {
      return failure("stale-range", "open text boundary changed");
    }

    const trimmingRange: StructuralEditRange = {
      ...input.range,
      blocks: input.range.blocks.filter(
        (selected) =>
          selected.blockId !== start.blockId &&
          selected.blockId !== end.blockId,
      ),
    };
    if (trimmingRange.blocks.length > 0) {
      operations.push(deleteRange(trimmingRange));
    }
    const startSize = startContentSize;
    const suffix = sliceRichTextDocument(
      donor.type,
      endContent.content,
      end.offset,
      endContentSize,
    );
    const replacementOperation = {
      kind: "replaceInlineRange",
      blockId: destination.id,
      blockType: destination.type,
      target: { kind: "text" },
      range: {
        from: { blockId: destination.id, offset: start.offset },
        to: { blockId: destination.id, offset: startSize },
      },
      content: richTextBlockInlineContent(suffix),
      deletedContent: richTextBlockInlineContent(
        sliceRichTextDocument(
          destination.type,
          startContent.content,
          start.offset,
          startSize,
        ),
      ),
    } as const;
    const composedContent = applyLogicalContentOperationToRichTextDocument(
      destination.type,
      startContent.content,
      replacementOperation,
      {
        blockDefinitions: input.blockDefinitions,
        inlineMarks: [],
        validatedCanonicalBase: true,
      },
    );
    if (
      !composedContent ||
      !input.validateContent(destination.type, composedContent)
    ) {
      return failure(
        "invalid-result",
        `end suffix is not valid content for start block ${destination.id}`,
      );
    }
    let state = append({
      kind: "applyContentOperation",
      operation: replacementOperation,
    });

    const startLineage = new Set(lineage(input.blocks, start.blockId));
    const endBranch = endAncestorBranch(
      input.blocks,
      end.blockId,
      startLineage,
    );
    const directBoundaryChild = new Map<BlockId, BlockId>();
    let childId = end.blockId;
    for (const wrapperId of endBranch) {
      directBoundaryChild.set(wrapperId, childId);
      childId = wrapperId;
    }

    for (const wrapperId of endBranch) {
      const wrapper = liveBlock(state, wrapperId);
      if (!wrapper) continue;
      const definition = input.blockDefinitions[wrapper.type];
      if (definition?.kind !== "wrapper") {
        throw new RangeDeletionPlanningFailure(
          "invalid-result",
          `range boundary ancestor ${wrapper.id} is not a wrapper`,
        );
      }

      if (definition.list?.kind === "item") {
        const boundaryChildId = directBoundaryChild.get(wrapper.id);
        if (boundaryChildId === end.blockId) {
          state = consumeListItem(state, wrapper, append, input);
        }
        continue;
      }

      if (definition.compound) {
        const boundaryChildId = directBoundaryChild.get(wrapper.id);
        if (boundaryChildId === end.blockId) {
          state = unwrapCompoundBoundary(
            state,
            wrapper.id,
            end.blockId,
            definition,
            append,
          );
        }
        continue;
      }

      const policy = definition.rangeDeletion;
      if (!policy) continue;
      if (policy.kind === "unwrap-boundary-contents") {
        state = unwrapWrapperContents(state, wrapper.id, append);
        continue;
      }
      const boundaryChildId = directBoundaryChild.get(wrapper.id);
      if (!boundaryChildId) {
        throw new RangeDeletionPlanningFailure(
          "invalid-result",
          `wrapper ${wrapper.id} has no resolved boundary child`,
        );
      }
      if (policy.kind === "unwrap-boundary-child") {
        state = unwrapBoundaryChild(
          state,
          wrapper.id,
          boundaryChildId,
          definition,
          append,
        );
        continue;
      }
      state = unwrapVisibleBoundaryChild(
        state,
        wrapper.id,
        boundaryChildId,
        append,
        input,
      );
    }

    if (liveBlock(state, donor.id)) {
      state = append(
        removeBlocks({
          blockIds: [donor.id],
          includeDescendants: false,
          expectedParents: { [donor.id]: liveBlock(state, donor.id)!.parentId },
        }),
      );
    }
    append(
      setSelection({
        kind: "text-offset",
        blockId: destination.id,
        offset: start.offset,
      }),
    );

    const final = applyStructuralTransaction(
      { origin: rangeDeletionOrigin(input.intent), operations },
      context,
      { validateFinal: true },
    );
    if (!final.ok) return failure("invalid-result", final.message);
    return success(input.intent, operations, [destination, donor]);
  } catch (error) {
    if (error instanceof RangeDeletionPlanningFailure) {
      return failure(error.reason, error.message);
    }
    return failure(
      "invalid-result",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function consumeListItem(
  state: AppliedStructuralTransaction,
  item: VersionedBlock,
  append: (
    operation: StructuralTransactionOperation,
  ) => AppliedStructuralTransaction,
  input: PlanStructuralRangeDeletionInput,
): AppliedStructuralTransaction {
  const itemDefinition = input.blockDefinitions[item.type];
  const policy = itemDefinition?.list;
  if (policy?.kind !== "item") return state;
  const container = item.parentId ? liveBlock(state, item.parentId) : null;
  const containerDefinition = container
    ? input.blockDefinitions[container.type]
    : undefined;
  if (
    !container ||
    containerDefinition?.list?.kind !== "container" ||
    containerDefinition.list.itemType !== item.type
  ) {
    throw new RangeDeletionPlanningFailure(
      "invalid-result",
      `list item ${item.id} has no matching container`,
    );
  }
  const children = childIds(state, item.id);
  const primary = children[0] ? liveBlock(state, children[0]!) : null;
  if (!primary || primary.type !== policy.primaryTextChildType) {
    throw new RangeDeletionPlanningFailure(
      "invalid-result",
      `list item ${item.id} has no declared primary text child`,
    );
  }
  const descendants = children.slice(1);
  const items = childIds(state, container.id);
  const itemIndex = items.indexOf(item.id);
  const adjacentItemId = items[itemIndex + 1] ?? items[itemIndex - 1] ?? null;
  if (descendants.length > 0) {
    if (adjacentItemId) {
      const targetChildren = childIds(state, adjacentItemId);
      const targetIndex =
        itemIndex + 1 < items.length ? 1 : targetChildren.length;
      state = append(
        moveBlocks({
          blockIds: descendants,
          sourcePlacement: { parentId: item.id, childIndex: 1 },
          destinationPlacement: {
            parentId: adjacentItemId,
            childIndex: targetIndex,
          },
        }),
      );
    } else {
      const containerSiblings = childIds(state, container.parentId);
      const containerIndex = containerSiblings.indexOf(container.id);
      state = append(
        moveBlocks({
          blockIds: descendants,
          sourcePlacement: { parentId: item.id, childIndex: 1 },
          destinationPlacement: {
            parentId: container.parentId,
            childIndex: containerIndex,
          },
        }),
      );
    }
  }
  state = append(
    removeBlocks({
      blockIds: [item.id],
      includeDescendants: true,
      expectedParents: { [item.id]: container.id },
    }),
  );
  if (
    liveBlock(state, container.id) &&
    childIds(state, container.id).length === 0
  ) {
    state = append(
      removeBlocks({
        blockIds: [container.id],
        includeDescendants: false,
        expectedParents: { [container.id]: container.parentId },
      }),
    );
  }
  return state;
}

function unwrapCompoundBoundary(
  state: AppliedStructuralTransaction,
  wrapperId: BlockId,
  donorId: BlockId,
  definition: BlockDefinition,
  append: (
    operation: StructuralTransactionOperation,
  ) => AppliedStructuralTransaction,
): AppliedStructuralTransaction {
  const wrapper = liveBlock(state, wrapperId);
  const policy = definition.compound;
  if (!wrapper || !policy) return state;
  const children = childIds(state, wrapper.id);
  const primary = children[0] ? liveBlock(state, children[0]!) : null;
  const contentWrapper = children[1] ? liveBlock(state, children[1]!) : null;
  if (
    primary?.id !== donorId ||
    primary.type !== policy.primaryTextChildType ||
    !contentWrapper ||
    contentWrapper.type !== policy.contentWrapperChildType
  ) {
    throw new RangeDeletionPlanningFailure(
      "invalid-result",
      `compound boundary wrapper ${wrapper.id} is invalid`,
    );
  }
  const promoted = childIds(state, contentWrapper.id);
  const wrapperIndex = childIds(state, wrapper.parentId).indexOf(wrapper.id);
  if (promoted.length > 0) {
    state = append(
      moveBlocks({
        blockIds: promoted,
        sourcePlacement: { parentId: contentWrapper.id, childIndex: 0 },
        destinationPlacement: {
          parentId: wrapper.parentId,
          childIndex: wrapperIndex,
        },
      }),
    );
  }
  return append(
    removeBlocks({
      blockIds: [wrapper.id],
      includeDescendants: true,
      expectedParents: { [wrapper.id]: wrapper.parentId },
    }),
  );
}

function unwrapWrapperContents(
  state: AppliedStructuralTransaction,
  wrapperId: BlockId,
  append: (
    operation: StructuralTransactionOperation,
  ) => AppliedStructuralTransaction,
): AppliedStructuralTransaction {
  const wrapper = liveBlock(state, wrapperId);
  if (!wrapper) return state;
  const siblings = childIds(state, wrapper.parentId);
  const wrapperIndex = siblings.indexOf(wrapper.id);
  const children = childIds(state, wrapper.id);
  if (children.length > 0) {
    state = append(
      moveBlocks({
        blockIds: children,
        sourcePlacement: { parentId: wrapper.id, childIndex: 0 },
        destinationPlacement: {
          parentId: wrapper.parentId,
          childIndex: wrapperIndex,
        },
      }),
    );
  }
  return append(
    removeBlocks({
      blockIds: [wrapper.id],
      includeDescendants: false,
      expectedParents: { [wrapper.id]: wrapper.parentId },
    }),
  );
}

function unwrapBoundaryChild(
  state: AppliedStructuralTransaction,
  wrapperId: BlockId,
  boundaryChildId: BlockId,
  definition: BlockDefinition,
  append: (
    operation: StructuralTransactionOperation,
  ) => AppliedStructuralTransaction,
): AppliedStructuralTransaction {
  const wrapper = liveBlock(state, wrapperId);
  const boundaryChild = liveBlock(state, boundaryChildId);
  if (!wrapper || !boundaryChild) return state;
  if (boundaryChild.parentId !== wrapper.id) {
    throw new RangeDeletionPlanningFailure(
      "invalid-result",
      `boundary child ${boundaryChild.id} left wrapper ${wrapper.id}`,
    );
  }
  const wrapperIndex = childIds(state, wrapper.parentId).indexOf(wrapper.id);
  const promoted = childIds(state, boundaryChild.id);
  if (promoted.length > 0) {
    state = append(
      moveBlocks({
        blockIds: promoted,
        sourcePlacement: { parentId: boundaryChild.id, childIndex: 0 },
        destinationPlacement: {
          parentId: wrapper.parentId,
          childIndex: wrapperIndex,
        },
      }),
    );
  }
  state = append(
    removeBlocks({
      blockIds: [boundaryChild.id],
      includeDescendants: false,
      expectedParents: { [boundaryChild.id]: wrapper.id },
    }),
  );
  const remaining = liveBlock(state, wrapper.id)
    ? childIds(state, wrapper.id)
    : [];
  const requiredChildCount = definition.content?.required.length ?? 1;
  if (remaining.length >= requiredChildCount) return state;
  if (remaining.length === 1) {
    if (definition.underflow?.kind !== "promote-single-child-contents") {
      throw new RangeDeletionPlanningFailure(
        "invalid-result",
        `wrapper ${wrapper.id} underflow has no declared cleanup`,
      );
    }
    const survivor = liveBlock(state, remaining[0]!);
    if (!survivor) return state;
    const survivorContents = childIds(state, survivor.id);
    const currentWrapperIndex = childIds(state, wrapper.parentId).indexOf(
      wrapper.id,
    );
    if (survivorContents.length > 0) {
      state = append(
        moveBlocks({
          blockIds: survivorContents,
          sourcePlacement: { parentId: survivor.id, childIndex: 0 },
          destinationPlacement: {
            parentId: wrapper.parentId,
            childIndex: currentWrapperIndex,
          },
        }),
      );
    }
    state = append(
      removeBlocks({
        blockIds: [survivor.id],
        includeDescendants: false,
        expectedParents: { [survivor.id]: wrapper.id },
      }),
    );
  }
  return append(
    removeBlocks({
      blockIds: [wrapper.id],
      includeDescendants: false,
      expectedParents: { [wrapper.id]: wrapper.parentId },
    }),
  );
}

function unwrapVisibleBoundaryChild(
  state: AppliedStructuralTransaction,
  wrapperId: BlockId,
  boundaryChildId: BlockId,
  append: (
    operation: StructuralTransactionOperation,
  ) => AppliedStructuralTransaction,
  input: PlanStructuralRangeDeletionInput,
): AppliedStructuralTransaction {
  const wrapper = liveBlock(state, wrapperId);
  if (!wrapper || !input.resolveVisibleChildBlockIds) {
    throw new RangeDeletionPlanningFailure(
      "invalid-result",
      `visible-child range deletion for ${wrapperId} requires a definition resolver`,
    );
  }
  const children = childIds(state, wrapper.id);
  const visible = input.resolveVisibleChildBlockIds({
    blockId: wrapper.id,
    blockType: wrapper.type,
    childBlockIds: children,
  });
  const visibleChildId = visible.find((id) => children.includes(id)) ?? null;
  if (!visibleChildId || visibleChildId !== boundaryChildId) {
    throw new RangeDeletionPlanningFailure(
      "stale-range",
      `end boundary is not inside the visible child of ${wrapper.id}`,
    );
  }
  const visibleChild = liveBlock(state, visibleChildId);
  if (!visibleChild) return state;
  const wrapperIndex = childIds(state, wrapper.parentId).indexOf(wrapper.id);
  const promoted = childIds(state, visibleChild.id);
  if (promoted.length > 0) {
    state = append(
      moveBlocks({
        blockIds: promoted,
        sourcePlacement: { parentId: visibleChild.id, childIndex: 0 },
        destinationPlacement: {
          parentId: wrapper.parentId,
          childIndex: wrapperIndex,
        },
      }),
    );
  }
  return append(
    removeBlocks({
      blockIds: [wrapper.id],
      includeDescendants: true,
      expectedParents: { [wrapper.id]: wrapper.parentId },
    }),
  );
}

function endAncestorBranch(
  blocks: Readonly<Record<BlockId, VersionedBlock>>,
  endBlockId: BlockId,
  startLineage: ReadonlySet<BlockId>,
): BlockId[] {
  const result: BlockId[] = [];
  const visited = new Set<BlockId>();
  let parentId = blocks[endBlockId]?.parentId ?? null;
  while (parentId !== null && !visited.has(parentId)) {
    if (startLineage.has(parentId)) break;
    visited.add(parentId);
    result.push(parentId);
    parentId = blocks[parentId]?.parentId ?? null;
  }
  return result;
}

function lineage(
  blocks: Readonly<Record<BlockId, VersionedBlock>>,
  blockId: BlockId,
): BlockId[] {
  const result: BlockId[] = [];
  const visited = new Set<BlockId>();
  let current: BlockId | null = blockId;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    result.push(current);
    current = blocks[current]?.parentId ?? null;
  }
  return result;
}

function liveBlock(
  state: Pick<AppliedStructuralTransaction, "blocks">,
  blockId: BlockId,
): VersionedBlock | null {
  const block = state.blocks[blockId];
  return block && !block.tombstone ? block : null;
}

function childIds(
  state: Pick<
    AppliedStructuralTransaction,
    "rootBlockIds" | "childIdsByParentId"
  >,
  parentId: BlockId | null,
): readonly BlockId[] {
  return parentId === null
    ? state.rootBlockIds
    : (state.childIdsByParentId[parentId] ?? []);
}

function rangeDeletionOrigin(intent: StructuralRangeDeletionIntent): string {
  return intent === "cut" ? "structural-range-cut" : "structural-range-delete";
}

function success(
  intent: StructuralRangeDeletionIntent,
  operations: readonly StructuralTransactionOperation[],
  expectedBlocks: readonly VersionedBlock[] = [],
): PlanStructuralRangeDeletionResult {
  return {
    ok: true,
    plan: {
      origin: rangeDeletionOrigin(intent),
      operations: Object.freeze([...operations]),
      ...(expectedBlocks.length === 0
        ? {}
        : {
            preconditions: {
              blocks: expectedBlocks.map((block) => ({
                blockId: block.id,
                type: block.type,
                parentId: block.parentId,
              })),
              contentVersions: Object.fromEntries(
                expectedBlocks.map((block) => [block.id, block.contentVersion]),
              ),
            },
          }),
    },
  };
}

function failure(
  reason: Extract<PlanStructuralRangeDeletionResult, { ok: false }>["reason"],
  message: string,
): PlanStructuralRangeDeletionResult {
  return { ok: false, reason, message };
}
