import { isEditorInteractiveControlTarget } from "../../interaction/interactive-targets.ts";

const KEYBOARD_SELECTION_ACTIVE_DATASET_KEY = "editorKeyboardSelectionActive";
const TEXT_SELECTION_DRAG_ACTIVE_DATASET_KEY = "editorTextSelectionDragActive";

export function setSelectionPaintVisible(
  list: HTMLElement,
  visible: boolean,
): void {
  if (visible) {
    list.dataset.editorSelectionPaintVisible = "true";
  } else {
    delete list.dataset.editorSelectionPaintVisible;
  }
}

export function markKeyboardSelectionActive(list: HTMLElement): void {
  list.dataset[KEYBOARD_SELECTION_ACTIVE_DATASET_KEY] = "true";
  setSelectionPaintVisible(list, true);
}

export function clearKeyboardSelectionActive(list: HTMLElement): void {
  delete list.dataset[KEYBOARD_SELECTION_ACTIVE_DATASET_KEY];
}

export function setTextSelectionDragActive(
  list: HTMLElement,
  active: boolean,
): void {
  if (active) {
    list.dataset[TEXT_SELECTION_DRAG_ACTIVE_DATASET_KEY] = "true";
  } else {
    delete list.dataset[TEXT_SELECTION_DRAG_ACTIVE_DATASET_KEY];
  }
}

export function suppressNativeSelection(list: HTMLElement): () => void {
  const doc = list.ownerDocument;
  const preventSelectionStart = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Node) || !list.contains(target)) return;
    event.preventDefault();
  };
  doc.addEventListener("selectstart", preventSelectionStart, true);
  return () => {
    doc.removeEventListener("selectstart", preventSelectionStart, true);
  };
}

export function clearNativeSelection(doc: Document): void {
  const selection = doc.getSelection?.();
  if (!selection || selection.rangeCount === 0) return;
  selection.removeAllRanges();
}

export function blurFocusedEditorElement(list: HTMLElement): void {
  const activeElement = list.ownerDocument.activeElement;
  if (!(activeElement instanceof HTMLElement)) return;
  if (!list.contains(activeElement)) return;
  activeElement.blur();
}

export function capturePointer(
  element: HTMLElement,
  pointerId: number,
): boolean {
  if (typeof element.setPointerCapture !== "function") return false;
  try {
    element.setPointerCapture(pointerId);
    return true;
  } catch {
    return false;
  }
}

export function releasePointer(element: HTMLElement, pointerId: number): void {
  try {
    if (element.hasPointerCapture?.(pointerId))
      element.releasePointerCapture(pointerId);
  } catch {
    // Pointer capture can already be gone after cancel/lost-capture paths.
  }
}

export function isKeyboardEventFromUnrelatedExternalControl(
  event: KeyboardEvent,
  list: HTMLElement,
): boolean {
  const doc = list.ownerDocument;
  const activeElement = doc.activeElement;
  if (
    activeElement instanceof Element &&
    !list.contains(activeElement) &&
    activeElement !== doc.body &&
    activeElement !== doc.documentElement &&
    isKeyboardInteractiveElement(activeElement)
  ) {
    return true;
  }
  const target =
    event.target instanceof Element
      ? event.target
      : event.target instanceof Node
        ? event.target.parentElement
        : null;
  if (!target || list.contains(target)) return false;
  if (target === doc.body || target === doc.documentElement) return false;
  return isKeyboardInteractiveElement(target);
}

export function isPointerEventFromEditorInteractiveControl(
  event: PointerEvent,
  list: HTMLElement,
): boolean {
  const target =
    event.target instanceof Element
      ? event.target
      : event.target instanceof Node
        ? event.target.parentElement
        : null;
  return Boolean(
    target &&
    list.contains(target) &&
    isEditorInteractiveControlTarget(target, list),
  );
}

export function pointerEventTargetElement(event: Event): Element | null {
  return event.target instanceof Element
    ? event.target
    : event.target instanceof Node
      ? event.target.parentElement
      : null;
}

function isKeyboardInteractiveElement(element: Element): boolean {
  return Boolean(
    element.closest(
      [
        "input",
        "textarea",
        "select",
        "button",
        "[contenteditable='true']",
        "[role='textbox']",
        "[role='combobox']",
        "[role='spinbutton']",
        "[role='slider']",
      ].join(","),
    ),
  );
}
