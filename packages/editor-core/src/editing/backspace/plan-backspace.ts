import {
  isRichTextDocument,
  richTextBlockInlineContent,
  richTextDocumentContentSize,
  type RichTextDocumentNodeJson,
} from "../../content/rich-text/rich-inline-content.ts";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import {
  blockDefinitionAcceptsSequence,
  resolveRestorativeDefault,
} from "../../definitions/structural-queries.ts";
import type { BlockType, VersionedBlock } from "../../document/model/block.ts";
import type { CanonicalBlockRecord } from "../canonical-fragment.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import { planBlockTreeCreation } from "../block-editing/creation-planner.ts";
import { insertBlocks } from "../transactions/primitives/insert-blocks.ts";
import { appendTextBlockContent } from "../transactions/primitives/append-text-block-content.ts";
import { moveBlocks } from "../transactions/primitives/move-blocks.ts";
import { removeBlocks } from "../transactions/primitives/remove-blocks.ts";
import { setSelection } from "../transactions/primitives/set-selection.ts";
import type {
  StructuralTransactionOperation,
  StructuralTransactionPlan,
  TransactionSelectionTarget,
  TransactionReadableContent,
} from "../transactions/types.ts";
import {
  findPreviousCanonicalSelectionTarget,
  findPreviousMergeTarget,
} from "./previous-navigation.ts";
import { findCanonicalSelectionTarget } from "../boundary/canonical-navigation.ts";

export interface BlockBoundaryBackspaceSelection {
  readonly from: number;
  readonly to: number;
}

export interface BlockBoundaryBackspaceContentSnapshot {
  readonly content: RichTextDocumentNodeJson;
  readonly plainText: string;
  readonly version: string | null;
}

export interface PlanBlockBoundaryBackspaceInput {
  readonly selectionBlockId: BlockId;
  readonly selection: BlockBoundaryBackspaceSelection;
  readonly content: BlockBoundaryBackspaceContentSnapshot;
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
  readonly createBlockId?: () => BlockId;
}

export type PlanBlockBoundaryBackspaceResult =
  | {
      readonly ok: true;
      readonly handled: true;
      readonly plan: StructuralTransactionPlan;
    }
  | {
      readonly ok: true;
      readonly handled: false;
      readonly reason: "no-previous-target";
    }
  | {
      readonly ok: false;
      readonly reason:
        | "missing-block"
        | "not-text"
        | "invalid-content"
        | "invalid-selection"
        | "local-content-route-required"
        | "stale-content"
        | "invalid-underflow"
        | "invalid-compound"
        | "invalid-restoration"
        | "invalid-result";
      readonly message: string;
    };

interface CleanupPlan {
  readonly removalRoot: VersionedBlock;
  readonly selectionNavigationRoot: VersionedBlock;
  readonly plannedSelection: TransactionSelectionTarget | null;
  readonly operations: readonly StructuralTransactionOperation[];
  readonly expectations: readonly VersionedBlock[];
  readonly restoredSelection: TransactionSelectionTarget | null;
}

interface CompoundPrimaryContext {
  readonly primary: VersionedBlock;
  readonly wrapper: VersionedBlock;
  readonly contentWrapper: VersionedBlock;
  readonly promotedContent: readonly VersionedBlock[];
  readonly wrapperIndex: number;
  readonly wrapperSiblings: readonly VersionedBlock[];
}

class BackspacePlanningFailure extends Error {
  constructor(
    readonly reason: Extract<
      PlanBlockBoundaryBackspaceResult,
      { ok: false }
    >["reason"],
    message: string,
  ) {
    super(message);
  }
}

export function planBlockBoundaryBackspace(
  input: PlanBlockBoundaryBackspaceInput,
): PlanBlockBoundaryBackspaceResult {
  try {
    const source = liveBlock(input.blocks, input.selectionBlockId);
    if (!source)
      return failure("missing-block", "focused block is unavailable");
    const definition = input.blockDefinitions[source.type];
    if (!definition || !(definition.kind === "text")) {
      return failure("not-text", "focused block is not editable text");
    }
    if (!isRichTextDocument(input.content.content)) {
      return failure(
        "invalid-content",
        "focused block content is not rich text",
      );
    }
    if (source.contentVersion !== input.content.version) {
      return failure("stale-content", "focused block content version changed");
    }
    const size = richTextDocumentContentSize(input.content.content);
    const { from, to } = input.selection;
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to < from ||
      to > size
    ) {
      return failure(
        "invalid-selection",
        "selection is outside the focused block",
      );
    }
    if (from !== 0 || to !== 0) {
      return failure(
        "local-content-route-required",
        "same-block Backspace must be handled by the block-local content runtime",
      );
    }
    if (size === 0) {
      const compound = resolveCompoundPrimaryContext(input, source);
      return compound
        ? emptyCompoundPrimaryPlan(input, source, compound)
        : emptyDeletionPlan(input, source);
    }
    return joinPlan(input, source);
  } catch (error) {
    if (error instanceof BackspacePlanningFailure) {
      return failure(error.reason, error.message);
    }
    return failure(
      "invalid-result",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function emptyDeletionPlan(
  input: PlanBlockBoundaryBackspaceInput,
  source: VersionedBlock,
): PlanBlockBoundaryBackspaceResult {
  const cleanup = planCleanup(input, source);
  const operations = [...cleanup.operations];
  const adjacentSelection =
    cleanup.plannedSelection ??
    resolveRemovalSelection(input, cleanup.selectionNavigationRoot);
  const selection =
    adjacentSelection.kind === "none"
      ? (cleanup.restoredSelection ?? adjacentSelection)
      : adjacentSelection;
  operations.push(setSelection(selection));
  return success(input, source, operations, cleanup.expectations);
}

function emptyCompoundPrimaryPlan(
  input: PlanBlockBoundaryBackspaceInput,
  source: VersionedBlock,
  compound: CompoundPrimaryContext,
): PlanBlockBoundaryBackspaceResult {
  return success(
    input,
    source,
    [
      removeBlocks({
        blockIds: [compound.wrapper.id],
        includeDescendants: true,
        expectedParents: {
          [compound.wrapper.id]: compound.wrapper.parentId,
        },
      }),
      setSelection(resolveRemovalSelection(input, compound.wrapper)),
    ],
    [compound.wrapper, compound.contentWrapper, ...compound.promotedContent],
  );
}

function joinPlan(
  input: PlanBlockBoundaryBackspaceInput,
  source: VersionedBlock,
): PlanBlockBoundaryBackspaceResult {
  const compound = resolveCompoundPrimaryContext(input, source);
  const destination = findPreviousMergeTarget(
    navigationInput(input, source.id),
  );
  if (!destination.ok) {
    if (compound) return unwrapCompoundPrimaryPlan(input, source, compound);
    return { ok: true, handled: false, reason: "no-previous-target" };
  }
  const destinationBlock = liveBlock(input.blocks, destination.blockId);
  if (!destinationBlock) {
    return failure("missing-block", "merge destination is unavailable");
  }
  if (compound) {
    return mergeCompoundPrimaryPlan(
      input,
      source,
      compound,
      destinationBlock,
      destination,
    );
  }
  const cleanup = planCleanup(input, source);
  return success(
    input,
    source,
    [
      preparedAppendOperation(input, source, destinationBlock, destination),
      ...cleanup.operations,
      setSelection({
        kind: "text-offset",
        blockId: destinationBlock.id,
        offset: destination.originalLength,
      }),
    ],
    [...cleanup.expectations, destinationBlock],
    { [destinationBlock.id]: destination.contentVersion },
  );
}

function preparedAppendOperation(
  input: PlanBlockBoundaryBackspaceInput,
  source: VersionedBlock,
  destinationBlock: VersionedBlock,
  destination: Extract<
    ReturnType<typeof findPreviousMergeTarget>,
    { ok: true }
  >,
): StructuralTransactionOperation {
  return appendTextBlockContent({
    destinationBlockId: destinationBlock.id,
    sourceBlockId: source.id,
    expectedDestinationContentVersion: destination.contentVersion,
    expectedSourceContentVersion: source.contentVersion,
    operation: {
      kind: "insertInlineContent",
      blockId: destinationBlock.id,
      blockType: destinationBlock.type,
      target: { kind: "text" },
      position: {
        blockId: destinationBlock.id,
        offset: destination.originalLength,
      },
      content: richTextBlockInlineContent(input.content.content),
    },
  });
}

function mergeCompoundPrimaryPlan(
  input: PlanBlockBoundaryBackspaceInput,
  source: VersionedBlock,
  compound: CompoundPrimaryContext,
  destinationBlock: VersionedBlock,
  destination: Extract<
    ReturnType<typeof findPreviousMergeTarget>,
    { ok: true }
  >,
): PlanBlockBoundaryBackspaceResult {
  assertCompoundPromotionAccepted(input, compound, false);
  const movePromoted =
    compound.promotedContent.length === 0
      ? []
      : [
          moveBlocks({
            blockIds: compound.promotedContent.map((block) => block.id),
            sourcePlacement: {
              parentId: compound.contentWrapper.id,
              childIndex: 0,
            },
            destinationPlacement: {
              parentId: compound.wrapper.parentId,
              childIndex: compound.wrapperIndex,
            },
          }),
        ];
  return success(
    input,
    source,
    [
      preparedAppendOperation(input, source, destinationBlock, destination),
      ...movePromoted,
      removeBlocks({
        blockIds: [compound.wrapper.id],
        includeDescendants: true,
        expectedParents: {
          [compound.wrapper.id]: compound.wrapper.parentId,
        },
      }),
      setSelection({
        kind: "text-offset",
        blockId: destinationBlock.id,
        offset: destination.originalLength,
      }),
    ],
    [
      compound.wrapper,
      compound.contentWrapper,
      ...compound.promotedContent,
      destinationBlock,
    ],
    { [destinationBlock.id]: destination.contentVersion },
  );
}

function unwrapCompoundPrimaryPlan(
  input: PlanBlockBoundaryBackspaceInput,
  source: VersionedBlock,
  compound: CompoundPrimaryContext,
): PlanBlockBoundaryBackspaceResult {
  assertCompoundPromotionAccepted(input, compound, true);
  const operations: StructuralTransactionOperation[] = [
    moveBlocks({
      blockIds: [source.id],
      sourcePlacement: {
        parentId: compound.wrapper.id,
        childIndex: 0,
      },
      destinationPlacement: {
        parentId: compound.wrapper.parentId,
        childIndex: compound.wrapperIndex,
      },
    }),
  ];
  if (compound.promotedContent.length > 0) {
    operations.push(
      moveBlocks({
        blockIds: compound.promotedContent.map((block) => block.id),
        sourcePlacement: {
          parentId: compound.contentWrapper.id,
          childIndex: 0,
        },
        destinationPlacement: {
          parentId: compound.wrapper.parentId,
          childIndex: compound.wrapperIndex + 1,
        },
      }),
    );
  }
  operations.push(
    removeBlocks({
      blockIds: [compound.wrapper.id],
      includeDescendants: true,
      expectedParents: {
        [compound.wrapper.id]: compound.wrapper.parentId,
      },
    }),
    setSelection({ kind: "block-start", blockId: source.id }),
  );
  return success(input, source, operations, [
    compound.wrapper,
    compound.contentWrapper,
    ...compound.promotedContent,
  ]);
}

function resolveCompoundPrimaryContext(
  input: PlanBlockBoundaryBackspaceInput,
  source: VersionedBlock,
): CompoundPrimaryContext | null {
  const wrapper = source.parentId
    ? liveBlock(input.blocks, source.parentId)
    : null;
  if (!wrapper) return null;
  const definition = input.blockDefinitions[wrapper.type];
  const policy =
    definition?.kind === "wrapper" ? definition.compound : undefined;
  if (!policy || source.type !== policy.primaryTextChildType) return null;
  const children = liveChildren(input, wrapper.id);
  if (children[0]?.id !== source.id) {
    throw new BackspacePlanningFailure(
      "invalid-compound",
      `compound primary ${source.id} is not the first canonical child`,
    );
  }
  const contentWrapper = children[1];
  if (
    !contentWrapper ||
    contentWrapper.type !== policy.contentWrapperChildType
  ) {
    throw new BackspacePlanningFailure(
      "invalid-compound",
      `compound wrapper ${wrapper.id} is missing its declared content child`,
    );
  }
  const wrapperSiblings = liveChildren(input, wrapper.parentId);
  const wrapperIndex = wrapperSiblings.findIndex(
    (block) => block.id === wrapper.id,
  );
  if (wrapperIndex < 0) {
    throw new BackspacePlanningFailure(
      "invalid-compound",
      `compound wrapper ${wrapper.id} is outside its canonical parent sequence`,
    );
  }
  return {
    primary: source,
    wrapper,
    contentWrapper,
    promotedContent: liveChildren(input, contentWrapper.id),
    wrapperIndex,
    wrapperSiblings,
  };
}

function assertCompoundPromotionAccepted(
  input: PlanBlockBoundaryBackspaceInput,
  compound: CompoundPrimaryContext,
  includePrimary: boolean,
): void {
  if (compound.wrapper.parentId === null) return;
  const parent = liveBlock(input.blocks, compound.wrapper.parentId);
  const parentDefinition = parent
    ? input.blockDefinitions[parent.type]
    : undefined;
  if (!parent || parentDefinition?.kind !== "wrapper") {
    throw new BackspacePlanningFailure(
      "invalid-compound",
      `compound destination parent for ${compound.wrapper.id} is unavailable`,
    );
  }
  const replacementTypes = [
    ...(includePrimary ? [compound.primary.type] : []),
    ...compound.promotedContent.map((block) => block.type),
  ];
  const finalTypes = [
    ...compound.wrapperSiblings
      .slice(0, compound.wrapperIndex)
      .map((block) => block.type),
    ...replacementTypes,
    ...compound.wrapperSiblings
      .slice(compound.wrapperIndex + 1)
      .map((block) => block.type),
  ];
  if (
    !blockDefinitionAcceptsSequence(
      input.blockDefinitions,
      parentDefinition,
      finalTypes,
    )
  ) {
    throw new BackspacePlanningFailure(
      "invalid-compound",
      `compound promotion from ${compound.wrapper.type} violates destination content`,
    );
  }
}

function planCleanup(
  input: PlanBlockBoundaryBackspaceInput,
  source: VersionedBlock,
): CleanupPlan {
  const expectations: VersionedBlock[] = [source];
  let removalRoot = source;
  let parent = source.parentId
    ? liveBlock(input.blocks, source.parentId)
    : null;
  while (parent) {
    expectations.push(parent);
    const definition = input.blockDefinitions[parent.type];
    if (!definition || !(definition.kind === "wrapper")) {
      throw new Error(`cleanup parent ${parent.type} is not a wrapper`);
    }
    const remaining = liveChildren(input, parent.id).filter(
      (child) => child.id !== removalRoot.id,
    );
    if (
      blockDefinitionAcceptsSequence(
        input.blockDefinitions,
        definition,
        remaining.map((child) => child.type),
      )
    ) {
      break;
    }
    if (
      remaining.length === 0 &&
      resolveRestorativeDefault(input.blockDefinitions, definition)
    ) {
      const restorativeDefault = resolveRestorativeDefault(
        input.blockDefinitions,
        definition,
      )!;
      const creation = planBlockTreeCreation({
        blockDefinitions: input.blockDefinitions,
        type: restorativeDefault.defaultType,
        parentId: parent.id,
        selection: false,
        ...(input.createBlockId ? { createBlockId: input.createBlockId } : {}),
        reservedBlockIds: new Set(Object.keys(input.blocks) as BlockId[]),
      });
      const records = creation.nodes.map(
        (node): CanonicalBlockRecord => ({
          id: node.id,
          type: node.type,
          parentId: node.parentId,
          ...(node.metadata === undefined ? {} : { metadata: node.metadata }),
        }),
      );
      return {
        removalRoot,
        selectionNavigationRoot: removalRoot,
        plannedSelection: null,
        expectations,
        operations: [
          removeBlocks({
            blockIds: [removalRoot.id],
            includeDescendants: true,
            expectedParents: { [removalRoot.id]: removalRoot.parentId },
          }),
          insertBlocks({
            placement: {
              parentId: parent.id,
              childIndex: 0,
            },
            blocks: records,
          }),
        ],
        restoredSelection: {
          kind: "atomic",
          blockId: creation.rootBlockId,
        },
      };
    }
    if (definition.underflow) {
      return planUnderflowCollapse(
        input,
        parent,
        removalRoot,
        remaining,
        expectations,
      );
    }
    removalRoot = parent;
    parent = parent.parentId ? liveBlock(input.blocks, parent.parentId) : null;
  }
  return {
    removalRoot,
    selectionNavigationRoot: removalRoot,
    plannedSelection: null,
    expectations,
    operations: [
      removeBlocks({
        blockIds: [removalRoot.id],
        includeDescendants: true,
        expectedParents: { [removalRoot.id]: removalRoot.parentId },
      }),
    ],
    restoredSelection: null,
  };
}

function planUnderflowCollapse(
  input: PlanBlockBoundaryBackspaceInput,
  wrapper: VersionedBlock,
  removedChild: VersionedBlock,
  remaining: readonly VersionedBlock[],
  expectations: readonly VersionedBlock[],
): CleanupPlan {
  if (remaining.length !== 1) {
    throw new BackspacePlanningFailure(
      "invalid-underflow",
      `cleanup underflow for ${wrapper.type} requires exactly one surviving child`,
    );
  }
  const survivingChild = remaining[0]!;
  const survivingDefinition = input.blockDefinitions[survivingChild.type];
  if (!survivingDefinition || !(survivingDefinition.kind === "wrapper")) {
    throw new BackspacePlanningFailure(
      "invalid-underflow",
      `cleanup underflow survivor ${survivingChild.type} is not a wrapper`,
    );
  }
  const promoted = liveChildren(input, survivingChild.id);
  if (promoted.length === 0) {
    throw new BackspacePlanningFailure(
      "invalid-underflow",
      `cleanup underflow survivor ${survivingChild.id} has no live contents`,
    );
  }
  const wrapperSiblings = liveChildren(input, wrapper.parentId);
  const wrapperIndex = wrapperSiblings.findIndex(
    (sibling) => sibling.id === wrapper.id,
  );
  if (wrapperIndex < 0) {
    throw new BackspacePlanningFailure(
      "invalid-underflow",
      `cleanup underflow wrapper ${wrapper.id} is outside its parent sequence`,
    );
  }
  const previousSibling = wrapperSiblings[wrapperIndex - 1] ?? null;
  const nextSibling = wrapperSiblings[wrapperIndex + 1] ?? null;
  if (wrapper.parentId !== null) {
    const destinationParent = liveBlock(input.blocks, wrapper.parentId);
    const destinationDefinition = destinationParent
      ? input.blockDefinitions[destinationParent.type]
      : undefined;
    if (!destinationParent || !destinationDefinition) {
      throw new BackspacePlanningFailure(
        "invalid-underflow",
        `cleanup underflow destination parent for ${wrapper.id} is unavailable`,
      );
    }
    const finalTypes = [
      ...wrapperSiblings.slice(0, wrapperIndex).map((block) => block.type),
      ...promoted.map((block) => block.type),
      ...wrapperSiblings.slice(wrapperIndex + 1).map((block) => block.type),
    ];
    if (
      !blockDefinitionAcceptsSequence(
        input.blockDefinitions,
        destinationDefinition,
        finalTypes,
      )
    ) {
      throw new BackspacePlanningFailure(
        "invalid-underflow",
        `cleanup underflow promotion from ${wrapper.type} violates destination content`,
      );
    }
  }
  return {
    removalRoot: wrapper,
    selectionNavigationRoot: removedChild,
    plannedSelection: resolveUnderflowFocus(
      input,
      removedChild,
      survivingChild,
    ),
    expectations: uniqueBlocks([
      ...expectations,
      survivingChild,
      ...promoted,
      ...(previousSibling ? [previousSibling] : []),
      ...(nextSibling ? [nextSibling] : []),
      ...(wrapper.parentId ? [liveBlock(input.blocks, wrapper.parentId)!] : []),
    ]),
    operations: [
      moveBlocks({
        blockIds: promoted.map((block) => block.id),
        sourcePlacement: {
          parentId: survivingChild.id,
          childIndex: 0,
        },
        destinationPlacement: {
          parentId: wrapper.parentId,
          childIndex: wrapperIndex,
        },
      }),
      removeBlocks({
        blockIds: [wrapper.id],
        includeDescendants: true,
        expectedParents: { [wrapper.id]: wrapper.parentId },
      }),
    ],
    restoredSelection: null,
  };
}

function resolveUnderflowFocus(
  input: PlanBlockBoundaryBackspaceInput,
  removedChild: VersionedBlock,
  survivingChild: VersionedBlock,
): TransactionSelectionTarget {
  const siblings = liveChildren(input, removedChild.parentId);
  const removedIndex = siblings.findIndex(
    (block) => block.id === removedChild.id,
  );
  const survivingIndex = siblings.findIndex(
    (block) => block.id === survivingChild.id,
  );
  const result =
    removedIndex < survivingIndex
      ? findCanonicalSelectionTarget(
          navigationInput(input, removedChild.id),
          "next",
        )
      : findPreviousCanonicalSelectionTarget(
          navigationInput(input, removedChild.id),
        );
  if (!result.ok) {
    throw new BackspacePlanningFailure(
      "invalid-underflow",
      `cleanup underflow survivor ${survivingChild.id} has no active focus target`,
    );
  }
  return result.kind === "text"
    ? {
        kind: removedIndex < survivingIndex ? "block-start" : "block-end",
        blockId: result.blockId,
      }
    : { kind: "atomic", blockId: result.blockId };
}

function resolveRemovalSelection(
  input: PlanBlockBoundaryBackspaceInput,
  removalRoot: VersionedBlock,
): TransactionSelectionTarget {
  const navigation = navigationInput(input, removalRoot.id);
  const previous = findPreviousCanonicalSelectionTarget(navigation);
  if (previous.ok) {
    return previous.kind === "text"
      ? { kind: "block-end", blockId: previous.blockId }
      : { kind: "atomic", blockId: previous.blockId };
  }
  const next = findCanonicalSelectionTarget(navigation, "next");
  if (next.ok) {
    return next.kind === "text"
      ? { kind: "block-start", blockId: next.blockId }
      : { kind: "atomic", blockId: next.blockId };
  }
  return { kind: "none" };
}

function navigationInput(
  input: PlanBlockBoundaryBackspaceInput,
  originBlockId: BlockId,
) {
  return {
    originBlockId,
    blocks: input.blocks,
    rootBlockIds: input.rootBlockIds,
    childIdsByParentId: input.childIdsByParentId,
    blockDefinitions: input.blockDefinitions,
    readContent: input.readContent,
  };
}

function success(
  input: PlanBlockBoundaryBackspaceInput,
  source: VersionedBlock,
  operations: readonly StructuralTransactionOperation[],
  additionalExpectations: readonly VersionedBlock[] = [],
  additionalContentVersions: Readonly<Record<BlockId, string | null>> = {},
): PlanBlockBoundaryBackspaceResult {
  const expectedBlocks = uniqueBlocks([source, ...additionalExpectations]);
  return {
    ok: true,
    handled: true,
    plan: {
      origin: "generic-backspace",
      operations: Object.freeze([...operations]),
      preconditions: {
        blocks: expectedBlocks.map((block) => ({
          blockId: block.id,
          type: block.type,
          parentId: block.parentId,
        })),
        contentVersions: {
          [source.id]: input.content.version,
          ...additionalContentVersions,
        },
      },
    },
  };
}

function uniqueBlocks(values: readonly VersionedBlock[]): VersionedBlock[] {
  return [...new Map(values.map((value) => [value.id, value])).values()];
}

function liveChildren(
  input: PlanBlockBoundaryBackspaceInput,
  parentId: BlockId | null,
): readonly VersionedBlock[] {
  const childIds =
    parentId === null
      ? input.rootBlockIds
      : (input.childIdsByParentId[parentId] ?? []);
  return childIds
    .map((blockId) => input.blocks[blockId])
    .filter((block): block is VersionedBlock =>
      Boolean(block && !block.tombstone),
    );
}

function liveBlock(
  blocks: Readonly<Record<BlockId, VersionedBlock>>,
  blockId: BlockId,
): VersionedBlock | null {
  const block = blocks[blockId];
  return block && !block.tombstone ? block : null;
}

function failure(
  reason: Extract<PlanBlockBoundaryBackspaceResult, { ok: false }>["reason"],
  message: string,
): PlanBlockBoundaryBackspaceResult {
  return { ok: false, reason, message };
}
