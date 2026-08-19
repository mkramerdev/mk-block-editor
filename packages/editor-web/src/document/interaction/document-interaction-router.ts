import {
  editorBlockListRootSelector,
  isInSameEditorInteractionScope,
} from "../dom-markers.ts";
import { pointerEventPreservesEditorSelection } from "./interactive-targets.ts";

export interface DocumentInteractionOwner {
  readonly list: HTMLElement;
  readonly releaseInteraction: () => void;
  readonly pointerdown: (event: PointerEvent) => void;
  readonly pointermove: (event: PointerEvent) => void;
  readonly pointerup: (event: PointerEvent) => void;
  readonly pointercancel: (event: PointerEvent) => void;
  readonly beforeinput: (event: InputEvent) => void;
  readonly keydown: (event: KeyboardEvent) => void;
  readonly keyup: (event: KeyboardEvent) => void;
  readonly scroll: (event: Event) => void;
}

interface DocumentInteractionRouter {
  readonly owners: Set<DocumentInteractionOwner>;
  readonly pointerOwners: Map<number, DocumentInteractionOwner>;
  activeOwner: DocumentInteractionOwner | null;
  dispose(): void;
}

const routers = new WeakMap<Document, DocumentInteractionRouter>();
export function registerDocumentInteractionOwner(
  doc: Document,
  owner: DocumentInteractionOwner,
): () => void {
  const router = routers.get(doc) ?? createRouter(doc);
  routers.set(doc, router);
  router.owners.add(owner);
  return () => {
    router.owners.delete(owner);
    if (router.activeOwner === owner) router.activeOwner = null;
    for (const [pointerId, pointerOwner] of router.pointerOwners) {
      if (pointerOwner === owner) router.pointerOwners.delete(pointerId);
    }
    if (router.owners.size === 0) {
      router.dispose();
      routers.delete(doc);
    }
  };
}

function createRouter(doc: Document): DocumentInteractionRouter {
  const router: DocumentInteractionRouter = {
    owners: new Set(),
    pointerOwners: new Map(),
    activeOwner: null,
    dispose: () => undefined,
  };
  const pointerdown = (event: PointerEvent) => {
    // Secondary buttons neither begin a selection gesture nor transfer the
    // active editor's canonical-selection ownership.
    if (event.button !== 0) return;
    const owner =
      resolveTargetOwner(router, event.target) ??
      (pointerEventPreservesEditorSelection(event) ? router.activeOwner : null);
    if (owner) {
      activateOwner(router, owner);
      router.pointerOwners.set(event.pointerId, owner);
      owner.pointerdown(event);
      return;
    }
    deactivateOwner(router);
  };
  const pointermove = (event: PointerEvent) =>
    router.pointerOwners.get(event.pointerId)?.pointermove(event);
  const completePointer = (
    event: PointerEvent,
    callback: "pointerup" | "pointercancel",
  ) => {
    const owner = router.pointerOwners.get(event.pointerId);
    router.pointerOwners.delete(event.pointerId);
    owner?.[callback](event);
  };
  const keydown = (event: KeyboardEvent) => {
    resolveKeyboardOwner(router, doc, event)?.keydown(event);
  };
  const beforeinput = (event: InputEvent) => {
    const owner = resolveTargetOwner(router, event.target);
    if (owner && isInsideOwnerList(owner, event.target)) {
      owner.beforeinput(event);
    }
  };
  const keyup = (event: KeyboardEvent) => {
    resolveKeyboardOwner(router, doc, event)?.keyup(event);
  };
  const scroll = (event: Event) => {
    const pointerOwner = router.pointerOwners.values().next().value as
      | DocumentInteractionOwner
      | undefined;
    (pointerOwner ?? resolveTargetOwner(router, event.target))?.scroll(event);
  };
  const pointerup = (event: PointerEvent) =>
    completePointer(event, "pointerup");
  const pointercancel = (event: PointerEvent) =>
    completePointer(event, "pointercancel");
  doc.addEventListener("pointerdown", pointerdown, true);
  doc.addEventListener("pointermove", pointermove, true);
  doc.addEventListener("pointerup", pointerup, true);
  doc.addEventListener("pointercancel", pointercancel, true);
  doc.addEventListener("beforeinput", beforeinput, true);
  doc.addEventListener("keydown", keydown, true);
  doc.addEventListener("keyup", keyup, true);
  doc.addEventListener("scroll", scroll, true);
  router.dispose = () => {
    doc.removeEventListener("pointerdown", pointerdown, true);
    doc.removeEventListener("pointermove", pointermove, true);
    doc.removeEventListener("pointerup", pointerup, true);
    doc.removeEventListener("pointercancel", pointercancel, true);
    doc.removeEventListener("beforeinput", beforeinput, true);
    doc.removeEventListener("keydown", keydown, true);
    doc.removeEventListener("keyup", keyup, true);
    doc.removeEventListener("scroll", scroll, true);
    router.pointerOwners.clear();
    router.activeOwner = null;
  };
  return router;
}

function resolveKeyboardOwner(
  router: DocumentInteractionRouter,
  doc: Document,
  event: KeyboardEvent,
): DocumentInteractionOwner | null {
  const targetOwner = resolveTargetOwner(router, event.target);
  if (targetOwner) {
    activateOwner(router, targetOwner);
    return targetOwner;
  }
  if (isExternalFormControl(event.target)) return null;
  const activeOwner = resolveTargetOwner(router, doc.activeElement);
  if (activeOwner) {
    activateOwner(router, activeOwner);
    return activeOwner;
  }
  if (isExternalFormControl(doc.activeElement)) return null;
  return router.activeOwner;
}

function isInsideOwnerList(
  owner: DocumentInteractionOwner,
  target: EventTarget | Node | null,
): boolean {
  return target instanceof Node && owner.list.contains(target);
}

function resolveTargetOwner(
  router: DocumentInteractionRouter,
  target: EventTarget | Node | null,
): DocumentInteractionOwner | null {
  const node = target instanceof Node ? target : null;
  if (!node) return null;
  const element = node instanceof Element ? node : node.parentElement;
  const list = element?.closest<HTMLElement>(editorBlockListRootSelector);
  if (list) {
    for (const owner of router.owners) if (owner.list === list) return owner;
  }
  for (const owner of router.owners) {
    if (isInSameEditorInteractionScope(owner.list, node)) return owner;
  }
  return null;
}

function activateOwner(
  router: DocumentInteractionRouter,
  owner: DocumentInteractionOwner,
): void {
  if (router.activeOwner === owner) return;
  const previous = router.activeOwner;
  router.activeOwner = owner;
  previous?.releaseInteraction();
}

function deactivateOwner(router: DocumentInteractionRouter): void {
  const previous = router.activeOwner;
  router.activeOwner = null;
  previous?.releaseInteraction();
}

function isExternalFormControl(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      "input, textarea, select, button, [contenteditable='true']",
    ) !== null
  );
}
