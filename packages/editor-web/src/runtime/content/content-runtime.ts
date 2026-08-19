import type {
  EditorContentRuntime,
  EditorContentRuntimeSource,
} from "@repo/editor-core/content";
import { localBlockContentStore } from "../../content/local/runtime.ts";

/** Compatibility name for consumers of the web block-renderer surface. */
export type EditorWebContentRuntime = EditorContentRuntime;

export function createEditorContentRuntime(
  source: EditorContentRuntimeSource,
): EditorContentRuntime {
  return localBlockContentStore.createRuntime({ source });
}

export type {
  EditorBlockContentLease,
  EditorBlockContentLeaseReason,
  EditorContentDataReconciliation,
  EditorContentRuntime,
  EditorContentRuntimeSource,
  EditorContentStoreRuntimeOptions,
  EditorContentStoreSlot,
  EditorContentTextAffinity,
  EditorContentTextAnchorCreateResult,
  EditorContentTextAnchorResolveResult,
  EditorExternalContentApplication,
  EditorLiveTextAnchorResolveResult,
  EditorRawBlockContent,
} from "@repo/editor-core/content";
export type {
  AppliedContentCommit,
  ContentCommitRejection,
  EditorContentBaseToken,
  EditorContentCommitInput,
  ValidatedContentCommit,
} from "@repo/editor-core/operations";
export type {
  EditorContentCheckpoint,
  EditorOpaqueContentCheckpoint,
} from "@repo/editor-core/content/rich-text";
