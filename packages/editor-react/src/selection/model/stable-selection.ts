import {
  cloneJsonValue,
  jsonValuesEqual,
  type JsonValue,
} from "@repo/editor-core/kernel";
import { isEditorSelectionTextAnchor } from "../anchors/text-anchor.ts";
import type { CanonicalLocalSelection } from "./canonical-selection.ts";
import type {
  EditorLogicalSelectionPoint,
  EditorStableSelection,
  EditorTransactionSelection,
  StableDocumentSelectionPoint,
  TransactionDocumentSelectionPoint,
} from "./types.ts";

export function editorStableSelectionsEqual(
  left: EditorStableSelection,
  right: EditorStableSelection,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "none" || right.kind === "none") return true;
  if (left.selection.kind !== right.selection.kind) return false;
  if (
    left.selection.kind === "block-internal" ||
    right.selection.kind === "block-internal"
  ) {
    if (
      left.selection.kind !== "block-internal" ||
      right.selection.kind !== "block-internal"
    ) {
      return false;
    }
    return (
      left.selection.blockId === right.selection.blockId &&
      left.selection.subsystem === right.selection.subsystem &&
      jsonValuesEqual(left.selection.payload, right.selection.payload)
    );
  }
  return (
    left.selection.direction === right.selection.direction &&
    stableDocumentPointsEqual(left.selection.anchor, right.selection.anchor) &&
    stableDocumentPointsEqual(left.selection.focus, right.selection.focus)
  );
}

function stableDocumentPointsEqual(
  left: StableDocumentSelectionPoint,
  right: StableDocumentSelectionPoint,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "block" || right.kind === "block") {
    return (
      left.kind === "block" &&
      right.kind === "block" &&
      left.blockId === right.blockId &&
      left.surface === right.surface
    );
  }
  return (
    left.blockId === right.blockId &&
    left.textOffset === right.textOffset &&
    left.affinity === right.affinity &&
    jsonValuesEqual(left.textAnchor, right.textAnchor)
  );
}

export function projectCanonicalSelectionToStable(
  canonical: CanonicalLocalSelection,
): EditorStableSelection {
  return projectTransactionSelectionToStable(
    projectCanonicalSelectionToTransaction(canonical),
  );
}

/** Projects authoritative canonical state to the immutable transaction shape. */
export function projectCanonicalSelectionToTransaction(
  canonical: CanonicalLocalSelection,
): EditorTransactionSelection {
  if (canonical.kind === "none") return Object.freeze({ kind: "none" });
  const snapshot = canonical.snapshot;
  if (canonical.kind === "block-internal") {
    const blockId = snapshot.internal?.blockId;
    const rangeBlock = blockId
      ? snapshot.blocks.find((block) => block.blockId === blockId)
      : undefined;
    const payload = rangeBlock?.coverageResult.stableSelectionPayload;
    if (!blockId || payload === undefined || !isJsonValue(payload)) {
      throw new TypeError(
        "Canonical block-internal selection is missing a stable JSON payload",
      );
    }
    return deepFreeze({
      kind: "selection" as const,
      selection: {
        kind: "block-internal" as const,
        blockId,
        subsystem: canonical.subsystem.id,
        payload: cloneJsonValue(payload),
      },
    });
  }

  const direction = snapshot.direction;
  const logicalAnchor = snapshot.endpoints.anchor;
  const logicalFocus = snapshot.endpoints.head;
  const anchor = stableDocumentPoint(logicalAnchor);
  const focus =
    logicalAnchor &&
    logicalFocus &&
    sameLogicalPoint(logicalAnchor, logicalFocus)
      ? anchor
      : stableDocumentPoint(logicalFocus);
  if (!direction || !anchor || !focus) {
    throw new TypeError("Canonical document selection has invalid endpoints");
  }
  return Object.freeze({
    kind: "selection" as const,
    selection: Object.freeze({
      kind: "document" as const,
      direction,
      anchor,
      focus,
    }),
  });
}

export function projectTransactionSelectionToStable(
  selection: EditorTransactionSelection,
): EditorStableSelection {
  if (selection.kind === "none") return selection;
  if (selection.selection.kind === "block-internal") return selection;
  const anchor = stableTransportPoint(selection.selection.anchor);
  const focus =
    selection.selection.focus === selection.selection.anchor
      ? anchor
      : stableTransportPoint(selection.selection.focus);
  return Object.freeze({
    kind: "selection" as const,
    selection: Object.freeze({
      kind: "document" as const,
      direction: selection.selection.direction,
      anchor,
      focus,
    }),
  });
}

function stableTransportPoint(
  point: TransactionDocumentSelectionPoint,
): StableDocumentSelectionPoint {
  if (point.kind === "block") return point;
  return Object.freeze({
    kind: "text",
    blockId: point.blockId,
    textOffset: point.textOffset,
    textAnchor: point.textAnchor,
    affinity: point.affinity,
  });
}

function stableDocumentPoint(
  point: EditorLogicalSelectionPoint | null,
): TransactionDocumentSelectionPoint | null {
  if (!point) return null;
  if (isEditorSelectionTextAnchor(point.textAnchor)) {
    return Object.freeze({
      kind: "text",
      blockId: point.blockId,
      textOffset: point.textOffset,
      textAnchor: point.textAnchor,
      affinity: point.affinity,
    });
  }
  return Object.freeze({
    kind: "block",
    blockId: point.blockId,
    surface: "block",
  });
}

function sameLogicalPoint(
  left: EditorLogicalSelectionPoint,
  right: EditorLogicalSelectionPoint,
): boolean {
  return (
    left.blockId === right.blockId &&
    left.textOffset === right.textOffset &&
    left.affinity === right.affinity &&
    left.textAnchor?.codec === right.textAnchor?.codec &&
    left.textAnchor?.payload.encoded === right.textAnchor?.payload.encoded &&
    left.textAnchor?.payload.assoc === right.textAnchor?.payload.assoc
  );
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

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
