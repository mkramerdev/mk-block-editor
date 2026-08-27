export type EditorNativeSelectionOwnershipSource =
  | "mount"
  | "pointer"
  | "keyboard"
  | "focus"
  | "input"
  | "projection";

interface EditorNativeSelectionOwnership {
  registrations: number;
  eligible: boolean;
  source: EditorNativeSelectionOwnershipSource | "external-pointer";
}

const ownershipByBlockList = new WeakMap<
  HTMLElement,
  EditorNativeSelectionOwnership
>();

/**
 * Registers one mounted consumer of a block list's native-selection boundary.
 * Eligibility is shared only by controllers mounted for that exact list.
 */
export function registerEditorNativeSelectionOwnership(
  list: HTMLElement,
): () => void {
  const ownership = getOrCreateOwnership(list);
  ownership.registrations += 1;
  return () => {
    const current = ownershipByBlockList.get(list);
    if (current !== ownership) return;
    current.registrations -= 1;
    if (current.registrations === 0) ownershipByBlockList.delete(list);
  };
}

/** Marks a browser-selection-producing path as owned by this editor. */
export function claimEditorNativeSelectionOwnership(
  list: HTMLElement,
  source: Exclude<EditorNativeSelectionOwnershipSource, "mount">,
): void {
  const ownership = getOrCreateOwnership(list);
  ownership.eligible = true;
  ownership.source = source;
}

/**
 * Revokes import eligibility before an external primary pointer can let the
 * browser relocate Selection after pointerdown dispatch has completed.
 */
export function revokeEditorNativeSelectionOwnership(
  list: HTMLElement,
): void {
  const ownership = getOrCreateOwnership(list);
  ownership.eligible = false;
  ownership.source = "external-pointer";
}

export function editorMayImportNativeSelection(list: HTMLElement): boolean {
  return getOrCreateOwnership(list).eligible;
}

function getOrCreateOwnership(
  list: HTMLElement,
): EditorNativeSelectionOwnership {
  const current = ownershipByBlockList.get(list);
  if (current) return current;
  const ownership: EditorNativeSelectionOwnership = {
    registrations: 0,
    eligible: true,
    source: "mount",
  };
  ownershipByBlockList.set(list, ownership);
  return ownership;
}
