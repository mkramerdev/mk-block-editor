import type { EditorInstanceSnapshot } from "@repo/editor-core/codecs";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { BlockSelectionModel } from "@repo/editor-core/selection";
import {
  contentSelection,
  wholeSelection,
  wrapperSelection,
} from "@repo/editor-core/selection";
import type {
  AppliedContentCommit,
  ValidatedContentCommit,
} from "@repo/editor-core/operations";
import {
  createSelectionController,
  type SelectionController,
} from "@repo/editor-react/selection";
import type { CanonicalContentResources } from "../content/canonical-resources.ts";
import type { EditorContentRuntime } from "@repo/editor-core/content";
import type { ReadEditorDefinition } from "../definition/contracts.ts";
import type { CompiledCanonicalEditorDefinition } from "../definition/compiled-editor-definition.ts";
import type { EditorDiagnostics, ReadEditor } from "./contracts.ts";
import { materializeVersionedEditorBlocks } from "./snapshot-initialization.ts";
import type { EditorDocumentGeometryOwner } from "../../document/geometry/editor-document-geometry.ts";
import {
  createRemoteTransactionCoordinator,
  type RemoteCanonicalState,
  type RemoteTransactionCoordinator,
} from "../collaboration/remote-transaction-coordinator.ts";
import type {
  RemoteEditorTransaction,
  RemoteTransactionResult,
} from "../collaboration/contracts.ts";

const noop = () => undefined;

interface ReadEditorGraphChanges {
  readonly changedBlockIds: readonly BlockId[];
  readonly rootsChanged: boolean;
  readonly changedChildParentIds: readonly BlockId[];
  readonly directChildParentIds: readonly BlockId[];
}

/**
 * Canonical graph/read projection runtime. It owns the same local selection
 * foundation as the editable editor, without editing or remote selection.
 */
export class ReadEditorImplementation implements ReadEditor {
  declare readonly editable: false;
  readonly selectionController: SelectionController =
    createSelectionController();
  readonly selection = this.selectionController.canonical;
  readonly selectionPaint = this.selectionController.localPaint;
  readonly geometry;
  readonly geometryRegistration;
  readonly DocumentRuntimeMount = null;
  private blocks: Readonly<Record<BlockId, VersionedBlock>>;
  private rootBlockIds: readonly BlockId[];
  private childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
  private blockGraphVersion: number;
  private disposed = false;
  private readonly blockListeners = new Map<BlockId, Set<() => void>>();
  private readonly rootListeners = new Set<() => void>();
  private readonly childListeners = new Map<BlockId, Set<() => void>>();
  private readonly directChildBlocksByParentId = new Map<
    BlockId,
    readonly VersionedBlock[]
  >();
  private readonly directChildListeners = new Map<BlockId, Set<() => void>>();
  private readonly cleanups: (() => void)[] = [];
  private readonly remoteTransactions: RemoteTransactionCoordinator;

  constructor(
    readonly definition: ReadEditorDefinition,
    snapshot: EditorInstanceSnapshot,
    readonly contentResources: CanonicalContentResources,
    readonly contentRuntime: EditorContentRuntime,
    private readonly geometryOwner: EditorDocumentGeometryOwner,
    readonly compiledDefinition: CompiledCanonicalEditorDefinition,
  ) {
    Object.defineProperty(this, "editable", {
      value: false,
      writable: false,
      configurable: false,
      enumerable: true,
    });
    this.geometry = geometryOwner.reader;
    this.geometryRegistration = geometryOwner.registration;
    this.blockGraphVersion = snapshot.blockGraphVersion;
    this.blocks = materializeVersionedEditorBlocks(
      snapshot.blocks,
      snapshot.blockGraphVersion,
      definition.blocks,
    );
    this.rootBlockIds = Object.freeze([...snapshot.rootBlockIds]);
    this.childIdsByParentId = freezeChildSequences(snapshot.childIdsByParentId);
    this.remoteTransactions = createRemoteTransactionCoordinator({
      host: this,
    });
  }

  getBlock(blockId: BlockId): VersionedBlock | null {
    return this.blocks[blockId] ?? null;
  }

  getParentId(blockId: BlockId): BlockId | null {
    return this.blocks[blockId]?.parentId ?? null;
  }

  getRootBlockIds(): readonly BlockId[] {
    return this.rootBlockIds;
  }

  getChildBlockIds(parentId: BlockId): readonly BlockId[] {
    return this.childIdsByParentId[parentId] ?? emptyBlockIds;
  }

  getDirectChildBlocks(parentId: BlockId): readonly VersionedBlock[] {
    const cached = this.directChildBlocksByParentId.get(parentId);
    if (cached) return cached;
    const result: VersionedBlock[] = [];
    for (const childId of this.getChildBlockIds(parentId)) {
      const block = this.blocks[childId];
      if (block && !block.tombstone && block.parentId === parentId) {
        result.push(block);
      }
    }
    const snapshot = Object.freeze(result);
    this.directChildBlocksByParentId.set(parentId, snapshot);
    return snapshot;
  }

  getLastChildBlockId(parentId: BlockId | null): BlockId | null {
    const ids =
      parentId === null
        ? this.rootBlockIds
        : (this.childIdsByParentId[parentId] ?? emptyBlockIds);
    return ids.at(-1) ?? null;
  }

  readBlockContent(blockId: BlockId, blockType: BlockType) {
    return this.contentRuntime.readBlockProjection(blockId, blockType);
  }

  readBlockPlainText(blockId: BlockId, blockType: BlockType): string {
    return this.contentRuntime.readBlockPlainText(blockId, blockType);
  }

  readBlockSelectionModel(blockId: BlockId): BlockSelectionModel | null {
    const block = this.getBlock(blockId);
    if (!block || block.tombstone) return null;
    const definition = this.definition.blocks[block.type];
    if (!definition) return null;
    return (
      definition.selection ??
      (definition.kind === "text"
        ? contentSelection()
        : definition.kind === "atomic"
          ? wholeSelection()
          : wrapperSelection())
    );
  }

  getSelectionGraphRevision(): number {
    return this.blockGraphVersion;
  }

  subscribeBlock(blockId: BlockId, listener: () => void): () => void {
    if (this.disposed) return noop;
    const listeners = this.blockListeners.get(blockId) ?? new Set<() => void>();
    listeners.add(listener);
    this.blockListeners.set(blockId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.blockListeners.delete(blockId);
    };
  }

  subscribeRootBlockIds(listener: () => void): () => void {
    if (this.disposed) return noop;
    this.rootListeners.add(listener);
    return () => this.rootListeners.delete(listener);
  }

  subscribeChildBlockIds(parentId: BlockId, listener: () => void): () => void {
    if (this.disposed) return noop;
    const listeners =
      this.childListeners.get(parentId) ?? new Set<() => void>();
    listeners.add(listener);
    this.childListeners.set(parentId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.childListeners.delete(parentId);
    };
  }

  subscribeDirectChildBlocks(
    parentId: BlockId,
    listener: () => void,
  ): () => void {
    if (this.disposed) return noop;
    const listeners =
      this.directChildListeners.get(parentId) ?? new Set<() => void>();
    listeners.add(listener);
    this.directChildListeners.set(parentId, listeners);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      listeners.delete(listener);
      if (listeners.size === 0) this.directChildListeners.delete(parentId);
    };
  }

  applyRemoteTransaction(
    transaction: RemoteEditorTransaction,
  ): RemoteTransactionResult {
    return this.remoteTransactions.applyRemoteTransaction(transaction);
  }

  readRemoteCanonicalState(): RemoteCanonicalState {
    return {
      blockGraphVersion: this.blockGraphVersion,
      blocks: this.blocks,
      rootBlockIds: this.rootBlockIds,
      childIdsByParentId: this.childIdsByParentId,
    };
  }

  commitValidatedRemoteTransaction(input: {
    readonly nextState: RemoteCanonicalState;
    readonly validatedContent: ValidatedContentCommit;
    readonly changedBlockIds: readonly BlockId[];
    readonly contentChangedBlockIds: readonly BlockId[];
    readonly afterCanonicalStateInstalled: () => void;
  }): number {
    this.requireLive();
    const previous = this.readRemoteCanonicalState();
    let applied: AppliedContentCommit | null = null;
    try {
      applied = this.contentRuntime.commitContent(input.validatedContent);
      this.installGraph(input.nextState);
      const graphChanges = this.prepareGraphChanges(previous);
      input.afterCanonicalStateInstalled();
      this.contentRuntime.publishContentCommit(applied);
      this.notifyGraphChanges(graphChanges);
      return this.blockGraphVersion;
    } catch (error) {
      if (applied) {
        this.contentRuntime.markInconsistent(
          `Remote canonical installation failed after live content mutation: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      this.installGraph(previous);
      throw error;
    }
  }

  getDiagnostics(): EditorDiagnostics {
    return {
      blockGraphVersion: this.blockGraphVersion,
      cleanupFailureCount: 0,
    };
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  registerCleanup(cleanup: () => void): void {
    if (this.disposed) {
      cleanup();
      return;
    }
    this.cleanups.push(cleanup);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cleanup of this.cleanups.splice(0).reverse()) {
      try {
        cleanup();
      } catch {
        // Disposal continues so all editor-owned resources are released.
      }
    }
    this.blockListeners.clear();
    this.rootListeners.clear();
    this.childListeners.clear();
    this.directChildBlocksByParentId.clear();
    this.directChildListeners.clear();
    this.selectionController.dispose();
    this.geometryOwner.dispose();
    this.contentRuntime.destroy();
  }

  private installGraph(state: RemoteCanonicalState): void {
    this.blocks = state.blocks;
    this.rootBlockIds = Object.freeze([...state.rootBlockIds]);
    this.childIdsByParentId = freezeChildSequences(state.childIdsByParentId);
    this.blockGraphVersion = state.blockGraphVersion;
  }

  private prepareGraphChanges(
    previous: RemoteCanonicalState,
  ): ReadEditorGraphChanges {
    const previousBlocks = previous.blocks;
    const previousRoots = previous.rootBlockIds;
    const previousChildren = previous.childIdsByParentId;
    const blockIds = new Set([
      ...(Object.keys(previousBlocks) as BlockId[]),
      ...(Object.keys(this.blocks) as BlockId[]),
    ]);
    const changedBlockIds: BlockId[] = [];
    const affectedDirectChildParentIds = new Set<BlockId>();
    for (const blockId of blockIds) {
      if (previousBlocks[blockId] === this.blocks[blockId]) continue;
      changedBlockIds.push(blockId);
      const previousBlock = previousBlocks[blockId];
      if (
        previousBlock &&
        !previousBlock.tombstone &&
        previousBlock.parentId !== null
      ) {
        affectedDirectChildParentIds.add(previousBlock.parentId);
      }
      const nextBlock = this.blocks[blockId];
      if (nextBlock && !nextBlock.tombstone && nextBlock.parentId !== null) {
        affectedDirectChildParentIds.add(nextBlock.parentId);
      }
    }
    changedBlockIds.sort(compareBlockIds);
    const rootsChanged = !arrayEqual(previousRoots, this.rootBlockIds);
    const parentIds = new Set([
      ...(Object.keys(previousChildren) as BlockId[]),
      ...(Object.keys(this.childIdsByParentId) as BlockId[]),
    ]);
    const changedChildParentIds: BlockId[] = [];
    for (const parentId of parentIds) {
      if (
        arrayEqual(
          previousChildren[parentId] ?? emptyBlockIds,
          this.childIdsByParentId[parentId] ?? emptyBlockIds,
        )
      ) {
        continue;
      }
      changedChildParentIds.push(parentId);
      affectedDirectChildParentIds.add(parentId);
    }
    changedChildParentIds.sort(compareBlockIds);
    const directChildParentIds = [...affectedDirectChildParentIds].sort(
      compareBlockIds,
    );
    for (const parentId of directChildParentIds) {
      this.directChildBlocksByParentId.delete(parentId);
    }
    return {
      changedBlockIds,
      rootsChanged,
      changedChildParentIds,
      directChildParentIds,
    };
  }

  private notifyGraphChanges(changes: ReadEditorGraphChanges): void {
    for (const blockId of changes.changedBlockIds) {
      for (const listener of this.blockListeners.get(blockId) ?? []) {
        notifyListener(listener);
      }
    }
    if (changes.rootsChanged) {
      for (const listener of this.rootListeners) notifyListener(listener);
    }
    for (const parentId of changes.changedChildParentIds) {
      for (const listener of this.childListeners.get(parentId) ?? []) {
        notifyListener(listener);
      }
    }
    for (const parentId of changes.directChildParentIds) {
      for (const listener of this.directChildListeners.get(parentId) ?? []) {
        notifyListener(listener);
      }
    }
  }

  private requireLive(): void {
    if (this.disposed) throw new Error("Read editor is disposed");
  }
}

function notifyListener(listener: () => void): void {
  try {
    listener();
  } catch {
    // A projection subscriber cannot invalidate committed canonical state.
  }
}

function freezeChildSequences(
  value: Readonly<Partial<Record<BlockId, readonly BlockId[]>>>,
): Readonly<Partial<Record<BlockId, readonly BlockId[]>>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(([parentId, blockIds]) => [
        parentId,
        Object.freeze([...(blockIds ?? [])]),
      ]),
    ),
  ) as Readonly<Partial<Record<BlockId, readonly BlockId[]>>>;
}

function arrayEqual<T>(left: readonly T[], right: readonly T[]): boolean {
  return (
    left === right ||
    (left.length === right.length &&
      left.every((value, index) => value === right[index]))
  );
}

function compareBlockIds(left: BlockId, right: BlockId): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const emptyBlockIds = Object.freeze([]) as readonly BlockId[];
