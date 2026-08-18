"use client";

import {
  blockDefinitionAcceptsSequence,
  type BlockDefinition,
} from "@repo/editor-core/definitions";
import type {
  Block,
  BlockType,
  VersionedBlock,
} from "@repo/editor-core/document";
import {
  duplicateCanonicalBlockSubtrees,
  materializeCanonicalBlockCreation,
  type BlockPlacement,
} from "@repo/editor-core/editing";
import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import type { BlockId, JsonObject } from "@repo/editor-core/kernel";
import type {
  EditableEditor,
  EditorTransactionSelectionEffect,
} from "../runtime/document/contracts.ts";
import {
  commitCanonicalBlockCreation,
  readDirectBlockIds,
  readPublicEditorGraph,
} from "./canonical-block-insertion.ts";

export type EditorBlockOperationFailureReason =
  | "invalid-input"
  | "stale-plan"
  | "no-change"
  | "transaction-rejected";

export type EditorBlockOperationResult =
  | {
      readonly ok: true;
      readonly handled: true;
      readonly transaction: Extract<
        ReturnType<EditableEditor["transaction"]>,
        { readonly ok: true; readonly changed: true }
      >;
    }
  | {
      readonly ok: false;
      readonly handled: boolean;
      readonly reason: EditorBlockOperationFailureReason;
      readonly message?: string;
    };

export interface EditorBlockInsertion {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly metadata?: JsonObject;
  readonly defaultContentCount?: number;
  readonly content?: RichTextDocumentNodeJson;
  readonly plainText?: string;
  readonly createBlockId?: () => BlockId;
  readonly selection?: boolean | EditorTransactionSelectionEffect;
}

export type EditorBlockReplacement = EditorBlockInsertion;

export interface EditorBlockDeletion {
  readonly blockId: BlockId;
}

export interface EditorBlockDuplication {
  readonly blockId: BlockId;
  readonly destination?: BlockPlacement;
  readonly selection?: EditorTransactionSelectionEffect;
}

export interface EditorBlockMove {
  readonly blockId: BlockId;
  readonly destination: BlockPlacement;
  readonly selection?: EditorTransactionSelectionEffect;
}

export interface EditorBlockIndentation {
  readonly blockId: BlockId;
  readonly offset: number;
}

export interface EditorBlockOperations {
  insertBlock(insertion: EditorBlockInsertion): EditorBlockOperationResult;
  replaceBlock(replacement: EditorBlockReplacement): EditorBlockOperationResult;
  deleteBlock(deletion: EditorBlockDeletion): EditorBlockOperationResult;
  duplicateBlock(
    duplication: EditorBlockDuplication,
  ): EditorBlockOperationResult;
  moveBlock(movement: EditorBlockMove): EditorBlockOperationResult;
  indentBlock(indentation: EditorBlockIndentation): EditorBlockOperationResult;
  outdentBlock(indentation: EditorBlockIndentation): EditorBlockOperationResult;
}

export type EditorWithBlockOperations = EditableEditor & EditorBlockOperations;

type BlockDefinitions = Readonly<Record<BlockType, BlockDefinition>>;

const methodNames = [
  "insertBlock",
  "replaceBlock",
  "deleteBlock",
  "duplicateBlock",
  "moveBlock",
  "indentBlock",
  "outdentBlock",
] as const satisfies readonly (keyof EditorBlockOperations)[];

const enrichedEditors = new WeakSet<EditableEditor>();

export function addEditorBlockOperations<TEditor extends EditableEditor>(
  editor: TEditor,
): TEditor & EditorBlockOperations {
  if (enrichedEditors.has(editor))
    return editor as TEditor & EditorBlockOperations;
  if (!Object.isExtensible(editor)) {
    throw new Error("Block operations require an extensible editor instance.");
  }
  for (const methodName of methodNames) {
    if (Reflect.has(editor, methodName)) {
      throw new Error(
        `Cannot install block operations because ${methodName} already exists.`,
      );
    }
  }
  const blockDefinitions = editor.definition.blocks;
  const methods: EditorBlockOperations = {
    insertBlock: (insertion) =>
      executeCreation(editor, blockDefinitions, insertion, "after"),
    replaceBlock: (replacement) =>
      executeCreation(editor, blockDefinitions, replacement, "replace"),
    deleteBlock: (deletion) =>
      executeDeletion(editor, blockDefinitions, deletion),
    duplicateBlock: (duplication) =>
      executeDuplication(editor, blockDefinitions, duplication),
    moveBlock: (movement) =>
      executeMovement(editor, blockDefinitions, movement),
    indentBlock: (indentation) =>
      executeIndentation(editor, blockDefinitions, indentation, "indent"),
    outdentBlock: (indentation) =>
      executeIndentation(editor, blockDefinitions, indentation, "outdent"),
  };
  defineBlockOperationMethods(editor, methods);
  enrichedEditors.add(editor);
  return editor;
}

function defineBlockOperationMethods<TEditor extends EditableEditor>(
  editor: TEditor,
  methods: EditorBlockOperations,
): asserts editor is TEditor & EditorBlockOperations {
  Object.defineProperties(
    editor,
    Object.fromEntries(
      methodNames.map((methodName) => [
        methodName,
        {
          value: methods[methodName],
          enumerable: false,
          configurable: false,
          writable: false,
        },
      ]),
    ),
  );
}

function executeCreation(
  editor: EditableEditor,
  blockDefinitions: BlockDefinitions,
  input: EditorBlockInsertion | EditorBlockReplacement,
  placement: "after" | "replace",
): EditorBlockOperationResult {
  if (
    !input ||
    typeof input.blockType !== "string" ||
    !blockDefinitions[input.blockType]
  ) {
    return invalidInput("The requested block type is unavailable.");
  }
  const source = editor.getBlock(input.blockId);
  const sourceDefinition = source ? blockDefinitions[source.type] : undefined;
  const targetDefinition = blockDefinitions[input.blockType];
  if (source && sourceDefinition && targetDefinition) {
    if (
      sourceDefinition.list?.kind === "item" &&
      targetDefinition.list?.kind === "item"
    ) {
      return convertCanonicalListType(
        editor,
        blockDefinitions,
        source,
        targetDefinition.list.containerType,
        input.blockType,
      );
    }
    if (
      sourceDefinition.kind === "text" &&
      targetDefinition.list?.kind === "item"
    ) {
      return wrapTextInCanonicalList(
        editor,
        blockDefinitions,
        source,
        targetDefinition.list.containerType,
        input.blockType,
      );
    }
    if (
      sourceDefinition.list?.kind === "item" &&
      targetDefinition.kind === "text" &&
      input.blockType === sourceDefinition.list.primaryTextChildType
    ) {
      return liftPrimaryParagraphFromList(editor, blockDefinitions, source);
    }
  }
  const result = commitCanonicalBlockCreation({
    editor,
    graphRevision: editor.getDiagnostics().blockGraphVersion,
    blockDefinitions,
    targetBlockId: input.blockId,
    blockType: input.blockType,
    placement,
    ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    ...(input.defaultContentCount === undefined
      ? {}
      : { defaultContentCount: input.defaultContentCount }),
    ...(input.content === undefined ? {} : { content: input.content }),
    ...(input.plainText === undefined ? {} : { plainText: input.plainText }),
    ...(input.createBlockId === undefined
      ? {}
      : { createBlockId: input.createBlockId }),
    selection:
      input.selection === true
        ? "created"
        : input.selection === false || input.selection === undefined
          ? { kind: "preserve" }
          : input.selection,
  });
  return result.ok
    ? accepted(result.transaction)
    : rejectedTransaction(result.message);
}

function executeDeletion(
  editor: EditableEditor,
  blockDefinitions: BlockDefinitions,
  input: EditorBlockDeletion,
): EditorBlockOperationResult {
  const block = input?.blockId ? editor.getBlock(input.blockId) : null;
  if (!isLiveKnownBlock(blockDefinitions, block)) {
    return invalidInput(`Block ${input?.blockId ?? ""} is unavailable.`);
  }
  const itemPolicy = blockDefinitions[block.type]?.list;
  const parent = block.parentId ? editor.getBlock(block.parentId) : null;
  const parentPolicy = parent ? blockDefinitions[parent.type]?.list : undefined;
  const deletionRoot =
    itemPolicy?.kind === "item" &&
    parent &&
    !parent.tombstone &&
    parentPolicy?.kind === "container" &&
    editor.getChildBlockIds(parent.id).length === 1
      ? parent
      : block;
  const deletedIds = collectSubtreeIds(editor, deletionRoot.id);
  const fallback = resolveDeleteFallbackSelection(
    editor,
    blockDefinitions,
    deletedIds,
  );
  const result = editor.transaction(() => {
    editor.deleteBlocks({
      blockIds: [deletionRoot.id],
      includeDescendants: true,
      expectedParents: {
        [deletionRoot.id]: deletionRoot.parentId,
      },
    });
    editor.setTransactionSelection(
      fallback
        ? selectionForBlock(blockDefinitions, fallback, 0)
        : { kind: "clear" },
    );
  });
  return transactionResult(result);
}

function convertCanonicalListType(
  editor: EditableEditor,
  blockDefinitions: BlockDefinitions,
  sourceItem: VersionedBlock,
  targetContainerType: BlockType,
  targetItemType: BlockType,
): EditorBlockOperationResult {
  if (sourceItem.parentId === null) return noChange();
  const sourceList = editor.getBlock(sourceItem.parentId);
  const sourcePolicy = sourceList
    ? blockDefinitions[sourceList.type]?.list
    : undefined;
  const targetPolicy = blockDefinitions[targetContainerType]?.list;
  if (
    !sourceList ||
    sourceList.tombstone ||
    sourcePolicy?.kind !== "container" ||
    targetPolicy?.kind !== "container" ||
    targetPolicy.itemType !== targetItemType
  ) {
    return noChange();
  }
  const itemIds = editor.getChildBlockIds(sourceList.id);
  if (
    itemIds.some((itemId) => {
      const item = editor.getBlock(itemId);
      return !item || item.tombstone || item.type !== sourcePolicy.itemType;
    })
  ) {
    return stalePlan("The canonical list item sequence is stale.");
  }
  const result = editor.transaction(() => {
    editor.replaceBlockTypes([
      { blockId: sourceList.id, blockType: targetContainerType },
      ...itemIds.map((blockId) => ({
        blockId,
        blockType: targetItemType,
        ...(blockDefinitions[targetItemType]?.conversion?.metadata ===
        "target-defaults"
          ? {
              metadata:
                blockDefinitions[targetItemType]?.defaultMetadata ?? null,
            }
          : {}),
      })),
    ]);
    editor.setTransactionSelection({ kind: "preserve" });
  });
  return transactionResult(result);
}

function wrapTextInCanonicalList(
  editor: EditableEditor,
  blockDefinitions: BlockDefinitions,
  paragraph: VersionedBlock,
  containerType: BlockType,
  itemType: BlockType,
): EditorBlockOperationResult {
  const siblings = readDirectBlockIds(editor, paragraph.parentId);
  const paragraphIndex = siblings.indexOf(paragraph.id);
  if (paragraphIndex < 0) return stalePlan("The paragraph boundary is stale.");
  let creation: ReturnType<typeof materializeCanonicalBlockCreation>;
  try {
    creation = materializeCanonicalBlockCreation({
      blockDefinitions,
      type: containerType,
      reservedBlockIds: new Set(collectCanonicalOrder(editor)),
    });
  } catch (error) {
    return invalidInput(error instanceof Error ? error.message : String(error));
  }
  const item = creation.fragment.blocks.find(
    (record) =>
      record.parentId === creation.rootBlockId && record.type === itemType,
  );
  const placeholder = item
    ? creation.fragment.blocks.find((record) => record.parentId === item.id)
    : null;
  if (!item || !placeholder)
    return invalidInput(
      "The canonical list minimum could not be materialized.",
    );
  const result = editor.transaction(() => {
    editor.insertBlocks(
      { parentId: paragraph.parentId, childIndex: paragraphIndex + 1 },
      creation.fragment,
    );
    editor.moveBlocks({
      blockIds: [paragraph.id],
      destination: { parentId: item.id, childIndex: 1 },
    });
    editor.deleteBlocks({
      blockIds: [placeholder.id],
      includeDescendants: true,
      expectedParents: { [placeholder.id]: item.id },
    });
    editor.setTransactionSelection({
      kind: "text",
      blockId: paragraph.id,
      offset: 0,
    });
  });
  return transactionResult(result);
}

function liftPrimaryParagraphFromList(
  editor: EditableEditor,
  blockDefinitions: BlockDefinitions,
  sourceItem: VersionedBlock,
): EditorBlockOperationResult {
  if (sourceItem.parentId === null) return noChange();
  const itemChildren = editor.getChildBlockIds(sourceItem.id);
  if (itemChildren.length !== 1) return noChange();
  const paragraph = editor.getBlock(itemChildren[0]!);
  const itemPolicy = blockDefinitions[sourceItem.type]?.list;
  const list = editor.getBlock(sourceItem.parentId);
  const listPolicy = list ? blockDefinitions[list.type]?.list : undefined;
  if (
    !paragraph ||
    paragraph.tombstone ||
    itemPolicy?.kind !== "item" ||
    paragraph.type !== itemPolicy.primaryTextChildType ||
    !list ||
    list.tombstone ||
    listPolicy?.kind !== "container"
  ) {
    return stalePlan("The canonical list boundary is stale.");
  }
  const items = editor.getChildBlockIds(list.id);
  const itemIndex = items.indexOf(sourceItem.id);
  const listSiblings = readDirectBlockIds(editor, list.parentId);
  const listIndex = listSiblings.indexOf(list.id);
  if (itemIndex < 0 || listIndex < 0)
    return stalePlan("The canonical list placement is stale.");

  let temporaryParagraph: ReturnType<typeof materializeCanonicalBlockCreation>;
  try {
    temporaryParagraph = materializeCanonicalBlockCreation({
      blockDefinitions,
      type: paragraph.type,
      reservedBlockIds: new Set(collectCanonicalOrder(editor)),
    });
  } catch (error) {
    return invalidInput(error instanceof Error ? error.message : String(error));
  }
  const leading = items.slice(0, itemIndex);
  const trailing = items.slice(itemIndex + 1);
  let trailingList: ReturnType<
    typeof materializeCanonicalBlockCreation
  > | null = null;
  let trailingPlaceholder: BlockId | null = null;
  if (leading.length > 0 && trailing.length > 0) {
    try {
      trailingList = materializeCanonicalBlockCreation({
        blockDefinitions,
        type: list.type,
        reservedBlockIds: new Set([
          ...collectCanonicalOrder(editor),
          ...temporaryParagraph.fragment.blocks.map((record) => record.id),
        ]),
      });
    } catch (error) {
      return invalidInput(
        error instanceof Error ? error.message : String(error),
      );
    }
    trailingPlaceholder =
      trailingList.fragment.blocks.find(
        (record) => record.parentId === trailingList!.rootBlockId,
      )?.id ?? null;
    if (!trailingPlaceholder)
      return invalidInput("The trailing canonical list has no required item.");
  }

  const result = editor.transaction(() => {
    if (trailingList && trailingPlaceholder) {
      editor.insertBlocks(
        { parentId: list.parentId, childIndex: listIndex + 1 },
        trailingList.fragment,
      );
      editor.moveBlocks({
        blockIds: trailing,
        destination: { parentId: trailingList.rootBlockId, childIndex: 1 },
      });
      editor.deleteBlocks({
        blockIds: [trailingPlaceholder],
        includeDescendants: true,
        expectedParents: {
          [trailingPlaceholder]: trailingList.rootBlockId,
        },
      });
    }
    editor.insertBlocks(
      { parentId: sourceItem.id, childIndex: 1 },
      temporaryParagraph.fragment,
    );
    editor.moveBlocks({
      blockIds: [paragraph.id],
      destination: {
        parentId: list.parentId,
        childIndex: listIndex + (itemIndex === 0 ? 0 : 1),
      },
    });
    if (items.length === 1) {
      editor.deleteBlocks({
        blockIds: [list.id],
        includeDescendants: true,
        expectedParents: { [list.id]: list.parentId },
      });
    } else {
      editor.deleteBlocks({
        blockIds: [sourceItem.id],
        includeDescendants: true,
        expectedParents: { [sourceItem.id]: list.id },
      });
    }
    editor.setTransactionSelection({
      kind: "text",
      blockId: paragraph.id,
      offset: 0,
    });
  });
  return transactionResult(result);
}

function executeDuplication(
  editor: EditableEditor,
  blockDefinitions: BlockDefinitions,
  input: EditorBlockDuplication,
): EditorBlockOperationResult {
  const source = input?.blockId ? editor.getBlock(input.blockId) : null;
  if (!isLiveKnownBlock(blockDefinitions, source)) {
    return invalidInput(`Block ${input?.blockId ?? ""} is unavailable.`);
  }
  const siblings = readDirectBlockIds(editor, source.parentId);
  const sourceIndex = siblings.indexOf(source.id);
  if (sourceIndex < 0) return stalePlan("The source boundary is stale.");
  let fragment;
  try {
    const graph = readPublicEditorGraph(editor);
    fragment = duplicateCanonicalBlockSubtrees({
      ...graph,
      rootBlockIds: [source.id],
      blockDefinitions,
      readContent: (blockId, blockType) =>
        editor.readBlockContent(blockId, blockType),
    });
  } catch (error) {
    return invalidInput(error instanceof Error ? error.message : String(error));
  }
  const destination = input.destination ?? {
    parentId: source.parentId,
    childIndex: sourceIndex + 1,
  };
  const result = editor.transaction(() => {
    editor.insertBlocks(destination, fragment);
    editor.setTransactionSelection(
      input.selection ?? selectionForFragment(blockDefinitions, fragment),
    );
  });
  return transactionResult(result);
}

function executeMovement(
  editor: EditableEditor,
  blockDefinitions: BlockDefinitions,
  input: EditorBlockMove,
): EditorBlockOperationResult {
  const source = input?.blockId ? editor.getBlock(input.blockId) : null;
  if (!isLiveKnownBlock(blockDefinitions, source)) {
    return invalidInput(`Block ${input?.blockId ?? ""} is unavailable.`);
  }
  const itemPolicy = blockDefinitions[source.type]?.list;
  const sourceList = source.parentId ? editor.getBlock(source.parentId) : null;
  const removeSourceList =
    itemPolicy?.kind === "item" &&
    sourceList &&
    !sourceList.tombstone &&
    input.destination.parentId !== sourceList.id &&
    editor.getChildBlockIds(sourceList.id).length === 1;
  const result = editor.transaction(() => {
    editor.moveBlocks({
      blockIds: [source.id],
      destination: input.destination,
    });
    if (removeSourceList) {
      editor.deleteBlocks({
        blockIds: [sourceList.id],
        includeDescendants: true,
        expectedParents: { [sourceList.id]: sourceList.parentId },
      });
    }
    editor.setTransactionSelection(
      input.selection ??
        selectionForExistingBlock(editor, blockDefinitions, source, 0),
    );
  });
  return transactionResult(result);
}

function executeIndentation(
  editor: EditableEditor,
  blockDefinitions: BlockDefinitions,
  input: EditorBlockIndentation,
  direction: "indent" | "outdent",
): EditorBlockOperationResult {
  const source = input?.blockId ? editor.getBlock(input.blockId) : null;
  if (!isLiveKnownBlock(blockDefinitions, source)) {
    return invalidInput(`Block ${input?.blockId ?? ""} is unavailable.`);
  }
  const sourceSiblings = readDirectBlockIds(editor, source.parentId);
  const sourceIndex = sourceSiblings.indexOf(source.id);
  if (sourceIndex < 0) return stalePlan("The source boundary is stale.");

  const sourceDefinition = blockDefinitions[source.type];
  if (sourceDefinition?.list?.kind === "item") {
    return executeListItemIndentation(
      editor,
      blockDefinitions,
      source,
      sourceSiblings,
      sourceIndex,
      input.offset,
      direction,
    );
  }

  let destinationParentId: BlockId | null;
  let destinationSiblings: readonly BlockId[];
  let destinationIndex: number;
  if (direction === "indent") {
    const previousId = sourceSiblings[sourceIndex - 1];
    const previous = previousId ? editor.getBlock(previousId) : null;
    const previousDefinition = previous
      ? blockDefinitions[previous.type]
      : undefined;
    if (
      !previous ||
      previous.tombstone ||
      previousDefinition?.kind !== "wrapper" ||
      previousDefinition.content?.additional === undefined
    ) {
      return noChange();
    }
    destinationParentId = previous.id;
    destinationSiblings = editor.getChildBlockIds(previous.id);
    destinationIndex = destinationSiblings.length;
  } else {
    if (source.parentId === null) return noChange();
    const parent = editor.getBlock(source.parentId);
    if (!parent || parent.tombstone || parent.parentId === source.id) {
      return stalePlan("The parent boundary is stale.");
    }
    destinationParentId = parent.parentId;
    destinationSiblings = readDirectBlockIds(editor, parent.parentId);
    const parentIndex = destinationSiblings.indexOf(parent.id);
    if (parentIndex < 0) return stalePlan("The parent boundary is stale.");
    destinationIndex = parentIndex + 1;
  }

  if (
    !acceptsMove(
      editor,
      blockDefinitions,
      source,
      sourceSiblings,
      destinationParentId,
      destinationSiblings,
      destinationIndex,
    )
  ) {
    return noChange();
  }
  const adjustedDestinationIndex =
    source.parentId === destinationParentId && sourceIndex < destinationIndex
      ? destinationIndex - 1
      : destinationIndex;
  const result = editor.transaction(() => {
    editor.moveBlocks({
      blockIds: [source.id],
      destination: {
        parentId: destinationParentId,
        childIndex: adjustedDestinationIndex,
      },
    });
    editor.setTransactionSelection(
      selectionForExistingBlock(editor, blockDefinitions, source, input.offset),
    );
  });
  return transactionResult(result);
}

function executeListItemIndentation(
  editor: EditableEditor,
  blockDefinitions: BlockDefinitions,
  source: VersionedBlock,
  sourceSiblings: readonly BlockId[],
  sourceIndex: number,
  offset: number,
  direction: "indent" | "outdent",
): EditorBlockOperationResult {
  const itemPolicy = blockDefinitions[source.type]?.list;
  if (itemPolicy?.kind !== "item" || source.parentId === null)
    return noChange();
  const sourceList = editor.getBlock(source.parentId);
  const sourceListPolicy = sourceList
    ? blockDefinitions[sourceList.type]?.list
    : undefined;
  if (
    !sourceList ||
    sourceList.tombstone ||
    sourceListPolicy?.kind !== "container" ||
    sourceListPolicy.itemType !== source.type
  )
    return stalePlan("The canonical list boundary is stale.");

  if (direction === "indent") {
    const previousId = sourceSiblings[sourceIndex - 1];
    let previous = previousId ? editor.getBlock(previousId) : null;
    if (!previous && sourceIndex === 0) {
      const listSiblings = readDirectBlockIds(editor, sourceList.parentId);
      const sourceListIndex = listSiblings.indexOf(sourceList.id);
      const previousListId = listSiblings[sourceListIndex - 1];
      const previousList = previousListId
        ? editor.getBlock(previousListId)
        : null;
      const previousListPolicy = previousList
        ? blockDefinitions[previousList.type]?.list
        : undefined;
      const ownerId =
        previousList && previousListPolicy?.kind === "container"
          ? editor.getChildBlockIds(previousList.id).at(-1)
          : null;
      previous = ownerId ? editor.getBlock(ownerId) : null;
    }
    const previousPolicy = previous
      ? blockDefinitions[previous.type]?.list
      : undefined;
    if (!previous || previous.tombstone || previousPolicy?.kind !== "item")
      return noChange();
    const removeSourceList = sourceSiblings.length === 1;
    const previousChildren = editor.getChildBlockIds(previous.id);
    const compatibleNestedId = [...previousChildren]
      .reverse()
      .find((childId) => editor.getBlock(childId)?.type === sourceList.type);
    if (compatibleNestedId) {
      const nestedChildren = editor.getChildBlockIds(compatibleNestedId);
      const result = editor.transaction(() => {
        editor.moveBlocks({
          blockIds: [source.id],
          destination: {
            parentId: compatibleNestedId,
            childIndex: nestedChildren.length,
          },
        });
        if (removeSourceList) {
          editor.deleteBlocks({
            blockIds: [sourceList.id],
            includeDescendants: true,
            expectedParents: { [sourceList.id]: sourceList.parentId },
          });
        }
        editor.setTransactionSelection(
          selectionForExistingBlock(editor, blockDefinitions, source, offset),
        );
      });
      return transactionResult(result);
    }

    let creation: ReturnType<typeof materializeCanonicalBlockCreation>;
    try {
      creation = materializeCanonicalBlockCreation({
        blockDefinitions,
        type: sourceList.type,
        reservedBlockIds: new Set(collectCanonicalOrder(editor)),
      });
    } catch (error) {
      return invalidInput(
        error instanceof Error ? error.message : String(error),
      );
    }
    const nestedListId = creation.rootBlockId;
    const placeholderItem = creation.fragment.blocks.find(
      (record) =>
        record.parentId === nestedListId && record.type === source.type,
    );
    if (!placeholderItem)
      return invalidInput(
        "The list definition did not create its required item.",
      );
    const result = editor.transaction(() => {
      editor.insertBlocks(
        { parentId: previous.id, childIndex: previousChildren.length },
        creation.fragment,
      );
      editor.deleteBlocks({
        blockIds: [placeholderItem.id],
        includeDescendants: true,
        expectedParents: { [placeholderItem.id]: nestedListId },
      });
      editor.moveBlocks({
        blockIds: [source.id],
        destination: { parentId: nestedListId, childIndex: 0 },
      });
      if (removeSourceList) {
        editor.deleteBlocks({
          blockIds: [sourceList.id],
          includeDescendants: true,
          expectedParents: { [sourceList.id]: sourceList.parentId },
        });
      }
      editor.setTransactionSelection(
        selectionForExistingBlock(editor, blockDefinitions, source, offset),
      );
    });
    return transactionResult(result);
  }

  if (sourceList.parentId === null) return noChange();
  const ownerItem = editor.getBlock(sourceList.parentId);
  if (!ownerItem || ownerItem.tombstone || ownerItem.parentId === null)
    return noChange();
  const outerList = editor.getBlock(ownerItem.parentId);
  const outerPolicy = outerList
    ? blockDefinitions[outerList.type]?.list
    : undefined;
  if (!outerList || outerList.tombstone || outerPolicy?.kind !== "container")
    return noChange();
  const outerItems = editor.getChildBlockIds(outerList.id);
  const ownerIndex = outerItems.indexOf(ownerItem.id);
  if (ownerIndex < 0)
    return stalePlan("The containing list boundary is stale.");
  const removeNestedList = sourceSiblings.length === 1;
  if (outerPolicy.itemType !== source.type) {
    if (ownerIndex !== outerItems.length - 1) return noChange();
    const outerSiblings = readDirectBlockIds(editor, outerList.parentId);
    const outerIndex = outerSiblings.indexOf(outerList.id);
    if (outerIndex < 0)
      return stalePlan("The containing list placement is stale.");
    let promotedList: ReturnType<typeof materializeCanonicalBlockCreation>;
    try {
      promotedList = materializeCanonicalBlockCreation({
        blockDefinitions,
        type: sourceList.type,
        reservedBlockIds: new Set(collectCanonicalOrder(editor)),
      });
    } catch (error) {
      return invalidInput(
        error instanceof Error ? error.message : String(error),
      );
    }
    const placeholder = promotedList.fragment.blocks.find(
      (record) => record.parentId === promotedList.rootBlockId,
    );
    if (!placeholder)
      return invalidInput("The promoted canonical list has no required item.");
    const result = editor.transaction(() => {
      editor.insertBlocks(
        { parentId: outerList.parentId, childIndex: outerIndex + 1 },
        promotedList.fragment,
      );
      editor.deleteBlocks({
        blockIds: [placeholder.id],
        includeDescendants: true,
        expectedParents: { [placeholder.id]: promotedList.rootBlockId },
      });
      editor.moveBlocks({
        blockIds: [source.id],
        destination: { parentId: promotedList.rootBlockId, childIndex: 0 },
      });
      if (removeNestedList) {
        editor.deleteBlocks({
          blockIds: [sourceList.id],
          includeDescendants: true,
          expectedParents: { [sourceList.id]: ownerItem.id },
        });
      }
      editor.setTransactionSelection(
        selectionForExistingBlock(editor, blockDefinitions, source, offset),
      );
    });
    return transactionResult(result);
  }
  const result = editor.transaction(() => {
    editor.moveBlocks({
      blockIds: [source.id],
      destination: { parentId: outerList.id, childIndex: ownerIndex + 1 },
    });
    if (removeNestedList) {
      editor.deleteBlocks({
        blockIds: [sourceList.id],
        includeDescendants: true,
        expectedParents: { [sourceList.id]: ownerItem.id },
      });
    }
    editor.setTransactionSelection(
      selectionForExistingBlock(editor, blockDefinitions, source, offset),
    );
  });
  return transactionResult(result);
}

function acceptsMove(
  editor: EditableEditor,
  blockDefinitions: BlockDefinitions,
  source: VersionedBlock,
  sourceSiblings: readonly BlockId[],
  destinationParentId: BlockId | null,
  destinationSiblings: readonly BlockId[],
  destinationIndex: number,
): boolean {
  const sourceRemainingTypes = sourceSiblings
    .filter((blockId) => blockId !== source.id)
    .map((blockId) => editor.getBlock(blockId)?.type)
    .filter((type): type is BlockType => type !== undefined);
  if (source.parentId !== null) {
    const parent = editor.getBlock(source.parentId);
    const definition = parent ? blockDefinitions[parent.type] : undefined;
    if (
      !definition ||
      !blockDefinitionAcceptsSequence(
        blockDefinitions,
        definition,
        sourceRemainingTypes,
      )
    ) {
      return false;
    }
  }
  if (destinationParentId === null) return true;
  const parent = editor.getBlock(destinationParentId);
  const definition = parent ? blockDefinitions[parent.type] : undefined;
  if (!definition) return false;
  const types = destinationSiblings
    .filter((blockId) => blockId !== source.id)
    .map((blockId) => editor.getBlock(blockId)?.type)
    .filter((type): type is BlockType => type !== undefined);
  types.splice(Math.min(destinationIndex, types.length), 0, source.type);
  return blockDefinitionAcceptsSequence(blockDefinitions, definition, types);
}

function resolveDeleteFallbackSelection(
  editor: EditableEditor,
  blockDefinitions: BlockDefinitions,
  deletedIds: readonly BlockId[],
): VersionedBlock | null {
  const deleted = new Set(deletedIds);
  const order = collectCanonicalOrder(editor);
  const indexes = deletedIds
    .map((blockId) => order.indexOf(blockId))
    .filter((index) => index >= 0);
  if (indexes.length === 0) return null;
  const first = Math.min(...indexes);
  const last = Math.max(...indexes);
  for (let index = first - 1; index >= 0; index -= 1) {
    const target = resolveEditableTarget(
      editor,
      blockDefinitions,
      order[index]!,
      deleted,
    );
    if (target) return target;
  }
  for (let index = last + 1; index < order.length; index += 1) {
    const target = resolveEditableTarget(
      editor,
      blockDefinitions,
      order[index]!,
      deleted,
    );
    if (target) return target;
  }
  return null;
}

function resolveEditableTarget(
  editor: EditableEditor,
  blockDefinitions: BlockDefinitions,
  blockId: BlockId,
  excluded: ReadonlySet<BlockId>,
): VersionedBlock | null {
  if (excluded.has(blockId)) return null;
  const block = editor.getBlock(blockId);
  if (!isLiveKnownBlock(blockDefinitions, block)) return null;
  const definition = blockDefinitions[block.type]!;
  if (definition.kind === "text" || definition.kind === "atomic") return block;
  for (const childId of editor.getChildBlockIds(block.id)) {
    const target = resolveEditableTarget(
      editor,
      blockDefinitions,
      childId,
      excluded,
    );
    if (target) return target;
  }
  return null;
}

function collectCanonicalOrder(editor: EditableEditor): readonly BlockId[] {
  const result: BlockId[] = [];
  const visit = (blockId: BlockId): void => {
    result.push(blockId);
    for (const childId of editor.getChildBlockIds(blockId)) visit(childId);
  };
  for (const rootId of editor.getRootBlockIds()) visit(rootId);
  return result;
}

function collectSubtreeIds(
  editor: EditableEditor,
  rootId: BlockId,
): readonly BlockId[] {
  const result: BlockId[] = [];
  const visit = (blockId: BlockId): void => {
    result.push(blockId);
    for (const childId of editor.getChildBlockIds(blockId)) visit(childId);
  };
  visit(rootId);
  return result;
}

function selectionForBlock(
  blockDefinitions: BlockDefinitions,
  block: Block,
  offset: number,
): EditorTransactionSelectionEffect {
  return blockDefinitions[block.type]?.kind === "text"
    ? { kind: "text", blockId: block.id, offset }
    : { kind: "block", blockId: block.id };
}

function selectionForExistingBlock(
  editor: EditableEditor,
  blockDefinitions: BlockDefinitions,
  block: VersionedBlock,
  offset: number,
): EditorTransactionSelectionEffect {
  const definition = blockDefinitions[block.type];
  if (definition?.kind === "text" || definition?.kind === "atomic") {
    return selectionForBlock(blockDefinitions, block, offset);
  }
  const target = resolveEditableTarget(
    editor,
    blockDefinitions,
    block.id,
    new Set(),
  );
  return target
    ? selectionForBlock(blockDefinitions, target, offset)
    : { kind: "preserve" };
}

function selectionForFragment(
  blockDefinitions: BlockDefinitions,
  fragment: ReturnType<typeof duplicateCanonicalBlockSubtrees>,
): EditorTransactionSelectionEffect {
  const boundary = fragment.start;
  const block = fragment.blocks.find(
    (record) => record.id === boundary.blockId,
  );
  if (block) {
    const definition = blockDefinitions[block.type];
    if (definition?.kind === "text") {
      return { kind: "text", blockId: block.id, offset: 0 };
    }
    if (definition?.kind === "atomic") {
      return { kind: "block", blockId: block.id };
    }
    const descendant = fragment.blocks.find((record) => {
      const candidate = blockDefinitions[record.type];
      return candidate?.kind === "text" || candidate?.kind === "atomic";
    });
    if (descendant) {
      return blockDefinitions[descendant.type]?.kind === "text"
        ? { kind: "text", blockId: descendant.id, offset: 0 }
        : { kind: "block", blockId: descendant.id };
    }
  }
  return { kind: "preserve" };
}

function isLiveKnownBlock(
  blockDefinitions: BlockDefinitions,
  block: Block | null | undefined,
): block is VersionedBlock {
  return Boolean(
    block && !block.tombstone && blockDefinitions[block.type] !== undefined,
  );
}

function transactionResult(
  result: ReturnType<EditableEditor["transaction"]>,
): EditorBlockOperationResult {
  if (result.ok && result.changed) return accepted(result);
  if (result.ok) return noChange();
  return (result.phase === "validation" &&
    result.failure?.failureKind === "stale-precondition") ||
    (result.phase === "commit" && result.message.includes("document changed"))
    ? stalePlan(result.message)
    : rejectedTransaction(result.message);
}

function accepted(
  transaction: Extract<
    ReturnType<EditableEditor["transaction"]>,
    { readonly ok: true; readonly changed: true }
  >,
): EditorBlockOperationResult {
  return { ok: true, handled: true, transaction };
}

function invalidInput(message: string): EditorBlockOperationResult {
  return { ok: false, handled: false, reason: "invalid-input", message };
}

function stalePlan(message: string): EditorBlockOperationResult {
  return { ok: false, handled: true, reason: "stale-plan", message };
}

function noChange(): EditorBlockOperationResult {
  return {
    ok: false,
    handled: false,
    reason: "no-change",
    message: "The operation would not change the document.",
  };
}

function rejectedTransaction(message: string): EditorBlockOperationResult {
  return {
    ok: false,
    handled: true,
    reason: "transaction-rejected",
    message,
  };
}
