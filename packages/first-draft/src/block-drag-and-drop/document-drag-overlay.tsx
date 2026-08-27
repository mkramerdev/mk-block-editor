import type { CSSProperties } from "react";
import type { FirstDraftBlockDragPreviewNode } from "./document-drag-overlay-contracts.ts";
import { renderFirstDraftDocumentBlockDragPreviewNode } from "./document-drag-overlay-renderers.tsx";

export function FirstDraftDocumentBlockDragPreview({
  snapshot,
  style,
}: {
  readonly snapshot: FirstDraftBlockDragPreviewNode;
  readonly style?: CSSProperties;
}) {
  return (
    <div
      className="first-draft-document-block-drag-overlay"
      aria-hidden="true"
      inert
      style={style}
    >
      {renderFirstDraftDocumentBlockDragPreviewNode(snapshot, true)}
    </div>
  );
}
