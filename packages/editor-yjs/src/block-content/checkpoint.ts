import type { BlockId } from "@repo/editor-core/kernel";
import {
  EditorImmutableBinary,
  type EditorContentCheckpoint,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import { createBlockContentDocContext } from "./doc/context.ts";
import { ensureCanonicalYjsBlockContent } from "./canonical-rich-text.ts";
import { encodeBlockContentUpdate } from "../updates/encode-update.ts";

export {
  EDITOR_YJS_CONTENT_FORMAT,
  EDITOR_YJS_CONTENT_FORMAT_VERSION,
} from "./checkpoint-format.ts";
import {
  EDITOR_YJS_CONTENT_FORMAT,
  EDITOR_YJS_CONTENT_FORMAT_VERSION,
} from "./checkpoint-format.ts";

const CHECKPOINT_ORIGIN = Object.freeze({
  kind: "canonical-yjs-content-checkpoint",
});

export function createYjsBlockContentCheckpoint(
  blockId: BlockId,
  content: RichTextDocumentNodeJson,
): EditorContentCheckpoint {
  const context = createBlockContentDocContext({ blockId });
  try {
    ensureCanonicalYjsBlockContent(context, content, CHECKPOINT_ORIGIN);
    return Object.freeze({
      kind: "checkpoint",
      format: EDITOR_YJS_CONTENT_FORMAT,
      version: EDITOR_YJS_CONTENT_FORMAT_VERSION,
      payload: EditorImmutableBinary.takeOwnership(
        encodeBlockContentUpdate(context),
      ),
    });
  } finally {
    context.destroy();
  }
}
