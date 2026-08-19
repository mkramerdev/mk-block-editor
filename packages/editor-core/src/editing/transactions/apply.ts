import {
  blockDefinitionAcceptsParent,
  blockDefinitionAcceptsSequence,
} from "../../definitions/structural-queries.ts";
import type { BlockType, VersionedBlock } from "../../document/model/block.ts";
import type { CanonicalBlockRecord } from "../canonical-fragment.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import { isStructuralKey } from "../../kernel/identity/uuid.ts";
import type { JsonObject } from "../../kernel/json/json-value.ts";
import { jsonValuesEqual } from "../../kernel/json/json-value.ts";
import {
  normalizeBlockMetadata,
  validateBlockMetadataForDefinitionWithChildren,
} from "../../metadata/validation.ts";
import {
  concatenateRichTextDocuments,
  createBlockRichTextContentFromPlainText,
  extractPlainTextFromRichTextDocument,
  isRichTextDocument,
  richTextDocumentContentSize,
  richInlineContentSize,
  richTextBlockInlineContent,
  retargetRichTextDocument,
  sliceRichTextDocument,
} from "../../content/rich-text/rich-inline-content.ts";
import type { RichTextDocumentNodeJson } from "../../content/rich-text/rich-inline-types.ts";
import type {
  EditorBlockContentOperationBatch,
  EditorLogicalContentOperation,
} from "../../operations/language/logical-operations.ts";
import { validateBlockPlacement } from "./boundary.ts";
import type {
  ApplyStructuralTransactionOptions,
  AppliedStructuralTransaction,
  BlockPlacement,
  SplitTextOutput,
  StructuralTransactionContext,
  StructuralTransactionOperation,
  StructuralTransactionPlan,
  StructuralTransactionResult,
  StructuralEditRange,
  StructuralEditRangeBlock,
  TransactionBlockReplacement,
  TransactionContentInput,
  TransactionSelectionTarget,
  TransactionReadableContent,
  TransactionRestoredBlockRecord,
} from "./types.ts";

class TransactionFailure extends Error {
  constructor(
    readonly failureKind:
      | "invalid-plan"
      | "stale-precondition"
      | "invalid-boundary"
      | "invalid-structure"
      | "invalid-content"
      | "invalid-selection",
    readonly operationIndex: number | null,
    message: string,
  ) {
    super(message);
  }
}

interface MutableTransactionState {
  readonly operations: readonly StructuralTransactionOperation[];
  blocks: Record<BlockId, VersionedBlock>;
  rootBlockIds: readonly BlockId[];
  childIdsByParentId: Readonly<Partial<Record<BlockId, readonly BlockId[]>>>;
  readonly baseRootBlockIds: readonly BlockId[];
  readonly baseChildIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
  readonly sealBlocks: () => Readonly<Record<BlockId, VersionedBlock>>;
  readonly splitOutputs: Map<string, SplitTextOutput>;
  readonly content: Map<BlockId, TransactionReadableContent>;
  readonly contentSizes: Map<BlockId, number>;
  readonly contentOperations: Map<BlockId, EditorLogicalContentOperation[]>;
  readonly affected: Set<BlockId>;
  readonly affectedParents: Set<BlockId | null>;
  readonly metadataOperationBlockIds: Set<BlockId>;
  selection: TransactionSelectionTarget;
}

interface BlockRecordOverlayDescriptor {
  readonly root: Readonly<Record<BlockId, VersionedBlock>>;
  readonly changed: Record<string, VersionedBlock>;
  readonly removed: Set<string>;
}

const blockRecordOverlay = Symbol("blockRecordOverlay");

export function applyStructuralTransaction(
  plan: StructuralTransactionPlan,
  context: StructuralTransactionContext,
  options: ApplyStructuralTransactionOptions = {},
): StructuralTransactionResult {
  try {
    assertPlan(plan);
    assertTransactionPreconditions(plan, context);
    assertMetadataOperationPreconditions(plan);
    const blockOverlay = createVersionedBlockRecordOverlay(context.blocks);
    const state: MutableTransactionState = {
      operations: plan.operations,
      blocks: blockOverlay.blocks,
      rootBlockIds: context.rootBlockIds,
      childIdsByParentId: context.childIdsByParentId,
      baseRootBlockIds: context.rootBlockIds,
      baseChildIdsByParentId: context.childIdsByParentId,
      sealBlocks: blockOverlay.seal,
      splitOutputs: new Map(),
      content: new Map(),
      contentSizes: new Map(),
      contentOperations: new Map(),
      affected: new Set(),
      affectedParents: new Set(),
      metadataOperationBlockIds: new Set(),
      selection: { kind: "none" },
    };
    for (let index = 0; index < plan.operations.length; index += 1) {
      applyOperation(plan.operations[index]!, index, state, context);
    }
    if (options.validateFinal !== false) {
      assertAffectedStructure(state, context);
    }
    const blocks = state.sealBlocks();
    const contentOperations = projectContentOperations(state);
    const transaction: AppliedStructuralTransaction = {
      blocks,
      rootBlockIds: state.rootBlockIds,
      childIdsByParentId: sealChildIdsByParentId(state),
      contentOperations,
      stagedContent: Object.fromEntries(
        [...state.content].map(([blockId, content]) => [blockId, content]),
      ),
      selection: state.selection,
      affectedBlockIds: [...state.affected],
      splitOutputs: Object.fromEntries(state.splitOutputs),
    };
    return { ok: true, transaction };
  } catch (error) {
    if (error instanceof TransactionFailure) {
      return {
        ok: false,
        operationIndex: error.operationIndex,
        failureKind: error.failureKind,
        message: error.message,
      };
    }
    return {
      ok: false,
      operationIndex: null,
      failureKind: "invalid-plan",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function assertMetadataOperationPreconditions(
  plan: StructuralTransactionPlan,
): void {
  for (let index = 0; index < plan.operations.length; index += 1) {
    const operation = plan.operations[index]!;
    if (operation.kind !== "replaceBlockMetadata") continue;
    if (
      typeof operation.expectedMetadataVersion !== "string" ||
      !operation.expectedMetadataVersion.trim()
    ) {
      fail(
        "invalid-plan",
        index,
        `metadata replacement for ${operation.blockId} requires an expected version`,
      );
    }
    if (operation.metadata === undefined) {
      fail(
        "invalid-content",
        index,
        `metadata replacement for ${operation.blockId} must use an object or null`,
      );
    }
  }
}

function assertTransactionPreconditions(
  plan: StructuralTransactionPlan,
  context: StructuralTransactionContext,
): void {
  const expected = plan.preconditions;
  if (!expected) return;
  for (const blockExpectation of expected.blocks ?? []) {
    const block = context.blocks[blockExpectation.blockId];
    if (
      !block ||
      block.tombstone ||
      block.type !== blockExpectation.type ||
      block.parentId !== blockExpectation.parentId
    ) {
      fail(
        "stale-precondition",
        null,
        `block ${blockExpectation.blockId} changed before transaction application`,
      );
    }
  }
  for (const [blockId, contentVersion] of Object.entries(
    expected.contentVersions ?? {},
  ) as [BlockId, string | null][]) {
    const block = context.blocks[blockId];
    if (!block || block.tombstone) {
      fail("stale-precondition", null, `block ${blockId} is unavailable`);
    }
    if (block.contentVersion !== contentVersion) {
      fail("stale-precondition", null, `content for ${blockId} changed`);
    }
  }
}

function applyOperation(
  operation: StructuralTransactionOperation,
  index: number,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): void {
  switch (operation.kind) {
    case "deleteRange":
      applyDeleteRange(operation.range, index, state, context);
      return;
    case "joinTextBlocks":
      applyJoinTextBlocks(
        operation.leftBlockId,
        operation.rightBlockId,
        index,
        state,
        context,
      );
      return;
    case "appendTextBlockContent":
      applyAppendTextBlockContent(operation, index, state, context);
      return;
    case "applyContentOperation": {
      const block = liveBlock(state.blocks, operation.operation.blockId, index);
      if (
        block.type !== operation.operation.blockType ||
        context.blockDefinitions[block.type]?.kind !== "text"
      ) {
        fail(
          "invalid-content",
          index,
          `content operation target ${block.id} is not matching text`,
        );
      }
      recordIncrementalContentOperation(
        block,
        operation.operation,
        state,
        context,
      );
      return;
    }
    case "splitText":
      applySplit(operation, index, state, context);
      return;
    case "insertBlocks":
      applyInsert(operation.blocks, operation.placement, index, state, context);
      return;
    case "restoreBlocks":
      applyRestore(operation.blocks, index, state, context);
      return;
    case "removeBlocks":
      applyRemove(operation, index, state, context);
      return;
    case "moveBlocks":
      applyMove(operation, index, state, context);
      return;
    case "placeBlock": {
      const block = liveBlock(state.blocks, operation.blockId, index);
      const siblings = currentChildIds(state, context, block.parentId);
      const childIndex = siblings.indexOf(block.id);
      if (childIndex < 0) {
        fail("invalid-structure", index, `block ${block.id} has no placement`);
      }
      applyMove(
        {
          kind: "moveBlocks",
          blockIds: [block.id],
          sourcePlacement: { parentId: block.parentId, childIndex },
          destinationPlacement: operation.placement,
        },
        index,
        state,
        context,
      );
      return;
    }
    case "replaceBlocks":
      applyReplaceBlocks(operation.blocks, index, state);
      return;
    case "replaceContent":
      applyReplace(
        operation.blockId,
        operation.expectedContentVersion,
        operation.value,
        operation.operation,
        index,
        state,
        context,
      );
      return;
    case "replaceBlockMetadata":
      applyReplaceBlockMetadata(operation, index, state, context);
      return;
    case "setSelection":
      state.selection = { ...operation.target };
      return;
  }
}

function applyReplaceBlockMetadata(
  operation: Extract<
    StructuralTransactionOperation,
    { kind: "replaceBlockMetadata" }
  >,
  index: number,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): void {
  state.metadataOperationBlockIds.add(operation.blockId);
  const block = liveBlock(state.blocks, operation.blockId, index);
  if (block.metadataVersion !== operation.expectedMetadataVersion) {
    fail(
      "stale-precondition",
      index,
      `metadata version for ${block.id} changed`,
    );
  }
  let currentMetadata: JsonObject | undefined;
  let metadata: JsonObject | undefined;
  try {
    currentMetadata = normalizeBlockMetadata(block.metadata);
    metadata = normalizeBlockMetadata(operation.metadata ?? undefined);
  } catch (error) {
    fail(
      "invalid-content",
      index,
      error instanceof Error ? error.message : String(error),
    );
  }
  if (jsonValuesEqual(currentMetadata ?? null, metadata ?? null)) return;

  const { metadata: _metadata, ...blockWithoutMetadata } = block;
  void _metadata;
  const nextBlock: VersionedBlock = {
    ...blockWithoutMetadata,
    ...(metadata === undefined ? {} : { metadata }),
    metadataVersion:
      context.nextMetadataVersion ?? incrementVersion(block.metadataVersion),
  };
  state.blocks[block.id] = nextBlock;
  state.affected.add(block.id);
}

function applyDeleteRange(
  range: StructuralEditRange,
  index: number,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): void {
  if (
    context.graphRevision !== undefined &&
    range.graphRevision !== context.graphRevision
  ) {
    fail("stale-precondition", index, "edit range graph revision changed");
  }
  if (
    !Number.isSafeInteger(range.selectionRevision) ||
    range.selectionRevision < 0 ||
    range.blocks.length === 0
  ) {
    fail("invalid-plan", index, "deleteRange requires a resolved range");
  }

  const beforeOrder = currentCanonicalOrder(state, context);
  const orderIndex = new Map(
    beforeOrder.map((blockId, canonicalIndex) => [blockId, canonicalIndex]),
  );
  const seen = new Set<BlockId>();
  let previousIndex = -1;
  for (const selected of range.blocks) {
    if (seen.has(selected.blockId)) {
      fail("invalid-plan", index, `edit range repeats ${selected.blockId}`);
    }
    seen.add(selected.blockId);
    const canonicalIndex = orderIndex.get(selected.blockId);
    if (canonicalIndex === undefined || canonicalIndex <= previousIndex) {
      fail(
        "stale-precondition",
        index,
        "edit range is not in current canonical order",
      );
    }
    previousIndex = canonicalIndex;
    assertRangeBlockPreconditions(selected, index, state);
  }
  assertRangeBoundary(range.start, "start", index, state, context);
  assertRangeBoundary(range.end, "end", index, state, context);

  const requestedBlockRemovals = new Set(
    range.blocks
      .filter(
        (
          selected,
        ): selected is Extract<StructuralEditRangeBlock, { kind: "block" }> =>
          selected.kind === "block",
      )
      .flatMap((selected) =>
        currentSubtreeBlockIds(state, context, selected.blockId),
      ),
  );
  const removalRoots: BlockId[] = [];
  const normalizationBlockIds = new Set<BlockId>();
  const laterInsertionParentIds = new Set<BlockId | null>(
    state.operations
      .slice(index + 1)
      .filter(
        (
          operation,
        ): operation is Extract<
          StructuralTransactionOperation,
          { kind: "insertBlocks" }
        > => operation.kind === "insertBlocks",
      )
      .map((operation) => operation.placement.parentId),
  );
  let provisionalSelection: TransactionSelectionTarget = { kind: "none" };

  for (const selected of range.blocks) {
    const block = liveBlock(state.blocks, selected.blockId, index);
    if (block.parentId !== null) normalizationBlockIds.add(block.parentId);
    const definition = context.blockDefinitions[block.type]!;
    if (selected.kind === "text") {
      if (definition.kind !== "text") {
        fail(
          "invalid-content",
          index,
          `text range block ${block.id} is not text`,
        );
      }
      const current = readContent(state, context, block.id, block.type);
      if (current.version !== selected.expectedContentVersion) {
        fail(
          "stale-precondition",
          index,
          `content version for ${block.id} changed`,
        );
      }
      const size = richTextDocumentContentSize(current.content);
      if (
        !Number.isInteger(selected.from) ||
        !Number.isInteger(selected.to) ||
        selected.from < 0 ||
        selected.to < selected.from ||
        selected.to > size
      ) {
        fail("invalid-content", index, `text range for ${block.id} is invalid`);
      }
      const next = concatenateRichTextDocuments(
        block.type,
        sliceRichTextDocument(block.type, current.content, 0, selected.from),
        sliceRichTextDocument(block.type, current.content, selected.to, size),
      );
      replaceContentValue(
        block,
        next,
        extractPlainTextFromRichTextDocument(next),
        state,
        context,
      );
      if (provisionalSelection.kind === "none") {
        provisionalSelection = {
          kind: "text-offset",
          blockId: block.id,
          offset: selected.from,
        };
      }
      continue;
    }
    if (selected.kind === "content") {
      if (definition.kind === "wrapper") continue;
      if (definition.kind !== "text") {
        fail(
          "invalid-content",
          index,
          `complete content selection for ${block.id} is not text`,
        );
      }
      const current = readContent(state, context, block.id, block.type);
      if (
        selected.expectedContentVersion !== undefined &&
        current.version !== selected.expectedContentVersion
      ) {
        fail(
          "stale-precondition",
          index,
          `content version for ${block.id} changed`,
        );
      }
      const empty = createBlockRichTextContentFromPlainText(block.type, "");
      replaceContentValue(block, empty, "", state, context);
      if (provisionalSelection.kind === "none") {
        provisionalSelection = {
          kind: "text-offset",
          blockId: block.id,
          offset: 0,
        };
      }
      continue;
    }

    if (
      definition.kind === "text" &&
      mustPreserveSelectedTextBlock(
        block,
        requestedBlockRemovals,
        state,
        context,
        laterInsertionParentIds,
      )
    ) {
      requestedBlockRemovals.delete(block.id);
      const empty = createBlockRichTextContentFromPlainText(block.type, "");
      replaceContentValue(block, empty, "", state, context);
      if (provisionalSelection.kind === "none") {
        provisionalSelection = {
          kind: "text-offset",
          blockId: block.id,
          offset: 0,
        };
      }
      continue;
    }
    const ancestorSelected = removalRoots.some((rootId) =>
      currentSubtreeBlockIds(state, context, rootId).includes(block.id),
    );
    if (!ancestorSelected) removalRoots.push(block.id);
  }

  if (removalRoots.length > 0) {
    applyRemove(
      {
        kind: "removeBlocks",
        blockIds: removalRoots,
        includeDescendants: true,
        expectedParents: Object.fromEntries(
          removalRoots.map((blockId) => [
            blockId,
            range.blocks.find((selected) => selected.blockId === blockId)!
              .parentId,
          ]),
        ),
      },
      index,
      state,
      context,
    );
  }
  normalizeAfterStructuralRemoval(
    index,
    state,
    context,
    normalizationBlockIds,
    laterInsertionParentIds,
  );
  const deletionSelection = resolveDeleteSelection(
    provisionalSelection,
    range,
    beforeOrder,
    state,
    context,
  );
  if (!selectionTargetsLiveBlock(state.selection, state)) {
    state.selection = deletionSelection;
  }
}

function selectionTargetsLiveBlock(
  selection: TransactionSelectionTarget,
  state: MutableTransactionState,
): boolean {
  if (selection.kind === "none") return false;
  const block = state.blocks[selection.blockId];
  return Boolean(block && !block.tombstone);
}

function applyJoinTextBlocks(
  leftBlockId: BlockId,
  rightBlockId: BlockId,
  index: number,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): void {
  if (leftBlockId === rightBlockId) {
    fail("invalid-plan", index, "joinTextBlocks requires distinct blocks");
  }
  const left = liveBlock(state.blocks, leftBlockId, index);
  const right = liveBlock(state.blocks, rightBlockId, index);
  const leftDefinition = context.blockDefinitions[left.type];
  const rightDefinition = context.blockDefinitions[right.type];
  if (leftDefinition?.kind !== "text" || rightDefinition?.kind !== "text") {
    fail("invalid-content", index, "joinTextBlocks requires two text blocks");
  }
  assertJoinDoesNotCrossContentBoundary(left, right, index, state, context);
  const leftContent = readContent(state, context, left.id, left.type);
  const rightContent = readContent(state, context, right.id, right.type);

  const joinOffset = applyAppendTextBlockContent(
    {
      kind: "appendTextBlockContent",
      destinationBlockId: left.id,
      sourceBlockId: right.id,
      expectedDestinationContentVersion: left.contentVersion,
      expectedSourceContentVersion: right.contentVersion,
      operation: {
        kind: "insertInlineContent",
        blockId: left.id,
        blockType: left.type,
        target: { kind: "text" },
        position: {
          blockId: left.id,
          offset:
            state.contentSizes.get(left.id) ??
            richTextDocumentContentSize(leftContent.content),
        },
        content: richTextBlockInlineContent(rightContent.content),
      },
    },
    index,
    state,
    context,
  );
  applyRemove(
    {
      kind: "removeBlocks",
      blockIds: [right.id],
      includeDescendants: false,
      expectedParents: { [right.id]: right.parentId },
    },
    index,
    state,
    context,
  );
  normalizeAfterStructuralRemoval(
    index,
    state,
    context,
    right.parentId === null ? [] : [right.parentId],
  );
  state.selection = {
    kind: "text-offset",
    blockId: left.id,
    offset: joinOffset,
  };
}

function applyAppendTextBlockContent(
  operation: Extract<
    StructuralTransactionOperation,
    { readonly kind: "appendTextBlockContent" }
  >,
  index: number,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): number {
  const {
    destinationBlockId,
    sourceBlockId,
    expectedDestinationContentVersion,
    expectedSourceContentVersion,
  } = operation;
  if (destinationBlockId === sourceBlockId) {
    fail(
      "invalid-plan",
      index,
      "appendTextBlockContent requires distinct blocks",
    );
  }
  const left = liveBlock(state.blocks, destinationBlockId, index);
  const right = liveBlock(state.blocks, sourceBlockId, index);
  const leftDefinition = context.blockDefinitions[left.type];
  const rightDefinition = context.blockDefinitions[right.type];
  if (leftDefinition?.kind !== "text" || rightDefinition?.kind !== "text") {
    fail(
      "invalid-content",
      index,
      "appendTextBlockContent requires two text blocks",
    );
  }
  if (
    left.contentVersion !== expectedDestinationContentVersion ||
    right.contentVersion !== expectedSourceContentVersion
  ) {
    fail("stale-precondition", index, "append text content version changed");
  }
  if (nextCanonicalLeafId(left.id, index, state, context) !== right.id) {
    fail(
      "invalid-boundary",
      index,
      `text blocks ${left.id} and ${right.id} are not adjacent`,
    );
  }
  if (
    operation.operation.blockId !== left.id ||
    operation.operation.blockType !== left.type ||
    operation.operation.position.blockId !== left.id
  ) {
    fail(
      "invalid-content",
      index,
      "append content operation target is invalid",
    );
  }
  const joinOffset =
    state.contentSizes.get(left.id) ?? operation.operation.position.offset;
  if (operation.operation.position.offset !== joinOffset) {
    fail("stale-precondition", index, "append content offset changed");
  }
  state.contentSizes.set(left.id, joinOffset);
  recordIncrementalContentOperation(left, operation.operation, state, context);
  return joinOffset;
}

function nextCanonicalLeafId(
  blockId: BlockId,
  index: number,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): BlockId | null {
  const firstLeaf = (candidateId: BlockId): BlockId | null => {
    let currentId = candidateId;
    for (;;) {
      const current = liveBlock(state.blocks, currentId, index);
      const definition = context.blockDefinitions[current.type];
      if (!definition) {
        fail(
          "invalid-structure",
          index,
          `block type ${current.type} is unknown`,
        );
      }
      if (definition.kind === "text" || definition.kind === "atomic") {
        return current.id;
      }
      const children = currentChildIds(state, context, current.id);
      if (children.length === 0) return null;
      currentId = children[0]!;
    }
  };
  let current = liveBlock(state.blocks, blockId, index);
  for (;;) {
    const siblings = currentChildIds(state, context, current.parentId);
    const siblingIndex = siblings.indexOf(current.id);
    if (siblingIndex < 0) {
      fail("invalid-structure", index, `block ${current.id} is not contained`);
    }
    for (let cursor = siblingIndex + 1; cursor < siblings.length; cursor += 1) {
      const leaf = firstLeaf(siblings[cursor]!);
      if (leaf) return leaf;
    }
    if (current.parentId === null) return null;
    current = liveBlock(state.blocks, current.parentId, index);
  }
}

function applySplit(
  operation: Extract<StructuralTransactionOperation, { kind: "splitText" }>,
  index: number,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): void {
  const block = liveBlock(state.blocks, operation.blockId, index);
  const definition = context.blockDefinitions[block.type];
  if (!definition || !(definition.kind === "text")) {
    fail("invalid-content", index, `block ${block.id} is not editable text`);
  }
  if (state.splitOutputs.has(operation.outputId)) {
    fail(
      "invalid-plan",
      index,
      `split output ${operation.outputId} is duplicated`,
    );
  }
  const current = readContent(state, context, block.id, block.type);
  if (current.version !== operation.expectedContentVersion) {
    fail(
      "stale-precondition",
      index,
      `content version for ${block.id} changed`,
    );
  }
  if (!isRichTextDocument(current.content)) {
    fail(
      "invalid-content",
      index,
      `block ${block.id} has no rich text content`,
    );
  }
  const size =
    state.contentSizes.get(block.id) ??
    richTextDocumentContentSize(current.content);
  const from = operation.selectionRange?.from ?? operation.offset;
  const to = operation.selectionRange?.to ?? operation.offset;
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    to < from ||
    to > size ||
    operation.offset !== from
  ) {
    fail(
      "invalid-content",
      index,
      `split selection is outside block ${block.id}`,
    );
  }
  const left = sliceRichTextDocument(block.type, current.content, 0, from);
  const right = sliceRichTextDocument(block.type, current.content, to, size);
  const leftPlainText = extractPlainTextFromRichTextDocument(left);
  const rightPlainText = extractPlainTextFromRichTextDocument(right);
  replaceContentValue(block, left, leftPlainText, state, context, {
    kind: "deleteInlineRange",
    blockId: block.id,
    blockType: block.type,
    target: { kind: "text" },
    range: {
      from: { blockId: block.id, offset: from },
      to: { blockId: block.id, offset: size },
    },
    deletedContent: richTextBlockInlineContent(
      sliceRichTextDocument(block.type, current.content, from, size),
    ),
  });
  state.splitOutputs.set(operation.outputId, {
    content: right,
    plainText: rightPlainText,
  });
}

function applyInsert(
  records: readonly CanonicalBlockRecord[],
  placement: BlockPlacement,
  index: number,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): void {
  if (records.length === 0)
    fail("invalid-plan", index, "insertBlocks requires records");
  if (!validateBlockPlacement(currentGraph(state), placement)) {
    fail("invalid-boundary", index, "insertion placement is invalid");
  }
  const inserted = new Set<BlockId>();
  for (const record of records) {
    if (state.blocks[record.id] || inserted.has(record.id)) {
      fail(
        "invalid-plan",
        index,
        `inserted block id ${record.id} is duplicated`,
      );
    }
    if (!context.blockDefinitions[record.type]) {
      fail(
        "invalid-structure",
        index,
        `inserted block type ${record.type} is unknown`,
      );
    }
    const definition = context.blockDefinitions[record.type]!;
    if (
      definition.kind === "text" &&
      (record.content === undefined || record.plainText === undefined)
    ) {
      fail(
        "invalid-content",
        index,
        `text block ${record.id} requires initial rich-text content and plain text`,
      );
    }
    if (
      definition.kind !== "text" &&
      (record.content !== undefined || record.plainText !== undefined)
    ) {
      fail(
        "invalid-content",
        index,
        `${definition.kind} block ${record.id} must not have text content`,
      );
    }
    if (
      record.content !== undefined &&
      extractPlainTextFromRichTextDocument(record.content) !== record.plainText
    ) {
      fail(
        "invalid-content",
        index,
        `plain text for ${record.id} does not match its rich-text content`,
      );
    }
    try {
      normalizeBlockMetadata(record.metadata);
    } catch (error) {
      fail(
        "invalid-content",
        index,
        error instanceof Error ? error.message : String(error),
      );
    }
    if (
      record.parentId !== placement.parentId &&
      !inserted.has(record.parentId as BlockId)
    ) {
      fail(
        "invalid-structure",
        index,
        `inserted block ${record.id} has missing parent`,
      );
    }
    inserted.add(record.id);
  }
  const rootRecords = records.filter(
    (record) => record.parentId === placement.parentId,
  );
  if (rootRecords.length === 0)
    fail("invalid-structure", index, "insert has no boundary roots");
  records.forEach((record) => {
    const block: VersionedBlock = {
      id: record.id,
      type: record.type,
      parentId: record.parentId,
      tombstone: null,
      metadataVersion: "1",
      contentVersion: null,
      ...(record.metadata === undefined
        ? {}
        : { metadata: normalizeBlockMetadata(record.metadata) }),
    };
    state.blocks[record.id] = block;
    if (record.parentId !== placement.parentId) {
      const childIds = currentChildIds(state, context, record.parentId);
      childIds.push(record.id);
      setChildIds(state, record.parentId, childIds);
    }
    state.affected.add(record.id);
    state.affectedParents.add(record.parentId);
    if (record.content !== undefined) {
      if (!context.validateContent(record.type, record.content)) {
        fail(
          "invalid-content",
          index,
          `initial content for ${record.id} is invalid`,
        );
      }
      replaceContentValue(
        block,
        record.content,
        record.plainText ?? "",
        state,
        context,
      );
    }
  });
  const destinationIds = currentChildIds(state, context, placement.parentId);
  destinationIds.splice(
    placement.childIndex,
    0,
    ...rootRecords.map((record) => record.id),
  );
  setChildIds(state, placement.parentId, destinationIds);
}

function applyRestore(
  records: readonly TransactionRestoredBlockRecord[],
  index: number,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): void {
  if (records.length === 0)
    fail("invalid-plan", index, "restoreBlocks requires records");

  const restoring = new Set<BlockId>();
  for (const record of records) {
    const { block, placement } = record;
    if (
      typeof block.id !== "string" ||
      !isStructuralKey(block.id) ||
      restoring.has(block.id)
    ) {
      fail(
        "invalid-plan",
        index,
        `restored block id ${String(block.id)} is invalid or duplicated`,
      );
    }
    const existing = state.blocks[block.id];
    if (existing && !existing.tombstone) {
      fail(
        "stale-precondition",
        index,
        `restored block ${block.id} conflicts with a live block`,
      );
    }
    if (block.tombstone) {
      fail(
        "invalid-structure",
        index,
        `restored block ${block.id} must be live`,
      );
    }
    if (!context.blockDefinitions[block.type]) {
      fail(
        "invalid-structure",
        index,
        `restored block type ${block.type} is unknown`,
      );
    }
    if (
      block.parentId !== placement.parentId ||
      !Number.isSafeInteger(placement.childIndex) ||
      placement.childIndex < 0
    ) {
      fail(
        "invalid-structure",
        index,
        `restored block ${block.id} has an invalid semantic placement`,
      );
    }
    restoring.add(block.id);
  }

  for (const { block } of records) {
    if (
      block.parentId !== null &&
      !restoring.has(block.parentId) &&
      (!state.blocks[block.parentId] || state.blocks[block.parentId]!.tombstone)
    ) {
      fail(
        "invalid-structure",
        index,
        `restored block ${block.id} references missing parent ${block.parentId}`,
      );
    }
  }

  for (const { block } of records) {
    state.blocks[block.id] = cloneVersionedBlock(block);
    deleteChildIds(state, block.id);
    if (block.contentVersion !== null && context.blocks[block.id]) {
      const content = context.readContent(block.id, block.type);
      if (content) {
        state.content.set(block.id, {
          ...content,
          version: block.contentVersion,
        });
        recordContentReplacement(
          block,
          createBlockRichTextContentFromPlainText(block.type, ""),
          content.content,
          state,
        );
      }
    }
    state.affected.add(block.id);
    state.affectedParents.add(block.parentId);
  }

  const byParent = new Map<BlockId | null, TransactionRestoredBlockRecord[]>();
  for (const record of records) {
    const group = byParent.get(record.placement.parentId);
    if (group) group.push(record);
    else byParent.set(record.placement.parentId, [record]);
  }
  for (const [parentId, group] of byParent) {
    const ids = currentChildIds(state, context, parentId).filter(
      (blockId) => !restoring.has(blockId),
    );
    const seenIndexes = new Set<number>();
    const ordered = [...group].sort(
      (left, right) => left.placement.childIndex - right.placement.childIndex,
    );
    if (
      parentId !== null &&
      restoring.has(parentId) &&
      ordered.some(
        (record, childIndex) => record.placement.childIndex !== childIndex,
      )
    ) {
      fail(
        "invalid-structure",
        index,
        `restored children of ${parentId} must form one ordered direct-child sequence`,
      );
    }
    for (const record of ordered) {
      if (seenIndexes.has(record.placement.childIndex)) {
        fail(
          "invalid-structure",
          index,
          `restored children of ${String(parentId)} contain duplicate positions`,
        );
      }
      seenIndexes.add(record.placement.childIndex);
      const childIndex = Math.min(record.placement.childIndex, ids.length);
      ids.splice(childIndex, 0, record.block.id);
    }
    setChildIds(state, parentId, ids);
  }
}

function applyReplaceBlocks(
  replacements: readonly TransactionBlockReplacement[],
  index: number,
  state: MutableTransactionState,
): void {
  if (replacements.length === 0)
    fail("invalid-plan", index, "replaceBlocks requires records");
  const replaced = new Set<BlockId>();
  for (const { block } of replacements) {
    if (
      typeof block.id !== "string" ||
      !isStructuralKey(block.id) ||
      replaced.has(block.id)
    ) {
      fail(
        "invalid-plan",
        index,
        `replacement block id ${String(block.id)} is invalid or duplicated`,
      );
    }
    const current = liveBlock(state.blocks, block.id, index);
    if (block.tombstone) {
      fail(
        "invalid-structure",
        index,
        `replacement block ${block.id} must be live`,
      );
    }
    if (block.parentId !== current.parentId) {
      fail(
        "invalid-structure",
        index,
        `replacement block ${block.id} must preserve its current parent`,
      );
    }
    state.blocks[block.id] = cloneVersionedBlock(block);
    state.affected.add(block.id);
    state.affectedParents.add(block.parentId);
    replaced.add(block.id);
  }
}

function cloneVersionedBlock(block: VersionedBlock): VersionedBlock {
  const metadata = normalizeBlockMetadata(block.metadata);
  return {
    id: block.id,
    type: block.type,
    parentId: block.parentId,
    metadataVersion: block.metadataVersion,
    contentVersion: block.contentVersion,
    tombstone: null,
    ...(metadata === undefined ? {} : { metadata }),
  };
}

function applyRemove(
  operation: Extract<StructuralTransactionOperation, { kind: "removeBlocks" }>,
  index: number,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): void {
  if (operation.blockIds.length === 0)
    fail("invalid-plan", index, "removeBlocks requires ids");
  const removing = new Set<BlockId>();
  for (const blockId of operation.blockIds) {
    const block = liveBlock(state.blocks, blockId, index);
    state.affectedParents.add(block.parentId);
    const expectedParent = operation.expectedParents?.[blockId];
    if (
      expectedParent !== undefined &&
      (block.parentId ?? null) !== expectedParent
    ) {
      fail("stale-precondition", index, `parent for ${blockId} changed`);
    }
    const descendants = currentSubtreeBlockIds(state, context, blockId);
    if (!operation.includeDescendants && descendants.length > 1) {
      fail(
        "invalid-structure",
        index,
        `block ${blockId} still has descendants`,
      );
    }
    for (const id of operation.includeDescendants ? descendants : [blockId])
      removing.add(id);
  }
  for (const id of removing) {
    const block = state.blocks[id];
    if (block) {
      const siblingIds = currentChildIds(state, context, block.parentId);
      const siblingIndex = siblingIds.indexOf(id);
      if (siblingIndex >= 0) {
        siblingIds.splice(siblingIndex, 1);
        setChildIds(state, block.parentId, siblingIds);
      }
    }
    deleteChildIds(state, id);
    delete state.blocks[id];
    state.content.delete(id);
    state.affected.add(id);
  }
}

function applyMove(
  operation: Extract<StructuralTransactionOperation, { kind: "moveBlocks" }>,
  index: number,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): void {
  if (operation.blockIds.length === 0)
    fail("invalid-plan", index, "moveBlocks requires ids");
  if (!validateBlockPlacement(currentGraph(state), operation.sourcePlacement)) {
    fail("invalid-boundary", index, "move source placement is invalid");
  }
  const sourceSiblingIds = currentChildIds(
    state,
    context,
    operation.sourcePlacement.parentId,
  );
  const originalSourceSiblingIds = [...sourceSiblingIds];
  const roots = operation.blockIds.map((id) =>
    liveBlock(state.blocks, id, index),
  );
  const firstIndex = operation.sourcePlacement.childIndex;
  if (
    roots.some(
      (block, offset) => sourceSiblingIds[firstIndex + offset] !== block.id,
    )
  ) {
    fail("stale-precondition", index, "move source placement changed");
  }
  const movedIds = new Set(
    roots.flatMap((root) => currentSubtreeBlockIds(state, context, root.id)),
  );
  if (
    operation.destinationPlacement.parentId !== null &&
    movedIds.has(operation.destinationPlacement.parentId)
  ) {
    fail(
      "invalid-structure",
      index,
      "cannot move a block into its own subtree",
    );
  }
  sourceSiblingIds.splice(firstIndex, roots.length);
  setChildIds(state, operation.sourcePlacement.parentId, sourceSiblingIds);
  const destinationIds = currentChildIds(
    state,
    context,
    operation.destinationPlacement.parentId,
  );
  const requestedIndex = operation.destinationPlacement.childIndex;
  if (
    !Number.isInteger(requestedIndex) ||
    requestedIndex < 0 ||
    requestedIndex > destinationIds.length
  ) {
    fail("invalid-boundary", index, "move destination placement is invalid");
  }
  destinationIds.splice(requestedIndex, 0, ...operation.blockIds);
  if (
    operation.sourcePlacement.parentId ===
      operation.destinationPlacement.parentId &&
    sameBlockIdSequence(originalSourceSiblingIds, destinationIds)
  ) {
    setChildIds(
      state,
      operation.sourcePlacement.parentId,
      originalSourceSiblingIds,
    );
    return;
  }
  setChildIds(state, operation.destinationPlacement.parentId, destinationIds);
  for (const root of roots) {
    state.blocks[root.id] = {
      ...root,
      parentId: operation.destinationPlacement.parentId,
    };
    state.affected.add(root.id);
    state.affectedParents.add(root.parentId);
    state.affectedParents.add(operation.destinationPlacement.parentId);
  }
}

function sameBlockIdSequence(
  left: readonly BlockId[],
  right: readonly BlockId[],
): boolean {
  return (
    left.length === right.length &&
    left.every((blockId, index) => blockId === right[index])
  );
}

function applyReplace(
  blockId: BlockId,
  expectedVersion: string | null,
  value: TransactionContentInput,
  operation: EditorLogicalContentOperation | undefined,
  index: number,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): void {
  const block = liveBlock(state.blocks, blockId, index);
  const resolved =
    value.kind === "value"
      ? value
      : (() => {
          const output = resolveSplitOutput(value.outputId, index, state);
          return {
            content: retargetRichTextDocument(output.content, block.type),
            plainText: output.plainText,
          };
        })();
  const current =
    state.content.get(block.id) ?? context.readContent(block.id, block.type);
  if (current) {
    state.content.set(block.id, current);
    if (current.version !== expectedVersion) {
      fail(
        "stale-precondition",
        index,
        `content version for ${block.id} changed`,
      );
    }
  } else if (
    context.blocks[block.id] ||
    block.contentVersion !== expectedVersion
  ) {
    fail("invalid-content", index, `content for ${block.id} is unavailable`);
  }
  if (!context.validateContent(block.type, resolved.content)) {
    fail(
      "invalid-content",
      index,
      `replacement content for ${block.id} is invalid`,
    );
  }
  replaceContentValue(
    block,
    resolved.content,
    resolved.plainText,
    state,
    context,
    operation,
  );
}

function replaceContentValue(
  block: VersionedBlock,
  content: RichTextDocumentNodeJson,
  plainText: string,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
  operation?: EditorLogicalContentOperation,
): void {
  const current = state.content.get(block.id);
  const previous =
    current ??
    (context.blocks[block.id]
      ? context.readContent(block.id, block.type)
      : null);
  if (
    previous &&
    previous.plainText === plainText &&
    jsonValuesEqual(previous.content, content)
  ) {
    return;
  }
  const version = (
    context.nextContentVersion !== undefined && block.contentVersion !== null
      ? context.nextContentVersion
      : incrementVersion(block.contentVersion ?? "0")
  ) as VersionedBlock["contentVersion"];
  state.blocks[block.id] = { ...block, contentVersion: version };
  if (operation) recordContentOperation(operation, state);
  else
    recordContentReplacement(
      block,
      previous?.content ??
        createBlockRichTextContentFromPlainText(block.type, ""),
      content,
      state,
    );
  state.content.set(block.id, { content, plainText, version });
  state.contentSizes.set(block.id, richTextDocumentContentSize(content));
  state.affected.add(block.id);
}

function recordIncrementalContentOperation(
  block: VersionedBlock,
  operation: EditorLogicalContentOperation,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): void {
  const knownSize = state.contentSizes.get(block.id);
  const baseSize =
    knownSize ??
    (context.blocks[block.id]
      ? richTextDocumentContentSize(
          readContent(state, context, block.id, block.type).content,
        )
      : 0);
  const nextSize =
    operation.kind === "insertInlineContent"
      ? baseSize + richInlineContentSize(operation.content)
      : operation.kind === "deleteInlineRange"
        ? baseSize - (operation.range.to.offset - operation.range.from.offset)
        : operation.kind === "replaceInlineRange"
          ? baseSize -
            (operation.range.to.offset - operation.range.from.offset) +
            richInlineContentSize(operation.content)
          : baseSize;
  state.contentSizes.set(block.id, nextSize);
  const version = (
    context.nextContentVersion !== undefined && block.contentVersion !== null
      ? context.nextContentVersion
      : incrementVersion(block.contentVersion ?? "0")
  ) as VersionedBlock["contentVersion"];
  state.blocks[block.id] = { ...block, contentVersion: version };
  recordContentOperation(operation, state);
  state.affected.add(block.id);
}

function currentCanonicalOrder(
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): readonly BlockId[] {
  const ordered: BlockId[] = [];
  const visiting = new Set<BlockId>();
  const visited = new Set<BlockId>();
  const visit = (blockId: BlockId, expectedParentId: BlockId | null): void => {
    if (visiting.has(blockId)) {
      fail("invalid-structure", null, `parent cycle includes ${blockId}`);
    }
    if (visited.has(blockId)) {
      fail(
        "invalid-structure",
        null,
        `block ${blockId} appears more than once in containment`,
      );
    }
    const block = state.blocks[blockId];
    if (!block || block.tombstone) {
      fail(
        "invalid-structure",
        null,
        `containment references missing ${blockId}`,
      );
    }
    if (block.parentId !== expectedParentId) {
      fail(
        "invalid-structure",
        null,
        `parent for ${blockId} disagrees with containment`,
      );
    }
    if (!context.blockDefinitions[block.type]) {
      fail("invalid-structure", null, `block type ${block.type} is unknown`);
    }
    visiting.add(blockId);
    ordered.push(blockId);
    for (const childId of currentChildIds(state, context, blockId)) {
      visit(childId, blockId);
    }
    visiting.delete(blockId);
    visited.add(blockId);
  };
  for (const rootId of state.rootBlockIds) visit(rootId, null);
  for (const [blockId, block] of Object.entries(state.blocks) as [
    BlockId,
    VersionedBlock,
  ][]) {
    if (!block.tombstone && !visited.has(blockId)) {
      fail("invalid-structure", null, `block ${blockId} is unreachable`);
    }
  }
  return ordered;
}

function assertRangeBlockPreconditions(
  selected: StructuralEditRangeBlock,
  index: number,
  state: MutableTransactionState,
): void {
  const block = liveBlock(state.blocks, selected.blockId, index);
  if (
    block.type !== selected.blockType ||
    block.parentId !== selected.parentId
  ) {
    fail(
      "stale-precondition",
      index,
      `block ${selected.blockId} changed after the edit range was resolved`,
    );
  }
}

function assertRangeBoundary(
  boundary: StructuralEditRange["start"],
  edge: "start" | "end",
  index: number,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): void {
  const block = liveBlock(state.blocks, boundary.blockId, index);
  if (boundary.kind === "block") return;
  const definition = context.blockDefinitions[block.type];
  if (definition?.kind !== "text") {
    fail(
      "invalid-boundary",
      index,
      `${edge} text boundary ${block.id} is not a text block`,
    );
  }
  const content = readContent(state, context, block.id, block.type);
  const size = richTextDocumentContentSize(content.content);
  if (
    !Number.isInteger(boundary.offset) ||
    boundary.offset < 0 ||
    boundary.offset > size
  ) {
    fail(
      "invalid-boundary",
      index,
      `${edge} text boundary for ${block.id} is outside its content`,
    );
  }
}

function mustPreserveSelectedTextBlock(
  block: VersionedBlock,
  requestedRemovals: ReadonlySet<BlockId>,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
  laterInsertionParentIds: ReadonlySet<BlockId | null>,
): boolean {
  if (block.parentId === null) {
    if (laterInsertionParentIds.has(null)) return false;
    const remainingRoots = state.rootBlockIds.filter(
      (blockId) => !requestedRemovals.has(blockId),
    );
    return remainingRoots.length === 0 && state.rootBlockIds[0] === block.id;
  }
  const parent = state.blocks[block.parentId];
  if (!parent || parent.tombstone) return false;
  if (laterInsertionParentIds.has(parent.id)) return false;
  const parentDefinition = context.blockDefinitions[parent.type];
  if (!parentDefinition || parentDefinition.kind !== "wrapper") return false;
  const remainingTypes = currentChildIds(state, context, parent.id)
    .filter((blockId) => !requestedRemovals.has(blockId))
    .map((blockId) => liveBlock(state.blocks, blockId, null).type);
  if (
    blockDefinitionAcceptsSequence(
      context.blockDefinitions,
      parentDefinition,
      remainingTypes,
    )
  ) {
    return false;
  }
  const withSurvivor = currentChildIds(state, context, parent.id)
    .filter(
      (blockId) => blockId === block.id || !requestedRemovals.has(blockId),
    )
    .map((blockId) => liveBlock(state.blocks, blockId, null).type);
  return blockDefinitionAcceptsSequence(
    context.blockDefinitions,
    parentDefinition,
    withSurvivor,
  );
}

function normalizeAfterStructuralRemoval(
  index: number,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
  directlyAffectedWrapperIds: ReadonlySet<BlockId> | readonly BlockId[],
  laterInsertionParentIds: ReadonlySet<BlockId | null> = new Set(),
): void {
  const affectedWrapperIds = new Set<BlockId>();
  for (const startingBlockId of directlyAffectedWrapperIds) {
    let blockId: BlockId | null = startingBlockId;
    while (blockId !== null && !affectedWrapperIds.has(blockId)) {
      affectedWrapperIds.add(blockId);
      blockId = state.blocks[blockId]?.parentId ?? null;
    }
  }
  let changed = true;
  while (changed) {
    changed = false;
    const ordered = [...currentCanonicalOrder(state, context)]
      .reverse()
      .filter((blockId) => affectedWrapperIds.has(blockId));
    for (const blockId of ordered) {
      const wrapper = state.blocks[blockId];
      if (!wrapper || wrapper.tombstone) continue;
      if (laterInsertionParentIds.has(wrapper.id)) continue;
      const definition = context.blockDefinitions[wrapper.type];
      if (definition?.kind !== "wrapper") continue;
      const children = currentChildIds(state, context, wrapper.id).map(
        (childId) => liveBlock(state.blocks, childId, index),
      );

      if (definition.compound && children.length > 0) {
        const primaryChild = children[0]!;
        if (
          primaryChild.type === definition.compound.primaryTextChildType &&
          context.blockDefinitions[primaryChild.type]?.kind === "text" &&
          richTextDocumentContentSize(
            readContent(state, context, primaryChild.id, primaryChild.type)
              .content,
          ) === 0
        ) {
          applyRemove(
            {
              kind: "removeBlocks",
              blockIds: [wrapper.id],
              includeDescendants: true,
              expectedParents: { [wrapper.id]: wrapper.parentId },
            },
            index,
            state,
            context,
          );
          changed = true;
          break;
        }
      }

      const childTypes = children.map((child) => child.type);
      if (
        blockDefinitionAcceptsSequence(
          context.blockDefinitions,
          definition,
          childTypes,
        )
      ) {
        continue;
      }
      if (definition.underflow && children.length === 1) {
        const survivingWrapper = children[0]!;
        const survivingDefinition =
          context.blockDefinitions[survivingWrapper.type];
        if (survivingDefinition?.kind !== "wrapper") {
          fail(
            "invalid-structure",
            index,
            `underflow survivor ${survivingWrapper.id} is not a wrapper`,
          );
        }
        const promotedIds = currentChildIds(
          state,
          context,
          survivingWrapper.id,
        );
        if (promotedIds.length === 0) {
          fail(
            "invalid-structure",
            index,
            `underflow survivor ${survivingWrapper.id} has no contents`,
          );
        }
        const wrapperSiblings = currentChildIds(
          state,
          context,
          wrapper.parentId,
        );
        const wrapperIndex = wrapperSiblings.indexOf(wrapper.id);
        if (wrapperIndex < 0) {
          fail(
            "invalid-structure",
            index,
            `underflow wrapper ${wrapper.id} is outside containment`,
          );
        }
        if (wrapper.parentId !== null) {
          const destinationParent = liveBlock(
            state.blocks,
            wrapper.parentId,
            index,
          );
          const destinationDefinition =
            context.blockDefinitions[destinationParent.type];
          if (
            !destinationDefinition ||
            !blockDefinitionAcceptsSequence(
              context.blockDefinitions,
              destinationDefinition,
              [
                ...wrapperSiblings
                  .slice(0, wrapperIndex)
                  .map((id) => liveBlock(state.blocks, id, index).type),
                ...promotedIds.map(
                  (id) => liveBlock(state.blocks, id, index).type,
                ),
                ...wrapperSiblings
                  .slice(wrapperIndex + 1)
                  .map((id) => liveBlock(state.blocks, id, index).type),
              ],
            )
          ) {
            fail(
              "invalid-structure",
              index,
              `underflow promotion from ${wrapper.type} violates destination content`,
            );
          }
        }
        applyMove(
          {
            kind: "moveBlocks",
            blockIds: promotedIds,
            sourcePlacement: {
              parentId: survivingWrapper.id,
              childIndex: 0,
            },
            destinationPlacement: {
              parentId: wrapper.parentId,
              childIndex: wrapperIndex,
            },
          },
          index,
          state,
          context,
        );
        applyRemove(
          {
            kind: "removeBlocks",
            blockIds: [wrapper.id],
            includeDescendants: true,
            expectedParents: { [wrapper.id]: wrapper.parentId },
          },
          index,
          state,
          context,
        );
        changed = true;
        break;
      }
      if (children.length === 0) {
        applyRemove(
          {
            kind: "removeBlocks",
            blockIds: [wrapper.id],
            includeDescendants: false,
            expectedParents: { [wrapper.id]: wrapper.parentId },
          },
          index,
          state,
          context,
        );
        changed = true;
        break;
      }
    }
  }
}

function assertJoinDoesNotCrossContentBoundary(
  left: VersionedBlock,
  right: VersionedBlock,
  index: number,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): void {
  const ancestors = (block: VersionedBlock): readonly BlockId[] => {
    const result: BlockId[] = [];
    let parentId = block.parentId;
    while (parentId !== null) {
      result.push(parentId);
      parentId = liveBlock(state.blocks, parentId, index).parentId;
    }
    return result;
  };
  const leftAncestors = ancestors(left);
  const rightAncestors = ancestors(right);
  const shared = new Set(rightAncestors);
  const commonAncestorId = leftAncestors.find((blockId) => shared.has(blockId));
  const crossed = new Set<BlockId>();
  for (const blockId of leftAncestors) {
    crossed.add(blockId);
    if (blockId === commonAncestorId) break;
  }
  for (const blockId of rightAncestors) {
    crossed.add(blockId);
    if (blockId === commonAncestorId) break;
  }
  for (const blockId of crossed) {
    const block = liveBlock(state.blocks, blockId, index);
    if (context.blockDefinitions[block.type]?.contentBoundary) {
      fail(
        "invalid-boundary",
        index,
        `joining ${left.id} and ${right.id} crosses ${block.type} content`,
      );
    }
  }
}

function resolveDeleteSelection(
  provisional: TransactionSelectionTarget,
  range: StructuralEditRange,
  beforeOrder: readonly BlockId[],
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): TransactionSelectionTarget {
  if (
    provisional.kind !== "none" &&
    state.blocks[provisional.blockId] &&
    !state.blocks[provisional.blockId]!.tombstone
  ) {
    return provisional;
  }
  const currentOrder = currentCanonicalOrder(state, context);
  if (currentOrder.length === 0) return { kind: "none" };
  const startIndex = Math.max(0, beforeOrder.indexOf(range.start.blockId));
  const candidates = [
    ...beforeOrder.slice(startIndex),
    ...beforeOrder.slice(0, startIndex).reverse(),
  ];
  const survivor =
    candidates.find(
      (blockId) => state.blocks[blockId] && !state.blocks[blockId]!.tombstone,
    ) ?? currentOrder[0]!;
  const definition =
    context.blockDefinitions[liveBlock(state.blocks, survivor, null).type];
  if (definition?.kind === "text") {
    return { kind: "block-start", blockId: survivor };
  }
  if (definition?.kind === "atomic") {
    return { kind: "atomic", blockId: survivor };
  }
  const leaf = currentOrder.find((blockId) => {
    const block = state.blocks[blockId]!;
    const candidate = context.blockDefinitions[block.type];
    return candidate?.kind === "text" || candidate?.kind === "atomic";
  });
  if (!leaf) return { kind: "none" };
  return context.blockDefinitions[state.blocks[leaf]!.type]?.kind === "text"
    ? { kind: "block-start", blockId: leaf }
    : { kind: "atomic", blockId: leaf };
}

function projectContentOperations(
  state: MutableTransactionState,
): readonly EditorBlockContentOperationBatch[] {
  return [...state.contentOperations]
    .filter(([blockId]) => {
      const block = state.blocks[blockId];
      return block !== undefined && !block.tombstone;
    })
    .map(([blockId, operations]) => ({ blockId, operations }));
}

function recordContentReplacement(
  block: VersionedBlock,
  before: RichTextDocumentNodeJson,
  after: RichTextDocumentNodeJson,
  state: MutableTransactionState,
): void {
  if (jsonValuesEqual(before, after)) return;
  const deletedContent = richTextBlockInlineContent(before);
  const content = richTextBlockInlineContent(after);
  const base = {
    blockId: block.id,
    blockType: block.type,
    target: { kind: "text" as const },
  };
  const range = {
    from: { blockId: block.id, offset: 0 },
    to: {
      blockId: block.id,
      offset: richTextDocumentContentSize(before),
    },
  };
  const operation: EditorLogicalContentOperation =
    deletedContent.length === 0
      ? {
          ...base,
          kind: "insertInlineContent" as const,
          position: range.from,
          content,
        }
      : content.length === 0
        ? {
            ...base,
            kind: "deleteInlineRange" as const,
            range,
            deletedContent,
          }
        : {
            ...base,
            kind: "replaceInlineRange" as const,
            range,
            content,
            deletedContent,
          };
  recordContentOperation(operation, state);
}

function recordContentOperation(
  operation: EditorLogicalContentOperation,
  state: MutableTransactionState,
): void {
  const operations = state.contentOperations.get(operation.blockId);
  if (operations) operations.push(operation);
  else state.contentOperations.set(operation.blockId, [operation]);
}

function validateSelectionTarget(
  target: TransactionSelectionTarget,
  state: MutableTransactionState,
  context: StructuralTransactionContext,
  index: number | null,
): void {
  if (target.kind === "none") return;
  const block = state.blocks[target.blockId];
  if (!block || block.tombstone)
    fail(
      "invalid-selection",
      index,
      `selection block ${target.blockId} does not exist`,
    );
  const definition = context.blockDefinitions[block.type];
  if (target.kind === "atomic") {
    if (!definition || !(definition.kind === "atomic"))
      fail(
        "invalid-selection",
        index,
        `selection block ${block.id} is not atomic`,
      );
    return;
  }
  if (target.kind !== "text-offset") return;
  if (!definition || definition.kind !== "text")
    fail(
      "invalid-selection",
      index,
      `selection block ${block.id} is not editable text`,
    );
  const stagedSize = state.contentSizes.get(block.id);
  const current =
    stagedSize === undefined
      ? readContent(state, context, block.id, block.type)
      : null;
  if (current && !isRichTextDocument(current.content))
    fail(
      "invalid-selection",
      index,
      `selection block ${block.id} has no text content`,
    );
  const size = stagedSize ?? richTextDocumentContentSize(current!.content);
  if (
    !Number.isInteger(target.offset) ||
    target.offset < 0 ||
    target.offset > size
  ) {
    fail(
      "invalid-selection",
      index,
      `selection offset for ${block.id} is invalid`,
    );
  }
}

function readContent(
  state: MutableTransactionState,
  context: StructuralTransactionContext,
  blockId: BlockId,
  blockType: BlockType,
): TransactionReadableContent {
  const staged = state.content.get(blockId);
  if (staged) return staged;
  const read = context.readContent(blockId, blockType);
  if (!read)
    fail("invalid-content", null, `content for ${blockId} is unavailable`);
  return read;
}

function liveBlock(
  blocks: Readonly<Record<BlockId, VersionedBlock>>,
  blockId: BlockId,
  operationIndex: number | null,
): VersionedBlock {
  const block = blocks[blockId];
  if (!block || block.tombstone)
    fail(
      "stale-precondition",
      operationIndex,
      `block ${blockId} does not exist`,
    );
  return block;
}

function resolveSplitOutput(
  outputId: string,
  operationIndex: number,
  state: MutableTransactionState,
): SplitTextOutput {
  const output = state.splitOutputs.get(outputId);
  if (!output) {
    fail(
      "invalid-plan",
      operationIndex,
      `split output ${outputId} is unavailable`,
    );
  }
  return output;
}

function assertPlan(plan: StructuralTransactionPlan): void {
  if (!plan.origin.trim())
    fail("invalid-plan", null, "transaction origin is required");
  if (plan.operations.length === 0)
    fail("invalid-plan", null, "transaction must contain operations");
}

export function createVersionedBlockRecordOverlay(
  base: Readonly<Record<BlockId, VersionedBlock>>,
): {
  blocks: Record<BlockId, VersionedBlock>;
  seal: () => Readonly<Record<BlockId, VersionedBlock>>;
} {
  const previous = (
    base as Readonly<Record<BlockId, VersionedBlock>> & {
      readonly [blockRecordOverlay]?: BlockRecordOverlayDescriptor;
    }
  )[blockRecordOverlay];
  const descriptor: BlockRecordOverlayDescriptor = {
    root: previous?.root ?? base,
    changed: previous ? { ...previous.changed } : {},
    removed: new Set(previous?.removed ?? []),
  };
  let sealed = false;
  let mutated = false;
  const target = Object.create(null) as Record<BlockId, VersionedBlock>;
  const blocks = new Proxy(target, {
    get: (_target, property) => {
      if (property === blockRecordOverlay) return descriptor;
      if (typeof property !== "string") return Reflect.get(target, property);
      if (descriptor.removed.has(property)) return undefined;
      return (
        descriptor.changed[property] ?? descriptor.root[property as BlockId]
      );
    },
    set: (_target, property, value) => {
      if (sealed || typeof property !== "string") return false;
      mutated = true;
      descriptor.changed[property] = value as VersionedBlock;
      descriptor.removed.delete(property);
      return true;
    },
    deleteProperty: (_target, property) => {
      if (sealed || typeof property !== "string") return false;
      mutated = true;
      delete descriptor.changed[property];
      descriptor.removed.add(property);
      return true;
    },
    has: (_target, property) =>
      typeof property === "string"
        ? !descriptor.removed.has(property) &&
          (property in descriptor.changed || property in descriptor.root)
        : Reflect.has(target, property),
    ownKeys: () => [
      ...new Set([
        ...Object.keys(descriptor.root).filter(
          (key) => !descriptor.removed.has(key),
        ),
        ...Object.keys(descriptor.changed),
      ]),
    ],
    getOwnPropertyDescriptor: (_target, property) => {
      if (typeof property !== "string" || descriptor.removed.has(property))
        return undefined;
      const value =
        descriptor.changed[property] ?? descriptor.root[property as BlockId];
      return value === undefined
        ? undefined
        : { configurable: true, enumerable: true, writable: !sealed, value };
    },
  }) as Record<BlockId, VersionedBlock>;
  return {
    blocks,
    seal: () => {
      sealed = true;
      return mutated ? blocks : base;
    },
  };
}

function assertAffectedStructure(
  state: MutableTransactionState,
  context: StructuralTransactionContext,
): void {
  for (const blockId of state.metadataOperationBlockIds) {
    const block = state.blocks[blockId];
    if (!block || block.tombstone) {
      fail(
        "invalid-plan",
        null,
        `metadata replacement target ${blockId} does not survive the transaction`,
      );
    }
  }

  for (const blockId of state.affected) {
    const block = state.blocks[blockId];
    if (!block || block.tombstone) continue;
    const definition = context.blockDefinitions[block.type];
    if (!definition) {
      fail("invalid-structure", null, `block type ${block.type} is unknown`);
    }
    const parentType =
      block.parentId === null
        ? null
        : (state.blocks[block.parentId]?.type ?? null);
    if (!blockDefinitionAcceptsParent(definition, parentType)) {
      fail(
        "invalid-structure",
        null,
        `block ${block.id} of type ${block.type} rejects direct parent ${parentType ?? "root"}`,
      );
    }
    if (block.parentId !== null) {
      const parent = state.blocks[block.parentId];
      if (!parent || parent.tombstone) {
        fail(
          "invalid-structure",
          null,
          `block ${block.id} references missing parent ${block.parentId}`,
        );
      }
    }
    const visited = new Set<BlockId>([block.id]);
    let parentId = block.parentId;
    while (parentId !== null) {
      if (visited.has(parentId)) {
        fail("invalid-structure", null, `parent cycle includes ${parentId}`);
      }
      visited.add(parentId);
      parentId = state.blocks[parentId]?.parentId ?? null;
    }
    if (definition.kind === "text") {
      if (block.contentVersion === null) {
        fail("invalid-content", null, `text block ${block.id} has no content`);
      }
      if (!state.contentOperations.has(block.id)) {
        const content = readContent(state, context, block.id, block.type);
        if (
          !isRichTextDocument(content.content) ||
          !context.validateContent(block.type, content.content)
        ) {
          fail("invalid-content", null, `content for ${block.id} is invalid`);
        }
      }
    } else if (block.contentVersion !== null || state.content.has(block.id)) {
      fail(
        "invalid-content",
        null,
        `${definition.kind} block ${block.id} must not have text content`,
      );
    }
  }

  for (const parentId of state.affectedParents) {
    if (parentId === null) {
      continue;
    }
    const childIds = currentChildIds(state, context, parentId);
    const distinctChildIds = new Set(childIds);
    if (distinctChildIds.size !== childIds.length) {
      fail(
        "invalid-structure",
        null,
        `${parentId === null ? "root containment" : `children of ${parentId}`} contains duplicate blocks`,
      );
    }
    const children = childIds.map((childId) =>
      liveBlock(state.blocks, childId, null),
    );
    for (const child of children) {
      if (child.parentId !== parentId) {
        fail(
          "invalid-structure",
          null,
          `block ${child.id} parent disagrees with its containment`,
        );
      }
      const childDefinition = context.blockDefinitions[child.type];
      const parentType =
        parentId === null ? null : (state.blocks[parentId]?.type ?? null);
      if (
        childDefinition &&
        !blockDefinitionAcceptsParent(childDefinition, parentType)
      ) {
        fail(
          "invalid-structure",
          null,
          `block ${child.id} of type ${child.type} rejects direct parent ${parentType ?? "root"}`,
        );
      }
    }
    const parent = state.blocks[parentId];
    if (!parent || parent.tombstone) continue;
    const definition = context.blockDefinitions[parent.type];
    if (!definition) {
      fail("invalid-structure", null, `block type ${parent.type} is unknown`);
    }
    const childTypes = children.map((child) => child.type);
    if (
      !blockDefinitionAcceptsSequence(
        context.blockDefinitions,
        definition,
        childTypes,
      )
    ) {
      fail(
        "invalid-structure",
        null,
        `children of ${parent.id} violate the direct ${parent.type} content definition`,
      );
    }
  }

  const metadataValidationBlockIds = new Set<BlockId>([
    ...state.affected,
    ...state.metadataOperationBlockIds,
    ...[...state.affectedParents].filter(
      (parentId): parentId is BlockId => parentId !== null,
    ),
  ]);
  for (const blockId of metadataValidationBlockIds) {
    const block = state.blocks[blockId];
    if (!block || block.tombstone) continue;
    const definition = context.blockDefinitions[block.type];
    if (!definition) continue;
    const directChildIds = definition.validateMetadata
      ? currentChildIds(state, context, block.id)
      : [];
    const metadataErrors = validateBlockMetadataForDefinitionWithChildren(
      block.metadata,
      definition,
      { blockId: block.id, directChildIds },
      `metadata for ${block.id}`,
    );
    if (metadataErrors.length > 0) {
      fail("invalid-content", null, metadataErrors.join("; "));
    }
  }
  validateSelectionTarget(state.selection, state, context, null);
}

function currentChildIds(
  state: MutableTransactionState,
  _context: StructuralTransactionContext,
  parentId: BlockId | null,
): BlockId[] {
  return [
    ...(parentId === null
      ? state.rootBlockIds
      : (state.childIdsByParentId[parentId] ?? [])),
  ];
}

function setChildIds(
  state: MutableTransactionState,
  parentId: BlockId | null,
  childIds: readonly BlockId[],
): void {
  if (parentId === null) {
    if (blockIdSequencesEqual(state.rootBlockIds, childIds)) return;
    state.rootBlockIds = blockIdSequencesEqual(state.baseRootBlockIds, childIds)
      ? state.baseRootBlockIds
      : [...childIds];
    return;
  }
  const current = state.childIdsByParentId[parentId];
  if (current && blockIdSequencesEqual(current, childIds)) return;
  const base = state.baseChildIdsByParentId[parentId];
  const next =
    base && blockIdSequencesEqual(base, childIds) ? base : [...childIds];
  state.childIdsByParentId = {
    ...state.childIdsByParentId,
    [parentId]: next,
  };
}

function deleteChildIds(
  state: MutableTransactionState,
  parentId: BlockId,
): void {
  if (!(parentId in state.childIdsByParentId)) return;
  const next = { ...state.childIdsByParentId };
  delete next[parentId];
  state.childIdsByParentId = next;
}

function sealChildIdsByParentId(
  state: MutableTransactionState,
): Readonly<Partial<Record<BlockId, readonly BlockId[]>>> {
  if (
    childSequenceRecordsEqual(
      state.childIdsByParentId,
      state.baseChildIdsByParentId,
    )
  )
    return state.baseChildIdsByParentId;
  return state.childIdsByParentId;
}

function blockIdSequencesEqual(
  left: readonly BlockId[],
  right: readonly BlockId[],
): boolean {
  return (
    left.length === right.length &&
    left.every((blockId, index) => blockId === right[index])
  );
}

function childSequenceRecordsEqual(
  left: Readonly<Partial<Record<BlockId, readonly BlockId[]>>>,
  right: Readonly<Partial<Record<BlockId, readonly BlockId[]>>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => left[key as BlockId] === right[key as BlockId])
  );
}

function currentGraph(state: MutableTransactionState) {
  return {
    blocks: state.blocks,
    rootBlockIds: state.rootBlockIds,
    childIdsByParentId: state.childIdsByParentId,
  };
}

function currentSubtreeBlockIds(
  state: MutableTransactionState,
  context: StructuralTransactionContext,
  rootId: BlockId,
): BlockId[] {
  const result: BlockId[] = [];
  const visit = (blockId: BlockId) => {
    const block = state.blocks[blockId];
    if (!block || block.tombstone) return;
    result.push(blockId);
    for (const childId of currentChildIds(state, context, blockId)) {
      visit(childId);
    }
  };
  visit(rootId);
  return result;
}

function incrementVersion(value: string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? String(numeric + 1) : "1";
}

function fail(
  failureKind: TransactionFailure["failureKind"],
  operationIndex: number | null,
  message: string,
): never {
  throw new TransactionFailure(failureKind, operationIndex, message);
}
