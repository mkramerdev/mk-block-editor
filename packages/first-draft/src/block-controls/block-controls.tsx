"use client";

import { useRef, type CSSProperties } from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import { useDraggable } from "@mk-drag-and-drop/react";
import type { FirstDraftEditor } from "../first-draft-editor-contracts.ts";
import { FirstDraftBlockControlHoverZone } from "./block-control-hover-zone.tsx";
import {
  useFirstDraftEditingControlsEnabled,
  useIsHoveredFirstDraftBlock,
} from "./block-hover-provider.tsx";
import { FirstDraftIcon } from "../ui/icon.tsx";
import { gripVerticalIcon, plusIcon } from "../ui/icons.ts";
import { EDITOR_BLOCK_DND_GROUP } from "../block-drag-and-drop/stable-anchors.tsx";
import type { FirstDraftHeadingLevel } from "../heading-level.ts";
import {
  insertFirstDraftAdjacentParagraph,
  presentFirstDraftBlockOperationSelection,
} from "../block-operations/adjacent-paragraph.ts";
import {
  useFirstDraftBlockActionMenuSnapshot,
  useFirstDraftBlockActionMenuStore,
} from "../block-action-menu/index.ts";

export const FIRST_DRAFT_BLOCK_CONTROL_OFFSETS = {
  paragraph: "4px",
  heading: {
    1: "36px",
    2: "18px",
    3: "13px",
  },
  quote: "22px",
  code: "2rem",
  listItem: "1px",
  checklist: "1px",
  callout: "32px",
  toggleHeading: {
    1: "36px",
    2: "18px",
    3: "13px",
  },
  toggleList: "8px",
  tabs: "1.5rem",
  tabPane: "3px",
  divider: "18px",
  table: "0px",
} as const satisfies Readonly<{
  readonly paragraph: CSSProperties["insetBlockStart"];
  readonly heading: Readonly<
    Record<FirstDraftHeadingLevel, CSSProperties["insetBlockStart"]>
  >;
  readonly quote: CSSProperties["insetBlockStart"];
  readonly code: CSSProperties["insetBlockStart"];
  readonly listItem: CSSProperties["insetBlockStart"];
  readonly checklist: CSSProperties["insetBlockStart"];
  readonly callout: CSSProperties["insetBlockStart"];
  readonly toggleHeading: Readonly<
    Record<FirstDraftHeadingLevel, CSSProperties["insetBlockStart"]>
  >;
  readonly toggleList: CSSProperties["insetBlockStart"];
  readonly tabs: CSSProperties["insetBlockStart"];
  readonly tabPane: CSSProperties["insetBlockStart"];
  readonly divider: CSSProperties["insetBlockStart"];
  readonly table: CSSProperties["insetBlockStart"];
}>;

type FirstDraftBlockControlsStyle = CSSProperties & {
  readonly "--first-draft-block-controls-inset-block-start": CSSProperties["insetBlockStart"];
};

export function FirstDraftBlockControls({
  blockId,
  editor,
  blockStartOffset,
}: {
  readonly blockId: BlockId;
  readonly editor: FirstDraftBlockControlsEditor;
  readonly blockStartOffset?: CSSProperties["insetBlockStart"];
}) {
  const enabled = useFirstDraftEditingControlsEnabled();
  if (!enabled) return null;
  const style: FirstDraftBlockControlsStyle | undefined =
    blockStartOffset === undefined
      ? undefined
      : ({
          "--first-draft-block-controls-inset-block-start": blockStartOffset,
        } satisfies FirstDraftBlockControlsStyle);
  return (
    <div
      className="first-draft-block-controls"
      data-first-draft-block-controls="true"
      data-first-draft-block-controls-for={blockId}
      data-editor-ui="true"
      style={style}
    >
      <button
        type="button"
        className="first-draft-block-control-button"
        aria-label="Add block below"
        tabIndex={-1}
        onMouseDown={(event) => {
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          const result = insertFirstDraftAdjacentParagraph(
            editor,
            blockId,
            "after",
          );
          if (result.ok) {
            presentFirstDraftBlockOperationSelection(editor, result);
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <FirstDraftIcon aria-hidden="true" icon={plusIcon} />
      </button>
      <FirstDraftBlockDragHandle blockId={blockId} />
    </div>
  );
}

export function FirstDraftBlockChrome({
  blockId,
  editor,
  blockStartOffset,
  visible = true,
}: {
  readonly blockId: BlockId;
  readonly editor:
    | (FirstDraftBlockControlsEditor & Pick<FirstDraftEditor, "editable">)
    | null;
  readonly blockStartOffset?: CSSProperties["insetBlockStart"];
  readonly visible?: boolean;
}) {
  const hovered = useIsHoveredFirstDraftBlock(blockId);
  const blockActionMenu = useFirstDraftBlockActionMenuSnapshot();
  const active =
    blockActionMenu.kind === "open"
      ? blockActionMenu.blockId === blockId
      : hovered;
  const enabled = visible && editor?.editable === true;
  return (
    <>
      <FirstDraftBlockControlHoverZone blockId={blockId} editable={enabled} />
      {enabled && active ? (
        <FirstDraftBlockControls
          blockId={blockId}
          editor={editor!}
          blockStartOffset={blockStartOffset}
        />
      ) : null}
    </>
  );
}

type FirstDraftBlockControlsEditor = FirstDraftEditor;

export function FirstDraftBlockDragHandle({
  blockId,
}: {
  readonly blockId: BlockId;
}) {
  const menuStore = useFirstDraftBlockActionMenuStore();
  const menu = useFirstDraftBlockActionMenuSnapshot();
  const open = menu.kind === "open" && menu.blockId === blockId;
  const suppressKeyboardClick = useRef(false);
  const draggable = useDraggable<HTMLButtonElement>({
    draggableId: blockId,
    group: EDITOR_BLOCK_DND_GROUP,
  });
  return (
    <button
      {...draggable}
      type="button"
      className="first-draft-block-control-button first-draft-block-drag-handle"
      aria-label="Drag block or open block actions"
      aria-haspopup="menu"
      aria-expanded={open}
      aria-controls={open ? menuStore.menuId : undefined}
      draggable={false}
      data-dnd-drag-handle="true"
      data-first-draft-draggable-block-id={blockId}
      data-editor-ui="true"
      onPointerDownCapture={(event) => {
        draggable.onPointerDownCapture?.(event);
        menuStore.clearSuppressedTriggerClick(blockId);
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (
          event.detail !== 0 &&
          menuStore.consumeSuppressedTriggerClick(blockId)
        ) {
          event.preventDefault();
          return;
        }
        if (suppressKeyboardClick.current && event.detail === 0) {
          suppressKeyboardClick.current = false;
          event.preventDefault();
          return;
        }
        menuStore.toggle({
          kind: "open",
          blockId,
          triggerElement: event.currentTarget,
          cause: "pointer",
        });
      }}
      onKeyDown={(event) => {
        if (
          event.key !== "Enter" &&
          event.key !== " " &&
          event.key !== "ArrowDown"
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        suppressKeyboardClick.current = true;
        queueMicrotask(() => {
          suppressKeyboardClick.current = false;
        });
        menuStore.open({
          kind: "open",
          blockId,
          triggerElement: event.currentTarget,
          cause: "keyboard",
        });
      }}
    >
      {/* The DOM runtime looks for a descendant marker before accepting the
          draggable button itself as its pointer handle. */}
      <span data-dnd-drag-handle="true" aria-hidden="true">
        <FirstDraftIcon aria-hidden="true" icon={gripVerticalIcon} />
      </span>
    </button>
  );
}
