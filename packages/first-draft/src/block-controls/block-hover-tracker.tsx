"use client";

import {
  useCallback,
  useEffect,
  type HTMLAttributes,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import { useFirstDraftBlockHoverStore } from "./block-hover-provider.tsx";

export const FIRST_DRAFT_BLOCK_SHELL_SELECTOR =
  '[data-editor-block-shell="true"][data-editor-block-id]';

export interface FirstDraftBlockHoverTrackerProps
  extends HTMLAttributes<HTMLDivElement> {
  readonly children: ReactNode;
}

export function FirstDraftBlockHoverTracker({
  children,
  onPointerLeave,
  onPointerMove,
  ...props
}: FirstDraftBlockHoverTrackerProps) {
  const store = useFirstDraftBlockHoverStore();
  const clear = useCallback(() => store.setHoveredBlockId(null), [store]);
  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      onPointerMove?.(event);
      const target = event.target;
      if (!(target instanceof Element)) {
        clear();
        return;
      }
      const shell = target.closest<HTMLElement>(
        FIRST_DRAFT_BLOCK_SHELL_SELECTOR,
      );
      if (!shell || !event.currentTarget.contains(shell)) {
        clear();
        return;
      }
      const blockId = shell.dataset.editorBlockId as BlockId | undefined;
      store.setHoveredBlockId(blockId?.length ? blockId : null);
    },
    [clear, onPointerMove, store],
  );
  const handlePointerLeave = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      onPointerLeave?.(event);
      clear();
    },
    [clear, onPointerLeave],
  );

  useEffect(() => {
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("blur", clear);
      clear();
    };
  }, [clear]);

  return (
    <div
      {...props}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {children}
    </div>
  );
}
