"use client";

import type { CSSProperties } from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import type { FirstDraftEditor } from "../first-draft-editor-contracts.ts";
import { FirstDraftBlockControlHoverZone } from "./block-control-hover-zone.tsx";
import {
  useFirstDraftEditingControlsEnabled,
  useIsHoveredFirstDraftBlock,
} from "./block-hover-provider.tsx";
import { FirstDraftIcon } from "../ui/icon.tsx";
import { gripVerticalIcon, plusIcon } from "../ui/icons.ts";

export const FIRST_DRAFT_BLOCK_CONTROL_OFFSETS = {
  paragraph: "1px",
  heading: {
    1: "36px",
    2: "14px",
    3: "0px",
    4: "0px",
    5: "0px",
    6: "0px",
  },
  quote: "22px",
  code: "1rem",
  listItem: "1px",
  checklist: "1px",
  callout: "36px",
  toggleHeading: "0.125rem",
  toggleList: "3px",
  tabs: "1rem",
  tabPane: "3px",
  placeholder: "3px",
  divider: "1rem",
  bookmark: "0px",
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
  readonly toggleHeading: CSSProperties["insetBlockStart"];
  readonly toggleList: CSSProperties["insetBlockStart"];
  readonly tabs: CSSProperties["insetBlockStart"];
  readonly tabPane: CSSProperties["insetBlockStart"];
  readonly placeholder: CSSProperties["insetBlockStart"];
  readonly divider: CSSProperties["insetBlockStart"];
  readonly bookmark: CSSProperties["insetBlockStart"];
  readonly table: CSSProperties["insetBlockStart"];
}>;

export type FirstDraftHeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

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
          const result = editor.insertBlock({
            blockId,
            blockType: "paragraph",
            selection: true,
          });
          if (result.ok) {
            presentCanonicalInsertedParagraph(
              editor,
              result.transaction.transaction.selection,
            );
            event.preventDefault();
            event.stopPropagation();
          }
        }}
      >
        <FirstDraftIcon aria-hidden="true" icon={plusIcon} />
      </button>
      <span
        className="first-draft-block-control-button first-draft-block-drag-handle"
        aria-hidden="true"
        draggable={false}
      >
        <FirstDraftIcon aria-hidden="true" icon={gripVerticalIcon} />
      </span>
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
  readonly editor: (FirstDraftBlockControlsEditor &
    Pick<FirstDraftEditor, "editable">) | null;
  readonly blockStartOffset?: CSSProperties["insetBlockStart"];
  readonly visible?: boolean;
}) {
  const active = useIsHoveredFirstDraftBlock(blockId);
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

type FirstDraftBlockControlsEditor = Pick<FirstDraftEditor, "insertBlock"> &
  Partial<Pick<FirstDraftEditor, "focusText" | "getBlock">>;

function presentCanonicalInsertedParagraph(
  editor: FirstDraftBlockControlsEditor,
  selection: {
    readonly kind: string;
    readonly blockId?: BlockId;
    readonly offset?: number;
  },
): void {
  if (
    selection.kind !== "text-offset" ||
    !selection.blockId ||
    editor.getBlock?.(selection.blockId)?.type !== "paragraph" ||
    !editor.focusText
  )
    return;
  editor.focusText(selection.blockId, {
    offset: selection.offset ?? 0,
    preventScroll: true,
  });
}
