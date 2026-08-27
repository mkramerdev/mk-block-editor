"use client";

import { useEffect, useMemo } from "react";
import {
  materializeEditorSelectionFragmentCandidate,
  type EditorSelectionTextAnchorResolver,
  type SelectionController,
} from "@repo/editor-react/selection";
import type { EditorContentRuntime } from "@repo/editor-core/content";
import type { EditableEditorDefinition } from "../../../runtime/definition/contracts.ts";
import type { EditableEditorRuntimePort } from "../../../runtime/document/render-port.ts";
import { createEditorClipboardBoundary } from "../../../clipboard/boundary.ts";
import { createEditorCopyEventHandler } from "./clipboard-event-coordinator.ts";
import { resolveEditorClipboardEventOwnership } from "./clipboard-event-ownership.ts";
import type { CaptureStructuralSelection } from "./browser-selection-types.ts";

export function useCanonicalCopyEvents(options: {
  readonly listElement: HTMLElement | null;
  readonly definition: EditableEditorDefinition;
  readonly editor: EditableEditorRuntimePort;
  readonly contentRuntime: EditorContentRuntime;
  readonly selectionController: SelectionController;
  readonly textAnchorResolver: EditorSelectionTextAnchorResolver;
  readonly captureStructuralSelection: CaptureStructuralSelection;
}): void {
  const writer = useMemo(() => {
    const codecs = options.editor.compiledDefinition.contentCodecs;
    return options.definition.contentImport
      ? createEditorClipboardBoundary({
          blockDefinitions: options.definition.blocks,
          plainTextImportBlockType:
            options.definition.contentImport.plainTextBlockType,
          inlineMarks: options.definition.inlineMarks,
          htmlExportHandlers: codecs.htmlExportHandlers,
          plainTextImportHandlers: codecs.plainTextImportHandlers,
          plainTextExportHandlers: codecs.plainTextExportHandlers,
          materializeSelection: (snapshot) => {
            const committed =
              options.selectionController.getCommittedSnapshot();
            if (
              committed?.kind === "block-internal" &&
              committed.internal &&
              committed.owner.kind === "block-internal"
            ) {
              const handler =
                codecs.internalSelectionFragmentMaterializers.find(
                  (candidate) =>
                    candidate.subsystemId === committed.internal!.subsystem.id,
                );
              const fragment = handler?.materialize({
                hostBlockId: committed.internal.blockId,
                selection: committed.internal.snapshot,
                getBlock: (blockId) => options.editor.getBlock(blockId),
                getChildBlockIds: (parentId) =>
                  options.editor.getChildBlockIds(parentId),
                getParentId: (blockId) => options.editor.getParentId(blockId),
                readBlockContent: (blockId, blockType) =>
                  options.contentRuntime.readBlockProjection(
                    blockId,
                    blockType,
                  ),
              });
              if (fragment) return fragment;
            }
            const materialized = materializeEditorSelectionFragmentCandidate({
              snapshot,
              graph: options.editor,
              graphRevision: options.editor.getSelectionGraphRevision(),
              readBlockContent: (blockId, blockType) =>
                options.contentRuntime.readBlockProjection(blockId, blockType),
              readBlockPlainText: (blockId, blockType) =>
                options.contentRuntime.readBlockPlainText(blockId, blockType),
              textAnchorResolver: options.textAnchorResolver,
              blockDefinitions: options.definition.blocks,
              resolveVisibleChildBlockIds:
                options.definition.selectionFragment
                  ?.resolveVisibleChildBlockIds,
            });
            return materialized.ok ? materialized.candidate : null;
          },
        })
      : null;
  }, [
    options.contentRuntime,
    options.definition,
    options.editor,
    options.selectionController,
    options.textAnchorResolver,
  ]);

  useEffect(() => {
    const listElement = options.listElement;
    if (!listElement || !writer) return;
    const doc = listElement.ownerDocument;
    const resolveOwnership = (event: ClipboardEvent) =>
      resolveEditorClipboardEventOwnership({
        event,
        editorIdentity: options.editor,
        list: listElement,
        committedSelection: options.selectionController.getCommittedSnapshot(),
        isCommittedSelectionCurrent: (snapshot) =>
          options.selectionController.isCommittedSnapshotCurrent(snapshot),
        resolveNativeFocusTarget: (target) =>
          options.editor.resolveNativeFocusTarget(target),
      });
    const copy = createEditorCopyEventHandler({
      editorIdentity: options.editor,
      boundary: writer,
      resolveOwnership,
      captureSelectionSnapshot: (ownership) => {
        const committed = options.selectionController.getCommittedSnapshot();
        if (
          committed?.kind === "block-internal" &&
          options.selectionController.isCommittedSnapshotCurrent(committed)
        ) {
          return committed.documentSelection;
        }
        return (
          options.captureStructuralSelection(ownership.selection)?.snapshot ??
          null
        );
      },
    });
    doc.addEventListener("copy", copy, true);
    return () => doc.removeEventListener("copy", copy, true);
  }, [options, writer]);
}
