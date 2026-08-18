import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import type { InlineMarkDefinition } from "@repo/editor-core/content/marks";
import type { InlineMetadataFieldDefinition } from "@repo/editor-core/content/inline-atoms";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type {
  AppliedContentCommit,
  ContentCommitRejection,
  EditorContentBaseToken,
  EditorContentCheckpoint,
  EditorContentOperationUpdate,
  EditorOpaqueContentCheckpoint,
  EditorContentCommitInput,
  EditorContentCommitPort,
  ValidatedContentCommit,
} from "@repo/editor-react/editor";
import { localBlockContentStore } from "../../content/local/runtime.ts";
import type {
  EditorSelectionTextAffinity,
  EditorSelectionTextAnchorPayload,
} from "@repo/editor-react/selection";

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

export interface EditorContentStoreSlot {
  readonly format: string;
  createRuntime(
    options: EditorContentStoreRuntimeOptions,
  ): EditorContentRuntime;
}

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
      readonly payload: EditorSelectionTextAnchorPayload;
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

export interface EditorExternalContentApplication {
  readonly blockGraphVersion: number;
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly update: EditorContentOperationUpdate;
  readonly readProjection: EditorRawBlockContent;
  readonly revision: number;
  readonly origin?: unknown;
}

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
  createTextAnchorInContext(lease: EditorBlockContentLease, input: {
    readonly textOffset: number;
    readonly affinity: EditorSelectionTextAffinity | null;
  }): EditorContentTextAnchorCreateResult;
  tryCreateTextAnchorInLiveContext(input: {
    readonly blockId: BlockId;
    readonly blockType: BlockType;
    readonly textOffset: number;
    readonly affinity: EditorSelectionTextAffinity | null;
  }): EditorContentTextAnchorCreateResult | { readonly ok: false; readonly reason: "not-live" };
  resolveTextAnchorInContext(lease: EditorBlockContentLease, input: {
    readonly codec: string;
    readonly payload: EditorSelectionTextAnchorPayload;
  }): EditorContentTextAnchorResolveResult;
  tryResolveTextAnchorInLiveContext(input: {
    readonly blockId: BlockId;
    readonly blockType: BlockType;
    readonly codec: string;
    readonly payload: EditorSelectionTextAnchorPayload;
  }): EditorLiveTextAnchorResolveResult;
  subscribeBlockProjection(
    blockId: BlockId,
    listener: (commit?: AppliedContentCommit) => void,
  ): () => void;
  subscribeContentCommits(
    listener: (commit: AppliedContentCommit) => void,
  ): () => void;
  destroy(): void;
}

export type EditorWebContentRuntime = EditorContentRuntime;

export function createEditorContentRuntime(
  source: EditorContentRuntimeSource,
): EditorContentRuntime {
  return localBlockContentStore.createRuntime({ source });
}

export type {
  AppliedContentCommit,
  ContentCommitRejection,
  EditorContentBaseToken,
  EditorContentCheckpoint,
  EditorOpaqueContentCheckpoint,
  EditorContentCommitInput,
  ValidatedContentCommit,
};
