const editorInteractiveControlSelector = [
  "input",
  "textarea",
  "select",
  "button",
  "[data-editor-ui='true']",
  "[data-editor-object-ui='true']",
  "[role='button']",
].join(",");

export const editorPreserveSelectionSelector =
  '[data-editor-preserve-selection="true"]';

export function isEditorInteractiveControlTarget(
  target: Element,
  boundary?: Element,
): boolean {
  const control = target.closest(editorInteractiveControlSelector);
  return Boolean(control && (!boundary || boundary.contains(control)));
}

/**
 * Returns whether document capture should treat this pointer interaction as an
 * explicit consumer of the current canonical selection. The composed path is
 * intentional: selection UI can live in a shadow tree or be retargeted before
 * product event handlers run.
 */
export function pointerEventPreservesEditorSelection(event: Event): boolean {
  const path = event.composedPath?.() ?? [];
  if (
    path.some(
      (target) =>
        target instanceof Element &&
        target.matches(editorPreserveSelectionSelector),
    )
  ) {
    return true;
  }
  const target =
    event.target instanceof Element
      ? event.target
      : event.target instanceof Node
        ? event.target.parentElement
        : null;
  return Boolean(target?.closest(editorPreserveSelectionSelector));
}
