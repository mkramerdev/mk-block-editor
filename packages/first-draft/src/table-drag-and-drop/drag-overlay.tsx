"use client";

import type { DragState } from "@mk-drag-and-drop/react";
import { Ellipsis } from "lucide-react";
import {
  TABLE_COLUMN_DND_GROUP,
  TABLE_ROW_DND_GROUP,
  type FirstDraftTableDragStore,
} from "./contracts.ts";
import { FirstDraftCapturedTableCellPresentation } from "./preview-cell.tsx";

export function FirstDraftTableDragOverlay({
  dragState,
  store,
}: {
  readonly dragState: DragState;
  readonly store: FirstDraftTableDragStore;
}) {
  const session = store.getSnapshot().session;
  if (
    dragState.group === TABLE_COLUMN_DND_GROUP &&
    session?.axis === "column" &&
    session.sourceDragId === dragState.draggableId
  ) {
    return (
      <div
        className="first-draft-table-drag-overlay table-block__column-drag-overlay"
        aria-hidden="true"
        inert
        style={{
          width: session.sourceRect.width,
          height: session.sourceRect.height,
        }}
      >
        <div
          className="table-block__column-drag-overlay-body"
          style={{
            gridTemplateColumns: `${session.preview.columnWidth}px`,
            gridTemplateRows: session.preview.rowHeights
              .map((height) => `${height}px`)
              .join(" "),
          }}
        >
          {session.preview.cells.map((cell) => (
            <FirstDraftCapturedTableCellPresentation
              key={cell.block.id}
              block={cell.block}
              content={cell.content}
              rootAttributes={{
                "data-first-draft-table-drag-preview-cell": cell.block.id,
              }}
            />
          ))}
        </div>
        <span className="table-block__column-drag-overlay-trigger">
          <Ellipsis aria-hidden="true" />
        </span>
      </div>
    );
  }
  if (
    dragState.group !== TABLE_ROW_DND_GROUP ||
    session?.axis !== "row" ||
    session.sourceRowId !== dragState.draggableId
  ) {
    return null;
  }
  return (
    <div
      className="first-draft-table-drag-overlay table-block__row-drag-overlay"
      aria-hidden="true"
      inert
      style={{
        width: session.sourceRect.width,
        height: session.sourceRect.height,
      }}
  >
      <div
        className="table-block__row-drag-overlay-body"
        style={{ gridTemplateColumns: session.preview.tracks }}
      >
        {session.preview.cells.map((cell) => (
          <FirstDraftCapturedTableCellPresentation
            key={cell.block.id}
            block={cell.block}
            content={cell.content}
            rootAttributes={{
              "data-first-draft-table-drag-preview-cell": cell.block.id,
            }}
          />
        ))}
      </div>
      <span className="table-block__row-drag-overlay-trigger">
        <Ellipsis aria-hidden="true" />
      </span>
    </div>
  );
}
