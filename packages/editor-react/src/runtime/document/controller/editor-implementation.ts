import {
  cloneJsonValue,
  jsonValuesEqual,
  type MutableJsonObject,
} from "@repo/editor-core/kernel";
import {
  assertValidBlockGraphVersion,
  getCanonicalBlockOrder,
  getSubtreeBlockIds,
  getSubtreeOrderBounds,
} from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import {
  applyBlockGraphOperation,
  applyBlockGraphPatch,
  type BlockGraphReplayContext,
} from "@repo/editor-core/operations";
import {
  applyStructuralTransaction,
  assertValidCanonicalBlockFragment,
  materializeCanonicalBlockCreation,
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
import {
  operationAnchorRequirement,
  validateBlockGraphOperationBody,
} from "@repo/editor-core/operations";
import type {
  EditorBlockContentOperationBatch,
  EditorBlockGraphOperationBody,
  EditorContentOperationReplayStep,
  EditorOperationAnchor,
  EditorOperationReplayBoundary,
  TransformBlocksPayload,
} from "@repo/editor-core/operations";
import type {
  BlockMetadataDeletion,
  BlockMetadataUpdate,
  EditorLogicalBlockGraphOperation,
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
  CanonicalSelectionSettlementResult,
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
  CanonicalEditorCommit,
} from "../api/contracts.ts";
import type {
  EditorHistoryEntry,
  EditorHistoryReplayPlan,
  EditorHistoryResult,
  EditorHistorySelection,
  EditorOperation,
  EditorStructuralHistoryOperation,
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
  readonly history: "record" | "refresh" | "ignore";
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

interface PreparedCanonicalHistoryOperations {
  readonly forward: EditorOperation;
  readonly inverse: EditorOperation;
}

interface ActiveHistoryReplayTransition {
  readonly direction: "undo" | "redo";
  readonly entryIndex: number;
  readonly entry: EditorHistoryEntry;
  readonly previousCanUndo: boolean;
  readonly previousCanRedo: boolean;
  readonly finalized: boolean;
}

type PreparedGraphCommitReceipt =
  | {
      readonly kind: "structural-state";
      readonly candidateBlockIds: readonly BlockId[];
    }
  | {
      readonly kind: "prepared-graph";
      readonly operation: EditorBlockGraphOperation;
    }
  | {
      readonly kind: "metadata";
      readonly operation: UpdateBlockMetadataOperation;
    };

type PreparedCanonicalCommit =
  | {
      readonly kind: "content-only";
      readonly validatedContent: ValidatedContentCommit;
      readonly preparedSelection:
        | EditorPreparedContentSelection
        | null
        | undefined;
      readonly requestedSelectionEffect: EditorCanonicalSelectionEffect;
      readonly editorSuggestion?: EditorOperationSuggestion | null;
      readonly origin: PreparedContentEditorTransactionOrigin;
      readonly selectionPresentation: ContentSelectionPresentation;
      readonly historyOperations: PreparedCanonicalHistoryOperations | null;
      readonly historyAction: "command" | "undo" | "redo";
      readonly provenance: EditorLocalMutationProvenance | null;
      readonly publication: "immediate" | "delayed-content-release";
    }
  | {
      readonly kind: "graph";
      readonly previousState: EditorCommandState;
      readonly nextState: EditorCommandState;
      readonly update: EditorDocumentUpdate;
      readonly validatedContent: ValidatedContentCommit | null;
      readonly requestedSelectionEffect?: EditorCanonicalSelectionEffect;
      readonly editorSuggestion?: EditorOperationSuggestion | null;
      readonly suggestionContentAccess: "live-only" | "prepared-graph-content";
      readonly origin: EditorOperationRequest["origin"];
      readonly selectionPresentation:
        | "canonical-only"
        | "native-before-removal";
      readonly historyOperations: PreparedCanonicalHistoryOperations | null;
      readonly historyAction: "command" | "undo" | "redo";
      readonly provenance: EditorLocalMutationProvenance | null;
      readonly structuralDraftAlreadyValidated: boolean;
      readonly receipt: PreparedGraphCommitReceipt;
    };

type CanonicalCommitPhase =
  | "history-selection-before"
  | "content-commit"
  | "selection-resolution"
  | "history-selection-after"
  | "canonical-installation";

interface PreparedCanonicalCommitFailure {
  readonly ok: false;
  readonly phase: CanonicalCommitPhase;
  readonly reason: "application-failed" | "content-operations-rejected";
  readonly message: string;
  readonly cause?: unknown;
  readonly contentApplied: boolean;
}

type PreparedCanonicalCommitResult =
  | {
      readonly ok: true;
      readonly appliedContent: AppliedContentCommit | null;
      readonly release: (() => void) | null;
    }
  | PreparedCanonicalCommitFailure;

class ActiveEditorMutationFailure extends Error {}

class FatalHistoryReplayConsistencyFailure extends Error {
  constructor(error: unknown) {
    super(error instanceof Error ? error.message : String(error), {
      cause: error,
    });
    this.name = "FatalHistoryReplayConsistencyFailure";
  }
}

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
  private readonly directChildBlocksByParentId = new Map<
    BlockId,
    readonly VersionedBlock[]
  >();
  private readonly directChildBlockListenersByParentId = new Map<
    BlockId,
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
  private activeHistoryReplayTransition: ActiveHistoryReplayTransition | null =
    null;
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

  clearHistoryForContentReconciliation(): void {
    if (this.history.length === 0) return;
    const previousCanUndo = this.canUndo;
    const previousCanRedo = this.canRedo;
    this.history = [];
    this.historyIndex = 0;
    this.historyRevision += 1;
    this.notifyCommandAvailabilityIfChanged(previousCanUndo, previousCanRedo);
  }

  undo(): EditorHistoryResult {
    if (this.historyReplayInProgress) {
      return {
        status: "execution-unavailable",
        reason: "history-replay-in-progress",
      };
    }
    if (!this.canUndo) return { status: "history-empty" };
    const entryIndex = this.historyIndex - 1;
    const entry = this.history[entryIndex]!;
    if (entry.state !== "applied") {
      return {
        status: "operation-application-failed",
        message: "history undo entry is not applied",
      };
    }
    this.activeHistoryReplayTransition = {
      direction: "undo",
      entryIndex,
      entry,
      previousCanUndo: this.canUndo,
      previousCanRedo: this.canRedo,
      finalized: false,
    };
    this.historyReplayInProgress = true;
    try {
      const result = this.applyHistoryOperation(
        entry.nextUndo,
        "undo",
        entry.selectionBefore,
      );
      return result;
    } finally {
      this.activeHistoryReplayTransition = null;
      this.historyReplayInProgress = false;
    }
  }

  redo(): EditorHistoryResult {
    if (this.historyReplayInProgress) {
      return {
        status: "execution-unavailable",
        reason: "history-replay-in-progress",
      };
    }
    if (!this.canRedo) return { status: "history-empty" };
    const entryIndex = this.historyIndex;
    const entry = this.history[entryIndex]!;
    if (entry.state !== "undone") {
      return {
        status: "operation-application-failed",
        message: "history redo entry is not undone",
      };
    }
    this.activeHistoryReplayTransition = {
      direction: "redo",
      entryIndex,
      entry,
      previousCanUndo: this.canUndo,
      previousCanRedo: this.canRedo,
      finalized: false,
    };
    this.historyReplayInProgress = true;
    try {
      const result = this.applyHistoryOperation(
        entry.nextRedo,
        "redo",
        entry.selectionAfter,
      );
      return result;
    } finally {
      this.activeHistoryReplayTransition = null;
      this.historyReplayInProgress = false;
    }
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

  private resolveHistoryReplayPlan(
    plan: EditorHistoryReplayPlan,
  ): EditorOperation | null {
    const resolve = this.options.resolveOperationAnchors;
    const operations: EditorOperation[] = [];
    const introducedBlockIds = new Set<BlockId>();
    const replayOutputs = new Map<
      number,
      {
        readonly blockId: BlockId;
        readonly start: number;
        readonly end: number;
      }
    >();
    const priorContentOperations = new Map<
      BlockId,
      EditorLogicalContentOperation[]
    >();
    const anchorGroups = new Map<
      BlockId,
      {
        readonly blockType: BlockType;
        readonly anchors: EditorOperationAnchor[];
      }
    >();
    for (const step of plan.steps) {
      if (step.kind !== "content") continue;
      const boundaries =
        step.anchors.kind === "position"
          ? [step.anchors.position]
          : [step.anchors.start, step.anchors.end];
      for (const boundary of boundaries) {
        if (!("codec" in boundary)) continue;
        const existing = anchorGroups.get(step.blockId);
        if (existing && existing.blockType !== step.blockType) return null;
        if (existing) {
          existing.anchors.push(boundary);
        } else {
          anchorGroups.set(step.blockId, {
            blockType: step.blockType,
            anchors: [boundary],
          });
        }
      }
    }
    const resolvedAnchorOffsets = new Map<EditorOperationAnchor, number>();
    if (anchorGroups.size > 0 && !resolve) return null;
    for (const [blockId, group] of anchorGroups) {
      const result = resolve!({
        blockId,
        blockType: group.blockType,
        anchors: group.anchors,
      });
      if (!result.ok || result.textOffsets.length !== group.anchors.length) {
        return null;
      }
      for (const [index, anchor] of group.anchors.entries()) {
        const textOffset = result.textOffsets[index];
        if (
          typeof textOffset !== "number" ||
          !Number.isSafeInteger(textOffset) ||
          textOffset < 0
        )
          return null;
        resolvedAnchorOffsets.set(anchor, textOffset);
      }
    }
    const resolveBoundary = (
      step: EditorContentOperationReplayStep,
      boundary: EditorOperationReplayBoundary,
      stepIndex: number,
    ): number | null => {
      if (!("codec" in boundary)) {
        if (boundary.kind === "block-start") {
          return boundary.blockId === step.blockId &&
            introducedBlockIds.has(step.blockId)
            ? 0
            : null;
        }
        const output = replayOutputs.get(boundary.stepIndex);
        return boundary.stepIndex < stepIndex &&
          output?.blockId === step.blockId &&
          Number.isInteger(boundary.offset) &&
          boundary.offset >= 0 &&
          boundary.offset <= output.end - output.start
          ? output.start + boundary.offset
          : null;
      }
      const textOffset = resolvedAnchorOffsets.get(boundary);
      return textOffset === undefined
        ? null
        : mapReplayInputBoundary(
            textOffset,
            boundary.association,
            priorContentOperations.get(step.blockId) ?? [],
          );
    };
    for (const [stepIndex, step] of plan.steps.entries()) {
      if (step.kind === "anchor-free") {
        operations.push(step.operation);
        for (const blockId of replayIntroducedBlockIds(step.operation)) {
          introducedBlockIds.add(blockId);
        }
        continue;
      }
      if (step.anchors.kind === "position") {
        const position = resolveBoundary(
          step,
          step.anchors.position,
          stepIndex,
        );
        if (position === null) {
          throw new Error(
            `Operation insertion boundary did not resolve for ${step.blockId}`,
          );
        }
        if (step.operation.kind !== "insertInlineContent") return null;
        const operation = {
          ...step.operation,
          position: {
            ...step.operation.position,
            offset: position,
          },
        };
        operations.push(operation);
        replayOutputs.set(stepIndex, {
          blockId: step.blockId,
          start: position,
          end: position + richInlineContentSize(operation.content),
        });
        const prior = priorContentOperations.get(step.blockId) ?? [];
        prior.push(operation);
        priorContentOperations.set(step.blockId, prior);
        continue;
      }
      const start = resolveBoundary(step, step.anchors.start, stepIndex);
      const end = resolveBoundary(step, step.anchors.end, stepIndex);
      if (start === null || end === null || start > end) {
        throw new Error(
          `Operation range boundaries did not resolve in order for ${step.blockId} (${String(start)}/${String(end)})`,
        );
      }
      if (step.operation.kind === "insertInlineContent") return null;
      const operation = {
        ...step.operation,
        range: {
          from: { ...step.operation.range.from, offset: start },
          to: { ...step.operation.range.to, offset: end },
        },
      };
      operations.push(operation);
      const outputSize = replayContentOperationOutputSize(operation);
      if (outputSize !== null) {
        replayOutputs.set(stepIndex, {
          blockId: step.blockId,
          start,
          end: start + outputSize,
        });
      }
      const prior = priorContentOperations.get(step.blockId) ?? [];
      prior.push(operation);
      priorContentOperations.set(step.blockId, prior);
    }
    const structural = operations.find(
      (operation): operation is EditorStructuralHistoryOperation =>
        operation.kind === "structuralTransaction",
    );
    if (structural) {
      const contentOperations = operations.filter(
        (operation): operation is EditorLogicalContentOperation =>
          operation.kind !== "composite" &&
          operation.kind !== "structuralTransaction" &&
          operation.kind !== "blockGraph" &&
          operation.kind !== "updateBlockMetadata",
      );
      if (operations.length === contentOperations.length + 1) {
        return { ...structural, contentOperations };
      }
    }
    const graph = operations.find(
      (operation): operation is EditorLogicalBlockGraphOperation =>
        operation.kind === "blockGraph",
    );
    if (graph) {
      const contentOperations = operations.filter(
        (operation): operation is EditorLogicalContentOperation =>
          operation.kind !== "composite" &&
          operation.kind !== "structuralTransaction" &&
          operation.kind !== "blockGraph" &&
          operation.kind !== "updateBlockMetadata",
      );
      if (operations.length === contentOperations.length + 1) {
        return {
          ...graph,
          payload: {
            ...graph.payload,
            contentOperations: groupContentOperations(contentOperations),
          },
        };
      }
    }
    return operations.length === 1
      ? operations[0]!
      : { kind: "composite", operations };
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
    replayPlan: EditorHistoryReplayPlan,
    direction: "undo" | "redo",
    selection: EditorHistorySelection,
  ): EditorHistoryResult {
    if (this.disposed) {
      return {
        status: "operation-application-failed",
        message: "editor is disposed",
      };
    }
    let releasedActiveProjection = false;
    const restoreActiveTextProjection = this.hasActiveCanonicalTextProjection();
    try {
      releasedActiveProjection =
        this.releaseActiveTextProjectionForMultiBlockReplay(replayPlan);
      const operation = this.resolveHistoryReplayPlan(replayPlan);
      if (!operation) {
        return {
          status: "operation-application-failed",
          message: `history ${direction} operation anchors could not be resolved`,
        };
      }
      const replayOperation = operation;
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
        const requestedNextState = {
          ...current,
          blocks: requestedBlocks,
          rootBlockIds: mutation.rootBlockIds,
          childIdsByParentId: mutation.childIdsByParentId,
        };
        const operationPair = createBlockGraphOperationPair({
          previousState: current,
          requestedNextState,
          contentOperations: mutation.contentOperations,
          candidateBlockIds: blockGraphPatchCandidateIds(mutation.patch),
          targetId: `${direction}:block-graph`,
        });
        if (!operationPair) {
          return {
            status: "operation-application-failed",
            message: `block graph ${direction} produced no reversible change`,
          };
        }
        const result = this.applyPreparedGraphTransaction(
          {
            reason: "runtime-mutation",
            nextState: requestedNextState,
            contentOperations: mutation.contentOperations,
            candidateBlockIds: blockGraphPatchCandidateIds(mutation.patch),
            operationTargetId: `${direction}:block-graph`,
            semanticOperation: replayOperation,
            origin: direction,
            selectionEffect,
            provenance: null,
          },
          {
            structuralDraftAlreadyValidated: false,
            historyOperations: {
              forward: operationPair.forward,
              inverse: operationPair.inverse,
            },
            preparedBlockGraphOperation: operationPair.preparedOperation,
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
                result.reason ?? `block graph ${direction} operation failed`,
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
        const inverse = createInverseBlockMetadataOperation(
          replayOperation,
          this.manifestState.blocks,
        );
        if (!inverse) {
          return {
            status: "operation-application-failed",
            message: `metadata ${direction} operation has no current inverse`,
          };
        }
        return this.executeBlockMetadataUpdateInternal(
          replayOperation,
          {},
          direction,
          { forward: replayOperation, inverse },
          this.historySelectionEffect(selection),
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
      if (error instanceof FatalHistoryReplayConsistencyFailure) throw error;
      return {
        status: "operation-application-failed",
        message:
          error instanceof Error
            ? error.message
            : `editor ${direction} operation failed`,
      };
    } finally {
      if (releasedActiveProjection && restoreActiveTextProjection) {
        this.presentCanonicalTextSelection();
      }
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
      history: "refresh",
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
        ? (this.options.acquireTextContentAccess?.(request.blockId) ?? null)
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
            return {
              ok: false,
              reason: "missing-block",
              blockId: selectedBlock.blockId,
            };
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
        ranges,
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
    historyOperations?: PreparedCanonicalHistoryOperations,
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

  getDirectChildBlocks(parentId: BlockId): readonly VersionedBlock[] {
    const cached = this.directChildBlocksByParentId.get(parentId);
    if (cached) return cached;
    const result: VersionedBlock[] = [];
    for (const childId of this.getChildBlockIds(parentId)) {
      const block = this.manifestState.blocks[childId];
      if (block && !block.tombstone && block.parentId === parentId) {
        result.push(block);
      }
    }
    const snapshot = Object.freeze(result);
    this.directChildBlocksByParentId.set(parentId, snapshot);
    return snapshot;
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

  subscribeDirectChildBlocks(
    parentId: BlockId,
    listener: () => void,
  ): () => void {
    if (this.disposed) return noop;
    const listeners = getOrCreateEditorListenerSet(
      this.directChildBlockListenersByParentId,
      parentId,
    );
    listeners.add(listener);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      listeners.delete(listener);
      if (listeners.size === 0)
        this.directChildBlockListenersByParentId.delete(parentId);
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
    this.clearHistoryForContentReconciliation();
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
    this.commitPreparedRemoteGraphMutation({
      nextState: input.nextState,
      update,
      validatedContent: input.validatedContent,
      afterCanonicalStateInstalled: input.afterCanonicalStateInstalled,
      selectionCause: "remote-transaction",
    });
    return { update, documentRevision: this.documentRevision };
  }

  private commitPreparedRemoteGraphMutation(input: {
    readonly nextState: EditorCommandState;
    readonly update: EditorDocumentUpdate;
    readonly validatedContent: ValidatedContentCommit | null;
    readonly afterCanonicalStateInstalled: () => void;
    readonly selectionCause: "remote-transaction" | "canonical-rebase";
  }): void {
    let appliedContent: AppliedContentCommit | null = null;
    try {
      appliedContent = input.validatedContent
        ? this.options.contentCommit!.commitContent(
            input.validatedContent,
            "none",
          )
        : null;
      const notify = this.commitCanonicalGraphMutation(
        input.nextState,
        input.update,
        false,
        undefined,
        true,
        {
          publication: { kind: "silent" },
          cause: input.selectionCause,
        },
      );
      input.afterCanonicalStateInstalled();
      if (appliedContent) {
        this.options.contentCommit!.publishContentCommit(appliedContent);
      }
      notify();
    } catch (error) {
      if (appliedContent) {
        this.markInconsistentAfterAppliedContent(
          "Canonical state installation failed after live content mutation",
          error,
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
    this.assertValidBootstrapState(nextState);
    const update = this.classifyDocumentUpdate(current, nextState, {
      candidateBlockIds: blockGraphPatchCandidateIds(mutation.patch),
      contentChangedBlockIds: mutation.contentOperations.map(
        (batch) => batch.blockId,
      ),
    });
    this.commitPreparedRemoteGraphMutation({
      nextState,
      update,
      validatedContent: preparedContent,
      afterCanonicalStateInstalled: noop,
      selectionCause: "canonical-rebase",
    });
    return nextState;
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
    return this.commitInitialBootstrap(nextState, {
      candidateBlockIds: blockGraphPatchCandidateIds(mutation.patch),
    });
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
    this.assertValidBootstrapState(nextState);
    const update = this.classifyDocumentUpdate(current, nextState, {
      candidateBlockIds: applied.affectedBlockIds,
    });
    this.commitPreparedRemoteGraphMutation({
      nextState,
      update,
      validatedContent: preparedContent,
      afterCanonicalStateInstalled: noop,
      selectionCause: "canonical-rebase",
    });
    return nextState;
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

  executeStructuralRangeDeletion(
    range: StructuralEditRange,
    options: {
      readonly intent: "cut" | "delete";
      readonly resolveVisibleChildBlockIds?: (input: {
        readonly blockId: BlockId;
        readonly blockType: BlockType;
        readonly childBlockIds: readonly BlockId[];
      }) => readonly BlockId[];
      readonly provenance?: EditorLocalMutationProvenance | null;
      readonly selectionPresentation?:
        | "canonical-only"
        | "native-final-selection";
    },
  ): EditorStructuralTransactionResult {
    const first = range.blocks[0];
    const last = range.blocks.at(-1);
    const operations: StructuralTransactionOperation[] = [
      createDeleteRangeOperation(range),
    ];
    if (
      first?.kind === "text" &&
      last?.kind === "text" &&
      first.blockId !== last.blockId &&
      first.parentId === last.parentId
    ) {
      operations.push(
        createJoinTextBlocksOperation(first.blockId, last.blockId),
      );
    }
    const result = this.executeStructuralTransaction(
      {
        origin: `structural-range-${options.intent}`,
        operations,
      },
      {
      provenance: options.provenance ?? null,
      selectionPresentation:
        options.selectionPresentation === "native-final-selection"
          ? "native-before-removal"
          : "canonical-only",
      },
    );
    if (
      result.ok &&
      options.selectionPresentation === "native-final-selection" &&
      result.transaction.selection.kind === "text-offset"
    ) {
      this.presentCanonicalTextSelection(result.transaction.selection.blockId);
    }
    return result;
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
    const roots = new Set(fragment.rootBlockIds);
    const records = fragment.blocks.map((record) =>
      roots.has(record.id)
        ? { ...record, parentId: placement.parentId }
        : record,
    );
    this.appendActiveTransactionOperation(
      createInsertBlocksOperation({
        placement,
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
    return {
      rootBlockIds: fragment.rootBlockIds,
      start: fragment.start,
      end: fragment.end,
    };
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
    return { deletedBlockIds: [...deleted] };
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
      const { metadata: currentMetadata, ...blockWithoutMetadata } = block;
      const next: VersionedBlock = {
        ...blockWithoutMetadata,
        type: blockType,
        ...(metadata === null
          ? {}
          : metadata === undefined
            ? currentMetadata === undefined
              ? {}
              : { metadata: currentMetadata }
            : { metadata: cloneJsonValue(metadata) }),
      };
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
    this.appendActiveTransactionOperation(
      createMoveBlocksOperation({
        blockIds,
        sourcePlacement: {
          parentId: sourceParentId,
          childIndex: sourceIndex,
        },
        destinationPlacement: destination,
      }),
    );
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
    return {
      survivorBlockId: leftBlockId,
      joinOffset,
    };
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
      return provisional.ok ? { ...provisional, defaultRootId } : provisional;
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
      (origin === "local-command" || this.historyReplayInProgress) &&
      !incrementalJoinHistory
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
    const historyOperations =
      input.history !== "ignore"
        ? {
            forward: composePreparedContentOperations(
              prepared.blocks,
              "contentOperations",
            ),
            inverse: composePreparedContentOperations(
              [...prepared.blocks].reverse(),
              "inverseContentOperations",
            ),
          }
        : null;
    const committed = this.commitPreparedCanonicalTransaction({
      kind: "content-only",
      validatedContent: prepared,
      preparedSelection: preparedSelection?.selection,
      requestedSelectionEffect: input.selectionEffect,
      editorSuggestion: input.editorSuggestion,
      origin: input.origin,
      selectionPresentation: input.selectionPresentation,
      historyOperations,
      historyAction: input.historyAction,
      provenance: input.provenance,
      publication: input.releaseAfterProposedStateInstalled
        ? "delayed-content-release"
        : "immediate",
    });
    if (!committed.ok) {
      return {
        ok: false,
        reason: "application-failed",
        message: committed.message,
      };
    }
    if (!committed.appliedContent) {
      throw new Error("A content-only transaction must apply content");
    }
    return {
      ok: true,
      commit: committed.appliedContent,
      release: committed.release,
    };
  }

  private commitPreparedCanonicalTransaction(
    prepared: PreparedCanonicalCommit,
  ): PreparedCanonicalCommitResult {
    const activeReplay = this.activeHistoryReplayTransition;
    const recordingHistoryEntry =
      prepared.historyOperations !== null && activeReplay === null;
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
    const failure = (
      phase: CanonicalCommitPhase,
      error: unknown,
      appliedContent: AppliedContentCommit | null = null,
    ): PreparedCanonicalCommitFailure => {
      const message = error instanceof Error ? error.message : String(error);
      return appliedContent
        ? this.failAfterAppliedContent(prepared, appliedContent, phase, error)
        : {
            ok: false,
            phase,
            reason: canonicalCommitFailureReason(prepared),
            message,
            cause: error,
            contentApplied: false,
          };
    };

    let preparedHistorySelectionBefore: {
      readonly ok: true;
      readonly selection: EditorHistorySelection;
    } | null = null;
    if (recordingHistoryEntry && prepared.historyOperations) {
      try {
        const graph =
          prepared.kind === "graph"
            ? selectionGraphReaderForCommandState(
                prepared.previousState,
                this.blockDefinitions,
              )
            : this;
        const result = this.prepareDurableHistorySelection(
          readHistorySelectionBefore(),
          prepared.historyOperations.inverse,
          "replay-result",
          graph,
        );
        if (!result.ok) {
          return failure("history-selection-before", result.message);
        }
        preparedHistorySelectionBefore = result;
      } catch (error) {
        return failure("history-selection-before", error);
      }
    }

    let appliedContent: AppliedContentCommit | null = null;
    if (prepared.validatedContent) {
      try {
        appliedContent = this.options.contentCommit!.commitContent(
          prepared.validatedContent,
          prepared.historyOperations || this.historyReplayInProgress
            ? "inverse"
            : "none",
        );
      } catch (error) {
        return failure("content-commit", error);
      }
    }

    let nextHistoryReplayPlan: EditorHistoryReplayPlan | null = null;
    let replayHistoryEntry: EditorHistoryEntry | null = null;
    try {
      if (prepared.historyOperations) {
        const capturedSteps =
          appliedContent?.replayCapture.kind === "inverse"
            ? appliedContent.replayCapture.steps
            : [];
        const inverseOperation =
          activeReplay?.direction === "undo"
            ? restoreMissingReplayContentOperations(
                prepared.historyOperations.inverse,
                activeReplay.entry.semanticForward,
              )
            : prepared.historyOperations.inverse;
        nextHistoryReplayPlan = createHistoryReplayPlan(
          inverseOperation,
          capturedSteps,
          historyReplayIntroducedBlockIds(prepared),
        );
        if (!nextHistoryReplayPlan) {
          throw new Error(
            `Required history operation anchors were not captured (${capturedSteps.length}/${historySelectionReplayContentOperations(prepared.historyOperations.inverse).length})`,
          );
        }
      }

      if (activeReplay) {
        const activeEntry = this.history[activeReplay.entryIndex];
        const expectedIndex =
          activeReplay.direction === "undo"
            ? activeReplay.entryIndex + 1
            : activeReplay.entryIndex;
        const activeStateMatches =
          activeReplay.direction === "undo"
            ? activeReplay.entry.state === "applied"
            : activeReplay.entry.state === "undone";
        if (
          !this.historyReplayInProgress ||
          activeReplay.finalized ||
          prepared.historyAction !== activeReplay.direction ||
          activeEntry !== activeReplay.entry ||
          this.historyIndex !== expectedIndex ||
          !activeStateMatches ||
          !prepared.historyOperations ||
          !nextHistoryReplayPlan
        ) {
          throw new Error(
            "Active history replay transition no longer matches the canonical commit",
          );
        }
        replayHistoryEntry = cloneAndFreezeHistoryEntry(
          activeReplay.direction === "undo"
            ? {
                semanticForward: restoreMissingReplayContentOperations(
                  prepared.historyOperations.inverse,
                  activeReplay.entry.semanticForward,
                ),
                semanticInverse: activeReplay.entry.semanticInverse,
                selectionBefore: activeReplay.entry.selectionBefore,
                selectionAfter: activeReplay.entry.selectionAfter,
                state: "undone",
                nextRedo: nextHistoryReplayPlan,
              }
            : {
                semanticForward: activeReplay.entry.semanticForward,
                semanticInverse: prepared.historyOperations.inverse,
                selectionBefore: activeReplay.entry.selectionBefore,
                selectionAfter: activeReplay.entry.selectionAfter,
                state: "applied",
                nextUndo: nextHistoryReplayPlan,
              },
        );
      } else if (this.historyReplayInProgress) {
        throw new Error("History replay has no active transition context");
      }
    } catch (error) {
      return failure("canonical-installation", error, appliedContent);
    }

    let resolvedSelection: ReturnType<
      EditorImplementation["resolvePreparedCanonicalSelection"]
    >;
    try {
      resolvedSelection = this.resolvePreparedCanonicalSelection(
        prepared,
        canonicalSelectionBefore,
        readHistorySelectionBefore,
      );
    } catch (error) {
      return failure("selection-resolution", error, appliedContent);
    }
    if (!resolvedSelection.ok) {
      return failure(
        "selection-resolution",
        resolvedSelection.message,
        appliedContent,
      );
    }

    let preparedHistorySelectionAfter: {
      readonly ok: true;
      readonly selection: EditorHistorySelection;
    } | null = null;
    if (recordingHistoryEntry && prepared.historyOperations) {
      try {
        const graph =
          prepared.kind === "graph"
            ? selectionGraphReaderForCommandState(
                prepared.nextState,
                this.blockDefinitions,
              )
            : this;
        const selection =
          resolvedSelection.effect.kind === "preserve"
            ? readHistorySelectionBefore()
            : this.captureHistorySelectionEffect(resolvedSelection.effect);
        const result = this.prepareDurableHistorySelection(
          selection,
          prepared.historyOperations.forward,
          "replay-result",
          graph,
        );
        if (!result.ok) {
          return failure(
            "history-selection-after",
            result.message,
            appliedContent,
          );
        }
        preparedHistorySelectionAfter = result;
      } catch (error) {
        return failure("history-selection-after", error, appliedContent);
      }
    }

    let transactionId: string;
    let notifyDocumentSubscribers = noop;
    try {
      transactionId = this.createTransactionId();
      if (prepared.kind === "content-only") {
        this.documentRevision += 1;
        this.applyCanonicalSelectionEffect(
          resolvedSelection.effect,
          prepared.selectionPresentation,
          {
            publication: { kind: "transaction", transactionId },
            cause: contentTransactionSelectionCause(prepared.origin),
          },
        );
      } else {
        notifyDocumentSubscribers = this.commitCanonicalGraphMutation(
          prepared.nextState,
          prepared.update,
          prepared.structuralDraftAlreadyValidated,
          resolvedSelection.effect,
          appliedContent !== null,
          {
            publication: { kind: "transaction", transactionId },
            cause: graphTransactionSelectionCause(prepared.origin),
          },
        );
      }
      if (activeReplay && replayHistoryEntry) {
        this.history[activeReplay.entryIndex] = replayHistoryEntry;
        this.historyIndex += activeReplay.direction === "undo" ? -1 : 1;
        this.historyRevision += 1;
        this.activeHistoryReplayTransition = {
          ...activeReplay,
          finalized: true,
        };
        this.notifyCommandAvailabilityIfChanged(
          activeReplay.previousCanUndo,
          activeReplay.previousCanRedo,
        );
      } else if (
        recordingHistoryEntry &&
        prepared.historyOperations &&
        preparedHistorySelectionBefore &&
        preparedHistorySelectionAfter &&
        nextHistoryReplayPlan
      ) {
        this.recordHistoryEntry({
          semanticForward: prepared.historyOperations.forward,
          semanticInverse: prepared.historyOperations.inverse,
          selectionBefore: preparedHistorySelectionBefore.selection,
          selectionAfter: preparedHistorySelectionAfter.selection,
          state: "applied",
          nextUndo: nextHistoryReplayPlan,
        });
      }
    } catch (error) {
      return failure("canonical-installation", error, appliedContent);
    }

    const canonicalSelectionAfter =
      this.selectionController.getCanonicalSnapshot();
    const receipt = this.createPreparedCanonicalCommitReceipt({
      prepared,
      transactionId,
      baseDocumentRevision,
      documentRevision: this.documentRevision,
      canonicalSelectionBefore,
      canonicalSelectionAfter,
      appliedContent,
    });
    const completePublication = () =>
      this.completePreparedCanonicalPublication(
        receipt,
        appliedContent,
        prepared.kind === "graph" &&
          prepared.selectionPresentation === "native-before-removal",
        notifyDocumentSubscribers,
      );
    if (
      prepared.kind === "content-only" &&
      prepared.publication === "delayed-content-release"
    ) {
      let released = false;
      return {
        ok: true,
        appliedContent,
        release: () => {
          if (released) return;
          released = true;
          completePublication();
        },
      };
    }
    completePublication();
    return { ok: true, appliedContent, release: null };
  }

  private resolvePreparedCanonicalSelection(
    prepared: PreparedCanonicalCommit,
    canonicalSelectionBefore: CanonicalLocalSelection,
    readHistorySelectionBefore: () => EditorHistorySelection,
  ):
    | { readonly ok: true; readonly effect: EditorCanonicalSelectionEffect }
    | { readonly ok: false; readonly message: string } {
    if (prepared.kind === "content-only") {
      const preparedSelectionEffect =
        prepared.preparedSelection === undefined
          ? undefined
          : prepared.preparedSelection === null
            ? ({ kind: "clear" } as const)
            : this.createSelectionEffectFromPreparedContentSelection(
                prepared.preparedSelection,
              );
      if (
        prepared.preparedSelection !== undefined &&
        !preparedSelectionEffect
      ) {
        return {
          ok: false,
          message:
            "The accepted content selection could not be anchored after live content mutation",
        };
      }
      let effect =
        preparedSelectionEffect ??
        (prepared.requestedSelectionEffect.kind === "preserve"
          ? (this.createSelectionEffectFromSuggestion(
              prepared.editorSuggestion,
            ) ?? prepared.requestedSelectionEffect)
          : prepared.requestedSelectionEffect);
      if (effect.kind === "preserve") {
        if (canonicalSelectionBefore.kind === "block-internal") {
          effect = this.historySelectionEffect(readHistorySelectionBefore());
        } else {
          const selectionBefore = this.readCanonicalEditorSelection(
            canonicalSelectionBefore,
          );
          effect = selectionBefore
            ? { kind: "selection", selection: selectionBefore }
            : { kind: "clear" };
        }
      }
      return { ok: true, effect };
    }

    const suggestedSelectionEffect = prepared.requestedSelectionEffect
      ? null
      : prepared.suggestionContentAccess === "prepared-graph-content"
        ? this.createSelectionEffectFromSuggestionWithContentAccess(
            prepared.editorSuggestion,
            prepared.nextState.blocks,
          )
        : this.createSelectionEffectFromSuggestion(
            prepared.editorSuggestion,
            prepared.nextState.blocks,
          );
    const effect: EditorCanonicalSelectionEffect =
      prepared.requestedSelectionEffect ??
        suggestedSelectionEffect ?? { kind: "preserve" };
    return { ok: true, effect };
  }

  private failAfterAppliedContent(
    _prepared: PreparedCanonicalCommit,
    _appliedContent: AppliedContentCommit,
    phase: CanonicalCommitPhase,
    error: unknown,
  ): PreparedCanonicalCommitFailure {
    return this.markInconsistentAfterAppliedContent(
      `Canonical ${phase} failed after live content mutation`,
      error,
    );
  }

  private markInconsistentAfterAppliedContent(
    context: string,
    error: unknown,
  ): never {
    const message = error instanceof Error ? error.message : String(error);
    try {
      return this.options.contentCommit!.markInconsistent(
        `${context}: ${message}`,
      );
    } catch (inconsistentError) {
      if (this.activeHistoryReplayTransition) {
        throw new FatalHistoryReplayConsistencyFailure(inconsistentError);
      }
      throw inconsistentError;
    }
  }

  private createPreparedCanonicalCommitReceipt(input: {
    readonly prepared: PreparedCanonicalCommit;
    readonly transactionId: string;
    readonly baseDocumentRevision: number;
    readonly documentRevision: number;
    readonly canonicalSelectionBefore: CanonicalLocalSelection;
    readonly canonicalSelectionAfter: CanonicalLocalSelection;
    readonly appliedContent: AppliedContentCommit | null;
  }): CanonicalEditorCommit | null {
    const receiptBase = {
      transactionId: input.transactionId,
      baseDocumentRevision: input.baseDocumentRevision,
      documentRevision: input.documentRevision,
      selectionBefore: projectCanonicalSelectionToTransaction(
        input.canonicalSelectionBefore,
      ),
      selectionAfter: projectCanonicalSelectionToTransaction(
        input.canonicalSelectionAfter,
      ),
      historyAction: input.prepared.historyAction,
      provenance: input.prepared.provenance,
    } as const;
    if (input.prepared.kind === "content-only") {
      const publishedBlock = input.appliedContent?.blocks[0];
      if (!publishedBlock || input.appliedContent?.blocks.length !== 1) {
        return null;
      }
      return {
        ...receiptBase,
        kind: "content",
        blockId: publishedBlock.blockId,
        blockType: publishedBlock.blockType,
        operations: publishedBlock.contentOperations,
        inverseOperations: publishedBlock.inverseContentOperations,
        yjsUpdate: publishedBlock.operationUpdate,
      };
    }
    switch (input.prepared.receipt.kind) {
      case "metadata":
        return {
          ...receiptBase,
          kind: "block-metadata",
          operation: input.prepared.receipt.operation,
        };
      case "prepared-graph": {
        const metadataOperation = createCanonicalMetadataChangesFromStates(
          input.prepared.previousState,
          input.prepared.nextState,
          blockGraphPatchCandidateIds(
            input.prepared.receipt.operation.body.payload,
          ),
        );
        return {
          ...receiptBase,
          kind: "block-graph",
          graphChanges: createCanonicalGraphChanges(
            input.prepared.previousState,
            input.prepared.receipt.operation.body.payload,
            input.prepared.historyAction,
          ),
          ...(metadataOperation ? { metadataOperation } : {}),
          ...(input.appliedContent
            ? { contentCommit: input.appliedContent }
            : {}),
        };
      }
      case "structural-state": {
        const metadataOperation = createCanonicalMetadataChangesFromStates(
          input.prepared.previousState,
          input.prepared.nextState,
          input.prepared.receipt.candidateBlockIds,
        );
        return {
          ...receiptBase,
          kind: "block-graph",
          graphChanges: createCanonicalGraphChangesFromStates(
            input.prepared.previousState,
            input.prepared.nextState,
            input.prepared.receipt.candidateBlockIds,
            input.prepared.historyAction,
          ),
          ...(metadataOperation ? { metadataOperation } : {}),
          ...(input.appliedContent
            ? { contentCommit: input.appliedContent }
            : {}),
        };
      }
    }
  }

  private completePreparedCanonicalPublication(
    receipt: CanonicalEditorCommit | null,
    appliedContent: AppliedContentCommit | null,
    presentNativeSelection: boolean,
    notifyDocumentSubscribers: () => void,
  ): void {
    try {
      if (receipt) this.options.onCanonicalCommit?.(receipt);
    } catch {
      // The canonical commit is durable; observer failures are isolated.
    }
    if (appliedContent) {
      this.options.contentCommit!.publishContentCommit(appliedContent);
    }
    if (presentNativeSelection) this.presentCanonicalTextSelection();
    if (appliedContent) notifyDocumentSubscribers();
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

  private prepareDurableHistorySelection(
    selection: EditorHistorySelection,
    replayOperation: EditorOperation,
    currentContentSide: "replay-input" | "replay-result",
    graph: EditorSelectionGraphReader = this,
  ):
    | { readonly ok: true; readonly selection: EditorHistorySelection }
    | { readonly ok: false; readonly message: string } {
    if (selection.kind !== "document") return { ok: true, selection };
    const contentOperations =
      historySelectionReplayContentOperations(replayOperation);
    if (contentOperations.length === 0) return { ok: true, selection };
    const points = sameLogicalSelectionPoint(
      selection.selection.anchor,
      selection.selection.focus,
    )
      ? [selection.selection.anchor]
      : [selection.selection.anchor, selection.selection.focus];
    const contentAccessBlockIds = new Set<BlockId>();
    const contentAccessReleases = new Map<BlockId, () => void>();
    try {
      for (const point of points) {
        if (!point.textAnchor || contentAccessBlockIds.has(point.blockId)) {
          continue;
        }
        const replayMapping = historySelectionReplayPointMapping(
          point,
          contentOperations,
        );
        if (replayMapping.affinity === point.affinity) continue;
        const acquire = this.options.acquireTextContentAccess;
        if (!acquire) continue;
        contentAccessBlockIds.add(point.blockId);
        const release = acquire(point.blockId);
        if (release) {
          contentAccessReleases.set(point.blockId, release);
          continue;
        }
        const liveBlock = this.getBlock(point.blockId);
        const targetBlock = graph.getBlock(point.blockId);
        const introducedContentIsAlreadyPrepared =
          (!liveBlock || liveBlock.tombstone) &&
          Boolean(targetBlock && !targetBlock.tombstone);
        if (!introducedContentIsAlreadyPrepared) {
          return {
            ok: false,
            message: `History replay content access could not be acquired for ${point.blockId}`,
          };
        }
      }
      const finalizePoint = (
        point: EditorLogicalSelectionPoint,
      ):
        | { readonly ok: true; readonly point: EditorLogicalSelectionPoint }
        | { readonly ok: false; readonly message: string } => {
        if (!point.textAnchor) return { ok: true, point };
        const replayMapping = historySelectionReplayPointMapping(
          point,
          contentOperations,
        );
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
          point: {
            ...point,
            textOffset: point.textOffset,
            textAnchor: created.textAnchor,
            affinity,
          },
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
        selection: {
          kind: "document",
          selection: {
            direction: selection.selection.direction,
            anchor: anchor.point,
            focus: focus.point,
          },
        },
      };
    } finally {
      for (const release of [...contentAccessReleases.values()].reverse()) {
        release();
      }
    }
  }

  private historySelectionEffect(
    selection: EditorHistorySelection,
  ): Exclude<EditorCanonicalSelectionEffect, { readonly kind: "preserve" }> {
    return { kind: "history-selection", selection };
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
    this.directChildBlocksByParentId.clear();
    this.directChildBlockListenersByParentId.clear();
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
    this.assertValidBootstrapState(next);
    if (Object.is(next, current)) return current;
    this.commitCanonicalGraphMutation(
      next,
      this.classifyDocumentUpdate(current, next, classification),
    );
    return next;
  }

  private assertValidBootstrapState(next: EditorCommandState): void {
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
      readonly historyOperations?: PreparedCanonicalHistoryOperations;
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
    const preparedContent = this.prepareDocumentContentCommit(
      request.contentOperations,
      previousState,
      request.nextState,
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
        contentResult: {
          ok: false,
          applied: 0,
          failures: failure ? [failure] : [],
        },
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
      const failure = createEditorOperationFailure({
        request,
        previousState,
        message: policyFailures.join(", "),
      });
      return {
        ok: false,
        reason: "content-operations-rejected",
        contentResult: {
          ok: false,
          applied: 0,
          failures: failure ? [failure] : [],
        },
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
      const failure = createEditorOperationFailure({
        request,
        previousState,
        message:
          "Content-bearing structural history requires reversible content operations",
      });
      return {
        ok: false,
        reason: "content-operations-rejected",
        contentResult: {
          ok: false,
          applied: 0,
          failures: failure ? [failure] : [],
        },
        update,
      };
    }
    const contentResult: EditorContentOperationApplyResult = {
      ok: true,
      applied: request.contentOperations.reduce(
        (count, batch) => count + batch.operations.length,
        0,
      ),
      failures: [],
    };
    const committed = this.commitPreparedCanonicalTransaction({
      kind: "graph",
      previousState,
      nextState: request.nextState,
      update,
      validatedContent: preparedContent,
      requestedSelectionEffect:
        options.selectionEffect ?? request.selectionEffect,
      editorSuggestion: request.editorSuggestion,
      suggestionContentAccess: "prepared-graph-content",
      origin: request.origin,
      selectionPresentation: options.selectionPresentation,
      historyOperations,
      historyAction: graphTransactionHistoryAction(request.origin),
      provenance: request.provenance,
      structuralDraftAlreadyValidated: true,
      receipt: {
        kind: "structural-state",
        candidateBlockIds: request.candidateBlockIds ?? [],
      },
    });
    if (!committed.ok) {
      const failure = createEditorOperationFailure({
        request,
        previousState,
        message: committed.message,
      });
      return {
        ok: false,
        reason: "content-operations-rejected",
        contentResult: {
          ok: false,
          applied: 0,
          failures: failure ? [failure] : [],
        },
        update,
      };
    }
    return { ok: true, contentResult, update };
  }

  private applyPreparedGraphTransaction(
    request: EditorOperationRequest,
    options: {
      readonly structuralDraftAlreadyValidated?: boolean;
      readonly historyOperations?: PreparedCanonicalHistoryOperations;
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
    const contentResult: EditorContentOperationApplyResult = {
      ok: true,
      applied: request.contentOperations.reduce(
        (count, batch) => count + batch.operations.length,
        0,
      ),
      failures: [],
    };
    const receipt: PreparedGraphCommitReceipt =
      request.canonicalOperation?.kind === "updateBlockMetadata"
        ? { kind: "metadata", operation: request.canonicalOperation }
        : { kind: "prepared-graph", operation: effectiveOperation };
    const committed = this.commitPreparedCanonicalTransaction({
      kind: "graph",
      previousState,
      nextState: optimisticState,
      update: durableOperation.update,
      validatedContent: preparedContent,
      requestedSelectionEffect:
        options.selectionEffect ?? request.selectionEffect,
      editorSuggestion: request.editorSuggestion,
      suggestionContentAccess: "live-only",
      origin: request.origin,
      selectionPresentation: options.selectionPresentation ?? "canonical-only",
      historyOperations,
      historyAction: graphTransactionHistoryAction(request.origin),
      provenance: request.provenance,
      structuralDraftAlreadyValidated:
        options.structuralDraftAlreadyValidated ?? false,
      receipt,
    });
    if (!committed.ok) {
      const failure = createEditorOperationFailure({
        request,
        previousState,
        message: committed.message,
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
    const previousManifest = this.manifestState;
    const selectionSettlementCapture =
      !selectionEffect || selectionEffect.kind === "preserve"
        ? this.captureGraphSelectionSettlement()
        : null;
    const nextManifest = freezeManifestState(
      split.manifest,
      this.blockDefinitions,
      previousManifest,
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
      previousManifest,
      nextManifest,
    );
    const canonicalDocumentChanged =
      update.canonical.updatedBlockIds.length > 0 ||
      update.canonical.removedBlockIds.length > 0 ||
      update.canonical.contentChangedBlockIds.length > 0;
    let directChildParentIds: readonly BlockId[] = EMPTY_BLOCK_IDS;
    if (manifestChanged) {
      this.manifestState = nextManifest;
      directChildParentIds = this.invalidateDirectChildBlockProjections(
        update,
        previousManifest,
        nextManifest,
      );
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
      this.notifyDocumentSubscribers(update, directChildParentIds);
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

  private presentCanonicalTextSelection(expectedBlockId?: BlockId): void {
    const canonical = this.selectionController.getCanonicalSnapshot();
    const focus =
      canonical.kind === "document"
        ? canonical.snapshot.documentSelection.focus
        : null;
    if (
      !focus?.textAnchor ||
      (expectedBlockId !== undefined && focus.blockId !== expectedBlockId)
    ) {
      return;
    }
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
      ...(target.kind === "block-end" ? { placement: "end" as const } : {}),
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

  private releaseActiveTextProjectionForMultiBlockReplay(
    plan: EditorHistoryReplayPlan,
  ): boolean {
    const contentBlockIds = new Set(
      plan.steps.flatMap((step) =>
        step.kind === "content" ? [step.blockId] : [],
      ),
    );
    if (contentBlockIds.size < 2) return false;
    const canonical = this.selectionController.getCanonicalSnapshot();
    const focus =
      canonical.kind === "document"
        ? canonical.snapshot.documentSelection.focus
        : null;
    if (
      !focus?.textAnchor ||
      !this.options.hasActiveTextProjection?.(focus.blockId)
    ) {
      return false;
    }
    this.options.releaseNativeFocus?.(focus.blockId, "text");
    return true;
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
    if (effect.kind === "history-selection") {
      this.restoreHistorySelectionBestEffort(
        effect.selection,
        this,
        presentation,
        context,
      );
      return;
    }
    try {
      const settlement = this.settleCanonicalSelectionEffect(effect, context);
      this.projectSettledSelection(settlement, presentation);
    } catch {
      // Selection restoration is best effort and never rolls back the graph.
    }
  }

  private restoreHistorySelectionBestEffort(
    historySelection: EditorHistorySelection,
    graph: EditorSelectionGraphReader,
    presentation: CanonicalSelectionPresentation,
    context: import("../../../selection/model/types.ts").SelectionSettlementContext,
  ): Exclude<
    EditorCanonicalSelectionEffect,
    { readonly kind: "preserve" } | { readonly kind: "history-selection" }
  > {
    let materialized: Exclude<
      EditorCanonicalSelectionEffect,
      { readonly kind: "preserve" } | { readonly kind: "history-selection" }
    > = { kind: "clear" };
    try {
      materialized =
        this.materializeHistorySelectionEffect(historySelection, graph) ??
        materialized;
      const settlement = this.settleCanonicalSelectionEffect(
        materialized,
        context,
      );
      if (settlement.kind !== "rejected" || materialized.kind === "clear") {
        this.projectSettledSelection(settlement, presentation);
        return materialized;
      }
    } catch {
      // Fall through to deterministic clearing below.
    }
    materialized = { kind: "clear" };
    try {
      const settlement = this.settleCanonicalSelectionEffect(
        materialized,
        context,
      );
      this.projectSettledSelection(settlement, presentation);
    } catch {
      // Presentation is best effort; history content and state stay installed.
    }
    return materialized;
  }

  private materializeHistorySelectionEffect(
    historySelection: EditorHistorySelection,
    graph: EditorSelectionGraphReader = this,
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
        const acquireTextContentAccess = this.options.acquireTextContentAccess;
        const releaseContentAccess =
          descendant && acquireTextContentAccess
            ? acquireTextContentAccess(descendant.id)
            : null;
        if (descendant && acquireTextContentAccess && !releaseContentAccess) {
          return null;
        }
        let created: ReturnType<
          NonNullable<
            InitializeEditorImplementationOptions["createSelectionTextAnchor"]
          >
        > | null;
        try {
          created = descendant
            ? (this.options.createSelectionTextAnchor?.({
                blockId: descendant.id,
                blockType: descendant.type,
                textOffset: 0,
                affinity: null,
              }) ?? null)
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

    const contentAccessAttemptedBlockIds = new Set<BlockId>();
    const contentAccessReleases = new Map<BlockId, () => void>();
    const acquireHistoryContentAccess = (blockId: BlockId): boolean => {
      if (contentAccessReleases.has(blockId)) return true;
      const acquire = this.options.acquireTextContentAccess;
      if (!acquire) return true;
      if (contentAccessAttemptedBlockIds.has(blockId)) return false;
      contentAccessAttemptedBlockIds.add(blockId);
      const release = acquire(blockId);
      if (!release) return false;
      contentAccessReleases.set(blockId, release);
      return true;
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
      if (!acquireHistoryContentAccess(block.id)) return null;
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

      const created = this.options.createSelectionTextAnchor?.({
        blockId: block.id,
        blockType: block.type,
        textOffset: point.textOffset,
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

    let materialized: Exclude<
      EditorCanonicalSelectionEffect,
      { readonly kind: "preserve" } | { readonly kind: "history-selection" }
    > | null = null;
    let materializationFailed = false;
    let materializationError: unknown;
    try {
      const anchor = materializePoint(historySelection.selection.anchor);
      const focus = materializePoint(historySelection.selection.focus);
      materialized =
        anchor && focus
          ? {
              kind: "selection",
              selection: {
                direction: historySelection.selection.direction,
                anchor,
                focus,
              },
            }
          : null;
    } catch (error) {
      materializationFailed = true;
      materializationError = error;
    }
    let releaseFailed = false;
    let releaseError: unknown;
    for (const release of contentAccessReleases.values()) {
      try {
        release();
      } catch (error) {
        if (!releaseFailed) releaseError = error;
        releaseFailed = true;
      }
    }
    if (materializationFailed) throw materializationError;
    if (releaseFailed) throw releaseError;
    return materialized;
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
        ? (this.options.acquireTextContentAccess?.(block.id) ?? null)
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
    let settled: CanonicalSelectionSettlementResult | null = null;
    // A freshly created stable text anchor still has to be resolved during
    // canonical normalization. Inactive text projections need to remain
    // hydrated until that resolution has completed.
    const releases: Array<() => void> = [];
    let settlementFailed = false;
    let settlementError: unknown;
    try {
      if (effect.kind === "selection") {
        const blockIds = new Set<BlockId>();
        if (effect.selection.anchor.textAnchor) {
          blockIds.add(effect.selection.anchor.blockId);
        }
        if (effect.selection.focus.textAnchor) {
          blockIds.add(effect.selection.focus.blockId);
        }
        for (const blockId of blockIds) {
          const release = this.options.acquireTextContentAccess?.(blockId);
          if (release) releases.push(release);
        }
      }
      settled = this.selectionController.commitCanonicalSelection(
        effect.kind === "clear" ? null : effect.selection,
        this,
        this.getSelectionGraphRevision(),
        context,
        this.options.resolveSelectionTextAnchor
          ? { resolveTextAnchor: this.options.resolveSelectionTextAnchor }
          : null,
      );
    } catch (error) {
      settlementFailed = true;
      settlementError = error;
    }
    let releaseFailed = false;
    let releaseError: unknown;
    for (const release of releases.reverse()) {
      try {
        release();
      } catch (error) {
        if (!releaseFailed) releaseError = error;
        releaseFailed = true;
      }
    }
    if (settlementFailed) throw settlementError;
    if (releaseFailed) throw releaseError;
    if (!settled)
      throw new Error("Canonical selection settlement was not produced");
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
      presentation === "native-already-established" ||
      presentation === "installed-by-proposed-state"
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

  private invalidateDirectChildBlockProjections(
    update: EditorDocumentUpdate,
    previousManifest: EditorManifestState,
    nextManifest: EditorManifestState,
  ): readonly BlockId[] {
    const directChildParentIds = new Set<BlockId>();
    for (const parentId of update.containerSequences.changedParentIds) {
      if (parentId !== null) directChildParentIds.add(parentId);
    }
    const changedBlockIds = uniqueEditorBlockIds([
      ...update.canonical.updatedBlockIds,
      ...update.canonical.removedBlockIds,
      ...update.canonical.metadataChangedBlockIds,
      ...update.canonical.contentChangedBlockIds,
    ]);
    for (const blockId of changedBlockIds) {
      const previousBlock = previousManifest.blocks[blockId];
      if (
        previousBlock &&
        !previousBlock.tombstone &&
        previousBlock.parentId !== null
      ) {
        directChildParentIds.add(previousBlock.parentId);
      }
      const nextBlock = nextManifest.blocks[blockId];
      if (nextBlock && !nextBlock.tombstone && nextBlock.parentId !== null) {
        directChildParentIds.add(nextBlock.parentId);
      }
    }
    const orderedParentIds = [...directChildParentIds].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    for (const parentId of orderedParentIds) {
      this.directChildBlocksByParentId.delete(parentId);
    }
    return orderedParentIds;
  }

  private notifyDocumentSubscribers(
    update: EditorDocumentUpdate,
    directChildParentIds: readonly BlockId[],
  ): void {
    const changedBlockIds = uniqueEditorBlockIds([
      ...update.canonical.updatedBlockIds,
      ...update.canonical.removedBlockIds,
    ]).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
    // Observable block notifications run in block-ID order, followed by
    // canonical sequence notifications and direct-child projections in
    // deterministic parent order.
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

    for (const parentId of directChildParentIds) {
      const listeners = this.directChildBlockListenersByParentId.get(parentId);
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
      return (
        Boolean(before && !before.tombstone) && (!after || after.tombstone)
      );
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
      ? canonicalReceiptPlacementFromState(nextState, after, materialized!)
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

function createCanonicalMetadataChangesFromStates(
  previousState: EditorCommandState,
  nextState: EditorCommandState,
  affectedBlockIds: readonly BlockId[],
): UpdateBlockMetadataOperation | null {
  const updates: BlockMetadataUpdate[] = [];
  const deletions: BlockMetadataDeletion[] = [];
  for (const blockId of uniqueEditorBlockIds(affectedBlockIds)) {
    const before = previousState.blocks[blockId];
    const after = nextState.blocks[blockId];
    if (!before || before.tombstone || !after || after.tombstone) continue;
    const beforeMetadata = before.metadata ?? {};
    const afterMetadata = after.metadata ?? {};
    const fields = new Set([
      ...Object.keys(beforeMetadata),
      ...Object.keys(afterMetadata),
    ]);
    const values: MutableJsonObject = {};
    const removedFields: string[] = [];
    for (const field of fields) {
      const existedBefore = Object.hasOwn(beforeMetadata, field);
      const existsAfter = Object.hasOwn(afterMetadata, field);
      if (
        existedBefore === existsAfter &&
        (!existsAfter ||
          jsonValuesEqual(beforeMetadata[field]!, afterMetadata[field]!))
      ) {
        continue;
      }
      if (existsAfter) values[field] = cloneJsonValue(afterMetadata[field]!);
      else removedFields.push(field);
    }
    if (Object.keys(values).length > 0) updates.push({ blockId, values });
    if (removedFields.length > 0) {
      deletions.push({ blockId, fields: removedFields });
    }
  }
  return updates.length === 0 && deletions.length === 0
    ? null
    : {
        kind: "updateBlockMetadata",
        updates,
        ...(deletions.length === 0 ? {} : { deletions }),
      };
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
    nextSiblingId: nearestMaterializedSibling(siblings, index, 1, materialized),
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
      changes.push({
        kind: "restore",
        blockId: after.id,
        placement: placement!,
      });
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
    nextSiblingId: nearestMaterializedSibling(siblings, index, 1, materialized),
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
  return [...candidateBlockIds];
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
): PreparedCanonicalHistoryOperations | null {
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
      graphOperations: [...removeCreated, ...restoredBlocks, ...movedBack],
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

function historyReplayIntroducedBlockIds(
  prepared: PreparedCanonicalCommit,
): ReadonlySet<BlockId> {
  if (prepared.kind === "content-only") return new Set();
  return new Set(
    (Object.keys(prepared.previousState.blocks) as BlockId[]).filter(
      (blockId) =>
        prepared.previousState.blocks[blockId] !== undefined &&
        prepared.nextState.blocks[blockId] === undefined,
    ),
  );
}

function replayIntroducedBlockIds(
  operation: EditorOperation,
): readonly BlockId[] {
  if (operation.kind === "blockGraph") {
    return operation.payload.upsertedBlocks.map((block) => block.id);
  }
  if (operation.kind !== "structuralTransaction") return [];
  return operation.graphOperations.flatMap((graphOperation) => {
    if (graphOperation.kind === "restoreBlocks") {
      return graphOperation.blocks.map((record) => record.block.id);
    }
    if (graphOperation.kind === "insertBlocks") {
      return graphOperation.blocks.map((record) => record.id);
    }
    return [];
  });
}

function withBlockStartDependency(
  step: EditorContentOperationReplayStep,
  introducedBlockIds: ReadonlySet<BlockId>,
): EditorContentOperationReplayStep {
  if (step.operation.kind !== "insertInlineContent") {
    return step;
  }
  if (
    step.operation.position.offset !== 0 ||
    !introducedBlockIds.has(step.blockId)
  ) {
    return step;
  }
  return {
    kind: "content",
    blockId: step.blockId,
    blockType: step.blockType,
    operation: step.operation,
    anchors: {
      kind: "position",
      position: { kind: "block-start", blockId: step.blockId },
    },
  };
}

function replayContentOperationOutputSize(
  operation: EditorLogicalContentOperation,
): number | null {
  if (operation.kind === "insertInlineContent") {
    return richInlineContentSize(operation.content);
  }
  if (operation.kind === "replaceInlineRange") {
    return richInlineContentSize(operation.content);
  }
  if (operation.kind === "setInlineEntity") {
    return richInlineContentSize([operation.entity]);
  }
  return null;
}

function mapReplayInputBoundary(
  initialOffset: number,
  association: -1 | 1,
  operations: readonly EditorLogicalContentOperation[],
): number {
  let offset = initialOffset;
  for (const operation of operations) {
    if (
      operation.kind === "addInlineMark" ||
      operation.kind === "removeInlineMark"
    ) {
      continue;
    }
    if (operation.kind === "insertInlineContent") {
      offset = mapReplayBoundaryAcrossReplacement(
        offset,
        association,
        operation.position.offset,
        operation.position.offset,
        richInlineContentSize(operation.content),
      );
      continue;
    }
    offset = mapReplayBoundaryAcrossReplacement(
      offset,
      association,
      operation.range.from.offset,
      operation.range.to.offset,
      replayContentOperationOutputSize(operation) ?? 0,
    );
  }
  return offset;
}

function mapReplayBoundaryAcrossReplacement(
  offset: number,
  association: -1 | 1,
  from: number,
  to: number,
  insertedSize: number,
): number {
  if (offset < from) return offset;
  if (offset > to) return offset + insertedSize - (to - from);
  return association < 0 ? from : from + insertedSize;
}

interface ReplayOutputSpan {
  readonly stepIndex: number;
  readonly blockId: BlockId;
  readonly start: number;
  readonly end: number;
}

function createOrderedReplayDependencies(
  steps: EditorHistoryReplayPlan["steps"],
): EditorHistoryReplayPlan["steps"] {
  const outputs: ReplayOutputSpan[] = [];
  return steps.map((step, stepIndex) => {
    if (step.kind !== "content") return step;
    const dependencyFor = (
      offset: number,
      original: EditorOperationReplayBoundary,
    ): EditorOperationReplayBoundary => {
      for (let index = outputs.length - 1; index >= 0; index -= 1) {
        const output = outputs[index]!;
        if (
          output.blockId === step.blockId &&
          offset >= output.start &&
          offset <= output.end
        ) {
          return {
            kind: "step-output",
            stepIndex: output.stepIndex,
            offset: offset - output.start,
          };
        }
      }
      return original;
    };
    let dependentStep: EditorContentOperationReplayStep = step;
    if (
      step.operation.kind === "insertInlineContent" &&
      step.anchors.kind === "position"
    ) {
      dependentStep = {
        kind: "content",
        blockId: step.blockId,
        blockType: step.blockType,
        operation: step.operation,
        anchors: {
          kind: "position",
          position: dependencyFor(
            step.operation.position.offset,
            step.anchors.position,
          ),
        },
      };
    } else if (
      step.operation.kind !== "insertInlineContent" &&
      step.anchors.kind === "range"
    ) {
      dependentStep = {
        kind: "content",
        blockId: step.blockId,
        blockType: step.blockType,
        operation: step.operation,
        anchors: {
          kind: "range",
          start: dependencyFor(
            step.operation.range.from.offset,
            step.anchors.start,
          ),
          end: dependencyFor(step.operation.range.to.offset, step.anchors.end),
        },
      };
    }

    const operation = step.operation;
    if (operation.kind === "insertInlineContent") {
      const position = operation.position.offset;
      const size = richInlineContentSize(operation.content);
      for (let index = 0; index < outputs.length; index += 1) {
        const output = outputs[index]!;
        if (output.blockId !== step.blockId) continue;
        if (position < output.start) {
          outputs[index] = {
            ...output,
            start: output.start + size,
            end: output.end + size,
          };
        } else if (position <= output.end) {
          outputs[index] = { ...output, end: output.end + size };
        }
      }
    } else {
      const from = operation.range.from.offset;
      const to = operation.range.to.offset;
      const inserted = replayContentOperationOutputSize(operation) ?? 0;
      const delta = inserted - (to - from);
      for (let index = outputs.length - 1; index >= 0; index -= 1) {
        const output = outputs[index]!;
        if (output.blockId !== step.blockId) continue;
        if (to <= output.start) {
          outputs[index] = {
            ...output,
            start: output.start + delta,
            end: output.end + delta,
          };
        } else if (from < output.end && to > output.start) {
          outputs.splice(index, 1);
        }
      }
    }
    const outputSize = replayContentOperationOutputSize(operation);
    if (outputSize !== null) {
      const start =
        operation.kind === "insertInlineContent"
          ? operation.position.offset
          : operation.range.from.offset;
      outputs.push({
        stepIndex,
        blockId: step.blockId,
        start,
        end: start + outputSize,
      });
    }
    return dependentStep;
  });
}

function historyOperationsFromPreparedContent(
  operations: PreparedCanonicalHistoryOperations,
  prepared: ValidatedContentCommit,
): PreparedCanonicalHistoryOperations | null {
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

function restoreMissingReplayContentOperations(
  computed: EditorOperation,
  original: EditorOperation,
): EditorOperation {
  if (computed.kind === "blockGraph" && original.kind === "blockGraph") {
    const computedBatches = computed.payload.contentOperations ?? [];
    const occupiedIds = new Set(
      computedBatches
        .filter((batch) => batch.operations.length > 0)
        .map((batch) => batch.blockId),
    );
    const restoredIds = new Set(
      computed.payload.upsertedBlocks.map((block) => block.id),
    );
    const restoredContent = (original.payload.contentOperations ?? []).filter(
      (batch) =>
        restoredIds.has(batch.blockId) && !occupiedIds.has(batch.blockId),
    );
    return restoredContent.length === 0
      ? computed
      : {
          ...computed,
          payload: {
            ...computed.payload,
            contentOperations: [...computedBatches, ...restoredContent],
          },
        };
  }
  if (
    computed.kind === "structuralTransaction" &&
    original.kind === "structuralTransaction"
  ) {
    const occupiedIds = new Set(
      computed.contentOperations.map((operation) => operation.blockId),
    );
    const restoredIds = new Set(
      computed.graphOperations.flatMap((operation) =>
        operation.kind === "restoreBlocks"
          ? operation.blocks.map((record) => record.block.id)
          : operation.kind === "insertBlocks"
            ? operation.blocks.map((record) => record.id)
            : [],
      ),
    );
    const restoredContent = original.contentOperations.filter(
      (operation) =>
        restoredIds.has(operation.blockId) &&
        !occupiedIds.has(operation.blockId),
    );
    return restoredContent.length === 0
      ? computed
      : {
          ...computed,
          contentOperations: [
            ...computed.contentOperations,
            ...restoredContent,
          ],
        };
  }
  return computed;
}

function createHistoryReplayPlan(
  operation: EditorOperation,
  capturedContentSteps: readonly EditorContentOperationReplayStep[],
  introducedBlockIds: ReadonlySet<BlockId> = new Set(),
): EditorHistoryReplayPlan | null {
  let capturedIndex = 0;
  const consumedCaptured = new Set<number>();
  const takeCaptured = (
    contentOperation: EditorLogicalContentOperation,
  ): EditorContentOperationReplayStep | null => {
    while (capturedIndex < capturedContentSteps.length) {
      const index = capturedIndex++;
      const candidate = capturedContentSteps[index]!;
      if (
        !consumedCaptured.has(index) &&
        capturedReplayStepMatchesOperation(candidate, contentOperation)
      ) {
        consumedCaptured.add(index);
        return candidate;
      }
    }
    for (const [index, candidate] of capturedContentSteps.entries()) {
      if (
        !consumedCaptured.has(index) &&
        capturedReplayStepMatchesOperation(candidate, contentOperation)
      ) {
        consumedCaptured.add(index);
        return candidate;
      }
    }
    return null;
  };
  const collect = (
    current: EditorOperation,
  ): EditorHistoryReplayPlan["steps"] | null => {
    if (current.kind === "composite") {
      const steps: EditorHistoryReplayPlan["steps"][number][] = [];
      for (const child of current.operations) {
        const childSteps = collect(child);
        if (!childSteps) return null;
        steps.push(...childSteps);
      }
      return steps;
    }
    if (current.kind === "structuralTransaction") {
      const contentSteps: EditorContentOperationReplayStep[] = [];
      for (const contentOperation of current.contentOperations) {
        const step = takeCaptured(contentOperation);
        if (!step) return null;
        contentSteps.push(
          current.contentOrder === "after-graph"
            ? withBlockStartDependency(step, introducedBlockIds)
            : step,
        );
      }
      const graphStep = {
        kind: "anchor-free" as const,
        operation: { ...current, contentOperations: Object.freeze([]) },
      };
      return current.contentOrder === "before-graph"
        ? [...contentSteps, graphStep]
        : [graphStep, ...contentSteps];
    }
    if (current.kind === "blockGraph") {
      const contentOperations = (
        current.payload.contentOperations ?? []
      ).flatMap((batch) => batch.operations);
      const contentSteps: EditorContentOperationReplayStep[] = [];
      for (const contentOperation of contentOperations) {
        const step = takeCaptured(contentOperation);
        if (!step) return null;
        contentSteps.push(withBlockStartDependency(step, introducedBlockIds));
      }
      const { contentOperations: _contentOperations, ...payload } =
        current.payload;
      void _contentOperations;
      return [
        {
          kind: "anchor-free",
          operation: { ...current, payload },
        },
        ...contentSteps,
      ];
    }
    if (current.kind === "updateBlockMetadata") {
      return [{ kind: "anchor-free", operation: current }];
    }
    const step = takeCaptured(current);
    return step ? [step] : null;
  };
  const steps = collect(operation);
  return steps ? { steps: createOrderedReplayDependencies(steps) } : null;
}

function capturedReplayStepMatchesOperation(
  step: EditorContentOperationReplayStep,
  operation: EditorLogicalContentOperation,
): boolean {
  if (
    step.blockId !== operation.blockId ||
    step.blockType !== operation.blockType ||
    !jsonValuesEqual(step.operation, operation)
  ) {
    return false;
  }
  const requirement = operationAnchorRequirement(operation);
  if (requirement.kind === "position") {
    return (
      step.anchors.kind === "position" &&
      "codec" in step.anchors.position &&
      step.anchors.position.codec.length > 0 &&
      step.anchors.position.association === requirement.association
    );
  }
  return (
    step.anchors.kind === "range" &&
    "codec" in step.anchors.start &&
    "codec" in step.anchors.end &&
    step.anchors.start.codec.length > 0 &&
    step.anchors.end.codec.length > 0 &&
    step.anchors.start.association === requirement.startAssociation &&
    step.anchors.end.association === requirement.endAssociation
  );
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
  const occupiedBlockIds = new Set(
    existing.map((operation) => operation.blockId),
  );
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

function historySelectionReplayContentOperations(
  operation: EditorOperation,
): readonly EditorLogicalContentOperation[] {
  if (operation.kind === "composite") {
    return operation.operations.flatMap(
      historySelectionReplayContentOperations,
    );
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

function historySelectionReplayPointMapping(
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

function canonicalCommitFailureReason(
  prepared: PreparedCanonicalCommit,
): PreparedCanonicalCommitFailure["reason"] {
  return prepared.kind === "content-only"
    ? "application-failed"
    : "content-operations-rejected";
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
