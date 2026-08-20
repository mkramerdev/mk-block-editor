"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorRenderPort } from "../../runtime/document/render-port.ts";

/**
 * Subscribes to the runtime-owned direct-child block projection for one parent.
 */
export function useDirectChildBlocks(
  editor: EditorRenderPort,
  parentId: BlockId,
): readonly VersionedBlock[] {
  const subscribe = useCallback(
    (listener: () => void) =>
      editor.subscribeDirectChildBlocks(parentId, listener),
    [editor, parentId],
  );
  const getSnapshot = useCallback(
    () => editor.getDirectChildBlocks(parentId),
    [editor, parentId],
  );
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
