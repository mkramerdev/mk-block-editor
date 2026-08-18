"use client";

import { useEffect, useMemo } from "react";
import {
  executeStructuralEditComposition,
  resolveCanonicalEditComposition,
} from "@repo/editor-react/editor";
import {
  materializeEditorSelectionFragment,
  type EditorSelectionTextAnchorResolver,
  type SelectionController,
} from "@repo/editor-react/selection";
import type { EditorContentRuntimeResources } from "../../../runtime/content/runtime-resources.ts";
import type { EditorWebContentRuntime } from "../../../runtime/content/content-runtime.ts";
import type { EditorDefinition } from "../../../runtime/definition/contracts.ts";
import type { EditableEditorRuntimePort } from "../../../runtime/document/render-port.ts";
import { createDefinitionClipboardBoundary } from "../../../clipboard/editor-boundary.ts";
import type { CaptureStructuralSelection } from "./browser-selection-types.ts";
import { createEditorClipboardEventHandlers } from "./clipboard-event-coordinator.ts";
import { resolveEditorClipboardEventOwnership } from "./clipboard-event-ownership.ts";

const fallbackClipboardByEditor = new WeakMap<object, DataTransfer>();

export interface UseEditableClipboardEventsOptions {
  readonly listElement: HTMLElement | null;
  readonly definition: EditorDefinition;
  readonly contentResources: EditorContentRuntimeResources;
  readonly editor: EditableEditorRuntimePort;
  readonly contentRuntime: EditorWebContentRuntime;
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
            const handler = editor.compiledDefinition.contentCodecs
              .internalSelectionFragmentMaterializers.find(
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
              blockDefinitions: definition.blocks,
            });
            if (fragment) return { ok: true as const, fragment };
          }
          return materializeEditorSelectionFragment({
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
        ownsNativeTarget: (target) => editor.ownsNativeFocusTarget(target),
        ownsActiveElement: (document) => editor.ownsActiveElement(document),
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
        const handler = editor.compiledDefinition.contentCodecs
          .internalSelectionCutHandlers.find(
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
      cut: (range: import("@repo/editor-core/editing").StructuralEditRange) =>
        editor.executeStructuralRangeDeletion(range, {
          intent: "cut",
          provenance: null,
          selectionPresentation: "native-final-selection",
          resolveVisibleChildBlockIds:
            definition.selectionFragment?.resolveVisibleChildBlockIds,
        }),
      paste: (
        captured: NonNullable<ReturnType<typeof captureSelection>>,
        fragment: import("@repo/editor-core/editing").CanonicalBlockFragment,
      ) => {
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
          fragment,
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
    let nativeCutCompleted = false;
    let nativePasteCompleted = false;
    const keyDown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        (!event.ctrlKey && !event.metaKey)
      )
        return;
      const key = event.key.toLowerCase();
      if (key !== "c" && key !== "x" && key !== "v") return;
      const ownership = resolveOwnership(event);
      if (ownership.kind !== "selection") return;

      if (key === "c") {
        const snapshot = captureSelectionSnapshot(ownership);
        const memory = createMemoryClipboardData();
        if (snapshot && boundary.writeSelection(memory, snapshot)) {
          fallbackClipboardByEditor.set(editor, memory);
        }
        return;
      }
      if (key === "x") {
        nativeCutCompleted = false;
        const captured = captureCutSelection(ownership);
        const memory = createMemoryClipboardData();
        if (!captured || !boundary.writeSelection(memory, captured.snapshot)) {
          return;
        }
        fallbackClipboardByEditor.set(editor, memory);
        if (!captured.isCurrent()) return;
        if (editor.ownsActiveElement(doc)) {
          if (captured.kind === "internal") captured.cut();
          else commands.cut(captured.range);
          return;
        }
        return;
      }
      const captured = captureSelection(ownership);
      const memory = fallbackClipboardByEditor.get(editor) ?? null;
      if (!captured || !memory) return;
      const fragment = boundary.readClipboardBlocks(memory);
      if (!fragment) return;
      if (!captured.isCurrent()) return;
      event.preventDefault();
      nativePasteCompleted = commands.paste(captured, fragment).ok;
    };
    const cutCapture = (event: ClipboardEvent) => {
      nativeCutCompleted = handlers.cut(event) || nativeCutCompleted;
    };
    const pasteCapture = (event: ClipboardEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // Block-internal hosts retain first refusal through their React capture
      // boundary. Every ordinary editor paste is claimed before ProseMirror,
      // so native text insertion and the canonical structural command cannot
      // both apply the same clipboard payload.
      if (target?.closest('[data-editor-block-internal-selection-host="true"]'))
        return;
      nativePasteCompleted = handlers.paste(event) || nativePasteCompleted;
    };
    const pasteBubble = (event: ClipboardEvent) => {
      nativePasteCompleted = handlers.paste(event) || nativePasteCompleted;
    };
    doc.addEventListener("cut", cutCapture, true);
    doc.addEventListener("paste", pasteCapture, true);
    doc.addEventListener("paste", pasteBubble);
    doc.addEventListener("keydown", keyDown, true);
    return () => {
      doc.removeEventListener("cut", cutCapture, true);
      doc.removeEventListener("paste", pasteCapture, true);
      doc.removeEventListener("paste", pasteBubble);
      doc.removeEventListener("keydown", keyDown, true);
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

function createMemoryClipboardData(): DataTransfer {
  const values = new Map<string, string>();
  return {
    get types() {
      return [...values.keys()];
    },
    getData: (format: string) => values.get(format) ?? "",
    setData: (format: string, value: string) => {
      values.set(format, value);
    },
  } as unknown as DataTransfer;
}
