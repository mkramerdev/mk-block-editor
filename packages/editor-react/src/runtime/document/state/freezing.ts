import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import { jsonValuesEqual } from "@repo/editor-core/kernel";
import { normalizeBlockMetadata } from "@repo/editor-core/metadata";
import { createVersionedBlockRecordOverlay } from "@repo/editor-core/editing";
import type { EditorManifestState } from "./command-state.ts";
import { assertValidEditorSnapshotReconciliation } from "../controller/snapshot-reconciliation.ts";

export function freezeManifestState(
  manifest: EditorManifestState,
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
  previous?: EditorManifestState,
  options: {
    readonly structuralDraftAlreadyValidated?: boolean;
    readonly changedBlockIds?: readonly BlockId[];
    readonly changedParentIds?: readonly (BlockId | null)[];
  } = {},
): EditorManifestState {
  if (!options.structuralDraftAlreadyValidated) {
    assertValidEditorSnapshotReconciliation(
      {
        blockGraphVersion: manifest.blockGraphVersion,
        blocks: manifest.blocks,
        rootBlockIds: manifest.rootBlockIds,
        childIdsByParentId: manifest.childIdsByParentId,
      },
      blockDefinitions,
    );
  }
  const blocks =
    previous && options.changedBlockIds
      ? freezeChangedBlocks(
          manifest.blocks,
          previous.blocks,
          options.changedBlockIds,
        )
      : freezeAllBlocks(manifest.blocks, previous?.blocks);
  const rootBlockIds =
    previous &&
    blockIdSequencesEqual(manifest.rootBlockIds, previous.rootBlockIds)
      ? previous.rootBlockIds
      : freezeReadonlyArray(manifest.rootBlockIds);
  const childIdsByParentId = shareChildSequenceReferences(
    manifest.childIdsByParentId,
    previous?.childIdsByParentId,
    options.changedParentIds,
  );
  return Object.freeze({
    ...manifest,
    blocks,
    rootBlockIds,
    childIdsByParentId,
  });
}

function freezeChangedBlocks(
  next: Readonly<Record<BlockId, VersionedBlock>>,
  previous: Readonly<Record<BlockId, VersionedBlock>>,
  changedBlockIds: readonly BlockId[],
): Record<BlockId, VersionedBlock> {
  const overlay = createVersionedBlockRecordOverlay(previous);
  for (const blockId of new Set(changedBlockIds)) {
    const block = next[blockId];
    if (!block) {
      delete overlay.blocks[blockId];
      continue;
    }
    const normalized = freezeBlock(block);
    overlay.blocks[blockId] = jsonValuesEqual(previous[blockId], normalized)
      ? previous[blockId]!
      : normalized;
  }
  return overlay.seal() as Record<BlockId, VersionedBlock>;
}

function freezeAllBlocks(
  next: Readonly<Record<BlockId, VersionedBlock>>,
  previous: Readonly<Record<BlockId, VersionedBlock>> | undefined,
): Record<BlockId, VersionedBlock> {
  const candidate = Object.fromEntries(
    (Object.entries(next) as [BlockId, VersionedBlock][]).map(
      ([blockId, block]) => {
        const normalized = freezeBlock(block);
        return [
          blockId,
          previous?.[blockId] && jsonValuesEqual(previous[blockId], normalized)
            ? previous[blockId]
            : normalized,
        ] as const;
      },
    ),
  ) as Record<BlockId, VersionedBlock>;
  return previous && recordReferencesEqual(candidate, previous)
    ? (previous as Record<BlockId, VersionedBlock>)
    : Object.freeze(candidate);
}

function freezeBlock(block: VersionedBlock): VersionedBlock {
  const metadata = normalizeBlockMetadata(block.metadata);
  const normalized: VersionedBlock = { ...block };
  if (metadata === undefined) delete normalized.metadata;
  else normalized.metadata = Object.freeze(metadata);
  return Object.freeze(normalized);
}

function shareChildSequenceReferences(
  next: EditorManifestState["childIdsByParentId"],
  previous: EditorManifestState["childIdsByParentId"] | undefined,
  changedParentIds: readonly (BlockId | null)[] | undefined,
): EditorManifestState["childIdsByParentId"] {
  if (previous && changedParentIds) {
    const overlay = createChildSequenceRecordOverlay(previous);
    for (const parentId of new Set(changedParentIds)) {
      if (parentId === null) continue;
      const childIds = next[parentId];
      if (childIds === undefined) {
        if (previous[parentId] !== undefined) delete overlay.record[parentId];
        continue;
      }
      const current = previous[parentId];
      if (current && blockIdSequencesEqual(childIds, current)) continue;
      overlay.record[parentId] = freezeReadonlyArray(childIds);
    }
    return overlay.seal();
  }
  const entries = Object.entries(next).map(([parentId, childIds]) => {
    const current = previous?.[parentId as BlockId];
    return [
      parentId,
      current && blockIdSequencesEqual(childIds ?? [], current)
        ? current
        : freezeReadonlyArray(childIds ?? []),
    ] as const;
  });
  const candidate = Object.fromEntries(
    entries,
  ) as EditorManifestState["childIdsByParentId"];
  return previous && recordReferencesEqual(candidate, previous)
    ? previous
    : Object.freeze(candidate);
}

interface ChildSequenceRecordOverlayDescriptor {
  readonly root: EditorManifestState["childIdsByParentId"];
  readonly changed: Partial<Record<BlockId, readonly BlockId[]>>;
  readonly removed: Set<BlockId>;
}

const childSequenceRecordOverlay = Symbol("childSequenceRecordOverlay");

function createChildSequenceRecordOverlay(
  base: EditorManifestState["childIdsByParentId"],
): {
  readonly record: Partial<Record<BlockId, readonly BlockId[]>>;
  readonly seal: () => EditorManifestState["childIdsByParentId"];
} {
  const previous = (
    base as EditorManifestState["childIdsByParentId"] & {
      readonly [childSequenceRecordOverlay]?: ChildSequenceRecordOverlayDescriptor;
    }
  )[childSequenceRecordOverlay];
  const descriptor: ChildSequenceRecordOverlayDescriptor = {
    root: previous?.root ?? base,
    changed: previous ? { ...previous.changed } : {},
    removed: new Set(previous?.removed ?? []),
  };
  let sealed = false;
  let mutated = false;
  const target = Object.create(null) as Partial<
    Record<BlockId, readonly BlockId[]>
  >;
  const record = new Proxy(target, {
    get: (_target, property) => {
      if (property === childSequenceRecordOverlay) return descriptor;
      if (typeof property !== "string") return Reflect.get(target, property);
      if (descriptor.removed.has(property as BlockId)) return undefined;
      return (
        descriptor.changed[property as BlockId] ??
        descriptor.root[property as BlockId]
      );
    },
    set: (_target, property, value) => {
      if (sealed || typeof property !== "string") return false;
      mutated = true;
      descriptor.changed[property as BlockId] = value as readonly BlockId[];
      descriptor.removed.delete(property as BlockId);
      return true;
    },
    deleteProperty: (_target, property) => {
      if (sealed || typeof property !== "string") return false;
      mutated = true;
      delete descriptor.changed[property as BlockId];
      descriptor.removed.add(property as BlockId);
      return true;
    },
    has: (_target, property) =>
      typeof property === "string"
        ? !descriptor.removed.has(property as BlockId) &&
          (property in descriptor.changed || property in descriptor.root)
        : Reflect.has(target, property),
    ownKeys: () => [
      ...new Set([
        ...Object.keys(descriptor.root).filter(
          (key) => !descriptor.removed.has(key as BlockId),
        ),
        ...Object.keys(descriptor.changed),
      ]),
    ],
    getOwnPropertyDescriptor: (_target, property) => {
      if (
        typeof property !== "string" ||
        descriptor.removed.has(property as BlockId)
      ) {
        return undefined;
      }
      const value =
        descriptor.changed[property as BlockId] ??
        descriptor.root[property as BlockId];
      return value === undefined
        ? undefined
        : { configurable: true, enumerable: true, writable: !sealed, value };
    },
  });
  return {
    record,
    seal: () => {
      sealed = true;
      return mutated ? record : base;
    },
  };
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

function recordReferencesEqual<T>(
  left: Readonly<Record<string, T>>,
  right: Readonly<Record<string, T>>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => left[key] === right[key])
  );
}

export function freezeReadonlyArray<T>(value: readonly T[]): readonly T[] {
  return Object.isFrozen(value) ? value : Object.freeze([...value]);
}
