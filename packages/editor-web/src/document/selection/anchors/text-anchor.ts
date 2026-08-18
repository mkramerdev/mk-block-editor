import type { BlockId } from "@repo/editor-core/kernel";
import type { BlockType } from "@repo/editor-core/document";
import {
  anchorResolutionFailure,
  createEditorSelectionTextAnchor,
  resolveEditorSelectionTextAnchorPoint,
  type EditorLogicalSelectionPoint,
  type EditorSelectionFailureReason,
  type EditorSelectionGraphReader,
  type EditorSelectionTextAffinity,
  type EditorSelectionTextAnchor,
  type EditorSelectionTextAnchorResolutionResult,
} from "@repo/editor-react/selection";
import type {
  EditorBlockContentLease,
  EditorWebContentRuntime,
} from "../../../runtime/content/content-runtime.ts";

export type CreateWebSelectionTextAnchorResult =
  | {
      ok: true;
      textAnchor: EditorSelectionTextAnchor;
      textOffset: number;
    }
  | {
      ok: false;
      reason: EditorSelectionFailureReason;
      blockId?: BlockId;
      message?: string;
    };

export interface CreateWebSelectionTextAnchorOptions {
  contentRuntime: EditorWebContentRuntime;
  contentLease?: EditorBlockContentLease;
  blockId: BlockId;
  blockType: BlockType;
  textOffset: number;
  affinity?: EditorSelectionTextAffinity | null;
}

export function createWebSelectionTextAnchorAtOffset({
  contentRuntime,
  contentLease,
  blockId,
  blockType,
  textOffset,
  affinity = null,
}: CreateWebSelectionTextAnchorOptions): CreateWebSelectionTextAnchorResult {
  const offset = normalizeTextOffset(textOffset);
  if (
    contentLease &&
    (contentLease.blockId !== blockId || contentLease.blockType !== blockType)
  ) {
    return { ok: false, reason: "invalid", blockId };
  }
  const created = contentLease
    ? contentRuntime.createTextAnchorInContext(contentLease, {
        textOffset: offset,
        affinity,
      })
    : contentRuntime.tryCreateTextAnchorInLiveContext({
        blockId,
        blockType,
        textOffset: offset,
        affinity,
      });
  if (!created.ok) {
    return created.reason === "not-live"
      ? {
          ok: false,
          reason: "missing-text",
          blockId,
          message: "Block content is not live",
        }
      : { ...created, blockId };
  }
  const anchor = createEditorSelectionTextAnchor({
    codec: created.codec,
    payload: created.payload,
  });
  if (!anchor.ok) {
    return {
      ...anchor,
      blockId,
    };
  }
  return {
    ok: true,
    textAnchor: anchor.textAnchor,
    textOffset: created.textOffset,
  };
}

export function resolveWebSelectionTextAnchorPoint(
  point: EditorLogicalSelectionPoint,
  graph: EditorSelectionGraphReader,
  contentRuntime: EditorWebContentRuntime,
  contentLease?: EditorBlockContentLease,
): EditorSelectionTextAnchorResolutionResult {
  return resolveEditorSelectionTextAnchorPoint(point, graph, {
    resolveTextAnchor: (normalizedPoint) => {
      const textAnchor = normalizedPoint.textAnchor;
      if (!textAnchor)
        return anchorResolutionFailure("invalid", normalizedPoint.blockId);
      if (
        contentLease &&
        (contentLease.blockId !== normalizedPoint.blockId ||
          contentLease.blockType !== normalizedPoint.blockType)
      ) {
        return anchorResolutionFailure("invalid", normalizedPoint.blockId);
      }
      const decoded = contentLease
        ? contentRuntime.resolveTextAnchorInContext(contentLease, {
            codec: textAnchor.codec,
            payload: textAnchor.payload,
          })
        : contentRuntime.tryResolveTextAnchorInLiveContext({
            blockId: normalizedPoint.blockId,
            blockType: normalizedPoint.blockType,
            codec: textAnchor.codec,
            payload: textAnchor.payload,
          });
      if (!decoded.ok) {
        return decoded.reason === "missing-text"
          ? missingTextFailure(normalizedPoint.blockId, decoded.message)
          : anchorResolutionFailure("invalid", normalizedPoint.blockId);
      }
      return {
        ok: true,
        blockId: normalizedPoint.blockId,
        textAnchor,
        textOffset: decoded.textOffset,
        affinity: normalizedPoint.affinity,
      };
    },
  });
}

function missingTextFailure(
  blockId: BlockId,
  message?: string,
): { ok: false; reason: "missing-text"; blockId: BlockId; message?: string } {
  return {
    ok: false,
    reason: "missing-text",
    blockId,
    ...(message === undefined ? {} : { message }),
  };
}

function normalizeTextOffset(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}
