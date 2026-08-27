"use client";

import { useEffect, useMemo } from "react";
import {
  executeStructuralEditComposition,
  resolveCanonicalEditComposition,
} from "@repo/editor-react/editor";
import {
  materializeEditorSelectionFragmentCandidate,
  type EditorSelectionTextAnchorResolver,
  type SelectionController,
} from "@repo/editor-react/selection";
import type { EditorContentRuntimeResources } from "../../../runtime/content/runtime-resources.ts";
import type { EditorContentRuntime } from "@repo/editor-core/content";
import {
  createCollisionSafeBlockIdAllocator,
  reidentifyCanonicalBlockFragment,
} from "@repo/editor-core/editing";
import type { EditableEditorDefinition } from "../../../runtime/definition/contracts.ts";
import type { EditableEditorRuntimePort } from "../../../runtime/document/render-port.ts";
import { createDefinitionClipboardBoundary } from "../../../clipboard/editor-boundary.ts";
import type { CaptureStructuralSelection } from "./browser-selection-types.ts";
import { createEditorClipboardEventHandlers } from "./clipboard-event-coordinator.ts";
import { resolveEditorClipboardEventOwnership } from "./clipboard-event-ownership.ts";

export interface UseEditableClipboardEventsOptions {
  readonly listElement: HTMLElement | null;
  readonly definition: EditableEditorDefinition;
  readonly contentResources: EditorContentRuntimeResources;
  readonly editor: EditableEditorRuntimePort;
  readonly contentRuntime: EditorContentRuntime;
  readonly selectionController: SelectionController;
  readonly textAnchorResolver: EditorSelectionTextAnchorResolver;
  readonly captureStructuralSelection: CaptureStructuralSelection;
}

/** Owns editable-only cut and paste. Canonical copy is mounted by common runtime. */
export function useEditableClipboardEvents({
  listElement,
  definition,
  contentResources,
  editor,
  contentRuntime,
  selectionController,
  textAnchorResolver,
  captureStructuralSelection,
}: UseEditableClipboardEventsOptions): void {
  const clipboardSchema = contentResources.proseMirrorSchema;
  const boundary = useMemo(
    () =>
      createDefinitionClipboardBoundary({
        compiledDefinition: editor.compiledDefinition,
        schema: clipboardSchema,
        materializeSelection: (snapshot) => {
          const committed = selectionController.getCommittedSnapshot();
          if (
            committed?.kind === "block-internal" &&
            committed.internal &&
            committed.owner.kind === "block-internal"
          ) {
            const subsystemId = committed.internal.subsystem.id;
            const handler =
              editor.compiledDefinition.contentCodecs.internalSelectionFragmentMaterializers.find(
                (candidate) => candidate.subsystemId === subsystemId,
              );
            const fragment = handler?.materialize({
              hostBlockId: committed.internal.blockId,
              selection: committed.internal.snapshot,
              getBlock: (blockId) => editor.getBlock(blockId),
              getChildBlockIds: (parentId) => editor.getChildBlockIds(parentId),
              getParentId: (blockId) => editor.getParentId(blockId),
              readBlockContent: (blockId, blockType) =>
                contentRuntime.readBlockProjection(blockId, blockType),
            });
            if (fragment) return fragment;
          }
          const materialized = materializeEditorSelectionFragmentCandidate({
            snapshot,
            graph: editor,
            graphRevision: editor.getSelectionGraphRevision(),
            readBlockContent: (blockId, blockType) =>
              contentRuntime.readBlockProjection(blockId, blockType),
            readBlockPlainText: (blockId, blockType) =>
              contentRuntime.readBlockPlainText(blockId, blockType),
            textAnchorResolver,
            blockDefinitions: definition.blocks,
            resolveVisibleChildBlockIds:
              definition.selectionFragment?.resolveVisibleChildBlockIds,
          });
          return materialized.ok ? materialized.candidate : null;
        },
      }),
    [
      clipboardSchema,
      contentRuntime,
      definition,
      editor,
      selectionController,
      textAnchorResolver,
    ],
  );

  useEffect(() => {
    if (!listElement || !boundary) return;
    const doc = listElement.ownerDocument;
    const resolveOwnership = (event: Event) =>
      resolveEditorClipboardEventOwnership({
        event,
        editorIdentity: editor,
        list: listElement,
        committedSelection: selectionController.getCommittedSnapshot(),
        isCommittedSelectionCurrent: (snapshot) =>
          selectionController.isCommittedSnapshotCurrent(snapshot),
        resolveNativeFocusTarget: (target) =>
          editor.resolveNativeFocusTarget(target),
      });
    const captureSelectionSnapshot = (
      ownership: Extract<
        ReturnType<typeof resolveEditorClipboardEventOwnership>,
        { kind: "selection" }
      >,
    ) => {
      const committed = selectionController.getCommittedSnapshot();
      if (
        committed?.kind === "block-internal" &&
        selectionController.isCommittedSnapshotCurrent(committed)
      ) {
        return committed.documentSelection;
      }
      return captureStructuralSelection(ownership.selection)?.snapshot ?? null;
    };
    const captureSelection = (
      ownership: Extract<
        ReturnType<typeof resolveEditorClipboardEventOwnership>,
        { kind: "selection" }
      >,
    ) => captureStructuralSelection(ownership.selection);
    const captureCutSelection = (
      ownership: Extract<
        ReturnType<typeof resolveEditorClipboardEventOwnership>,
        { kind: "selection" }
      >,
    ) => {
      const committed = selectionController.getCommittedSnapshot();
      if (
        committed?.kind === "block-internal" &&
        committed.internal &&
        committed.owner.kind === "block-internal" &&
        selectionController.isCommittedSnapshotCurrent(committed)
      ) {
        const handler =
          editor.compiledDefinition.contentCodecs.internalSelectionCutHandlers.find(
            (candidate) =>
              candidate.subsystemId === committed.internal!.subsystem.id,
          );
        if (!handler) return null;
        return {
          kind: "internal" as const,
          snapshot: committed.documentSelection,
          isCurrent: () =>
            selectionController.isCommittedSnapshotCurrent(committed),
          cut: () =>
            handler.cut({
              hostBlockId: committed.internal!.blockId,
              selection: committed.internal!.snapshot,
              editor,
            }),
        };
      }
      const structural = captureStructuralSelection(ownership.selection);
      return structural ? { kind: "structural" as const, ...structural } : null;
    };
    const commands = {
      cut: (range: import("@repo/editor-core/editing").StructuralEditRange) => {
        const productPlan =
          definition.selectionFragment?.planStructuralRangeDeletion?.({
            intent: "cut",
            range,
            graph: editor,
            readBlockContent: (blockId, blockType) =>
              contentRuntime.readBlockProjection(blockId, blockType),
          }) ?? null;
        return productPlan
          ? editor.executeStructuralTransaction(productPlan, {
              provenance: null,
              selectionPresentation: "native-before-removal",
            })
          : editor.executeStructuralRangeDeletion(range, {
          intent: "cut",
          provenance: null,
          selectionPresentation: "native-final-selection",
          resolveVisibleChildBlockIds:
            definition.selectionFragment?.resolveVisibleChildBlockIds,
            });
      },
      paste: (
        captured: NonNullable<ReturnType<typeof captureSelection>>,
        fragment: import("@repo/editor-core/editing").CanonicalBlockFragment,
      ) => {
        const idAllocator = createCollisionSafeBlockIdAllocator({
          reservedBlockIds: new Set(fragment.blocks.map((block) => block.id)),
          isBlockIdReserved: (blockId) => editor.getBlock(blockId) !== null,
          purpose: "clipboard paste",
        });
        let destinationFragment: typeof fragment;
        try {
          destinationFragment = reidentifyCanonicalBlockFragment({
            fragment,
            blockDefinitions: definition.blocks,
            allocateBlockId: idAllocator.allocateBlockId,
          });
        } catch {
          return { ok: false as const, changed: false as const };
        }
        const composition = resolveCanonicalEditComposition({
          graph: {
            blockDefinitions: definition.blocks,
            getBlock: (blockId) => editor.getBlock(blockId),
            getRootBlockIds: () => editor.getRootBlockIds(),
            getChildBlockIds: (parentId) => editor.getChildBlockIds(parentId),
            readBlockContent: (blockId, blockType) =>
              contentRuntime.readBlockProjection(blockId, blockType),
          },
          target: { kind: "selection" as const, range: captured.range },
          fragment: destinationFragment,
          allocateBlockId: idAllocator.allocateBlockId,
        });
        const result = composition
          ? executeStructuralEditComposition(editor, composition, {
              provenance: null,
            })
          : { ok: false, changed: false };
        if (result.ok && result.changed) {
          const canonical = selectionController.getCanonicalSnapshot();
          const focus =
            canonical.kind === "none"
              ? null
              : canonical.snapshot.documentSelection.focus;
          if (focus?.textAnchor) {
            editor.requestTextPresentation(focus.blockId, {
              offset: focus.textOffset,
              canonicalSelectionRevision: canonical.revision,
              affinity: focus.affinity,
              preventScroll: true,
            });
          }
        }
        return result;
      },
    };
    const handlers = createEditorClipboardEventHandlers({
      editorIdentity: editor,
      boundary,
      ownership: {
        resolve: resolveOwnership,
        captureSelectionSnapshot,
        captureSelection,
        captureCutSelection,
      },
      commands: {
        cut: commands.cut,
        paste: (target, fragment) => commands.paste(target.capture, fragment),
      },
    });
    const cutCapture = (event: ClipboardEvent) => {
      handlers.cut(event);
    };
    const pasteCapture = (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // Block-internal hosts retain first refusal through their React capture
      // boundary. Every ordinary editor paste is claimed before ProseMirror,
      // so native text insertion and the canonical structural command cannot
      // both apply the same clipboard payload.
      if (target?.closest('[data-editor-block-internal-selection-host="true"]'))
        return;
      handlers.paste(event);
    };
    const pasteBubble = (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (
        !target?.closest(
          '[data-editor-block-internal-selection-host="true"]',
        )
      ) {
        return;
      }
      handlers.paste(event);
    };
    doc.addEventListener("cut", cutCapture, true);
    doc.addEventListener("paste", pasteCapture, true);
    doc.addEventListener("paste", pasteBubble);
    return () => {
      doc.removeEventListener("cut", cutCapture, true);
      doc.removeEventListener("paste", pasteCapture, true);
      doc.removeEventListener("paste", pasteBubble);
    };
  }, [
    boundary,
    captureStructuralSelection,
    contentRuntime,
    definition,
    definition.blocks,
    editor,
    listElement,
    selectionController,
  ]);
}
