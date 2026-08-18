import type { InlineMarkDefinition } from "@repo/editor-core/content/marks";
import type { InlineMetadataFieldDefinition } from "@repo/editor-core/content/inline-atoms";
import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType, RelativeTextPoint } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorContentCheckpoint } from "@repo/editor-core/content/rich-text";
import type {
  EditorContentOperationUpdate,
  EditorOpaqueContentCheckpoint,
} from "@repo/editor-core/content/rich-text";
import type {
  AppliedContentCommit,
  EditorContentCommitPort,
} from "@repo/editor-core/operations";
import type { BlockContentDocContext } from "@repo/editor-yjs";

export type EditorRawBlockContent = RichTextDocumentNodeJson;

export interface EditorContentDataReconciliation {
  readonly blockGraphVersion: number;
  readonly blockIds: readonly BlockId[];
  readonly blockTypesById: Readonly<Record<BlockId, BlockType>>;
  readonly opaqueContentCheckpoints: Readonly<
    Partial<Record<BlockId, EditorOpaqueContentCheckpoint>>
  >;
  readonly contentById?: Readonly<
    Partial<Record<BlockId, EditorRawBlockContent>>
  >;
  readonly loadedAt: number;
}

export interface EditorContentRuntimeSource {
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly inlineMarks: readonly InlineMarkDefinition[];
  readonly inlineAtoms: readonly {
    readonly type: string;
    readonly metadata: Readonly<Record<string, InlineMetadataFieldDefinition>>;
  }[];
  readonly blockGraphVersion: number;
  readonly blockTypesById: Readonly<Record<BlockId, BlockType>>;
  readonly opaqueContentCheckpoints: Readonly<
    Partial<Record<BlockId, EditorOpaqueContentCheckpoint>>
  >;
  readonly contentById?: Readonly<
    Partial<Record<BlockId, EditorRawBlockContent>>
  >;
}

export interface EditorExternalContentApplication {
  readonly blockGraphVersion: number;
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly update: EditorContentOperationUpdate;
  readonly readProjection: EditorRawBlockContent;
  readonly revision: number;
  readonly origin?: unknown;
}

export interface YjsBlockContentRuntime extends EditorContentCommitPort {
  readonly format: string;
  readonly operationVersion: number;
  acquireBlockContent(
    blockId: BlockId,
    blockType: BlockType,
    reason: BlockContentLeaseReason,
  ): BlockContentLease;
  readOpaqueBlockState(blockId: BlockId): EditorOpaqueContentCheckpoint | null;
  getLiveBlockContentCount(): number;
  reconcileContentData(data: EditorContentDataReconciliation): void;
  applyExternalContentUpdate(input: EditorExternalContentApplication): void;
  readBlockProjection(
    blockId: BlockId,
    blockType: BlockType,
  ): EditorRawBlockContent;
  readBlockContentCheckpoint(
    blockId: BlockId,
    blockType: BlockType,
  ): EditorContentCheckpoint;
  readBlockPlainText(blockId: BlockId, blockType: BlockType): string;
  createTextAnchorInContext(lease: BlockContentLease, input: {
    readonly textOffset: number;
    readonly affinity: "forward" | "backward" | null;
  }):
    | {
        readonly ok: true;
        readonly codec: string;
        readonly payload: RelativeTextPoint;
        readonly textOffset: number;
      }
    | {
        readonly ok: false;
        readonly reason: "invalid" | "missing-text";
        readonly message?: string;
      };
  tryCreateTextAnchorInLiveContext(input: {
    readonly blockId: BlockId;
    readonly blockType: BlockType;
    readonly textOffset: number;
    readonly affinity: "forward" | "backward" | null;
  }):
    | {
        readonly ok: true;
        readonly codec: string;
        readonly payload: RelativeTextPoint;
        readonly textOffset: number;
      }
    | {
        readonly ok: false;
        readonly reason: "invalid" | "missing-text" | "not-live";
        readonly message?: string;
      };
  resolveTextAnchorInContext(lease: BlockContentLease, input: {
    readonly codec: string;
    readonly payload: RelativeTextPoint;
  }):
    | { readonly ok: true; readonly textOffset: number }
    | {
        readonly ok: false;
        readonly reason: "invalid" | "missing-text";
        readonly message?: string;
      };
  tryResolveTextAnchorInLiveContext(input: {
    readonly blockId: BlockId;
    readonly blockType: BlockType;
    readonly codec: string;
    readonly payload: RelativeTextPoint;
  }):
    | { readonly ok: true; readonly textOffset: number }
    | {
        readonly ok: false;
        readonly reason: "invalid" | "missing-text" | "not-live";
        readonly message?: string;
      };
  subscribeBlockProjection(
    blockId: BlockId,
    listener: (commit?: AppliedContentCommit) => void,
  ): () => void;
  subscribeContentCommits(
    listener: (commit: AppliedContentCommit) => void,
  ): () => void;
  getConsistencyState(): "healthy" | "inconsistent";
  destroy(): void;
}

export type BlockContentLeaseReason =
  | "active-editing"
  | "canonical-transaction"
  | "history";

export interface BlockContentLease {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly reason: BlockContentLeaseReason;
  readonly context: BlockContentDocContext;
  release(): void;
}

export interface EditorContentStoreSlot {
  readonly format: string;
  createRuntime(options: {
    readonly source: EditorContentRuntimeSource;
  }): YjsBlockContentRuntime;
}
