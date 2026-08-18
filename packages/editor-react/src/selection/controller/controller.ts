import { cloneJsonValue, type BlockId } from "@repo/editor-core/kernel";
import type { EditorContentBaseToken } from "@repo/editor-core/operations";
import type { BlockSelectionCoverageResult } from "@repo/editor-core/selection";
import {
  type EditorSelectionGraphReader,
} from "../graph/reader.ts";
import { validateEditorSelectionInvalidation } from "./invalidation.ts";
import {
  normalizeNewSelection,
  type EditorNormalizedSelectionRange,
} from "../normalization/normalize-range.ts";
import {
  isEditorSelectionTextAnchor,
  resolveEditorSelectionTextAnchorPoint,
} from "../anchors/text-anchor.ts";
import { createIdleSelectionSnapshot } from "../model/snapshot.ts";
import { snapshotHasValidTextBoundaryAnchors } from "./drag-diagnostics.ts";
import {
  createCommittedSelectionSnapshot,
  type CommittedSelectionSnapshot,
} from "../model/committed-selection-snapshot.ts";
import { projectCanonicalSelectionToStable } from "../model/stable-selection.ts";
import type { EditorStableSelection } from "../model/types.ts";
import type {
  CanonicalLocalSelection,
  EditorCanonicalSelectionReader,
} from "../model/canonical-selection.ts";
import {
  noLocalSelectionPaint,
  type EditorLocalSelectionPaintReader,
  type LocalSelectionPaintModel,
} from "../model/local-selection-paint.ts";
import type {
  EditorSelectionPresentationReader,
  SelectionPresentationSnapshot,
  SelectionCompositionSessionSnapshot,
  SelectionSettlementKind,
  SelectionSettlementMarker,
} from "../model/presentation.ts";
import type {
  BlockInternalSelectionSubsystem,
  CanonicalSelectionSettlementResult,
  EditorLogicalSelectionPoint,
  EditorSelection,
  EditorSelectionEndpointTarget,
  EditorSelectionInvalidation,
  EditorSelectionRangeBlock,
  EditorSelectionSnapshot,
  EditorSelectionSnapshotEndpoint,
  EditorSelectionTextAnchorResolver,
  SelectionSettlementContext,
} from "../model/types.ts";

export interface SelectionController {
  readonly endpoint: EditorSelectionSnapshotEndpoint;
  readonly canonical: EditorCanonicalSelectionReader;
  readonly localPaint: EditorLocalSelectionPaintReader;
  readonly presentation: EditorSelectionPresentationReader;
  getCommittedSnapshot(): CommittedSelectionSnapshot | null;
  getCanonicalSnapshot(): CanonicalLocalSelection;
  getPresentationSnapshot(): SelectionPresentationSnapshot;
  getServerPresentationSnapshot(): SelectionPresentationSnapshot;
  subscribe(listener: () => void): () => void;
  subscribeStandaloneSettlements(
    listener: (selection: EditorStableSelection) => void,
  ): () => void;
  isCommittedSnapshotCurrent(snapshot: CommittedSelectionSnapshot): boolean;
  getLastTransitionFailure(): string | null;
  reconcileCommittedGraphChange(
    graph: EditorSelectionGraphReader,
    graphRevision: number,
    context: SelectionSettlementContext,
    textAnchorResolver?: EditorSelectionTextAnchorResolver | null,
  ): EditorSelectionSnapshot | null;
  commitCanonicalSelection(
    selection: EditorSelection | null,
    graph: EditorSelectionGraphReader,
    graphRevision: number,
    context: SelectionSettlementContext,
    textAnchorResolver?: EditorSelectionTextAnchorResolver | null,
  ): CanonicalSelectionSettlementResult;
  setKeyboardNavigation(input: { readonly preferredX: number | null }): void;
  readKeyboardNavigation(): {
    readonly preferredX: number | null;
  } | null;
  extendSelection(
    anchor: EditorLogicalSelectionPoint,
    focus: EditorLogicalSelectionPoint,
    graph: EditorSelectionGraphReader,
    graphRevision: number,
    context: SelectionSettlementContext,
    preferredX?: number | null,
  ): CanonicalSelectionSettlementResult;
  resetKeyboardNavigation(): {
    readonly preferredX: number | null;
  } | null;
  beginCompositionSession(input: {
    readonly frozenSelection: CommittedSelectionSnapshot;
    readonly graphRevision: number;
    readonly baseTokens: readonly EditorContentBaseToken[];
    readonly hostBlockId: BlockId;
  }): SelectionCompositionSessionSnapshot | null;
  updateCompositionSession(input: {
    readonly revision: number;
    readonly latestText: string;
  }): SelectionCompositionSessionSnapshot | null;
  completeCompositionSession(
    expectedRevision?: number,
  ): SelectionCompositionSessionSnapshot | null;
  cancelCompositionSession(expectedRevision?: number): boolean;
  commitSelectionPoint(
    point: EditorLogicalSelectionPoint,
    graph: EditorSelectionGraphReader,
    graphRevision: number,
    context: SelectionSettlementContext,
  ): CanonicalSelectionSettlementResult;
  commitBlockSelection(
    target: EditorSelectionEndpointTarget,
    coverageResult: BlockSelectionCoverageResult,
    subsystem: BlockInternalSelectionSubsystem,
    context: SelectionSettlementContext,
    graphRevision?: number,
  ): CanonicalSelectionSettlementResult;
  rebaseBlockSelection(
    target: EditorSelectionEndpointTarget,
    coverageResult: BlockSelectionCoverageResult,
    subsystem: BlockInternalSelectionSubsystem,
    graphRevision: number,
    expectedRevision: number,
  ): EditorSelectionSnapshot | null;
  clearBlockSelection(
    blockId: BlockId,
    context: SelectionSettlementContext,
    expectedRevision?: number,
  ): CanonicalSelectionSettlementResult;
  clearForInvalidation(
    invalidation: EditorSelectionInvalidation,
  ): EditorSelectionSnapshot | null;
  clearForStaleGraph(
    currentGraphRevision: number,
  ): EditorSelectionSnapshot | null;
  clearSelection(
    context: SelectionSettlementContext,
  ): CanonicalSelectionSettlementResult;
  dispose(): void;
}

type CanonicalSelectionInput =
  | { readonly kind: "none" }
  | { readonly kind: "document"; readonly snapshot: EditorSelectionSnapshot }
  | {
      readonly kind: "block-internal";
      readonly blockId: BlockId;
      readonly subsystem: BlockInternalSelectionSubsystem;
      readonly internal: unknown;
      readonly documentProjection: EditorSelectionSnapshot;
    };

class SelectionControllerImplementation implements SelectionController {
  readonly endpoint: EditorSelectionSnapshotEndpoint;
  readonly canonical: EditorCanonicalSelectionReader;
  readonly localPaint: EditorLocalSelectionPaintReader;
  readonly presentation: EditorSelectionPresentationReader;

  private endpointSnapshot: EditorSelectionSnapshot =
    createIdleSelectionSnapshot(0);
  private canonicalSnapshot: CanonicalLocalSelection = Object.freeze({
    kind: "none",
    revision: 0,
  });
  private localPaintSnapshot: LocalSelectionPaintModel = noLocalSelectionPaint;
  private presentationSnapshot: SelectionPresentationSnapshot = Object.freeze({
    canonical: this.canonicalSnapshot,
    settlement: null,
    nativeSelectionPaintMode: "visible",
    composition: null,
  });
  private settlementSequence = 0;
  private canonicalKey = "none";
  private readonly endpointListeners = new Set<() => void>();
  private readonly blockListeners = new Map<BlockId, Set<() => void>>();
  private readonly canonicalListeners = new Set<() => void>();
  private readonly localPaintListeners = new Set<() => void>();
  private readonly presentationListeners = new Set<() => void>();
  private readonly standaloneSettlementListeners = new Set<
    (selection: EditorStableSelection) => void
  >();
  private lastPublishedStandaloneSettlementSequence = 0;
  private keyboardNavigation: {
    readonly preferredX: number | null;
  } | null = null;
  private compositionSession: SelectionCompositionSessionSnapshot | null = null;
  private compositionRevision = 0;
  private lastTransitionFailure: string | null = null;
  private disposed = false;

  constructor() {
    this.endpoint = Object.freeze({
      getSnapshot: () => this.endpointSnapshot,
      subscribe: (listener: () => void) => this.subscribeEndpoint(listener),
      subscribeBlock: (blockId: BlockId, listener: () => void) =>
        this.subscribeBlock(blockId, listener),
    });
    this.canonical = Object.freeze({
      getSnapshot: () => this.canonicalSnapshot,
      subscribe: (listener: () => void) => this.subscribeCanonical(listener),
    });
    this.localPaint = Object.freeze({
      getSnapshot: () => this.localPaintSnapshot,
      subscribe: (listener: () => void) => this.subscribeLocalPaint(listener),
    });
    this.presentation = Object.freeze({
      getSnapshot: () => this.presentationSnapshot,
      getServerSnapshot: () => this.presentationSnapshot,
      subscribe: (listener: () => void) => this.subscribePresentation(listener),
    });
  }

  readonly getCanonicalSnapshot = (): CanonicalLocalSelection =>
    this.canonicalSnapshot;

  readonly getPresentationSnapshot = (): SelectionPresentationSnapshot =>
    this.presentationSnapshot;

  readonly getServerPresentationSnapshot = (): SelectionPresentationSnapshot =>
    this.presentationSnapshot;

  readonly subscribe = (listener: () => void): (() => void) =>
    this.subscribePresentation(listener);

  readonly subscribeStandaloneSettlements = (
    listener: (selection: EditorStableSelection) => void,
  ): (() => void) => {
    if (this.disposed) return () => undefined;
    this.standaloneSettlementListeners.add(listener);
    return () => this.standaloneSettlementListeners.delete(listener);
  };

  getCommittedSnapshot(): CommittedSelectionSnapshot | null {
    const canonical = this.canonicalSnapshot;
    return canonical.kind === "none" ? null : canonical.snapshot;
  }

  isCommittedSnapshotCurrent(snapshot: CommittedSelectionSnapshot): boolean {
    const canonical = this.canonicalSnapshot;
    return (
      canonical.kind !== "none" &&
      canonical.snapshot === snapshot &&
      canonical.revision === snapshot.revision
    );
  }

  getLastTransitionFailure(): string | null {
    return this.lastTransitionFailure;
  }

  private settleRangeSelection(
    anchor: EditorLogicalSelectionPoint,
    focus: EditorLogicalSelectionPoint,
    graph: EditorSelectionGraphReader,
    graphRevision: number,
    context: SelectionSettlementContext,
  ): CanonicalSelectionSettlementResult {
    if (this.disposed) return this.rejectedSettlement();
    if (this.invalidateIfGraphAdvanced(graphRevision))
      return this.rejectedSettlement();
    const result = normalizeNewSelection({ anchor, focus }, graph);
    if (!result.ok) return this.rejectedSettlement();
    this.lastTransitionFailure = null;
    return this.publishSettlingRangeSnapshot(
      "committed",
      result.range,
      graphRevision,
      context,
    );
  }

  private rebaseCanonicalDocumentSelection(
    graph: EditorSelectionGraphReader,
    graphRevision: number,
    context: SelectionSettlementContext,
    textAnchorResolver: EditorSelectionTextAnchorResolver | null,
  ): EditorSelectionSnapshot | null {
    if (this.disposed) return null;
    const canonical = this.canonicalSnapshot;
    const snapshot =
      canonical.kind === "document"
        ? canonical.snapshot.documentSelection
        : this.endpointSnapshot;
    if (
      canonical.kind !== "document" ||
      snapshot.phase !== "committed" ||
      !snapshot.anchor ||
      !snapshot.focus ||
      this.invalidateIfGraphAdvanced(graphRevision)
    )
      return null;
    const anchor = textAnchorResolver
      ? resolveRestoredSelectionPoint(
          snapshot.anchor,
          graph,
          textAnchorResolver,
        )
      : snapshot.anchor;
    const focus = textAnchorResolver
      ? resolveRestoredSelectionPoint(snapshot.focus, graph, textAnchorResolver)
      : snapshot.focus;
    if (!anchor || !focus) {
      this.lastTransitionFailure = "graph-reconciliation:text-anchor";
      return null;
    }
    const result = normalizeNewSelection({ anchor, focus }, graph);
    if (!result.ok) {
      this.lastTransitionFailure = `${result.point}:${result.reason}`;
      return null;
    }
    this.lastTransitionFailure = null;
    return this.snapshotFromSettlement(
      this.publishSettlingRangeSnapshot(
        "committed",
        result.range,
        graphRevision,
        context,
      ),
    );
  }

  reconcileCommittedGraphChange(
    graph: EditorSelectionGraphReader,
    graphRevision: number,
    context: SelectionSettlementContext,
    textAnchorResolver: EditorSelectionTextAnchorResolver | null = null,
  ): EditorSelectionSnapshot | null {
    if (this.disposed) return null;
    if (!Number.isSafeInteger(graphRevision) || graphRevision < 0) return null;
    const canonical = this.canonicalSnapshot;
    if (canonical.kind === "none") {
      this.publishSettlement("clear", context);
      if (this.endpointSnapshot.graphRevision === graphRevision)
        return this.endpointSnapshot;
      const next = createIdleSelectionSnapshot(
        this.endpointSnapshot.selectionRevision,
        { graphRevision },
      );
      this.projectEndpointSnapshot(next);
      return next;
    }
    if (this.compositionSession?.graphRevision !== graphRevision) {
      this.compositionSession = null;
    }
    if (canonical.kind === "document") {
      const rebased = this.rebaseCanonicalDocumentSelection(
        graph,
        graphRevision,
        context,
        textAnchorResolver,
      );
      if (rebased) return rebased;
      this.compositionSession = null;
      const nextEndpoint = createIdleSelectionSnapshot(
        this.endpointSnapshot.selectionRevision + 1,
        { graphRevision, lastInvalidationReason: "graph-changed" },
      );
      return this.snapshotFromSettlement(
        this.settleCanonicalInput({ kind: "none" }, nextEndpoint, {
          kind: "clear",
          context,
        }),
      );
    }
    const selection = canonical.snapshot.documentSelection;
    if (!selection.anchor || !selection.focus) {
      const nextEndpoint = createIdleSelectionSnapshot(
        this.endpointSnapshot.selectionRevision + 1,
        { graphRevision, lastInvalidationReason: "block-deleted" },
      );
      return this.snapshotFromSettlement(
        this.settleCanonicalInput({ kind: "none" }, nextEndpoint, {
          kind: "clear",
          context,
        }),
      );
    }
    const result = normalizeNewSelection(
      { anchor: selection.anchor, focus: selection.focus },
      graph,
    );
    if (!result.ok) {
      this.lastTransitionFailure = `${result.point}:${result.reason}`;
      this.compositionSession = null;
      const nextEndpoint = createIdleSelectionSnapshot(
        this.endpointSnapshot.selectionRevision + 1,
        { graphRevision, lastInvalidationReason: "graph-changed" },
      );
      return this.snapshotFromSettlement(
        this.settleCanonicalInput({ kind: "none" }, nextEndpoint, {
          kind: "clear",
          context,
        }),
      );
    }
    return this.snapshotFromSettlement(
      this.publishSettlingRangeSnapshot(
        "committed",
        result.range,
        graphRevision,
        context,
        canonical.snapshot.internal
          ? {
              blockId: canonical.snapshot.internal.blockId,
              internal: canonical.snapshot.internal.snapshot,
            }
          : undefined,
        canonical.subsystem,
      ),
    );
  }

  commitCanonicalSelection(
    selection: EditorSelection | null,
    graph: EditorSelectionGraphReader,
    graphRevision: number,
    context: SelectionSettlementContext,
    textAnchorResolver: EditorSelectionTextAnchorResolver | null = null,
  ): CanonicalSelectionSettlementResult {
    this.keyboardNavigation = null;
    this.compositionSession = null;
    if (
      this.disposed ||
      !Number.isSafeInteger(graphRevision) ||
      graphRevision < 0
    )
      return this.rejectedSettlement();
    if (selection === null) {
      this.lastTransitionFailure = null;
      const nextEndpoint = createIdleSelectionSnapshot(
        this.endpointSnapshot.selectionRevision + 1,
        { graphRevision },
      );
      return this.settleCanonicalInput({ kind: "none" }, nextEndpoint, {
        kind: "clear",
        context,
      });
    }
    const candidate = resolveAndNormalizeSelection(
      selection,
      graph,
      textAnchorResolver,
    );
    if (!candidate) {
      this.lastTransitionFailure = "restore:invalid-selection";
      return this.rejectedSettlement();
    }
    this.lastTransitionFailure = null;
    return this.publishSettlingRangeSnapshot(
      "committed",
      candidate,
      graphRevision,
      context,
    );
  }

  setKeyboardNavigation(input: { readonly preferredX: number | null }): void {
    if (this.disposed) return;
    this.keyboardNavigation = Object.freeze({ ...input });
  }

  readKeyboardNavigation(): {
    readonly preferredX: number | null;
  } | null {
    return this.keyboardNavigation;
  }

  extendSelection(
    anchor: EditorLogicalSelectionPoint,
    focus: EditorLogicalSelectionPoint,
    graph: EditorSelectionGraphReader,
    graphRevision: number,
    context: SelectionSettlementContext,
    preferredX: number | null = null,
  ): CanonicalSelectionSettlementResult {
    if (this.keyboardNavigation) {
      this.keyboardNavigation = Object.freeze({
        preferredX,
      });
    }
    return this.settleRangeSelection(
      anchor,
      focus,
      graph,
      graphRevision,
      context,
    );
  }

  resetKeyboardNavigation(): {
    readonly preferredX: number | null;
  } | null {
    const completed = this.keyboardNavigation;
    this.keyboardNavigation = null;
    return completed;
  }

  beginCompositionSession(input: {
    readonly frozenSelection: CommittedSelectionSnapshot;
    readonly graphRevision: number;
    readonly baseTokens: readonly EditorContentBaseToken[];
    readonly hostBlockId: BlockId;
  }): SelectionCompositionSessionSnapshot | null {
    if (
      this.disposed ||
      this.compositionSession ||
      !this.isCommittedSnapshotCurrent(input.frozenSelection) ||
      input.graphRevision !==
        input.frozenSelection.documentSelection.graphRevision
    )
      return null;
    this.compositionRevision += 1;
    this.compositionSession = Object.freeze({
      revision: this.compositionRevision,
      frozenSelection: input.frozenSelection,
      selectionRevision: input.frozenSelection.revision,
      graphRevision: input.graphRevision,
      baseTokens: Object.freeze(
        input.baseTokens.map((token) => Object.freeze({ ...token })),
      ),
      hostBlockId: input.hostBlockId,
      hasUnpublishedDraft: false,
      latestText: null,
    });
    this.publishPresentation(this.presentationSnapshot.settlement);
    return this.compositionSession;
  }

  updateCompositionSession(input: {
    readonly revision: number;
    readonly latestText: string;
  }): SelectionCompositionSessionSnapshot | null {
    const current = this.compositionSession;
    if (!current || current.revision !== input.revision) return null;
    this.compositionSession = Object.freeze({
      ...current,
      hasUnpublishedDraft: true,
      latestText: input.latestText,
    });
    this.publishPresentation(this.presentationSnapshot.settlement);
    return this.compositionSession;
  }

  completeCompositionSession(
    expectedRevision?: number,
  ): SelectionCompositionSessionSnapshot | null {
    const current = this.compositionSession;
    if (
      !current ||
      (expectedRevision !== undefined && current.revision !== expectedRevision)
    )
      return null;
    this.compositionSession = null;
    this.publishPresentation(this.presentationSnapshot.settlement);
    return current;
  }

  cancelCompositionSession(expectedRevision?: number): boolean {
    if (
      !this.compositionSession ||
      (expectedRevision !== undefined &&
        this.compositionSession.revision !== expectedRevision)
    )
      return false;
    this.compositionSession = null;
    this.publishPresentation(this.presentationSnapshot.settlement);
    return true;
  }

  commitSelectionPoint(
    point: EditorLogicalSelectionPoint,
    graph: EditorSelectionGraphReader,
    graphRevision: number,
    context: SelectionSettlementContext,
  ): CanonicalSelectionSettlementResult {
    if (this.disposed) return this.rejectedSettlement();
    if (this.invalidateIfGraphAdvanced(graphRevision))
      return this.rejectedSettlement();
    const result = normalizeNewSelection(
      { anchor: point, focus: point },
      graph,
    );
    if (!result.ok) return this.rejectedSettlement();
    this.lastTransitionFailure = null;
    return this.publishSettlingRangeSnapshot(
      "committed",
      result.range,
      graphRevision,
      context,
    );
  }

  commitBlockSelection(
    target: EditorSelectionEndpointTarget,
    coverageResult: BlockSelectionCoverageResult,
    subsystem: BlockInternalSelectionSubsystem,
    context: SelectionSettlementContext,
    graphRevision = this.endpointSnapshot.graphRevision,
  ): CanonicalSelectionSettlementResult {
    if (this.disposed) return this.rejectedSettlement();
    if (this.invalidateIfGraphAdvanced(graphRevision))
      return this.rejectedSettlement();
    if (
      coverageResult.blockId !== target.block.id ||
      coverageResult.blockType !== target.block.type ||
      coverageResult.modelId !== target.selection.id
    )
      return this.rejectedSettlement();
    if (!target.selection.projection.selectable)
      return this.rejectedSettlement();
    if (target.selection.projection.endpoint.kind !== "block")
      return this.rejectedSettlement();
    if (coverageResult.coverage === "none") {
      const nextEndpoint = createIdleSelectionSnapshot(
        this.endpointSnapshot.selectionRevision + 1,
        { graphRevision },
      );
      return this.settleCanonicalInput({ kind: "none" }, nextEndpoint, {
        kind: "clear",
        context,
      });
    }
    if (coverageResult.stableSelectionPayload === undefined)
      return this.rejectedSettlement();
    let stableSelectionPayload: typeof coverageResult.stableSelectionPayload;
    try {
      stableSelectionPayload = cloneJsonValue(
        coverageResult.stableSelectionPayload,
      );
    } catch {
      return this.rejectedSettlement();
    }
    const acceptedCoverageResult = Object.freeze({
      ...coverageResult,
      stableSelectionPayload,
    });
    const range = createBlockInternalSelectionRange(
      target,
      acceptedCoverageResult,
      subsystem,
    );
    return this.publishSettlingRangeSnapshot(
      "committed",
      range,
      graphRevision,
      context,
      {
        blockId: target.block.id,
        internal: acceptedCoverageResult.internal ?? acceptedCoverageResult,
      },
      subsystem,
    );
  }

  rebaseBlockSelection(
    target: EditorSelectionEndpointTarget,
    coverageResult: BlockSelectionCoverageResult,
    subsystem: BlockInternalSelectionSubsystem,
    graphRevision: number,
    expectedRevision: number,
  ): EditorSelectionSnapshot | null {
    if (this.disposed) return null;
    const canonical = this.canonicalSnapshot;
    if (
      canonical.kind !== "block-internal" ||
      canonical.snapshot.internal?.blockId !== target.block.id ||
      subsystemKey(canonical.subsystem) !== subsystemKey(subsystem) ||
      canonical.revision !== expectedRevision ||
      this.invalidateIfGraphAdvanced(graphRevision) ||
      coverageResult.coverage === "none" ||
      coverageResult.blockId !== target.block.id ||
      coverageResult.blockType !== target.block.type ||
      coverageResult.modelId !== target.selection.id ||
      coverageResult.stableSelectionPayload === undefined ||
      !target.selection.projection.selectable ||
      target.selection.projection.endpoint.kind !== "block"
    )
      return null;
    let stableSelectionPayload: typeof coverageResult.stableSelectionPayload;
    try {
      stableSelectionPayload = cloneJsonValue(
        coverageResult.stableSelectionPayload,
      );
    } catch {
      return null;
    }
    const acceptedCoverageResult = Object.freeze({
      ...coverageResult,
      stableSelectionPayload,
    });
    const range = createBlockInternalSelectionRange(
      target,
      acceptedCoverageResult,
      subsystem,
    );
    return this.publishNonSettlingRangeSnapshot(
      "committed",
      range,
      graphRevision,
      {
        blockId: target.block.id,
        internal: acceptedCoverageResult.internal ?? acceptedCoverageResult,
      },
      subsystem,
    );
  }

  clearBlockSelection(
    blockId: BlockId,
    context: SelectionSettlementContext,
    expectedRevision?: number,
  ): CanonicalSelectionSettlementResult {
    if (this.disposed) return this.rejectedSettlement();
    const canonical = this.canonicalSnapshot;
    if (
      canonical.kind !== "block-internal" ||
      canonical.snapshot.internal?.blockId !== blockId ||
      (expectedRevision !== undefined &&
        canonical.revision !== expectedRevision)
    )
      return this.rejectedSettlement();
    const nextEndpoint = createIdleSelectionSnapshot(
      this.endpointSnapshot.selectionRevision,
      {
        graphRevision: this.endpointSnapshot.graphRevision,
      },
    );
    return this.settleCanonicalInput({ kind: "none" }, nextEndpoint, {
      kind: "clear",
      context,
    });
  }

  clearForInvalidation(
    invalidation: EditorSelectionInvalidation,
  ): EditorSelectionSnapshot | null {
    if (this.disposed) return null;
    const validation = validateEditorSelectionInvalidation(
      this.endpointSnapshot,
      invalidation,
    );
    if (!validation.ok) return null;

    const nextEndpoint = createIdleSelectionSnapshot(
      this.endpointSnapshot.selectionRevision + 1,
      {
        graphRevision: validation.invalidation.graphRevision,
        lastInvalidationReason: validation.invalidation.reason,
      },
    );
    const context = silentSelectionSettlement("canonical-rebase");
    return this.snapshotFromSettlement(
      this.settleCanonicalInput({ kind: "none" }, nextEndpoint, {
        kind: "clear",
        context,
      }),
    );
  }

  clearForStaleGraph(
    currentGraphRevision: number,
  ): EditorSelectionSnapshot | null {
    return this.clearForInvalidation({
      reason: "stale-graph",
      graphRevision: currentGraphRevision,
    });
  }

  clearSelection(
    context: SelectionSettlementContext,
  ): CanonicalSelectionSettlementResult {
    if (this.disposed) return this.rejectedSettlement();
    this.keyboardNavigation = null;
    this.compositionSession = null;
    const nextEndpoint = createIdleSelectionSnapshot(
      this.endpointSnapshot.selectionRevision,
      {
        graphRevision: this.endpointSnapshot.graphRevision,
      },
    );
    return this.settleCanonicalInput({ kind: "none" }, nextEndpoint, {
      kind: "clear",
      context,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.keyboardNavigation = null;
    this.compositionSession = null;
    this.lastTransitionFailure = null;
    this.endpointSnapshot = createIdleSelectionSnapshot(
      this.endpointSnapshot.selectionRevision + 1,
      { graphRevision: this.endpointSnapshot.graphRevision },
    );
    this.canonicalSnapshot = Object.freeze({
      kind: "none",
      revision: this.canonicalSnapshot.revision + 1,
    });
    this.localPaintSnapshot = noLocalSelectionPaint;
    this.canonicalKey = "none";
    this.presentationSnapshot = Object.freeze({
      canonical: this.canonicalSnapshot,
      settlement: null,
      nativeSelectionPaintMode: "visible",
      composition: null,
    });
    this.endpointListeners.clear();
    this.blockListeners.clear();
    this.canonicalListeners.clear();
    this.localPaintListeners.clear();
    this.presentationListeners.clear();
    this.standaloneSettlementListeners.clear();
  }

  private subscribeEndpoint(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.endpointListeners.add(listener);
    return () => {
      this.endpointListeners.delete(listener);
    };
  }

  private subscribeBlock(blockId: BlockId, listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    let listeners = this.blockListeners.get(blockId);
    if (!listeners) {
      listeners = new Set();
      this.blockListeners.set(blockId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.blockListeners.delete(blockId);
    };
  }

  private subscribeCanonical(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.canonicalListeners.add(listener);
    return () => {
      this.canonicalListeners.delete(listener);
    };
  }

  private subscribeLocalPaint(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.localPaintListeners.add(listener);
    return () => this.localPaintListeners.delete(listener);
  }

  private subscribePresentation(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.presentationListeners.add(listener);
    return () => {
      this.presentationListeners.delete(listener);
    };
  }

  private publishSettlingRangeSnapshot(
    phase: Exclude<EditorSelectionSnapshot["phase"], "idle">,
    range: EditorNormalizedSelectionRange,
    graphRevision: number,
    context: SelectionSettlementContext,
    internal?: { readonly blockId: BlockId; readonly internal: unknown },
    subsystem?: BlockInternalSelectionSubsystem,
  ): CanonicalSelectionSettlementResult {
    return this.publishRangeSnapshot(
      phase,
      range,
      graphRevision,
      { kind: "selection", context },
      internal,
      subsystem,
    );
  }

  private publishNonSettlingRangeSnapshot(
    phase: Exclude<EditorSelectionSnapshot["phase"], "idle">,
    range: EditorNormalizedSelectionRange,
    graphRevision: number,
    internal?: { readonly blockId: BlockId; readonly internal: unknown },
    subsystem?: BlockInternalSelectionSubsystem,
  ): EditorSelectionSnapshot | null {
    const result = this.publishRangeSnapshot(
      phase,
      range,
      graphRevision,
      null,
      internal,
      subsystem,
    );
    return result.kind === "changed"
      ? result.selection
      : result.kind === "unchanged" && result.retainedSelection.kind !== "none"
        ? result.retainedSelection.snapshot.documentSelection
        : null;
  }

  private publishRangeSnapshot(
    phase: Exclude<EditorSelectionSnapshot["phase"], "idle">,
    range: EditorNormalizedSelectionRange,
    graphRevision: number,
    settlement: {
      readonly kind: "selection";
      readonly context: SelectionSettlementContext;
    } | null,
    internal?: { readonly blockId: BlockId; readonly internal: unknown },
    subsystem?: BlockInternalSelectionSubsystem,
  ): CanonicalSelectionSettlementResult {
    const nextSnapshot: EditorSelectionSnapshot = {
      phase,
      selectionRevision:
        Math.max(
          this.endpointSnapshot.selectionRevision,
          this.canonicalSnapshot.revision,
        ) + 1,
      graphRevision,
      lastInvalidationReason: null,
      direction: range.direction,
      anchor: range.anchor,
      focus: range.focus,
      normalizedStart: range.normalizedStart,
      normalizedEnd: range.normalizedEnd,
      rangeBlocks: range.rangeBlocks,
    };
    return this.settleCanonicalInput(
      internal && subsystem
        ? {
            kind: "block-internal",
            blockId: internal.blockId,
            subsystem,
            internal: internal.internal,
            documentProjection: nextSnapshot,
          }
        : { kind: "document", snapshot: nextSnapshot },
      nextSnapshot,
      settlement,
    );
  }

  private settleCanonicalInput(
    input: CanonicalSelectionInput,
    nextEndpoint: EditorSelectionSnapshot,
    settlement: {
      readonly kind: SelectionSettlementKind;
      readonly context: SelectionSettlementContext;
    } | null,
  ): CanonicalSelectionSettlementResult {
    if (
      settlement?.context.publication.kind === "standalone-local" &&
      canonicalSelectionInputLogicallyEquals(input, this.canonicalSnapshot)
    ) {
      this.lastTransitionFailure = null;
      return {
        kind: "unchanged",
        retainedSelection: this.canonicalSnapshot,
      };
    }
    const nextKey = canonicalSelectionInputKey(input);
    if (nextKey === this.canonicalKey) {
      this.lastTransitionFailure = null;
      if (settlement)
        this.publishSettlement(settlement.kind, settlement.context);
      this.projectEndpointSnapshot(nextEndpoint);
      return {
        kind: "changed",
        selection:
          this.canonicalSnapshot.kind === "none"
            ? null
            : this.canonicalSnapshot.snapshot.documentSelection,
      };
    }

    const revision = this.canonicalSnapshot.revision + 1;
    if (input.kind === "none") {
      this.canonicalSnapshot = Object.freeze({ kind: "none", revision });
      this.canonicalKey = nextKey;
      this.lastTransitionFailure = null;
      const settlementMarker = settlement
        ? this.createSettlementMarker(settlement.kind, settlement.context)
        : this.presentationSnapshot.settlement;
      this.publishPresentation(settlementMarker);
      this.notifyCanonical();
      this.projectEndpointSnapshot(nextEndpoint);
      this.publishLocalPaintModel();
      return { kind: "changed", selection: null };
    }
    const committed =
      input.kind === "document"
        ? createCommittedSelectionSnapshot({
            kind: "document",
            revision,
            documentSelection: input.snapshot,
          })
        : createCommittedSelectionSnapshot({
            kind: "block-internal",
            revision,
            blockId: input.blockId,
            subsystem: input.subsystem,
            internal: input.internal,
            documentProjection: input.documentProjection,
          });
    if (!committed.ok) {
      this.lastTransitionFailure = committed.reason;
      return this.rejectedSettlement();
    }

    this.canonicalSnapshot = Object.freeze(
      input.kind === "document"
        ? {
            kind: "document" as const,
            revision,
            snapshot: committed.snapshot,
          }
        : {
            kind: "block-internal" as const,
            revision,
            subsystem: input.subsystem,
            snapshot: committed.snapshot,
          },
    );
    this.canonicalKey = nextKey;
    this.lastTransitionFailure = null;
    const settlementMarker = settlement
      ? this.createSettlementMarker(settlement.kind, settlement.context)
      : this.presentationSnapshot.settlement;
    this.publishPresentation(settlementMarker);
    this.notifyCanonical();

    const projectedEndpoint = isCollapsedTextSelection(committed.snapshot)
      ? this.endpointSnapshot.phase === "idle"
        ? this.endpointSnapshot
        : createIdleSelectionSnapshot(
            this.endpointSnapshot.selectionRevision + 1,
            {
              graphRevision: committed.snapshot.documentSelection.graphRevision,
            },
          )
      : committed.snapshot.documentSelection;
    this.projectEndpointSnapshot(projectedEndpoint);
    this.publishLocalPaintModel();
    return { kind: "changed", selection: committed.snapshot.documentSelection };
  }

  private rejectedSettlement(): CanonicalSelectionSettlementResult {
    return {
      kind: "rejected",
      retainedSelection: this.canonicalSnapshot,
    };
  }

  private snapshotFromSettlement(
    result: CanonicalSelectionSettlementResult,
  ): EditorSelectionSnapshot | null {
    if (result.kind === "rejected") return null;
    if (result.kind === "changed")
      return result.selection ?? this.endpointSnapshot;
    return result.retainedSelection.kind === "none"
      ? this.endpointSnapshot
      : result.retainedSelection.snapshot.documentSelection;
  }

  private notifyCanonical(): void {
    for (const listener of [...this.canonicalListeners]) {
      notifySelectionSubscriber(listener);
    }
  }

  private publishLocalPaintModel(): void {
    const canonical = this.canonicalSnapshot;
    const next =
      canonical.kind === "none" ||
      (canonical.kind === "document" &&
        isCollapsedTextSelection(canonical.snapshot))
        ? noLocalSelectionPaint
        : Object.freeze({
            kind: "range" as const,
            sourceRevision: canonical.revision,
            snapshot: canonical.snapshot,
          });
    this.projectLocalPaintSnapshot(next);
  }

  private projectLocalPaintSnapshot(next: LocalSelectionPaintModel): void {
    if (next === this.localPaintSnapshot) return;
    this.localPaintSnapshot = next;
    for (const listener of [...this.localPaintListeners]) {
      notifySelectionSubscriber(listener);
    }
  }

  private restoreCanonicalProjection(): void {
    const canonical = this.canonicalSnapshot;
    const currentGraphRevision = this.endpointSnapshot.graphRevision;
    const endpoint =
      canonical.kind === "none" ||
      (canonical.kind === "document" &&
        isCollapsedTextSelection(canonical.snapshot))
        ? createIdleSelectionSnapshot(
            this.endpointSnapshot.selectionRevision + 1,
            {
              graphRevision: currentGraphRevision,
            },
          )
        : canonical.snapshot.documentSelection;
    this.projectEndpointSnapshot(endpoint);
    this.publishLocalPaintModel();
  }

  private createSettlementMarker(
    kind: SelectionSettlementKind,
    context: SelectionSettlementContext,
  ): SelectionSettlementMarker {
    this.settlementSequence += 1;
    return Object.freeze({
      sequence: this.settlementSequence,
      kind,
      canonicalRevision: this.canonicalSnapshot.revision,
      publication: context.publication,
      cause: context.cause,
    });
  }

  private publishSettlement(
    kind: SelectionSettlementKind,
    context: SelectionSettlementContext,
  ): void {
    this.publishPresentation(this.createSettlementMarker(kind, context));
  }

  private publishPresentation(
    settlement: SelectionSettlementMarker | null,
  ): void {
    const nativeSelectionPaintMode =
      this.compositionSession !== null
        ? "composition-owned"
        : this.canonicalSnapshot.kind === "none" ||
            (this.canonicalSnapshot.kind === "document" &&
              isCollapsedTextSelection(this.canonicalSnapshot.snapshot))
          ? "visible"
          : "hidden-for-global-selection";
    if (
      this.presentationSnapshot.canonical === this.canonicalSnapshot &&
      this.presentationSnapshot.settlement === settlement &&
      this.presentationSnapshot.nativeSelectionPaintMode ===
        nativeSelectionPaintMode &&
      this.presentationSnapshot.composition === this.compositionSession
    )
      return;
    this.presentationSnapshot = Object.freeze({
      canonical: this.canonicalSnapshot,
      settlement,
      nativeSelectionPaintMode,
      composition: this.compositionSession,
    });
    for (const listener of [...this.presentationListeners]) {
      notifySelectionSubscriber(listener);
    }
    if (
      settlement?.publication.kind === "standalone-local" &&
      settlement.sequence > this.lastPublishedStandaloneSettlementSequence
    ) {
      this.lastPublishedStandaloneSettlementSequence = settlement.sequence;
      const stable = projectCanonicalSelectionToStable(this.canonicalSnapshot);
      for (const listener of [...this.standaloneSettlementListeners]) {
        try {
          listener(stable);
        } catch {
          // Publication observers cannot invalidate canonical settlement.
        }
      }
    }
  }

  private projectEndpointSnapshot(next: EditorSelectionSnapshot): void {
    if (
      this.endpointSnapshot === next ||
      selectionSnapshotSemanticKey(this.endpointSnapshot) ===
        selectionSnapshotSemanticKey(next)
    )
      return;
    const previous = this.endpointSnapshot;
    this.endpointSnapshot = next;
    const changedBlockIds = changedSelectionBlockIds(previous, next);
    for (const listener of [...this.endpointListeners]) {
      notifySelectionSubscriber(listener);
    }
    for (const blockId of changedBlockIds) {
      const listeners = this.blockListeners.get(blockId);
      if (!listeners) continue;
      for (const listener of [...listeners]) {
        notifySelectionSubscriber(listener);
      }
    }
  }

  private invalidateIfGraphAdvanced(currentGraphRevision: number): boolean {
    const snapshot = this.endpointSnapshot;
    if (snapshot.phase === "idle") return false;
    return currentGraphRevision < snapshot.graphRevision;
  }
}

function notifySelectionSubscriber(listener: () => void): void {
  try {
    listener();
  } catch {
    // Selection subscribers cannot invalidate canonical settlement.
  }
}

export function createSelectionController(): SelectionController {
  return new SelectionControllerImplementation();
}

function silentSelectionSettlement(
  cause: SelectionSettlementContext["cause"],
): SelectionSettlementContext {
  return { publication: { kind: "silent" }, cause };
}

function resolveRestoredSelectionPoint(
  point: EditorLogicalSelectionPoint,
  graph: EditorSelectionGraphReader,
  textAnchorResolver: EditorSelectionTextAnchorResolver | null,
): EditorLogicalSelectionPoint | null {
  if (!point.textAnchor) return point;
  if (!textAnchorResolver) return null;
  const resolved = resolveEditorSelectionTextAnchorPoint(
    point,
    graph,
    textAnchorResolver,
  );
  if (!resolved.ok) return null;
  return {
    ...point,
    blockId: resolved.blockId,
    textAnchor: resolved.textAnchor,
    textOffset: resolved.textOffset,
    affinity: resolved.affinity,
  };
}

function resolveAndNormalizeSelection(
  selection: EditorSelection,
  graph: EditorSelectionGraphReader,
  textAnchorResolver: EditorSelectionTextAnchorResolver | null,
): EditorNormalizedSelectionRange | null {
  const anchor = resolveRestoredSelectionPoint(
    selection.anchor,
    graph,
    textAnchorResolver,
  );
  const focus = resolveRestoredSelectionPoint(
    selection.focus,
    graph,
    textAnchorResolver,
  );
  if (!anchor || !focus) return null;
  const result = normalizeNewSelection({ anchor, focus }, graph);
  return result.ok ? result.range : null;
}

function canonicalDocumentSelectionLogicallyEquals(
  canonical: CanonicalLocalSelection,
  range: EditorNormalizedSelectionRange,
  graphRevision: number,
): boolean {
  if (canonical.kind !== "document") return false;
  const current = canonical.snapshot.documentSelection;
  return (
    current.phase === "committed" &&
    current.graphRevision === graphRevision &&
    current.direction === range.direction &&
    logicalSelectionPointEquals(current.anchor, range.anchor) &&
    logicalSelectionPointEquals(current.focus, range.focus)
  );
}

function canonicalSelectionInputLogicallyEquals(
  input: CanonicalSelectionInput,
  canonical: CanonicalLocalSelection,
): boolean {
  if (input.kind === "none") return canonical.kind === "none";
  if (input.kind === "document") {
    if (input.snapshot.phase !== "committed") return false;
    return canonicalDocumentSelectionLogicallyEquals(
      canonical,
      {
        direction: input.snapshot.direction!,
        anchor: input.snapshot.anchor!,
        focus: input.snapshot.focus!,
        normalizedStart: input.snapshot.normalizedStart!,
        normalizedEnd: input.snapshot.normalizedEnd!,
        rangeBlocks: input.snapshot.rangeBlocks,
      },
      input.snapshot.graphRevision,
    );
  }
  if (
    canonical.kind !== "block-internal" ||
    canonical.snapshot.internal?.blockId !== input.blockId ||
    subsystemKey(canonical.subsystem) !== subsystemKey(input.subsystem) ||
    stableDescriptorKey(canonical.snapshot.internal.snapshot) !==
      stableDescriptorKey(input.internal)
  ) {
    return false;
  }
  const current = canonical.snapshot.documentSelection;
  return (
    current.phase === "committed" &&
    input.documentProjection.phase === "committed" &&
    current.graphRevision === input.documentProjection.graphRevision &&
    current.direction === input.documentProjection.direction &&
    logicalSelectionPointEquals(
      current.anchor,
      input.documentProjection.anchor,
    ) &&
    logicalSelectionPointEquals(current.focus, input.documentProjection.focus)
  );
}

function logicalSelectionPointEquals(
  left: EditorLogicalSelectionPoint | null,
  right: EditorLogicalSelectionPoint | null,
): boolean {
  return (
    left === right ||
    Boolean(
      left &&
        right &&
        left.blockId === right.blockId &&
        left.blockType === right.blockType &&
        left.blockCategory === right.blockCategory &&
        left.textOffset === right.textOffset,
    )
  );
}

function isCollapsedTextSelection(
  snapshot: CommittedSelectionSnapshot,
): boolean {
  if (
    snapshot.kind !== "document" ||
    snapshot.blocks.length === 0 ||
    snapshot.documentSelection.phase !== "committed"
  )
    return false;
  const anchor = snapshot.endpoints.anchor;
  const head = snapshot.endpoints.head;
  return Boolean(
    anchor &&
      head &&
      isEditorSelectionTextAnchor(anchor.textAnchor) &&
      isEditorSelectionTextAnchor(head.textAnchor) &&
      anchor.blockId === head.blockId &&
      anchor.textOffset === head.textOffset,
  );
}

function canonicalSelectionInputKey(input: CanonicalSelectionInput): string {
  return input.kind === "none"
    ? "none"
    : input.kind === "document"
      ? `document:${selectionSnapshotSemanticKey(input.snapshot)}`
      : [
          "block-internal",
          input.blockId,
          subsystemKey(input.subsystem),
          stableDescriptorKey(input.internal),
          selectionSnapshotSemanticKey(input.documentProjection),
        ].join(":");
}

function selectionSnapshotSemanticKey(
  snapshot: EditorSelectionSnapshot,
): string {
  return [
    snapshot.phase,
    snapshot.graphRevision,
    snapshot.lastInvalidationReason ?? "",
    snapshot.direction ?? "",
    logicalPointKey(snapshot.anchor),
    logicalPointKey(snapshot.focus),
    logicalPointKey(snapshot.normalizedStart),
    logicalPointKey(snapshot.normalizedEnd),
    snapshot.rangeBlocks.map(selectionRangeBlockSemanticKey).join(","),
  ].join("|");
}

function logicalPointKey(point: EditorLogicalSelectionPoint | null): string {
  if (!point) return "none";
  return [
    point.blockId,
    point.blockType,
    point.blockCategory,
    point.textOffset,
    textAnchorKey(point),
    point.affinity ?? "",
  ].join("/");
}

function selectionRangeBlockSemanticKey(
  rangeBlock: EditorSelectionRangeBlock,
): string {
  return [
    rangeBlock.blockId,
    rangeBlock.blockType,
    rangeBlock.category,
    rangeBlock.coverage,
    stableDescriptorKey(rangeBlock.coverageResult),
    rangeBlock.selectable,
    rangeBlock.startOffset ?? "",
    rangeBlock.endOffset ?? "",
    stableDescriptorKey(rangeBlock.startTextAnchor ?? null),
    stableDescriptorKey(rangeBlock.endTextAnchor ?? null),
    stableDescriptorKey(rangeBlock.owner ?? null),
  ].join("/");
}

function subsystemKey(subsystem: BlockInternalSelectionSubsystem): string {
  return subsystem.id;
}

const emptyBlockIdSet = Object.freeze(
  new Set<BlockId>(),
) as ReadonlySet<BlockId>;

function changedSelectionBlockIds(
  previous: EditorSelectionSnapshot,
  next: EditorSelectionSnapshot,
): ReadonlySet<BlockId> {
  const previousBlocks = selectionSubscriptionBlockKeys(previous);
  const nextBlocks = selectionSubscriptionBlockKeys(next);
  if (previousBlocks.size === 0 && nextBlocks.size === 0)
    return emptyBlockIdSet;

  const changed = new Set<BlockId>();
  for (const [blockId, previousKey] of previousBlocks) {
    if (nextBlocks.get(blockId) !== previousKey) changed.add(blockId);
  }
  for (const [blockId, nextKey] of nextBlocks) {
    if (previousBlocks.get(blockId) !== nextKey) changed.add(blockId);
  }
  return changed.size === 0 ? emptyBlockIdSet : changed;
}

function selectionSubscriptionBlockKeys(
  snapshot: EditorSelectionSnapshot,
): ReadonlyMap<BlockId, string> {
  if (snapshot.phase !== "dragging" && snapshot.phase !== "committed")
    return emptyPaintBlockKeyMap;
  if (!snapshotHasValidTextBoundaryAnchors(snapshot))
    return emptyPaintBlockKeyMap;

  const keys = new Map<BlockId, string>();
  for (const rangeBlock of snapshot.rangeBlocks) {
    const key = selectionSubscriptionBlockKey(rangeBlock);
    if (key) keys.set(rangeBlock.blockId, key);
  }
  return keys;
}

const emptyPaintBlockKeyMap = Object.freeze(
  new Map<BlockId, string>(),
) as ReadonlyMap<BlockId, string>;

function selectionSubscriptionBlockKey(
  rangeBlock: EditorSelectionRangeBlock,
): string | null {
  if (rangeBlock.coverage === "none") return null;
  const descriptorKey =
    selectionPaintDescriptorKey(rangeBlock.coverageResult.paint) ?? "no-paint";
  const internalOwner =
    rangeBlock.owner?.kind === "block-internal" ? rangeBlock.owner : null;
  return [
    rangeBlock.coverageResult.modelId,
    rangeBlock.blockType,
    rangeBlock.coverage,
    descriptorKey,
    internalOwner
      ? `${subsystemKey(internalOwner.subsystem)}:${stableDescriptorKey(rangeBlock.coverageResult.internal)}`
      : "document",
    rangeBlock.startOffset ?? "",
    rangeBlock.endOffset ?? "",
  ].join(":");
}

function textAnchorKey(point: EditorLogicalSelectionPoint): string {
  if (!point.textAnchor) return "none";
  return [
    point.textAnchor.codec,
    point.textAnchor.version,
    point.textAnchor.payload.encoded,
    point.textAnchor.payload.assoc ?? 0,
  ].join("/");
}

function createDirectBlockSelectionPoint(
  target: EditorSelectionEndpointTarget,
): EditorLogicalSelectionPoint {
  return {
    blockId: target.block.id,
    blockType: target.block.type,
    blockCategory: target.selection.projection.category,
    textOffset: 0,
    textAnchor: null,
    affinity: null,
  };
}

function createBlockInternalSelectionRange(
  target: EditorSelectionEndpointTarget,
  coverageResult: BlockSelectionCoverageResult,
  subsystem: BlockInternalSelectionSubsystem,
): EditorNormalizedSelectionRange {
  const point = createDirectBlockSelectionPoint(target);
  return {
    direction: "forward",
    anchor: point,
    focus: point,
    normalizedStart: point,
    normalizedEnd: point,
    rangeBlocks: Object.freeze([
      {
        ...createDirectSelectionRangeBlock(target, coverageResult),
        owner: Object.freeze({
          kind: "block-internal" as const,
          blockId: target.block.id,
          subsystem,
        }),
      },
    ]) as readonly EditorSelectionRangeBlock[],
  };
}

function createDirectSelectionRangeBlock(
  target: EditorSelectionEndpointTarget,
  coverageResult: BlockSelectionCoverageResult,
): EditorSelectionRangeBlock {
  return {
    blockId: target.block.id,
    blockType: target.block.type,
    category: target.selection.projection.category,
    coverage: coverageResult.coverage,
    coverageResult,
    selectable: target.selection.projection.selectable,
  };
}

function selectionPaintDescriptorKey(value: unknown): string | null {
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  return `${value.kind}:${stableDescriptorKey(value)}`;
}

function stableDescriptorKey(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
