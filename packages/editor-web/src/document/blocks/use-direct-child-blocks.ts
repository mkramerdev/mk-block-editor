"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorRenderPort } from "../../runtime/document/render-port.ts";

/**
 * Subscribes to one semantic direct-child sequence and the block records in it.
 * The returned records preserve editor order and contain no rendering objects.
 */
export function useDirectChildBlocks(
  editor: EditorRenderPort,
  parentId: BlockId,
): readonly VersionedBlock[] {
  const childIds = useSyncExternalStore(
    (listener) => editor.subscribeChildBlockIds(parentId, listener),
    () => editor.getChildBlockIds(parentId),
    () => editor.getChildBlockIds(parentId),
  );
  const childIdentity = childIds.join("\u0000");
  const subscribe = useCallback(
    (listener: () => void) => {
      const releases = childIds.map((childId) =>
        editor.subscribeBlock(childId, listener),
      );
      return () => releases.forEach((release) => release());
    },
    // Sequence changes update childIdentity and rebuild this callback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [childIdentity, editor],
  );
  const blockRevision = useSyncExternalStore(
    subscribe,
    () => directChildBlockRevision(editor, childIds),
    () => directChildBlockRevision(editor, childIds),
  );
  return useMemo(
    () =>
      childIds.flatMap((childId) => {
        const block = editor.getBlock(childId);
        return block &&
          !block.tombstone &&
          (block.parentId ?? null) === parentId
          ? [block]
          : [];
      }),
    // blockRevision represents the subscribed record state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [blockRevision, childIdentity, editor, parentId],
  );
}

function directChildBlockRevision(
  editor: EditorRenderPort,
  childIds: readonly BlockId[],
): string {
  return childIds
    .map((childId) => {
      const block = editor.getBlock(childId);
      if (!block) return `${childId}:missing`;
      return [
        childId,
        block.parentId ?? "",
        block.type,
        block.metadataVersion,
        block.contentVersion ?? "",
        block.tombstone?.deletedAt ?? "",
      ].join(":");
    })
    .join("\u0000");
}
