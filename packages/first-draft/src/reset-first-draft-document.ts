import {
  reidentifyCanonicalBlockFragment,
  type CanonicalBlockFragment,
} from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import { firstDraftBlockModelDefinitions } from "./server/block-definitions.ts";
import { createFirstDraftDocumentTemplate } from "./first-draft-document-template.ts";
import type { FirstDraftResetEditor } from "./first-draft-editor-contracts.ts";
import { createFirstDraftBlockIdAllocator } from "./identity/block-id-allocator.ts";

export type ResetFirstDraftDocumentResult =
  | {
      readonly ok: true;
      readonly previousBlockIds: readonly BlockId[];
      readonly fragment: CanonicalBlockFragment;
    }
  | {
      readonly ok: false;
      readonly message: string;
    };

/** Replaces the live graph as one ordinary, undoable editor transaction. */
export function resetFirstDraftDocument(
  editor: FirstDraftResetEditor,
  options: { readonly createBlockId?: () => BlockId } = {},
): ResetFirstDraftDocumentResult {
  try {
    const previousSnapshot = editor.readSnapshot();
    const previousRootIds = [...editor.getRootBlockIds()];
    const previousBlockIds = Object.keys(previousSnapshot.blocks) as BlockId[];
    const template = createFirstDraftDocumentTemplate();
    const fragment = reidentifyCanonicalBlockFragment({
      fragment: template,
      allocateBlockId: createFirstDraftBlockIdAllocator(editor, {
        ...(options.createBlockId
          ? { createId: options.createBlockId }
          : {}),
        reservedBlockIds: new Set(template.blocks.map((block) => block.id)),
        purpose: "First Draft document reset",
      }),
      blockDefinitions: firstDraftBlockModelDefinitions,
    });
    const firstTextBlock = fragment.blocks.find(
      (block) => block.content !== undefined,
    );
    if (!firstTextBlock) {
      return { ok: false, message: "The default document has no text block." };
    }

    const result = editor.transaction(() => {
      editor.insertBlocks(
        { parentId: null, childIndex: previousRootIds.length },
        fragment,
      );
      if (previousRootIds.length > 0) {
        editor.deleteBlocks({
          blockIds: previousRootIds,
          includeDescendants: true,
          expectedParents: Object.fromEntries(
            previousRootIds.map((blockId) => [blockId, null]),
          ),
        });
      }
      editor.setTransactionSelection({
        kind: "text",
        blockId: firstTextBlock.id,
        offset: 0,
      });
    });

    if (!result.ok) return { ok: false, message: result.message };
    if (!result.changed) {
      return { ok: false, message: "The reset did not change the document." };
    }
    return { ok: true, previousBlockIds, fragment };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
