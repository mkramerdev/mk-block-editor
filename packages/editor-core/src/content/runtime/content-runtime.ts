import type { InlineMetadataFieldDefinition } from "../inline-atoms/types.ts";
import type { InlineMarkDefinition } from "../marks/types.ts";
import type { RichTextDocumentNodeJson } from "../rich-text/rich-inline-types.ts";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import type { BlockType } from "../../document/model/block.ts";
import type { RelativeTextPoint } from "../../document/model/points.ts";
import type {
  EditorContentCheckpoint,
  EditorContentOperationUpdate,
  EditorOpaqueContentCheckpoint,
} from "../../kernel/content/encoded-content.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type {
  AppliedContentCommit,
  EditorContentCommitPort,
} from "../../operations/runtime/content-commit.ts";
import type { EditorOperationAnchor } from "../../operations/runtime/operation-replay.ts";

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

export interface EditorContentStoreRuntimeOptions {
  readonly source: EditorContentRuntimeSource;
}

export interface EditorContentStoreSlot<
  TRuntime extends EditorContentRuntime = EditorContentRuntime,
> {
  readonly format: string;
  createRuntime(options: EditorContentStoreRuntimeOptions): TRuntime;
}

export type EditorContentTextAffinity = "forward" | "backward";

export type EditorContentTextAnchorResolveResult =
  | { readonly ok: true; readonly textOffset: number }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "missing-text";
      readonly message?: string;
    };

export type EditorContentTextAnchorCreateResult =
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

export type EditorBlockContentLeaseReason =
  | "active-editing"
  | "canonical-transaction"
  | "history";

/** Explicit ownership of one hydrated independent block-content runtime. */
export interface EditorBlockContentLease {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly reason: EditorBlockContentLeaseReason;
  release(): void;
}

export type EditorLiveTextAnchorResolveResult =
  | EditorContentTextAnchorResolveResult
  | { readonly ok: false; readonly reason: "not-live" };

export type EditorOperationAnchorCreateResult =
  | { readonly ok: true; readonly anchor: EditorOperationAnchor }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "missing-text";
      readonly message?: string;
    };

export interface EditorExternalContentApplication {
  readonly blockGraphVersion: number;
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly update: EditorContentOperationUpdate;
  readonly readProjection: EditorRawBlockContent;
  readonly revision: number;
  readonly origin?: unknown;
}

/**
 * Dependency-neutral ownership contract for one editor's canonical block
 * content. Implementations own their mutable projections, leases, anchors,
 * checkpoints, and commit state.
 */
export interface EditorContentRuntime extends EditorContentCommitPort {
  readonly format: string;
  readonly operationVersion: number;
  acquireBlockContent(
    blockId: BlockId,
    blockType: BlockType,
    reason: EditorBlockContentLeaseReason,
  ): EditorBlockContentLease;
  readOpaqueBlockState(blockId: BlockId): EditorOpaqueContentCheckpoint | null;
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
  createTextAnchorInContext(
    lease: EditorBlockContentLease,
    input: {
      readonly textOffset: number;
      readonly affinity: EditorContentTextAffinity | null;
    },
  ): EditorContentTextAnchorCreateResult;
  createOperationAnchorInContext(
    lease: EditorBlockContentLease,
    input: { readonly textOffset: number; readonly association: -1 | 1 },
  ): EditorOperationAnchorCreateResult;
  tryCreateTextAnchorInLiveContext(input: {
    readonly blockId: BlockId;
    readonly blockType: BlockType;
    readonly textOffset: number;
    readonly affinity: EditorContentTextAffinity | null;
  }):
    | EditorContentTextAnchorCreateResult
    | { readonly ok: false; readonly reason: "not-live" };
  resolveTextAnchorInContext(
    lease: EditorBlockContentLease,
    input: {
      readonly codec: string;
      readonly payload: RelativeTextPoint;
    },
  ): EditorContentTextAnchorResolveResult;
  resolveOperationAnchorInContext(
    lease: EditorBlockContentLease,
    anchor: EditorOperationAnchor,
  ): EditorContentTextAnchorResolveResult;
  tryResolveTextAnchorInLiveContext(input: {
    readonly blockId: BlockId;
    readonly blockType: BlockType;
    readonly codec: string;
    readonly payload: RelativeTextPoint;
  }): EditorLiveTextAnchorResolveResult;
  subscribeBlockProjection(
    blockId: BlockId,
    listener: (commit?: AppliedContentCommit) => void,
  ): () => void;
  subscribeContentCommits(
    listener: (commit: AppliedContentCommit) => void,
  ): () => void;
  subscribeOperationAnchorInvalidation(listener: () => void): () => void;
  destroy(): void;
}
