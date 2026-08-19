import type { BlockId } from "@repo/editor-core/kernel";
import type {
  EditorBlockSelectionTarget,
  EditorSelectionGraphReader,
} from "@repo/editor-react/selection";
import { readEditorBlockSelectionTarget } from "@repo/editor-react/selection";
import type { EditorSelectionTextAffinity } from "@repo/editor-react/selection-model";
import {
  clampTextOffset,
  type EditorTextPointHit,
} from "./text-hit-testing.ts";
import {
  editorBlockShellSelector,
  editorTextRootSelector,
} from "../../dom-markers.ts";
import { createSemanticDomTextLayout } from "../../geometry/semantic-dom-coordinates.ts";

export interface EditorSelectionPointerHit {
  shell: HTMLElement;
  target: EditorBlockSelectionTarget;
  textOffset: number;
  affinity: EditorSelectionTextAffinity | null;
}

interface EditorSelectionPointerBlockHit {
  shell: HTMLElement;
  target: EditorBlockSelectionTarget;
}

type EditorSelectionPointerHitFailureReason =
  | "not-selection-target"
  | "blocked-target"
  | "missing-block"
  | "hidden-block"
  | "not-selectable-block"
  | "not-start-eligible"
  | "missing-text"
  | "invalid";

type ResolveEditorSelectionPointerHitResult =
  | { ok: true; hit: EditorSelectionPointerHit }
  | {
      ok: false;
      reason: EditorSelectionPointerHitFailureReason;
      blockId?: BlockId;
      message?: string;
    };

interface ResolveEditorSelectionPointerHitOptions {
  list: HTMLElement;
  target: EventTarget | null;
  clientX: number;
  clientY: number;
  graph: EditorSelectionGraphReader;
  requireStartEligible?: boolean;
  preferredBlockId?: BlockId | null;
}

interface ResolveEditorSelectionPointerBlockHitOptions {
  list: HTMLElement;
  target: EventTarget | null;
  clientX: number;
  clientY: number;
  graph: EditorSelectionGraphReader;
  requireStartEligible?: boolean;
  preferredBlockId?: BlockId | null;
}

export function resolveEditorSelectionPointerHit({
  list,
  target,
  clientX,
  clientY,
  graph,
  requireStartEligible = false,
  preferredBlockId = null,
}: ResolveEditorSelectionPointerHitOptions): EditorSelectionPointerHit | null {
  const result = resolveEditorSelectionPointerHitResult({
    list,
    target,
    clientX,
    clientY,
    graph,
    requireStartEligible,
    preferredBlockId,
  });
  return result.ok ? result.hit : null;
}

function resolveEditorSelectionPointerHitResult({
  list,
  target,
  clientX,
  clientY,
  graph,
  requireStartEligible = false,
  preferredBlockId = null,
}: ResolveEditorSelectionPointerHitOptions): ResolveEditorSelectionPointerHitResult {
  const blockHit = resolveEditorSelectionPointerBlockHitResult({
    list,
    target,
    clientX,
    clientY,
    graph,
    requireStartEligible,
    preferredBlockId,
  });
  if (!blockHit.ok) return blockHit;
  const { shell, target: selectionTarget } = blockHit.hit;

  const textPoint = blockUsesContentSelectionEndpoint(selectionTarget)
    ? resolveTextSelectionOffset({
        shell,
        clientX,
        clientY,
      })
    : null;
  const textOffset = textPoint?.offset ?? wholeBlockEdgeOffset(shell, clientY);
  return {
    ok: true,
    hit: {
      shell,
      target: selectionTarget,
      textOffset,
      affinity: textPoint?.affinity ?? null,
    },
  };
}

type ResolveEditorSelectionPointerBlockHitResult =
  | { ok: true; hit: EditorSelectionPointerBlockHit }
  | {
      ok: false;
      reason: EditorSelectionPointerHitFailureReason;
      blockId?: BlockId;
      message?: string;
    };

function resolveEditorSelectionPointerBlockHitResult({
  list,
  target,
  clientX,
  clientY,
  graph,
  requireStartEligible = false,
  preferredBlockId = null,
}: ResolveEditorSelectionPointerBlockHitOptions): ResolveEditorSelectionPointerBlockHitResult {
  let shell = requireStartEligible
    ? shellFromElement(list, targetElement(target))
    : resolveSelectionBlockShell(list, target, clientX, clientY);
  if (!shell) return hitFailure("not-selection-target");
  if (isBlockedSelectionTarget(shell, target))
    return hitFailure("blocked-target");

  const blockId = shell.dataset.editorBlockId as BlockId | undefined;
  if (!blockId) return hitFailure("missing-block");
  let selectionTarget = readEditorBlockSelectionTarget(graph, blockId);
  if (!selectionTarget) return hitFailure("missing-block", blockId);
  if (!selectionTarget.selectable) {
    if (requireStartEligible)
      return hitFailure("not-start-eligible", selectionTarget.block.id);
    const childShell = resolveContainerGapSelectionShell(
      shell,
      graph,
      clientY,
      preferredBlockId,
    );
    if (!childShell)
      return hitFailure("not-selectable-block", selectionTarget.block.id);
    const childBlockId = childShell.dataset.editorBlockId as
      | BlockId
      | undefined;
    const childTarget = childBlockId
      ? readEditorBlockSelectionTarget(graph, childBlockId)
      : null;
    if (!childTarget) return hitFailure("missing-block", childBlockId);
    if (!childTarget.selectable)
      return hitFailure("not-selectable-block", childTarget.block.id);
    shell = childShell;
    selectionTarget = childTarget;
  }
  if (requireStartEligible && !selectionTarget.canStartSelection)
    return hitFailure("not-start-eligible", selectionTarget.block.id);
  return { ok: true, hit: { shell, target: selectionTarget } };
}

function resolveContainerGapSelectionShell(
  containerShell: HTMLElement,
  graph: EditorSelectionGraphReader,
  clientY: number,
  preferredBlockId: BlockId | null,
): HTMLElement | null {
  if (preferredBlockId) {
    for (const descendant of containerShell.querySelectorAll<HTMLElement>(
      editorBlockShellSelector,
    )) {
      if (descendant.dataset.editorBlockId !== preferredBlockId) continue;
      if (isVisibleSelectionShell(descendant, graph)) return descendant;
    }
  }

  const candidates = [
    ...containerShell.querySelectorAll<HTMLElement>(editorBlockShellSelector),
  ]
    .filter((candidate) => isVisibleSelectionShell(candidate, graph))
    .map((candidate) => ({
      shell: candidate,
      rect: candidate.getBoundingClientRect(),
    }))
    .filter(({ rect }) => Number.isFinite(rect.height) && rect.height > 0)
    .sort(
      (left, right) =>
        left.rect.top - right.rect.top || left.rect.bottom - right.rect.bottom,
    );
  if (candidates.length === 0) return null;

  const containing = candidates.find(
    ({ rect }) => clientY >= rect.top && clientY <= rect.bottom,
  );
  if (containing) return containing.shell;

  let previous: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    if (candidate.rect.top > clientY) break;
    previous = candidate;
  }
  return previous?.shell ?? candidates[0]!.shell;
}

function isVisibleSelectionShell(
  shell: HTMLElement,
  graph: EditorSelectionGraphReader,
): boolean {
  if (shell.hidden || shell.getAttribute("aria-hidden") === "true")
    return false;
  const blockId = shell.dataset.editorBlockId as BlockId | undefined;
  const target = blockId
    ? readEditorBlockSelectionTarget(graph, blockId)
    : null;
  return Boolean(target?.selectable);
}

function resolveSelectionBlockShell(
  list: HTMLElement,
  target: EventTarget | null,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const doc = list.ownerDocument;
  const pointed =
    typeof doc.elementFromPoint === "function"
      ? doc.elementFromPoint(clientX, clientY)
      : null;
  const pointedShell = shellFromElement(list, pointed);
  if (pointedShell) return pointedShell;
  return (
    shellFromElement(list, targetElement(target)) ??
    nearestSelectionShellAtPoint(list, clientX, clientY)
  );
}

function nearestSelectionShellAtPoint(
  list: HTMLElement,
  clientX: number,
  clientY: number,
): HTMLElement | null {
  const listRect = list.getBoundingClientRect();
  if (clientX < listRect.left || clientX > listRect.right) return null;
  const shells = [
    ...list.querySelectorAll<HTMLElement>(editorBlockShellSelector),
  ]
    .filter(
      (shell) => !shell.hidden && shell.getAttribute("aria-hidden") !== "true",
    )
    .map((shell) => ({ shell, rect: shell.getBoundingClientRect() }))
    .filter(
      ({ rect }) =>
        Number.isFinite(rect.width) &&
        Number.isFinite(rect.height) &&
        rect.width > 0 &&
        rect.height > 0,
    );
  const containing = shells
    .filter(
      ({ rect }) =>
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom,
    )
    .sort(
      (left, right) =>
        left.rect.width * left.rect.height -
        right.rect.width * right.rect.height,
    )[0];
  if (containing) return containing.shell;
  return (
    shells
      .map(({ shell, rect }) => ({
        shell,
        distance:
          clientY < rect.top
            ? rect.top - clientY
            : clientY > rect.bottom
              ? clientY - rect.bottom
              : 0,
      }))
      .sort((left, right) => left.distance - right.distance)[0]?.shell ?? null
  );
}

function isBlockedSelectionTarget(
  shell: HTMLElement,
  target: EventTarget | null,
): boolean {
  if (shell.hidden || shell.getAttribute("aria-hidden") === "true") return true;
  const element = targetElement(target);
  if (!element || !shell.contains(element)) return false;
  return Boolean(
    element.closest(["[data-editor-selection-ignore='true']"].join(",")),
  );
}

function resolveTextSelectionOffset({
  shell,
  clientX,
  clientY,
}: {
  shell: HTMLElement;
  clientX: number;
  clientY: number;
}): EditorTextPointHit {
  const textMount = resolveTextMount(shell);
  const textLayout = textMount ? createSemanticDomTextLayout(textMount) : null;
  const contentSize = textLayout?.length ?? 0;
  const verticalEdgePoint = textMount
    ? textMountVerticalEdgeOffset(textMount, clientY, contentSize)
    : null;
  if (verticalEdgePoint !== null) return verticalEdgePoint;
  if (textLayout) {
    const domPoint = textPointFromLayout(textLayout, clientX, clientY);
    if (domPoint !== null) return domPoint;
  }

  const readMount = shell.querySelector<HTMLElement>(
    "[data-editor-read-row='true']",
  );
  if (readMount) {
    const readLayout = createSemanticDomTextLayout(readMount);
    return (
      textPointFromLayout(readLayout, clientX, clientY) ?? {
        offset: 0,
        affinity: null,
      }
    );
  }
  return { offset: contentSize, affinity: null };
}

function textPointFromLayout(
  layout: ReturnType<typeof createSemanticDomTextLayout>,
  clientX: number,
  clientY: number,
): EditorTextPointHit | null {
  const hit = layout.hitTest(clientX, clientY);
  return hit
    ? {
        offset: clampTextOffset(hit.offset, layout.length),
        affinity: hit.affinity,
      }
    : null;
}

function resolveTextMount(shell: HTMLElement): HTMLElement | null {
  if (shell.matches(editorTextRootSelector)) return shell;
  return shell.querySelector<HTMLElement>(editorTextRootSelector);
}

function textMountVerticalEdgeOffset(
  textMount: HTMLElement,
  clientY: number,
  textLength: number,
): EditorTextPointHit | null {
  const rect = textMount.getBoundingClientRect();
  if (!Number.isFinite(rect.height) || rect.height <= 0) return null;
  if (clientY < rect.top) return { offset: 0, affinity: null };
  if (clientY > rect.bottom) return { offset: textLength, affinity: null };
  return null;
}

function wholeBlockEdgeOffset(shell: HTMLElement, clientY: number): number {
  const rect = shell.getBoundingClientRect();
  if (!Number.isFinite(rect.height) || rect.height <= 0) return 0;
  return clientY < rect.top + rect.height / 2 ? 0 : 1;
}

function blockUsesContentSelectionEndpoint(
  target: EditorBlockSelectionTarget,
): boolean {
  return target.selection.projection.endpoint.kind === "content";
}

function shellFromElement(
  list: HTMLElement,
  element: Element | null,
): HTMLElement | null {
  if (!element || !list.contains(element)) return null;
  const shell = element.closest(editorBlockShellSelector);
  if (!(shell instanceof HTMLElement) || !list.contains(shell)) return null;
  return shell;
}

function targetElement(target: EventTarget | null): Element | null {
  return target instanceof Element
    ? target
    : target instanceof Node
      ? target.parentElement
      : null;
}

function hitFailure(
  reason: EditorSelectionPointerHitFailureReason,
  blockId?: BlockId,
  message?: string,
): Extract<ResolveEditorSelectionPointerHitResult, { ok: false }> {
  return {
    ok: false,
    reason,
    ...(blockId === undefined ? {} : { blockId }),
    ...(message === undefined ? {} : { message }),
  };
}
