import type { PointerEvent } from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import { FIRST_DRAFT_BLOCK_SHELL_SELECTOR } from "./block-hover-tracker.tsx";

export function delegateFirstDraftBlockHover(
  event: PointerEvent<HTMLElement>,
  delegatedBlockIds: ReadonlySet<BlockId>,
  semanticOwnerBlockId: BlockId,
  setHoveredBlockId: (blockId: BlockId | null) => void,
): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  const shell = target.closest<HTMLElement>(FIRST_DRAFT_BLOCK_SHELL_SELECTOR);
  const targetBlockId = shell?.dataset.editorBlockId as BlockId | undefined;
  if (!targetBlockId || !delegatedBlockIds.has(targetBlockId)) return false;
  setHoveredBlockId(semanticOwnerBlockId);
  event.stopPropagation();
  return true;
}
