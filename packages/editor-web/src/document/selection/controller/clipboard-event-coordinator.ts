import type {
  CanonicalBlockFragment,
  StructuralEditRange,
} from "@repo/editor-core/editing";
import type { EditorSelectionSnapshot } from "@repo/editor-react/selection";
import type { EditorClipboardBoundary } from "../../../clipboard/boundary.ts";
import type { CapturedStructuralSelection } from "./browser-selection-types.ts";
import {
  claimEditorClipboardEvent,
  type EditorClipboardEventOwnership,
} from "./clipboard-event-ownership.ts";

export interface CapturedEditorClipboardPasteTarget {
  readonly kind: "selection";
  readonly capture: CapturedStructuralSelection;
}

export type CapturedEditorClipboardCutTarget =
  | ({ readonly kind: "structural" } & CapturedStructuralSelection)
  | {
      readonly kind: "internal";
      readonly snapshot: EditorSelectionSnapshot;
      isCurrent(): boolean;
      cut(): { readonly ok: boolean; readonly changed?: boolean };
    };

export interface EditorClipboardEventContext {
  readonly editorIdentity: object;
  readonly boundary: EditorClipboardBoundary;
  readonly ownership: {
    resolve(event: ClipboardEvent): EditorClipboardEventOwnership;
    captureSelectionSnapshot(
      ownership: Extract<EditorClipboardEventOwnership, { kind: "selection" }>,
    ): EditorSelectionSnapshot | null;
    captureSelection(
      ownership: Extract<EditorClipboardEventOwnership, { kind: "selection" }>,
    ): CapturedStructuralSelection | null;
    captureCutSelection(
      ownership: Extract<EditorClipboardEventOwnership, { kind: "selection" }>,
    ): CapturedEditorClipboardCutTarget | null;
  };
  readonly commands: {
    cut(range: StructuralEditRange): {
      readonly ok: boolean;
      readonly changed?: boolean;
    };
    paste(
      target: CapturedEditorClipboardPasteTarget,
      fragment: CanonicalBlockFragment,
    ): { readonly ok: boolean; readonly changed?: boolean };
  };
}

export interface EditorClipboardEventHandlers {
  readonly copy: (event: ClipboardEvent) => boolean;
  readonly cut: (event: ClipboardEvent) => boolean;
  readonly paste: (event: ClipboardEvent) => boolean;
}

export interface EditorCopyEventContext {
  readonly editorIdentity: object;
  readonly boundary: Pick<EditorClipboardBoundary, "writeSelection">;
  readonly resolveOwnership: (
    event: ClipboardEvent,
  ) => EditorClipboardEventOwnership;
  readonly captureSelectionSnapshot: (
    ownership: Extract<EditorClipboardEventOwnership, { kind: "selection" }>,
  ) => EditorSelectionSnapshot | null;
}

/** The canonical copy boundary shared by editable and read-only documents. */
export function createEditorCopyEventHandler(
  context: EditorCopyEventContext,
): (event: ClipboardEvent) => boolean {
  return (event) => {
    const ownership = context.resolveOwnership(event);
    if (ownership.kind !== "selection" || !event.clipboardData) return false;
    const snapshot = context.captureSelectionSnapshot(ownership);
    if (!snapshot) return false;
    if (!context.boundary.writeSelection(event.clipboardData, snapshot))
      return false;
    if (!claimEditorClipboardEvent(event, context.editorIdentity)) return false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return true;
  };
}

/** Coordinates one browser clipboard owner with concrete editor-web captures. */
export function createEditorClipboardEventHandlers(
  context: EditorClipboardEventContext,
): EditorClipboardEventHandlers {
  const claim = (event: ClipboardEvent): boolean => {
    if (!claimEditorClipboardEvent(event, context.editorIdentity)) return false;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    return true;
  };

  const copy = createEditorCopyEventHandler({
    editorIdentity: context.editorIdentity,
    boundary: context.boundary,
    resolveOwnership: context.ownership.resolve,
    captureSelectionSnapshot: context.ownership.captureSelectionSnapshot,
  });

  return Object.freeze({
    copy,

    cut(event: ClipboardEvent) {
      const ownership = context.ownership.resolve(event);
      if (ownership.kind !== "selection" || !event.clipboardData) return false;
      const captured = context.ownership.captureCutSelection(ownership);
      if (!captured) return false;
      if (
        !context.boundary.writeSelection(event.clipboardData, captured.snapshot)
      )
        return false;
      // Preflight keeps an already-stale capture unclaimed; the second check
      // revalidates after browser ownership has been claimed.
      if (!captured.isCurrent() || !claim(event)) return false;
      if (!captured.isCurrent()) return false;
      const result =
        captured.kind === "internal"
          ? captured.cut()
          : context.commands.cut(captured.range);
      return result.ok && result.changed !== false;
    },

    paste(event: ClipboardEvent) {
      if (event.defaultPrevented) return false;
      const ownership = context.ownership.resolve(event);
      if (ownership.kind === "none" || !event.clipboardData) return false;
      if (ownership.kind !== "selection") return false;
      const capture = context.ownership.captureSelection(ownership);
      const target: CapturedEditorClipboardPasteTarget | null = capture
        ? { kind: "selection", capture }
        : null;
      if (!target) return false;

      const isCurrent = () => target.capture.isCurrent();
      const fragment = context.boundary.readClipboardBlocks(
        event.clipboardData,
      );
      if (!fragment || !isCurrent() || !claim(event)) return false;
      const result = context.commands.paste(target, fragment);
      return result.ok && result.changed !== false;
    },
  });
}
