"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import type { FirstDraftEditor } from "../first-draft-editor-contracts.ts";

export function EmptyWrapperAddTextControl({
  editor,
  wrapperId,
}: {
  readonly editor: FirstDraftEditor;
  readonly wrapperId: BlockId;
}) {
  const [executing, setExecuting] = useState(false);
  const settling = useRef(false);
  const subscribe = useCallback(
    (listener: () => void) =>
      editor.subscribeChildBlockIds(wrapperId, listener),
    [editor, wrapperId],
  );
  const readChildren = useCallback(
    () => editor.getChildBlockIds(wrapperId),
    [editor, wrapperId],
  );
  const childIds = useSyncExternalStore(subscribe, readChildren, readChildren);

  if (!editor.editable || childIds.length > 0) return null;

  return (
    <button
      type="button"
      className="empty-wrapper-add-text-button"
      aria-label="Add paragraph"
      disabled={executing}
      data-editor-ui="true"
      data-editor-preserve-selection="true"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        if (settling.current) return;
        settling.current = true;
        setExecuting(true);
        const result = editor.insertBlockAt({
          placement: { parentId: wrapperId, childIndex: 0 },
          blockType: "paragraph",
          selection: true,
        });
        if (!result.ok) {
          settling.current = false;
          setExecuting(false);
          return;
        }
        const paragraphId = editor.getChildBlockIds(wrapperId)[0];
        if (paragraphId) {
          editor.focusText(paragraphId, { offset: 0, preventScroll: true });
        }
      }}
    >
      + Add text
    </button>
  );
}
