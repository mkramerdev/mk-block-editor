import type { BlockId } from "@repo/editor-core/kernel";

export const EDITOR_BLOCK_INTERNAL_SELECTION_EXTEND_OUTSIDE_EVENT =
  "editor-block-internal-selection-extend-outside";

export interface EditorBlockInternalSelectionExtendOutsideDetail {
  readonly hostBlockId: BlockId;
  readonly pointerId: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly clientX: number;
  readonly clientY: number;
}

export function isEditorBlockInternalSelectionExtendOutsideDetail(
  value: unknown,
): value is EditorBlockInternalSelectionExtendOutsideDetail {
  if (!value || typeof value !== "object") return false;
  const candidate =
    value as Partial<EditorBlockInternalSelectionExtendOutsideDetail>;
  return (
    typeof candidate.hostBlockId === "string" &&
    typeof candidate.pointerId === "number" &&
    typeof candidate.startClientX === "number" &&
    typeof candidate.startClientY === "number" &&
    typeof candidate.clientX === "number" &&
    typeof candidate.clientY === "number"
  );
}
