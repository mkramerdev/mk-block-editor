"use client";

import {
  blockDefinitionAcceptsParent,
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
  commitCanonicalBlockCreationAtPlacement,
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

export interface EditorBlockExactInsertion {
  readonly placement: BlockPlacement;
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

export interface EditorBlockPositionMove {
  readonly blockId: BlockId;
  /** A canonical boundary in the document before the block is removed. */
  readonly position: BlockPlacement;
  readonly selection?: EditorTransactionSelectionEffect;
}

export interface EditorBlockOperations {
  insertBlock(insertion: EditorBlockInsertion): EditorBlockOperationResult;
  insertBlockAt(insertion: EditorBlockExactInsertion): EditorBlockOperationResult;
  replaceBlock(replacement: EditorBlockReplacement): EditorBlockOperationResult;
  deleteBlock(deletion: EditorBlockDeletion): EditorBlockOperationResult;
  duplicateBlock(
    duplication: EditorBlockDuplication,
  ): EditorBlockOperationResult;
  moveBlock(movement: EditorBlockMove): EditorBlockOperationResult;
  moveBlockToPosition(
    movement: EditorBlockPositionMove,
  ): EditorBlockOperationResult;
}

export type EditorWithBlockOperations = EditableEditor & EditorBlockOperations;

type BlockDefinitions = Readonly<Record<BlockType, BlockDefinition>>;

const methodNames = [
  "insertBlock",
  "insertBlockAt",
  "replaceBlock",
  "deleteBlock",
  "duplicateBlock",
  "moveBlock",
  "moveBlockToPosition",
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
    insertBlockAt: (insertion) =>
      executeExactCreation(editor, blockDefinitions, insertion),
    replaceBlock: (replacement) =>
      executeCreation(editor, blockDefinitions, replacement, "replace"),
    deleteBlock: (deletion) =>
      executeDeletion(editor, blockDefinitions, deletion),
    duplicateBlock: (duplication) =>
      executeDuplication(editor, blockDefinitions, duplication),
    moveBlock: (movement) =>
      executeMovement(editor, blockDefinitions, movement),
    moveBlockToPosition: (movement) =>
      executePositionMovement(editor, blockDefinitions, movement),
  };
  defineBlockOperationMethods(editor, methods);
  enrichedEditors.add(editor);
  return editor;
}

function executeExactCreation(
  editor: EditableEditor,
  blockDefinitions: BlockDefinitions,
  input: EditorBlockExactInsertion,
): EditorBlockOperationResult {
  if (
    !input ||
    typeof input.blockType !== "string" ||
    !blockDefinitions[input.blockType]
  ) {
    return invalidInput("The requested block type is unavailable.");
  }
  const placement = input.placement;
  if (
    !placement ||
    (placement.parentId !== null && typeof placement.parentId !== "string") ||
    !Number.isInteger(placement.childIndex) ||
    placement.childIndex < 0
  ) {
    return invalidInput("The insertion placement is invalid.");
  }
  if (placement.parentId !== null) {
    const parent = editor.getBlock(placement.parentId);
    if (!isLiveKnownBlock(blockDefinitions, parent)) {
      return invalidInput("The insertion parent is unavailable.");
    }
    if (blockDefinitions[parent.type]?.kind !== "wrapper") {
      return invalidInput("The insertion parent does not accept child blocks.");
    }
  }
  const siblingCount = readDirectBlockIds(editor, placement.parentId).length;
  if (placement.childIndex > siblingCount) {
    return invalidInput("The insertion placement is invalid.");
  }
  const result = commitCanonicalBlockCreationAtPlacement({
    editor,
    graphRevision: editor.getDiagnostics().blockGraphVersion,
    blockDefinitions,
    placement,
    blockType: input.blockType,
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
    : result.transactionAttempted
      ? rejectedTransaction(result.message)
      : invalidInput(result.message);
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
  const deletedIds = collectSubtreeIds(editor, block.id);
  const fallback = resolveDeleteFallbackSelection(
    editor,
    blockDefinitions,
    deletedIds,
  );
  const result = editor.transaction(() => {
    editor.deleteBlocks({
      blockIds: [block.id],
      includeDescendants: true,
      expectedParents: {
        [block.id]: block.parentId,
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
  const result = editor.transaction(() => {
    editor.moveBlocks({
      blockIds: [source.id],
      destination: input.destination,
    });
    editor.setTransactionSelection(
      input.selection ??
        selectionForExistingBlock(editor, blockDefinitions, source, 0),
    );
  });
  return transactionResult(result);
}

function executePositionMovement(
  editor: EditableEditor,
  blockDefinitions: BlockDefinitions,
  input: EditorBlockPositionMove,
): EditorBlockOperationResult {
  const source = input?.blockId ? editor.getBlock(input.blockId) : null;
  if (!isLiveKnownBlock(blockDefinitions, source)) {
    return invalidInput(`Block ${input?.blockId ?? ""} is unavailable.`);
  }
  const position = input.position;
  if (
    !position ||
    !Number.isInteger(position.childIndex) ||
    position.childIndex < 0
  ) {
    return invalidInput("The destination position is invalid.");
  }
  const sourceSiblings = readDirectBlockIds(editor, source.parentId);
  const sourceIndex = sourceSiblings.indexOf(source.id);
  if (sourceIndex < 0) return stalePlan("The source boundary is stale.");

  let destinationSiblings: readonly BlockId[];
  if (position.parentId === null) {
    destinationSiblings = editor.getRootBlockIds();
  } else {
    const destinationParent = editor.getBlock(position.parentId);
    if (!isLiveKnownBlock(blockDefinitions, destinationParent)) {
      return invalidInput("The destination parent is unavailable.");
    }
    if (isBlockOrDescendant(editor, position.parentId, source.id)) {
      return invalidInput("A block cannot be moved into its own subtree.");
    }
    destinationSiblings = editor.getChildBlockIds(position.parentId);
  }
  if (position.childIndex > destinationSiblings.length) {
    return invalidInput("The destination position is invalid.");
  }

  const destinationIndex =
    source.parentId === position.parentId && sourceIndex < position.childIndex
      ? position.childIndex - 1
      : position.childIndex;
  if (
    source.parentId === position.parentId &&
    destinationIndex === sourceIndex
  ) {
    return noChange();
  }
  if (
    !acceptsMove(
      editor,
      blockDefinitions,
      source,
      sourceSiblings,
      position.parentId,
      destinationSiblings,
      destinationIndex,
    )
  ) {
    return invalidInput("The destination parent does not accept this block.");
  }

  const result = editor.transaction(() => {
    editor.moveBlocks({
      blockIds: [source.id],
      destination: {
        parentId: position.parentId,
        childIndex: destinationIndex,
      },
    });
    editor.setTransactionSelection(
      input.selection ??
        selectionForExistingBlock(editor, blockDefinitions, source, 0),
    );
  });
  return transactionResult(result);
}

function isBlockOrDescendant(
  editor: EditableEditor,
  blockId: BlockId,
  possibleAncestorId: BlockId,
): boolean {
  let currentId: BlockId | null = blockId;
  const visited = new Set<BlockId>();
  while (currentId !== null) {
    if (currentId === possibleAncestorId) return true;
    if (visited.has(currentId)) return true;
    visited.add(currentId);
    currentId = editor.getParentId(currentId);
  }
  return false;
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
  if (destinationParentId === null) {
    return blockDefinitionAcceptsParent(blockDefinitions[source.type]!, null);
  }
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
