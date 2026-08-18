const objectFocusTargetSelector = "[data-editor-object-focus-target='true']";

export function findObjectFocusTarget(root: ParentNode): HTMLElement | null {
  const target = root.querySelector(objectFocusTargetSelector);
  return target instanceof HTMLElement ? target : null;
}

export function isObjectFocusTarget(target: Element): boolean {
  return target.closest(objectFocusTargetSelector) !== null;
}
