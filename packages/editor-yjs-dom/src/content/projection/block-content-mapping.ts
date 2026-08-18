import type { BlockId } from "@repo/editor-core/kernel";
import {
  readCanonicalYjsBlockContent,
  readCanonicalYjsBlockPlainText,
  applyBlockContentUpdate,
  createBlockContentDocContext,
  type EditorYjsFragmentContext,
} from "@repo/editor-yjs";

export function readYjsBlockContentDocument(
  context: EditorYjsFragmentContext,
): Record<string, unknown> | null {
  return readCanonicalYjsBlockContent(context);
}

export function readYjsBlockContentDocumentFromUpdates(
  blockId: BlockId,
  updates: readonly Uint8Array[],
): Record<string, unknown> | null {
  const context = createBlockContentDocContext({ blockId });
  try {
    for (const update of updates) applyBlockContentUpdate(context, update);
    return readCanonicalYjsBlockContent(context);
  } finally {
    context.destroy();
  }
}

export function readYjsBlockContentPlainText(
  context: EditorYjsFragmentContext,
): string {
  return readCanonicalYjsBlockPlainText(context);
}
