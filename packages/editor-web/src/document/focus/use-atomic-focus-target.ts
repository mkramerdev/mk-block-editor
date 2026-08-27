"use client";

import { useCallback } from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditableEditor } from "../../runtime/document/contracts.ts";
import { resolveEditorRuntimePort } from "../../runtime/document/runtime-port-registry.ts";

/** Registers one exact product-owned atomic element as a native focus target. */
export function useEditorAtomicFocusTarget(
  editor: EditableEditor,
  blockId: BlockId,
): (target: HTMLElement | null) => (() => void) | undefined {
  const runtime = resolveEditorRuntimePort(editor);
  return useCallback(
    (target: HTMLElement | null) =>
      target && runtime
        ? runtime.registerAtomicFocusTarget(blockId, target)
        : undefined,
    [blockId, runtime],
  );
}
