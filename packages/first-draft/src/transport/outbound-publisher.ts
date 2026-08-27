import {
  EditorImmutableBinary,
  type EditorContentOperationUpdate,
} from "@repo/editor-core/content/rich-text";
import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorLogicalContentOperation } from "@repo/editor-core/operations";
import {
  projectCanonicalSelectionToTransaction,
  projectTransactionSelectionToStable,
  type CanonicalLocalSelection,
  type EditorStableSelection,
  type EditorTransactionSelection,
} from "@repo/editor-react/selection";
import type {
  EditorSemanticChange,
  RemoteTransactionResult,
} from "@repo/editor-web/editor";
import {
  EDITOR_YJS_CONTENT_FORMAT,
  EDITOR_YJS_CONTENT_FORMAT_VERSION,
  mergeUpdates,
} from "@repo/editor-yjs";
import { convertEditorTransactionToTransport } from "./editor-transaction-to-transport.ts";
import {
  encodeFirstDraftMessage,
  MAX_FIRST_DRAFT_CLIENT_FRAME_BYTES,
  MAX_FIRST_DRAFT_FRAME_BYTES,
  type EditorTransactionAcceptedMessage,
  type EditorTransactionPersistenceFailedMessage,
  type FirstDraftAcceptedTransactionReplayMessage,
} from "./message-protocol.ts";
import { firstDraftTransactionProposalsEqual } from "./transaction-proposal-identity.ts";
import type {
  EditorTransportContentUpdate,
  EditorTransportTransaction,
} from "./transport-types.ts";

const QUIET_TIMEOUT_MS = 75;
const HARD_LATENCY_MS = 225;
const DEFAULT_MAX_ENTRIES = 64;
const DEFAULT_MAX_MERGED_UPDATE_BYTES = 512 * 1_024;
const DEFAULT_MAX_ACTIVE_RECORDS = 128;
const DEFAULT_MAX_RETAINED_ENCODED_BYTES = 16 * 1_024 * 1_024;
const MAX_CONFIGURED_MERGED_UPDATE_BYTES = 4 * 1_024 * 1_024;
const MAX_DIAGNOSTIC_IDS = 2_048;

export interface FirstDraftOutboundSocket {
  readonly readyState: number;
  send(data: ArrayBuffer): void;
}

export type FirstDraftOutboundFlushReason =
  | "manual"
  | "quiet-timeout"
  | "hard-latency"
  | "incompatible"
  | "aggregation-error"
  | "entry-limit"
  | "byte-limit"
  | "remote-boundary"
  | "standalone-selection"
  | "atomic-operation"
  | "visibility-hidden"
  | "pagehide"
  | "detach"
  | "dispose";

export type FirstDraftReplayClassification =
  | "local-outstanding"
  | "local-duplicate"
  | "remote-duplicate"
  | "remote-new";

export type FirstDraftLocalAcceptanceClassification =
  | "new-local-acceptance"
  | "duplicate-local-acceptance";

export type FirstDraftOutboundRecordState =
  | "draft"
  | "sealed"
  | "sent"
  | "retryable-failure"
  | "terminal-failure";

export interface FirstDraftOutboundRecordSnapshot {
  readonly transactionId: string;
  readonly state: FirstDraftOutboundRecordState;
  readonly sourceTransactionIds: readonly string[];
  readonly lastSentGeneration: string | null;
  readonly attemptCount: number;
  readonly encodedBytes: number;
  readonly failure: string | null;
  readonly hasSemanticTransaction: boolean;
}

export interface FirstDraftOutboundPublisherSnapshot {
  readonly disposed: boolean;
  readonly attachedGeneration: string | null;
  readonly generationCaughtUp: boolean;
  readonly pendingEntries: number;
  readonly pendingBytes: number;
  readonly pendingSourceTransactionIds: readonly string[];
  readonly activeRecordCount: number;
  readonly retainedEncodedBytes: number;
  readonly outstanding: readonly FirstDraftOutboundRecordSnapshot[];
  readonly acceptedLocalTransactionIds: readonly string[];
  readonly appliedRemoteTransactionIds: readonly string[];
  readonly duplicateReplayTransactionIds: readonly string[];
  readonly pendingFailure: string | null;
}

export interface FirstDraftOutboundGeneration {
  readonly generationId: string;
  readonly socket: FirstDraftOutboundSocket;
  readonly createTransactionId: () => string;
  readonly publishSelection: (
    selection: EditorStableSelection,
    outboundTransactionId: string,
  ) => void;
  readonly onRetainedPublished?: (
    finalCommittedSelection: EditorStableSelection | null,
  ) => void;
  readonly onPublished?: (transactionId: string) => void;
  readonly onError?: (error: Error) => void;
}

export interface FirstDraftRemoteRefreshEditor {
  getBlock(blockId: BlockId): {
    readonly id: BlockId;
    readonly type: BlockType;
    readonly tombstone: unknown | null;
  } | null;
  readBlockContent(blockId: BlockId, blockType: BlockType): unknown;
  readonly selection: { getSnapshot(): CanonicalLocalSelection };
}

export interface FirstDraftOutboundPublisher {
  attachGeneration(generation: FirstDraftOutboundGeneration): void;
  generationCaughtUp(): void;
  markGenerationUnusable(): void;
  detachGeneration(options: { readonly attemptSend: boolean }): void;
  submitFinalized(change: EditorSemanticChange): void;
  flush(reason: FirstDraftOutboundFlushReason): void;
  beginAtomicOperation(): () => void;
  beforeStandaloneSelectionPublication(): void;
  acceptLocal(
    message: EditorTransactionAcceptedMessage,
    currentRevision: number,
  ): FirstDraftLocalAcceptanceClassification;
  classifyReplay(
    message: FirstDraftAcceptedTransactionReplayMessage,
    currentRevision: number,
  ): FirstDraftReplayClassification;
  persistenceFailed(message: EditorTransactionPersistenceFailedMessage): void;
  remoteApplied(
    message: FirstDraftAcceptedTransactionReplayMessage,
    result: Extract<RemoteTransactionResult, { readonly status: "applied" }>,
    editor: FirstDraftRemoteRefreshEditor,
  ): void;
  assertResynchronizationSafe(): void;
  hasUnresolved(): boolean;
  getSnapshot(): FirstDraftOutboundPublisherSnapshot;
  dispose(): void;
}

export interface FirstDraftOutboundPublisherOptions {
  readonly limits?: {
    readonly maxEntries?: number;
    readonly maxMergedUpdateBytes?: number;
    readonly maxActiveRecords?: number;
    readonly maxRetainedEncodedBytes?: number;
    readonly maxClientFrameBytes?: number;
  };
}

interface PendingAccumulator {
  readonly generationId: string;
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly entries: Extract<EditorSemanticChange, { readonly kind: "block-content" }>[];
  mergedPayload: Uint8Array;
  projection: EditorTransportContentUpdate["readProjection"];
  selection: EditorTransactionSelection;
  failure: Error | null;
}

interface AggregateMaterial {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly mergedPayload: EditorImmutableBinary;
  readonly projection: EditorTransportContentUpdate["readProjection"];
}

interface RecordBase {
  readonly transactionId: string;
  readonly sourceChanges: readonly EditorSemanticChange[];
  readonly sourceTransactionIds: readonly string[];
  readonly selection: EditorTransactionSelection;
  readonly aggregate: AggregateMaterial | null;
  publishedObserved: boolean;
  status: RecordStatus;
}

type RecordStatus =
  | { readonly kind: "draft"; readonly transaction: EditorTransportTransaction | null }
  | {
      readonly kind: "sealed";
      readonly transaction: EditorTransportTransaction;
      readonly encodedFrame: ArrayBuffer;
      readonly attemptCount: number;
    }
  | {
      readonly kind: "sent";
      readonly transaction: EditorTransportTransaction;
      readonly encodedFrame: ArrayBuffer;
      readonly attemptCount: number;
      readonly lastSentGeneration: string;
    }
  | {
      readonly kind: "retryable-failure";
      readonly transaction: EditorTransportTransaction;
      readonly encodedFrame: ArrayBuffer;
      readonly attemptCount: number;
      readonly lastSentGeneration: string;
      readonly failure: Error;
    }
  | {
      readonly kind: "terminal-failure";
      readonly transaction: EditorTransportTransaction | null;
      readonly encodedFrame: ArrayBuffer | null;
      readonly attemptCount: number;
      readonly lastSentGeneration: string | null;
      readonly failure: Error;
    };

interface AcceptedLocalRecord {
  readonly documentId: string;
  readonly transactionId: string;
  readonly baseRevision: number;
  readonly revision: number;
  readonly acceptedAt: number;
  readonly transaction: EditorTransportTransaction;
}

type AttachedGeneration = FirstDraftOutboundGeneration & {
  caughtUp: boolean;
  usable: boolean;
  retainedTargets: Set<string> | null;
  retainedNotificationSent: boolean;
  finalCommittedSelection: EditorStableSelection | null;
};

/** Document-session ordered outbox for all local transaction publication. */
export function createFirstDraftOutboundPublisher(
  options: FirstDraftOutboundPublisherOptions = {},
): FirstDraftOutboundPublisher {
  const maxEntries = positiveLimit(options.limits?.maxEntries, DEFAULT_MAX_ENTRIES, "entry");
  const maxMergedUpdateBytes = positiveLimit(
    options.limits?.maxMergedUpdateBytes,
    DEFAULT_MAX_MERGED_UPDATE_BYTES,
    "merged update byte",
  );
  const maxActiveRecords = positiveLimit(
    options.limits?.maxActiveRecords,
    DEFAULT_MAX_ACTIVE_RECORDS,
    "active record",
  );
  const maxRetainedEncodedBytes = positiveLimit(
    options.limits?.maxRetainedEncodedBytes,
    DEFAULT_MAX_RETAINED_ENCODED_BYTES,
    "retained encoded byte",
  );
  const maxClientFrameBytes = positiveLimit(
    options.limits?.maxClientFrameBytes,
    MAX_FIRST_DRAFT_CLIENT_FRAME_BYTES,
    "client frame byte",
  );
  if (maxMergedUpdateBytes > MAX_CONFIGURED_MERGED_UPDATE_BYTES) {
    throw new RangeError(
      `First Draft merged update limit cannot exceed ${MAX_CONFIGURED_MERGED_UPDATE_BYTES}`,
    );
  }
  if (maxClientFrameBytes > MAX_FIRST_DRAFT_FRAME_BYTES) {
    throw new RangeError(
      `First Draft client frame limit cannot exceed ${MAX_FIRST_DRAFT_FRAME_BYTES}`,
    );
  }

  let generation: AttachedGeneration | null = null;
  let pending: PendingAccumulator | null = null;
  let quietTimer: ReturnType<typeof setTimeout> | null = null;
  let hardTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let atomicMarker: symbol | null = null;
  let retainedEncodedBytes = 0;
  const activeSourceIds = new Set<string>();
  const queue: RecordBase[] = [];
  const acceptedLocal = new Map<string, AcceptedLocalRecord>();
  const recentSourceIds = new Map<string, true>();
  const appliedRemote = new Map<string, FirstDraftAcceptedTransactionReplayMessage>();
  const duplicateReplayIds = new Map<string, true>();

  const report = (error: unknown) => generation?.onError?.(toError(error));
  const cancelTimers = () => {
    if (quietTimer !== null) clearTimeout(quietTimer);
    if (hardTimer !== null) clearTimeout(hardTimer);
    quietTimer = null;
    hardTimer = null;
  };

  const notifyRetainedPublished = (): void => {
    const attached = generation;
    if (
      !attached ||
      !attached.caughtUp ||
      attached.retainedNotificationSent ||
      attached.retainedTargets === null ||
      attached.retainedTargets.size > 0
    ) return;
    attached.retainedNotificationSent = true;
    try {
      attached.onRetainedPublished?.(attached.finalCommittedSelection);
    } catch (error) {
      report(error);
    }
  };

  const markPublishedOnGeneration = (
    record: RecordBase,
    selection: EditorStableSelection,
  ): void => {
    const attached = generation;
    if (!attached) return;
    attached.finalCommittedSelection = selection;
    attached.retainedTargets?.delete(record.transactionId);
    notifyRetainedPublished();
  };

  const pump = (): void => {
    const attached = generation;
    const record = queue[0];
    if (
      !attached ||
      !record ||
      !attached.caughtUp ||
      !attached.usable ||
      attached.socket.readyState !== 1
    ) {
      notifyRetainedPublished();
      return;
    }
    const status = record.status;
    if (status.kind === "draft" || status.kind === "terminal-failure") return;
    if (status.kind === "sent" && status.lastSentGeneration === attached.generationId) return;
    if (
      status.kind === "retryable-failure" &&
      status.lastSentGeneration === attached.generationId
    ) return;
    const { transaction, encodedFrame } = status;
    const attemptCount = status.attemptCount + 1;
    try {
      attached.socket.send(encodedFrame);
    } catch (error) {
      const failure = toError(error);
      record.status = {
        kind: "retryable-failure",
        transaction,
        encodedFrame,
        attemptCount,
        lastSentGeneration: attached.generationId,
        failure,
      };
      attached.usable = false;
      cancelTimers();
      report(failure);
      return;
    }
    record.status = {
      kind: "sent",
      transaction,
      encodedFrame,
      attemptCount,
      lastSentGeneration: attached.generationId,
    };
    if (!record.publishedObserved) {
      record.publishedObserved = true;
      try {
        attached.onPublished?.(record.transactionId);
      } catch (error) {
        report(error);
      }
    }
    const stableSelection = projectTransactionSelectionToStable(record.selection);
    try {
      attached.publishSelection(stableSelection, record.transactionId);
    } catch (error) {
      const failure = toError(error);
      record.status = {
        kind: "retryable-failure",
        transaction,
        encodedFrame,
        attemptCount,
        lastSentGeneration: attached.generationId,
        failure,
      };
      attached.usable = false;
      cancelTimers();
      report(failure);
      return;
    }
    markPublishedOnGeneration(record, stableSelection);
  };

  const appendRecord = (record: RecordBase): void => {
    const frameBytes = recordFrameBytes(record);
    const capacityFailure =
      queue.length >= maxActiveRecords ||
      retainedEncodedBytes + frameBytes > maxRetainedEncodedBytes;
    if (capacityFailure && record.status.kind !== "terminal-failure") {
      const status = record.status;
      const failure = new Error("First Draft outbound queue capacity was exceeded");
      record.status = {
        kind: "terminal-failure",
        transaction: status.transaction,
        encodedFrame: "encodedFrame" in status ? status.encodedFrame : null,
        attemptCount: "attemptCount" in status ? status.attemptCount : 0,
        lastSentGeneration:
          "lastSentGeneration" in status ? status.lastSentGeneration : null,
        failure,
      };
    }
    queue.push(record);
    retainedEncodedBytes += recordFrameBytes(record);
    if (record.status.kind === "terminal-failure") {
      cancelTimers();
      report(record.status.failure);
      return;
    }
    pump();
  };

  const finalizeDraft = (
    record: RecordBase,
    createTransaction: () => EditorTransportTransaction,
    predeterminedFailure: Error | null = null,
  ): void => {
    let transaction: EditorTransportTransaction | null = null;
    try {
      transaction = createTransaction();
      record.status = { kind: "draft", transaction };
      if (predeterminedFailure) throw predeterminedFailure;
      const encodedFrame = encodeFirstDraftMessage({
        type: "proposed-editor-transaction",
        transaction,
      });
      record.status =
        encodedFrame.byteLength > maxClientFrameBytes
          ? {
              kind: "terminal-failure",
              transaction,
              encodedFrame,
              attemptCount: 0,
              lastSentGeneration: null,
              failure: new Error(
                `First Draft proposed transaction frame exceeds ${maxClientFrameBytes} bytes`,
              ),
            }
          : {
              kind: "sealed",
              transaction,
              encodedFrame,
              attemptCount: 0,
            };
    } catch (error) {
      record.status = {
        kind: "terminal-failure",
        transaction,
        encodedFrame: null,
        attemptCount: 0,
        lastSentGeneration: null,
        failure: toError(error),
      };
    }
    appendRecord(record);
  };

  const sealStandalone = (change: EditorSemanticChange): void => {
    const record: RecordBase = {
      transactionId: change.transactionId,
      sourceChanges: Object.freeze([change]),
      sourceTransactionIds: Object.freeze([change.transactionId]),
      selection: change.selectionAfter,
      aggregate: null,
      publishedObserved: false,
      status: { kind: "draft", transaction: null },
    };
    finalizeDraft(record, () => convertEditorTransactionToTransport(change));
  };

  const sealPending = (): RecordBase | null => {
    cancelTimers();
    const accumulator = pending;
    if (!accumulator) return null;
    pending = null;
    const finalEntry = accumulator.entries.at(-1)!;
    const transactionId =
      accumulator.entries.length === 1
        ? accumulator.entries[0]!.transactionId
        : requireGenerationAllocator(generation)();
    const mergedPayload = EditorImmutableBinary.copyOf(accumulator.mergedPayload);
    const record: RecordBase = {
      transactionId,
      sourceChanges: Object.freeze([...accumulator.entries]),
      sourceTransactionIds: Object.freeze(
        accumulator.entries.map((change) => change.transactionId),
      ),
      selection: accumulator.selection,
      aggregate: Object.freeze({
        blockId: accumulator.blockId,
        blockType: accumulator.blockType,
        mergedPayload,
        projection: accumulator.projection,
      }),
      publishedObserved: false,
      status: { kind: "draft", transaction: null },
    };
    finalizeDraft(
      record,
      () => {
        const update: EditorContentOperationUpdate = Object.freeze({
          kind: "operation",
          format: EDITOR_YJS_CONTENT_FORMAT,
          version: EDITOR_YJS_CONTENT_FORMAT_VERSION,
          payload: mergedPayload,
        });
        return Object.freeze({
          transactionId,
          historyAction: "command" as const,
          graph: null,
          metadata: null,
          content: Object.freeze([
            Object.freeze({
              blockId: accumulator.blockId,
              blockType: finalEntry.blockType,
              update,
              readProjection: accumulator.projection,
            }),
          ]),
        });
      },
      accumulator.failure,
    );
    return record;
  };

  const flush: FirstDraftOutboundPublisher["flush"] = () => {
    sealPending();
  };
  const scheduleTimers = (first: boolean): void => {
    if (quietTimer !== null) clearTimeout(quietTimer);
    quietTimer = setTimeout(() => flush("quiet-timeout"), QUIET_TIMEOUT_MS);
    if (first) hardTimer = setTimeout(() => flush("hard-latency"), HARD_LATENCY_MS);
  };

  const publisher: FirstDraftOutboundPublisher = {
    attachGeneration(next) {
      assertActive(disposed);
      if (generation) publisher.detachGeneration({ attemptSend: true });
      generation = {
        ...next,
        caughtUp: false,
        usable: true,
        retainedTargets: null,
        retainedNotificationSent: false,
        finalCommittedSelection: null,
      };
    },
    generationCaughtUp() {
      assertActive(disposed);
      if (!generation) throw new Error("First Draft outbox has no attached generation");
      generation.caughtUp = true;
      generation.retainedTargets = new Set(queue.map((record) => record.transactionId));
      generation.retainedNotificationSent = false;
      generation.finalCommittedSelection = null;
      pump();
      notifyRetainedPublished();
    },
    markGenerationUnusable() {
      if (generation) generation.usable = false;
      cancelTimers();
    },
    detachGeneration({ attemptSend }) {
      if (!generation) {
        cancelTimers();
        return;
      }
      if (!attemptSend) generation.usable = false;
      sealPending();
      if (attemptSend) pump();
      cancelTimers();
      generation = null;
    },
    submitFinalized(change) {
      assertActive(disposed);
      const blocked = queue.find(
        ({ status }) =>
          status.kind === "retryable-failure" || status.kind === "terminal-failure",
      );
      if (blocked) {
        throw new Error(`First Draft outbound queue is blocked by ${blocked.transactionId}`);
      }
      if (activeSourceIds.has(change.transactionId) || recentSourceIds.has(change.transactionId)) {
        throw new Error(
          `Finalized transaction ${change.transactionId} was submitted more than once`,
        );
      }
      activeSourceIds.add(change.transactionId);
      if (atomicMarker !== null) {
        atomicMarker = null;
        flush("atomic-operation");
        sealStandalone(change);
        return;
      }
      const eligible = eligibleEntry(change);
      if (!eligible) {
        flush("incompatible");
        sealStandalone(change);
        return;
      }
      const eligibleChange = eligible.change;
      const attachedGenerationId = generation?.generationId ?? "detached";
      if (
        pending &&
        (pending.generationId !== attachedGenerationId ||
          pending.blockId !== eligibleChange.blockId ||
          pending.blockType !== eligibleChange.blockType)
      ) {
        flush("incompatible");
        sealStandalone(change);
        return;
      }
      if (eligible.payload.byteLength > maxMergedUpdateBytes) {
        flush("byte-limit");
        sealStandalone(change);
        return;
      }
      if (pending && pending.entries.length >= maxEntries) flush("entry-limit");
      let nextMerged: Uint8Array;
      try {
        nextMerged = pending
          ? mergeUpdates([pending.mergedPayload, eligible.payload])
          : eligible.payload;
      } catch (error) {
        flush("aggregation-error");
        sealStandalone(change);
        report(error);
        return;
      }
      if (nextMerged.byteLength > maxMergedUpdateBytes) {
        flush("byte-limit");
        nextMerged = eligible.payload;
      }
      const first = pending === null;
      if (!pending) {
        pending = {
          generationId: attachedGenerationId,
          blockId: eligibleChange.blockId,
          blockType: eligibleChange.blockType,
          entries: [],
          mergedPayload: nextMerged,
          projection: eligibleChange.readProjection,
          selection: eligibleChange.selectionAfter,
          failure: null,
        };
      }
      pending.entries.push(eligibleChange);
      pending.mergedPayload = nextMerged;
      pending.projection = eligibleChange.readProjection;
      pending.selection = eligibleChange.selectionAfter;
      scheduleTimers(first);
    },
    flush,
    beginAtomicOperation() {
      assertActive(disposed);
      flush("atomic-operation");
      const marker = Symbol("first-draft-atomic-operation");
      atomicMarker = marker;
      return () => {
        if (atomicMarker === marker) atomicMarker = null;
      };
    },
    beforeStandaloneSelectionPublication() {
      assertActive(disposed);
      flush("standalone-selection");
    },
    acceptLocal(message, currentRevision) {
      const accepted = acceptedLocal.get(message.transactionId);
      if (accepted) {
        if (
          accepted.documentId !== message.documentId ||
          accepted.baseRevision !== message.baseRevision ||
          accepted.revision !== message.revision
        ) {
          throw new Error(
            `Duplicate local acceptance ${message.transactionId} conflicts with accepted identity`,
          );
        }
        return "duplicate-local-acceptance";
      }
      const record = queue[0];
      if (!record || record.transactionId !== message.transactionId) {
        throw new Error(
          `Accepted First Draft transaction ${message.transactionId} is not the active outbox head`,
        );
      }
      if (record.status.kind !== "sent" && record.status.kind !== "retryable-failure") {
        throw new Error(`Accepted First Draft transaction ${message.transactionId} was never sent`);
      }
      if (
        message.baseRevision !== currentRevision ||
        message.revision !== currentRevision + 1
      ) {
        throw new Error("Local First Draft acceptance is missing or non-contiguous");
      }
      acceptHead(record, message);
      return "new-local-acceptance";
    },
    classifyReplay(message, currentRevision) {
      const transactionId = message.transactionId;
      if (message.transaction.transactionId !== transactionId) {
        throw new Error("Accepted replay transaction identity is inconsistent");
      }
      const active = queue.find((record) => record.transactionId === transactionId);
      if (active) {
        if (active !== queue[0]) {
          throw new Error(`Accepted replay for ${transactionId} overtook the active outbox head`);
        }
        const transaction = recordTransaction(active);
        if (!transaction || !firstDraftTransactionProposalsEqual(transaction, message.transaction)) {
          throw new Error(
            `Accepted replay for local transaction ${transactionId} conflicts with the outbox`,
          );
        }
        if (
          message.baseRevision !== currentRevision ||
          message.revision !== currentRevision + 1
        ) {
          throw new Error("Accepted local First Draft replay is missing or non-contiguous");
        }
        acceptHead(active, message);
        return "local-outstanding";
      }
      const accepted = acceptedLocal.get(transactionId);
      if (accepted) {
        if (
          accepted.documentId !== message.documentId ||
          accepted.baseRevision !== message.baseRevision ||
          accepted.revision !== message.revision ||
          !firstDraftTransactionProposalsEqual(accepted.transaction, message.transaction)
        ) {
          throw new Error(
            `Duplicate accepted replay ${transactionId} conflicts with local history`,
          );
        }
        remember(duplicateReplayIds, transactionId, true);
        return "local-duplicate";
      }
      const remote = appliedRemote.get(transactionId);
      if (remote) {
        if (!acceptedReplaysEqual(remote, message)) {
          throw new Error(
            `Duplicate remote replay ${transactionId} conflicts with applied history`,
          );
        }
        remember(duplicateReplayIds, transactionId, true);
        return "remote-duplicate";
      }
      return "remote-new";
    },
    persistenceFailed(message) {
      const record = queue[0];
      if (!record || record.transactionId !== message.transactionId) {
        throw new Error(
          `Persistence failure for ${message.transactionId} does not match the active outbox head`,
        );
      }
      const status = record.status;
      if (status.kind !== "sent" && status.kind !== "retryable-failure") {
        throw new Error(
          `Persistence failure for ${message.transactionId} conflicts with ${status.kind}`,
        );
      }
      const failure = new Error(`Persistence ${message.reason}: ${message.message}`);
      record.status = message.retryable
        ? {
            kind: "retryable-failure",
            transaction: status.transaction,
            encodedFrame: status.encodedFrame,
            attemptCount: status.attemptCount,
            lastSentGeneration: status.lastSentGeneration,
            failure,
          }
        : {
            kind: "terminal-failure",
            transaction: status.transaction,
            encodedFrame: status.encodedFrame,
            attemptCount: status.attemptCount,
            lastSentGeneration: status.lastSentGeneration,
            failure,
          };
      if (generation) generation.usable = false;
      cancelTimers();
      report(failure);
    },
    remoteApplied(message, _result, editor) {
      remember(appliedRemote, message.transactionId, message);
      const accumulator = pending;
      if (!accumulator) return;
      const transaction = message.transaction;
      const forcesBoundary = transaction.graph !== null || transaction.metadata !== null;
      const touchesPending = transaction.content.some(
        ({ blockId }) => blockId === accumulator.blockId,
      );
      if (!forcesBoundary && !touchesPending) return;
      try {
        refreshPendingAfterRemote(accumulator, editor);
      } catch (error) {
        accumulator.failure = toError(error);
        cancelTimers();
        report(error);
        return;
      }
      if (forcesBoundary) flush("remote-boundary");
    },
    assertResynchronizationSafe() {
      if (publisher.hasUnresolved()) {
        throw new Error(
          "Cannot resynchronize First Draft while local outbound acceptance is unresolved",
        );
      }
    },
    hasUnresolved() {
      return pending !== null || queue.length > 0;
    },
    getSnapshot() {
      return Object.freeze({
        disposed,
        attachedGeneration: generation?.generationId ?? null,
        generationCaughtUp: generation?.caughtUp ?? false,
        pendingEntries: pending?.entries.length ?? 0,
        pendingBytes: pending?.mergedPayload.byteLength ?? 0,
        pendingSourceTransactionIds: Object.freeze(
          pending?.entries.map((change) => change.transactionId) ?? [],
        ),
        activeRecordCount: queue.length,
        retainedEncodedBytes,
        outstanding: Object.freeze(queue.map(snapshotRecord)),
        acceptedLocalTransactionIds: Object.freeze([...acceptedLocal.keys()]),
        appliedRemoteTransactionIds: Object.freeze([...appliedRemote.keys()]),
        duplicateReplayTransactionIds: Object.freeze([...duplicateReplayIds.keys()]),
        pendingFailure: pending?.failure?.message ?? null,
      });
    },
    dispose() {
      if (disposed) return;
      publisher.detachGeneration({ attemptSend: true });
      disposed = true;
      atomicMarker = null;
      cancelTimers();
      queue.length = 0;
      activeSourceIds.clear();
      acceptedLocal.clear();
      recentSourceIds.clear();
      appliedRemote.clear();
      duplicateReplayIds.clear();
      retainedEncodedBytes = 0;
    },
  };

  function acceptHead(
    record: RecordBase,
    message: EditorTransactionAcceptedMessage | FirstDraftAcceptedTransactionReplayMessage,
  ): void {
    const transaction = recordTransaction(record);
    if (!transaction) {
      throw new Error(`Accepted transaction ${record.transactionId} has no semantic record`);
    }
    queue.shift();
    retainedEncodedBytes -= recordFrameBytes(record);
    if (retainedEncodedBytes < 0) retainedEncodedBytes = 0;
    for (const sourceId of record.sourceTransactionIds) {
      activeSourceIds.delete(sourceId);
      remember(recentSourceIds, sourceId, true);
    }
    remember(acceptedLocal, record.transactionId, {
      documentId: message.documentId,
      transactionId: message.transactionId,
      baseRevision: message.baseRevision,
      revision: message.revision,
      acceptedAt: message.acceptedAt,
      transaction,
    });
    generation?.retainedTargets?.delete(record.transactionId);
    pump();
    notifyRetainedPublished();
  }

  return Object.freeze(publisher);
}

function recordTransaction(record: RecordBase): EditorTransportTransaction | null {
  return record.status.transaction;
}

function recordFrameBytes(record: RecordBase): number {
  return "encodedFrame" in record.status && record.status.encodedFrame
    ? record.status.encodedFrame.byteLength
    : 0;
}

function snapshotRecord(record: RecordBase): FirstDraftOutboundRecordSnapshot {
  const status = record.status;
  return Object.freeze({
    transactionId: record.transactionId,
    state: status.kind,
    sourceTransactionIds: record.sourceTransactionIds,
    lastSentGeneration:
      "lastSentGeneration" in status ? status.lastSentGeneration : null,
    attemptCount: "attemptCount" in status ? status.attemptCount : 0,
    encodedBytes: recordFrameBytes(record),
    failure: "failure" in status ? status.failure.message : null,
    hasSemanticTransaction: status.transaction !== null,
  });
}

function refreshPendingAfterRemote(
  accumulator: PendingAccumulator,
  editor: FirstDraftRemoteRefreshEditor,
): void {
  const block = editor.getBlock(accumulator.blockId);
  if (
    !block ||
    block.tombstone !== null ||
    block.id !== accumulator.blockId ||
    block.type !== accumulator.blockType
  ) {
    throw new Error(
      `Remote transaction invalidated pending First Draft block ${accumulator.blockId}`,
    );
  }
  const projection = editor.readBlockContent(accumulator.blockId, accumulator.blockType);
  if (!projection || typeof projection !== "object") {
    throw new Error(
      `Remote transaction removed compatible text content for ${accumulator.blockId}`,
    );
  }
  accumulator.projection = projection as EditorTransportContentUpdate["readProjection"];
  accumulator.selection = projectCanonicalSelectionToTransaction(
    editor.selection.getSnapshot(),
  );
}

function eligibleEntry(
  change: EditorSemanticChange,
): {
  readonly change: Extract<EditorSemanticChange, { readonly kind: "block-content" }>;
  readonly payload: Uint8Array;
} | null {
  if (
    change.kind !== "block-content" ||
    change.historyAction !== "command" ||
    change.yjsUpdate.kind !== "operation" ||
    change.yjsUpdate.format !== EDITOR_YJS_CONTENT_FORMAT ||
    change.yjsUpdate.version !== EDITOR_YJS_CONTENT_FORMAT_VERSION ||
    !(change.yjsUpdate.payload instanceof EditorImmutableBinary) ||
    change.yjsUpdate.payload.byteLength === 0 ||
    change.operations.length !== 1 ||
    !isOrdinaryTextOperation(change.operations[0]!, change.blockId, change.blockType)
  ) return null;
  return { change, payload: change.yjsUpdate.payload.copy() };
}

function isOrdinaryTextOperation(
  operation: EditorLogicalContentOperation,
  blockId: BlockId,
  blockType: BlockType,
): boolean {
  if (operation.blockId !== blockId || operation.blockType !== blockType) return false;
  if (operation.kind === "insertInlineContent") {
    return (
      operation.position.blockId === blockId &&
      operation.content.length === 1 &&
      isSinglePlainTextNode(operation.content[0])
    );
  }
  if (operation.kind === "deleteInlineRange") {
    return (
      operation.range.from.blockId === blockId &&
      operation.range.to.blockId === blockId &&
      operation.range.to.offset - operation.range.from.offset === 1 &&
      operation.deletedContent?.length === 1 &&
      isSinglePlainTextNode(operation.deletedContent[0])
    );
  }
  return false;
}

function isSinglePlainTextNode(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  const candidate = node as {
    readonly type?: unknown;
    readonly text?: unknown;
    readonly marks?: unknown;
  };
  return (
    candidate.type === "text" &&
    typeof candidate.text === "string" &&
    Array.from(candidate.text).length === 1 &&
    (candidate.marks === undefined ||
      (Array.isArray(candidate.marks) && candidate.marks.length === 0))
  );
}

function requireGenerationAllocator(generation: AttachedGeneration | null): () => string {
  if (!generation) {
    throw new Error("Cannot allocate an aggregate identity without a socket generation");
  }
  return generation.createTransactionId;
}

function acceptedReplaysEqual(
  left: FirstDraftAcceptedTransactionReplayMessage,
  right: FirstDraftAcceptedTransactionReplayMessage,
): boolean {
  if (
    left.documentId !== right.documentId ||
    left.transactionId !== right.transactionId ||
    left.baseRevision !== right.baseRevision ||
    left.revision !== right.revision ||
    left.acceptedAt !== right.acceptedAt
  ) return false;
  const leftFrame = encodeFirstDraftMessage({
    type: "proposed-editor-transaction",
    transaction: left.transaction,
  });
  const rightFrame = encodeFirstDraftMessage({
    type: "proposed-editor-transaction",
    transaction: right.transaction,
  });
  return bytesEqual(new Uint8Array(leftFrame), new Uint8Array(rightFrame));
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function remember<Value>(map: Map<string, Value>, key: string, value: Value): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > MAX_DIAGNOSTIC_IDS) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function positiveLimit(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new RangeError(`First Draft outbound ${name} limit must be a positive integer`);
  }
  return resolved;
}

function assertActive(disposed: boolean): void {
  if (disposed) throw new Error("Cannot use a disposed First Draft outbound publisher");
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
