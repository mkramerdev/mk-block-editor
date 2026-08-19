import type { CommittedSelectionSnapshot } from "@repo/editor-react/selection";

const clipboardEventOwner = new WeakMap<Event, object>();

export type EditorClipboardEventOwnership =
  | {
      readonly kind: "selection";
      readonly selection: CommittedSelectionSnapshot;
    }
  | { readonly kind: "none" };

export interface ResolveEditorClipboardEventOwnershipOptions {
  readonly event: Event;
  readonly editorIdentity: object;
  readonly list: HTMLElement;
  readonly committedSelection: CommittedSelectionSnapshot | null;
  readonly isCommittedSelectionCurrent: (
    snapshot: CommittedSelectionSnapshot,
  ) => boolean;
  readonly ownsNativeTarget: (target: EventTarget | null) => boolean;
  readonly ownsActiveElement: (document: Document) => boolean;
}

export function resolveEditorClipboardEventOwnership(
  options: ResolveEditorClipboardEventOwnershipOptions,
): EditorClipboardEventOwnership {
  const existingOwner = clipboardEventOwner.get(options.event);
  if (existingOwner && existingOwner !== options.editorIdentity)
    return { kind: "none" };
  const path = safeComposedPath(options.event);
  const target = eventTargetElement(options.event, path);
  if (
    isExcludedClipboardControl(
      target,
      path,
      options.list,
      options.ownsNativeTarget,
    )
  )
    return { kind: "none" };
  const editorOwnsEvent =
    path.includes(options.list) ||
    path.some(options.ownsNativeTarget) ||
    options.ownsActiveElement(options.list.ownerDocument);
  if (!editorOwnsEvent) return { kind: "none" };

  const captured = options.committedSelection;
  if (captured && options.isCommittedSelectionCurrent(captured)) {
    return { kind: "selection", selection: captured };
  }

  return { kind: "none" };
}

export function claimEditorClipboardEvent(
  event: Event,
  editorIdentity: object,
): boolean {
  const owner = clipboardEventOwner.get(event);
  if (owner && owner !== editorIdentity) return false;
  clipboardEventOwner.set(event, editorIdentity);
  return true;
}

function isExcludedClipboardControl(
  target: Element | null,
  path: readonly EventTarget[],
  list: HTMLElement,
  ownsNativeTarget: (target: EventTarget | null) => boolean,
): boolean {
  const elements = path.filter(
    (entry): entry is Element => entry instanceof Element,
  );
  if (
    elements.some((element) =>
      element.matches(
        "[data-editor-ui='true']:not([data-editor-clipboard-delegate='true'])",
      ),
    )
  )
    return true;
  if (!target) return false;
  const control = closestClipboardControl(target);
  if (!control) return false;
  if (!list.contains(control)) return true;
  if (control.matches("input, textarea, select")) return true;
  if (!ownsNativeTarget(control)) return true;
  return Boolean(
    control.closest(
      "[data-editor-ui='true']:not([data-editor-clipboard-delegate='true'])",
    ),
  );
}

function closestClipboardControl(target: Element): HTMLElement | null {
  let current: Element | null = target;
  while (current) {
    if (
      current instanceof HTMLElement &&
      (current.matches("input, textarea, select") ||
        current.contentEditable === "true")
    )
      return current;
    current = current.parentElement;
  }
  return null;
}

function safeComposedPath(event: Event): readonly EventTarget[] {
  try {
    const path = event.composedPath();
    return path.length > 0 ? path : event.target ? [event.target] : [];
  } catch {
    return event.target ? [event.target] : [];
  }
}

function eventTargetElement(
  event: Event,
  path: readonly EventTarget[],
): Element | null {
  const candidate = path[0] ?? event.target;
  if (candidate instanceof Element) return candidate;
  return candidate instanceof Node ? candidate.parentElement : null;
}
