import {
  cloneJsonValue,
  isStructuralKey,
  type BlockId,
  type JsonValue,
} from "@repo/editor-core/kernel";
import type { VersionedBlock } from "@repo/editor-core/document";
import {
  isEditorSelectionTextAnchor,
  normalizeNewSelection,
  readEditorBlockSelectionTarget,
  type EditorSelection,
  type EditorSelectionGraphReader,
  type StableEditorSelection,
} from "@repo/editor-react/selection";
import type { EditorContentRuntime } from "../content/content-runtime.ts";
import type { CompiledCanonicalEditorDefinition } from "../definition/compiled-editor-definition.ts";
import type {
  EditorBlockInternalSelectionSubsystemDefinition,
} from "../definition/contracts.ts";
import type {
  AdditionalSelectionRecord,
  CollaborationSubjectKey,
  EditorAdditionalSelectionReader,
  RemoteSelectionSnapshot,
  RemoteStableSelection,
  RemoteTransactionSelectionResult,
  ResolvedEditorSelection,
  ResolvedSelectionFocusTarget,
  SelectionRevision,
} from "./contracts.ts";
import { toCollaborationSubjectKey } from "./subject.ts";

export interface AdditionalSelectionEnvironment {
  readonly compiledDefinition: CompiledCanonicalEditorDefinition;
  readonly graph: EditorSelectionGraphReader;
  readonly contentRuntime: EditorContentRuntime;
}

type SelectionInterpretation =
  | {
      readonly status: "resolved";
      readonly stable: RemoteStableSelection;
      readonly resolved: ResolvedEditorSelection;
    }
  | {
      readonly status: "unresolved";
      readonly stable: RemoteStableSelection;
    }
  | { readonly status: "cleared"; readonly stable: RemoteStableSelection }
  | { readonly status: "invalid" };

export class AdditionalSelectionManager
  implements EditorAdditionalSelectionReader
{
  private records: Map<
    CollaborationSubjectKey,
    AdditionalSelectionRecord
  > | null = null;
  private globalListeners: Set<() => void> | null = null;
  private blockListeners: Map<BlockId, Set<() => void>> | null = null;
  private blockInternalListeners: Map<BlockId, Set<() => void>> | null = null;
  private blockSnapshots: Map<
    BlockId,
    readonly AdditionalSelectionRecord[]
  > | null = null;
  private blockInternalSnapshots: Map<
    BlockId,
    readonly AdditionalSelectionRecord[]
  > | null = null;
  private snapshot: readonly AdditionalSelectionRecord[] = emptyRecords;
  private disposed = false;

  constructor(private readonly environment: AdditionalSelectionEnvironment) {}

  getSnapshot = (): readonly AdditionalSelectionRecord[] => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return noop;
    this.globalListeners ??= new Set();
    this.globalListeners.add(listener);
    return () => {
      this.globalListeners?.delete(listener);
      if (this.globalListeners?.size === 0) this.globalListeners = null;
    };
  };

  getBlockSnapshot = (blockId: BlockId): readonly AdditionalSelectionRecord[] =>
    this.cachedBlockSnapshot(blockId, false);

  subscribeBlock = (blockId: BlockId, listener: () => void): (() => void) =>
    this.subscribeCoverage("block", blockId, listener);

  getBlockInternalSnapshot = (
    blockId: BlockId,
  ): readonly AdditionalSelectionRecord[] =>
    this.cachedBlockSnapshot(blockId, true);

  subscribeBlockInternal = (
    blockId: BlockId,
    listener: () => void,
  ): (() => void) =>
    this.subscribeCoverage("block-internal", blockId, listener);

  applyTransactionSelection(input: {
    readonly subject: unknown;
    readonly selectionRevision: unknown;
    readonly selection: unknown;
  }): RemoteTransactionSelectionResult {
    if (this.disposed) return { status: "ignored-invalid-envelope" };
    const subject = toCollaborationSubjectKey(input.subject);
    const revision = validSelectionRevision(input.selectionRevision);
    if (!subject || revision === null) {
      return { status: "ignored-invalid-envelope" };
    }
    const current = this.records?.get(subject);
    if (current && revision <= current.watermark) {
      return {
        status: revision === current.watermark ? "duplicate" : "stale",
        subject,
      };
    }
    let result!: RemoteTransactionSelectionResult;
    this.mutate(() => {
      result = this.applySelection(subject, revision, input.selection);
    });
    return result;
  }

  /** Re-resolves existing records and applies the transaction sidecar atomically. */
  reconcileAndApplyTransactionSelection(input: {
    readonly subject: unknown;
    readonly selectionRevision: unknown;
    readonly selection: unknown;
  }): RemoteTransactionSelectionResult {
    if (this.disposed) return { status: "ignored-invalid-envelope" };
    const subject = toCollaborationSubjectKey(input.subject);
    const revision = validSelectionRevision(input.selectionRevision);
    let result: RemoteTransactionSelectionResult = {
      status: "ignored-invalid-envelope",
    };
    this.mutate(() => {
      this.reResolveRecords();
      if (!subject || revision === null) return;
      const current = this.records?.get(subject);
      if (current && revision <= current.watermark) {
        result = {
          status: revision === current.watermark ? "duplicate" : "stale",
          subject,
        };
        return;
      }
      result = this.applySelection(subject, revision, input.selection);
    });
    return result;
  }

  replace(snapshot: RemoteSelectionSnapshot): void {
    if (this.disposed) return;
    if (!isRecord(snapshot) || !Array.isArray(snapshot.entries)) {
      throw new TypeError("Remote selection snapshot must contain entries");
    }
    this.mutate(() => {
      const authoritative = new Map<
        CollaborationSubjectKey,
        {
          readonly revision: number;
          readonly selection: unknown;
          readonly color: string | null;
        }
      >();
      for (const candidate of snapshot.entries) {
        if (!isRecord(candidate)) continue;
        const subject = toCollaborationSubjectKey(candidate.subject);
        const revision = validSelectionRevision(candidate.selectionRevision);
        if (!subject || revision === null) continue;
        const previous = authoritative.get(subject);
        if (!previous || revision >= previous.revision) {
          authoritative.set(subject, {
            revision,
            selection: candidate.selection,
            color: validSelectionColor(candidate.color),
          });
        }
      }

      if (this.records) {
        for (const [subject, record] of this.records) {
          if (!record.active || authoritative.has(subject)) continue;
          this.records.set(
            subject,
            Object.freeze({
              ...record,
              active: false,
              stableSelection: null,
              resolvedSelection: null,
              resolution: "inactive" as const,
            }),
          );
        }
      }

      for (const [subject, entry] of authoritative) {
        const current = this.records?.get(subject);
        if (current && entry.revision < current.watermark) continue;
        const interpreted = safelyInterpretSelection(
          entry.selection,
          this.environment,
        );
        this.ensureRecords().set(
          subject,
          recordFromInterpretation(
            subject,
            entry.revision,
            entry.color,
            true,
            interpreted,
          ),
        );
      }
    });
  }

  reResolve(): void {
    if (this.disposed || !this.records) return;
    this.mutate(() => this.reResolveRecords());
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.records?.clear();
    this.records = null;
    this.globalListeners?.clear();
    this.globalListeners = null;
    this.blockListeners?.clear();
    this.blockListeners = null;
    this.blockInternalListeners?.clear();
    this.blockInternalListeners = null;
    this.blockSnapshots?.clear();
    this.blockSnapshots = null;
    this.blockInternalSnapshots?.clear();
    this.blockInternalSnapshots = null;
    this.snapshot = emptyRecords;
  }

  private ensureRecords(): Map<
    CollaborationSubjectKey,
    AdditionalSelectionRecord
  > {
    this.records ??= new Map();
    return this.records;
  }

  private applySelection(
    subject: CollaborationSubjectKey,
    revision: number,
    selection: unknown,
  ): RemoteTransactionSelectionResult {
    const interpreted = safelyInterpretSelection(selection, this.environment);
    const color = this.records?.get(subject)?.color ?? null;
    this.ensureRecords().set(
      subject,
      recordFromInterpretation(subject, revision, color, true, interpreted),
    );
    return {
      status:
        interpreted.status === "resolved" ? "installed" : interpreted.status,
      subject,
    } as RemoteTransactionSelectionResult;
  }

  private reResolveRecords(): void {
    if (!this.records) return;
    for (const [subject, record] of this.records) {
      if (!record.active || !record.stableSelection) continue;
      const interpreted = safelyInterpretSelection(
        record.stableSelection,
        this.environment,
      );
      this.records.set(
        subject,
        recordFromInterpretation(
          subject,
          record.watermark,
          record.color,
          true,
          interpreted,
        ),
      );
    }
  }

  private subscribeCoverage(
    kind: "block" | "block-internal",
    blockId: BlockId,
    listener: () => void,
  ): () => void {
    if (this.disposed) return noop;
    const registry =
      kind === "block"
        ? (this.blockListeners ??= new Map())
        : (this.blockInternalListeners ??= new Map());
    const listeners = registry.get(blockId) ?? new Set<() => void>();
    listeners.add(listener);
    registry.set(blockId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) registry.delete(blockId);
    };
  }

  private filteredBlockSnapshot(
    blockId: BlockId,
    internalOnly: boolean,
  ): readonly AdditionalSelectionRecord[] {
    if (!this.records) return emptyRecords;
    const records = [...this.records.values()].filter((record) => {
      if (!record.active) return false;
      const resolved = record.resolvedSelection;
      if (internalOnly) {
        return (
          record.stableSelection?.kind === "selection" &&
          record.stableSelection.selection.kind === "block-internal" &&
          record.stableSelection.selection.blockId === blockId
        );
      }
      if (!resolved) {
        const stable = record.stableSelection;
        if (!stable || stable.kind !== "selection") return false;
        if (stable.selection.kind === "block-internal") {
          return isWithinSubtree(
            this.environment.graph,
            stable.selection.blockId,
            blockId,
          );
        }
        return [stable.selection.anchor, stable.selection.focus].some((point) =>
          isWithinSubtree(this.environment.graph, point.blockId, blockId),
        );
      }
      if (resolved.kind === "block-internal") {
        return isWithinSubtree(
          this.environment.graph,
          resolved.blockId,
          blockId,
        );
      }
      return resolved.blockIds.some((selectedBlockId) =>
        isWithinSubtree(this.environment.graph, selectedBlockId, blockId),
      );
    });
    return records.length === 0 ? emptyRecords : Object.freeze(records);
  }

  private cachedBlockSnapshot(
    blockId: BlockId,
    internalOnly: boolean,
  ): readonly AdditionalSelectionRecord[] {
    const snapshots = internalOnly
      ? (this.blockInternalSnapshots ??= new Map())
      : (this.blockSnapshots ??= new Map());
    const previous = snapshots.get(blockId);
    const next = this.filteredBlockSnapshot(blockId, internalOnly);
    if (previous && recordsKey(previous) === recordsKey(next)) return previous;
    snapshots.set(blockId, next);
    return next;
  }

  private mutate(mutation: () => void): void {
    const previousGlobal = recordsKey(this.snapshot);
    const previousBlocks = focusedKeys(this.blockListeners, (blockId) =>
      this.getBlockSnapshot(blockId),
    );
    const previousInternal = focusedKeys(
      this.blockInternalListeners,
      (blockId) => this.getBlockInternalSnapshot(blockId),
    );
    mutation();
    this.snapshot = this.records
      ? Object.freeze(
          [...this.records.values()].sort((left, right) =>
            left.subject.localeCompare(right.subject),
          ),
        )
      : emptyRecords;
    if (previousGlobal !== recordsKey(this.snapshot)) {
      for (const listener of [...(this.globalListeners ?? [])]) {
        notifyListener(listener);
      }
    }
    notifyFocusedChanges(this.blockListeners, previousBlocks, (blockId) =>
      this.getBlockSnapshot(blockId),
    );
    notifyFocusedChanges(
      this.blockInternalListeners,
      previousInternal,
      (blockId) => this.getBlockInternalSnapshot(blockId),
    );
  }
}

function safelyInterpretSelection(
  selection: unknown,
  environment: AdditionalSelectionEnvironment,
): SelectionInterpretation {
  try {
    return interpretSelection(selection, environment);
  } catch {
    return { status: "invalid" };
  }
}

function interpretSelection(
  input: unknown,
  environment: AdditionalSelectionEnvironment,
): SelectionInterpretation {
  const stable = decodeTransactionSelection(input);
  if (!stable) {
    return { status: "invalid" };
  }
  if (stable.kind === "none") return { status: "cleared", stable };
  const selection = stable.selection;
  if (selection.kind === "block-internal") {
    return interpretBlockInternalSelection(stable, selection, environment);
  }
  const resolved = resolveDocumentSelection(selection, environment);
  return resolved.status === "resolved"
    ? { status: "resolved", stable, resolved: resolved.selection }
    : resolved.status === "unresolved"
      ? { status: "unresolved", stable }
      : { status: "invalid" };
}

function interpretBlockInternalSelection(
  stable: RemoteStableSelection,
  selection: Extract<
    StableEditorSelection,
    { readonly kind: "block-internal" }
  >,
  environment: AdditionalSelectionEnvironment,
): SelectionInterpretation {
  const subsystem = environment.compiledDefinition
    .blockInternalSelectionSubsystems.get(selection.subsystem);
  if (!subsystem) return { status: "invalid" };
  const block = environment.graph.getBlock(selection.blockId);
  if (!block || block.tombstone) return { status: "unresolved", stable };
  try {
    const validated = subsystem.validate({
      blockId: selection.blockId,
      block,
      payload: cloneJsonValue(selection.payload),
      mode: "remote",
      graph: environment.graph,
    });
    if (!validated.ok) return { status: "invalid" };
    const acceptedStable = Object.freeze({
      kind: "selection" as const,
      selection: Object.freeze({
        ...selection,
        payload: cloneJsonValue(validated.payload),
      }),
    });
    if (validated.resolution === "unresolved") {
      return { status: "unresolved", stable: acceptedStable };
    }
    return {
      status: "resolved",
      stable: acceptedStable,
      resolved: Object.freeze({
        kind: "block-internal" as const,
        blockId: selection.blockId,
        subsystem: selection.subsystem,
        payload: cloneJsonValue(validated.payload),
        focusTarget: resolveBlockInternalFocusTarget({
          subsystem,
          blockId: selection.blockId,
          block,
          payload: validated.payload,
          environment,
        }),
        decorationTarget: resolveBlockInternalDecorationTarget({
          subsystem,
          blockId: selection.blockId,
          block,
          payload: validated.payload,
          environment,
        }),
      }),
    };
  } catch {
    return { status: "invalid" };
  }
}

function resolveDocumentSelection(
  selection: Extract<StableEditorSelection, { readonly kind: "document" }>,
  environment: AdditionalSelectionEnvironment,
):
  | {
      readonly status: "resolved";
      readonly selection: Extract<
        ResolvedEditorSelection,
        { kind: "document" }
      >;
    }
  | { readonly status: "unresolved" }
  | { readonly status: "invalid" } {
  const anchor = resolveDocumentPoint(selection.anchor, environment);
  const focus = resolveDocumentPoint(selection.focus, environment);
  if (anchor.status === "invalid" || focus.status === "invalid") {
    return { status: "invalid" };
  }
  if (anchor.status === "unresolved" || focus.status === "unresolved") {
    return { status: "unresolved" };
  }
  const normalized = normalizeNewSelection(
    { anchor: anchor.point, focus: focus.point },
    environment.graph,
  );
  if (!normalized.ok) {
    return { status: "invalid" };
  }
  return {
    status: "resolved",
    selection: Object.freeze({
      kind: "document" as const,
      direction: selection.direction,
      anchor: anchor.point,
      focus: focus.point,
      blockIds: Object.freeze(
        normalized.range.rangeBlocks.map((block) => block.blockId),
      ),
      focusTarget: resolveDocumentFocusTarget(focus.point, environment.graph),
    }),
  };
}

function resolveDocumentFocusTarget(
  focus: EditorSelection["focus"],
  graph: EditorSelectionGraphReader,
): ResolvedSelectionFocusTarget {
  if (focus.textAnchor !== null) {
    return Object.freeze({
      kind: "text" as const,
      blockId: focus.blockId,
      point: focus,
    });
  }
  const paint = readEditorBlockSelectionTarget(graph, focus.blockId)?.selection
    .paint;
  return Object.freeze({
    kind: "block" as const,
    blockId: focus.blockId,
    target:
      isRecord(paint) &&
      paint.kind === "block-surface" &&
      typeof paint.target === "string"
        ? paint.target
        : null,
  });
}

function resolveBlockInternalFocusTarget(input: {
  readonly subsystem: EditorBlockInternalSelectionSubsystemDefinition;
  readonly blockId: BlockId;
  readonly block: VersionedBlock;
  readonly payload: JsonValue;
  readonly environment: AdditionalSelectionEnvironment;
}): ResolvedSelectionFocusTarget | null {
  return resolveBlockInternalTarget(input, input.subsystem.resolveFocusTarget);
}

function resolveBlockInternalDecorationTarget(input: {
  readonly subsystem: EditorBlockInternalSelectionSubsystemDefinition;
  readonly blockId: BlockId;
  readonly block: VersionedBlock;
  readonly payload: JsonValue;
  readonly environment: AdditionalSelectionEnvironment;
}): ResolvedSelectionFocusTarget | null {
  return resolveBlockInternalTarget(
    input,
    input.subsystem.resolveDecorationTarget,
  );
}

function resolveBlockInternalTarget(
  input: {
    readonly subsystem: EditorBlockInternalSelectionSubsystemDefinition;
    readonly blockId: BlockId;
    readonly block: VersionedBlock;
    readonly payload: JsonValue;
    readonly environment: AdditionalSelectionEnvironment;
  },
  resolver: EditorBlockInternalSelectionSubsystemDefinition["resolveFocusTarget"],
): ResolvedSelectionFocusTarget | null {
  if (!resolver) return null;
  const target = resolver({
    blockId: input.blockId,
    block: input.block,
    payload: cloneJsonValue(input.payload),
    graph: input.environment.graph,
  });
  if (!target) return null;
  if (
    target.kind === "text" &&
    target.blockId === target.point.blockId &&
    input.environment.graph.getBlock(target.blockId)
  ) {
    return Object.freeze({ ...target, point: Object.freeze(target.point) });
  }
  if (
    target.kind === "block" &&
    input.environment.graph.getBlock(target.blockId)
  ) {
    return Object.freeze({ ...target, target: target.target ?? null });
  }
  return null;
}

function resolveDocumentPoint(
  point: Extract<
    StableEditorSelection,
    { readonly kind: "document" }
  >["anchor"],
  environment: AdditionalSelectionEnvironment,
):
  | {
      readonly status: "resolved";
      readonly point: EditorSelection["anchor"];
    }
  | { readonly status: "unresolved" }
  | { readonly status: "invalid" } {
  const target = readEditorBlockSelectionTarget(
    environment.graph,
    point.blockId,
  );
  if (!target) return { status: "unresolved" };
  if (point.kind === "block") {
    if (target.selection.projection.endpoint.kind !== "block") {
      return { status: "invalid" };
    }
    return {
      status: "resolved",
      point: Object.freeze({
        blockId: target.block.id,
        blockType: target.block.type,
        blockCategory: target.category,
        textOffset: 0,
        textAnchor: null,
        affinity: null,
      }),
    };
  }
  if (
    target.selection.projection.endpoint.kind !== "content" ||
    !isEditorSelectionTextAnchor(point.textAnchor)
  ) {
    return { status: "invalid" };
  }
  const resolved = environment.contentRuntime.tryResolveTextAnchorInLiveContext({
    blockId: point.blockId,
    blockType: target.block.type,
    codec: point.textAnchor.codec,
    payload: point.textAnchor.payload,
  });
  if (!resolved.ok && resolved.reason === "not-live") {
    return {
      status: "resolved",
      point: Object.freeze({
        blockId: target.block.id,
        blockType: target.block.type,
        blockCategory: target.category,
        textOffset: point.textOffset,
        textAnchor: point.textAnchor,
        affinity: point.affinity,
      }),
    };
  }
  if (!resolved.ok) {
    return {
      status: resolved.reason === "missing-text" ? "unresolved" : "invalid",
    };
  }
  return {
    status: "resolved",
    point: Object.freeze({
      blockId: target.block.id,
      blockType: target.block.type,
      blockCategory: target.category,
      textOffset: resolved.textOffset,
      textAnchor: point.textAnchor,
      affinity: point.affinity,
    }),
  };
}

function decodeTransactionSelection(
  input: unknown,
): RemoteStableSelection | null {
  if (!isRecord(input) || typeof input.kind !== "string") return null;
  if (input.kind === "none") {
    return hasExactKeys(input, ["kind"])
      ? Object.freeze({ kind: "none" as const })
      : null;
  }
  if (
    input.kind !== "selection" ||
    !hasExactKeys(input, ["kind", "selection"])
  ) {
    return null;
  }
  const selection = parseUntrustedStableSelection(input.selection);
  return selection
    ? Object.freeze({ kind: "selection" as const, selection })
    : null;
}

function parseUntrustedStableSelection(
  input: unknown,
): StableEditorSelection | null {
  if (!isRecord(input) || typeof input.kind !== "string") return null;
  if (input.kind === "document") {
    if (
      !hasExactKeys(input, ["kind", "direction", "anchor", "focus"]) ||
      (input.direction !== "forward" && input.direction !== "backward")
    ) {
      return null;
    }
    const anchor = decodeStableDocumentPoint(input.anchor);
    const focus = decodeStableDocumentPoint(input.focus);
    return anchor && focus
      ? Object.freeze({
          kind: "document" as const,
          direction: input.direction,
          anchor,
          focus,
        })
      : null;
  }
  if (
    input.kind !== "block-internal" ||
    !hasExactKeys(input, ["kind", "blockId", "subsystem", "payload"]) ||
    !isBlockId(input.blockId) ||
    typeof input.subsystem !== "string" ||
    input.subsystem.trim() === "" ||
    !isJsonValue(input.payload)
  ) {
    return null;
  }
  return Object.freeze({
    kind: "block-internal" as const,
    blockId: input.blockId,
    subsystem: input.subsystem,
    payload: cloneJsonValue(input.payload),
  });
}

function decodeStableDocumentPoint(input: unknown) {
  if (!isRecord(input) || typeof input.kind !== "string") return null;
  if (input.kind === "block") {
    return hasExactKeys(input, ["kind", "blockId", "surface"]) &&
      isBlockId(input.blockId) &&
      input.surface === "block"
      ? Object.freeze({
          kind: "block" as const,
          blockId: input.blockId,
          surface: "block" as const,
        })
      : null;
  }
  if (
    input.kind !== "text" ||
    !hasExactKeys(input, ["kind", "blockId", "textOffset", "textAnchor", "affinity"]) ||
    !isBlockId(input.blockId) ||
    !Number.isSafeInteger(input.textOffset) ||
    Number(input.textOffset) < 0 ||
    !isEditorSelectionTextAnchor(input.textAnchor) ||
    (input.affinity !== null &&
      input.affinity !== "forward" &&
      input.affinity !== "backward")
  ) {
    return null;
  }
  return Object.freeze({
    kind: "text" as const,
    blockId: input.blockId,
    textOffset: Number(input.textOffset),
    textAnchor: cloneJsonValue(input.textAnchor),
    affinity: input.affinity,
  });
}

function recordFromInterpretation(
  subject: CollaborationSubjectKey,
  watermark: SelectionRevision,
  color: string | null,
  active: boolean,
  interpretation: SelectionInterpretation,
): AdditionalSelectionRecord {
  return Object.freeze({
    subject,
    watermark,
    color,
    active,
    stableSelection:
      interpretation.status === "invalid" ? null : interpretation.stable,
    resolvedSelection:
      interpretation.status === "resolved" ? interpretation.resolved : null,
    resolution: interpretation.status,
  });
}

function validSelectionColor(value: unknown): string | null {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/u.test(value)
    ? value.toLowerCase()
    : null;
}

function validSelectionRevision(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0
    ? Number(value)
    : null;
}

function isWithinSubtree(
  graph: EditorSelectionGraphReader,
  candidate: BlockId,
  root: BlockId,
): boolean {
  let current: BlockId | null = candidate;
  const visited = new Set<BlockId>();
  while (current !== null && !visited.has(current)) {
    if (current === root) return true;
    visited.add(current);
    current = graph.getParentId(current);
  }
  return false;
}

function recordsKey(records: readonly AdditionalSelectionRecord[]): string {
  return JSON.stringify(records);
}

function focusedKeys(
  listeners: ReadonlyMap<BlockId, Set<() => void>> | null,
  read: (blockId: BlockId) => readonly AdditionalSelectionRecord[],
): ReadonlyMap<BlockId, string> {
  if (!listeners) return emptyFocusedKeys;
  return new Map(
    [...listeners.keys()].map((blockId) => [
      blockId,
      recordsKey(read(blockId)),
    ]),
  );
}

function notifyFocusedChanges(
  listeners: ReadonlyMap<BlockId, Set<() => void>> | null,
  previous: ReadonlyMap<BlockId, string>,
  read: (blockId: BlockId) => readonly AdditionalSelectionRecord[],
): void {
  if (!listeners) return;
  for (const [blockId, blockListeners] of listeners) {
    if (previous.get(blockId) === recordsKey(read(blockId))) continue;
    for (const listener of [...blockListeners]) notifyListener(listener);
  }
}

function notifyListener(listener: () => void): void {
  try {
    listener();
  } catch {
    // A projection subscriber cannot invalidate already committed canonical state.
  }
}

function isBlockId(value: unknown): value is BlockId {
  return typeof value === "string" && isStructuralKey(value);
}

function isJsonValue(
  value: unknown,
  seen = new WeakSet<object>(),
): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || value === null || seen.has(value)) {
    return false;
  }
  seen.add(value);
  const valid = Array.isArray(value)
    ? value.every((entry) => isJsonValue(entry, seen))
    : Object.getPrototypeOf(value) === Object.prototype &&
      Object.values(value).every((entry) => isJsonValue(entry, seen));
  seen.delete(value);
  return valid;
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return (
    actual.length === keys.length && actual.every((key) => keys.includes(key))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const noop = () => undefined;
const emptyRecords = Object.freeze([]) as readonly AdditionalSelectionRecord[];
const emptyFocusedKeys = Object.freeze(
  new Map<BlockId, string>(),
) as ReadonlyMap<BlockId, string>;
