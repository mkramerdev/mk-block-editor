import type { CommittedSelectionSnapshot } from "@repo/editor-react/selection";
import type { ResolvedNativeFocusTarget } from "../../../runtime/document/native-focus-coordinator.ts";
import { editorBlockListRootSelector } from "../../dom-markers.ts";

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
  readonly resolveNativeFocusTarget: (
    target: EventTarget | null,
  ) => ResolvedNativeFocusTarget;
}

export function resolveEditorClipboardEventOwnership(
  options: ResolveEditorClipboardEventOwnershipOptions,
): EditorClipboardEventOwnership {
  const existingOwner = clipboardEventOwner.get(options.event);
  if (existingOwner && existingOwner !== options.editorIdentity)
    return { kind: "none" };
  const path = safeComposedPath(options.event);
  const target = eventTargetElement(options.event, path);
  const targetList = target?.closest<HTMLElement>(editorBlockListRootSelector);
  if (targetList && targetList !== options.list) return { kind: "none" };
  const targetFocus = options.resolveNativeFocusTarget(target);
  if (
    isExcludedClipboardControl(
      target,
      path,
      options.list,
      targetFocus,
    )
  )
    return { kind: "none" };
  const targetIdentifiesEditor = path.includes(options.list) || targetFocus !== null;
  const activeFocus = targetIdentifiesEditor
    ? null
    : options.resolveNativeFocusTarget(options.list.ownerDocument.activeElement);
  const editorOwnsEvent = targetIdentifiesEditor || activeFocus !== null;
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
  nativeFocus: ResolvedNativeFocusTarget,
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
  if (!nativeFocus) return true;
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
