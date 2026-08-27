"use client";

import type {
  FocusEvent as ReactFocusEvent,
  MouseEvent as ReactMouseEvent,
} from "react";
import { useEffect } from "react";
import type { EditableEditorRuntimePort } from "../../runtime/document/render-port.ts";
import { isInSameEditorInteractionScope } from "../dom-markers.ts";
import { isEditorInteractiveControlTarget } from "../interaction/interactive-targets.ts";

export interface WebFocusAdaptersOptions {
  editor: Pick<
    EditableEditorRuntimePort,
    "blurEditor" | "resolveNativeFocusTarget"
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
  useEffect(() => {
    if (!listElement) return undefined;
    const doc = listElement.ownerDocument;
    const win = doc.defaultView;
    // Window/document lifecycle loss is not an in-document focus transfer.
    // Leave the native focus target alone so the browser can hide and later
    // restore its caret naturally. Composition leases still need explicit
    // cleanup because their terminal DOM event is not reliable across tab or
    // page lifecycle boundaries.
    const releaseLifecycleComposition = () => releaseComposition?.();
    const handleWindowBlur = () => releaseLifecycleComposition();
    const handleVisibilityChange = () => {
      if (doc.visibilityState === "hidden") releaseLifecycleComposition();
    };
    // pagehide may precede navigation or BFCache suspension. It releases only
    // composition resources; it must not manufacture a focus/selection clear.
    const handlePageHide = () => releaseLifecycleComposition();
    win?.addEventListener("blur", handleWindowBlur);
    doc.addEventListener("visibilitychange", handleVisibilityChange);
    win?.addEventListener("pagehide", handlePageHide);
    return () => {
      win?.removeEventListener("blur", handleWindowBlur);
      doc.removeEventListener("visibilitychange", handleVisibilityChange);
      win?.removeEventListener("pagehide", handlePageHide);
    };
  }, [listElement, releaseComposition]);

  function handleListMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    // List whitespace has no native-focus authority. Exact text primitives and
    // registered atomic product surfaces own their browser focus directly.
    void event;
  }

  function handleListBlur(event: ReactFocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (editor.resolveNativeFocusTarget(nextTarget)) return;
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
    if (
      !list.isConnected ||
      editor.resolveNativeFocusTarget(list.ownerDocument.activeElement)
    )
      return;
    editor.blurEditor();
  }

  return { handleListMouseDown, handleListBlur };
}
