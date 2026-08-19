import {
  INITIAL_BLOCK_GRAPH_VERSION,
  assertValidBlockGraphVersion,
} from "@repo/editor-core/document";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import { createInitialEditorSessionState } from "../../../store/session-state.ts";
import type { EditorSessionState } from "../../../store/contracts.ts";

export interface EditorManifestState {
  readonly blockGraphVersion: number;
  readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface EditorCommandState extends EditorSessionState {
  readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
  readonly rootBlockIds: readonly BlockId[];
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
}

export function createInitialEditorManifestState(options: {
  blockGraphVersion?: number;
  blocks?: Readonly<Record<BlockId, VersionedBlock>>;
  rootBlockIds?: readonly BlockId[];
  childIdsByParentId?: Readonly<Partial<Record<BlockId, readonly BlockId[]>>>;
  createdAt?: number;
  updatedAt?: number;
}): EditorManifestState {
  const blockGraphVersion =
    options.blockGraphVersion ?? INITIAL_BLOCK_GRAPH_VERSION;
  assertValidBlockGraphVersion(blockGraphVersion);
  return {
    blockGraphVersion,
    blocks: requiredOption(options.blocks, "blocks"),
    rootBlockIds: requiredOption(options.rootBlockIds, "rootBlockIds"),
    childIdsByParentId: requiredOption(
      options.childIdsByParentId,
      "childIdsByParentId",
    ),
    createdAt: options.createdAt ?? Date.now(),
    updatedAt: options.updatedAt ?? Date.now(),
  };
}

export function createInitialEditorCommandState(options: {
  blockGraphVersion?: number;
  blocks?: Readonly<Record<BlockId, VersionedBlock>>;
  rootBlockIds?: readonly BlockId[];
  childIdsByParentId?: Readonly<Partial<Record<BlockId, readonly BlockId[]>>>;
  createdAt?: number;
  updatedAt?: number;
}): EditorCommandState {
  const blocks = requiredOption(options.blocks, "blocks");
  return createEditorCommandState(
    createInitialEditorSessionState(options),
    createInitialEditorManifestState({
      blockGraphVersion: options.blockGraphVersion,
      blocks,
      rootBlockIds: options.rootBlockIds,
      childIdsByParentId: options.childIdsByParentId,
      createdAt: options.createdAt,
      updatedAt: options.updatedAt,
    }),
  );
}

export function createEditorCommandState(
  session: EditorSessionState,
  manifest: EditorManifestState,
): EditorCommandState {
  return {
    ...session,
    blockGraphVersion: manifest.blockGraphVersion,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    blocks: manifest.blocks,
    rootBlockIds: manifest.rootBlockIds,
    childIdsByParentId: manifest.childIdsByParentId,
  };
}

export function splitEditorCommandState(state: EditorCommandState): {
  session: EditorSessionState;
  manifest: EditorManifestState;
} {
  const { blocks, rootBlockIds, childIdsByParentId, ...sessionFields } = state;
  return {
    session: sessionFields,
    manifest: {
      blockGraphVersion: state.blockGraphVersion,
      blocks,
      rootBlockIds,
      childIdsByParentId,
      createdAt: state.createdAt,
      updatedAt: state.updatedAt,
    },
  };
}

function requiredOption<T>(value: T | undefined, name: string): T {
  if (value === undefined)
    throw new Error(`editor command state requires ${name}`);
  return value;
}
