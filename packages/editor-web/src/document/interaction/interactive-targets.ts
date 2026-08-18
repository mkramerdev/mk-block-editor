const editorInteractiveControlSelector = [
  "input",
  "textarea",
  "select",
  "button",
  "[data-editor-ui='true']",
  "[data-editor-object-ui='true']",
  "[role='button']",
].join(",");

export function isEditorInteractiveControlTarget(
  target: Element,
  boundary?: Element,
): boolean {
  const control = target.closest(editorInteractiveControlSelector);
  return Boolean(control && (!boundary || boundary.contains(control)));
}
