import type {
  EditorBlockContentLease,
  EditorBlockContentLeaseReason,
  EditorContentRuntime,
} from "@repo/editor-core/content";
import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { BlockContentDocContext } from "@repo/editor-yjs";

export type BlockContentLeaseReason = EditorBlockContentLeaseReason;

export interface BlockContentLease extends EditorBlockContentLease {
  readonly context: BlockContentDocContext;
}

/** Yjs-specific observability layered over the generic core runtime. */
export interface YjsBlockContentRuntime extends EditorContentRuntime {
  acquireBlockContent(
    blockId: BlockId,
    blockType: BlockType,
    reason: EditorBlockContentLeaseReason,
  ): BlockContentLease;
  getLiveBlockContentCount(): number;
  getConsistencyState(): "healthy" | "inconsistent";
}

export type {
  EditorContentDataReconciliation,
  EditorContentRuntimeSource,
  EditorExternalContentApplication,
  EditorRawBlockContent,
} from "@repo/editor-core/content";
