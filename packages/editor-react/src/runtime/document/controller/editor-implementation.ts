import { cloneJsonValue, jsonValuesEqual } from "@repo/editor-core/kernel";
import {
  assertValidBlockGraphVersion,
  getCanonicalBlockOrder,
  getSubtreeBlockIds,
  getSubtreeOrderBounds,
} from "@repo/editor-core/document";
import {
  resolveRestorativeDefault,
  type BlockDefinition,
} from "@repo/editor-core/definitions";
import {
  applyBlockGraphOperation,
  applyBlockGraphPatch,
  type BlockGraphReplayContext,
} from "@repo/editor-core/operations";
import {
  applyStructuralTransaction,
  assertValidCanonicalBlockFragment,
  materializeCanonicalBlockCreation,
  planBlockBoundaryBackspace,
  planBlockBoundaryDelete,
  planGenericEnter,
  deleteRange as createDeleteRangeOperation,
  insertBlocks as createInsertBlocksOperation,
  moveBlocks as createMoveBlocksOperation,
  removeBlocks as createRemoveBlocksOperation,
  replaceBlocks as createReplaceBlocksOperation,
  joinTextBlocks as createJoinTextBlocksOperation,
  setSelection as createSetSelectionOperation,
  validateStructuralDocument,
  type AppliedStructuralTransaction,
  type BlockPlacement,
  type CanonicalBlockFragment,
  type StructuralEditRange,
  type StructuralTransactionContext,
  type StructuralTransactionOperation,
  type StructuralTransactionPlan,
  type StructuralTransactionResult,
  type TransactionSelectionTarget,
} from "@repo/editor-core/editing";
import {
  applyLogicalContentOperationToRichTextDocument,
  extractPlainTextFromRichTextDocument,
  isRichTextDocument,
  richTextBlockInlineContent,
  richTextDocumentContentSize,
  richInlineContentSize,
  sliceRichTextDocument,
  validateRichTextInlineNodeJson,
  validateRichTextMarkJson,
  type RichTextAtomNodeJson,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import {
  findInlineMarkDefinition,
  inlineMarkValuesEqual,
  isInlineMarkName,
  resolveInlineMarkCommandAction,
  resolveInlineMarkCommandAttrs,
  validateInlineMarkCommandAttrs,
} from "@repo/editor-core/content/marks";
import { validateBlockGraphOperationBody } from "@repo/editor-core/operations";
import type {
  EditorBlockContentOperationBatch,
  EditorBlockGraphOperationBody,
  TransformBlocksPayload,
} from "@repo/editor-core/operations";
import type {
  BlockMetadataUpdate,
  EditorLogicalBlockMetadataOperation,
  EditorLogicalContentOperation,
  UpdateBlockMetadataOperation,
} from "@repo/editor-core/operations";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  applyBlockMetadataUpdates,
  validateBlockMetadataForDefinitionWithChildren,
} from "@repo/editor-core/metadata";
import type {
  EditorExternalStore,
  EditorSessionState,
} from "../../../store/contracts.ts";
import {
  createEditorCommandState,
  splitEditorCommandState,
  type EditorCommandState,
  type EditorManifestState,
} from "../state/command-state.ts";
import {
  type EditorContentOperationApplyResult,
  type EditorOperationRequest,
  type EditorOperationResult,
  type EditorCanonicalSelectionEffect,
  type EditorTransactionSelectionEffect,
  type EditorOperationSuggestion,
  type EditorStructuralTransactionResult,
  type EditorTransactionResult,
} from "../operations/mutation.ts";
import type { BlockSelectionModel } from "@repo/editor-core/selection";
import {
  contentSelection,
  wholeSelection,
  wrapperSelection,
} from "@repo/editor-core/selection";
import {
  createSelectionController,
  type SelectionController,
} from "../../../selection/controller/controller.ts";
import {
  readEditorBlockSelectionTarget,
  type EditorSelectionGraphReader,
} from "../../../selection/graph/reader.ts";
import { resolveEditorSelectionTextAnchorPoint } from "../../../selection/anchors/text-anchor.ts";
import {
  prepareCapturedSelectionInlineMarkFormatStates,
  readCurrentSelectionInlineMarkFormatStates,
} from "../../../selection/formatting/inline-mark-state.ts";
import type {
  EditorReadCurrentSelectionInlineMarkFormatStatesOptions,
  FormatSelectionInlineMarkOptions,
  FormatSelectionInlineMarkResult,
  ReadSelectionInlineMarkFormatStatesResult,
} from "../../../selection/formatting/inline-mark-state.ts";
import type {
  EditorLogicalSelectionPoint,
  EditorSelectionTextAffinity,
  EditorSelectionTextAnchorResolutionResult,
} from "../../../selection/model/types.ts";
import { cloneContentOperationBatches } from "../operations/cloning.ts";
import type {
  InitializeEditorImplementationOptions,
  EditorDocumentUpdate,
  EditorManifestData,
  EditorBlockGraphPatchApplication,
  EditorBlockMetadataUpdateOptions,
  EditorBlockDeletion,
  EditorBlockDeletionResult,
  EditorBlockTypeReplacement,
  EditorStructuralBlockMove,
  EditorContentMutationOptions,
  EditorFocusActionResult,
  EditorNativeFocusRequest,
  EditorBlockFocusOptions,
  EditorTextFocusOptions,
  EditorInfo,
  EditorManifestListener,
  EditorSnapshotReconciliation,
  EditorStructuralTransactionOptions,
  EditorCommandAvailability,
  EditorCommandAvailabilityReader,
  EditorInlineAtomUpdate,
  EditorMarkUpdate,
    EditorTextDeletion,
    EditorTextInsertion,
    CanonicalEditorBlockPlacement,
    CanonicalEditorBlockGraphChange,
} from "../api/contracts.ts";
import type {
  EditorHistoryEntry,
  EditorHistoryResult,
  EditorHistorySelection,
  EditorOperation,
} from "../history.ts";
import type {
  EditorSelection,
  EditorSelectionSnapshot,
  EditorStableSelection,
} from "../../../selection/model/types.ts";
import { projectCanonicalSelectionToTransaction } from "../../../selection/model/stable-selection.ts";
import type { CanonicalLocalSelection } from "../../../selection/model/canonical-selection.ts";
import {
  cloneAndFreezeHistoryEntry,
  DEFAULT_MAXIMUM_HISTORY_ENTRIES,
} from "../history.ts";
import type { EditorBlockGraphOperation } from "../operations/block-graph-operation.ts";
import { freezeManifestState } from "../state/freezing.ts";
import { createEditorBlockGraphPatch } from "../operations/manifest-diff.ts";
import {
  classifyEditorDocumentUpdate,
  editorDocumentUpdateHasChanges,
} from "../operations/document-update.ts";
import {
  parentKey,
  editorManifestStatesEqual,
  manifestDataMatchesCurrentState,
} from "../operations/manifest-query.ts";
import { getOrCreateEditorListenerSet, noop } from "../state/listeners.ts";
import {
  createBlocksForDurableOperation,
  createEditorOperationFailure,
  stateFromDurableOperationResult,
} from "../operations/operation-execution.ts";
import type {
  AppliedContentCommit,
  ContentCommitRejection,
  ContentOperationProposalAcceptanceContext,
  ContentOperationProposalOrigin,
  ContentSelectionPresentation,
  EditorContentBaseToken,
  EditorContentCommitChange,
  EditorContentOperationProposal,
  EditorContentOperationProposalResult,
  EditorPreparedContentSelection,
  ValidatedContentCommit,
  ValidatedContentBlock,
} from "../operations/content-commit.ts";
import type { EditorLocalMutationProvenance } from "../operations/local-mutation-provenance.ts";
import { assertValidEditorSnapshotReconciliation } from "./snapshot-reconciliation.ts";
import { executeCanonicalBlockFragmentInsertion } from "../operations/canonical-insertion.ts";
import { createInverseBlockMetadataOperation } from "../operations/metadata-operation-inverse.ts";
import {
  createBlockGraphOperationPair,
  composeEditorOperations,
  type PreparedEditorBlockGraphOperation,
} from "../operations/operation-pair.ts";

interface EditorBootstrapPatch {
  blockGraphVersion?: number;
  blocks?: Record<BlockId, VersionedBlock>;
  rootBlockIds?: readonly BlockId[];
  childIdsByParentId?: Readonly<Partial<Record<BlockId, readonly BlockId[]>>>;
  createdAt?: number;
  updatedAt?: number;
}

interface ActiveEditorTransaction {
  readonly baseState: EditorCommandState;
  readonly operations: StructuralTransactionOperation[];
  preview: AppliedStructuralTransaction | null;
  failure: Extract<EditorTransactionResult, { ok: false }> | null;
  selectionRequested: boolean;
  finalSelectionEffect: EditorCanonicalSelectionEffect | null;
  readonly provenance: EditorLocalMutationProvenance | null;
}

interface PreparedContentEditorTransaction {
  readonly graphRevision: number;
  readonly changes: readonly EditorContentCommitChange[];
  readonly selectionEffect: EditorCanonicalSelectionEffect;
  readonly preparedSelectionAfter?: EditorPreparedContentSelection | null;
  readonly origin: PreparedContentEditorTransactionOrigin;
  readonly selectionPresentation: ContentSelectionPresentation;
  readonly releaseAfterProposedStateInstalled?: boolean;
  readonly history: "record" | "ignore";
  readonly historyAction: "command" | "undo" | "redo";
  readonly editorSuggestion?: EditorOperationSuggestion | null;
  readonly provenance: EditorLocalMutationProvenance | null;
  readonly contentCommitOrigin?: unknown;
}

type PreparedContentEditorTransactionOrigin =
  | ContentOperationProposalOrigin
  | "public-semantic-mutation"
  | "undo"
  | "redo";

type SelectionSettlement =
  | { readonly kind: "clear" }
  | {
      readonly kind: "settled";
      readonly selection: EditorSelectionSnapshot;
    }
  | {
      readonly kind: "rejected";
      readonly retainedSelection: import("../../../selection/model/canonical-selection.ts").CanonicalLocalSelection;
    };

interface GraphSelectionSettlementCapture {
  readonly canonical: CanonicalLocalSelection;
  readonly traversalBlockIds: readonly BlockId[];
  readonly focusBlockId: BlockId | null;
}

type CanonicalSelectionPresentation =
  | ContentSelectionPresentation
  | "defer-native-until-content-release";

type PreparedContentEditorTransactionResult =
  | {
      readonly ok: true;
      readonly commit: AppliedContentCommit;
      readonly release: (() => void) | null;
    }
  | {
      readonly ok: false;
      readonly reason:
        | ContentCommitRejection["reason"]
        | "application-failed"
        | "no-change";
      readonly message: string;
    };

class ActiveEditorMutationFailure extends Error {}

type EditorCanonicalGraphMutationOrigin =
  | "bootstrap"
  | "local-command"
  | "undo"
  | "redo"
  | "accepted-change"
  | "recovery";

type EditorStructuralPlanResult =
  | Extract<StructuralTransactionResult, { readonly ok: false }>
  | (Extract<StructuralTransactionResult, { readonly ok: true }> & {
      readonly defaultRootId: BlockId | null;
    });

export class EditorImplementation {
  readonly selectionController: SelectionController =
    createSelectionController();
  readonly selection = this.selectionController.canonical;
  readonly selectionPaint = this.selectionController.localPaint;

  private manifestState: EditorManifestState;
  private readonly manifestListeners = new Set<EditorManifestListener>();
  private readonly rootBlockIdListeners = new Set<() => void>();
  private readonly blockListenersById = new Map<BlockId, Set<() => void>>();
  private readonly blockChildSequenceListenersByKey = new Map<
    string,
    Set<() => void>
  >();
  private readonly blockDefinitions: Readonly<
    Record<BlockType, BlockDefinition>
  >;
  private readonly disposables: Array<() => void> = [];
  private disposed = false;
  private cleanupFailureCount = 0;
  private documentRevision: number;
  private nextTransactionSequence = 1;
  private readonly maximumHistoryEntries: number;
  private history: EditorHistoryEntry[] = [];
  private historyIndex = 0;
  private historyRevision = 0;
  private readonly commandAvailabilityListeners = new Set<() => void>();
  private commandAvailabilitySnapshot: EditorCommandAvailability =
    Object.freeze({
      canUndo: false,
      canRedo: false,
    });
  readonly commandAvailability: EditorCommandAvailabilityReader = Object.freeze(
    {
      getSnapshot: () => this.commandAvailabilitySnapshot,
      subscribe: (listener: () => void) =>
        this.subscribeCommandAvailability(listener),
    },
  );
  private historyReplayInProgress = false;
  private activeTransaction: ActiveEditorTransaction | null = null;
  private editableDocumentLeaseActive = false;

  constructor(private readonly options: InitializeEditorImplementationOptions) {
    this.documentRevision = options.manifest.blockGraphVersion;
    this.maximumHistoryEntries = normalizeMaximumHistoryEntries(
      options.maximumHistoryEntries,
    );
    try {
      this.manifestState = freezeManifestState(
        options.manifest,
        options.blockDefinitions,
      );
      this.blockDefinitions = options.blockDefinitions;
      if (
        options.blockDefinitions[options.defaultRootBlockType]?.kind !== "text"
      ) {
        throw new Error(
          "defaultRootBlockType must name a text block definition",
        );
      }
      if (options.onDispose) this.disposables.push(options.onDispose);
    } catch (error) {
      try {
        options.onDispose?.();
      } catch {
        // Preserve the construction failure as the primary error.
      }
      throw error;
    }
  }

  get store(): EditorExternalStore {
    return this.options.store;
  }

  registerCleanup(cleanup: () => void): void {
    if (this.disposed) {
      this.runCleanup(cleanup);
      return;
    }
    let active = true;
    this.disposables.push(() => {
      if (!active) return;
      active = false;
      cleanup();
    });
  }

  acquireEditableDocument(): () => void {
    if (this.disposed) {
      throw new Error(
        "Cannot mount an editable document for a disposed editor",
      );
    }
    if (this.editableDocumentLeaseActive) {
      throw new Error(
        "An editor may have only one mounted editable document at a time",
      );
    }
    this.editableDocumentLeaseActive = true;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.editableDocumentLeaseActive = false;
    };
  }

  get canUndo(): boolean {
    return this.historyIndex > 0;
  }

  get canRedo(): boolean {
    return this.historyIndex < this.history.length;
  }

  undo(): EditorHistoryResult {
    if (this.historyReplayInProgress) {
      return {
        status: "execution-unavailable",
        reason: "history-replay-in-progress",
      };
    }
    if (!this.canUndo) return { status: "history-empty" };
    const entry = this.history[this.historyIndex - 1]!;
    const previousCanUndo = this.canUndo;
    const previousCanRedo = this.canRedo;
    this.historyReplayInProgress = true;
    let result: EditorHistoryResult;
    try {
      result = this.applyHistoryOperation(
        entry.inverse,
        "undo",
        entry.selectionBefore,
      );
    } finally {
      this.historyReplayInProgress = false;
    }
    if (result.status !== "applied") return result;
    this.historyIndex -= 1;
    this.historyRevision += 1;
    this.notifyCommandAvailabilityIfChanged(previousCanUndo, previousCanRedo);
    return result;
  }

  redo(): EditorHistoryResult {
    if (this.historyReplayInProgress) {
      return {
        status: "execution-unavailable",
        reason: "history-replay-in-progress",
      };
    }
    if (!this.canRedo) return { status: "history-empty" };
    const entry = this.history[this.historyIndex]!;
    const previousCanUndo = this.canUndo;
    const previousCanRedo = this.canRedo;
    this.historyReplayInProgress = true;
    let result: EditorHistoryResult;
    try {
      result = this.applyHistoryOperation(
        entry.forward,
        "redo",
        entry.selectionAfter,
      );
    } finally {
      this.historyReplayInProgress = false;
    }
    if (result.status !== "applied") return result;
    this.historyIndex += 1;
    this.historyRevision += 1;
    this.notifyCommandAvailabilityIfChanged(previousCanUndo, previousCanRedo);
    return result;
  }

  private subscribeCommandAvailability(listener: () => void): () => void {
    if (this.disposed) return noop;
    this.commandAvailabilityListeners.add(listener);
    return () => this.commandAvailabilityListeners.delete(listener);
  }

  private recordHistoryEntry(entry: EditorHistoryEntry): void {
    if (this.historyReplayInProgress) return;
    const previousCanUndo = this.canUndo;
    const previousCanRedo = this.canRedo;
    this.history.splice(this.historyIndex);
    this.history.push(cloneAndFreezeHistoryEntry(entry));
    this.historyIndex = this.history.length;
    const overflow = this.history.length - this.maximumHistoryEntries;
    if (overflow > 0) {
      this.history.splice(0, overflow);
      this.historyIndex = Math.max(0, this.historyIndex - overflow);
    }
    this.historyRevision += 1;
    this.notifyCommandAvailabilityIfChanged(previousCanUndo, previousCanRedo);
  }

  private notifyCommandAvailabilityIfChanged(
    previousCanUndo: boolean,
    previousCanRedo: boolean,
  ): void {
    if (previousCanUndo === this.canUndo && previousCanRedo === this.canRedo) {
      return;
    }
    this.commandAvailabilitySnapshot = Object.freeze({
      canUndo: this.canUndo,
      canRedo: this.canRedo,
    });
    for (const listener of [...this.commandAvailabilityListeners]) listener();
  }

  private applyHistoryOperation(
    operation: EditorOperation,
    direction: "undo" | "redo",
    selection: EditorHistorySelection,
  ): EditorHistoryResult {
    if (this.disposed) {
      return {
        status: "operation-application-failed",
        message: "editor is disposed",
      };
    }
    try {
      const restoreActiveTextProjection =
        this.hasActiveCanonicalTextProjection();
      const materializedSelection = this.materializeHistorySelectionEffect(
        selection,
        this,
        operation,
      );
      if (
        !materializedSelection &&
        operation.kind !== "blockGraph" &&
        operation.kind !== "structuralTransaction"
      ) {
        return {
          status: "operation-application-failed",
          message: `history ${direction} selection could not be resolved`,
        };
      }
      const replayOperation = materializedSelection
        ? rebaseHistoryOperationFromSelection(
            operation,
            selection,
            materializedSelection,
          )
        : operation;
      if (!replayOperation) {
        return {
          status: "operation-application-failed",
          message: `history ${direction} operation could not be rebased`,
        };
      }
      if (replayOperation.kind === "structuralTransaction") {
        const contentOperations = replayOperation.contentOperations.map(
          (contentOperation): StructuralTransactionOperation => ({
            kind: "applyContentOperation",
            operation: contentOperation,
          }),
        );
        const operations =
          replayOperation.contentOrder === "before-graph"
            ? [...contentOperations, ...replayOperation.graphOperations]
            : [...replayOperation.graphOperations, ...contentOperations];
        const result = this.executeStructuralTransaction(
          { origin: `${direction}:${replayOperation.origin}`, operations },
          {
            origin: direction,
            selectionEffect: this.historySelectionEffect(selection),
            selectionPresentation: restoreActiveTextProjection
              ? "native-before-removal"
              : "canonical-only",
          },
        );
        return result.ok
          ? { status: "applied" }
          : {
              status: "operation-application-failed",
              message:
                result.phase === "planning"
                  ? `structural ${direction} planning failed: ${result.failure.message}`
                  : `structural ${direction} commit failed: ${result.operationResult.reason}`,
            };
      }
      if (replayOperation.kind === "blockGraph") {
        const selectionEffect = this.historySelectionEffect(selection);
        const current = this.getCommandState();
        const now = Date.now();
        const mutation = applyBlockGraphOperation(
          current,
          {
            kind: replayOperation.graphKind,
            payload: replayOperation.payload,
          },
          { now },
        );
        const requestedBlocks = {
          ...mutation.blocks,
        } as Record<BlockId, VersionedBlock>;
        for (const removedBlockId of replayOperation.payload.removedBlockIds ??
          []) {
          delete requestedBlocks[removedBlockId];
        }
        const result = this.applyPreparedGraphTransaction(
          {
            reason: "runtime-mutation",
            nextState: {
              ...current,
              blocks: requestedBlocks,
              rootBlockIds: mutation.rootBlockIds,
              childIdsByParentId: mutation.childIdsByParentId,
            },
            contentOperations: mutation.contentOperations,
            candidateBlockIds: blockGraphPatchCandidateIds(mutation.patch),
            operationTargetId: `${direction}:block-graph`,
            semanticOperation: replayOperation,
            origin: direction,
            selectionEffect,
            provenance: null,
          },
          { structuralDraftAlreadyValidated: false },
        );
        return result.ok
          ? { status: "applied" }
          : {
              status: "operation-application-failed",
              message:
                result.reason ?? `block graph ${direction} operation failed`,
            };
      }
      if (!materializedSelection) {
        return {
          status: "operation-application-failed",
          message: `history ${direction} selection could not be resolved`,
        };
      }
      if (replayOperation.kind === "composite") {
        return this.applyCompositeHistoryOperation(
          replayOperation,
          direction,
          this.historySelectionEffect(selection),
        );
      }
      if (replayOperation.kind === "updateBlockMetadata") {
        return this.executeBlockMetadataUpdateInternal(
          replayOperation,
          {},
          direction,
          undefined,
          materializedSelection,
        )
          ? { status: "applied" }
          : {
              status: "operation-application-failed",
              message: `metadata ${direction} operation was rejected`,
            };
      }
      if (!this.options.contentCommit) {
        return {
          status: "operation-application-failed",
          message: "logical content operation application is unavailable",
        };
      }
      const result = this.commitLogicalContentOperations(
        [replayOperation],
        direction,
        this.historySelectionEffect(selection),
      );
      if (!result.ok || result.applied === 0) {
        return {
          status: "operation-application-failed",
          message: result.message,
        };
      }
      return { status: "applied" };
    } catch (error) {
      return {
        status: "operation-application-failed",
        message:
          error instanceof Error
            ? error.message
            : `editor ${direction} operation failed`,
      };
    }
  }

  private applyCompositeHistoryOperation(
    operation: Extract<EditorOperation, { readonly kind: "composite" }>,
    direction: "undo" | "redo",
    selectionEffect: Exclude<
      EditorCanonicalSelectionEffect,
      { readonly kind: "preserve" }
    >,
  ): EditorHistoryResult {
    const contentOperations = flattenContentOperations(operation);
    if (!contentOperations) {
      return {
        status: "operation-application-failed",
        message: "mixed composite operation application is unavailable",
      };
    }
    if (!this.options.contentCommit) {
      return {
        status: "operation-application-failed",
        message: "logical content operation application is unavailable",
      };
    }
    const committed = this.commitLogicalContentOperations(
      contentOperations,
      direction,
      selectionEffect,
    );
    if (!committed.ok || committed.applied !== contentOperations.length) {
      return {
        status: "operation-application-failed",
        message: committed.message,
      };
    }
    return { status: "applied" };
  }

  private commitLogicalContentOperations(
    operations: readonly import("@repo/editor-core/operations").EditorLogicalContentOperation[],
    direction: "undo" | "redo",
    selectionEffect: Exclude<
      EditorCanonicalSelectionEffect,
      { readonly kind: "preserve" }
    >,
  ):
    | { readonly ok: true; readonly applied: number; readonly message: string }
    | { readonly ok: false; readonly applied: 0; readonly message: string } {
    const contentCommit = this.options.contentCommit;
    if (!contentCommit) {
      return {
        ok: false,
        applied: 0,
        message: "logical content operation application is unavailable",
      };
    }
    const graphRevision = this.getSelectionGraphRevision();
    const tokens = new Map<BlockId, EditorContentBaseToken>();
    try {
      for (const operation of operations) {
        let token = tokens.get(operation.blockId);
        if (!token) {
          token = contentCommit.readContentBaseToken(
            operation.blockId,
            operation.blockType,
            graphRevision,
          );
          tokens.set(operation.blockId, token);
        }
      }
    } catch (error) {
      return {
        ok: false,
        applied: 0,
        message: error instanceof Error ? error.message : String(error),
      };
    }
    const operationBatches = groupContentOperations(operations);
    const changes = operationBatches.flatMap((batch) => {
      const baseToken = tokens.get(batch.blockId);
      return baseToken ? [{ baseToken, operations: batch.operations }] : [];
    });
    if (changes.length !== operationBatches.length) {
      return {
        ok: false,
        applied: 0,
        message: "logical content operation base capture failed",
      };
    }
    const coordinated = this.commitPreparedContentTransaction({
      graphRevision,
      changes,
      selectionEffect,
      origin: direction,
      selectionPresentation: "canonical-only",
      history: "ignore",
      historyAction: direction,
      provenance: null,
    });
    if (!coordinated.ok) {
      return {
        ok: false,
        applied: 0,
        message: coordinated.message,
      };
    }
    return {
      ok: true,
      applied: operations.length,
      message: "",
    };
  }

  resolveSelectionTextAnchor(
    point: EditorLogicalSelectionPoint,
  ): EditorSelectionTextAnchorResolutionResult {
    const resolveTextAnchor = this.options.resolveSelectionTextAnchor;
    if (!resolveTextAnchor) {
      return {
        ok: false,
        reason: "unsupported-block-type",
        blockId: point.blockId,
      };
    }
    return resolveEditorSelectionTextAnchorPoint(point, this, {
      resolveTextAnchor,
    });
  }

  focusBlock(
    blockId: BlockId,
    options?: EditorBlockFocusOptions,
  ): EditorFocusActionResult {
    return this.performNativeFocusRequest({
      token: Symbol(`atomic-focus:${blockId}`),
      blockId,
      targetKind: "atomic",
      graphRevision: this.getSelectionGraphRevision(),
      preventScroll: options?.preventScroll ?? true,
    });
  }

  focusText(
    blockId: BlockId,
    options?: EditorTextFocusOptions,
  ): EditorFocusActionResult {
    const normalized = this.normalizeTextFocusRequest(blockId, options);
    if (!normalized.ok) {
      return { status: "rejected", reason: normalized.reason };
    }
    return this.performNativeFocusRequest({
      token: Symbol(`text-focus:${blockId}`),
      blockId,
      targetKind: "text",
      graphRevision: this.getSelectionGraphRevision(),
      preventScroll: options?.preventScroll ?? true,
      offset: normalized.offset,
      affinity: options?.affinity ?? null,
      ...(options?.placement === undefined
        ? {}
        : { placement: options.placement }),
    });
  }

  completePendingNativeFocus(
    request: EditorNativeFocusRequest,
  ): EditorFocusActionResult {
    return this.performNativeFocusRequest(request);
  }

  blurEditor(): void {
    if (this.disposed) return;
    this.options.blurEditor?.();
    this.selectionController.resetKeyboardNavigation();
  }

  clearSelection(): boolean {
    if (this.disposed) return false;
    return (
      this.selectionController.clearSelection({
        publication: { kind: "standalone-local" },
        cause: "keyboard",
      }).kind === "changed"
    );
  }

  subscribeStandaloneSelectionSettlements(
    listener: (selection: EditorStableSelection) => void,
  ): () => void {
    return this.selectionController.subscribeStandaloneSettlements(listener);
  }

  private performNativeFocusRequest(
    request: EditorNativeFocusRequest,
  ): EditorFocusActionResult {
    const releaseContentAccess =
      request.targetKind === "text"
        ? this.options.acquireTextContentAccess?.(request.blockId) ?? null
        : null;
    try {
      return this.performNativeFocusRequestWithContentAccess(request);
    } finally {
      releaseContentAccess?.();
    }
  }

  private performNativeFocusRequestWithContentAccess(
    request: EditorNativeFocusRequest,
  ): EditorFocusActionResult {
    if (this.disposed) return { status: "rejected", reason: "disposed" };
    const candidate = this.createNativeFocusSelectionEffect(request);
    if (!candidate.ok) return { status: "rejected", reason: candidate.reason };
    if (request.targetKind === "text" && this.options.presentTextProjection) {
      if (this.options.canPresentTextProjection?.(request.blockId) === false) {
        return { status: "rejected", reason: "native-focus-failed" };
      }
      if (request.graphRevision !== this.getSelectionGraphRevision()) {
        return { status: "rejected", reason: "stale-graph" };
      }
      const settlement = this.settleCanonicalSelectionEffect(candidate.effect, {
        publication: { kind: "standalone-local" },
        cause: "programmatic-edit",
      });
      if (settlement.kind !== "settled") {
        return { status: "rejected", reason: "selection-rejected" };
      }
      const focus = settlement.selection.focus;
      const canonical = this.selectionController.getCanonicalSnapshot();
      if (
        !focus?.textAnchor ||
        canonical.kind !== "document" ||
        focus.blockId !== request.blockId
      ) {
        return { status: "rejected", reason: "selection-rejected" };
      }
      const activation = this.options.presentTextProjection?.(focus.blockId, {
        offset: focus.textOffset,
        affinity: focus.affinity,
        preventScroll: request.preventScroll,
        canonicalSelectionRevision: canonical.revision,
      }) ?? { status: "rejected" as const, reason: "native-focus-failed" };
      return activation.status === "rejected"
        ? { status: "rejected", reason: "native-focus-failed" }
        : activation;
    }
    const nativeResult = this.options.requestNativeFocus?.(request) ?? {
      status: "rejected" as const,
      reason: "native-focus-failed",
    };
    if (nativeResult.status === "pending") return { status: "pending" };
    if (nativeResult.status === "rejected") {
      return { status: "rejected", reason: "native-focus-failed" };
    }
    if (request.graphRevision !== this.getSelectionGraphRevision()) {
      this.options.releaseNativeFocus?.(request.blockId, request.targetKind);
      return { status: "rejected", reason: "stale-graph" };
    }
    const revalidated = this.createNativeFocusSelectionEffect(request);
    if (!revalidated.ok) {
      this.options.releaseNativeFocus?.(request.blockId, request.targetKind);
      return { status: "rejected", reason: revalidated.reason };
    }
    const settlement = this.settleCanonicalSelectionEffect(revalidated.effect, {
      publication: { kind: "standalone-local" },
      cause: "programmatic-edit",
    });
    if (settlement.kind === "rejected") {
      this.options.releaseNativeFocus?.(request.blockId, request.targetKind);
      return { status: "rejected", reason: "selection-rejected" };
    }
    return { status: "focused" };
  }

  private createNativeFocusSelectionEffect(request: EditorNativeFocusRequest):
    | {
        readonly ok: true;
        readonly effect: Exclude<
          EditorCanonicalSelectionEffect,
          { readonly kind: "preserve" } | { readonly kind: "history-selection" }
        >;
      }
    | {
        readonly ok: false;
        readonly reason: Extract<
          EditorFocusActionResult,
          { readonly status: "rejected" }
        >["reason"];
      } {
    const block = this.readLiveKnownBlock(request.blockId);
    if (!block) return { ok: false, reason: "missing-block" };
    const definition = this.blockDefinitions[block.type];
    if (
      (request.targetKind === "text" && definition?.kind !== "text") ||
      (request.targetKind === "atomic" && definition?.kind !== "atomic")
    ) {
      return { ok: false, reason: "wrong-block-kind" };
    }
    const model = this.readBlockSelectionModel(block.id);
    if (
      !model?.projection.selectable ||
      (request.targetKind === "text" &&
        model.projection.endpoint.kind !== "content") ||
      (request.targetKind === "atomic" &&
        model.projection.endpoint.kind !== "block")
    ) {
      return { ok: false, reason: "invalid-selection-model" };
    }
    const effect = this.createSelectionEffectFromSuggestion({
      selection: {
        blockId: block.id,
        ...(request.offset === undefined ? {} : { offset: request.offset }),
        ...(request.placement === undefined
          ? {}
          : { placement: request.placement }),
        affinity: request.affinity ?? null,
      },
    });
    return effect &&
      effect.kind !== "preserve" &&
      effect.kind !== "history-selection"
      ? { ok: true, effect }
      : { ok: false, reason: "selection-rejected" };
  }

  private normalizeTextFocusRequest(
    blockId: BlockId,
    options?: EditorTextFocusOptions,
  ):
    | { readonly ok: true; readonly offset: number }
    | {
        readonly ok: false;
        readonly reason: Extract<
          EditorFocusActionResult,
          { readonly status: "rejected" }
        >["reason"];
      } {
    if (this.disposed) return { ok: false, reason: "disposed" };
    const block = this.readLiveKnownBlock(blockId);
    if (!block) return { ok: false, reason: "missing-block" };
    if (this.blockDefinitions[block.type]?.kind !== "text") {
      return { ok: false, reason: "wrong-block-kind" };
    }
    const content = this.readBlockContent(block.id, block.type);
    const size = content ? richTextDocumentContentSize(content) : 0;
    const offset = options?.offset ?? (options?.placement === "end" ? size : 0);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > size) {
      return { ok: false, reason: "invalid-offset" };
    }
    return { ok: true, offset };
  }

  private readLiveKnownBlock(
    blockId: BlockId | null | undefined,
  ): VersionedBlock | null {
    if (!blockId) return null;
    const block = this.manifestState.blocks[blockId];
    if (
      !block ||
      block.tombstone ||
      this.blockDefinitions[block.type] === undefined
    )
      return null;
    return block;
  }

  insertText(
    insertion: EditorTextInsertion,
    options: EditorContentMutationOptions = {},
  ): boolean {
    if (
      !insertion ||
      typeof insertion.text !== "string" ||
      insertion.text.length === 0
    ) {
      return false;
    }
    const context = this.semanticContentContext(
      insertion.blockId,
      insertion.offset,
      insertion.offset,
    );
    if (!context) return false;
    return this.commitSemanticContentOperation(
      context,
      {
        kind: "insertInlineContent",
        blockId: context.block.id,
        blockType: context.block.type,
        target: { kind: "text" },
        position: {
          blockId: context.block.id,
          offset: insertion.offset,
        },
        content: [{ type: "text", text: insertion.text }],
      },
      options,
    );
  }

  deleteText(
    deletion: EditorTextDeletion,
    options: EditorContentMutationOptions = {},
  ): boolean {
    if (!deletion?.range) return false;
    const context = this.semanticContentContext(
      deletion.blockId,
      deletion.range.from,
      deletion.range.to,
    );
    if (!context || deletion.range.from === deletion.range.to) return false;
    const deletedContent = richTextBlockInlineContent(
      sliceRichTextDocument(
        context.block.type,
        context.content,
        deletion.range.from,
        deletion.range.to,
      ),
    );
    return this.commitSemanticContentOperation(
      context,
      {
        kind: "deleteInlineRange",
        blockId: context.block.id,
        blockType: context.block.type,
        target: { kind: "text" },
        range: {
          from: {
            blockId: context.block.id,
            offset: deletion.range.from,
          },
          to: {
            blockId: context.block.id,
            offset: deletion.range.to,
          },
        },
        deletedContent,
      },
      options,
    );
  }

  readCurrentSelectionInlineMarkFormatStates(
    input: EditorReadCurrentSelectionInlineMarkFormatStatesOptions,
  ): ReadSelectionInlineMarkFormatStatesResult {
    const selection = this.selectionController.getCommittedSnapshot();
    if (!selection) return { ok: false, reason: "not-committed" };
    return readCurrentSelectionInlineMarkFormatStates({
      selection,
      marks: input.marks,
      graph: this,
      graphRevision: this.getSelectionGraphRevision(),
      inlineMarks: this.options.inlineMarks,
      blockDefinitions: this.blockDefinitions,
      readCanonicalTextProjection: (blockId, blockType) =>
        this.readBlockContent(blockId, blockType),
    });
  }

  formatSelectionInlineMark(
    input: FormatSelectionInlineMarkOptions,
  ): FormatSelectionInlineMarkResult {
    const selection =
      input.selection ?? this.selectionController.getCommittedSnapshot();
    if (!selection) return { ok: false, reason: "not-committed" };
    const releases: Array<() => void> = [];
    try {
      if (this.options.acquireTextContentAccess) {
        const acquired = new Set<BlockId>();
        for (const selectedBlock of selection.blocks) {
          if (acquired.has(selectedBlock.blockId)) continue;
          const definition = this.blockDefinitions[selectedBlock.blockType];
          if (!definition || definition.kind !== "text") continue;
          const release = this.options.acquireTextContentAccess(
            selectedBlock.blockId,
          );
          if (!release)
            return { ok: false, reason: "missing-block", blockId: selectedBlock.blockId };
          acquired.add(selectedBlock.blockId);
          releases.push(release);
        }
      }
      const read = prepareCapturedSelectionInlineMarkFormatStates({
        selection,
        marks: [input.markName],
        graph: this,
        graphRevision: this.getSelectionGraphRevision(),
        inlineMarks: this.options.inlineMarks,
        blockDefinitions: this.blockDefinitions,
        readCanonicalTextProjection: (blockId, blockType) =>
          this.readBlockContent(blockId, blockType),
        textAnchorResolver: this.options.resolveSelectionTextAnchor
          ? { resolveTextAnchor: this.options.resolveSelectionTextAnchor }
          : null,
      });
      if (!read.ok) return read;
      const state = read.states[input.markName];
      if (!state?.canExecute) {
        return { ok: false, reason: state?.reason ?? "no-eligible-text" };
      }
      const definition = findInlineMarkDefinition(
        this.options.inlineMarks,
        input.markName,
      );
      if (!definition) return { ok: false, reason: "missing-mark" };
      const action = resolveInlineMarkCommandAction(state, input.action);
      if (!action) return { ok: false, reason: state.reason ?? "no-change" };
      const attrs = resolveInlineMarkCommandAttrs(
        definition,
        action,
        input.attrs,
      );
      if (!attrs) return { ok: false, reason: "invalid-attrs" };
      const commandAttrs =
        attrs as import("@repo/editor-core/kernel").JsonObject;
      const ranges = state.ranges.filter((range) =>
        action === "remove"
          ? range.hasMark
          : range.hasUnmarkedText ||
            !inlineMarkValuesEqual(range.value, commandAttrs),
      );
      if (ranges.length === 0) return { ok: false, reason: "no-change" };
      const plan = {
        graphRevision: read.snapshot.graphRevision,
        selectionRevision: read.snapshot.selectionRevision,
        markName: input.markName,
        action,
        ...(action === "add" ? { attrs: commandAttrs } : {}),
        ranges: Object.freeze(ranges),
      } as const;
      const transaction = this.transaction(() => {
        this.setTransactionSelection({ kind: "preserve" });
        for (const range of ranges) {
          const changed = this.updateMark({
            blockId: range.blockId,
            range: { from: range.from, to: range.to },
            mark: {
              type: input.markName,
              ...(action === "add" ? { attrs: commandAttrs } : {}),
            },
            enabled: action === "add",
          });
          if (!changed) {
            throw new Error(
              `formatting range ${range.blockId}:${range.from}-${range.to} was rejected`,
            );
          }
        }
      });
      if (!transaction.ok || !transaction.changed) {
        return {
          ok: false,
          reason: transaction.ok ? "no-change" : "transaction-failed",
          ...(!transaction.ok ? { message: transaction.message } : {}),
        };
      }
      return { ok: true, changed: true, selection, plan };
    } finally {
      for (const release of releases.reverse()) release();
    }
  }

  updateMark(
    update: EditorMarkUpdate,
    options: EditorContentMutationOptions = {},
  ): boolean {
    if (!update?.mark || !update.range || typeof update.enabled !== "boolean")
      return false;
    const markType = update.mark.type;
    const definition = isInlineMarkName(markType)
      ? findInlineMarkDefinition(this.options.inlineMarks, markType)
      : null;
    if (!definition) {
      return false;
    }
    const mark = update.enabled
      ? validateRichTextMarkJson(update.mark, "update.mark")
      : null;
    if (
      mark &&
      (!mark.valid ||
        !validateInlineMarkCommandAttrs(definition, mark.value.attrs))
    )
      return false;
    const context = this.semanticContentContext(
      update.blockId,
      update.range.from,
      update.range.to,
    );
    if (!context || update.range.from === update.range.to) return false;
    return this.commitSemanticContentOperation(
      context,
      {
        kind: update.enabled ? "addInlineMark" : "removeInlineMark",
        blockId: context.block.id,
        blockType: context.block.type,
        target: { kind: "text" },
        range: {
          from: {
            blockId: context.block.id,
            offset: update.range.from,
          },
          to: {
            blockId: context.block.id,
            offset: update.range.to,
          },
        },
        markName: markType,
        ...(!update.enabled || !mark || mark.value.attrs === undefined
          ? {}
          : { attrs: cloneJsonValue(mark.value.attrs) }),
      },
      options,
    );
  }

  updateInlineAtom(
    update: EditorInlineAtomUpdate,
    options: EditorContentMutationOptions = {},
  ): boolean {
    if (!update?.atom || !update.range) return false;
    const atom = validateRichTextInlineNodeJson(update.atom, "update.atom", {
      inlineMarks: this.options.inlineMarks,
      inlineAtoms: this.options.inlineAtoms,
    });
    if (
      !atom.valid ||
      atom.value.type === "text" ||
      atom.value.type === "hard_break" ||
      !Object.hasOwn(atom.value, "metadata")
    ) {
      return false;
    }
    const context = this.semanticContentContext(
      update.blockId,
      update.range.from,
      update.range.to,
    );
    if (!context) return false;
    const deletedContent = richTextBlockInlineContent(
      sliceRichTextDocument(
        context.block.type,
        context.content,
        update.range.from,
        update.range.to,
      ),
    );
    return this.commitSemanticContentOperation(
      context,
      {
        kind: "setInlineEntity",
        blockId: context.block.id,
        blockType: context.block.type,
        target: { kind: "text" },
        range: {
          from: {
            blockId: context.block.id,
            offset: update.range.from,
          },
          to: {
            blockId: context.block.id,
            offset: update.range.to,
          },
        },
        entity: cloneJsonValue(atom.value) as RichTextAtomNodeJson,
        deletedContent,
      },
      options,
    );
  }

  private semanticContentContext(
    blockId: BlockId,
    from: number,
    to: number,
  ): {
    readonly block: VersionedBlock;
    readonly content: RichTextDocumentNodeJson;
    readonly base: EditorContentBaseToken;
  } | null {
    if (
      this.disposed ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      from < 0 ||
      to < from
    ) {
      return null;
    }
    const active = this.activeTransaction;
    const block =
      (active?.preview?.blocks[blockId] as VersionedBlock | undefined) ??
      this.readLiveKnownBlock(blockId);
    if (!block || this.blockDefinitions[block.type]?.kind !== "text")
      return null;
    const content =
      active?.preview?.stagedContent[block.id]?.content ??
      this.readBlockContent(block.id, block.type);
    if (!isRichTextDocument(content)) return null;
    if (to > richTextDocumentContentSize(content)) return null;
    try {
      const base = this.options.contentCommit?.readContentBaseToken(
        block.id,
        block.type,
        this.getSelectionGraphRevision(),
      );
      return base ? { block, content, base } : null;
    } catch {
      return null;
    }
  }

  private commitSemanticContentOperation(
    context: {
      readonly block: VersionedBlock;
      readonly content: RichTextDocumentNodeJson;
      readonly base: EditorContentBaseToken;
    },
    operation: EditorLogicalContentOperation,
    options: EditorContentMutationOptions,
  ): boolean {
    if (this.activeTransaction) {
      const next = applyLogicalContentOperationToRichTextDocument(
        context.block.type,
        context.content,
        operation,
        {
          blockDefinitions: this.blockDefinitions,
          inlineMarks: this.options.inlineMarks,
        },
      );
      if (!next || jsonValuesEqual(context.content, next)) return false;
      this.appendActiveTransactionOperation({
        kind: "applyContentOperation",
        operation,
      });
      if (options.selectionEffect) {
        this.setTransactionSelection(options.selectionEffect);
      } else if (options.editorSuggestion) {
        const effect = this.createSelectionEffectFromSuggestion(
          options.editorSuggestion,
          this.activeTransaction?.preview?.blocks ??
            this.activeTransaction?.baseState.blocks,
        );
        if (effect) this.setTransactionSelection(effect);
      }
      return true;
    }
    const result = this.commitPreparedContentTransaction({
      graphRevision: context.base.graphRevision,
      changes: [{ baseToken: context.base, operations: [operation] }],
      selectionEffect: options.selectionEffect ?? { kind: "preserve" },
      origin: "public-semantic-mutation",
      selectionPresentation: "canonical-only",
      history: "record",
      historyAction: "command",
      editorSuggestion: options.editorSuggestion,
      provenance: null,
    });
    return result.ok;
  }

  updateBlockMetadata(
    updates: readonly BlockMetadataUpdate[],
    options: EditorBlockMetadataUpdateOptions = {},
  ): boolean {
    if (updates.length === 0) return false;
    let acceptedUpdates: readonly BlockMetadataUpdate[];
    try {
      acceptedUpdates = cloneJsonValue(
        updates,
      ) as unknown as readonly BlockMetadataUpdate[];
    } catch {
      return false;
    }
    const operation: UpdateBlockMetadataOperation = {
      kind: "updateBlockMetadata",
      updates: acceptedUpdates,
    };
    if (this.activeTransaction) {
      const active = this.requireActiveTransaction();
      const current = active.preview
        ? {
            ...active.baseState,
            blocks: active.preview.blocks as Record<BlockId, VersionedBlock>,
            rootBlockIds: active.preview.rootBlockIds,
            childIdsByParentId: active.preview.childIdsByParentId,
          }
        : active.baseState;
      const applied = applyBlockMetadataUpdates({
        operation,
        blocks: current.blocks,
        blockDefinitions: this.blockDefinitions,
        getDirectChildIds: (blockId) =>
          current.childIdsByParentId[blockId] ?? [],
      });
      if (!applied.ok) {
        this.failActiveTransaction(applied.errors.join(", "));
      }
      if (applied.affectedBlockIds.length === 0) return false;
      for (const blockId of applied.affectedBlockIds) {
        const currentBlock = current.blocks[blockId]!;
        const nextBlock = applied.blocks[blockId]!;
        this.appendActiveTransactionOperation({
          kind: "replaceBlockMetadata",
          blockId,
          expectedMetadataVersion: currentBlock.metadataVersion,
          metadata: nextBlock.metadata ?? null,
        });
      }
      if (options.selectionEffect) {
        this.setTransactionSelection(options.selectionEffect);
      } else if (options.editorSuggestion) {
        const effect = this.createSelectionEffectFromSuggestion(
          options.editorSuggestion,
          active.preview?.blocks ?? active.baseState.blocks,
        );
        if (effect) this.setTransactionSelection(effect);
      }
      return true;
    }
    const inverse = createInverseBlockMetadataOperation(
      operation,
      this.manifestState.blocks,
    );
    if (!inverse) return false;
    return this.executeBlockMetadataUpdateInternal(
      operation,
      options,
      "local-command",
      {
        forward: operation,
        inverse,
      },
    );
  }

  private executeBlockMetadataUpdateInternal(
    operation: UpdateBlockMetadataOperation,
    options: EditorBlockMetadataUpdateOptions,
    origin: "local-command" | "undo" | "redo",
    historyOperations?: Pick<EditorHistoryEntry, "forward" | "inverse">,
    selectionEffect?: EditorCanonicalSelectionEffect,
  ): boolean {
    const now = Date.now();
    const current = this.getCommandState();
    const applied = applyBlockMetadataUpdates({
      operation,
      blocks: current.blocks,
      blockDefinitions: this.blockDefinitions,
      getDirectChildIds: (blockId) =>
        this.manifestState.childIdsByParentId[blockId] ?? [],
    });
    if (!applied.ok) return false;
    if (applied.affectedBlockIds.length === 0) return false;
    const firstUpdate =
      operation.updates[0] ?? operation.deletions?.[0] ?? null;
    const mutation = this.applyPreparedGraphTransaction(
      {
        reason: "runtime-mutation",
        contentOperations: [],
        operationTargetId: `metadata-batch:${applied.affectedBlockIds.join(":")}`,
        targetBlockId: firstUpdate?.blockId ?? null,
        candidateBlockIds: applied.affectedBlockIds,
        editorSuggestion: options.editorSuggestion,
        canonicalOperation: cloneJsonValue(
          operation,
        ) as UpdateBlockMetadataOperation,
        origin,
        provenance: null,
        nextState: {
          ...current,
          blockGraphVersion: current.blockGraphVersion + 1,
          updatedAt: now,
          blocks: applied.blocks,
        },
      },
      historyOperations || selectionEffect || options.selectionEffect
        ? {
            ...(historyOperations ? { historyOperations } : {}),
            ...(selectionEffect || options.selectionEffect
              ? { selectionEffect: selectionEffect ?? options.selectionEffect }
              : {}),
          }
        : undefined,
    );
    return mutation.ok;
  }

  getEditorInfo(): EditorInfo {
    const manifest = this.manifestState;
    return {
      documentRevision: this.documentRevision,
      blockGraphVersion: manifest.blockGraphVersion,
      createdAt: manifest.createdAt,
      updatedAt: manifest.updatedAt,
    };
  }

  getBlockOrder(): readonly BlockId[] {
    return getCanonicalBlockOrder(this.manifestState);
  }

  isDisposed(): boolean {
    return this.disposed;
  }

  getCleanupFailureCount(): number {
    return this.cleanupFailureCount;
  }

  getBlock(blockId: BlockId): VersionedBlock | null {
    return this.manifestState.blocks[blockId] ?? null;
  }

  getPreviousBlock(blockId: BlockId): VersionedBlock | null {
    return this.getAdjacentBlock(blockId, -1);
  }

  getNextBlock(blockId: BlockId): VersionedBlock | null {
    return this.getAdjacentBlock(blockId, 1);
  }

  getPreviousSibling(blockId: BlockId): VersionedBlock | null {
    return this.getAdjacentSibling(blockId, -1);
  }

  getNextSibling(blockId: BlockId): VersionedBlock | null {
    return this.getAdjacentSibling(blockId, 1);
  }

  private getAdjacentBlock(
    blockId: BlockId,
    direction: -1 | 1,
  ): VersionedBlock | null {
    const blockIds = getCanonicalBlockOrder(this.manifestState);
    const index = blockIds.indexOf(blockId);
    if (index < 0) return null;
    const adjacentId = blockIds[index + direction];
    return adjacentId ? this.readLiveKnownBlock(adjacentId) : null;
  }

  private getAdjacentSibling(
    blockId: BlockId,
    direction: -1 | 1,
  ): VersionedBlock | null {
    const block = this.readLiveKnownBlock(blockId);
    if (!block) return null;
    const siblingIds =
      (block.parentId ?? null) === null
        ? this.manifestState.rootBlockIds
        : this.getChildBlockIds(block.parentId!);
    const index = siblingIds.indexOf(blockId);
    if (index < 0) return null;
    const adjacentId = siblingIds[index + direction];
    return adjacentId ? this.readLiveKnownBlock(adjacentId) : null;
  }

  getRootBlockIds(): readonly BlockId[] {
    return this.manifestState.rootBlockIds;
  }

  getChildBlockIds(parentId: BlockId): readonly BlockId[] {
    return this.manifestState.childIdsByParentId[parentId] ?? EMPTY_BLOCK_IDS;
  }

  getLastChildBlockId(parentId: BlockId | null): BlockId | null {
    const blockIds =
      parentId === null
        ? this.manifestState.rootBlockIds
        : (this.manifestState.childIdsByParentId[parentId] ?? EMPTY_BLOCK_IDS);
    return blockIds[blockIds.length - 1] ?? null;
  }

  insertCanonicalBlockFragment(
    placement: BlockPlacement,
    fragment: CanonicalBlockFragment,
  ): EditorTransactionResult {
    return executeCanonicalBlockFragmentInsertion(this, placement, fragment);
  }

  getParentId(blockId: BlockId): BlockId | null {
    return this.readLiveKnownBlock(blockId)?.parentId ?? null;
  }

  compareBlockOrder(
    leftBlockId: BlockId,
    rightBlockId: BlockId,
  ): number | null {
    const blockIds = getCanonicalBlockOrder(this.manifestState);
    const left = blockIds.indexOf(leftBlockId);
    const right = blockIds.indexOf(rightBlockId);
    return left < 0 || right < 0 ? null : left - right;
  }

  containsBlock(parentId: BlockId | null, candidateBlockId: BlockId): boolean {
    const blockIds =
      parentId === null
        ? this.manifestState.rootBlockIds
        : this.getChildBlockIds(parentId);
    return blockIds.includes(candidateBlockId);
  }

  getSubtreeBlockIds(blockId: BlockId): readonly BlockId[] {
    return getSubtreeBlockIds(this.manifestState, blockId);
  }

  getSubtreeOrderBounds(blockId: BlockId): {
    first: VersionedBlock;
    last: VersionedBlock;
    nextAfterSubtree: VersionedBlock | null;
  } | null {
    try {
      return getSubtreeOrderBounds(this.manifestState, blockId);
    } catch {
      return null;
    }
  }

  getSelectionGraphRevision(): number {
    return this.manifestState.blockGraphVersion;
  }

  readBlockSelectionModel(blockId: BlockId): BlockSelectionModel | null {
    const block = this.getBlock(blockId);
    if (!block || block.tombstone) return null;
    const definition = this.blockDefinitions[block.type];
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

  getManifestData(): EditorManifestData {
    return {
      blocks: this.manifestState.blocks,
      rootBlockIds: this.manifestState.rootBlockIds,
      childIdsByParentId: this.manifestState.childIdsByParentId,
    };
  }

  subscribeManifest(listener: EditorManifestListener): () => void {
    if (this.disposed) return () => undefined;
    this.manifestListeners.add(listener);
    return () => this.manifestListeners.delete(listener);
  }

  subscribeBlock(blockId: BlockId, listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    const listeners = getOrCreateEditorListenerSet(
      this.blockListenersById,
      blockId,
    );
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.blockListenersById.delete(blockId);
    };
  }

  subscribeRootBlockIds(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.rootBlockIdListeners.add(listener);
    return () => this.rootBlockIdListeners.delete(listener);
  }

  subscribeChildBlockIds(parentId: BlockId, listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    const key = parentKey(parentId);
    const listeners = getOrCreateEditorListenerSet(
      this.blockChildSequenceListenersByKey,
      key,
    );
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0)
        this.blockChildSequenceListenersByKey.delete(key);
    };
  }

  reconcileEditorSnapshotForRecovery(
    data: EditorSnapshotReconciliation,
  ): EditorCommandState {
    if (this.disposed) return this.getCommandState();
    assertValidEditorSnapshotReconciliation(data, this.blockDefinitions);
    if (
      data.origin !== "recovered-visible-state" &&
      data.blockGraphVersion < this.manifestState.blockGraphVersion
    ) {
      return this.getCommandState();
    }
    const current = this.getCommandState();
    if (manifestDataMatchesCurrentState(current, data)) {
      return current;
    }
    const nextBlocks = { ...data.blocks } as Record<BlockId, VersionedBlock>;
    const nextState = this.commitInitialBootstrap(
      {
        blockGraphVersion: data.blockGraphVersion,
        blocks: nextBlocks,
        rootBlockIds: data.rootBlockIds,
        childIdsByParentId: data.childIdsByParentId,
        updatedAt: Date.now(),
      },
      {},
      "recovery",
    );
    return nextState;
  }

  /**
   * Commits one already-validated remote semantic transaction. Content stays
   * unpublished until the complete canonical graph and selection have been
   * installed, and this path never records history or emits a local change.
   */
  commitValidatedRemoteTransaction(input: {
    readonly nextState: EditorCommandState;
    readonly validatedContent: ValidatedContentCommit | null;
    readonly candidateBlockIds: readonly BlockId[];
    readonly contentChangedBlockIds: readonly BlockId[];
    readonly afterCanonicalStateInstalled: () => void;
  }): {
    readonly update: EditorDocumentUpdate;
    readonly documentRevision: number;
  } {
    if (this.disposed) throw new Error("Editor is disposed");
    if (this.activeTransaction) {
      throw new Error(
        "A remote transaction cannot interleave with a local transaction",
      );
    }
    const previousState = this.getCommandState();
    const update = this.classifyDocumentUpdate(previousState, input.nextState, {
      candidateBlockIds: input.candidateBlockIds,
      contentChangedBlockIds: input.contentChangedBlockIds,
    });
    if (!editorDocumentUpdateHasChanges(update)) {
      throw new Error("Remote transaction contains no canonical changes");
    }
    let appliedContent: AppliedContentCommit | null = null;
    try {
      appliedContent = input.validatedContent
        ? this.options.contentCommit!.commitContent(input.validatedContent)
        : null;
      const notify = this.commitCanonicalGraphMutation(
        input.nextState,
        update,
        "accepted-change",
        false,
        undefined,
        true,
        {
          publication: { kind: "silent" },
          cause: "remote-transaction",
        },
      );
      input.afterCanonicalStateInstalled();
      if (appliedContent) {
        this.options.contentCommit!.publishContentCommit(appliedContent);
      }
      notify();
      return { update, documentRevision: this.documentRevision };
    } catch (error) {
      if (appliedContent) {
        this.options.contentCommit!.markInconsistent(
          `Canonical state installation failed after live content mutation: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      throw error;
    }
  }

  /** Installs an explicitly recovered canonical snapshot without history or local publication. */
  commitRemoteRecoveryState(input: {
    readonly nextState: EditorCommandState;
    readonly candidateBlockIds: readonly BlockId[];
    readonly afterCanonicalStateInstalled: () => void;
  }): {
    readonly update: EditorDocumentUpdate;
    readonly documentRevision: number;
  } {
    if (this.disposed) throw new Error("Editor is disposed");
    if (this.activeTransaction) {
      throw new Error(
        "Snapshot recovery cannot interleave with a local transaction",
      );
    }
    const previousState = this.getCommandState();
    const update = this.classifyDocumentUpdate(previousState, input.nextState, {
      candidateBlockIds: input.candidateBlockIds,
      contentChangedBlockIds: input.candidateBlockIds,
    });
    const notify = this.commitCanonicalGraphMutation(
      input.nextState,
      update,
      "recovery",
      false,
      undefined,
      true,
      {
        publication: { kind: "silent" },
        cause: "snapshot-recovery",
      },
    );
    input.afterCanonicalStateInstalled();
    notify();
    return { update, documentRevision: this.documentRevision };
  }

  replayBlockGraphOperation(
    operation: EditorBlockGraphOperationBody,
    context?: BlockGraphReplayContext,
  ): EditorCommandState {
    const current = this.getCommandState();
    if (this.disposed) return current;
    const operationValidation = validateBlockGraphOperationBody(operation, {
      blockDefinitions: this.blockDefinitions,
    });
    if (!operationValidation.valid) {
      throw new Error(operationValidation.errors.join(", "));
    }
    const mutation = applyBlockGraphOperation(current, operation, context);
    const metadataErrors = validateEditorMetadataGraph({
      previousBlocks: current.blocks,
      nextBlocks: mutation.blocks,
      nextChildIdsByParentId: mutation.childIdsByParentId,
      affectedBlockIds: mutation.patch.affectedBlockIds,
      blockDefinitions: this.blockDefinitions,
    });
    if (metadataErrors.length > 0) {
      throw new Error(
        `remote block graph operation is invalid: ${metadataErrors.join(", ")}`,
      );
    }
    const nextState = {
      ...current,
      blockGraphVersion: current.blockGraphVersion + 1,
      blocks: mutation.blocks,
      rootBlockIds: mutation.rootBlockIds,
      childIdsByParentId: mutation.childIdsByParentId,
      updatedAt: context?.now ?? Date.now(),
    };
    const preparedContent = this.prepareDocumentContentCommit(
      mutation.contentOperations,
      current,
      nextState,
      "accepted-change",
      blockGraphPatchCandidateIds(mutation.patch),
    );
    if (preparedContent && !("kind" in preparedContent)) {
      throw new Error(preparedContent.message);
    }
    const appliedContent = preparedContent
      ? this.options.contentCommit!.commitContent(preparedContent)
      : null;
    try {
      const committed = this.commitInitialBootstrap(
        nextState,
        {
          candidateBlockIds: blockGraphPatchCandidateIds(mutation.patch),
          contentChangedBlockIds: mutation.contentOperations.map(
            (batch) => batch.blockId,
          ),
        },
        "accepted-change",
      );
      if (appliedContent) {
        this.options.contentCommit!.publishContentCommit(appliedContent);
      }
      return committed;
    } catch (error) {
      if (appliedContent) {
        this.options.contentCommit!.markInconsistent(
          `Canonical commit failed after live content mutation: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      throw error;
    }
  }

  applyEditorBlockGraphPatch(
    data: EditorBlockGraphPatchApplication,
  ): EditorCommandState {
    const current = this.getCommandState();
    if (this.disposed) return current;
    assertValidBlockGraphVersion(data.blockGraphVersion);
    if (data.blockGraphVersion < current.blockGraphVersion) return current;
    const mutation = applyBlockGraphPatch(current, data.patch, {
      removedBlockTombstone:
        (data.patch.removedBlockIds?.length ?? 0) > 0
          ? {
              deletedAt: data.updatedAt ?? Date.now(),
              reason: "move-replace",
            }
          : undefined,
    });
    const nextState = {
      ...current,
      blockGraphVersion: data.blockGraphVersion,
      blocks: mutation.blocks,
      rootBlockIds: mutation.rootBlockIds,
      childIdsByParentId: mutation.childIdsByParentId,
      updatedAt: data.updatedAt ?? Date.now(),
    };
    return this.commitInitialBootstrap(
      nextState,
      {
        candidateBlockIds: blockGraphPatchCandidateIds(mutation.patch),
      },
      "accepted-change",
    );
  }

  replayLogicalBlockMetadataOperation(
    operation: EditorLogicalBlockMetadataOperation,
  ): EditorCommandState {
    const current = this.getCommandState();
    if (this.disposed) return current;
    const applied = applyBlockMetadataUpdates({
      operation,
      blocks: current.blocks,
      blockDefinitions: this.blockDefinitions,
      getDirectChildIds: (blockId) => current.childIdsByParentId[blockId] ?? [],
    });
    if (!applied.ok) return current;

    const nextState = {
      ...current,
      blockGraphVersion: current.blockGraphVersion + 1,
      updatedAt: Date.now(),
      blocks: applied.blocks,
    };
    const preparedContent = this.prepareDocumentContentCommit(
      [],
      current,
      nextState,
      "accepted-change",
      applied.affectedBlockIds,
    );
    if (preparedContent && !("kind" in preparedContent)) {
      throw new Error(preparedContent.message);
    }
    const appliedContent = preparedContent
      ? this.options.contentCommit!.commitContent(preparedContent)
      : null;
    try {
      const committed = this.commitInitialBootstrap(
        nextState,
        { candidateBlockIds: applied.affectedBlockIds },
        "accepted-change",
      );
      if (appliedContent) {
        this.options.contentCommit!.publishContentCommit(appliedContent);
      }
      return committed;
    } catch (error) {
      // The canonical commit is already durable; observer failures are isolated.
      if (appliedContent) {
        this.options.contentCommit!.markInconsistent(
          `Canonical observer failed after live content mutation: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      throw error;
    }
  }

  private metadataEditorRequestMatchesCurrentState(
    current: EditorCommandState,
    request: EditorOperationRequest,
  ): boolean {
    const operation = request.canonicalOperation;
    if (!operation || operation.kind !== "updateBlockMetadata") {
      return true;
    }
    if (request.contentOperations.length > 0) return false;
    const applied = applyBlockMetadataUpdates({
      operation,
      blocks: current.blocks,
      blockDefinitions: this.blockDefinitions,
      getDirectChildIds: (blockId) => current.childIdsByParentId[blockId] ?? [],
    });
    if (!applied.ok) return false;
    const appliedWithCanonicalVersions = {
      ...applied.blocks,
    } as Record<BlockId, VersionedBlock>;
    for (const blockId of applied.affectedBlockIds) {
      const appliedBlock = applied.blocks[blockId];
      const plannedBlock = request.nextState.blocks[blockId];
      if (!appliedBlock || !plannedBlock) return false;
      appliedWithCanonicalVersions[blockId] = {
        ...appliedBlock,
        metadataVersion: plannedBlock.metadataVersion,
      };
    }
    return (
      request.nextState.blockGraphVersion === current.blockGraphVersion + 1 &&
      jsonValuesEqual(request.nextState.blocks, appliedWithCanonicalVersions)
    );
  }

  transaction(
    callback: () => unknown,
    context: {
      readonly provenance: EditorLocalMutationProvenance | null;
      readonly selectionPresentation?:
        | "canonical-only"
        | "native-final-selection";
    } = { provenance: null },
  ): EditorTransactionResult {
    if (this.activeTransaction) {
      const failure: Extract<EditorTransactionResult, { ok: false }> = {
        ok: false,
        phase: "nested",
        message: "editor transactions cannot be nested",
      };
      this.activeTransaction.failure ??= failure;
      return failure;
    }
    const active: ActiveEditorTransaction = {
      baseState: this.getCommandState(),
      operations: [],
      preview: null,
      failure: null,
      selectionRequested: false,
      finalSelectionEffect: null,
      provenance: context.provenance,
    };
    this.activeTransaction = active;
    try {
      try {
        const returned = callback();
        if (isPromiseLike(returned)) {
          active.failure = {
            ok: false,
            phase: "async-callback",
            message: "editor.transaction callbacks must be synchronous",
          };
        }
      } catch (error) {
        if (!active.failure) {
          active.failure = {
            ok: false,
            phase:
              error instanceof ActiveEditorMutationFailure
                ? "mutation"
                : "callback",
            message: error instanceof Error ? error.message : String(error),
            cause: error,
          };
        }
      }
      if (active.failure) return active.failure;
      if (active.operations.length === 0) {
        return { ok: true, changed: false };
      }
      const planned = this.applyStructuralPlan(
        {
          origin: "editor.transaction",
          operations: active.operations,
        },
        active.baseState,
      );
      if (!planned.ok) {
        return {
          ok: false,
          phase: "validation",
          message: planned.message,
          failure: planned,
        };
      }
      if (!transactionHasChanges(planned.transaction, active.baseState)) {
        return { ok: true, changed: false };
      }
      if (
        this.getCommandState().blockGraphVersion !==
        active.baseState.blockGraphVersion
      ) {
        return {
          ok: false,
          phase: "commit",
          message: "the document changed before the transaction could commit",
        };
      }
      const committed = this.commitStructuralTransaction(
        { origin: "editor.transaction", operations: active.operations },
        active.baseState,
        planned.transaction,
        {
          ...(active.finalSelectionEffect === null
            ? {}
            : { selectionEffect: active.finalSelectionEffect }),
          ...(context.selectionPresentation === "native-final-selection"
            ? { selectionPresentation: "native-before-removal" as const }
            : {}),
          provenance: active.provenance,
        },
        planned.defaultRootId,
      );
      if (
        committed.ok &&
        context.selectionPresentation === "native-final-selection"
      ) {
        this.presentAtomicStructuralSelection(committed.transaction.selection);
      }
      return committed.ok
        ? {
            ok: true,
            changed: true,
            transaction: committed.transaction,
            operationResult: committed.operationResult,
          }
        : {
            ok: false,
            phase: "commit",
            message: "the transaction could not be committed",
            ...(committed.phase === "commit"
              ? { operationResult: committed.operationResult }
              : {}),
          };
    } finally {
      if (this.activeTransaction === active) this.activeTransaction = null;
    }
  }

  deleteRange(range: StructuralEditRange): void {
    this.appendActiveTransactionOperation(createDeleteRangeOperation(range));
  }

  insertBlocks(
    placement: BlockPlacement,
    fragment: CanonicalBlockFragment,
  ): {
    readonly rootBlockIds: readonly BlockId[];
    readonly start: CanonicalBlockFragment["start"];
    readonly end: CanonicalBlockFragment["end"];
  } {
    this.requireActiveTransaction();
    try {
      assertValidCanonicalBlockFragment(fragment, {
        blockDefinitions: this.blockDefinitions,
      });
    } catch (error) {
      this.failActiveTransaction(
        error instanceof Error ? error.message : String(error),
      );
    }
    const active = this.requireActiveTransaction();
    const current = active.preview
      ? {
          blocks: active.preview.blocks,
          rootBlockIds: active.preview.rootBlockIds,
          childIdsByParentId: active.preview.childIdsByParentId,
        }
      : active.baseState;
    const roots = new Set(fragment.rootBlockIds);
    const incomingTypes = fragment.rootBlockIds.map((rootId) => {
      const root = fragment.blocks.find((record) => record.id === rootId)!;
      return root.type;
    });
    const restorativeDefault = restorativeDefaultReplacementAtPlacement({
      placement,
      incomingTypes,
      ...current,
      blockDefinitions: this.blockDefinitions,
    });
    if (restorativeDefault) {
      this.appendActiveTransactionOperation(
        createRemoveBlocksOperation({
          blockIds: [restorativeDefault.block.id],
          includeDescendants: true,
          expectedParents: {
            [restorativeDefault.block.id]: restorativeDefault.block.parentId,
          },
        }),
      );
    }
    const effectivePlacement = restorativeDefault?.placement ?? placement;
    const records = fragment.blocks.map((record) =>
      roots.has(record.id)
        ? { ...record, parentId: effectivePlacement.parentId }
        : record,
    );
    this.appendActiveTransactionOperation(
      createInsertBlocksOperation({
        placement: effectivePlacement,
        blocks: records,
      }),
    );
    this.appendActiveTransactionOperation(
      createSetSelectionOperation(
        resolveCanonicalFragmentInsertionSelection(
          fragment,
          this.blockDefinitions,
        ),
      ),
    );
    return Object.freeze({
      rootBlockIds: fragment.rootBlockIds,
      start: fragment.start,
      end: fragment.end,
    });
  }

  deleteBlocks(input: EditorBlockDeletion): EditorBlockDeletionResult {
    const active = this.requireActiveTransaction();
    if (
      !input ||
      input.includeDescendants !== true ||
      !Array.isArray(input.blockIds) ||
      input.blockIds.length === 0
    ) {
      this.failActiveTransaction(
        "deleteBlocks requires one or more block IDs and includeDescendants: true",
      );
    }
    const current = active.preview
      ? {
          blocks: active.preview.blocks,
          rootBlockIds: active.preview.rootBlockIds,
          childIdsByParentId: active.preview.childIdsByParentId,
        }
      : active.baseState;
    const requested = new Set<BlockId>();
    const deleted = new Set<BlockId>();
    for (const blockId of input.blockIds) {
      if (requested.has(blockId)) {
        this.failActiveTransaction(`deleteBlocks repeats ${blockId}`);
      }
      requested.add(blockId);
      const block = current.blocks[blockId];
      if (!block || block.tombstone) {
        this.failActiveTransaction(
          `deleteBlocks target ${blockId} does not exist`,
        );
      }
      if (
        input.expectedParents &&
        Object.prototype.hasOwnProperty.call(input.expectedParents, blockId) &&
        block.parentId !== input.expectedParents[blockId]
      ) {
        this.failActiveTransaction(
          `deleteBlocks parent authority for ${blockId} is stale`,
        );
      }
      const subtree = getSubtreeBlockIds(current, blockId);
      if (subtree.some((descendantId) => deleted.has(descendantId))) {
        this.failActiveTransaction(
          "deleteBlocks requests overlapping subtrees",
        );
      }
      for (const descendantId of subtree) deleted.add(descendantId);
    }
    for (const blockId of requested) {
      const subtree = new Set(getSubtreeBlockIds(current, blockId));
      for (const otherBlockId of requested) {
        if (otherBlockId !== blockId && subtree.has(otherBlockId)) {
          this.failActiveTransaction(
            "deleteBlocks requests overlapping subtrees",
          );
        }
      }
    }
    this.appendActiveTransactionOperation(
      createRemoveBlocksOperation({
        blockIds: [...requested],
        includeDescendants: true,
        ...(input.expectedParents
          ? { expectedParents: input.expectedParents }
          : {}),
      }),
    );
    const reservedBlockIds = new Set(Object.keys(current.blocks) as BlockId[]);
    const restorativeParents = new Set<BlockId>();
    for (const deletedBlockId of deleted) {
      const parentId = current.blocks[deletedBlockId]?.parentId;
      if (parentId && !deleted.has(parentId)) restorativeParents.add(parentId);
    }
    for (const parentId of restorativeParents) {
      const parent = current.blocks[parentId];
      const definition = parent
        ? this.blockDefinitions[parent.type]
        : undefined;
      const relationship = definition
        ? resolveRestorativeDefault(this.blockDefinitions, definition)
        : null;
      const childIds = current.childIdsByParentId[parentId] ?? EMPTY_BLOCK_IDS;
      if (
        !relationship ||
        childIds.length === 0 ||
        childIds.some((childId) => !deleted.has(childId))
      ) {
        continue;
      }
      const creation = materializeCanonicalBlockCreation({
        blockDefinitions: this.blockDefinitions,
        type: relationship.defaultType,
        reservedBlockIds,
      });
      for (const record of creation.fragment.blocks) {
        reservedBlockIds.add(record.id);
      }
      const creationRoots = new Set(creation.fragment.rootBlockIds);
      const records = creation.fragment.blocks.map((record) =>
        creationRoots.has(record.id) ? { ...record, parentId } : record,
      );
      this.appendActiveTransactionOperation(
        createInsertBlocksOperation({
          placement: { parentId, childIndex: 0 },
          blocks: records,
        }),
      );
    }
    return Object.freeze({ deletedBlockIds: Object.freeze([...deleted]) });
  }

  replaceBlockTypes(replacements: readonly EditorBlockTypeReplacement[]): void {
    const active = this.requireActiveTransaction();
    if (!Array.isArray(replacements) || replacements.length === 0) {
      this.failActiveTransaction(
        "replaceBlockTypes requires one or more replacements",
      );
    }
    const current = active.preview
      ? { blocks: active.preview.blocks }
      : active.baseState;
    const seen = new Set<BlockId>();
    const blocks = replacements.map(({ blockId, blockType, metadata }) => {
      if (seen.has(blockId)) {
        this.failActiveTransaction(`replaceBlockTypes repeats ${blockId}`);
      }
      seen.add(blockId);
      if (!this.blockDefinitions[blockType]) {
        this.failActiveTransaction(
          `replaceBlockTypes target ${blockType} is unavailable`,
        );
      }
      const block = current.blocks[blockId];
      if (!block || block.tombstone) {
        this.failActiveTransaction(
          `replaceBlockTypes target ${blockId} does not exist`,
        );
      }
      const next: VersionedBlock = { ...block, type: blockType };
      if (metadata === null) delete next.metadata;
      else if (metadata !== undefined) {
        next.metadata = cloneJsonValue(metadata);
      }
      return { block: next };
    });
    this.appendActiveTransactionOperation(
      createReplaceBlocksOperation({ blocks }),
    );
  }

  moveBlocks(input: EditorStructuralBlockMove): EditorTransactionResult {
    if (!this.activeTransaction) {
      return this.transaction(() => {
        this.moveBlocks(input);
      });
    }
    const active = this.requireActiveTransaction();
    const current = active.preview
      ? {
          blocks: active.preview.blocks,
          rootBlockIds: active.preview.rootBlockIds,
          childIdsByParentId: active.preview.childIdsByParentId,
        }
      : active.baseState;
    if (
      !input ||
      !Array.isArray(input.blockIds) ||
      input.blockIds.length === 0
    ) {
      this.failActiveTransaction("moveBlocks requires one or more block IDs");
    }
    const blockIds = [...input.blockIds];
    if (new Set(blockIds).size !== blockIds.length) {
      this.failActiveTransaction("moveBlocks repeats a block ID");
    }
    const roots = blockIds.map((blockId) => {
      const block = current.blocks[blockId];
      if (!block || block.tombstone) {
        this.failActiveTransaction(
          `moveBlocks target ${blockId} does not exist`,
        );
      }
      return block;
    });
    const sourceParentId = roots[0]!.parentId;
    if (roots.some((block) => block.parentId !== sourceParentId)) {
      this.failActiveTransaction("moveBlocks targets must be direct siblings");
    }
    const sourceSiblings =
      sourceParentId === null
        ? current.rootBlockIds
        : (current.childIdsByParentId[sourceParentId] ?? EMPTY_BLOCK_IDS);
    const sourceIndex = sourceSiblings.indexOf(blockIds[0]!);
    if (
      sourceIndex < 0 ||
      blockIds.some(
        (blockId, offset) => sourceSiblings[sourceIndex + offset] !== blockId,
      )
    ) {
      this.failActiveTransaction(
        "moveBlocks targets must be a contiguous sibling sequence",
      );
    }
    const destination = input.destination;
    if (
      !destination ||
      !Number.isInteger(destination.childIndex) ||
      destination.childIndex < 0
    ) {
      this.failActiveTransaction("moveBlocks destination is invalid");
    }
    if (destination.parentId === sourceParentId) {
      const remaining = [
        ...sourceSiblings.slice(0, sourceIndex),
        ...sourceSiblings.slice(sourceIndex + blockIds.length),
      ];
      if (destination.childIndex > remaining.length) {
        this.failActiveTransaction("moveBlocks destination is invalid");
      }
      const moved = [...remaining];
      moved.splice(destination.childIndex, 0, ...blockIds);
      if (
        moved.length === sourceSiblings.length &&
        moved.every((blockId, index) => blockId === sourceSiblings[index])
      ) {
        return { ok: true, changed: false };
      }
    }
    const restorativeDefault = restorativeDefaultReplacementAtPlacement({
      placement: destination,
      incomingTypes: roots.map((block) => block.type),
      ...current,
      blockDefinitions: this.blockDefinitions,
    });
    if (restorativeDefault) {
      this.appendActiveTransactionOperation(
        createRemoveBlocksOperation({
          blockIds: [restorativeDefault.block.id],
          includeDescendants: true,
          expectedParents: {
            [restorativeDefault.block.id]: restorativeDefault.block.parentId,
          },
        }),
      );
    }
    this.appendActiveTransactionOperation(
      createMoveBlocksOperation({
        blockIds,
        sourcePlacement: {
          parentId: sourceParentId,
          childIndex: sourceIndex,
        },
        destinationPlacement: restorativeDefault?.placement ?? destination,
      }),
    );
    if (
      sourceParentId !== null &&
      sourceParentId !== destination.parentId &&
      blockIds.length === sourceSiblings.length
    ) {
      const sourceParent = current.blocks[sourceParentId];
      const sourceDefinition = sourceParent
        ? this.blockDefinitions[sourceParent.type]
        : undefined;
      const sourceRestorativeDefault = sourceDefinition
        ? resolveRestorativeDefault(this.blockDefinitions, sourceDefinition)
        : null;
      if (sourceRestorativeDefault) {
        const creation = materializeCanonicalBlockCreation({
          blockDefinitions: this.blockDefinitions,
          type: sourceRestorativeDefault.defaultType,
          reservedBlockIds: new Set(Object.keys(current.blocks) as BlockId[]),
        });
        const creationRoots = new Set(creation.fragment.rootBlockIds);
        this.appendActiveTransactionOperation(
          createInsertBlocksOperation({
            placement: { parentId: sourceParentId, childIndex: 0 },
            blocks: creation.fragment.blocks.map((record) =>
              creationRoots.has(record.id)
                ? { ...record, parentId: sourceParentId }
                : record,
            ),
          }),
        );
      }
    }
    return { ok: true, changed: false };
  }

  setTransactionSelection(effect: EditorTransactionSelectionEffect): void {
    const active = this.requireActiveTransaction();
    if (active.selectionRequested) {
      this.failActiveTransaction(
        "an editor transaction can settle selection only once",
      );
    }
    active.selectionRequested = true;
    if (effect.kind === "text" || effect.kind === "block") {
      const blocks = active.preview?.blocks ?? active.baseState.blocks;
      const block = blocks[effect.blockId];
      const definition = block ? this.blockDefinitions[block.type] : undefined;
      const model =
        definition?.selection ??
        (definition?.kind === "text"
          ? contentSelection()
          : definition?.kind === "atomic"
            ? wholeSelection()
            : definition?.kind === "wrapper"
              ? wrapperSelection()
              : null);
      if (
        !block ||
        block.tombstone ||
        !model?.projection.selectable ||
        (effect.kind === "text" &&
          model.projection.endpoint.kind !== "content") ||
        (effect.kind === "block" && model.projection.endpoint.kind !== "block")
      ) {
        this.failActiveTransaction("transaction selection target is invalid");
      }
      this.appendActiveTransactionOperation(
        createSetSelectionOperation(
          effect.kind === "text"
            ? {
                kind: "text-offset",
                blockId: effect.blockId,
                offset: effect.offset,
              }
            : effect.placement === "end"
              ? { kind: "block-end", blockId: effect.blockId }
              : { kind: "block-start", blockId: effect.blockId },
        ),
      );
      return;
    }
    active.finalSelectionEffect = effect;
  }

  joinTextBlocks(
    leftBlockId: BlockId,
    rightBlockId: BlockId,
  ): {
    readonly survivorBlockId: BlockId;
    readonly joinOffset: number;
  } {
    const preview = this.appendActiveTransactionOperation(
      createJoinTextBlocksOperation(leftBlockId, rightBlockId),
    );
    const joinOffset =
      preview.selection.kind === "text-offset" &&
      preview.selection.blockId === leftBlockId
        ? preview.selection.offset
        : 0;
    return Object.freeze({
      survivorBlockId: leftBlockId,
      joinOffset,
    });
  }

  executeCoreBlockKeyBehavior(input: {
    readonly blockId: BlockId;
    readonly blockType: BlockType;
    readonly key: "enter" | "backspace" | "delete";
    readonly cursorOffset: number;
    readonly selectionRange?: {
      readonly from: number;
      readonly to: number;
    };
  }): boolean {
    const current = this.getCommandState();
    const block = current.blocks[input.blockId];
    const definition = block ? this.blockDefinitions[block.type] : undefined;
    if (
      !block ||
      block.tombstone ||
      block.type !== input.blockType ||
      definition?.kind !== "text"
    ) {
      return false;
    }
    const content = this.readBlockContent(block.id, block.type);
    if (!isRichTextDocument(content)) return false;
    const selection = input.selectionRange ?? {
      from: input.cursorOffset,
      to: input.cursorOffset,
    };
    const contentSnapshot = {
      content,
      plainText:
        input.key === "enter"
          ? this.readBlockPlainText(block.id, block.type)
          : "",
      version: block.contentVersion,
    };
    const graph = {
      blocks: current.blocks,
      rootBlockIds: current.rootBlockIds,
      childIdsByParentId: current.childIdsByParentId,
      blockDefinitions: this.blockDefinitions,
    };
    const plannerInput = {
      selectionBlockId: block.id,
      selection,
      content: contentSnapshot,
      ...graph,
      readContent: (blockId: BlockId, blockType: BlockType) => {
        const target = current.blocks[blockId];
        const targetContent = this.readBlockContent(blockId, blockType);
        if (!target || target.tombstone || !isRichTextDocument(targetContent)) {
          return null;
        }
        return {
          content: targetContent,
          plainText: "",
          version: target.contentVersion,
        };
      },
    };
    const planned =
      input.key === "enter"
        ? planGenericEnter({
            selectionBlockId: block.id,
            selection,
            content: contentSnapshot,
            ...graph,
          })
        : input.key === "backspace"
          ? planBlockBoundaryBackspace(plannerInput)
          : planBlockBoundaryDelete(plannerInput);
    if (!planned.ok) return "handled" in planned && planned.handled === true;
    if ("handled" in planned && !planned.handled) return false;
    const result = this.executeStructuralTransaction(planned.plan, {
      selectionPresentation: "native-before-removal",
    });
    if (!result.ok) return false;
    const target = result.transaction.selection;
    if (target && target.kind !== "none") {
      const targetBlock = this.getBlock(target.blockId);
      const targetDefinition = targetBlock
        ? this.blockDefinitions[targetBlock.type]
        : undefined;
      if (targetBlock && !targetBlock.tombstone) {
        const targetKind =
          targetDefinition?.kind === "text"
            ? "text"
            : targetDefinition?.kind === "atomic"
              ? "atomic"
              : null;
        if (targetKind === "text" && !current.blocks[target.blockId]) {
          this.presentCanonicalTextSelection();
        } else if (targetKind === "atomic") {
          this.options.requestNativePresentation?.({
            token: Symbol(`structural-presentation:${target.blockId}`),
            blockId: target.blockId,
            targetKind: "atomic",
            graphRevision: this.getSelectionGraphRevision(),
            preventScroll: true,
            ...(target.kind === "text-offset" ? { offset: target.offset } : {}),
            ...(target.kind === "block-end"
              ? { placement: "end" as const }
              : {}),
          });
        }
      }
    }
    return true;
  }

  executeStructuralTransaction(
    plan: StructuralTransactionPlan,
    options: EditorStructuralTransactionOptions = {},
  ): EditorStructuralTransactionResult {
    if (this.activeTransaction) {
      return {
        ok: false,
        phase: "planning",
        failure: {
          ok: false,
          operationIndex: null,
          failureKind: "invalid-plan",
          message:
            "independent structural transactions are forbidden while editor.transaction is active",
        },
      };
    }
    const current = this.getCommandState();
    const planned = this.applyStructuralPlan(plan, current);
    if (!planned.ok) {
      return { ok: false, phase: "planning", failure: planned };
    }
    return this.commitStructuralTransaction(
      plan,
      current,
      planned.transaction,
      options,
      planned.defaultRootId,
    );
  }

  private applyStructuralPlan(
    plan: StructuralTransactionPlan,
    current: EditorCommandState,
    validateFinal = true,
  ): EditorStructuralPlanResult {
    const context: StructuralTransactionContext = {
      graphRevision: current.blockGraphVersion,
      blocks: current.blocks,
      rootBlockIds: current.rootBlockIds,
      childIdsByParentId: current.childIdsByParentId,
      blockDefinitions: this.blockDefinitions,
      readContent: (blockId, blockType) => {
        if (this.blockDefinitions[blockType]?.kind !== "text") return null;
        const block = current.blocks[blockId];
        const content = this.readBlockContent(blockId, blockType);
        return isRichTextDocument(content)
          ? {
              content,
              plainText: this.readBlockPlainText(blockId, blockType),
              version: block?.contentVersion ?? null,
            }
          : null;
      },
      validateContent: (blockType, content) =>
        this.options.validateBlockContent?.(blockType, content) ??
        this.defaultContentValidation(blockType, content),
      nextContentVersion: `v${current.blockGraphVersion + 1}`,
    };
    let effectivePlan = plan;
    let defaultRootId: BlockId | null = null;
    const provisional = applyStructuralTransaction(plan, context, {
      validateFinal: false,
    });
    if (!provisional.ok || !validateFinal) {
      return provisional.ok
        ? { ...provisional, defaultRootId }
        : provisional;
    }
    const shouldMaterializeDefaultRoot =
      provisional.transaction.rootBlockIds.length === 0;
    if (shouldMaterializeDefaultRoot) {
      const creation = materializeCanonicalBlockCreation({
        type: this.options.defaultRootBlockType,
        blockDefinitions: this.blockDefinitions,
        reservedBlockIds: new Set(Object.keys(current.blocks) as BlockId[]),
      });
      defaultRootId = creation.rootBlockId;
      effectivePlan = {
        ...plan,
        operations: [
          ...plan.operations,
          createInsertBlocksOperation({
            placement: { parentId: null, childIndex: 0 },
            blocks: creation.fragment.blocks,
          }),
          createSetSelectionOperation({
            kind: "text-offset",
            blockId: creation.rootBlockId,
            offset: 0,
          }),
        ],
      };
    }
    const result = applyStructuralTransaction(effectivePlan, context, {
      validateFinal: true,
    });
    return result.ok ? { ...result, defaultRootId } : result;
  }

  private commitStructuralTransaction(
    plan: StructuralTransactionPlan,
    current: EditorCommandState,
    transaction: AppliedStructuralTransaction,
    options: EditorStructuralTransactionOptions,
    defaultRootId: BlockId | null = null,
  ): EditorStructuralTransactionResult {
    const finalSelectionSuggestion =
      defaultRootId !== null || options.editorSuggestion === undefined
        ? selectionSuggestion(transaction.selection)
        : options.editorSuggestion;
    const origin = options.origin ?? "local-command";
    const requestedNextState: EditorCommandState = {
      ...current,
      blockGraphVersion: current.blockGraphVersion + 1,
      blocks: transaction.blocks as Record<BlockId, VersionedBlock>,
      rootBlockIds: transaction.rootBlockIds,
      childIdsByParentId: transaction.childIdsByParentId,
    };
    const operationInput = {
            previousState: current,
            requestedNextState,
            contentOperations: transaction.contentOperations,
            candidateBlockIds: transaction.affectedBlockIds,
            targetBlockId: selectionBlockId(transaction.selection),
            targetId: plan.origin,
          };
    const incrementalJoinHistory =
      origin === "local-command"
        ? createIncrementalTextJoinHistory(plan, current, transaction)
        : null;
    const operationPair =
      origin === "local-command" && !incrementalJoinHistory
        ? createBlockGraphOperationPair(operationInput)
        : null;
    const update = this.classifyDocumentUpdate(current, requestedNextState, {
      candidateBlockIds: transaction.affectedBlockIds,
      contentChangedBlockIds: transaction.contentOperations.map(
        (batch) => batch.blockId,
      ),
    });
    if (
      transaction.contentOperations.length === 0 &&
      !editorDocumentUpdateHasChanges(update)
    ) {
      return {
        ok: true,
        transaction,
        operationResult: {
          ok: true,
          contentResult: { ok: true, applied: 0, failures: [] },
          update,
        },
      };
    }
    const operationResult = this.commitFinalizedStructuralTransaction(
      {
        reason: "runtime-mutation",
        nextState: requestedNextState,
        contentOperations: transaction.contentOperations,
        candidateBlockIds: transaction.affectedBlockIds,
        operationTargetId: plan.origin,
        targetBlockId: selectionBlockId(transaction.selection),
        editorSuggestion: finalSelectionSuggestion,
        semanticOperation: options.semanticOperation,
        origin,
        provenance: options.provenance ?? null,
      },
      current,
      update,
      {
        selectionPresentation:
          options.selectionPresentation ?? "canonical-only",
        documentPolicyCandidateBlockIds:
          collectStructuralPolicyCandidateBlockIds(current, transaction),
        ...(defaultRootId === null && options.selectionEffect
          ? { selectionEffect: options.selectionEffect }
          : {}),
        ...(incrementalJoinHistory || operationPair
          ? {
              historyOperations: {
                forward:
                  incrementalJoinHistory?.forward ?? operationPair!.forward,
                inverse:
                  incrementalJoinHistory?.inverse ?? operationPair!.inverse,
              },
            }
          : {}),
      },
    );
    return operationResult.ok
      ? { ok: true, transaction, operationResult }
      : { ok: false, phase: "commit", operationResult };
  }

  private appendActiveTransactionOperation(
    operation: StructuralTransactionOperation,
  ): AppliedStructuralTransaction {
    const active = this.requireActiveTransaction();
    if (active.failure) {
      throw new ActiveEditorMutationFailure(active.failure.message);
    }
    active.operations.push(operation);
    const preview = this.applyStructuralPlan(
      {
        origin: "editor.transaction.preview",
        operations: active.operations,
      },
      active.baseState,
      false,
    );
    if (!preview.ok) {
      const failure: Extract<EditorTransactionResult, { ok: false }> = {
        ok: false,
        phase: "mutation",
        message: preview.message,
        failure: preview,
      };
      active.failure = failure;
      throw new ActiveEditorMutationFailure(preview.message);
    }
    active.preview = preview.transaction;
    return preview.transaction;
  }

  private requireActiveTransaction(): ActiveEditorTransaction {
    if (!this.activeTransaction) {
      throw new Error(
        "transaction mutations require an active editor.transaction callback",
      );
    }
    return this.activeTransaction;
  }

  private failActiveTransaction(message: string): never {
    const active = this.requireActiveTransaction();
    active.failure = { ok: false, phase: "mutation", message };
    throw new ActiveEditorMutationFailure(message);
  }

  readBlockPlainText(blockId: BlockId, blockType: BlockType): string {
    return this.options.readBlockPlainText?.(blockId, blockType) ?? "";
  }

  readBlockContent(
    blockId: BlockId,
    blockType: BlockType,
  ): RichTextDocumentNodeJson | null {
    return this.options.readBlockContent?.(blockId, blockType) ?? null;
  }

  acceptContentOperationProposal(
    proposal: EditorContentOperationProposal,
    context: ContentOperationProposalAcceptanceContext,
  ): EditorContentOperationProposalResult {
    const coordinated = this.commitPreparedContentTransaction({
      graphRevision: proposal.base.graphRevision,
      changes: [{ baseToken: proposal.base, operations: proposal.operations }],
      selectionEffect: { kind: "preserve" },
      preparedSelectionAfter: proposal.selectionAfter,
      origin: context.origin,
      selectionPresentation: context.selectionPresentation,
      history: "record",
      historyAction: "command",
      provenance: context.provenance,
      releaseAfterProposedStateInstalled:
        context.releaseAfterProposedStateInstalled ?? false,
      contentCommitOrigin: context.contentCommitOrigin,
    });
    if (!coordinated.ok) {
      return {
        ok: false,
        reason: coordinated.reason,
        message: coordinated.message,
      };
    }
    const committedBlock = coordinated.commit.blocks.find(
      (block) => block.blockId === proposal.base.blockId,
    );
    if (!committedBlock) {
      return {
        ok: false,
        reason: "no-change",
        message: "Content proposal produced no authoritative change",
      };
    }
    return {
      ok: true,
      commit: coordinated.commit,
      release: coordinated.release,
    };
  }

  private commitPreparedContentTransaction(
    input: PreparedContentEditorTransaction,
  ): PreparedContentEditorTransactionResult {
    const baseDocumentRevision = this.documentRevision;
    const canonicalSelectionBefore =
      this.selectionController.getCanonicalSnapshot();
    let historySelectionBefore: EditorHistorySelection | null = null;
    const readHistorySelectionBefore = (): EditorHistorySelection => {
      historySelectionBefore ??= this.captureHistorySelection(
        canonicalSelectionBefore,
      );
      return historySelectionBefore;
    };
    if (input.changes.length === 0) {
      return {
        ok: false,
        reason: "invalid-operation",
        message: "A content transaction must contain a change",
      };
    }
    const contentCommit = this.options.contentCommit;
    if (!contentCommit) {
      return {
        ok: false,
        reason: "application-failed",
        message: "Content transaction coordination is unavailable",
      };
    }
    let prepared: ValidatedContentCommit | ContentCommitRejection;
    try {
      prepared = contentCommit.validateContentCommit({
        graphRevision: input.graphRevision,
        changes: input.changes,
        origin: input.contentCommitOrigin ?? input.origin,
      });
    } catch (error) {
      return {
        ok: false,
        reason: "application-failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    if (!("kind" in prepared)) {
      return {
        ok: false,
        reason: prepared.reason,
        message: prepared.message,
      };
    }
    const preparedSelection =
      input.preparedSelectionAfter === undefined
        ? undefined
        : this.validatePreparedContentSelection(
            contentCommit,
            prepared,
            input.preparedSelectionAfter,
          );
    if (preparedSelection && !preparedSelection.ok) {
      return {
        ok: false,
        reason: "invalid-operation",
        message: preparedSelection.message,
      };
    }
    if (prepared.affectedBlockIds.length === 0) {
      return {
        ok: false,
        reason: "no-change",
        message: "Content transaction produced no authoritative change",
      };
    }
    const historyForwardOperation =
      input.history === "record"
        ? composePreparedContentOperations(prepared.blocks, "contentOperations")
        : null;
    const historyInverseOperation =
      input.history === "record"
        ? composePreparedContentOperations(
            [...prepared.blocks].reverse(),
            "inverseContentOperations",
          )
        : null;
    const preparedHistorySelectionBefore = historyInverseOperation
      ? this.prepareReplayHistorySelection(
          readHistorySelectionBefore(),
          historyInverseOperation,
          "replay-result",
        )
      : null;
    if (preparedHistorySelectionBefore && !preparedHistorySelectionBefore.ok) {
      return {
        ok: false,
        reason: "application-failed",
        message: preparedHistorySelectionBefore.message,
      };
    }
    let applied: AppliedContentCommit;
    try {
      applied = contentCommit.commitContent(prepared);
    } catch (error) {
      return {
        ok: false,
        reason: "application-failed",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    const preparedSelectionEffect =
      preparedSelection === undefined
        ? undefined
        : preparedSelection.selection === null
          ? ({ kind: "clear" } as const)
          : this.createSelectionEffectFromPreparedContentSelection(
              preparedSelection.selection,
            );
    if (preparedSelection !== undefined && !preparedSelectionEffect) {
      contentCommit.markInconsistent(
        "The accepted content selection could not be anchored after live content mutation",
      );
    }
    const requestedContentSelectionEffect =
      preparedSelectionEffect ??
      (input.selectionEffect.kind === "preserve"
        ? (this.createSelectionEffectFromSuggestion(input.editorSuggestion) ??
          input.selectionEffect)
        : input.selectionEffect);
    let selectionEffect = requestedContentSelectionEffect;
    if (selectionEffect.kind === "preserve") {
      if (canonicalSelectionBefore.kind === "block-internal") {
        selectionEffect = this.historySelectionEffect(
          readHistorySelectionBefore(),
        );
      } else {
        const selectionBefore = this.readCanonicalEditorSelection(
          canonicalSelectionBefore,
        );
        selectionEffect = selectionBefore
          ? { kind: "selection", selection: selectionBefore }
          : { kind: "clear" };
      }
    }
    const preparedHistorySelectionAfter = historyForwardOperation
      ? this.prepareReplayHistorySelection(
          this.captureHistorySelectionEffect(selectionEffect),
          historyForwardOperation,
          "replay-result",
        )
      : null;
    if (preparedHistorySelectionAfter && !preparedHistorySelectionAfter.ok) {
      contentCommit.markInconsistent(
        `${preparedHistorySelectionAfter.message} after live content mutation`,
      );
    }
    const transactionId = this.createTransactionId();
    this.documentRevision += 1;
    this.applyCanonicalSelectionEffect(
      selectionEffect,
      input.selectionPresentation,
      {
        publication: { kind: "transaction", transactionId },
        cause: contentTransactionSelectionCause(input.origin),
      },
    );
    const canonicalSelectionAfter =
      this.selectionController.getCanonicalSnapshot();
    if (
      historyForwardOperation &&
      historyInverseOperation &&
      preparedHistorySelectionBefore?.ok &&
      preparedHistorySelectionAfter?.ok
    ) {
      this.recordHistoryEntry({
        forward: historyForwardOperation,
        inverse: historyInverseOperation,
        selectionBefore: preparedHistorySelectionBefore.selection,
        selectionAfter: preparedHistorySelectionAfter.selection,
      });
    }
    const publishedSelectionBefore = projectCanonicalSelectionToTransaction(
      canonicalSelectionBefore,
    );
    const publishedSelectionAfter = projectCanonicalSelectionToTransaction(
      canonicalSelectionAfter,
    );
    const release = () => {
      try {
        const publishedBlock = applied.blocks[0];
        if (!publishedBlock || applied.blocks.length !== 1) {
          throw new Error("A content receipt must affect exactly one block");
        }
        this.options.onCanonicalCommit?.({
          kind: "content",
          transactionId,
          baseDocumentRevision,
          documentRevision: this.documentRevision,
          selectionBefore: publishedSelectionBefore,
          selectionAfter: publishedSelectionAfter,
          historyAction: input.historyAction,
          provenance: input.provenance,
          blockId: publishedBlock.blockId,
          blockType: publishedBlock.blockType,
          operations: publishedBlock.contentOperations,
          inverseOperations: publishedBlock.inverseContentOperations,
          yjsUpdate: publishedBlock.operationUpdate,
        });
      } catch {
        // The canonical commit is durable; observer failures are isolated.
      }
      contentCommit.publishContentCommit(applied);
    };
    if (input.releaseAfterProposedStateInstalled) {
      let released = false;
      return {
        ok: true,
        commit: applied,
        release: () => {
          if (released) return;
          released = true;
          release();
        },
      };
    }
    release();
    return { ok: true, commit: applied, release: null };
  }

  private readCanonicalEditorSelection(
    canonical: CanonicalLocalSelection = this.selectionController.canonical.getSnapshot(),
  ): EditorSelection | null {
    if (canonical.kind === "document") {
      const selection = canonical.snapshot.documentSelection;
      if (selection.anchor && selection.focus && selection.direction) {
        return {
          anchor: selection.anchor,
          focus: selection.focus,
          direction: selection.direction,
        };
      }
    }
    return null;
  }

  private captureHistorySelection(
    canonical: CanonicalLocalSelection = this.selectionController.getCanonicalSnapshot(),
  ): EditorHistorySelection {
    if (canonical.kind === "none") return Object.freeze({ kind: "none" });
    if (canonical.kind === "document") {
      const selection = this.readCanonicalEditorSelection(canonical);
      if (!selection) return Object.freeze({ kind: "none" });
      return Object.freeze({
        kind: "document",
        selection: Object.freeze(selection),
      });
    }
    const blockId = canonical.snapshot.internal?.blockId;
    const coverageResult = canonical.snapshot.blocks.find(
      (block) => block.blockId === blockId,
    )?.coverageResult;
    if (!blockId || !coverageResult) {
      throw new Error(
        "Canonical block-internal selection has no restorable block coverage",
      );
    }
    return Object.freeze({
      kind: "block-internal",
      blockId,
      subsystem: canonical.subsystem,
      coverageResult,
    });
  }

  private captureHistorySelectionEffect(
    effect: Exclude<
      EditorCanonicalSelectionEffect,
      { readonly kind: "preserve" }
    >,
  ): EditorHistorySelection {
    if (effect.kind === "history-selection") return effect.selection;
    if (effect.kind === "clear") return Object.freeze({ kind: "none" });
    if (effect.kind === "selection") {
      return Object.freeze({
        kind: "document",
        selection: Object.freeze(effect.selection),
      });
    }
    return Object.freeze({
      kind: "block-internal",
      blockId: effect.blockId,
      subsystem: effect.subsystem,
      coverageResult: effect.coverageResult,
    });
  }

  private prepareReplayHistorySelection(
    selection: EditorHistorySelection,
    replayOperation: EditorOperation,
    currentContentSide: "replay-input" | "replay-result",
    graph: EditorSelectionGraphReader = this,
  ):
    | { readonly ok: true; readonly selection: EditorHistorySelection }
    | { readonly ok: false; readonly message: string } {
    if (selection.kind !== "document") return { ok: true, selection };
    const contentOperations = historyReplayContentOperations(replayOperation);
    if (contentOperations.length === 0) return { ok: true, selection };
    const finalizePoint = (
      point: EditorLogicalSelectionPoint,
    ):
      | { readonly ok: true; readonly point: EditorLogicalSelectionPoint }
      | { readonly ok: false; readonly message: string } => {
      if (!point.textAnchor) return { ok: true, point };
      const replayMapping = historyReplayPointMapping(point, contentOperations);
      const affinity = replayMapping.affinity;
      if (affinity === point.affinity) return { ok: true, point };
      if (
        !this.options.resolveSelectionTextAnchor ||
        !this.options.createSelectionTextAnchor
      ) {
        return {
          ok: false,
          message: `History replay anchor services are unavailable for ${point.blockId}`,
        };
      }
      const resolved = resolveEditorSelectionTextAnchorPoint(point, graph, {
        resolveTextAnchor: this.options.resolveSelectionTextAnchor,
      });
      if (!resolved.ok) {
        return {
          ok: false,
          message: `History replay anchor could not be resolved for ${point.blockId}`,
        };
      }
      const created = this.options.createSelectionTextAnchor({
        blockId: resolved.blockId,
        blockType: point.blockType,
        textOffset:
          currentContentSide === "replay-input"
            ? replayMapping.inputOffset
            : point.textOffset,
        affinity,
      });
      if (!created.ok) {
        return {
          ok: false,
          message: `History replay anchor could not be created for ${point.blockId}`,
        };
      }
      return {
        ok: true,
        point: Object.freeze({
          ...point,
          textOffset: point.textOffset,
          textAnchor: created.textAnchor,
          affinity,
        }),
      };
    };
    const anchor = finalizePoint(selection.selection.anchor);
    if (!anchor.ok) return anchor;
    const focus = sameLogicalSelectionPoint(
      selection.selection.anchor,
      selection.selection.focus,
    )
      ? anchor
      : finalizePoint(selection.selection.focus);
    if (!focus.ok) return focus;
    return {
      ok: true,
      selection: Object.freeze({
        kind: "document",
        selection: Object.freeze({
          direction: selection.selection.direction,
          anchor: anchor.point,
          focus: focus.point,
        }),
      }),
    };
  }

  private historySelectionEffect(
    selection: EditorHistorySelection,
  ): Exclude<EditorCanonicalSelectionEffect, { readonly kind: "preserve" }> {
    return { kind: "history-selection", selection };
  }

  private validateContentProposalBase(base: EditorContentBaseToken): {
    readonly reason:
      | "stale-graph-revision"
      | "missing-block"
      | "block-type-mismatch"
      | "stale-content-revision";
    readonly message: string;
  } | null {
    if (this.disposed) {
      return {
        reason: "missing-block",
        message: "Editor is disposed",
      };
    }
    if (base.graphRevision !== this.getSelectionGraphRevision()) {
      return {
        reason: "stale-graph-revision",
        message: `Content proposal graph revision ${base.graphRevision} is stale`,
      };
    }
    const block = this.getBlock(base.blockId);
    if (!block || block.tombstone) {
      return {
        reason: "missing-block",
        message: `Content proposal block ${base.blockId} does not exist`,
      };
    }
    if (block.type !== base.blockType) {
      return {
        reason: "block-type-mismatch",
        message: `Content proposal block ${base.blockId} changed type`,
      };
    }
    try {
      const current = this.options.contentCommit?.readContentBaseToken(
        base.blockId,
        base.blockType,
        base.graphRevision,
      );
      if (!current || current.contentRevision !== base.contentRevision) {
        return {
          reason: "stale-content-revision",
          message: `Content proposal block ${base.blockId} has a stale projection revision`,
        };
      }
    } catch (error) {
      return {
        reason: "stale-content-revision",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const dispose of this.disposables.splice(0).reverse()) {
      this.runCleanup(dispose);
    }
    this.manifestListeners.clear();
    this.rootBlockIdListeners.clear();
    this.blockListenersById.clear();
    this.blockChildSequenceListenersByKey.clear();
    this.commandAvailabilityListeners.clear();
    this.editableDocumentLeaseActive = false;
    this.selectionController.dispose();
  }

  private runCleanup(cleanup: () => void): void {
    try {
      cleanup();
    } catch {
      this.cleanupFailureCount += 1;
    }
  }

  private commitInitialBootstrap(
    data: EditorBootstrapPatch,
    classification: {
      readonly candidateBlockIds?: readonly BlockId[];
      readonly contentChangedBlockIds?: readonly BlockId[];
    } = {},
    origin: EditorCanonicalGraphMutationOrigin = "bootstrap",
  ): EditorCommandState {
    if (data.blockGraphVersion !== undefined) {
      assertValidBlockGraphVersion(data.blockGraphVersion);
    }
    const current = this.getCommandState();
    const blocks = data.blocks ?? current.blocks;
    const rootBlockIds = data.rootBlockIds ?? current.rootBlockIds;
    const childIdsByParentId =
      data.childIdsByParentId ?? current.childIdsByParentId;
    const next = {
      ...current,
      ...(data.blockGraphVersion !== undefined
        ? { blockGraphVersion: data.blockGraphVersion }
        : {}),
      ...(data.createdAt !== undefined ? { createdAt: data.createdAt } : {}),
      ...(data.updatedAt !== undefined ? { updatedAt: data.updatedAt } : {}),
      blocks,
      rootBlockIds,
      childIdsByParentId,
    };
    const structuralValidation = validateStructuralDocument({
      blocks: next.blocks,
      rootBlockIds: next.rootBlockIds,
      childIdsByParentId: next.childIdsByParentId,
      blockDefinitions: this.blockDefinitions,
      validators: this.options.documentValidators,
    });
    if (!structuralValidation.valid) {
      throw new Error(
        `editor graph reconciliation is structurally invalid: ${structuralValidation.issues
          .map((issue) => issue.message)
          .join("; ")}`,
      );
    }
    if (Object.is(next, current)) return current;
    this.commitCanonicalGraphMutation(
      next,
      this.classifyDocumentUpdate(current, next, classification),
      origin,
    );
    return next;
  }

  getCommandState(): EditorCommandState {
    return createEditorCommandState(
      this.store.getSnapshot(),
      this.manifestState,
    );
  }

  /**
   * Finalizes the exact structural candidate produced by the model. Local
   * structural editing never re-materializes that candidate as a durable
   * transformBlocks snapshot before committing it.
   */
  private commitFinalizedStructuralTransaction(
    request: EditorOperationRequest,
    previousState: EditorCommandState,
    update: EditorDocumentUpdate,
    options: {
      readonly historyOperations?: Pick<
        EditorHistoryEntry,
        "forward" | "inverse"
      >;
      readonly selectionEffect?: EditorCanonicalSelectionEffect;
      readonly selectionPresentation:
        | "canonical-only"
        | "native-before-removal";
      readonly documentPolicyCandidateBlockIds: readonly BlockId[];
    },
  ): EditorOperationResult {
    if (this.disposed) {
      return {
        ok: false,
        reason: "runtime-disposed",
        contentResult: { ok: false, applied: 0, failures: [] },
      };
    }
    const baseDocumentRevision = this.documentRevision;
    const canonicalSelectionBefore =
      this.selectionController.getCanonicalSnapshot();
    const publishedSelectionBefore = projectCanonicalSelectionToTransaction(
      canonicalSelectionBefore,
    );
    const historySelectionBefore = options.historyOperations
      ? this.captureHistorySelection(canonicalSelectionBefore)
      : null;
    const preparedContent = this.prepareDocumentContentCommit(
      request.contentOperations,
      previousState,
      request.nextState,
      request.origin ?? "local-command",
      request.candidateBlockIds,
    );
    if (preparedContent && !("kind" in preparedContent)) {
      return {
        ok: false,
        reason: "content-operations-rejected",
        contentResult: { ok: false, applied: 0, failures: [] },
        update,
      };
    }
    const policyFailures = this.options.documentValidators?.flatMap(
      (validator) => {
        try {
          return validator({
            blocks: request.nextState.blocks,
            rootBlockIds: request.nextState.rootBlockIds,
            childIdsByParentId: request.nextState.childIdsByParentId,
            blockDefinitions: this.blockDefinitions,
            candidateBlockIds: options.documentPolicyCandidateBlockIds,
            readContent: (blockId, blockType) => {
              const block = request.nextState.blocks[blockId];
              if (!block || block.tombstone || block.type !== blockType) {
                return null;
              }
              const content = preparedContent
                ? this.options.contentCommit!.readValidatedBlockContent(
                    preparedContent,
                    blockId,
                    blockType,
                  )
                : this.readBlockContent(blockId, blockType);
              return content && isRichTextDocument(content)
                ? {
                    content,
                    plainText: extractPlainTextFromRichTextDocument(content),
                    version: block.contentVersion,
                  }
                : null;
            },
          });
        } catch (error) {
          return [error instanceof Error ? error.message : String(error)];
        }
      },
    );
    if (policyFailures?.length) {
      return {
        ok: false,
        reason: "content-operations-rejected",
        contentResult: { ok: false, applied: 0, failures: [] },
        update,
      };
    }
    const historyOperations =
      options.historyOperations && preparedContent
        ? historyOperationsFromPreparedContent(
            options.historyOperations,
            preparedContent,
          )
        : (options.historyOperations ?? null);
    if (options.historyOperations && !historyOperations) {
      return {
        ok: false,
        reason: "content-operations-rejected",
        contentResult: { ok: false, applied: 0, failures: [] },
        update,
      };
    }
    const preparedHistorySelectionBefore =
      historyOperations && historySelectionBefore
        ? this.prepareReplayHistorySelection(
            historySelectionBefore,
            historyOperations.inverse,
            "replay-result",
            selectionGraphReaderForCommandState(
              previousState,
              this.blockDefinitions,
            ),
          )
        : null;
    if (preparedHistorySelectionBefore && !preparedHistorySelectionBefore.ok) {
      return {
        ok: false,
        reason: "content-operations-rejected",
        contentResult: { ok: false, applied: 0, failures: [] },
        update,
      };
    }
    let appliedContent: AppliedContentCommit | null = null;
    if (preparedContent) {
      try {
        appliedContent = this.options.contentCommit!.commitContent(
          preparedContent,
        );
      } catch {
        return {
          ok: false,
          reason: "content-operations-rejected",
          contentResult: { ok: false, applied: 0, failures: [] },
          update,
        };
      }
    }
    const contentResult: EditorContentOperationApplyResult = {
      ok: true,
      applied: request.contentOperations.reduce(
        (count, batch) => count + batch.operations.length,
        0,
      ),
      failures: [],
    };
    const explicitSelectionEffect =
      options.selectionEffect ?? request.selectionEffect;
    const suggestedSelectionEffect = explicitSelectionEffect
      ? null
      : this.createSelectionEffectFromSuggestionWithContentAccess(
          request.editorSuggestion,
          request.nextState.blocks,
        );
    let canonicalSelectionEffect: EditorCanonicalSelectionEffect =
      explicitSelectionEffect ??
        suggestedSelectionEffect ?? { kind: "preserve" as const };
    if (canonicalSelectionEffect.kind === "history-selection") {
      const materialized = this.materializeHistorySelectionEffect(
        canonicalSelectionEffect.selection,
        selectionGraphReaderForCommandState(
          request.nextState,
          this.blockDefinitions,
        ),
      );
      if (!materialized) {
        if (appliedContent) {
          this.options.contentCommit!.markInconsistent(
            `history ${request.origin ?? "command"} selection could not be resolved after live content mutation`,
          );
        }
        return {
          ok: false,
          reason: "content-operations-rejected",
          contentResult: { ok: false, applied: 0, failures: [] },
          update,
        };
      }
      canonicalSelectionEffect = materialized;
    }
    const preparedHistorySelectionAfter = historyOperations
      ? this.prepareReplayHistorySelection(
          canonicalSelectionEffect.kind === "preserve"
            ? (historySelectionBefore ?? Object.freeze({ kind: "none" }))
            : this.captureHistorySelectionEffect(canonicalSelectionEffect),
          historyOperations.forward,
          "replay-result",
          selectionGraphReaderForCommandState(
            request.nextState,
            this.blockDefinitions,
          ),
        )
      : null;
    if (preparedHistorySelectionAfter && !preparedHistorySelectionAfter.ok) {
      if (appliedContent) {
        this.options.contentCommit!.markInconsistent(
          `${preparedHistorySelectionAfter.message} after live content mutation`,
        );
      }
      return {
        ok: false,
        reason: "content-operations-rejected",
        contentResult: { ok: false, applied: 0, failures: [] },
        update,
      };
    }
    const transactionId = this.createTransactionId();
    let notifyDocumentSubscribers: () => void;
    try {
      notifyDocumentSubscribers = this.commitCanonicalGraphMutation(
        request.nextState,
        update,
        operationRequestMutationOrigin(request),
        true,
        canonicalSelectionEffect,
        appliedContent !== null,
        {
          publication: { kind: "transaction", transactionId },
          cause: graphTransactionSelectionCause(request.origin),
        },
      );
    } catch (error) {
      if (appliedContent) {
        this.options.contentCommit!.markInconsistent(
          `Graph commit failed after live content mutation: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return {
        ok: false,
        reason: "content-operations-rejected",
        contentResult: { ok: false, applied: 0, failures: [] },
        update,
      };
    }
    const canonicalSelectionAfter =
      this.selectionController.getCanonicalSnapshot();
    if (
      historyOperations &&
      preparedHistorySelectionBefore?.ok &&
      preparedHistorySelectionAfter?.ok
    ) {
      this.recordHistoryEntry({
        ...historyOperations,
        selectionBefore: preparedHistorySelectionBefore.selection,
        selectionAfter: preparedHistorySelectionAfter.selection,
      });
    }
    const publishedSelectionAfter = projectCanonicalSelectionToTransaction(
      canonicalSelectionAfter,
    );
    try {
      this.options.onCanonicalCommit?.({
        kind: "block-graph",
        transactionId,
        baseDocumentRevision,
        documentRevision: this.documentRevision,
        selectionBefore: publishedSelectionBefore,
        selectionAfter: publishedSelectionAfter,
        historyAction: graphTransactionHistoryAction(request.origin),
        provenance: request.provenance,
        graphChanges: createCanonicalGraphChangesFromStates(
          previousState,
          request.nextState,
          request.candidateBlockIds ?? [],
          graphTransactionHistoryAction(request.origin),
        ),
        ...(appliedContent === null ? {} : { contentCommit: appliedContent }),
      });
    } catch {
      // Observer failures cannot invalidate the finalized local transaction.
    }
    if (appliedContent) {
      this.options.contentCommit!.publishContentCommit(appliedContent);
    }
    if (options.selectionPresentation === "native-before-removal") {
      this.presentCanonicalTextSelection();
    }
    if (appliedContent) notifyDocumentSubscribers();
    return { ok: true, contentResult, update };
  }

  private applyPreparedGraphTransaction(
    request: EditorOperationRequest,
    options: {
      readonly structuralDraftAlreadyValidated?: boolean;
      readonly historyOperations?: Pick<
        EditorHistoryEntry,
        "forward" | "inverse"
      >;
      readonly preparedBlockGraphOperation?: PreparedEditorBlockGraphOperation;
      readonly selectionEffect?: EditorCanonicalSelectionEffect;
      readonly selectionPresentation?:
        | "canonical-only"
        | "native-before-removal";
    } = {},
  ): EditorOperationResult {
    if (this.disposed) {
      return {
        ok: false,
        reason: "runtime-disposed",
        contentResult: { ok: false, applied: 0, failures: [] },
      };
    }
    const previousState = this.getCommandState();
    if (
      request.expectedMetadataVersions &&
      !metadataVersionsMatchCurrentState(
        previousState.blocks,
        request.expectedMetadataVersions,
      )
    ) {
      return {
        ok: false,
        reason: "invalid-operation",
        contentResult: { ok: false, applied: 0, failures: [] },
      };
    }
    if (
      request.canonicalOperation?.kind === "updateBlockMetadata" &&
      !this.metadataEditorRequestMatchesCurrentState(previousState, request)
    ) {
      return {
        ok: false,
        reason: "invalid-operation",
        contentResult: { ok: false, applied: 0, failures: [] },
      };
    }
    const durableOperation =
      options.preparedBlockGraphOperation ??
      this.createDurableBlockGraphOperation(previousState, request);
    if (!durableOperation) {
      const update = this.classifyDocumentUpdate(
        previousState,
        request.nextState,
        {
          contentChangedBlockIds: request.contentOperations.map(
            (batch) => batch.blockId,
          ),
        },
      );
      const explicitSelectionEffect =
        options.selectionEffect ?? request.selectionEffect;
      const suggestedSelectionEffect = explicitSelectionEffect
        ? null
        : this.createSelectionEffectFromSuggestion(
            request.editorSuggestion,
            request.nextState.blocks,
          );
      const selectionEffect =
        explicitSelectionEffect ?? suggestedSelectionEffect ?? undefined;
      if (editorDocumentUpdateHasChanges(update)) {
        this.commitCanonicalGraphMutation(
          request.nextState,
          update,
          operationRequestMutationOrigin(request),
          options.structuralDraftAlreadyValidated,
          selectionEffect,
        );
      } else {
        this.applyCanonicalSelectionEffect(selectionEffect, "canonical-only");
      }
      return {
        ok: true,
        contentResult: { ok: true, applied: 0, failures: [] },
        update,
      };
    }
    const operation = durableOperation.operation;
    if (!options.structuralDraftAlreadyValidated) {
      const operationValidation = validateBlockGraphOperationBody(
        operation.body,
        { blockDefinitions: this.blockDefinitions },
      );
      if (!operationValidation.valid) {
        const failure = createEditorOperationFailure({
          request,
          previousState,
          message: operationValidation.errors.join(", "),
        });
        return {
          ok: false,
          reason: "invalid-operation",
          operation,
          update: durableOperation.update,
          contentResult: {
            ok: false,
            applied: 0,
            failures: failure ? [failure] : [],
          },
        };
      }
      const finalMetadataErrors = validateEditorMetadataGraph({
        previousBlocks: previousState.blocks,
        nextBlocks: durableOperation.blocks,
        nextChildIdsByParentId: operation.body.payload.childIdsByParentId,
        affectedBlockIds: operation.body.payload.affectedBlockIds,
        blockDefinitions: this.blockDefinitions,
      });
      if (finalMetadataErrors.length > 0) {
        const failure = createEditorOperationFailure({
          request,
          previousState,
          message: finalMetadataErrors.join(", "),
        });
        return {
          ok: false,
          reason: "invalid-operation",
          operation,
          update: durableOperation.update,
          contentResult: {
            ok: false,
            applied: 0,
            failures: failure ? [failure] : [],
          },
        };
      }
    }
    const optimisticState = stateFromDurableOperationResult(
      previousState,
      request.nextState,
      operation,
      durableOperation,
    );
    const baseDocumentRevision = this.documentRevision;
    const canonicalSelectionBefore =
      this.selectionController.getCanonicalSnapshot();
    const publishedSelectionBefore = projectCanonicalSelectionToTransaction(
      canonicalSelectionBefore,
    );
    const historySelectionBefore = options.historyOperations
      ? this.captureHistorySelection(canonicalSelectionBefore)
      : null;
    const preparedContent = this.prepareDocumentContentCommit(
      request.contentOperations,
      previousState,
      optimisticState,
      request.origin ?? "local-command",
      request.candidateBlockIds,
    );
    if (preparedContent && !("kind" in preparedContent)) {
      const failure = createEditorOperationFailure({
        request,
        previousState,
        message: preparedContent.message,
      });
      return {
        ok: false,
        reason: "content-operations-rejected",
        operation,
        update: durableOperation.update,
        contentResult: {
          ok: false,
          applied: 0,
          failures: failure ? [failure] : [],
        },
      };
    }
    const historyOperations =
      options.historyOperations &&
      preparedContent &&
      preparedContent.blocks.some(
        (block) =>
          block.contentOperations.length > 0 ||
          block.inverseContentOperations.length > 0,
      )
        ? historyOperationsFromPreparedContent(
            options.historyOperations,
            preparedContent,
          )
        : (options.historyOperations ?? null);
    if (options.historyOperations && !historyOperations) {
      const failure = createEditorOperationFailure({
        request,
        previousState,
        message:
          "Content-bearing graph history requires block-graph operations",
      });
      return {
        ok: false,
        reason: "content-operations-rejected",
        operation,
        update: durableOperation.update,
        contentResult: {
          ok: false,
          applied: 0,
          failures: failure ? [failure] : [],
        },
      };
    }
    const effectiveOperation = preparedContent
      ? graphOperationFromPreparedContent(operation, preparedContent, "forward")
      : operation;
    const preparedHistorySelectionBefore =
      historyOperations && historySelectionBefore
        ? this.prepareReplayHistorySelection(
            historySelectionBefore,
            historyOperations.inverse,
            "replay-result",
            selectionGraphReaderForCommandState(
              previousState,
              this.blockDefinitions,
            ),
          )
        : null;
    if (preparedHistorySelectionBefore && !preparedHistorySelectionBefore.ok) {
      const failure = createEditorOperationFailure({
        request,
        previousState,
        message: preparedHistorySelectionBefore.message,
      });
      return {
        ok: false,
        reason: "content-operations-rejected",
        operation,
        update: durableOperation.update,
        contentResult: {
          ok: false,
          applied: 0,
          failures: failure ? [failure] : [],
        },
      };
    }
    let appliedContent: AppliedContentCommit | null = null;
    if (preparedContent) {
      try {
        appliedContent =
          this.options.contentCommit!.commitContent(preparedContent);
      } catch (error) {
        const failure = createEditorOperationFailure({
          request,
          previousState,
          message: error instanceof Error ? error.message : String(error),
        });
        return {
          ok: false,
          reason: "content-operations-rejected",
          operation,
          update: durableOperation.update,
          contentResult: {
            ok: false,
            applied: 0,
            failures: failure ? [failure] : [],
          },
        };
      }
    }
    const contentResult: EditorContentOperationApplyResult = {
      ok: true,
      applied: request.contentOperations.reduce(
        (count, batch) => count + batch.operations.length,
        0,
      ),
      failures: [],
    };
    let notifyDocumentSubscribers: () => void;
    const explicitSelectionEffect =
      options.selectionEffect ?? request.selectionEffect;
    const suggestedSelectionEffect = explicitSelectionEffect
      ? null
      : this.createSelectionEffectFromSuggestion(
          request.editorSuggestion,
          optimisticState.blocks,
        );
    let canonicalSelectionEffect: EditorCanonicalSelectionEffect =
      explicitSelectionEffect ??
        suggestedSelectionEffect ?? { kind: "preserve" as const };
    if (canonicalSelectionEffect.kind === "history-selection") {
      const materializedHistorySelection =
        this.materializeHistorySelectionEffect(
          canonicalSelectionEffect.selection,
          selectionGraphReaderForCommandState(
            optimisticState,
            this.blockDefinitions,
          ),
        );
      if (!materializedHistorySelection) {
        if (appliedContent) {
          this.options.contentCommit!.markInconsistent(
            `history ${request.origin ?? "command"} selection could not be resolved after live content mutation`,
          );
        }
        const failure = createEditorOperationFailure({
          request,
          previousState,
          message: `history ${request.origin ?? "command"} selection could not be resolved`,
        });
        return {
          ok: false,
          reason: "content-operations-rejected",
          operation,
          update: durableOperation.update,
          contentResult: {
            ok: false,
            applied: 0,
            failures: failure ? [failure] : [],
          },
        };
      }
      canonicalSelectionEffect = materializedHistorySelection;
    }
    const preparedHistorySelectionAfter = historyOperations
      ? this.prepareReplayHistorySelection(
          canonicalSelectionEffect.kind === "preserve"
            ? (historySelectionBefore ?? Object.freeze({ kind: "none" }))
            : this.captureHistorySelectionEffect(canonicalSelectionEffect),
          historyOperations.forward,
          "replay-result",
          selectionGraphReaderForCommandState(
            optimisticState,
            this.blockDefinitions,
          ),
        )
      : null;
    if (preparedHistorySelectionAfter && !preparedHistorySelectionAfter.ok) {
      if (appliedContent) {
        this.options.contentCommit!.markInconsistent(
          `${preparedHistorySelectionAfter.message} after live content mutation`,
        );
      }
      const failure = createEditorOperationFailure({
        request,
        previousState,
        message: preparedHistorySelectionAfter.message,
      });
      return {
        ok: false,
        reason: "content-operations-rejected",
        operation,
        update: durableOperation.update,
        contentResult: {
          ok: false,
          applied: 0,
          failures: failure ? [failure] : [],
        },
      };
    }
    const transactionId = this.createTransactionId();
    try {
      notifyDocumentSubscribers = this.commitCanonicalGraphMutation(
        optimisticState,
        durableOperation.update,
        operationRequestMutationOrigin(request),
        options.structuralDraftAlreadyValidated,
        canonicalSelectionEffect,
        appliedContent !== null,
        {
          publication: { kind: "transaction", transactionId },
          cause: graphTransactionSelectionCause(request.origin),
        },
      );
    } catch (error) {
      if (appliedContent) {
        this.options.contentCommit!.markInconsistent(
          `Graph commit failed after live content mutation: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      const failure = createEditorOperationFailure({
        request,
        previousState,
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        ok: false,
        reason: "content-operations-rejected",
        operation,
        update: durableOperation.update,
        contentResult: {
          ok: false,
          applied: 0,
          failures: failure ? [failure] : [],
        },
      };
    }
    const canonicalSelectionAfter =
      this.selectionController.getCanonicalSnapshot();
    if (
      historyOperations &&
      preparedHistorySelectionBefore?.ok &&
      preparedHistorySelectionAfter?.ok
    ) {
      this.recordHistoryEntry({
        ...historyOperations,
        selectionBefore: preparedHistorySelectionBefore.selection,
        selectionAfter: preparedHistorySelectionAfter.selection,
      });
    }
    const publishedSelectionAfter = projectCanonicalSelectionToTransaction(
      canonicalSelectionAfter,
    );
    try {
      const receiptBase = {
        transactionId,
        baseDocumentRevision,
        documentRevision: this.documentRevision,
        selectionBefore: publishedSelectionBefore,
        selectionAfter: publishedSelectionAfter,
        historyAction: graphTransactionHistoryAction(request.origin),
        provenance: request.provenance,
      } as const;
      this.options.onCanonicalCommit?.(
        request.canonicalOperation?.kind === "updateBlockMetadata"
          ? {
              ...receiptBase,
              kind: "block-metadata",
              operation: request.canonicalOperation,
            }
          : {
              ...receiptBase,
              kind: "block-graph",
              graphChanges: createCanonicalGraphChanges(
                previousState,
                effectiveOperation.body.payload,
                graphTransactionHistoryAction(request.origin),
              ),
              ...(appliedContent === null
                ? {}
                : { contentCommit: appliedContent }),
            },
      );
    } catch {
      // The canonical state is committed even when a receipt observer fails.
    }
    if (appliedContent) {
      this.options.contentCommit!.publishContentCommit(appliedContent);
    }
    if (options.selectionPresentation === "native-before-removal") {
      this.presentCanonicalTextSelection();
    }
    if (appliedContent) notifyDocumentSubscribers();
    return {
      ok: true,
      operation: effectiveOperation,
      contentResult,
      update: durableOperation.update,
    };
  }

  private defaultContentValidation(
    blockType: BlockType,
    content: RichTextDocumentNodeJson,
  ): boolean {
    const definition = this.blockDefinitions[blockType];
    return definition?.kind === "text" && isRichTextDocument(content);
  }

  private createDurableBlockGraphOperation(
    previousState: EditorCommandState,
    request: EditorOperationRequest,
  ): {
    operation: EditorBlockGraphOperation<TransformBlocksPayload>;
    blocks: Record<BlockId, VersionedBlock>;
    rootBlockIds: readonly BlockId[];
    childIdsByParentId: Readonly<Partial<Record<BlockId, readonly BlockId[]>>>;
    update: EditorDocumentUpdate;
  } | null {
    const hasContentOperations = request.contentOperations.length > 0;
    const hasBlockGraphChange =
      request.nextState.blocks !== previousState.blocks ||
      request.nextState.rootBlockIds !== previousState.rootBlockIds ||
      request.nextState.childIdsByParentId !== previousState.childIdsByParentId;
    if (!hasContentOperations && !hasBlockGraphChange) return null;

    const createdAt = Date.now();
    const blocks = createBlocksForDurableOperation(previousState, request);
    const patchResult = createEditorBlockGraphPatch(
      previousState,
      { ...request.nextState, blocks },
      request,
    );
    if (!patchResult) return null;
    const { patch, update } = patchResult;
    if (
      patch.affectedBlockIds.length === 0 &&
      patch.upsertedBlocks.length === 0 &&
      (patch.removedBlockIds?.length ?? 0) === 0 &&
      update.containerSequences.changedParentIds.length === 0
    ) {
      return null;
    }
    const operation: EditorBlockGraphOperation<TransformBlocksPayload> = {
      body: {
        kind: "transformBlocks",
        payload: {
          ...patch,
          targetId: request.operationTargetId ?? request.reason,
          contentOperations: cloneContentOperationBatches(
            request.contentOperations,
          ),
        },
      },
      createdAt,
    };
    return {
      operation,
      blocks,
      rootBlockIds: request.nextState.rootBlockIds,
      childIdsByParentId: request.nextState.childIdsByParentId,
      update,
    };
  }

  private prepareDocumentContentCommit(
    batches: readonly EditorBlockContentOperationBatch[],
    previousState: EditorCommandState,
    nextState: EditorCommandState,
    origin: unknown,
    candidateBlockIds: readonly BlockId[] = [],
  ): ValidatedContentCommit | ContentCommitRejection | null {
    const contentCommit = this.options.contentCommit;
    const introducedBlocks = {} as Partial<Record<BlockId, BlockType>>;
    const removedBlockIds: BlockId[] = [];
    const lifecycleCandidateIds = new Set<BlockId>(candidateBlockIds);
    for (const batch of batches) lifecycleCandidateIds.add(batch.blockId);
    for (const blockId of lifecycleCandidateIds) {
      const block = nextState.blocks[blockId];
      const previous = previousState.blocks[blockId];
      if (
        !block ||
        block.tombstone ||
        (previous && !previous.tombstone) ||
        this.blockDefinitions[block.type]?.kind !== "text"
      ) {
        continue;
      }
      introducedBlocks[blockId] = block.type;
      continue;
    }
    for (const blockId of lifecycleCandidateIds) {
      const block = previousState.blocks[blockId];
      const next = nextState.blocks[blockId];
      if (
        !block ||
        block.tombstone ||
        (next && !next.tombstone) ||
        this.blockDefinitions[block.type]?.kind !== "text"
      ) {
        continue;
      }
      removedBlockIds.push(blockId);
    }
    if (
      batches.length === 0 &&
      Object.keys(introducedBlocks).length === 0 &&
      removedBlockIds.length === 0 &&
      previousState.blockGraphVersion === nextState.blockGraphVersion
    ) {
      return null;
    }
    if (
      !contentCommit &&
      batches.length === 0 &&
      Object.keys(introducedBlocks).length === 0 &&
      removedBlockIds.length === 0
    ) {
      return null;
    }
    if (!contentCommit) {
      return {
        ok: false,
        reason: "invalid-operation",
        message: "content commit runtime is unavailable",
      };
    }
    const tokens = new Map<BlockId, EditorContentBaseToken>();
    const changes: EditorContentCommitChange[] = [];
    try {
      for (const batch of batches) {
        const first = batch.operations[0];
        if (!first) {
          return {
            ok: false,
            reason: "invalid-operation",
            message: `Content operation batch for ${batch.blockId} is empty`,
            blockId: batch.blockId,
          };
        }
        let token = tokens.get(batch.blockId);
        if (!token) {
          const previousBlock = previousState.blocks[batch.blockId];
          if (previousBlock && !previousBlock.tombstone) {
            token = contentCommit.readContentBaseToken(
              batch.blockId,
              first.blockType,
              previousState.blockGraphVersion,
            );
          } else {
            const introduced = nextState.blocks[batch.blockId];
            if (
              !introduced ||
              introduced.tombstone ||
              introduced.type !== first.blockType
            ) {
              return {
                ok: false,
                reason: "missing-block",
                message: `Content operation target ${batch.blockId} does not exist`,
                blockId: batch.blockId,
              };
            }
            introducedBlocks[batch.blockId] = first.blockType;
            token = Object.freeze({
              graphRevision: previousState.blockGraphVersion,
              blockId: batch.blockId,
              blockType: first.blockType,
              contentRevision: 0,
            });
          }
          tokens.set(batch.blockId, token);
        }
        changes.push({ baseToken: token, operations: batch.operations });
      }
    } catch (error) {
      return {
        ok: false,
        reason: "invalid-operation",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    const result = contentCommit.validateContentCommit({
      graphRevision: previousState.blockGraphVersion,
      resultingGraphRevision: nextState.blockGraphVersion,
      changes,
      introducedBlocks,
      removedBlockIds,
      origin,
    });
    return result;
  }

  private commitCanonicalGraphMutation(
    nextState: EditorCommandState,
    update: EditorDocumentUpdate,
    origin: EditorCanonicalGraphMutationOrigin,
    structuralDraftAlreadyValidated = false,
    selectionEffect?: EditorCanonicalSelectionEffect,
    deferNotifications = false,
    settlementContext: import("../../../selection/model/types.ts").SelectionSettlementContext = {
      publication: { kind: "silent" },
      cause: "canonical-rebase",
    },
  ): () => void {
    if (nextState.rootBlockIds.length === 0) {
      throw new Error("cannot commit an editor document without a live root");
    }
    const split = splitEditorCommandState(nextState);
    const selectionSettlementCapture =
      !selectionEffect || selectionEffect.kind === "preserve"
        ? this.captureGraphSelectionSettlement()
        : null;
    const nextManifest = freezeManifestState(
      split.manifest,
      this.blockDefinitions,
      this.manifestState,
      {
        structuralDraftAlreadyValidated,
        changedBlockIds: [
          ...update.canonical.updatedBlockIds,
          ...update.canonical.removedBlockIds,
        ],
        changedParentIds: update.containerSequences.changedParentIds,
      },
    );
    const manifestChanged = !editorManifestStatesEqual(
      this.manifestState,
      nextManifest,
    );
    const canonicalDocumentChanged =
      update.canonical.updatedBlockIds.length > 0 ||
      update.canonical.removedBlockIds.length > 0 ||
      update.canonical.contentChangedBlockIds.length > 0;
    if (manifestChanged) {
      this.manifestState = nextManifest;
    }
    if (!editorSessionStatesEqual(this.store.getSnapshot(), split.session)) {
      this.store.replaceState(split.session);
    }
    if (canonicalDocumentChanged) this.documentRevision += 1;
    if (selectionEffect?.kind === "preserve") {
      this.settleCapturedGraphSelection(
        selectionSettlementCapture!,
        settlementContext,
      );
    } else if (selectionEffect) {
      this.applyCanonicalSelectionEffect(
        selectionEffect,
        "canonical-only",
        settlementContext,
      );
    } else if (canonicalDocumentChanged) {
      this.settleCapturedGraphSelection(
        selectionSettlementCapture!,
        settlementContext,
      );
    }
    const notify = () => {
      if (!manifestChanged) return;
      for (const listener of [...this.manifestListeners]) {
        notifyProjectionSubscriber(() => listener(update));
      }
      this.notifyDocumentSubscribers(update);
    };
    if (!deferNotifications) notify();
    return deferNotifications ? notify : noop;
  }

  private captureGraphSelectionSettlement(): GraphSelectionSettlementCapture {
    const canonical = this.selectionController.getCanonicalSnapshot();
    const focus =
      canonical.kind === "none"
        ? null
        : canonical.snapshot.documentSelection.focus;
    return {
      canonical,
      traversalBlockIds: getCanonicalBlockOrder(this.getCommandState()),
      focusBlockId: focus?.blockId ?? null,
    };
  }

  private presentCanonicalTextSelection(): void {
    const canonical = this.selectionController.getCanonicalSnapshot();
    const focus =
      canonical.kind === "document"
        ? canonical.snapshot.documentSelection.focus
        : null;
    if (!focus?.textAnchor) return;
    this.options.presentTextProjection?.(focus.blockId, {
      offset: focus.textOffset,
      affinity: focus.affinity,
      preventScroll: true,
      canonicalSelectionRevision: canonical.revision,
    });
  }

  private presentAtomicStructuralSelection(
    target: TransactionSelectionTarget,
  ): void {
    if (target.kind === "none") return;
    const block = this.getBlock(target.blockId);
    if (
      !block ||
      block.tombstone ||
      this.blockDefinitions[block.type]?.kind !== "atomic"
    ) {
      return;
    }
    this.options.requestNativePresentation?.({
      token: Symbol(`structural-presentation:${target.blockId}`),
      blockId: target.blockId,
      targetKind: "atomic",
      graphRevision: this.getSelectionGraphRevision(),
      preventScroll: true,
      ...(target.kind === "block-end"
        ? { placement: "end" as const }
        : {}),
    });
  }

  private hasActiveCanonicalTextProjection(): boolean {
    const canonical = this.selectionController.getCanonicalSnapshot();
    const focus =
      canonical.kind === "document"
        ? canonical.snapshot.documentSelection.focus
        : null;
    return Boolean(
      focus?.textAnchor &&
        this.options.hasActiveTextProjection?.(focus.blockId),
    );
  }

  private settleCapturedGraphSelection(
    capture: GraphSelectionSettlementCapture,
    context: import("../../../selection/model/types.ts").SelectionSettlementContext,
  ): void {
    this.selectionController.reconcileCommittedGraphChange(
      this,
      this.getSelectionGraphRevision(),
      context,
      this.options.resolveSelectionTextAnchor
        ? { resolveTextAnchor: this.options.resolveSelectionTextAnchor }
        : null,
    );
    const settled = this.selectionController.getCanonicalSnapshot();
    if (settled.kind !== "none") return;
    if (capture.canonical.kind === "none" || !capture.focusBlockId) return;

    const focusIndex = capture.traversalBlockIds.indexOf(capture.focusBlockId);
    const candidates: BlockId[] = [];
    const append = (blockId: BlockId | undefined): void => {
      if (blockId && !candidates.includes(blockId)) candidates.push(blockId);
    };
    append(capture.focusBlockId);
    if (focusIndex >= 0) {
      for (
        let distance = 1;
        distance < capture.traversalBlockIds.length;
        distance += 1
      ) {
        append(capture.traversalBlockIds[focusIndex + distance]);
        append(capture.traversalBlockIds[focusIndex - distance]);
      }
    }
    for (const blockId of getCanonicalBlockOrder(this.getCommandState())) {
      append(blockId);
    }
    for (const blockId of candidates) {
      const block = this.readLiveKnownBlock(blockId);
      if (!block || this.blockDefinitions[block.type]?.kind !== "text")
        continue;
      const effect = this.createSelectionEffectFromSuggestion({
        selection: { blockId, offset: 0 },
      });
      if (!effect) continue;
      this.applyCanonicalSelectionEffect(effect, "canonical-only", context);
      return;
    }
  }

  private applyCanonicalSelectionEffect(
    effect: EditorCanonicalSelectionEffect | undefined,
    presentation: CanonicalSelectionPresentation,
    context: import("../../../selection/model/types.ts").SelectionSettlementContext = {
      publication: { kind: "silent" },
      cause: "canonical-rebase",
    },
  ): void {
    if (!effect || effect.kind === "preserve") return;
    try {
      const materialized =
        effect.kind === "history-selection"
          ? this.materializeHistorySelectionEffect(effect.selection)
          : effect;
      const settlement = materialized
        ? this.settleCanonicalSelectionEffect(materialized, context)
        : {
            kind: "rejected" as const,
            retainedSelection: this.selectionController.getCanonicalSnapshot(),
          };
      this.projectSettledSelection(settlement, presentation);
    } catch {
      // Selection restoration is best effort and never rolls back the graph.
    }
  }

  private materializeHistorySelectionEffect(
    historySelection: EditorHistorySelection,
    graph: EditorSelectionGraphReader = this,
    replayInputOperation?: EditorOperation,
  ): Exclude<
    EditorCanonicalSelectionEffect,
    { readonly kind: "preserve" } | { readonly kind: "history-selection" }
  > | null {
    if (historySelection.kind === "none") return { kind: "clear" };
    if (historySelection.kind === "block-internal") {
      return {
        kind: "block-internal",
        blockId: historySelection.blockId,
        subsystem: historySelection.subsystem,
        coverageResult: historySelection.coverageResult,
      };
    }

    const historyFocus = historySelection.selection.focus;
    const historyFocusBlock = graph.getBlock(historyFocus.blockId);
    if (
      historyFocusBlock &&
      this.blockDefinitions[historyFocusBlock.type]?.kind !== "text"
    ) {
      const findTextDescendant = (blockId: BlockId): BlockId | null => {
        for (const childId of graph.getChildBlockIds(blockId)) {
          const child = graph.getBlock(childId);
          if (!child || child.tombstone) continue;
          if (this.blockDefinitions[child.type]?.kind === "text") {
            return child.id;
          }
          const nested = findTextDescendant(child.id);
          if (nested) return nested;
        }
        return null;
      };
      const textDescendant = findTextDescendant(historyFocus.blockId);
      if (textDescendant) {
        const descendant = graph.getBlock(textDescendant);
        const model = graph.readBlockSelectionModel(textDescendant);
        const releaseContentAccess = descendant
          ? this.options.acquireTextContentAccess?.(descendant.id) ?? null
          : null;
        let created: ReturnType<
          NonNullable<
            InitializeEditorImplementationOptions["createSelectionTextAnchor"]
          >
        > | null;
        try {
          created = descendant
            ? this.options.createSelectionTextAnchor?.({
                blockId: descendant.id,
                blockType: descendant.type,
                textOffset: 0,
                affinity: null,
              }) ?? null
            : null;
        } finally {
          releaseContentAccess?.();
        }
        if (descendant && model && created?.ok) {
          const point: EditorLogicalSelectionPoint = {
            blockId: descendant.id,
            blockType: descendant.type,
            blockCategory: model.projection.category,
            textOffset: created.textOffset,
            textAnchor: created.textAnchor,
            affinity: null,
          };
          return {
            kind: "selection",
            selection: { direction: "forward", anchor: point, focus: point },
          };
        }
      }
    }

    const contentAccessReleases = new Map<BlockId, () => void>();
    const acquireHistoryContentAccess = (blockId: BlockId): void => {
      if (contentAccessReleases.has(blockId)) return;
      const release = this.options.acquireTextContentAccess?.(blockId);
      if (release) contentAccessReleases.set(blockId, release);
    };
    const materializePoint = (
      point: EditorLogicalSelectionPoint,
    ): EditorLogicalSelectionPoint | null => {
      const block = graph.getBlock(point.blockId);
      if (!block || block.tombstone) return null;
      const model = graph.readBlockSelectionModel(point.blockId);
      if (!model) return null;
      if (model.projection.endpoint.kind !== "content") {
        return {
          ...point,
          blockType: block.type,
          blockCategory: model.projection.category,
          textAnchor: null,
        };
      }
      acquireHistoryContentAccess(block.id);
        if (point.textAnchor && this.options.resolveSelectionTextAnchor) {
          const resolved = resolveEditorSelectionTextAnchorPoint(
            {
              ...point,
              blockType: block.type,
              blockCategory: model.projection.category,
            },
            graph,
            { resolveTextAnchor: this.options.resolveSelectionTextAnchor },
          );
          if (resolved.ok) {
            return {
              ...point,
              blockType: block.type,
              blockCategory: model.projection.category,
              textAnchor: resolved.textAnchor,
              textOffset: resolved.textOffset,
              affinity: resolved.affinity,
            };
          }
        }

        const replayInputOffset = replayInputOperation
          ? historyReplayPointMapping(
              point,
              historyReplayContentOperations(replayInputOperation),
            ).inputOffset
          : point.textOffset;
        const created = this.options.createSelectionTextAnchor?.({
          blockId: block.id,
          blockType: block.type,
          textOffset: replayInputOffset,
          affinity: point.affinity,
        });
      return created?.ok
        ? {
            ...point,
            blockType: block.type,
            blockCategory: model.projection.category,
            textAnchor: created.textAnchor,
            textOffset: created.textOffset,
          }
        : null;
    };

    try {
      const anchor = materializePoint(historySelection.selection.anchor);
      const focus = materializePoint(historySelection.selection.focus);
      return anchor && focus
        ? {
            kind: "selection",
            selection: {
              direction: historySelection.selection.direction,
              anchor,
              focus,
            },
          }
        : null;
    } finally {
      for (const release of contentAccessReleases.values()) release();
    }
  }

  private validatePreparedContentSelection(
    contentCommit: NonNullable<
      InitializeEditorImplementationOptions["contentCommit"]
    >,
    prepared: ValidatedContentCommit,
    selection: EditorPreparedContentSelection | null,
  ):
    | {
        readonly ok: true;
        readonly selection: EditorPreparedContentSelection | null;
      }
    | { readonly ok: false; readonly message: string } {
    if (selection === null) return { ok: true, selection: null };
    const validatePoint = (
      point: EditorPreparedContentSelection["anchor"],
    ): EditorPreparedContentSelection["anchor"] | null => {
      const validation = contentCommit.validateContentTextPoint(prepared, {
        blockId: point.blockId,
        blockType: point.blockType,
        textOffset: point.textOffset,
      });
      return validation.ok
        ? { ...point, textOffset: validation.textOffset }
        : null;
    };
    const anchor = validatePoint(selection.anchor);
    const focus = validatePoint(selection.focus);
    return anchor && focus
      ? {
          ok: true,
          selection: { direction: selection.direction, anchor, focus },
        }
      : {
          ok: false,
          message:
            "The proposed post-edit selection is invalid for prepared content",
        };
  }

  private createSelectionEffectFromPreparedContentSelection(
    selection: EditorPreparedContentSelection,
  ): EditorCanonicalSelectionEffect | null {
    const createPoint = (
      point: EditorPreparedContentSelection["anchor"],
    ): EditorLogicalSelectionPoint | null => {
      const block = this.readLiveKnownBlock(point.blockId);
      if (!block || block.type !== point.blockType) return null;
      const definition = this.blockDefinitions[block.type];
      if (definition?.kind !== "text") return null;
      const created = this.options.createSelectionTextAnchor?.({
        blockId: block.id,
        blockType: block.type,
        textOffset: point.textOffset,
        affinity: point.affinity,
      });
      if (!created?.ok) return null;
      const model = definition.selection ?? contentSelection();
      return {
        blockId: block.id,
        blockType: block.type,
        blockCategory: model.projection.category,
        textOffset: created.textOffset,
        textAnchor: created.textAnchor,
        affinity: point.affinity,
      };
    };
    const anchor = createPoint(selection.anchor);
    const focus = samePreparedContentSelectionPoint(
      selection.anchor,
      selection.focus,
    )
      ? anchor
      : createPoint(selection.focus);
    return anchor && focus
      ? {
          kind: "selection",
          selection: { direction: selection.direction, anchor, focus },
        }
      : null;
  }

  private createSelectionEffectFromSuggestion(
    suggestion: EditorOperationSuggestion | null | undefined,
    blocks: Readonly<Record<BlockId, VersionedBlock>> = this.manifestState
      .blocks,
  ): EditorCanonicalSelectionEffect | null {
    const selection = suggestion?.selection;
    if (!selection) return null;
    const block = blocks[selection.blockId];
    if (!block || block.tombstone) return null;
    const definition = this.blockDefinitions[block.type];
    if (!definition) return null;
    const model =
      definition.selection ??
      (definition.kind === "text"
        ? contentSelection()
        : definition.kind === "atomic"
          ? wholeSelection()
          : wrapperSelection());
    if (!model.projection.selectable) return null;
    let textOffset = selection.offset ?? 0;
    let textAnchor: EditorLogicalSelectionPoint["textAnchor"] = null;
    if (model.projection.endpoint.kind === "content") {
      if (selection.offset === undefined || selection.offset === null) {
        const content = this.readBlockContent(block.id, block.type);
        textOffset =
          selection.placement === "end" && content
            ? richTextDocumentContentSize(content)
            : 0;
      }
      const created = this.options.createSelectionTextAnchor?.({
        blockId: block.id,
        blockType: block.type,
        textOffset,
        affinity: selection.affinity ?? null,
      });
      if (!created?.ok) return null;
      textOffset = created.textOffset;
      textAnchor = created.textAnchor;
    }
    const point: EditorLogicalSelectionPoint = {
      blockId: block.id,
      blockType: block.type,
      blockCategory: model.projection.category,
      textOffset,
      textAnchor,
      affinity: selection.affinity ?? null,
    };
    return {
      kind: "selection",
      selection: { direction: "forward", anchor: point, focus: point },
    };
  }

  /**
   * Structural coordinators own hydration while turning a logical suggestion
   * into a stable text anchor. Introduced blocks are already held by the
   * prepared content commit; existing inactive text blocks are acquired once
   * for this transaction-local operation.
   */
  private createSelectionEffectFromSuggestionWithContentAccess(
    suggestion: EditorOperationSuggestion | null | undefined,
    blocks: Readonly<Record<BlockId, VersionedBlock>>,
  ): EditorCanonicalSelectionEffect | null {
    const blockId = suggestion?.selection?.blockId;
    const block = blockId ? blocks[blockId] : null;
    const release =
      block &&
      !block.tombstone &&
      this.blockDefinitions[block.type]?.kind === "text"
        ? this.options.acquireTextContentAccess?.(block.id) ?? null
        : null;
    try {
      return this.createSelectionEffectFromSuggestion(suggestion, blocks);
    } finally {
      release?.();
    }
  }

  private settleCanonicalSelectionEffect(
    effect: Exclude<
      EditorCanonicalSelectionEffect,
      { readonly kind: "preserve" } | { readonly kind: "history-selection" }
    >,
    context: import("../../../selection/model/types.ts").SelectionSettlementContext,
  ): SelectionSettlement {
    if (effect.kind === "block-internal") {
      const target = readEditorBlockSelectionTarget(this, effect.blockId);
      const settled = target
        ? this.selectionController.commitBlockSelection(
            target,
            effect.coverageResult,
            effect.subsystem,
            context,
            this.getSelectionGraphRevision(),
          )
        : ({
            kind: "rejected",
            retainedSelection: this.selectionController.getCanonicalSnapshot(),
          } as const);
      return settled.kind === "changed" && settled.selection
        ? { kind: "settled", selection: settled.selection }
        : settled.kind === "unchanged" &&
            settled.retainedSelection.kind !== "none"
          ? {
              kind: "settled",
              selection: settled.retainedSelection.snapshot.documentSelection,
            }
          : {
              kind: "rejected",
              retainedSelection:
                settled.kind === "changed"
                  ? this.selectionController.getCanonicalSnapshot()
                  : settled.retainedSelection,
            };
    }
    const settled = this.selectionController.commitCanonicalSelection(
      effect.kind === "clear" ? null : effect.selection,
      this,
      this.getSelectionGraphRevision(),
      context,
      this.options.resolveSelectionTextAnchor
        ? { resolveTextAnchor: this.options.resolveSelectionTextAnchor }
        : null,
    );
    if (settled.kind === "changed") {
      return settled.selection
        ? { kind: "settled", selection: settled.selection }
        : { kind: "clear" };
    }
    if (
      settled.kind === "unchanged" &&
      settled.retainedSelection.kind !== "none"
    ) {
      return {
        kind: "settled",
        selection: settled.retainedSelection.snapshot.documentSelection,
      };
    }
    return {
      kind: "rejected",
      retainedSelection: settled.retainedSelection,
    };
  }

  private projectSettledSelection(
    settlement: SelectionSettlement,
    presentation: CanonicalSelectionPresentation,
  ): void {
    if (
      presentation === "canonical-only" ||
      presentation === "defer-native-until-content-release" ||
      presentation === "native-already-established"
    )
      return;
    if (settlement.kind !== "settled") return;
    const focus = settlement.selection.focus;
    if (!focus?.textAnchor) return;
    const canonical = this.selectionController.getCanonicalSnapshot();
    if (canonical.kind !== "document") return;
    this.options.presentTextProjection?.(focus.blockId, {
      offset: focus.textOffset,
      affinity: focus.affinity,
      preventScroll: true,
      canonicalSelectionRevision: canonical.revision,
    });
  }

  private createTransactionId(): string {
    if (this.options.createTransactionId) {
      const transactionId = this.options.createTransactionId();
      if (transactionId.length === 0)
        throw new Error("createTransactionId returned an empty identity");
      return transactionId;
    }
    const sequence = this.nextTransactionSequence;
    this.nextTransactionSequence += 1;
    return `${this.documentRevision}:${sequence}`;
  }

  private notifyDocumentSubscribers(update: EditorDocumentUpdate): void {
    const changedBlockIds = uniqueEditorBlockIds([
      ...update.canonical.updatedBlockIds,
      ...update.canonical.removedBlockIds,
    ]).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    // Observable block notifications run in block-ID order, followed by
    // canonical sequence notifications in root-first deterministic order.
    for (const blockId of changedBlockIds) {
      const listeners = this.blockListenersById.get(blockId);
      if (!listeners) continue;
      for (const listener of [...listeners]) {
        notifyProjectionSubscriber(listener);
      }
    }

    for (const parentId of update.containerSequences.changedParentIds) {
      if (parentId === null) {
        for (const listener of [...this.rootBlockIdListeners]) {
          notifyProjectionSubscriber(listener);
        }
        continue;
      }
      const listeners = this.blockChildSequenceListenersByKey.get(
        parentKey(parentId),
      );
      if (!listeners) continue;
      for (const listener of [...listeners]) {
        notifyProjectionSubscriber(listener);
      }
    }
  }

  private classifyDocumentUpdate(
    previousState: EditorCommandState,
    nextState: EditorCommandState,
    hints: {
      readonly candidateBlockIds?: readonly BlockId[];
      readonly contentChangedBlockIds?: readonly BlockId[];
    } = {},
  ): EditorDocumentUpdate {
    return classifyEditorDocumentUpdate({
      previousState,
      nextState,
      ...hints,
    });
  }
}

function notifyProjectionSubscriber(listener: () => void): void {
  try {
    listener();
  } catch {
    // State subscribers cannot invalidate an already committed transaction.
  }
}

function createCanonicalGraphChangesFromStates(
  previousState: EditorCommandState,
  nextState: EditorCommandState,
  affectedBlockIds: readonly BlockId[],
  historyAction: "command" | "undo" | "redo",
): readonly CanonicalEditorBlockGraphChange[] {
  const affected = uniqueEditorBlockIds(affectedBlockIds);
  const removed = new Set(
    affected.filter((blockId) => {
      const before = previousState.blocks[blockId];
      const after = nextState.blocks[blockId];
      return Boolean(before && !before.tombstone) &&
        (!after || after.tombstone);
    }),
  );
  const changes: CanonicalEditorBlockGraphChange[] = [...removed].map(
    (blockId) => ({ kind: "delete", blockId }),
  );
  const placementChanges = affected.filter((blockId) => {
    const after = nextState.blocks[blockId];
    if (!after || after.tombstone || removed.has(blockId)) return false;
    const siblings =
      after.parentId === null
        ? nextState.rootBlockIds
        : (nextState.childIdsByParentId[after.parentId] ?? []);
    const index = siblings.indexOf(blockId);
    return (
      index >= 0 &&
      blockPlacementChanged(previousState, blockId, after.parentId, index)
    );
  });
  const materialized =
    placementChanges.length === 0
      ? null
      : new Set(
          (Object.values(previousState.blocks) as VersionedBlock[])
            .filter((block) => !block.tombstone && !removed.has(block.id))
            .map((block) => block.id),
        );
  for (const blockId of affected) {
    const after = nextState.blocks[blockId];
    if (!after || after.tombstone || removed.has(blockId)) continue;
    const before = previousState.blocks[blockId];
    const siblings =
      after.parentId === null
        ? nextState.rootBlockIds
        : (nextState.childIdsByParentId[after.parentId] ?? []);
    const index = siblings.indexOf(blockId);
    if (index < 0) continue;
    const structurallyChanged = blockPlacementChanged(
      previousState,
      blockId,
      after.parentId,
      index,
    );
    const placement = structurallyChanged
      ? canonicalReceiptPlacementFromState(
          nextState,
          after,
          materialized!,
        )
      : null;
    if (!before) {
      changes.push(
        historyAction === "command"
          ? {
              kind: "create",
              blockId,
              blockType: after.type,
              placement: placement!,
              ...(after.metadata === undefined
                ? {}
                : { initialMetadata: cloneJsonValue(after.metadata) }),
            }
          : { kind: "restore", blockId, placement: placement! },
      );
      materialized!.add(blockId);
    } else if (before.tombstone) {
      changes.push({ kind: "restore", blockId, placement: placement! });
      materialized!.add(blockId);
    } else if (structurallyChanged) {
      changes.push({ kind: "move", blockId, placement: placement! });
    }
    if (before && before.type !== after.type) {
      changes.push({ kind: "change-type", blockId, blockType: after.type });
    }
  }
  return Object.freeze(changes);
}

function canonicalReceiptPlacementFromState(
  state: EditorCommandState,
  block: VersionedBlock,
  materialized: ReadonlySet<BlockId>,
): CanonicalEditorBlockPlacement {
  const siblings =
    block.parentId === null
      ? state.rootBlockIds
      : (state.childIdsByParentId[block.parentId] ?? []);
  const index = siblings.indexOf(block.id);
  return {
    parentId: block.parentId,
    previousSiblingId: nearestMaterializedSibling(
      siblings,
      index,
      -1,
      materialized,
    ),
    nextSiblingId: nearestMaterializedSibling(
      siblings,
      index,
      1,
      materialized,
    ),
  };
}

function createCanonicalGraphChanges(
  previousState: EditorCommandState,
  payload: TransformBlocksPayload,
  historyAction: "command" | "undo" | "redo",
): readonly CanonicalEditorBlockGraphChange[] {
  const removed = new Set(payload.removedBlockIds ?? []);
  const changes: CanonicalEditorBlockGraphChange[] = [...removed].map(
    (blockId) => ({ kind: "delete", blockId }),
  );
  const placementById = new Map(
    (payload.resolvedPlacements ?? []).map((placement) => [
      placement.blockId,
      placement,
    ]),
  );
  const placementChanges = payload.upsertedBlocks.filter((after) => {
    if (after.tombstone || removed.has(after.id)) return false;
    const before = previousState.blocks[after.id];
    const resolved = placementById.get(after.id);
    return (
      Boolean(resolved) &&
      (!before ||
        before.tombstone ||
        blockPlacementChanged(
          previousState,
          after.id,
          resolved!.parentId,
          resolved!.childIndex,
        ))
    );
  });
  const materialized =
    placementChanges.length === 0
      ? null
      : new Set(
          (Object.values(previousState.blocks) as VersionedBlock[])
            .filter((block) => !block.tombstone && !removed.has(block.id))
            .map((block) => block.id),
        );
  for (const after of payload.upsertedBlocks) {
    if (after.tombstone || removed.has(after.id)) {
      continue;
    }
    const before = previousState.blocks[after.id];
    const resolved = placementById.get(after.id);
    if (!resolved) continue;
    const structurallyChanged =
      !before ||
      before.tombstone ||
      blockPlacementChanged(
        previousState,
        after.id,
        resolved.parentId,
        resolved.childIndex,
      );
    const placement = structurallyChanged
      ? canonicalReceiptPlacement(payload, after, materialized!)
      : null;
    if (!before) {
      changes.push(
        historyAction === "command"
          ? {
              kind: "create",
              blockId: after.id,
              blockType: after.type,
              placement: placement!,
              ...(after.metadata === undefined
                ? {}
                : { initialMetadata: cloneJsonValue(after.metadata) }),
            }
          : { kind: "restore", blockId: after.id, placement: placement! },
      );
      materialized!.add(after.id);
    } else if (before.tombstone) {
      changes.push({ kind: "restore", blockId: after.id, placement: placement! });
      materialized!.add(after.id);
    } else if (structurallyChanged) {
      changes.push({ kind: "move", blockId: after.id, placement: placement! });
    }
    if (before && before.type !== after.type) {
      changes.push({
        kind: "change-type",
        blockId: after.id,
        blockType: after.type,
      });
    }
  }
  return Object.freeze(changes);
}

function canonicalReceiptPlacement(
  payload: TransformBlocksPayload,
  block: VersionedBlock,
  materialized: ReadonlySet<BlockId>,
): CanonicalEditorBlockPlacement {
  const siblings =
    block.parentId === null
      ? payload.rootBlockIds
      : (payload.childIdsByParentId[block.parentId] ?? []);
  const index = siblings.indexOf(block.id);
  return {
    parentId: block.parentId,
    previousSiblingId: nearestMaterializedSibling(
      siblings,
      index,
      -1,
      materialized,
    ),
    nextSiblingId: nearestMaterializedSibling(
      siblings,
      index,
      1,
      materialized,
    ),
  };
}

function nearestMaterializedSibling(
  siblings: readonly BlockId[],
  index: number,
  direction: -1 | 1,
  materialized: ReadonlySet<BlockId>,
): BlockId | null {
  for (
    let cursor = index + direction;
    cursor >= 0 && cursor < siblings.length;
    cursor += direction
  ) {
    const candidate = siblings[cursor]!;
    if (materialized.has(candidate)) return candidate;
  }
  return null;
}

function blockPlacementChanged(
  previousState: EditorCommandState,
  blockId: BlockId,
  nextParentId: BlockId | null,
  nextIndex: number,
): boolean {
  const before = previousState.blocks[blockId];
  if (!before || before.tombstone) return true;
  if (before.parentId !== nextParentId) return true;
  const siblings =
    before.parentId === null
      ? previousState.rootBlockIds
      : (previousState.childIdsByParentId[before.parentId] ?? []);
  return siblings.indexOf(blockId) !== nextIndex;
}

function resolveCanonicalFragmentInsertionSelection(
  fragment: CanonicalBlockFragment,
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
): TransactionSelectionTarget {
  const byId = new Map(fragment.blocks.map((block) => [block.id, block]));
  const boundaryBlock = byId.get(fragment.end.blockId);
  if (!boundaryBlock) return { kind: "none" };
  const direct = selectionTargetForCanonicalRecord(
    boundaryBlock,
    fragment.end.kind,
    blockDefinitions,
  );
  if (direct) return direct;

  const descendants = new Set<BlockId>([boundaryBlock.id]);
  for (const record of fragment.blocks) {
    if (record.parentId !== null && descendants.has(record.parentId)) {
      descendants.add(record.id);
    }
  }
  for (let index = fragment.blocks.length - 1; index >= 0; index -= 1) {
    const record = fragment.blocks[index]!;
    if (!descendants.has(record.id) || record.id === boundaryBlock.id) continue;
    const target = selectionTargetForCanonicalRecord(
      record,
      "block",
      blockDefinitions,
    );
    if (target) return target;
  }
  return { kind: "none" };
}

function selectionTargetForCanonicalRecord(
  record: CanonicalBlockFragment["blocks"][number],
  boundaryKind: CanonicalBlockFragment["end"]["kind"],
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
): TransactionSelectionTarget | null {
  const definition = blockDefinitions[record.type];
  if (definition?.kind === "atomic") {
    return { kind: "atomic", blockId: record.id };
  }
  if (definition?.kind !== "text" || !record.content) return null;
  return boundaryKind === "text"
    ? {
        kind: "text-offset",
        blockId: record.id,
        offset: richTextDocumentContentSize(record.content),
      }
    : { kind: "block-end", blockId: record.id };
}

function editorSessionStatesEqual(
  left: EditorSessionState,
  right: EditorSessionState,
): boolean {
  return (
    left.blockGraphVersion === right.blockGraphVersion &&
    left.createdAt === right.createdAt &&
    left.updatedAt === right.updatedAt
  );
}

function uniqueEditorBlockIds(blockIds: readonly BlockId[]): BlockId[] {
  const seen = new Set<BlockId>();
  const result: BlockId[] = [];
  for (const blockId of blockIds) {
    if (seen.has(blockId)) continue;
    seen.add(blockId);
    result.push(blockId);
  }
  return result;
}

function metadataVersionsMatchCurrentState(
  blocks: Readonly<Record<BlockId, VersionedBlock>>,
  expectedVersions: Readonly<Record<BlockId, string>>,
): boolean {
  for (const [blockId, expectedVersion] of Object.entries(expectedVersions) as [
    BlockId,
    string,
  ][]) {
    const block = blocks[blockId];
    if (
      !block ||
      block.tombstone ||
      block.metadataVersion !== expectedVersion
    ) {
      return false;
    }
  }
  return true;
}

function validateEditorMetadataGraph(input: {
  readonly previousBlocks: Readonly<Record<BlockId, VersionedBlock>>;
  readonly nextBlocks: Readonly<Record<BlockId, VersionedBlock>>;
  readonly nextChildIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
  readonly affectedBlockIds: readonly BlockId[];
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
}): readonly string[] {
  const validationBlockIds = new Set<BlockId>();
  for (const blockId of input.affectedBlockIds) {
    validationBlockIds.add(blockId);
    const previousParentId = input.previousBlocks[blockId]?.parentId;
    const nextParentId = input.nextBlocks[blockId]?.parentId;
    if (previousParentId) validationBlockIds.add(previousParentId);
    if (nextParentId) validationBlockIds.add(nextParentId);
  }
  const errors: string[] = [];
  for (const blockId of validationBlockIds) {
    const block = input.nextBlocks[blockId];
    if (!block || block.tombstone) continue;
    const definition = input.blockDefinitions[block.type];
    if (!definition) continue;
    errors.push(
      ...validateBlockMetadataForDefinitionWithChildren(
        block.metadata,
        definition,
        {
          blockId,
          directChildIds: definition.validateMetadata
            ? (input.nextChildIdsByParentId[blockId] ?? [])
            : [],
        },
        `block ${blockId} metadata`,
      ),
    );
  }
  return errors;
}

function restorativeDefaultReplacementAtPlacement(input: {
  readonly placement: BlockPlacement;
  readonly incomingTypes: readonly BlockType[];
  readonly blocks: Readonly<Record<BlockId, VersionedBlock>>;
  readonly childIdsByParentId: Readonly<
    Partial<Record<BlockId, readonly BlockId[]>>
  >;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
}): {
  readonly block: VersionedBlock;
  readonly placement: BlockPlacement;
} | null {
  const parentId = input.placement.parentId;
  if (parentId === null) return null;
  const parent = input.blocks[parentId];
  const definition = parent ? input.blockDefinitions[parent.type] : undefined;
  const relationship = definition
    ? resolveRestorativeDefault(input.blockDefinitions, definition)
    : null;
  if (
    !parent ||
    parent.tombstone ||
    !relationship ||
    input.incomingTypes.some((type) => type === relationship.defaultType)
  ) {
    return null;
  }
  const children = (input.childIdsByParentId[parentId] ?? EMPTY_BLOCK_IDS)
    .map((blockId) => input.blocks[blockId])
    .filter((block): block is VersionedBlock =>
      Boolean(block && !block.tombstone),
    );
  const defaultBlock = children[0];
  if (
    children.length !== 1 ||
    !defaultBlock ||
    defaultBlock.type !== relationship.defaultType
  ) {
    return null;
  }
  return {
    block: defaultBlock,
    placement: { parentId, childIndex: 0 },
  };
}

const EMPTY_BLOCK_IDS = Object.freeze([]) as readonly BlockId[];

function blockGraphPatchCandidateIds(
  patch: Pick<
    TransformBlocksPayload,
    "affectedBlockIds" | "upsertedBlocks" | "removedBlockIds"
  >,
): readonly BlockId[] {
  return uniqueEditorBlockIds([
    ...(patch.affectedBlockIds ?? []),
    ...(patch.upsertedBlocks ?? []).map((block) => block.id),
    ...(patch.removedBlockIds ?? []),
  ]);
}

function operationRequestMutationOrigin(
  request: Pick<EditorOperationRequest, "origin">,
): EditorCanonicalGraphMutationOrigin {
  return request.origin ?? "local-command";
}

function contentTransactionSelectionCause(
  origin: PreparedContentEditorTransactionOrigin,
): import("../../../selection/model/types.ts").SelectionCause {
  if (origin === "prosemirror-proposal") return "native-edit";
  if (origin === "undo") return "undo";
  if (origin === "redo") return "redo";
  return "programmatic-edit";
}

function graphTransactionSelectionCause(
  origin: EditorOperationRequest["origin"],
): import("../../../selection/model/types.ts").SelectionCause {
  if (origin === "undo") return "undo";
  if (origin === "redo") return "redo";
  return "programmatic-edit";
}

function graphTransactionHistoryAction(
  origin: EditorOperationRequest["origin"],
): "command" | "undo" | "redo" {
  return origin === "undo" || origin === "redo" ? origin : "command";
}

function selectionBlockId(target: TransactionSelectionTarget): BlockId | null {
  return target.kind === "none" ? null : target.blockId;
}

function selectionSuggestion(
  target: TransactionSelectionTarget,
): EditorOperationSuggestion | null {
  switch (target.kind) {
    case "none":
      return null;
    case "text-offset":
      return { selection: { blockId: target.blockId, offset: target.offset } };
    case "block-start":
      return { selection: { blockId: target.blockId, placement: "start" } };
    case "block-end":
      return { selection: { blockId: target.blockId, placement: "end" } };
    case "atomic":
      return { selection: { blockId: target.blockId } };
  }
}

function collectStructuralPolicyCandidateBlockIds(
  previousState: EditorCommandState,
  transaction: AppliedStructuralTransaction,
): readonly BlockId[] {
  const candidateBlockIds = new Set<BlockId>();
  const addLineage = (
    blocks: Readonly<Record<BlockId, VersionedBlock>>,
    initialBlockId: BlockId,
  ): void => {
    const visited = new Set<BlockId>();
    let blockId: BlockId | null = initialBlockId;
    while (blockId !== null && !visited.has(blockId)) {
      visited.add(blockId);
      candidateBlockIds.add(blockId);
      blockId = blocks[blockId]?.parentId ?? null;
    }
  };
  for (const blockId of transaction.affectedBlockIds) {
    addLineage(previousState.blocks, blockId);
    addLineage(transaction.blocks, blockId);
  }
  return Object.freeze([...candidateBlockIds]);
}

function transactionHasChanges(
  transaction: AppliedStructuralTransaction,
  baseState: EditorCommandState,
): boolean {
  return (
    transaction.blocks !== baseState.blocks ||
    transaction.rootBlockIds !== baseState.rootBlockIds ||
    transaction.childIdsByParentId !== baseState.childIdsByParentId ||
    transaction.contentOperations.length > 0
  );
}

function createIncrementalTextJoinHistory(
  plan: StructuralTransactionPlan,
  previousState: EditorCommandState,
  transaction: AppliedStructuralTransaction,
): Pick<EditorHistoryEntry, "forward" | "inverse"> | null {
  if (
    !plan.operations.some(
      (operation) => operation.kind === "appendTextBlockContent",
    ) ||
    plan.operations.some((operation) =>
      [
        "deleteRange",
        "joinTextBlocks",
        "splitText",
        "replaceContent",
        "applyContentOperation",
      ].includes(operation.kind),
    )
  ) {
    return null;
  }
  const candidateIds = new Set(transaction.affectedBlockIds);
  const createdIds = [...candidateIds].filter(
    (blockId) =>
      !previousState.blocks[blockId] && Boolean(transaction.blocks[blockId]),
  );
  const removedIds = [...candidateIds].filter(
    (blockId) =>
      Boolean(previousState.blocks[blockId]) && !transaction.blocks[blockId],
  );
  const createdSet = new Set(createdIds);
  for (const createdId of createdIds) {
    const children = transaction.childIdsByParentId[createdId] ?? [];
    if (children.some((childId) => !createdSet.has(childId))) return null;
  }
  const createdRoots = createdIds.filter((blockId) => {
    const parentId = transaction.blocks[blockId]?.parentId ?? null;
    return parentId === null || !createdSet.has(parentId);
  });
  const removedRecords = removedIds
    .map((blockId) => {
      const block = previousState.blocks[blockId]!;
      return {
        block,
        placement: blockPlacement(previousState, blockId),
      };
    })
    .sort(
      (left, right) =>
        structuralDepth(previousState, left.block.id) -
          structuralDepth(previousState, right.block.id) ||
        left.placement.childIndex - right.placement.childIndex,
    );
  const movedBack = [...candidateIds].flatMap((blockId) => {
    const before = previousState.blocks[blockId];
    const after = transaction.blocks[blockId];
    if (!before || !after || before.tombstone || after.tombstone) return [];
    const beforePlacement = blockPlacement(previousState, blockId);
    const afterPlacement = blockPlacement(transaction, blockId);
    return before.parentId !== after.parentId ||
      beforePlacement.childIndex !== afterPlacement.childIndex
      ? [
          {
            kind: "placeBlock" as const,
            blockId,
            placement: beforePlacement,
          },
        ]
      : [];
  });
  const restoredBlocks = removedRecords.length
    ? ([{ kind: "restoreBlocks", blocks: removedRecords }] as const)
    : [];
  const removeCreated = createdRoots.length
    ? ([
        {
          kind: "removeBlocks",
          blockIds: createdRoots,
          includeDescendants: true,
          expectedParents: Object.fromEntries(
            createdRoots.map((blockId) => [
              blockId,
              transaction.blocks[blockId]!.parentId,
            ]),
          ),
        },
      ] as const)
    : [];
  const forwardGraphOperations = plan.operations.filter(
    (operation) =>
      operation.kind !== "appendTextBlockContent" &&
      operation.kind !== "setSelection",
  );
  const restoredContentOperations = plan.operations.flatMap((operation) => {
    if (operation.kind !== "appendTextBlockContent") return [];
    const source = previousState.blocks[operation.sourceBlockId];
    if (!source || source.tombstone) return [];
    return [
      {
        kind: "insertInlineContent" as const,
        blockId: source.id,
        blockType: source.type,
        target: { kind: "text" as const },
        position: { blockId: source.id, offset: 0 },
        content: operation.operation.content,
      },
    ];
  });
  return {
    forward: {
      kind: "structuralTransaction",
      origin: plan.origin,
      graphOperations: forwardGraphOperations,
      contentOperations: transaction.contentOperations.flatMap(
        (batch) => batch.operations,
      ),
      contentOrder: "before-graph",
    },
    inverse: {
      kind: "structuralTransaction",
      origin: plan.origin,
      graphOperations: [
        ...removeCreated,
        ...restoredBlocks,
        ...movedBack,
      ],
      contentOperations: restoredContentOperations,
      contentOrder: "after-graph",
    },
  };
}

function blockPlacement(
  graph: Pick<
    EditorCommandState,
    "blocks" | "rootBlockIds" | "childIdsByParentId"
  >,
  blockId: BlockId,
): BlockPlacement {
  const block = graph.blocks[blockId];
  if (!block) throw new Error(`block ${blockId} has no placement`);
  const siblings =
    block.parentId === null
      ? graph.rootBlockIds
      : (graph.childIdsByParentId[block.parentId] ?? []);
  const childIndex = siblings.indexOf(blockId);
  if (childIndex < 0) throw new Error(`block ${blockId} is not contained`);
  return { parentId: block.parentId, childIndex };
}

function structuralDepth(
  graph: Pick<EditorCommandState, "blocks">,
  blockId: BlockId,
): number {
  let depth = 0;
  let parentId = graph.blocks[blockId]?.parentId ?? null;
  while (parentId !== null) {
    depth += 1;
    parentId = graph.blocks[parentId]?.parentId ?? null;
  }
  return depth;
}

function groupContentOperations(
  operations: readonly EditorLogicalContentOperation[],
): readonly EditorBlockContentOperationBatch[] {
  const batches = new Map<BlockId, EditorLogicalContentOperation[]>();
  for (const operation of operations) {
    const batch = batches.get(operation.blockId) ?? [];
    batch.push(operation);
    batches.set(operation.blockId, batch);
  }
  return [...batches].map(([blockId, batch]) => ({
    blockId,
    operations: batch,
  }));
}

function historyOperationsFromPreparedContent(
  operations: Pick<EditorHistoryEntry, "forward" | "inverse">,
  prepared: ValidatedContentCommit,
): Pick<EditorHistoryEntry, "forward" | "inverse"> | null {
  if (
    operations.forward.kind === "structuralTransaction" &&
    operations.inverse.kind === "structuralTransaction"
  ) {
    return {
      forward: {
        ...operations.forward,
        contentOperations: prepared.blocks.flatMap(
          (block) => block.contentOperations,
        ),
      },
      inverse: {
        ...operations.inverse,
        contentOperations: mergePreparedInverseContentOperations(
          operations.inverse.contentOperations,
          prepared,
        ),
      },
    };
  }
  if (
    operations.forward.kind !== "blockGraph" ||
    operations.inverse.kind !== "blockGraph"
  ) {
    return null;
  }
  const forward = operations.forward;
  const inverse = operations.inverse;
  return {
    forward: graphLogicalOperationFromPreparedContent(
      forward,
      prepared,
      "forward",
    ),
    inverse: graphLogicalOperationFromPreparedContent(
      inverse,
      prepared,
      "inverse",
    ),
  };
}

function graphOperationFromPreparedContent(
  operation: EditorBlockGraphOperation<TransformBlocksPayload>,
  prepared: ValidatedContentCommit,
  direction: "forward" | "inverse",
): EditorBlockGraphOperation<TransformBlocksPayload> {
  return {
    ...operation,
    body: {
      ...operation.body,
      payload: graphPayloadFromPreparedContent(
        operation.body.payload,
        prepared,
        direction,
      ),
    },
  };
}

function graphLogicalOperationFromPreparedContent(
  operation: Extract<EditorOperation, { readonly kind: "blockGraph" }>,
  prepared: ValidatedContentCommit,
  direction: "forward" | "inverse",
): Extract<EditorOperation, { readonly kind: "blockGraph" }> {
  return {
    ...operation,
    payload: graphPayloadFromPreparedContent(
      operation.payload,
      prepared,
      direction,
    ),
  };
}

function graphPayloadFromPreparedContent(
  payload: TransformBlocksPayload,
  prepared: ValidatedContentCommit,
  direction: "forward" | "inverse",
): TransformBlocksPayload {
  const operations =
    direction === "forward"
      ? prepared.blocks.flatMap((block) => block.contentOperations)
      : mergePreparedInverseContentOperations(
          [],
          prepared,
          payload.removedBlockIds,
        );
  return {
    ...payload,
    contentOperations: groupContentOperations(operations),
  };
}

function mergePreparedInverseContentOperations(
  existing: readonly EditorLogicalContentOperation[],
  prepared: ValidatedContentCommit,
  excludedBlockIds: readonly BlockId[] = [],
): readonly EditorLogicalContentOperation[] {
  const occupiedBlockIds = new Set(existing.map((operation) => operation.blockId));
  const excluded = new Set(excludedBlockIds);
  const preparedOperations = [
    ...[...prepared.blocks]
      .reverse()
      .filter((block) => !excluded.has(block.blockId)),
    ...[...prepared.removedBlocks]
      .reverse()
      .filter(
        (block) =>
          !excluded.has(block.blockId) && !occupiedBlockIds.has(block.blockId),
      ),
  ].flatMap((block) => block.inverseContentOperations);
  return [...existing, ...preparedOperations];
}

function selectionGraphReaderForCommandState(
  state: EditorCommandState,
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
): EditorSelectionGraphReader {
  return {
    getBlock: (blockId) => state.blocks[blockId] ?? null,
    getParentId: (blockId) => state.blocks[blockId]?.parentId ?? null,
    getRootBlockIds: () => state.rootBlockIds,
    getChildBlockIds: (parentId) => state.childIdsByParentId[parentId] ?? [],
    readBlockSelectionModel: (blockId) => {
      const block = state.blocks[blockId];
      if (!block || block.tombstone) return null;
      const definition = blockDefinitions[block.type];
      if (!definition) return null;
      return (
        definition.selection ??
        (definition.kind === "text"
          ? contentSelection()
          : definition.kind === "atomic"
            ? wholeSelection()
            : wrapperSelection())
      );
    },
  };
}

function rebaseHistoryOperationFromSelection(
  operation: EditorOperation,
  storedSelection: EditorHistorySelection,
  resolvedEffect: Exclude<
    EditorCanonicalSelectionEffect,
    { readonly kind: "preserve" } | { readonly kind: "history-selection" }
  >,
): EditorOperation | null {
  if (
    storedSelection.kind !== "document" ||
    resolvedEffect.kind !== "selection"
  )
    return operation;
  const replayContentOperations = historyReplayContentOperations(operation);
  const deltas = new Map<BlockId, number>();
  for (const [stored, resolved] of [
    [storedSelection.selection.anchor, resolvedEffect.selection.anchor],
    [storedSelection.selection.focus, resolvedEffect.selection.focus],
  ] as const) {
    if (
      !stored.textAnchor ||
      !resolved.textAnchor ||
      stored.blockId !== resolved.blockId
    )
      continue;
    const expectedInputOffset = historyReplayPointMapping(
      stored,
      replayContentOperations,
    ).inputOffset;
    const delta = resolved.textOffset - expectedInputOffset;
    const current = deltas.get(stored.blockId);
    if (current !== undefined && current !== delta) {
      deltas.delete(stored.blockId);
      continue;
    }
    deltas.set(stored.blockId, delta);
  }
  if (deltas.size === 0 || [...deltas.values()].every((delta) => delta === 0))
    return operation;
  return shiftHistoryOperation(operation, deltas);
}

function shiftHistoryOperation(
  operation: EditorOperation,
  deltas: ReadonlyMap<BlockId, number>,
): EditorOperation | null {
  if (operation.kind === "composite") {
    const operations: EditorOperation[] = [];
    for (const child of operation.operations) {
      const shifted = shiftHistoryOperation(child, deltas);
      if (!shifted) return null;
      operations.push(shifted);
    }
    return { kind: "composite", operations };
  }
  if (operation.kind === "blockGraph") {
    const contentOperations: EditorBlockContentOperationBatch[] = [];
    for (const batch of operation.payload.contentOperations ?? []) {
      const shiftedOperations: EditorLogicalContentOperation[] = [];
      for (const child of batch.operations) {
        const shifted = shiftHistoryContentOperation(child, deltas);
        if (!shifted) return null;
        shiftedOperations.push(shifted);
      }
      contentOperations.push({
        blockId: batch.blockId,
        operations: shiftedOperations,
      });
    }
    return {
      ...operation,
      payload: { ...operation.payload, contentOperations },
    };
  }
  if (operation.kind === "structuralTransaction") {
    const contentOperations: EditorLogicalContentOperation[] = [];
    for (const child of operation.contentOperations) {
      const shifted = shiftHistoryContentOperation(child, deltas);
      if (!shifted) return null;
      contentOperations.push(shifted);
    }
    return { ...operation, contentOperations };
  }
  if (operation.kind === "updateBlockMetadata") return operation;
  return shiftHistoryContentOperation(operation, deltas);
}

function shiftHistoryContentOperation(
  operation: EditorLogicalContentOperation,
  deltas: ReadonlyMap<BlockId, number>,
): EditorLogicalContentOperation | null {
  const delta = deltas.get(operation.blockId) ?? 0;
  if (delta === 0) return operation;
  const shift = (offset: number): number | null => {
    const shifted = offset + delta;
    return Number.isSafeInteger(shifted) && shifted >= 0 ? shifted : null;
  };
  if (operation.kind === "insertInlineContent") {
    const offset = shift(operation.position.offset);
    return offset === null
      ? null
      : { ...operation, position: { ...operation.position, offset } };
  }
  const from = shift(operation.range.from.offset);
  const to = shift(operation.range.to.offset);
  return from === null || to === null
    ? null
    : {
        ...operation,
        range: {
          from: { ...operation.range.from, offset: from },
          to: { ...operation.range.to, offset: to },
        },
      };
}

function historyReplayContentOperations(
  operation: EditorOperation,
): readonly EditorLogicalContentOperation[] {
  if (operation.kind === "composite") {
    return operation.operations.flatMap(historyReplayContentOperations);
  }
  if (operation.kind === "blockGraph") {
    return (operation.payload.contentOperations ?? []).flatMap(
      (batch) => batch.operations,
    );
  }
  if (operation.kind === "structuralTransaction") {
    return operation.contentOperations;
  }
  return operation.kind === "updateBlockMetadata" ? [] : [operation];
}

function historyReplayPointMapping(
  point: EditorLogicalSelectionPoint,
  operations: readonly EditorLogicalContentOperation[],
): {
  readonly inputOffset: number;
  readonly affinity: EditorSelectionTextAffinity | null;
} {
  let targetOffset = point.textOffset;
  let derived: EditorSelectionTextAffinity | null | undefined;
  for (let index = operations.length - 1; index >= 0; index -= 1) {
    const operation = operations[index]!;
    if (operation.blockId !== point.blockId) continue;
    switch (operation.kind) {
      case "insertInlineContent": {
        const start = operation.position.offset;
        const insertedSize = richInlineContentSize(operation.content);
        const end = start + insertedSize;
        if (derived === undefined) {
          if (targetOffset === start) derived = "backward";
          else if (targetOffset === end) derived = "forward";
        }
        targetOffset = mapInsertedResultOffsetToInput(
          targetOffset,
          start,
          insertedSize,
        );
        break;
      }
      case "replaceInlineRange": {
        const start = operation.range.from.offset;
        const removedSize = operation.range.to.offset - start;
        const insertedSize = richInlineContentSize(operation.content);
        const end = start + insertedSize;
        if (derived === undefined) {
          if (targetOffset === start) derived = "backward";
          else if (targetOffset === end) derived = "forward";
        }
        targetOffset = mapReplacementResultOffsetToInput(
          targetOffset,
          start,
          removedSize,
          insertedSize,
          derived ?? point.affinity,
        );
        break;
      }
      case "setInlineEntity": {
        const start = operation.range.from.offset;
        const removedSize = operation.range.to.offset - start;
        const insertedSize = richInlineContentSize([operation.entity]);
        const end = start + insertedSize;
        if (derived === undefined) {
          if (targetOffset === start) derived = "backward";
          else if (targetOffset === end) derived = "forward";
        }
        targetOffset = mapReplacementResultOffsetToInput(
          targetOffset,
          start,
          removedSize,
          insertedSize,
          derived ?? point.affinity,
        );
        break;
      }
      case "deleteInlineRange": {
        const start = operation.range.from.offset;
        const removedSize = operation.range.to.offset - start;
        if (derived === undefined && targetOffset === start) {
          // The collapsed result point denotes the right edge of the replay
          // input. Forward association lets intervening edits and the inverse
          // insertion carry it back to that edge before deletion collapses it.
          derived = "forward";
        }
        targetOffset = mapDeletionResultOffsetToInput(
          targetOffset,
          start,
          removedSize,
          derived ?? point.affinity,
        );
        break;
      }
      case "addInlineMark":
      case "removeInlineMark":
        break;
    }
  }
  return {
    inputOffset: targetOffset,
    affinity: derived ?? point.affinity,
  };
}

function sameLogicalSelectionPoint(
  left: EditorLogicalSelectionPoint,
  right: EditorLogicalSelectionPoint,
): boolean {
  return (
    left.blockId === right.blockId &&
    left.blockType === right.blockType &&
    left.textOffset === right.textOffset &&
    left.affinity === right.affinity &&
    left.textAnchor?.codec === right.textAnchor?.codec &&
    left.textAnchor?.payload.encoded === right.textAnchor?.payload.encoded &&
    left.textAnchor?.payload.assoc === right.textAnchor?.payload.assoc
  );
}

function samePreparedContentSelectionPoint(
  left: EditorPreparedContentSelection["anchor"],
  right: EditorPreparedContentSelection["focus"],
): boolean {
  return (
    left.blockId === right.blockId &&
    left.blockType === right.blockType &&
    left.textOffset === right.textOffset &&
    left.affinity === right.affinity
  );
}

function composePreparedContentOperations(
  blocks: readonly ValidatedContentBlock[],
  key: "contentOperations" | "inverseContentOperations",
): EditorOperation {
  if (blocks.length === 1 && blocks[0]![key].length === 1)
    return blocks[0]![key][0]!;
  return composeEditorOperations(blocks.flatMap((block) => block[key]));
}

function mapInsertedResultOffsetToInput(
  offset: number,
  start: number,
  insertedSize: number,
): number {
  if (offset <= start) return offset;
  if (offset >= start + insertedSize) return offset - insertedSize;
  return start;
}

function mapDeletionResultOffsetToInput(
  offset: number,
  start: number,
  removedSize: number,
  affinity: EditorSelectionTextAffinity | null,
): number {
  if (offset < start) return offset;
  if (offset > start) return offset + removedSize;
  return affinity === "forward" ? start + removedSize : start;
}

function mapReplacementResultOffsetToInput(
  offset: number,
  start: number,
  removedSize: number,
  insertedSize: number,
  affinity: EditorSelectionTextAffinity | null,
): number {
  if (offset < start) return offset;
  const resultEnd = start + insertedSize;
  if (offset > resultEnd) return offset - insertedSize + removedSize;
  if (offset === start) {
    return affinity === "forward" ? start + removedSize : start;
  }
  if (offset === resultEnd) return start + removedSize;
  return start;
}

function flattenContentOperations(
  operation: EditorOperation,
):
  | readonly import("@repo/editor-core/operations").EditorLogicalContentOperation[]
  | null {
  if (operation.kind === "composite") {
    const result: import("@repo/editor-core/operations").EditorLogicalContentOperation[] =
      [];
    for (const step of operation.operations) {
      const nested = flattenContentOperations(step);
      if (!nested) return null;
      result.push(...nested);
    }
    return result;
  }
  return operation.kind === "blockGraph" ||
    operation.kind === "updateBlockMetadata" ||
    operation.kind === "structuralTransaction"
    ? null
    : [operation];
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" || typeof value === "function") &&
    value !== null &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function normalizeMaximumHistoryEntries(value: number | undefined): number {
  const maximum = value ?? DEFAULT_MAXIMUM_HISTORY_ENTRIES;
  if (!Number.isSafeInteger(maximum) || maximum < 1) {
    throw new TypeError(
      "maximumHistoryEntries must be a positive safe integer",
    );
  }
  return maximum;
}
