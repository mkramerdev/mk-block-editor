import type { RelativeTextPoint } from "@repo/editor-core/document";
import {
  decodeRelativePosition,
  encodeRelativePosition,
  type RelativePosition,
} from "@repo/editor-yjs";
import { base64ToBytes, bytesToBase64 } from "./base64.ts";

export function encodeRelativeTextPoint(
  relativePosition: RelativePosition,
): RelativeTextPoint {
  return {
    encoded: bytesToBase64(encodeRelativePosition(relativePosition)),
    assoc: normalizeAssoc(relativePosition.assoc),
  };
}

export function decodeRelativeTextPoint(
  point: RelativeTextPoint,
): RelativePosition | null {
  try {
    return decodeRelativePosition(base64ToBytes(point.encoded));
  } catch {
    return null;
  }
}

function normalizeAssoc(assoc: number | undefined): -1 | 0 | 1 {
  if (assoc === undefined || assoc === 0) return 0;
  return assoc < 0 ? -1 : 1;
}
