"use client";

import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import {
  resolveCommittedSelectionSnapshotTextAnchors,
  resolveStructuralEditRange,
  type EditorSelectionTextAnchorResolver,
  type SelectionController,
} from "@repo/editor-react/selection";
import type { EditorContentRuntime } from "@repo/editor-core/content";
import type { EditableEditorDefinition } from "../../../runtime/definition/contracts.ts";
import type { EditableEditorRuntimePort } from "../../../runtime/document/render-port.ts";
import type { EditorBlockDomRegistryReader } from "../../blocks/block-dom-registry.ts";
import { resolveWebSelectionTextAnchorPoint } from "../anchors/text-anchor.ts";
import type {
  CaptureStructuralSelection,
  CapturedStructuralSelection,
} from "./browser-selection-types.ts";
import type { SelectionCompositionSessionSnapshot } from "@repo/editor-react/selection";
import type { NativeSelectionPaintMode } from "@repo/editor-react/selection";
import { useCanonicalCopyEvents } from "./use-canonical-copy-events.ts";
import { useNativeSelectionSynchronization } from "./native-selection-synchronization.ts";

export interface UseGlobalSelectionOptions {
  readonly definition: EditableEditorDefinition;
  readonly listElement: HTMLDivElement | null;
  readonly blockDom: EditorBlockDomRegistryReader;
  readonly editor: EditableEditorRuntimePort;
  readonly contentRuntime: EditorContentRuntime;
  readonly selectionController: SelectionController;
}

export interface GlobalSelectionRuntime {
  readonly textAnchorResolver: EditorSelectionTextAnchorResolver;
  readonly captureStructuralSelection: CaptureStructuralSelection;
  readonly composition: SelectionCompositionSessionSnapshot | null;
}

interface NativeSelectionPresentation {
  readonly nativeSelectionPaintMode: NativeSelectionPaintMode;
  readonly composition: SelectionCompositionSessionSnapshot | null;
}

/** Composes the four browser boundaries around the editor-owned controller. */
export function useGlobalSelection(
  options: UseGlobalSelectionOptions,
): GlobalSelectionRuntime {
  const presentation = useNativeSelectionPresentation(
    options.selectionController,
  );
  const textAnchorResolver = useMemo<EditorSelectionTextAnchorResolver>(
    () => ({
      resolveTextAnchor: (point) => {
        const resolved = resolveWebSelectionTextAnchorPoint(
          point,
          options.editor,
          options.contentRuntime,
        );
        if (
          resolved.ok ||
          (resolved.reason !== "missing-text" &&
            resolved.reason !== "invalid") ||
          !point.textAnchor
        ) {
          return resolved;
        }
        return {
          ok: true,
          blockId: point.blockId,
          textAnchor: point.textAnchor,
          textOffset: point.textOffset,
          affinity: point.affinity,
        };
      },
    }),
    [options.contentRuntime, options.editor],
  );
  const captureStructuralSelection = useCaptureStructuralSelection(
    options,
    textAnchorResolver,
  );

  useNativeSelectionSynchronization({
    listElement: options.listElement,
    editor: options.editor,
    contentRuntime: options.contentRuntime,
    selectionController: options.selectionController,
    presentation,
    textAnchorResolver,
  });
  useCanonicalCopyEvents({
    listElement: options.listElement,
    definition: options.definition,
    editor: options.editor,
    contentRuntime: options.contentRuntime,
    selectionController: options.selectionController,
    textAnchorResolver,
    captureStructuralSelection,
  });
  return {
    textAnchorResolver,
    captureStructuralSelection,
    composition: presentation.composition,
  };
}

function useNativeSelectionPresentation(
  selectionController: SelectionController,
): NativeSelectionPresentation {
  const snapshotRef = useRef<NativeSelectionPresentation | null>(null);
  const read = useCallback(() => {
    const current = selectionController.getPresentationSnapshot();
    const previous = snapshotRef.current;
    if (
      previous?.nativeSelectionPaintMode === current.nativeSelectionPaintMode &&
      previous.composition === current.composition
    ) {
      return previous;
    }
    const next: NativeSelectionPresentation = {
      nativeSelectionPaintMode: current.nativeSelectionPaintMode,
      composition: current.composition,
    };
    snapshotRef.current = next;
    return next;
  }, [selectionController]);
  return useSyncExternalStore(selectionController.subscribe, read, read);
}

function useCaptureStructuralSelection(
  options: UseGlobalSelectionOptions,
  textAnchorResolver: EditorSelectionTextAnchorResolver,
): CaptureStructuralSelection {
  return useCallback(
    (captured): CapturedStructuralSelection | null => {
      if (!options.selectionController.isCommittedSnapshotCurrent(captured))
        return null;
      const graphRevision = options.editor.getSelectionGraphRevision();
      const resolved = resolveCommittedSelectionSnapshotTextAnchors({
        captured,
        graph: options.editor,
        graphRevision,
        textAnchorResolver,
      });
      if (!resolved.ok) return null;
      const genericRange = resolveStructuralEditRange({
        snapshot: resolved.snapshot,
        graph: options.editor,
        graphRevision,
        blockDefinitions: options.definition.blocks,
        readBlockContent: (blockId, blockType) =>
          options.contentRuntime.readBlockProjection(blockId, blockType),
      });
      const range = genericRange
        ? (options.definition.selectionFragment?.resolveStructuralEditRange?.({
            snapshot: resolved.snapshot,
            range: genericRange,
            graph: options.editor,
            readBlockContent: (blockId, blockType) =>
              options.contentRuntime.readBlockProjection(blockId, blockType),
          }) ?? genericRange)
        : null;
      if (!range) return null;
      return {
        captured,
        snapshot: resolved.snapshot,
        range,
        graphRevision,
        isCurrent: () =>
          !options.editor.isDisposed() &&
          options.editor.getSelectionGraphRevision() === graphRevision &&
          options.selectionController.isCommittedSnapshotCurrent(captured),
      };
    },
    [
      options.contentRuntime,
      options.definition.blocks,
      options.definition.selectionFragment,
      options.editor,
      options.selectionController,
      textAnchorResolver,
    ],
  );
}
