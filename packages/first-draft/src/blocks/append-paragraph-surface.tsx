"use client";

import {
  useCallback,
  useSyncExternalStore,
  type MouseEvent,
} from "react";
import { richTextDocumentContentSize } from "@repo/editor-core/content/rich-text";
import type { BlockId } from "@repo/editor-core/kernel";
import { useFirstDraftEditingControlsEnabled } from "../block-controls/index.ts";
import type { FirstDraftEditor } from "../first-draft-editor-contracts.ts";

const subscribeToNothing = () => () => undefined;

export function FirstDraftAppendParagraphSurface({
  editor,
  parentId,
  scope,
  ariaLabel,
}: {
  readonly editor: FirstDraftEditor;
  readonly parentId: BlockId | null;
  readonly scope: "root" | "column";
  readonly ariaLabel: string;
}) {
  const editingEnabled = useFirstDraftEditingControlsEnabled();
  const subscribeDirectChildren = useCallback(
    (listener: () => void) =>
      parentId === null
        ? editor.subscribeRootBlockIds(listener)
        : editor.subscribeChildBlockIds(parentId, listener),
    [editor, parentId],
  );
  const readDirectChildren = useCallback(
    () =>
      parentId === null
        ? editor.getRootBlockIds()
        : editor.getChildBlockIds(parentId),
    [editor, parentId],
  );
  const directChildIds = useSyncExternalStore(
    subscribeDirectChildren,
    readDirectChildren,
    readDirectChildren,
  );
  const lastChildId = directChildIds[directChildIds.length - 1] ?? null;
  const subscribeLastChild = useCallback(
    (listener: () => void) =>
      lastChildId === null
        ? subscribeToNothing()
        : editor.subscribeBlock(lastChildId, listener),
    [editor, lastChildId],
  );
  const readLastChild = useCallback(
    () => (lastChildId === null ? null : editor.getBlock(lastChildId)),
    [editor, lastChildId],
  );
  const lastChild = useSyncExternalStore(
    subscribeLastChild,
    readLastChild,
    readLastChild,
  );

  const activate = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!editingEnabled || !editor.editable) return;

      const liveDirectChildIds =
        parentId === null
          ? editor.getRootBlockIds()
          : editor.getChildBlockIds(parentId);
      const liveLastChildId =
        liveDirectChildIds[liveDirectChildIds.length - 1] ?? null;
      if (liveLastChildId !== null) {
        const liveLastChild = editor.getBlock(liveLastChildId);
        if (!liveLastChild || liveLastChild.parentId !== parentId) return;
        if (liveLastChild.type === "paragraph") {
          const content = editor.readBlockContent(
            liveLastChild.id,
            liveLastChild.type,
          );
          if (!content) return;
          if (richTextDocumentContentSize(content) === 0) {
            editor.focusText(liveLastChild.id, {
              offset: 0,
              preventScroll: true,
            });
            return;
          }
        }
      }

      const result = editor.insertBlockAt({
        placement: {
          parentId,
          childIndex: liveDirectChildIds.length,
        },
        blockType: "paragraph",
        selection: true,
      });
      if (!result.ok) return;
      const selection = result.transaction.transaction.selection;
      if (
        selection.kind !== "text-offset" ||
        editor.getBlock(selection.blockId)?.type !== "paragraph"
      )
        return;
      editor.focusText(selection.blockId, {
        offset: selection.offset,
        preventScroll: true,
      });
    },
    [editingEnabled, editor, parentId],
  );

  return (
    <button
      type="button"
      className="first-draft-append-paragraph-surface"
      aria-label={ariaLabel}
      tabIndex={-1}
      data-editor-ui="true"
      data-editor-preserve-selection="true"
      data-first-draft-append-paragraph-surface="true"
      data-scope={scope}
      data-first-draft-append-after={lastChild?.id ?? ""}
      disabled={!editingEnabled || !editor.editable}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={activate}
    />
  );
}
