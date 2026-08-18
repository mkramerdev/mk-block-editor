import type { BlockId } from "@repo/editor-core/kernel";
import type {
  EditorLogicalSelectionPoint,
  EditorSelectionFailure,
  EditorSelectionTextAnchor,
  EditorSelectionTextAnchorPayload,
  EditorSelectionTextAnchorResolutionResult,
  EditorSelectionTextAnchorResolver,
} from "../model/types.ts";
import type { EditorSelectionGraphReader } from "../graph/reader.ts";
import { readEditorBlockSelectionTarget } from "../graph/reader.ts";

export type CreateEditorSelectionTextAnchorResult =
  | { ok: true; textAnchor: EditorSelectionTextAnchor }
  | EditorSelectionFailure;

export function createEditorSelectionTextAnchor(input: {
  readonly codec: string;
  readonly payload: EditorSelectionTextAnchorPayload;
}): CreateEditorSelectionTextAnchorResult {
  const validation = validateEditorSelectionTextAnchorPayload(
    input.codec,
    input.payload,
  );
  if (!validation.ok) return validation;
  return {
    ok: true,
    textAnchor: Object.freeze({
      kind: "block-relative-text",
      codec: input.codec,
      version: 1,
      payload: Object.freeze({
        encoded: input.payload.encoded,
        ...(input.payload.assoc === undefined
          ? {}
          : { assoc: input.payload.assoc }),
      }),
    }),
  };
}

export function isEditorSelectionTextAnchor(
  value: unknown,
): value is EditorSelectionTextAnchor {
  return validateEditorSelectionTextAnchor(value).ok;
}

export function validateEditorSelectionTextAnchor(
  value: unknown,
): CreateEditorSelectionTextAnchorResult {
  if (!isObject(value)) return invalidAnchor("text anchor must be an object");
  if (value.kind !== "block-relative-text")
    return invalidAnchor("text anchor kind is unsupported");
  if (value.version !== 1)
    return invalidAnchor("text anchor version is unsupported");
  if (!isObject(value.payload))
    return invalidAnchor("text anchor payload must be an object");
  return createEditorSelectionTextAnchor({
    codec: value.codec as string,
    payload: value.payload as unknown as EditorSelectionTextAnchorPayload,
  });
}

export function resolveEditorSelectionTextAnchorPoint(
  point: EditorLogicalSelectionPoint,
  graph: EditorSelectionGraphReader,
  resolver: EditorSelectionTextAnchorResolver,
): EditorSelectionTextAnchorResolutionResult {
  const target = readEditorBlockSelectionTarget(graph, point.blockId);
  if (!target) return anchorResolutionFailure("missing-block", point.blockId);
  if (target.selection.projection.endpoint.kind !== "content") {
    return anchorResolutionFailure("unsupported-block-type", point.blockId);
  }

  const anchorValidation = validateEditorSelectionTextAnchor(point.textAnchor);
  if (!anchorValidation.ok) {
    return {
      ...anchorValidation,
      blockId: point.blockId,
    };
  }
  const resolved = resolver.resolveTextAnchor({
    ...point,
    blockType: target.block.type,
    blockCategory: target.category,
    textOffset: normalizeTextOffset(point.textOffset),
    textAnchor: anchorValidation.textAnchor,
    affinity: point.affinity,
  });
  if (!resolved.ok) return resolved;

  return {
    ...resolved,
    blockId: point.blockId,
    textAnchor: anchorValidation.textAnchor,
    textOffset: normalizeTextOffset(resolved.textOffset),
    affinity: resolved.affinity,
  };
}

export function anchorResolutionFailure(
  reason: EditorSelectionFailure["reason"],
  blockId?: BlockId,
  message?: string,
): EditorSelectionFailure {
  return {
    ok: false,
    reason,
    ...(blockId === undefined ? {} : { blockId }),
    ...(message === undefined ? {} : { message }),
  };
}

function validateEditorSelectionTextAnchorPayload(
  codec: string,
  payload: EditorSelectionTextAnchorPayload,
): CreateEditorSelectionTextAnchorResult {
  if (typeof codec !== "string" || !/^[a-z][a-z0-9.-]{0,127}$/u.test(codec)) {
    return invalidAnchor("text anchor codec is invalid");
  }
  if (!isObject(payload))
    return invalidAnchor("text anchor payload must be an object");
  if (typeof payload.encoded !== "string" || payload.encoded.length === 0) {
    return invalidAnchor("text anchor payload encoded value is empty");
  }
  if (!isBase64(payload.encoded))
    return invalidAnchor("text anchor payload encoded value is corrupt");
  if (
    payload.assoc !== undefined &&
    payload.assoc !== -1 &&
    payload.assoc !== 0 &&
    payload.assoc !== 1
  ) {
    return invalidAnchor("text anchor payload assoc is invalid");
  }
  return {
    ok: true,
    textAnchor: {
      kind: "block-relative-text",
      codec,
      version: 1,
      payload,
    },
  };
}

function invalidAnchor(message: string): EditorSelectionFailure {
  return anchorResolutionFailure("invalid", undefined, message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBase64(value: string): boolean {
  return value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

function normalizeTextOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}
