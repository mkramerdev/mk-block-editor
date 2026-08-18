export type {
  EditorLogicalSelectionPoint,
  EditorSelectionDirection,
  EditorSelectionDragDiagnosticPayload,
  EditorSelectionEndpointTarget,
  EditorSelectionEndpointPayload,
  EditorSelectionInvalidation,
  EditorSelectionInvalidationReason,
  EditorSelectionPhase,
  EditorSelectionRangeCoverage,
  EditorSelectionRangeBlock,
  EditorSelectionSnapshot,
  EditorSelectionSnapshotEndpoint,
} from "./types.ts";

import type { EditorSelectionSnapshot } from "./types.ts";

export function createIdleSelectionSnapshot(
  selectionRevision = 0,
  options: {
    graphRevision?: number;
    lastInvalidationReason?: EditorSelectionSnapshot["lastInvalidationReason"];
  } = {},
): EditorSelectionSnapshot {
  return {
    phase: "idle",
    selectionRevision,
    graphRevision: options.graphRevision ?? 0,
    lastInvalidationReason: options.lastInvalidationReason ?? null,
    direction: null,
    anchor: null,
    focus: null,
    normalizedStart: null,
    normalizedEnd: null,
    rangeBlocks: Object.freeze([]) as readonly [],
  };
}
