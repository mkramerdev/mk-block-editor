import type {
  EditorSelectionInvalidation,
  EditorSelectionSnapshot,
} from "../model/types.ts";

export type EditorSelectionInvalidationValidationResult =
  | {
      ok: true;
      invalidation: Required<EditorSelectionInvalidation>;
    }
  | {
      ok: false;
      reason: "idle-selection" | "stale-notification" | "projection-current";
    };

export function validateEditorSelectionInvalidation(
  snapshot: EditorSelectionSnapshot,
  invalidation: EditorSelectionInvalidation,
): EditorSelectionInvalidationValidationResult {
  if (snapshot.phase === "idle") return { ok: false, reason: "idle-selection" };

  const graphRevision = normalizeInvalidationGraphRevision(
    invalidation.graphRevision,
    snapshot.graphRevision,
  );

  if (
    invalidation.graphRevision !== undefined &&
    graphRevision < snapshot.graphRevision
  ) {
    return { ok: false, reason: "stale-notification" };
  }

  if (
    invalidation.reason === "stale-graph" &&
    invalidation.graphRevision !== undefined &&
    graphRevision <= snapshot.graphRevision
  ) {
    return { ok: false, reason: "projection-current" };
  }

  return {
    ok: true,
    invalidation: {
      reason: invalidation.reason,
      graphRevision,
    },
  };
}

function normalizeInvalidationGraphRevision(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}
