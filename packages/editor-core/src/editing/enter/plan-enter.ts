import { type BlockDefinition } from "../../definitions/block-definition.ts";
import {
  extractPlainTextFromRichTextDocument,
  createBlockRichTextContentFromPlainText,
  isRichTextDocument,
  removeTextRangeFromRichTextDocument,
  richTextDocumentContentSize,
} from "../../content/rich-text/rich-inline-content.ts";
import type { RichTextDocumentNodeJson } from "../../content/rich-text/rich-inline-types.ts";
import type { BlockType, VersionedBlock } from "../../document/model/block.ts";
import { resolveRestorativeDefault } from "../../definitions/structural-queries.ts";
import type { CanonicalBlockRecord } from "../canonical-fragment.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type { ContentVersion } from "../../kernel/versioning/versions.ts";
import { planBlockTreeCreation } from "../block-editing/creation-planner.ts";
import { placementAtIndex } from "../transactions/boundary.ts";
import {
  findAdjacentValidInsertionPlacement,
  structuralPlacementAcceptsBlockType,
} from "../transactions/navigation.ts";
import { insertBlocks } from "../transactions/primitives/insert-blocks.ts";
import { removeBlocks } from "../transactions/primitives/remove-blocks.ts";
import { moveBlocks } from "../transactions/primitives/move-blocks.ts";
import { replaceContent } from "../transactions/primitives/replace-content.ts";
import { setSelection } from "../transactions/primitives/set-selection.ts";
import { splitText } from "../transactions/primitives/split-text.ts";
import type {
  BlockPlacement,
  StructuralTransactionOperation,
  StructuralTransactionPlan,
} from "../transactions/types.ts";
import { createBlockRecord } from "../../metadata/block-record.ts";

export interface GenericEnterSelection {
  readonly from: number;
  readonly to: number;
}

export interface GenericEnterContentSnapshot {
  readonly content: RichTextDocumentNodeJson;
  readonly plainText: string;
  readonly version: ContentVersion | string | null;
}

export interface PlanGenericEnterInput {
  readonly selectionBlockId: BlockId;
  readonly selection: GenericEnterSelection;
  readonly content: GenericEnterContentSnapshot;
  readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly createBlockId?: () => BlockId;
}

export type PlanGenericEnterResult =
  | {
      readonly ok: true;
      readonly plan: StructuralTransactionPlan;
      readonly selectionBlockId: BlockId;
      readonly resultType: BlockType;
    }
  | {
      readonly ok: false;
      /** A protected canonical boundary may consume the key without mutation. */
      readonly handled?: true;
      readonly reason:
        | "missing-block"
        | "not-text"
        | "missing-split"
        | "invalid-content"
        | "invalid-selection"
        | "stale-content"
        | "no-destination"
        | "invalid-local-boundary"
        | "invalid-override"
        | "invalid-restorative-default-state"
        | "invalid-result";
      readonly message: string;
    };

type PlanGenericEnterFailure = Extract<
  PlanGenericEnterResult,
  { readonly ok: false }
>;

export interface PlanTextSplitAtPlacementInput extends PlanGenericEnterInput {
  readonly resultType: BlockType;
  readonly placement: BlockPlacement;
}

export type PlanTextSplitAtPlacementResult =
  | {
      readonly ok: true;
      readonly plan: StructuralTransactionPlan;
      readonly insertedRootBlockId: BlockId;
      readonly selectionBlockId: BlockId;
      readonly resultType: BlockType;
    }
  | PlanGenericEnterFailure;

interface ResultInsertion {
  readonly operations: readonly StructuralTransactionOperation[];
  readonly rootBlockId: BlockId;
  readonly selectionBlockId: BlockId;
  readonly expectedBlocks: readonly {
    readonly blockId: BlockId;
    readonly type: BlockType;
    readonly parentId: BlockId | null;
  }[];
}

/** Plans a rich-text split into a complete block tree at an explicit boundary. */
export function planTextSplitAtPlacement(
  input: PlanTextSplitAtPlacementInput,
): PlanTextSplitAtPlacementResult {
  try {
    const focused = input.blocks[input.selectionBlockId];
    if (!focused || focused.tombstone)
      return failure("missing-block", "focused block is unavailable");
    const definition = input.blockDefinitions[focused.type];
    if (!definition || definition.kind !== "text")
      return failure("not-text", "focused block is not editable text");
    if (!isRichTextDocument(input.content.content))
      return failure(
        "invalid-content",
        "focused block content is not rich text",
      );
    if (input.content.version !== focused.contentVersion)
      return failure("stale-content", "focused block content version changed");
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
        "text selection is outside the focused block",
      );
    }
    if (
      !structuralPlacementAcceptsBlockType({
        placement: input.placement,
        proposedType: input.resultType,
        blocks: input.blocks,
        rootBlockIds: input.rootBlockIds,
        childIdsByParentId: input.childIdsByParentId,
        blockDefinitions: input.blockDefinitions,
      })
    ) {
      return failure(
        "no-destination",
        "explicit split placement rejects the result",
      );
    }

    const splitOutputId = "right";
    const operations: StructuralTransactionOperation[] = [
      splitText({
        blockId: focused.id,
        offset: from,
        expectedContentVersion: input.content.version,
        outputId: splitOutputId,
        ...(from === to ? {} : { selectionRange: { from, to } }),
      }),
    ];
    const inserted = createResultInsertion({
      input,
      resultType: input.resultType,
      placement: input.placement,
      splitOutputId,
    });
    operations.push(...inserted.operations);
    operations.push(
      setSelection({
        kind: "text-offset",
        blockId: inserted.selectionBlockId,
        offset: 0,
      }),
    );
    return {
      ok: true,
      plan: {
        origin: "explicit-text-split",
        operations,
        preconditions: {
          blocks: [blockExpectation(focused), ...inserted.expectedBlocks],
        },
      },
      insertedRootBlockId: inserted.rootBlockId,
      selectionBlockId: inserted.selectionBlockId,
      resultType: input.resultType,
    };
  } catch (error) {
    return failure(
      "invalid-result",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export function planGenericEnter(
  input: PlanGenericEnterInput,
): PlanGenericEnterResult {
  try {
    const focused = input.blocks[input.selectionBlockId];
    if (!focused || focused.tombstone) {
      return failure("missing-block", "focused block is unavailable");
    }
    const definition = input.blockDefinitions[focused.type];
    if (!definition || !(definition.kind === "text")) {
      return failure("not-text", "focused block is not editable text");
    }
    const defaultResultType = definition.split?.default;
    if (!defaultResultType) {
      return failure(
        "missing-split",
        "text definition has no default split result",
      );
    }
    if (!isRichTextDocument(input.content.content)) {
      return failure(
        "invalid-content",
        "focused block content is not rich text",
      );
    }
    if (input.content.version !== focused.contentVersion) {
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
        "text selection is outside the focused block",
      );
    }

    const contentAfterSelection =
      from === to
        ? input.content.content
        : removeTextRangeFromRichTextDocument(
            focused.type,
            input.content.content,
            from,
            to,
          );
    const isEmpty = richTextDocumentContentSize(contentAfterSelection) === 0;
    const expectedBlocks = [blockExpectation(focused)];
    const operations: StructuralTransactionOperation[] = [];

    if (isEmpty) {
      if (from !== to) {
        operations.push(
          replaceContent({
            blockId: focused.id,
            expectedContentVersion: input.content.version,
            value: {
              kind: "value",
              content: contentAfterSelection,
              plainText: extractPlainTextFromRichTextDocument(
                contentAfterSelection,
              ),
            },
          }),
        );
      }
    }

    const listEnter = planCanonicalListEnter({
      input,
      focused,
      contentAfterSelection,
      isEmpty,
      operations,
      expectedBlocks,
    });
    if (listEnter) return listEnter;

    if (isEmpty) {
      return planEmptyEnter({
        input,
        focused,
        defaultResultType,
        operations,
        expectedBlocks,
      });
    }

    const placement = resolveSplitPlacement({
      input,
      focused,
      defaultResultType,
      applyParentOverride: true,
    });
    if (!placement.ok) return placement.failure;
    const splitOutputId = "right";
    operations.push(
      splitText({
        blockId: focused.id,
        offset: from,
        expectedContentVersion: input.content.version,
        outputId: splitOutputId,
        ...(from === to ? {} : { selectionRange: { from, to } }),
      }),
    );
    const inserted = createResultInsertion({
      input,
      resultType: placement.resultType,
      placement: placement.placement,
      splitOutputId,
    });
    operations.push(...inserted.operations);
    expectedBlocks.push(...inserted.expectedBlocks);
    operations.push(
      setSelection({
        kind: "text-offset",
        blockId: inserted.selectionBlockId,
        offset: 0,
      }),
    );
    return success(
      operations,
      expectedBlocks,
      inserted.selectionBlockId,
      placement.resultType,
    );
  } catch (error) {
    return failure(
      "invalid-result",
      error instanceof Error ? error.message : String(error),
    );
  }
}

function planCanonicalListEnter(input: {
  readonly input: PlanGenericEnterInput;
  readonly focused: VersionedBlock;
  readonly contentAfterSelection: RichTextDocumentNodeJson;
  readonly isEmpty: boolean;
  readonly operations: StructuralTransactionOperation[];
  readonly expectedBlocks: Array<ReturnType<typeof blockExpectation>>;
}): PlanGenericEnterResult | null {
  const item = input.focused.parentId
    ? input.input.blocks[input.focused.parentId]
    : null;
  const itemDefinition = item
    ? input.input.blockDefinitions[item.type]
    : undefined;
  const policy = itemDefinition?.list;
  if (!item || item.tombstone || policy?.kind !== "item") return null;
  if (
    policy.primaryTextChildType !== input.focused.type ||
    itemDefinition?.kind !== "wrapper"
  ) {
    return failure(
      "invalid-result",
      "list item primary text does not match its definition-owned policy",
    );
  }
  const list = item.parentId ? input.input.blocks[item.parentId] : null;
  const listDefinition = list
    ? input.input.blockDefinitions[list.type]
    : undefined;
  if (
    !list ||
    list.tombstone ||
    list.type !== policy.containerType ||
    listDefinition?.list?.kind !== "container" ||
    listDefinition.list.itemType !== item.type
  ) {
    return failure(
      "invalid-result",
      "list item is not contained by its matching canonical list",
    );
  }
  const itemChildren = liveChildren(input.input, item.id);
  if (itemChildren[0]?.id !== input.focused.id) {
    return failure(
      "invalid-result",
      "list item primary paragraph is not its first direct child",
    );
  }
  const items = liveChildren(input.input, list.id);
  const itemIndex = items.findIndex((candidate) => candidate.id === item.id);
  if (itemIndex < 0) {
    return failure("missing-block", "list item position is unavailable");
  }
  input.expectedBlocks.push(blockExpectation(item), blockExpectation(list));

  if (input.isEmpty && itemChildren.length === 1) {
    return planEmptyCanonicalListExit({
      ...input,
      item,
      list,
      items,
      itemIndex,
    });
  }
  if (input.isEmpty) {
    return handledFailure(
      "invalid-local-boundary",
      "an empty list item with additional content cannot be flattened",
    );
  }

  const resultType =
    input.focused.type === policy.primaryTextChildType ? item.type : null;
  if (!resultType) {
    return failure("invalid-result", "list split result type is unavailable");
  }
  const insertionIndex =
    input.input.selection.from === 0 ? itemIndex : itemIndex + 1;
  if (
    input.input.selection.from === 0 &&
    input.input.selection.to > input.input.selection.from
  ) {
    input.operations.push(
      replaceContent({
        blockId: input.focused.id,
        expectedContentVersion: input.input.content.version,
        value: {
          kind: "value",
          content: input.contentAfterSelection,
          plainText: extractPlainTextFromRichTextDocument(
            input.contentAfterSelection,
          ),
        },
      }),
    );
  }
  let splitOutputId: string | null = null;
  if (!input.isEmpty && input.input.selection.from > 0) {
    splitOutputId = "right";
    input.operations.push(
      splitText({
        blockId: input.focused.id,
        offset: input.input.selection.from,
        expectedContentVersion: input.input.content.version,
        outputId: splitOutputId,
        ...(input.input.selection.from === input.input.selection.to
          ? {}
          : {
              selectionRange: {
                from: input.input.selection.from,
                to: input.input.selection.to,
              },
            }),
      }),
    );
  }
  const inserted = createResultInsertion({
    input: input.input,
    resultType,
    placement: { parentId: list.id, childIndex: insertionIndex },
    splitOutputId,
  });
  input.operations.push(...inserted.operations);
  input.expectedBlocks.push(...inserted.expectedBlocks);
  input.operations.push(
    setSelection({
      kind: "text-offset",
      blockId: inserted.selectionBlockId,
      offset: 0,
    }),
  );
  return success(
    input.operations,
    input.expectedBlocks,
    inserted.selectionBlockId,
    resultType,
  );
}

function planEmptyCanonicalListExit(input: {
  readonly input: PlanGenericEnterInput;
  readonly focused: VersionedBlock;
  readonly operations: StructuralTransactionOperation[];
  readonly expectedBlocks: Array<ReturnType<typeof blockExpectation>>;
  readonly item: VersionedBlock;
  readonly list: VersionedBlock;
  readonly items: readonly VersionedBlock[];
  readonly itemIndex: number;
}): PlanGenericEnterResult {
  const outerSiblings = liveChildren(input.input, input.list.parentId);
  const listIndex = outerSiblings.findIndex(
    (candidate) => candidate.id === input.list.id,
  );
  if (listIndex < 0) {
    return failure("missing-block", "list container position is unavailable");
  }
  const hasLeading = input.itemIndex > 0;
  const hasTrailing = input.itemIndex < input.items.length - 1;
  input.operations.push(
    moveBlocks({
      blockIds: [input.focused.id],
      sourcePlacement: { parentId: input.item.id, childIndex: 0 },
      destinationPlacement: {
        parentId: input.list.parentId,
        childIndex: listIndex + (hasLeading ? 1 : 0),
      },
    }),
  );

  if (hasLeading && hasTrailing) {
    const trailingListId = allocateListContainerId(
      input.input,
      input.list.type,
    );
    input.operations.push(
      insertBlocks({
        placement: {
          parentId: input.list.parentId,
          childIndex: listIndex + 2,
        },
        blocks: [
          {
            id: trailingListId,
            type: input.list.type,
            parentId: input.list.parentId,
          },
        ],
      }),
      moveBlocks({
        blockIds: input.items
          .slice(input.itemIndex + 1)
          .map((block) => block.id),
        sourcePlacement: {
          parentId: input.list.id,
          childIndex: input.itemIndex + 1,
        },
        destinationPlacement: {
          parentId: trailingListId,
          childIndex: 0,
        },
      }),
    );
  }

  input.operations.push(
    removeBlocks({
      blockIds: [input.item.id],
      includeDescendants: false,
      expectedParents: { [input.item.id]: input.list.id },
    }),
  );
  if (!hasLeading && !hasTrailing) {
    input.operations.push(
      removeBlocks({
        blockIds: [input.list.id],
        includeDescendants: false,
        expectedParents: { [input.list.id]: input.list.parentId },
      }),
    );
  }
  input.operations.push(
    setSelection({
      kind: "text-offset",
      blockId: input.focused.id,
      offset: 0,
    }),
  );
  return success(
    input.operations,
    input.expectedBlocks,
    input.focused.id,
    input.focused.type,
  );
}

function allocateListContainerId(
  input: PlanGenericEnterInput,
  type: BlockType,
): BlockId {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const requested = input.createBlockId?.();
    const id = createBlockRecord({
      ...(requested ? { id: requested } : {}),
      type,
    }).id;
    if (input.blocks[id] === undefined) return id;
  }
  throw new Error("unable to allocate a unique trailing list identity");
}

function planEmptyEnter(input: {
  readonly input: PlanGenericEnterInput;
  readonly focused: VersionedBlock;
  readonly defaultResultType: BlockType;
  readonly operations: StructuralTransactionOperation[];
  readonly expectedBlocks: Array<ReturnType<typeof blockExpectation>>;
}): PlanGenericEnterResult {
  const directParent = input.focused.parentId
    ? input.input.blocks[input.focused.parentId]
    : null;
  if (input.focused.parentId && (!directParent || directParent.tombstone)) {
    return failure("missing-block", "focused block parent is unavailable");
  }

  if (!directParent) {
    const siblings = liveChildren(input.input, null);
    const index = siblings.findIndex((block) => block.id === input.focused.id);
    const placement = placementAtIndex(input.input, null, index + 1);
    if (!placement) return failure("no-destination", "root placement is stale");
    return finishEmptyInsertion(
      input,
      input.defaultResultType,
      placement,
      true,
    );
  }

  input.expectedBlocks.push(blockExpectation(directParent));
  const parentDefinition = input.input.blockDefinitions[directParent.type];
  if (!parentDefinition) {
    return failure("missing-block", "focused block parent type is unavailable");
  }
  const siblings = liveChildren(input.input, directParent.id);
  const focusedIndex = siblings.findIndex(
    (block) => block.id === input.focused.id,
  );
  if (focusedIndex < 0) {
    return failure(
      "missing-block",
      "focused block sibling position is unavailable",
    );
  }

  if (
    parentDefinition.kind === "wrapper" &&
    parentDefinition.content?.additional !== undefined
  ) {
    if (siblings.length === 1) {
      const placement = placementAtIndex(
        input.input,
        directParent.id,
        focusedIndex + 1,
      );
      if (!placement)
        return failure("no-destination", "child placement is stale");
      return finishEmptyInsertion(
        input,
        input.defaultResultType,
        placement,
        true,
      );
    }
    if (focusedIndex < siblings.length - 1) {
      const placement = placementAtIndex(
        input.input,
        directParent.id,
        focusedIndex,
      );
      if (!placement)
        return failure("no-destination", "child placement is stale");
      const inserted = createResultInsertion({
        input: input.input,
        resultType: input.defaultResultType,
        placement,
        splitOutputId: null,
      });
      input.operations.push(...inserted.operations);
      input.expectedBlocks.push(...inserted.expectedBlocks);
      input.operations.push(
        setSelection({
          kind: "text-offset",
          blockId: input.focused.id,
          offset: 0,
        }),
      );
      return success(
        input.operations,
        input.expectedBlocks,
        input.focused.id,
        input.defaultResultType,
      );
    }

    const localPlacement = placementAtIndex(
      input.input,
      directParent.id,
      focusedIndex + 1,
    );
    if (
      !localPlacement ||
      !structuralPlacementAcceptsBlockType({
        placement: localPlacement,
        proposedType: input.defaultResultType,
        blocks: input.input.blocks,
        rootBlockIds: input.input.rootBlockIds,
        childIdsByParentId: input.input.childIdsByParentId,
        blockDefinitions: input.input.blockDefinitions,
      })
    ) {
      return failure(
        "invalid-local-boundary",
        "the direct parent does not accept the split result after the empty block",
      );
    }

    const destination = findAdjacentValidInsertionPlacement({
      originBlockId: directParent.id,
      proposedType: input.defaultResultType,
      blocks: input.input.blocks,
      rootBlockIds: input.input.rootBlockIds,
      childIdsByParentId: input.input.childIdsByParentId,
      blockDefinitions: input.input.blockDefinitions,
    });
    if (!destination.ok) {
      if (destination.reason === "content-boundary") {
        return finishEmptyInsertion(
          input,
          input.defaultResultType,
          localPlacement,
          true,
        );
      }
      return failure(
        "no-destination",
        "no adjacent boundary exists after the wrapper",
      );
    }
    input.operations.push(
      removeBlocks({
        blockIds: [input.focused.id],
        includeDescendants: true,
        expectedParents: { [input.focused.id]: directParent.id },
      }),
    );
    return finishEmptyInsertion(
      input,
      input.defaultResultType,
      destination.placement,
      true,
    );
  }

  const exactOne =
    parentDefinition.kind === "wrapper" &&
    parentDefinition.content?.additional === undefined &&
    parentDefinition.content?.required.length === 1;
  const focusedDefinition = input.input.blockDefinitions[input.focused.type];
  const isContinuationWrapper =
    exactOne &&
    focusedDefinition !== undefined &&
    focusedDefinition.kind === "text" &&
    focusedDefinition.split?.[directParent.type] !== undefined;
  if (isContinuationWrapper) {
    const containingSiblings = liveChildren(input.input, directParent.parentId);
    const parentIndex = containingSiblings.findIndex(
      (block) => block.id === directParent.id,
    );
    if (parentIndex < 0) {
      return failure(
        "missing-block",
        "following wrapper sibling position is unavailable",
      );
    }
    const replacementPlacement = {
      parentId: directParent.parentId,
      childIndex: parentIndex,
    };
    input.operations.push(
      removeBlocks({
        blockIds: [directParent.id],
        includeDescendants: true,
        expectedParents: {
          [directParent.id]: directParent.parentId,
        },
      }),
    );
    return finishEmptyInsertion(
      input,
      input.defaultResultType,
      replacementPlacement,
      true,
    );
  }
  const placement = resolveSplitPlacement({
    input: input.input,
    focused: input.focused,
    defaultResultType: input.defaultResultType,
    applyParentOverride: !exactOne,
  });
  if (!placement.ok) return placement.failure;
  return finishEmptyInsertion(
    input,
    placement.resultType,
    placement.placement,
    true,
  );
}

function finishEmptyInsertion(
  input: {
    readonly input: PlanGenericEnterInput;
    readonly operations: StructuralTransactionOperation[];
    readonly expectedBlocks: Array<ReturnType<typeof blockExpectation>>;
  },
  resultType: BlockType,
  placement: BlockPlacement,
  focusInserted: boolean,
): PlanGenericEnterResult {
  const inserted = createResultInsertion({
    input: input.input,
    resultType,
    placement,
    splitOutputId: null,
  });
  input.operations.push(...inserted.operations);
  input.expectedBlocks.push(...inserted.expectedBlocks);
  if (focusInserted) {
    input.operations.push(
      setSelection({
        kind: "text-offset",
        blockId: inserted.selectionBlockId,
        offset: 0,
      }),
    );
  }
  return success(
    input.operations,
    input.expectedBlocks,
    inserted.selectionBlockId,
    resultType,
  );
}

function resolveSplitPlacement(input: {
  readonly input: PlanGenericEnterInput;
  readonly focused: VersionedBlock;
  readonly defaultResultType: BlockType;
  readonly applyParentOverride: boolean;
}):
  | {
      readonly ok: true;
      readonly placement: BlockPlacement;
      readonly resultType: BlockType;
    }
  | { readonly ok: false; readonly failure: PlanGenericEnterResult } {
  const destination = findAdjacentValidInsertionPlacement({
    originBlockId: input.focused.id,
    proposedType: input.defaultResultType,
    blocks: input.input.blocks,
    rootBlockIds: input.input.rootBlockIds,
    childIdsByParentId: input.input.childIdsByParentId,
    blockDefinitions: input.input.blockDefinitions,
  });
  if (!destination.ok) {
    return {
      ok: false,
      failure: failure(
        "no-destination",
        "no adjacent split destination exists",
      ),
    };
  }
  let resultType = input.defaultResultType;
  if (
    input.applyParentOverride &&
    !destination.remainsInsideDirectParent &&
    input.focused.parentId
  ) {
    const parent = input.input.blocks[input.focused.parentId];
    const definition = input.input.blockDefinitions[input.focused.type];
    const override =
      parent && definition && definition.kind === "text"
        ? definition.split?.[parent.type]
        : undefined;
    if (override) {
      if (
        !structuralPlacementAcceptsBlockType({
          placement: destination.placement,
          proposedType: override,
          blocks: input.input.blocks,
          rootBlockIds: input.input.rootBlockIds,
          childIdsByParentId: input.input.childIdsByParentId,
          blockDefinitions: input.input.blockDefinitions,
        })
      ) {
        return {
          ok: false,
          failure: failure(
            "invalid-override",
            "split override is not accepted at the external boundary",
          ),
        };
      }
      resultType = override;
    }
  }
  return { ok: true, placement: destination.placement, resultType };
}

function createResultInsertion(input: {
  readonly input: PlanGenericEnterInput;
  readonly resultType: BlockType;
  readonly placement: BlockPlacement;
  readonly splitOutputId: string | null;
}): ResultInsertion {
  const resultDefinition = input.input.blockDefinitions[input.resultType];
  if (!resultDefinition || resultDefinition.kind === "atomic") {
    throw new Error(
      `split result ${input.resultType} is not structurally valid`,
    );
  }
  const creation = planBlockTreeCreation({
    blockDefinitions: input.input.blockDefinitions,
    type: input.resultType,
    parentId: input.placement.parentId,
    selection: false,
    ...(input.input.createBlockId
      ? { createBlockId: input.input.createBlockId }
      : {}),
    isBlockIdReserved: (blockId) => input.input.blocks[blockId] !== undefined,
  });
  const selectionBlockId =
    resultDefinition.kind === "text"
      ? creation.rootBlockId
      : resolveUniqueDirectEditableChild(
          input.input.blockDefinitions,
          creation.rootBlockId,
          creation.nodes,
        );
  const records: CanonicalBlockRecord[] = creation.nodes.map((node) => {
    const definition = input.input.blockDefinitions[node.type]!;
    return {
      id: node.id,
      type: node.type,
      parentId: node.parentId,
      ...(node.metadata === undefined ? {} : { metadata: node.metadata }),
      ...(definition.kind === "text"
        ? {
            content: createBlockRichTextContentFromPlainText(node.type, ""),
            plainText: "",
          }
        : {}),
    };
  });
  const restorativeDefault = restorativeDefaultReplacementAtPlacement({
    input: input.input,
    placement: input.placement,
    resultType: input.resultType,
  });
  const operations: StructuralTransactionOperation[] = [];
  if (restorativeDefault) {
    operations.push(
      removeBlocks({
        blockIds: [restorativeDefault.block.id],
        includeDescendants: true,
        expectedParents: {
          [restorativeDefault.block.id]: input.placement.parentId,
        },
      }),
    );
  }
  operations.push(
    insertBlocks({
      placement: restorativeDefault?.placement ?? input.placement,
      blocks: records,
    }),
  );
  if (input.splitOutputId) {
    operations.push(
      replaceContent({
        blockId: selectionBlockId,
        expectedContentVersion: "1",
        value: { kind: "split-output", outputId: input.splitOutputId },
      }),
    );
  }
  return {
    operations,
    rootBlockId: creation.rootBlockId,
    selectionBlockId,
    expectedBlocks: restorativeDefault
      ? [blockExpectation(restorativeDefault.block)]
      : [],
  };
}

function restorativeDefaultReplacementAtPlacement(input: {
  readonly input: PlanGenericEnterInput;
  readonly placement: BlockPlacement;
  readonly resultType: BlockType;
}): {
  readonly block: VersionedBlock;
  readonly placement: BlockPlacement;
} | null {
  if (!input.placement.parentId) return null;
  const parent = input.input.blocks[input.placement.parentId];
  const definition = parent ? input.input.blockDefinitions[parent.type] : null;
  if (!parent || !definition) return null;
  const relationship = resolveRestorativeDefault(
    input.input.blockDefinitions,
    definition,
  );
  if (!relationship || relationship.replacementType !== input.resultType) {
    return null;
  }
  const children = liveChildren(input.input, parent.id);
  const defaults = children.filter(
    (child) => child.type === relationship.defaultType,
  );
  if (defaults.length === 0) return null;
  if (children.length !== 1 || defaults.length !== 1) {
    throw new Error("restorative-default wrapper contains mixed content");
  }
  return {
    block: defaults[0]!,
    placement: {
      parentId: parent.id,
      childIndex: 0,
    },
  };
}

function resolveUniqueDirectEditableChild(
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  rootBlockId: BlockId,
  nodes: readonly {
    readonly id: BlockId;
    readonly type: BlockType;
    readonly parentId: BlockId | null;
  }[],
): BlockId {
  const candidates = nodes.filter(
    (node) =>
      node.parentId === rootBlockId &&
      blockDefinitions[node.type] !== undefined &&
      blockDefinitions[node.type]!.kind === "text",
  );
  if (candidates.length !== 1) {
    throw new Error(
      "split result wrapper has no unambiguous direct editable child",
    );
  }
  return candidates[0]!.id;
}

function liveChildren(
  graph: Pick<
    PlanGenericEnterInput,
    "blocks" | "rootBlockIds" | "childIdsByParentId"
  >,
  parentId: BlockId | null,
): readonly VersionedBlock[] {
  const children = (
    parentId === null
      ? graph.rootBlockIds
      : (graph.childIdsByParentId[parentId] ?? [])
  ).map((id) => graph.blocks[id]);
  return children.filter((block): block is VersionedBlock =>
    Boolean(block && !block.tombstone),
  );
}

function blockExpectation(block: VersionedBlock) {
  return { blockId: block.id, type: block.type, parentId: block.parentId };
}

function success(
  operations: readonly StructuralTransactionOperation[],
  expectedBlocks: readonly ReturnType<typeof blockExpectation>[],
  selectionBlockId: BlockId,
  resultType: BlockType,
): PlanGenericEnterResult {
  return {
    ok: true,
    plan: {
      origin: "generic-enter",
      operations: [...operations],
      preconditions: {
        blocks: uniqueExpectations(expectedBlocks),
      },
    },
    selectionBlockId,
    resultType,
  };
}

function uniqueExpectations(
  values: readonly ReturnType<typeof blockExpectation>[],
): ReturnType<typeof blockExpectation>[] {
  return [...new Map(values.map((value) => [value.blockId, value])).values()];
}

function failure(
  reason: PlanGenericEnterFailure["reason"],
  message: string,
): PlanGenericEnterFailure {
  return { ok: false, reason, message };
}

function handledFailure(
  reason: Extract<PlanGenericEnterResult, { ok: false }>["reason"],
  message: string,
): PlanGenericEnterResult {
  return { ok: false, handled: true, reason, message };
}
