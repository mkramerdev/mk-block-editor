import type { BlockId } from "@repo/editor-core/kernel";
import type {
  EditorLogicalSelectionPoint,
  EditorSelectionDirection,
  EditorSelectionRangeBlock,
  EditorSelectionSnapshot,
  BlockInternalSelectionSubsystem,
  RegisteredInternalSelectionSubsystem,
  RegisteredInternalSelectionSubsystemId,
  SelectionBlockOwner,
} from "./types.ts";

export type CommittedSelectionOwner = SelectionBlockOwner;

export type CommittedSelectionBlock = Omit<
  EditorSelectionRangeBlock,
  "owner"
> & {
  readonly owner: SelectionBlockOwner;
};

export interface CommittedSelectionEndpoints {
  readonly anchor: EditorLogicalSelectionPoint | null;
  readonly head: EditorLogicalSelectionPoint | null;
  readonly normalizedStart: EditorLogicalSelectionPoint | null;
  readonly normalizedEnd: EditorLogicalSelectionPoint | null;
}

export interface CommittedSelectionDeferredDescriptor {
  readonly kind: "deferred-runtime-derivation";
  readonly sourceSelectionRevision: number;
  readonly owner: CommittedSelectionOwner;
}

export interface CommittedSelectionFocusDescriptor
  extends CommittedSelectionDeferredDescriptor {
  readonly target: EditorLogicalSelectionPoint | null;
}

export interface CommittedInternalSelection {
  readonly blockId: BlockId;
  readonly subsystem: BlockInternalSelectionSubsystem;
  readonly snapshot: unknown;
}

export interface SelectionDocumentProjection {
  readonly kind: "projection";
  readonly authoritative: false;
  readonly hostBlockId: BlockId;
  readonly endpoints: CommittedSelectionEndpoints;
  readonly selection: EditorSelectionSnapshot;
}

export interface CommittedSelectionSnapshot {
  readonly revision: number;
  readonly kind: "document" | "block-internal";
  readonly owner: CommittedSelectionOwner;
  readonly direction: EditorSelectionDirection | null;
  readonly endpoints: CommittedSelectionEndpoints;
  readonly blocks: readonly CommittedSelectionBlock[];
  readonly materialization: CommittedSelectionDeferredDescriptor;
  readonly edit: CommittedSelectionDeferredDescriptor;
  readonly focus: CommittedSelectionFocusDescriptor;
  readonly documentSelection: EditorSelectionSnapshot;
  readonly documentProjection: SelectionDocumentProjection | null;
  readonly internal: CommittedInternalSelection | null;
}

export type SelectionOwnershipValidationFailureReason =
  | "missing-block-owner"
  | "top-level-block-owner-mismatch"
  | "multiple-internal-owners"
  | "internal-host-block-mismatch"
  | "internal-subsystem-mismatch"
  | "document-block-inside-internal-selection"
  | "internal-block-inside-document-selection"
  | "authoritative-projection-misuse"
  | "duplicate-authoritative-selection-block"
  | "unknown-internal-subsystem"
  | "owner-changed-during-rebase"
  | "internal-owner-block-missing"
  | "contradictory-materialization-ownership"
  | "contradictory-edit-ownership"
  | "contradictory-paint-ownership";

export type SelectionOwnershipValidationResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: SelectionOwnershipValidationFailureReason;
      readonly blockId?: BlockId;
    };

export function registerInternalSelectionSubsystem(
  id: string,
): RegisteredInternalSelectionSubsystem | null {
  const normalized = id.trim();
  if (!normalized) return null;
  return Object.freeze({
    kind: "registered" as const,
    id: normalized as RegisteredInternalSelectionSubsystemId,
  });
}

export type CommittedSelectionSnapshotConstructionFailureReason =
  | "invalid-endpoints"
  | "contradictory-selection-variant"
  | "duplicate-selection-block"
  | "missing-internal-selection-block"
  | "internal-selection-document-projection-mismatch"
  | SelectionOwnershipValidationFailureReason;

export type CommittedSelectionSnapshotConstructionResult =
  | { readonly ok: true; readonly snapshot: CommittedSelectionSnapshot }
  | {
      readonly ok: false;
      readonly reason: CommittedSelectionSnapshotConstructionFailureReason;
    };

const committedDocumentOwner = Object.freeze({
  kind: "document" as const,
});

export type CommittedSelectionSnapshotInput =
  | {
      readonly kind: "document";
      readonly revision: number;
      readonly documentSelection: EditorSelectionSnapshot;
    }
  | {
      readonly kind: "block-internal";
      readonly revision: number;
      readonly blockId: BlockId;
      readonly subsystem: BlockInternalSelectionSubsystem;
      readonly internal: unknown;
      readonly documentProjection: EditorSelectionSnapshot;
    };

export interface CommittedSelectionDerivation<TInput> {
  readonly sourceSelectionRevision: number;
  readonly input: TInput;
  readonly ownership: {
    readonly owner: CommittedSelectionOwner;
    readonly blocks: readonly CommittedSelectionBlock[];
    readonly documentProjection: SelectionDocumentProjection | null;
  };
}

export function createCommittedSelectionSnapshot(
  input: CommittedSelectionSnapshotInput,
): CommittedSelectionSnapshotConstructionResult {
  const documentSelection =
    input.kind === "document"
      ? input.documentSelection
      : input.documentProjection;
  if (documentSelection.phase === "idle")
    return { ok: false, reason: "contradictory-selection-variant" };
  if (!validEndpoints(documentSelection))
    return { ok: false, reason: "invalid-endpoints" };
  const blockIds = new Set<BlockId>();
  for (const rangeBlock of documentSelection.rangeBlocks) {
    if (blockIds.has(rangeBlock.blockId))
      return { ok: false, reason: "duplicate-selection-block" };
    blockIds.add(rangeBlock.blockId);
  }
  if (input.kind === "block-internal") {
    if (!input.blockId || input.internal === undefined)
      return { ok: false, reason: "missing-internal-selection-block" };
    if (!blockIds.has(input.blockId))
      return {
        ok: false,
        reason: "internal-selection-document-projection-mismatch",
      };
    if (!isKnownInternalSubsystem(input.subsystem))
      return { ok: false, reason: "unknown-internal-subsystem" };
  }

  const topLevelOwner: CommittedSelectionOwner =
    input.kind === "document"
      ? committedDocumentOwner
      : Object.freeze({
          kind: "block-internal" as const,
          blockId: input.blockId,
          subsystem: cloneImmutable(input.subsystem),
        });
  const authoritativeSourceBlocks =
    input.kind === "document"
      ? documentSelection.rangeBlocks
      : documentSelection.rangeBlocks.filter(
          (rangeBlock) => rangeBlock.blockId === input.blockId,
        );
  const ownershipInputFailure = validateInputBlockOwnership(
    input.kind,
    topLevelOwner,
    authoritativeSourceBlocks,
  );
  if (ownershipInputFailure) return ownershipInputFailure;
  const committedBlocks = authoritativeSourceBlocks.map((rangeBlock) =>
    Object.freeze({
      ...cloneImmutable(rangeBlock),
      owner: topLevelOwner,
    }),
  ) as readonly CommittedSelectionBlock[];
  const clonedDocumentSelection = {
    ...cloneImmutable({
      ...documentSelection,
      sourceSelectionRevision: input.revision,
      rangeBlocks: Object.freeze([]) as readonly EditorSelectionRangeBlock[],
    }),
    rangeBlocks: committedBlocks,
  };
  const descriptor = Object.freeze({
    kind: "deferred-runtime-derivation" as const,
    sourceSelectionRevision: input.revision,
    owner: topLevelOwner,
  });
  const snapshot: CommittedSelectionSnapshot = {
    revision: input.revision,
    kind: input.kind,
    owner: topLevelOwner,
    direction: clonedDocumentSelection.direction,
    endpoints: Object.freeze({
      anchor: clonedDocumentSelection.anchor,
      head: clonedDocumentSelection.focus,
      normalizedStart: clonedDocumentSelection.normalizedStart,
      normalizedEnd: clonedDocumentSelection.normalizedEnd,
    }),
    blocks: committedBlocks,
    materialization: descriptor,
    edit: descriptor,
    focus: Object.freeze({
      ...descriptor,
      target: clonedDocumentSelection.focus,
    }),
    documentSelection: clonedDocumentSelection,
    documentProjection:
      input.kind === "block-internal"
        ? Object.freeze({
            kind: "projection" as const,
            authoritative: false as const,
            hostBlockId: input.blockId,
            endpoints: Object.freeze({
              anchor: clonedDocumentSelection.anchor,
              head: clonedDocumentSelection.focus,
              normalizedStart: clonedDocumentSelection.normalizedStart,
              normalizedEnd: clonedDocumentSelection.normalizedEnd,
            }),
            selection: cloneImmutable({
              ...documentSelection,
              sourceSelectionRevision: input.revision,
            }),
          })
        : null,
    internal:
      input.kind === "block-internal"
        ? Object.freeze({
            blockId: input.blockId,
            subsystem: cloneImmutable(input.subsystem),
            snapshot: cloneImmutable(input.internal),
          })
        : null,
  };
  const ownership = validateCommittedSelectionOwnership(snapshot);
  if (!ownership.ok) return ownership;
  return { ok: true, snapshot: deepFreeze(snapshot) };
}

export function validateCommittedSelectionOwnership(
  snapshot: CommittedSelectionSnapshot,
): SelectionOwnershipValidationResult {
  const blockIds = new Set<BlockId>();
  const internalOwners = new Map<string, SelectionBlockOwner>();
  for (const rangeBlock of snapshot.blocks) {
    if (!rangeBlock.owner)
      return {
        ok: false,
        reason: "missing-block-owner",
        blockId: rangeBlock.blockId,
      };
    if (blockIds.has(rangeBlock.blockId))
      return {
        ok: false,
        reason: "duplicate-authoritative-selection-block",
        blockId: rangeBlock.blockId,
      };
    blockIds.add(rangeBlock.blockId);
    if (snapshot.kind === "document" && rangeBlock.owner.kind !== "document")
      return {
        ok: false,
        reason: "internal-block-inside-document-selection",
        blockId: rangeBlock.blockId,
      };
    if (snapshot.kind === "block-internal") {
      if (rangeBlock.owner.kind === "document")
        return {
          ok: false,
          reason: "document-block-inside-internal-selection",
          blockId: rangeBlock.blockId,
        };
      if (rangeBlock.owner.blockId !== rangeBlock.blockId)
        return {
          ok: false,
          reason: "internal-host-block-mismatch",
          blockId: rangeBlock.blockId,
        };
      if (!isKnownInternalSubsystem(rangeBlock.owner.subsystem))
        return {
          ok: false,
          reason: "unknown-internal-subsystem",
          blockId: rangeBlock.blockId,
        };
      internalOwners.set(ownerKey(rangeBlock.owner), rangeBlock.owner);
    }
  }
  if (snapshot.kind === "document") {
    if (snapshot.owner.kind !== "document")
      return { ok: false, reason: "top-level-block-owner-mismatch" };
    if (snapshot.internal || snapshot.documentProjection)
      return { ok: false, reason: "authoritative-projection-misuse" };
  } else {
    if (snapshot.owner.kind !== "block-internal")
      return { ok: false, reason: "top-level-block-owner-mismatch" };
    if (internalOwners.size > 1)
      return { ok: false, reason: "multiple-internal-owners" };
    const blockOwner = internalOwners.values().next().value as
      | Extract<SelectionBlockOwner, { kind: "block-internal" }>
      | undefined;
    if (
      blockOwner &&
      !sameSubsystem(blockOwner.subsystem, snapshot.owner.subsystem)
    )
      return {
        ok: false,
        reason: "internal-subsystem-mismatch",
        blockId: blockOwner.blockId,
      };
    if (!blockIds.has(snapshot.owner.blockId))
      return {
        ok: false,
        reason: "internal-owner-block-missing",
        blockId: snapshot.owner.blockId,
      };
    if (
      !snapshot.internal ||
      snapshot.internal.blockId !== snapshot.owner.blockId
    )
      return {
        ok: false,
        reason: "internal-host-block-mismatch",
        blockId: snapshot.owner.blockId,
      };
    if (!sameSubsystem(snapshot.internal.subsystem, snapshot.owner.subsystem))
      return {
        ok: false,
        reason: "internal-subsystem-mismatch",
        blockId: snapshot.owner.blockId,
      };
    if (
      !snapshot.documentProjection ||
      snapshot.documentProjection.authoritative !== false ||
      snapshot.documentProjection.hostBlockId !== snapshot.owner.blockId
    )
      return {
        ok: false,
        reason: "authoritative-projection-misuse",
        blockId: snapshot.owner.blockId,
      };
  }
  if (!sameOwner(snapshot.materialization.owner, snapshot.owner))
    return { ok: false, reason: "contradictory-materialization-ownership" };
  if (!sameOwner(snapshot.edit.owner, snapshot.owner))
    return { ok: false, reason: "contradictory-edit-ownership" };
  return { ok: true };
}

export function deriveCommittedSelectionProjection(
  snapshot: CommittedSelectionSnapshot,
): CommittedSelectionDerivation<EditorSelectionSnapshot> {
  const ownershipValidation = validateCommittedSelectionOwnership(snapshot);
  if (!ownershipValidation.ok)
    throw new TypeError(
      `Invalid committed selection ownership: ${ownershipValidation.reason}`,
    );
  return Object.freeze({
    sourceSelectionRevision: snapshot.revision,
    input: snapshot.documentSelection,
    ownership: Object.freeze({
      owner: snapshot.owner,
      blocks: snapshot.blocks,
      documentProjection: snapshot.documentProjection,
    }),
  });
}

function validateInputBlockOwnership(
  kind: CommittedSelectionSnapshot["kind"],
  owner: CommittedSelectionOwner,
  blocks: readonly EditorSelectionRangeBlock[],
): {
  readonly ok: false;
  readonly reason: SelectionOwnershipValidationFailureReason;
} | null {
  for (const block of blocks) {
    if (!block.owner) continue;
    if (kind === "document" && block.owner.kind !== "document")
      return { ok: false, reason: "internal-block-inside-document-selection" };
    if (kind === "block-internal") {
      if (block.owner.kind === "document")
        return {
          ok: false,
          reason: "document-block-inside-internal-selection",
        };
      if (
        owner.kind !== "block-internal" ||
        block.owner.blockId !== owner.blockId
      )
        return { ok: false, reason: "internal-host-block-mismatch" };
      if (!sameSubsystem(block.owner.subsystem, owner.subsystem))
        return { ok: false, reason: "internal-subsystem-mismatch" };
    }
  }
  return null;
}

function isKnownInternalSubsystem(
  subsystem: BlockInternalSelectionSubsystem,
): boolean {
  return (
    subsystem.kind === "registered" &&
    typeof subsystem.id === "string" &&
    subsystem.id.trim().length > 0
  );
}

function sameOwner(
  left: CommittedSelectionOwner,
  right: CommittedSelectionOwner,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "document" || right.kind === "document") return true;
  return (
    left.blockId === right.blockId &&
    sameSubsystem(left.subsystem, right.subsystem)
  );
}

function sameSubsystem(
  left: BlockInternalSelectionSubsystem,
  right: BlockInternalSelectionSubsystem,
): boolean {
  return left.id === right.id;
}

function ownerKey(
  owner: Extract<SelectionBlockOwner, { kind: "block-internal" }>,
): string {
  return `${owner.blockId}:${owner.subsystem.id}`;
}

function validEndpoints(snapshot: EditorSelectionSnapshot): boolean {
  return Boolean(
    snapshot.anchor &&
      snapshot.focus &&
      snapshot.normalizedStart &&
      snapshot.normalizedEnd &&
      snapshot.direction,
  );
}

function cloneImmutable<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.map((entry) => cloneImmutable(entry)) as T;
  if (value instanceof Map) {
    const clone = new Map(
      [...value].map(([key, entry]) => [
        cloneImmutable(key),
        cloneImmutable(entry),
      ]),
    );
    Object.defineProperties(clone, {
      set: { value: immutableCollectionMutation },
      delete: { value: immutableCollectionMutation },
      clear: { value: immutableCollectionMutation },
    });
    return clone as T;
  }
  if (value instanceof Set) {
    const clone = new Set([...value].map((entry) => cloneImmutable(entry)));
    Object.defineProperties(clone, {
      add: { value: immutableCollectionMutation },
      delete: { value: immutableCollectionMutation },
      clear: { value: immutableCollectionMutation },
    });
    return clone as T;
  }
  const clone: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    clone[key] = cloneImmutable((value as Record<PropertyKey, unknown>)[key]);
  }
  return clone as T;
}

function immutableCollectionMutation(): never {
  throw new TypeError("Committed selection snapshots are immutable");
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value))
    return value;
  if (value instanceof Map || value instanceof Set) {
    for (const entry of value) {
      if (Array.isArray(entry)) {
        deepFreeze(entry[0]);
        deepFreeze(entry[1]);
      } else {
        deepFreeze(entry);
      }
    }
  } else {
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
  }
  return Object.freeze(value);
}
