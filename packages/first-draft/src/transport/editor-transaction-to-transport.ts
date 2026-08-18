import {
  EditorImmutableBinary,
  type EditorContentOperationUpdate,
} from "@repo/editor-core/content/rich-text";
import { cloneJsonValue } from "@repo/editor-core/kernel";
import type { EditorBlockContentChange } from "@repo/editor-web/document-runtime";
import type { EditorSemanticChange } from "@repo/editor-web/editor";
import type {
  EditorTransportBlockGraphChange,
  EditorTransportContentUpdate,
  EditorTransportTransaction,
} from "./transport-types.ts";
import {
  EDITOR_YJS_CONTENT_FORMAT,
  EDITOR_YJS_CONTENT_FORMAT_VERSION,
} from "@repo/editor-yjs/checkpoint-format";

/** Deterministically converts a committed local edit into First Draft transport data. */
export function convertEditorTransactionToTransport(
  transaction: EditorSemanticChange,
): EditorTransportTransaction {
  const graph =
    transaction.kind === "block-graph" ? graphDelta(transaction) : null;
  const metadata =
    transaction.kind === "block-metadata"
      ? cloneJsonValue(transaction.canonicalOperation)
      : null;
  const contentChanges =
    transaction.kind === "block-content"
      ? [
          {
            kind: "block-content" as const,
            blockId: transaction.blockId,
            blockType: transaction.blockType,
            operations: transaction.operations,
            update: transaction.yjsUpdate,
            readProjection: transaction.readProjection,
          },
        ]
      : transaction.kind === "block-graph"
        ? transaction.contentChanges
        : [];

  return Object.freeze({
    transactionId: transaction.transactionId,
    historyAction: transaction.historyAction,
    graph,
    metadata,
    content: Object.freeze(
      contentChanges.map((entry) => contentUpdate(transaction, entry)),
    ),
  });
}

function contentUpdate(
  _transaction: EditorSemanticChange,
  entry: EditorBlockContentChange<EditorContentOperationUpdate>,
): EditorTransportContentUpdate {
  const update = entry.update;
  if (
    update.kind !== "operation" ||
    update.format !== EDITOR_YJS_CONTENT_FORMAT ||
    update.version !== EDITOR_YJS_CONTENT_FORMAT_VERSION ||
    !(update.payload instanceof EditorImmutableBinary) ||
    update.payload.byteLength === 0
  ) {
    throw new Error(
      `Content transaction for ${entry.blockId} requires a transport-safe Yjs operation`,
    );
  }
  return Object.freeze({
    blockId: entry.blockId,
    blockType: entry.blockType,
    update,
    readProjection: entry.readProjection,
  });
}

function graphDelta(
  transaction: Extract<EditorSemanticChange, { readonly kind: "block-graph" }>,
): { readonly changes: readonly EditorTransportBlockGraphChange[] } | null {
  const changes: EditorTransportBlockGraphChange[] =
    transaction.graphChanges.map((change) =>
      change.kind === "create" && change.initialMetadata
        ? {
            ...change,
            initialMetadata: cloneJsonValue(change.initialMetadata),
          }
        : change,
    );
  return changes.length === 0
    ? null
    : Object.freeze({ changes: Object.freeze(changes) });
}
