import type { BlockId } from "@repo/editor-core/kernel";
import { editorBlockShellSelector } from "../../dom-markers.ts";

export const EDITOR_SELECTION_BOUNDS_ATTRIBUTE = "data-editor-selection-bounds";
export const EDITOR_SELECTION_BOUNDS_TARGET_ATTRIBUTE =
  "data-editor-selection-bounds-target";
export const EDITOR_SELECTION_BOUNDS_SELECTOR = `[${EDITOR_SELECTION_BOUNDS_ATTRIBUTE}="true"]`;

export interface EditorSelectionBoundsDataAttributeOptions {
  readonly target?: string | null;
}

export interface ResolveEditorSelectionBoundsElementOptions {
  readonly target?: string | null;
}

export type ResolveEditorSelectionBoundsElementResult =
  | {
      readonly ok: true;
      readonly element: HTMLElement;
      readonly registrationCount: number;
    }
  | {
      readonly ok: false;
      readonly reason: "missing-target" | "duplicate-target";
      readonly registrationCount: number;
    };

export type EditorSelectionBoundsDataAttributes = {
  readonly "data-editor-selection-bounds": "true";
  readonly "data-editor-selection-bounds-block-id": BlockId;
  readonly "data-editor-selection-bounds-target"?: string;
};

export function editorSelectionBoundsDataAttributes(
  blockId: BlockId,
  options: EditorSelectionBoundsDataAttributeOptions = {},
): EditorSelectionBoundsDataAttributes {
  const target = normalizeSelectionBoundsTarget(options.target);
  const attributes: EditorSelectionBoundsDataAttributes = {
    "data-editor-selection-bounds": "true",
    "data-editor-selection-bounds-block-id": blockId,
  };
  return target
    ? { ...attributes, "data-editor-selection-bounds-target": target }
    : attributes;
}

export function resolveEditorSelectionBoundsElement(
  blockShell: HTMLElement,
  blockId: BlockId,
  options: ResolveEditorSelectionBoundsElementOptions = {},
): HTMLElement | null {
  const result = resolveEditorSelectionBoundsElementResult(
    blockShell,
    blockId,
    options,
  );
  return result.ok ? result.element : null;
}

export function resolveEditorSelectionBoundsElementResult(
  blockShell: HTMLElement,
  blockId: BlockId,
  options: ResolveEditorSelectionBoundsElementOptions = {},
): ResolveEditorSelectionBoundsElementResult {
  const target = normalizeSelectionBoundsTarget(options.target);
  const candidates = [
    ...(isEditorSelectionBoundsElement(blockShell) ? [blockShell] : []),
    ...Array.from(
      blockShell.querySelectorAll<HTMLElement>(
        EDITOR_SELECTION_BOUNDS_SELECTOR,
      ),
    ),
  ].filter((candidate) =>
    isEditorSelectionBoundsCandidateForBlock(candidate, blockShell, blockId),
  );

  if (target) {
    const matches = candidates.filter(
      (candidate) => readSelectionBoundsTarget(candidate) === target,
    );
    if (matches.length === 1)
      return { ok: true, element: matches[0]!, registrationCount: 1 };
    return {
      ok: false,
      reason: matches.length === 0 ? "missing-target" : "duplicate-target",
      registrationCount: matches.length,
    };
  }

  const resolved =
    candidates.find(
      (candidate) =>
        candidate !== blockShell && !readSelectionBoundsTarget(candidate),
    ) ??
    candidates.find(
      (candidate) =>
        candidate === blockShell && !readSelectionBoundsTarget(candidate),
    ) ??
    blockShell;
  return { ok: true, element: resolved, registrationCount: 1 };
}

function isEditorSelectionBoundsElement(element: HTMLElement): boolean {
  return element.getAttribute(EDITOR_SELECTION_BOUNDS_ATTRIBUTE) === "true";
}

function isEditorSelectionBoundsCandidateForBlock(
  candidate: HTMLElement,
  blockShell: HTMLElement,
  blockId: BlockId,
): boolean {
  if (candidate.dataset.editorSelectionBoundsBlockId !== blockId) return false;
  return (
    candidate.closest(`${editorBlockShellSelector}[data-editor-block-id]`) ===
    blockShell
  );
}

function readSelectionBoundsTarget(element: HTMLElement): string | null {
  return normalizeSelectionBoundsTarget(
    element.getAttribute(EDITOR_SELECTION_BOUNDS_TARGET_ATTRIBUTE),
  );
}

function normalizeSelectionBoundsTarget(
  target: string | null | undefined,
): string | null {
  if (!target) return null;
  const normalized = target.trim();
  return normalized.length > 0 ? normalized : null;
}
