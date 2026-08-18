import type { VersionedBlock } from "@repo/editor-core/document";
import { jsonValuesEqual, type BlockId } from "@repo/editor-core/kernel";
import type { EditorCommandState } from "../state/command-state.ts";
import { blocksEquivalent, sameBlockIdList } from "./manifest-query.ts";

export interface EditorDocumentCanonicalChanges {
  readonly updatedBlockIds: readonly BlockId[];
  readonly removedBlockIds: readonly BlockId[];
  readonly contentChangedBlockIds: readonly BlockId[];
  readonly metadataChangedBlockIds: readonly BlockId[];
  readonly typeChangedBlockIds: readonly BlockId[];
}

export interface EditorDocumentContainerSequenceChanges {
  readonly changedParentIds: readonly (BlockId | null)[];
}

export type EditorDocumentSelectionChange =
  | { readonly kind: "none" }
  | { readonly kind: "refresh"; readonly affectedBlockIds: readonly BlockId[] };

export interface EditorDocumentUpdate {
  readonly canonical: EditorDocumentCanonicalChanges;
  readonly containerSequences: EditorDocumentContainerSequenceChanges;
  readonly selection: EditorDocumentSelectionChange;
}

export interface ClassifyEditorDocumentUpdateOptions {
  readonly previousState: EditorCommandState;
  readonly nextState: EditorCommandState;
  readonly candidateBlockIds?: readonly BlockId[];
  readonly contentChangedBlockIds?: readonly BlockId[];
}

const EMPTY_BLOCK_IDS = Object.freeze([]) as readonly BlockId[];
const EMPTY_PARENT_IDS = Object.freeze([]) as readonly (BlockId | null)[];
const NO_SELECTION_CHANGE: EditorDocumentSelectionChange = Object.freeze({
  kind: "none",
});

export const EMPTY_EDITOR_DOCUMENT_UPDATE: EditorDocumentUpdate = Object.freeze(
  {
    canonical: Object.freeze({
      updatedBlockIds: EMPTY_BLOCK_IDS,
      removedBlockIds: EMPTY_BLOCK_IDS,
      contentChangedBlockIds: EMPTY_BLOCK_IDS,
      metadataChangedBlockIds: EMPTY_BLOCK_IDS,
      typeChangedBlockIds: EMPTY_BLOCK_IDS,
    }),
    containerSequences: Object.freeze({ changedParentIds: EMPTY_PARENT_IDS }),
    selection: NO_SELECTION_CHANGE,
  },
);

export function classifyEditorDocumentUpdate({
  previousState,
  nextState,
  candidateBlockIds,
  contentChangedBlockIds = EMPTY_BLOCK_IDS,
}: ClassifyEditorDocumentUpdateOptions): EditorDocumentUpdate {
  const candidates = collectCandidateBlockIds(
    previousState,
    nextState,
    candidateBlockIds,
    contentChangedBlockIds,
  );
  const canonicalUpdated = new Set<BlockId>();
  const canonicalRemoved = new Set<BlockId>();
  const contentChanged = new Set<BlockId>();
  const metadataChanged = new Set<BlockId>();
  const typeChanged = new Set<BlockId>();
  const structuralParents = new Set<BlockId | null>();
  const parentShapeChanged = new Set<BlockId>();
  const selectionAffected = new Set<BlockId>();

  for (const blockId of contentChangedBlockIds) {
    if (liveBlock(nextState.blocks, blockId)) contentChanged.add(blockId);
  }

  for (const blockId of candidates) {
    const previousRecord = previousState.blocks[blockId];
    const nextRecord = nextState.blocks[blockId];
    const previousBlock = liveRecord(previousRecord);
    const nextBlock = liveRecord(nextRecord);

    if (previousBlock && !nextBlock) {
      canonicalRemoved.add(blockId);
      structuralParents.add(previousBlock.parentId ?? null);
      selectionAffected.add(blockId);
      parentShapeChanged.add(blockId);
      continue;
    }

    if (!previousBlock && nextBlock) {
      canonicalUpdated.add(blockId);
      structuralParents.add(nextBlock.parentId ?? null);
      selectionAffected.add(blockId);
      parentShapeChanged.add(blockId);
      continue;
    }

    if (!previousBlock || !nextBlock) continue;
    if (!blocksEquivalent(previousRecord, nextRecord))
      canonicalUpdated.add(blockId);
    if (previousBlock.contentVersion !== nextBlock.contentVersion)
      contentChanged.add(blockId);
    if (metadataInputsDiffer(previousBlock, nextBlock))
      metadataChanged.add(blockId);
    if (previousBlock.type !== nextBlock.type) {
      typeChanged.add(blockId);
      parentShapeChanged.add(blockId);
    }
    if (
      selectionInputsDiffer(
        previousBlock,
        nextBlock,
        previousState.blocks,
        nextState.blocks,
      )
    ) {
      selectionAffected.add(blockId);
    }
    if ((previousBlock.parentId ?? null) !== (nextBlock.parentId ?? null)) {
      structuralParents.add(previousBlock.parentId ?? null);
      structuralParents.add(nextBlock.parentId ?? null);
    }
  }

  if (!sameBlockIdList(previousState.rootBlockIds, nextState.rootBlockIds)) {
    structuralParents.add(null);
  }
  const sequenceParentIds = new Set<BlockId>();
  if (candidateBlockIds) {
    for (const blockId of candidates) {
      sequenceParentIds.add(blockId);
      const previousParentId = previousState.blocks[blockId]?.parentId;
      const nextParentId = nextState.blocks[blockId]?.parentId;
      if (previousParentId) sequenceParentIds.add(previousParentId);
      if (nextParentId) sequenceParentIds.add(nextParentId);
    }
  } else {
    for (const parentId of Object.keys(
      previousState.childIdsByParentId,
    ) as BlockId[]) {
      sequenceParentIds.add(parentId);
    }
    for (const parentId of Object.keys(
      nextState.childIdsByParentId,
    ) as BlockId[]) {
      sequenceParentIds.add(parentId);
    }
  }
  for (const parentId of sequenceParentIds) {
    if (
      !sameBlockIdList(
        previousState.childIdsByParentId[parentId] ?? EMPTY_BLOCK_IDS,
        nextState.childIdsByParentId[parentId] ?? EMPTY_BLOCK_IDS,
      )
    ) {
      structuralParents.add(parentId);
    }
  }
  const readPreviousChildIds = (parentId: BlockId | null) =>
    readChildIds(previousState, parentId);
  for (const parentId of parentShapeChanged) {
    for (const childId of readPreviousChildIds(parentId)) {
      if (!liveBlock(nextState.blocks, childId)) continue;
      selectionAffected.add(childId);
    }
  }

  const changedParentIds: Array<BlockId | null> = [];
  for (const parentId of sortParentIds(structuralParents)) {
    const previousIds = readPreviousChildIds(parentId);
    const nextIds = readChildIds(nextState, parentId);
    if (!sameBlockIdList(previousIds, nextIds)) changedParentIds.push(parentId);
  }

  const updatedBlockIds = freezeBlockIds(canonicalUpdated);
  const removedBlockIds = freezeBlockIds(canonicalRemoved);
  const frozenContentChanged = freezeBlockIds(contentChanged);
  const frozenMetadataChanged = freezeBlockIds(metadataChanged);
  const frozenTypeChanged = freezeBlockIds(typeChanged);
  const frozenChangedParentIds = freezeParentIds(changedParentIds);
  const frozenSelectionAffected = freezeBlockIds(selectionAffected);

  if (
    updatedBlockIds.length === 0 &&
    removedBlockIds.length === 0 &&
    frozenContentChanged.length === 0 &&
    frozenMetadataChanged.length === 0 &&
    frozenTypeChanged.length === 0 &&
    frozenChangedParentIds.length === 0 &&
    frozenSelectionAffected.length === 0
  ) {
    return EMPTY_EDITOR_DOCUMENT_UPDATE;
  }

  return Object.freeze({
    canonical: Object.freeze({
      updatedBlockIds,
      removedBlockIds,
      contentChangedBlockIds: frozenContentChanged,
      metadataChangedBlockIds: frozenMetadataChanged,
      typeChangedBlockIds: frozenTypeChanged,
    }),
    containerSequences: Object.freeze({
      changedParentIds: frozenChangedParentIds,
    }),
    selection:
      frozenSelectionAffected.length === 0
        ? NO_SELECTION_CHANGE
        : Object.freeze({
            kind: "refresh",
            affectedBlockIds: frozenSelectionAffected,
          }),
  });
}

export function editorDocumentUpdateHasChanges(
  update: EditorDocumentUpdate,
): boolean {
  return (
    update.canonical.updatedBlockIds.length > 0 ||
    update.canonical.removedBlockIds.length > 0 ||
    update.canonical.contentChangedBlockIds.length > 0 ||
    update.canonical.metadataChangedBlockIds.length > 0 ||
    update.canonical.typeChangedBlockIds.length > 0 ||
    update.containerSequences.changedParentIds.length > 0 ||
    update.selection.kind === "refresh"
  );
}

function collectCandidateBlockIds(
  previousState: EditorCommandState,
  nextState: EditorCommandState,
  candidateBlockIds: readonly BlockId[] | undefined,
  contentChangedBlockIds: readonly BlockId[],
): readonly BlockId[] {
  const candidates = new Set<BlockId>();
  if (previousState.blocks !== nextState.blocks) {
    if (candidateBlockIds) {
      for (const blockId of candidateBlockIds) candidates.add(blockId);
    } else {
      for (const blockId of Object.keys(previousState.blocks) as BlockId[])
        candidates.add(blockId);
      for (const blockId of Object.keys(nextState.blocks) as BlockId[])
        candidates.add(blockId);
    }
  }
  for (const blockId of contentChangedBlockIds) candidates.add(blockId);
  return [...candidates].sort(compareBlockIds);
}

function metadataInputsDiffer(
  previous: VersionedBlock,
  next: VersionedBlock,
): boolean {
  return (
    previous.metadataVersion !== next.metadataVersion ||
    !jsonValuesEqual(previous.metadata ?? null, next.metadata ?? null)
  );
}

function selectionInputsDiffer(
  previous: VersionedBlock,
  next: VersionedBlock,
  previousBlocks: Readonly<Record<BlockId, VersionedBlock>>,
  nextBlocks: Readonly<Record<BlockId, VersionedBlock>>,
): boolean {
  return (
    previous.type !== next.type ||
    (previous.parentId ?? null) !== (next.parentId ?? null) ||
    !jsonValuesEqual(previous.metadata ?? null, next.metadata ?? null) ||
    parentBlockType(previous, previousBlocks) !==
      parentBlockType(next, nextBlocks)
  );
}

function parentBlockType(
  block: VersionedBlock,
  blocks: Readonly<Record<BlockId, VersionedBlock>>,
): VersionedBlock["type"] | null {
  const parent = block.parentId ? liveBlock(blocks, block.parentId) : null;
  return parent?.type ?? null;
}

function readChildIds(
  state: EditorCommandState,
  parentId: BlockId | null,
): readonly BlockId[] {
  return parentId === null
    ? state.rootBlockIds
    : (state.childIdsByParentId[parentId] ?? EMPTY_BLOCK_IDS);
}

function liveRecord(block: VersionedBlock | undefined): VersionedBlock | null {
  return block && !block.tombstone ? block : null;
}

function liveBlock(
  blocks: Readonly<Record<BlockId, VersionedBlock>>,
  blockId: BlockId,
): VersionedBlock | null {
  return liveRecord(blocks[blockId]);
}

function compareBlockIds(left: BlockId, right: BlockId): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sortParentIds(
  parentIds: ReadonlySet<BlockId | null>,
): readonly (BlockId | null)[] {
  return [...parentIds].sort((left, right) => {
    if (left === right) return 0;
    if (left === null) return -1;
    if (right === null) return 1;
    return compareBlockIds(left, right);
  });
}

function freezeBlockIds(blockIds: Iterable<BlockId>): readonly BlockId[] {
  const result = [...new Set(blockIds)].sort(compareBlockIds);
  return result.length === 0 ? EMPTY_BLOCK_IDS : Object.freeze(result);
}

function freezeParentIds(
  parentIds: Iterable<BlockId | null>,
): readonly (BlockId | null)[] {
  const result = sortParentIds(new Set(parentIds));
  return result.length === 0 ? EMPTY_PARENT_IDS : Object.freeze([...result]);
}
