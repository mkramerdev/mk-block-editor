"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  SelectionCompositionSessionSnapshot,
  SelectionController,
} from "@repo/editor-react/selection";
import type { EditableEditorRuntimePort } from "../../../runtime/document/render-port.ts";
import {
  editorBlockShellSelector,
  editorEditableTextRootSelector,
} from "../../dom-markers.ts";
import { isEditorInteractiveControlTarget } from "../../interaction/interactive-targets.ts";
import { applyTextInsertionToCommittedSelection } from "./committed-selection-input.ts";

export interface UseCommittedSelectionTextInputOptions {
  readonly enabled: boolean;
  readonly listElement: HTMLElement | null;
  readonly editor: EditableEditorRuntimePort;
  readonly selectionController: SelectionController;
  readonly composition: SelectionCompositionSessionSnapshot | null;
}

interface CompositionHostLease {
  readonly revision: number;
  readonly hostBlockId: BlockId;
  released: boolean;
  finalizing: boolean;
}

type CompositionHostReleaseMode =
  | "accepted-change"
  | "restore-committed-projection";

/**
 * Owns the browser input state machine for committed global selection,
 * including the one composition host lease and the one final composition
 * commit owner.
 */
export function useCommittedSelectionTextInput({
  enabled,
  listElement,
  editor,
  selectionController,
  composition,
}: UseCommittedSelectionTextInputOptions): () => void {
  const hostLease = useRef<CompositionHostLease | null>(null);

  const releaseHost = useCallback(
    (revision: number, mode: CompositionHostReleaseMode): boolean => {
      const lease = hostLease.current;
      if (!lease || lease.revision !== revision || lease.released) return false;
      lease.released = true;
      hostLease.current = null;
      if (mode === "restore-committed-projection")
        editor.restoreCommittedTextProjectionAfterComposition(
          lease.hostBlockId,
        );
      editor.setTextCompositionPinned(lease.hostBlockId, false);
      return true;
    },
    [editor],
  );

  const cancelActiveComposition = useCallback(() => {
    const current = selectionController.getPresentationSnapshot().composition;
    if (!current) return;
    const view = editor.readActiveTextView();
    if (view?.composing) {
      const EventConstructor =
        view.dom.ownerDocument.defaultView?.CompositionEvent ?? Event;
      view.dom.dispatchEvent(
        new EventConstructor("compositionend", { bubbles: true }),
      );
    }
    releaseHost(current.revision, "restore-committed-projection");
    selectionController.cancelCompositionSession(current.revision);
  }, [editor, releaseHost, selectionController]);

  useEffect(() => {
    if (!enabled || !listElement) return;
    const doc = listElement.ownerDocument;

    const beforeInput = (event: InputEvent) => {
      if (!eventBelongsToEditorList(event, listElement)) return;
      if (isInteractiveEditorControlEvent(event, listElement)) return;
      if (selectionController.getPresentationSnapshot().composition) return;
      const committed = selectionController.getCommittedSnapshot();
      if (isMountedEditorTextInput(event, listElement)) return;
      const text = readCommittedSelectionTextFromBeforeInput(event);
      if (text === null) return;
      const selection = committed;
      if (!selection) return;
      const result = applyTextInsertionToCommittedSelection({
        editor,
        selection,
        text,
        expectedSelectionRevision: selection.revision,
        provenance: {
          kind: "typing",
          text,
          inputType:
            event.inputType === "insertReplacementText"
              ? "replacement"
              : event.inputType === "insertFromDictation"
                ? "dictation"
                : "text",
        },
      });
      if (!result.accepted) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };

    const startComposition = (event: CompositionEvent) => {
      if (!eventBelongsToEditorList(event, listElement)) return;
      if (isInteractiveEditorControlEvent(event, listElement)) return;
      const committedSelection = selectionController.getCommittedSnapshot();
      const canonicalSelection = committedSelection
        ? null
        : selectionController.getCanonicalSnapshot();
      const frozenSelection = committedSelection
        ? committedSelection
        : canonicalSelection?.kind === "document"
          ? canonicalSelection.snapshot
          : null;
      if (!frozenSelection) return;
      const target = event.target instanceof Element ? event.target : null;
      const shell = target?.closest<HTMLElement>(
        `${editorBlockShellSelector}[data-editor-block-id]`,
      );
      const focusBlockId =
        frozenSelection.endpoints.head?.blockId ??
        frozenSelection.endpoints.anchor?.blockId;
      const hostBlockId =
        (shell?.dataset.editorBlockId as BlockId | undefined) ?? focusBlockId;
      if (!hostBlockId || hostBlockId !== focusBlockId) return;
      if (!editor.isTextProjectionActive(hostBlockId)) return;

      const graphRevision = editor.getSelectionGraphRevision();
      const baseTokens = frozenSelection.blocks.flatMap((selected) => {
        const block = editor.getBlock(selected.blockId);
        return !block || block.tombstone
          ? []
          : [
              editor.contentRuntime.readContentBaseToken(
                block.id,
                block.type,
                graphRevision,
              ),
            ];
      });
      if (baseTokens.length !== frozenSelection.blocks.length) return;
      const session = selectionController.beginCompositionSession({
        frozenSelection,
        graphRevision,
        baseTokens,
        hostBlockId,
      });
      if (!session) return;

      const previous = hostLease.current;
      if (previous)
        releaseHost(previous.revision, "restore-committed-projection");
      const lease: CompositionHostLease = {
        revision: session.revision,
        hostBlockId,
        released: false,
        finalizing: false,
      };
      hostLease.current = lease;
      editor.setTextCompositionPinned(hostBlockId, true);
    };

    const finalizeComposition = (revision: number) => {
      const lease = hostLease.current;
      const current = selectionController.getPresentationSnapshot().composition;
      if (
        !lease ||
        lease.revision !== revision ||
        lease.released ||
        current?.revision !== revision
      )
        return;
      lease.finalizing = true;
      const completed =
        selectionController.completeCompositionSession(revision);
      if (!completed) {
        lease.finalizing = false;
        return;
      }
      if (!completed.hasUnpublishedDraft || completed.latestText === null) {
        releaseHost(revision, "restore-committed-projection");
        return;
      }
      const result = applyTextInsertionToCommittedSelection({
        editor,
        selection: completed.frozenSelection,
        text: completed.latestText,
        expectedSelectionRevision: completed.selectionRevision,
        expectedContentBases: completed.baseTokens,
        provenance: {
          kind: "typing",
          text: completed.latestText,
          inputType: "composition",
        },
      });
      releaseHost(
        revision,
        result.accepted && result.changed
          ? "accepted-change"
          : "restore-committed-projection",
      );
    };

    const completeComposition = (event: CompositionEvent) => {
      if (!eventBelongsToEditorList(event, listElement)) return;
      const revision =
        selectionController.getPresentationSnapshot().composition?.revision;
      if (revision === undefined) return;
      // The capture listener runs before ProseMirror's compositionend work.
      // A second microtask lets any final proposal update the draft first.
      queueMicrotask(() => queueMicrotask(() => finalizeComposition(revision)));
    };

    const cancelComposition = (event: Event) => {
      if (!eventBelongsToEditorList(event, listElement)) return;
      cancelActiveComposition();
    };

    const escapeFallback = (event: KeyboardEvent) => {
      if (!eventBelongsToEditorList(event, listElement)) return;
      if (event.key !== "Escape") return;
      const revision =
        selectionController.getPresentationSnapshot().composition?.revision;
      if (revision === undefined) return;
      queueMicrotask(() => {
        const current =
          selectionController.getPresentationSnapshot().composition;
        if (current?.revision !== revision) return;
        selectionController.cancelCompositionSession(revision);
        releaseHost(revision, "restore-committed-projection");
      });
    };

    doc.addEventListener("beforeinput", beforeInput, true);
    doc.addEventListener("compositionstart", startComposition, true);
    doc.addEventListener("compositionend", completeComposition, true);
    doc.addEventListener("compositioncancel", cancelComposition, true);
    doc.addEventListener("keydown", escapeFallback, true);
    return () => {
      doc.removeEventListener("beforeinput", beforeInput, true);
      doc.removeEventListener("compositionstart", startComposition, true);
      doc.removeEventListener("compositionend", completeComposition, true);
      doc.removeEventListener("compositioncancel", cancelComposition, true);
      doc.removeEventListener("keydown", escapeFallback, true);
      const lease = hostLease.current;
      if (!lease) return;
      const current = selectionController.getPresentationSnapshot().composition;
      if (current?.revision === lease.revision)
        selectionController.cancelCompositionSession(lease.revision);
      releaseHost(lease.revision, "restore-committed-projection");
    };
  }, [
    cancelActiveComposition,
    editor,
    enabled,
    listElement,
    releaseHost,
    selectionController,
  ]);

  useLayoutEffect(() => {
    if (!enabled) return;
    const lease = hostLease.current;
    if (
      !lease ||
      lease.released ||
      lease.finalizing ||
      composition?.revision === lease.revision
    )
      return;
    releaseHost(lease.revision, "restore-committed-projection");
  }, [composition, enabled, releaseHost]);

  return cancelActiveComposition;
}

function eventBelongsToEditorList(
  event: Event,
  listElement: HTMLElement,
): boolean {
  return event.composedPath().includes(listElement);
}

function isInteractiveEditorControlEvent(
  event: Event,
  listElement: HTMLElement,
): boolean {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return false;
  if (target.closest(editorEditableTextRootSelector)) return false;
  return (
    isEditorInteractiveControlTarget(target, listElement) ||
    target.closest("[contenteditable='true']") !== null
  );
}

function isMountedEditorTextInput(
  event: InputEvent,
  listElement: HTMLElement,
): boolean {
  const target = event.target instanceof Element ? event.target : null;
  const textRoot = target?.closest<HTMLElement>(editorEditableTextRootSelector);
  if (!textRoot || !listElement.contains(textRoot)) return false;
  const selection = textRoot.ownerDocument.getSelection();
  const anchorNode = selection?.anchorNode ?? null;
  const focusNode = selection?.focusNode ?? null;
  return Boolean(
    anchorNode &&
    focusNode &&
    textRoot.contains(anchorNode) &&
    textRoot.contains(focusNode),
  );
}

export function readCommittedSelectionTextFromBeforeInput(
  event: InputEvent,
): string | null {
  if (event.defaultPrevented || event.isComposing) return null;
  switch (event.inputType) {
    case "insertText":
    case "insertReplacementText":
    case "insertFromDictation":
      return typeof event.data === "string" ? event.data : null;
    default:
      return null;
  }
}
