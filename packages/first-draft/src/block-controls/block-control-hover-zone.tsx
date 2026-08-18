import type { BlockId } from "@repo/editor-core/kernel";

export function FirstDraftBlockControlHoverZone({
  blockId,
  editable,
}: {
  readonly blockId: BlockId;
  readonly editable: boolean;
}) {
  if (!editable) return null;
  return (
    <div
      className="first-draft-block-control-hover-zone"
      data-first-draft-block-hover-zone-for={blockId}
      data-editor-ui="true"
      aria-hidden="true"
    />
  );
}
