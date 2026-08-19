"use client";

import type {
  FocusEvent as ReactFocusEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useEffect, useRef } from "react";
import type { EditableEditorRuntimePort } from "../../runtime/document/render-port.ts";
import { isInSameEditorInteractionScope } from "../dom-markers.ts";
import { isEditorInteractiveControlTarget } from "../interaction/interactive-targets.ts";

export interface WebFocusAdaptersOptions {
  editor: Pick<
    EditableEditorRuntimePort,
    "blurEditor" | "ownsActiveElement" | "ownsNativeFocusTarget"
  >;
  listElement?: HTMLElement | null;
  releaseComposition?: () => void;
}

export interface WebFocusAdaptersState {
  handleListMouseDown(event: ReactMouseEvent<HTMLDivElement>): void;
  handleListBlur(event: ReactFocusEvent<HTMLDivElement>): void;
}

export function useWebFocusAdapters({
  editor,
  listElement = null,
  releaseComposition,
}: WebFocusAdaptersOptions): WebFocusAdaptersState {
  const releasingDocumentFocus = useRef(false);
  useEffect(() => {
    if (!listElement) return undefined;
    const doc = listElement.ownerDocument;
    const win = doc.defaultView;
    const releaseDocumentFocus = () => {
      if (releasingDocumentFocus.current) return;
      releasingDocumentFocus.current = true;
      try {
        releaseComposition?.();
        editor.blurEditor();
      } finally {
        releasingDocumentFocus.current = false;
      }
    };
    const handleWindowBlur = () => releaseDocumentFocus();
    const handleVisibilityChange = () => {
      if (doc.visibilityState === "hidden") releaseDocumentFocus();
    };
    const handlePageHide = () => releaseDocumentFocus();
    win?.addEventListener("blur", handleWindowBlur);
    doc.addEventListener("visibilitychange", handleVisibilityChange);
    win?.addEventListener("pagehide", handlePageHide);
    return () => {
      win?.removeEventListener("blur", handleWindowBlur);
      doc.removeEventListener("visibilitychange", handleVisibilityChange);
      win?.removeEventListener("pagehide", handlePageHide);
    };
  }, [listElement, editor, releaseComposition]);

  function handleListMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    // List whitespace has no native-focus authority. Exact text primitives and
    // registered atomic product surfaces own their browser focus directly.
    void event;
  }

  function handleListBlur(event: ReactFocusEvent<HTMLDivElement>) {
    if (releasingDocumentFocus.current) return;
    const nextTarget = event.relatedTarget;
    if (editor.ownsNativeFocusTarget(nextTarget)) return;
    const list = event.currentTarget;
    if (nextTarget instanceof Node) {
      if (
        nextTarget instanceof Element &&
        isInSameEditorInteractionScope(list, nextTarget) &&
        isEditorInteractiveControlTarget(nextTarget)
      ) {
        return;
      }
      editor.blurEditor();
      return;
    }
    if (!list.isConnected || editor.ownsActiveElement(list.ownerDocument))
      return;
    editor.blurEditor();
  }

  return { handleListMouseDown, handleListBlur };
}
