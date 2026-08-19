import type { BlockId } from "@repo/editor-core/kernel";
import {
  validateCommittedSelectionOwnership,
  type BlockInternalSelectionSubsystem,
  type CommittedSelectionSnapshot,
  type EditorSelectionRangeBlock,
} from "@repo/editor-react/selection";

export interface TextFragmentBoundsDescriptor {
  readonly coverage: "partial" | "complete-content";
  readonly startOffset: number | null;
  readonly endOffset: number | null;
}

export type DocumentSelectionPaintPrimitive =
  | {
      readonly kind: "text-fragment";
      readonly blockId: BlockId;
      readonly bounds: TextFragmentBoundsDescriptor;
    }
  | {
      readonly kind: "atomic-surface";
      readonly blockId: BlockId;
      readonly target: string | null;
    };

export interface BlockInternalPaintInput {
  readonly sourceSelectionRevision: number;
  readonly hostBlockId: BlockId;
  readonly subsystem: BlockInternalSelectionSubsystem;
  readonly selection: unknown;
}

export type LocalSelectionPaintPlan =
  | {
      readonly kind: "document";
      readonly sourceSelectionRevision: number;
      readonly primitives: readonly DocumentSelectionPaintPrimitive[];
    }
  | {
      readonly kind: "block-internal";
      readonly sourceSelectionRevision: number;
      readonly hostBlockId: BlockId;
      readonly subsystem: BlockInternalSelectionSubsystem;
      readonly internalPaint: BlockInternalPaintInput;
    };

export type SelectionPaintPlanFailureReason =
  | "invalid-ownership"
  | "local-plan-revision-mismatch"
  | "document-plan-containing-internal-paint"
  | "internal-plan-containing-document-primitives"
  | "primitive-derived-from-non-document-block"
  | "multiple-internal-host-owners"
  | "projection-used-as-authoritative-paint"
  | "duplicate-atomic-primitive"
  | "unknown-internal-subsystem"
  | "unregistered-bounds-target"
  | "stale-paint-plan"
  | "unsupported-paint-descriptor";

export type SelectionPaintPlanResult<T> =
  | { readonly ok: true; readonly plan: T }
  | {
      readonly ok: false;
      readonly reason: SelectionPaintPlanFailureReason;
      readonly blockId?: BlockId;
    };

export type SelectionPaintBoundsResolutionResult<T> =
  | { readonly ok: true; readonly target: T }
  | {
      readonly ok: false;
      readonly reason: "unregistered-bounds-target";
      readonly blockId: BlockId;
    };

export function deriveLocalSelectionPaintPlan(
  snapshot: CommittedSelectionSnapshot,
): SelectionPaintPlanResult<LocalSelectionPaintPlan> {
  const ownership = validateCommittedSelectionOwnership(snapshot);
  if (!ownership.ok)
    return {
      ok: false,
      reason: "invalid-ownership",
      ...(ownership.blockId ? { blockId: ownership.blockId } : {}),
    };

  if (snapshot.kind === "block-internal") {
    if (
      snapshot.owner.kind !== "block-internal" ||
      !snapshot.internal ||
      !knownInternalSubsystem(snapshot.owner.subsystem)
    )
      return { ok: false, reason: "unknown-internal-subsystem" };
    return {
      ok: true,
      plan: {
        kind: "block-internal" as const,
        sourceSelectionRevision: snapshot.revision,
        hostBlockId: snapshot.owner.blockId,
        subsystem: snapshot.owner.subsystem,
        internalPaint: {
          sourceSelectionRevision: snapshot.revision,
          hostBlockId: snapshot.owner.blockId,
          subsystem: snapshot.owner.subsystem,
          selection: snapshot.internal.snapshot,
        },
      },
    };
  }

  if (snapshot.owner.kind !== "document" || snapshot.internal)
    return {
      ok: false,
      reason: "document-plan-containing-internal-paint",
    };

  const primitives = deriveDocumentSelectionPaintPrimitives(snapshot.blocks);
  if (!primitives.ok) return primitives;
  return {
    ok: true,
    plan: {
      kind: "document" as const,
      sourceSelectionRevision: snapshot.revision,
      primitives: primitives.primitives,
    },
  };
}

export function deriveDocumentSelectionPaintPrimitives(
  rangeBlocks: readonly EditorSelectionRangeBlock[],
):
  | {
      readonly ok: true;
      readonly primitives: readonly DocumentSelectionPaintPrimitive[];
    }
  | {
      readonly ok: false;
      readonly reason: SelectionPaintPlanFailureReason;
      readonly blockId?: BlockId;
    } {
  const primitives: DocumentSelectionPaintPrimitive[] = [];
  const atomicBlocks = new Set<BlockId>();
  for (const rangeBlock of rangeBlocks) {
    if (rangeBlock.owner && rangeBlock.owner.kind !== "document")
      return {
        ok: false,
        reason: "primitive-derived-from-non-document-block",
        blockId: rangeBlock.blockId,
      };
    if (rangeBlock.coverage === "none") continue;
    const descriptor = rangeBlock.coverageResult.paint;
    if (isContentPaint(descriptor)) {
      if (
        rangeBlock.coverage !== "partial" &&
        rangeBlock.coverage !== "complete-content"
      )
        continue;
      primitives.push({
        kind: "text-fragment" as const,
        blockId: rangeBlock.blockId,
        bounds: {
          coverage: rangeBlock.coverage,
          startOffset: rangeBlock.startOffset ?? null,
          endOffset: rangeBlock.endOffset ?? null,
        },
      });
      continue;
    }
    if (isBlockSurfacePaint(descriptor)) {
      if (!blockSurfaceCovers(descriptor, rangeBlock.coverage)) continue;
      if (atomicBlocks.has(rangeBlock.blockId))
        return {
          ok: false,
          reason: "duplicate-atomic-primitive",
          blockId: rangeBlock.blockId,
        };
      atomicBlocks.add(rangeBlock.blockId);
      primitives.push({
        kind: "atomic-surface" as const,
        blockId: rangeBlock.blockId,
        target:
          typeof descriptor.target === "string" ? descriptor.target : null,
      });
      continue;
    }
    if (descriptor !== undefined)
      return {
        ok: false,
        reason: "unsupported-paint-descriptor",
        blockId: rangeBlock.blockId,
      };
  }
  return {
    ok: true,
    primitives,
  };
}

export function resolveAtomicSurfacePaintBounds<T>(
  primitive: Extract<
    DocumentSelectionPaintPrimitive,
    { readonly kind: "atomic-surface" }
  >,
  resolve: (blockId: BlockId, target: string | null) => T | null,
): SelectionPaintBoundsResolutionResult<T> {
  const target = resolve(primitive.blockId, primitive.target);
  return target === null
    ? {
        ok: false,
        reason: "unregistered-bounds-target",
        blockId: primitive.blockId,
      }
    : { ok: true, target };
}

function isContentPaint(value: unknown): value is { readonly kind: "content" } {
  return isRecord(value) && value.kind === "content";
}

function isBlockSurfacePaint(value: unknown): value is {
  readonly kind: "block-surface";
  readonly target?: unknown;
  readonly coverage?: unknown;
} {
  return isRecord(value) && value.kind === "block-surface";
}

function blockSurfaceCovers(
  descriptor: { readonly coverage?: unknown },
  coverage: "none" | "partial" | "complete-content" | "complete-block",
): boolean {
  if (coverage !== "complete-content" && coverage !== "complete-block")
    return false;
  if (!Array.isArray(descriptor.coverage)) return coverage === "complete-block";
  return descriptor.coverage.includes(coverage);
}

function knownInternalSubsystem(
  subsystem: BlockInternalSelectionSubsystem,
): boolean {
  return subsystem.kind === "registered" && subsystem.id.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
