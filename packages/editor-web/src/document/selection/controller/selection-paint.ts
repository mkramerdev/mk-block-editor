import type { NativeSelectionPaintMode } from "@repo/editor-react/selection";
import { setSelectionPaintVisible } from "./pointer-gesture.ts";

/** Reflects an already-derived controller presentation decision into the DOM. */
export function applyNativeSelectionPaintMode(
  list: HTMLElement,
  mode: NativeSelectionPaintMode,
): void {
  list.dataset.editorNativeSelectionPaintMode = mode;
  setSelectionPaintVisible(
    list,
    mode === "hidden-for-global-selection" || mode === "composition-owned",
  );
}

export function clearNativeSelectionPaintMode(list: HTMLElement): void {
  delete list.dataset.editorNativeSelectionPaintMode;
  setSelectionPaintVisible(list, false);
}
