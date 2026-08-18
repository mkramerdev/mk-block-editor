import type { RelativeTextPoint, TextPoint } from "@repo/editor-core/document";
import {
  createAbsolutePositionFromRelativePosition,
  createRelativePositionFromTypeIndex,
  type EditorYjsFragmentContext,
} from "@repo/editor-yjs";
import {
  readCanonicalYjsTextType,
  yjsIndexToCanonicalOffset,
} from "@repo/editor-yjs";
import {
  decodeRelativeTextPoint,
  encodeRelativeTextPoint,
} from "./relative-position-serialization.ts";

export interface YjsRelativeTextPointCodec {
  encode(
    point: TextPoint,
    options?: YjsRelativeTextPointEncodeOptions,
  ): YjsRelativeTextPointEncodeResult;
  decode(point: TextPoint): YjsRelativeTextPointDecodeResult;
}

export interface YjsRelativeTextPointEncodeOptions {
  assoc?: -1 | 0 | 1 | null;
}

export type YjsRelativeTextPointFailureReason =
  | "missing-content"
  | "unmapped-position"
  | "invalid-relative-position";

export type YjsRelativeTextPointEncodeResult =
  | { ok: true; point: TextPoint }
  | {
      ok: false;
      reason: YjsRelativeTextPointFailureReason;
      point: TextPoint;
      message?: string;
    };

export type YjsRelativeTextPointDecodeResult =
  | { ok: true; point: TextPoint }
  | {
      ok: false;
      reason: YjsRelativeTextPointFailureReason;
      point: TextPoint;
      message?: string;
    };

export type YjsRelativeTextPointOffsetDecodeResult =
  | { ok: true; offset: number }
  | { ok: false; reason: YjsRelativeTextPointFailureReason; message?: string };

export function createYjsRelativeTextPointCodec(
  context: EditorYjsFragmentContext,
): YjsRelativeTextPointCodec {
  return {
    encode(point, options = {}) {
      const text = readCanonicalYjsTextType(context);
      if (!text) return { ok: false, reason: "missing-content", point };
      // Canonical offsets and Yjs indexes differ only when a text prefix
      // contains surrogate pairs. Most typing is at the end of ordinary BMP
      // text, so avoid materializing and scanning the complete Yjs delta.
      const value = text.toString();
      const index =
        !hasHighSurrogate(value)
          ? point.offset
          : canonicalOffsetToYjsIndexFromText(value, point.offset);
      if (index === null)
        return { ok: false, reason: "unmapped-position", point };
      return {
        ok: true,
        point: {
          ...point,
          relative: encodeRelativeTextPoint(
            createRelativePositionFromTypeIndex(
              text,
              index,
              options.assoc ?? 0,
            ),
          ),
        },
      };
    },
    decode(point) {
      if (!point.relative) return { ok: true, point };
      const decoded = decodeYjsRelativeTextPointOffset(context, point.relative);
      return decoded.ok
        ? { ok: true, point: { ...point, offset: decoded.offset } }
        : { ...decoded, point };
    },
  };
}

function canonicalOffsetToYjsIndexFromText(
  text: string,
  offset: number,
): number | null {
  if (!Number.isSafeInteger(offset) || offset < 0) return null;
  let canonicalOffset = 0;
  let yjsIndex = 0;
  for (const character of text) {
    if (canonicalOffset === offset) return yjsIndex;
    canonicalOffset += 1;
    yjsIndex += character.length;
  }
  return canonicalOffset === offset ? yjsIndex : null;
}

function hasHighSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) return true;
  }
  return false;
}

export function decodeYjsRelativeTextPointOffset(
  context: EditorYjsFragmentContext,
  relative: RelativeTextPoint,
): YjsRelativeTextPointOffsetDecodeResult {
  const text = readCanonicalYjsTextType(context);
  if (!text) return { ok: false, reason: "missing-content" };
  const decoded = decodeRelativeTextPoint(relative);
  if (!decoded) return { ok: false, reason: "invalid-relative-position" };
  const absolute = createAbsolutePositionFromRelativePosition(
    decoded,
    context.doc,
  );
  if (!absolute || absolute.type !== text) {
    return { ok: false, reason: "unmapped-position" };
  }
  const offset = yjsIndexToCanonicalOffset(text, absolute.index);
  return offset === null
    ? { ok: false, reason: "unmapped-position" }
    : { ok: true, offset };
}
