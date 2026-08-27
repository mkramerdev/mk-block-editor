"use client";

import { useCallback, useLayoutEffect } from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  createEditorLogicalSelectionPoint,
  isEditorSelectionTextAnchor,
  readEditorBlockSelectionTarget,
  type EditorBlockSelectionTarget,
  type EditorLogicalSelectionPoint,
  type NativeSelectionPaintMode,
  type EditorSelectionTextAnchorResolver,
  type SelectionController,
  type SelectionCompositionSessionSnapshot,
} from "@repo/editor-react/selection";
import type { EditorContentRuntime } from "@repo/editor-core/content";
import type { EditableEditorRuntimePort } from "../../../runtime/document/render-port.ts";
import {
  editorBlockShellSelector,
  editorEditableTextRootSelector,
  editorTextRootSelector,
  isInSameEditorInteractionScope,
} from "../../dom-markers.ts";
import { isEditorInteractiveControlTarget } from "../../interaction/interactive-targets.ts";
import { createWebSelectionTextAnchorAtOffset } from "../anchors/text-anchor.ts";
import type { EditorBlockContentLease } from "@repo/editor-core/content";
import { textOffsetFromDomPoint } from "../hit-testing/text-hit-testing.ts";
import {
  applyNativeSelectionPaintMode,
  clearNativeSelectionPaintMode,
} from "./selection-paint.ts";
import {
  claimEditorNativeSelectionOwnership,
  editorMayImportNativeSelection,
  registerEditorNativeSelectionOwnership,
} from "./native-selection-ownership.ts";

export interface UseNativeSelectionSynchronizationOptions {
  readonly listElement: HTMLElement | null;
  readonly editor: EditableEditorRuntimePort;
  readonly contentRuntime: EditorContentRuntime;
  readonly selectionController: SelectionController;
  readonly presentation: {
    readonly nativeSelectionPaintMode: NativeSelectionPaintMode;
    readonly composition: SelectionCompositionSessionSnapshot | null;
  };
  readonly textAnchorResolver: EditorSelectionTextAnchorResolver;
}

/**
 * Owns the browser Selection boundary. Collapsed active-view carets update the
 * canonical mirror. Non-collapsed ranges only acknowledge an exact canonical
 * projection; divergent browser ranges are reconciled without publication.
 */
export function useNativeSelectionSynchronization({
  listElement,
  editor,
  contentRuntime,
  selectionController,
  presentation,
  textAnchorResolver,
}: UseNativeSelectionSynchronizationOptions): void {
  const commitBrowserSelection = useCallback(() => {
    const list = listElement;
    const currentPresentation = selectionController.getPresentationSnapshot();
    if (!list || currentPresentation.composition) return;
    if (list.dataset.editorCanonicalSelectionClearPending === "true") return;
    if (!editorMayImportNativeSelection(list)) return;
    if (nativeInteractiveControlOwnsSelection(list)) return;
    const selection = list.ownerDocument.getSelection();
    if (!selection?.anchorNode || !selection.focusNode) return;
    if (
      !list.contains(selection.anchorNode) ||
      !list.contains(selection.focusNode)
    )
      return;

    const canonicalPointerOwnsSelection =
      list.dataset.editorNativeCaretPointerPending === "true" ||
      selectionController.endpoint.getSnapshot().phase === "dragging";
    if (canonicalPointerOwnsSelection) {
      if (
        !selection.isCollapsed &&
        domSelectionTouchesEditableTextRoot(selection, list)
      ) {
        // Browser engines can still report a compatibility-mouse range even
        // when the canonical pointer boundary canceled its default actions.
        // Collapse it synchronously inside selectionchange, before the next
        // paint, without publishing or disturbing the in-progress endpoints.
        restoreCanonicalInputProjection(list, editor, selectionController);
      }
      return;
    }

    const canonical = selectionController.getCanonicalSnapshot();
    const editableTextSelection = domSelectionTouchesEditableTextRoot(
      selection,
      list,
    );
    if (
      editableTextSelection &&
      domSelectionMatchesCanonicalInputProjection(
        selection,
        list,
        selectionController,
        editor,
      )
    ) {
      return;
    }
    if (editableTextSelection && !selection.isCollapsed) {
      if (canonical.kind === "document") {
        restoreCanonicalInputProjection(list, editor, selectionController);
      } else {
        selection.removeAllRanges();
      }
      return;
    }

    if (
      currentPresentation.nativeSelectionPaintMode ===
        "hidden-for-global-selection" &&
      canonical.kind !== "block-internal" &&
      !editableTextSelection
    )
      return;
    const leases = new Map<BlockId, EditorBlockContentLease>();
    try {
      const anchor = logicalPointFromDomSelection(
        selection.anchorNode,
        selection.anchorOffset,
        editor,
        contentRuntime,
        selectionController,
        leases,
        selection.isCollapsed,
        editableTextSelection && selection.isCollapsed,
      );
      const focus = selection.isCollapsed
        ? anchor
        : logicalPointFromDomSelection(
            selection.focusNode,
            selection.focusOffset,
            editor,
            contentRuntime,
            selectionController,
            leases,
            false,
            false,
          );
      if (!anchor || !focus) return;
      const graphRevision = editor.getSelectionGraphRevision();
      selectionController.commitCanonicalSelection(
        {
          direction: domSelectionDirection(selection),
          anchor,
          focus,
        },
        editor,
        graphRevision,
        {
          publication: { kind: "standalone-local" },
          cause: canonical.kind === "none" ? "focus" : "keyboard",
        },
        textAnchorResolver,
      );
    } finally {
      for (const lease of leases.values()) lease.release();
    }
  }, [
    contentRuntime,
    editor,
    listElement,
    selectionController,
    textAnchorResolver,
  ]);

  const reconcileFocusedTextSelection = useCallback(
    (target: EventTarget | null) => {
      const list = listElement;
      if (!list || !(target instanceof Element)) return;
      const textRoot = target.closest(editorEditableTextRootSelector);
      if (!textRoot || !list.contains(textRoot)) return;
      claimEditorNativeSelectionOwnership(list, "focus");
      const selection = list.ownerDocument.getSelection();
      if (
        selection?.anchorNode &&
        selection.focusNode &&
        domSelectionMatchesCanonicalInputProjection(
          selection,
          list,
          selectionController,
          editor,
        )
      ) {
        return;
      }
      restoreCanonicalInputProjection(list, editor, selectionController);
    },
    [editor, listElement, selectionController],
  );

  useLayoutEffect(() => {
    if (!listElement) return;
    const doc = listElement.ownerDocument;
    const unregisterNativeSelectionOwnership =
      registerEditorNativeSelectionOwnership(listElement);
    const selectionchange = () => commitBrowserSelection();
    const focusin = (event: FocusEvent) =>
      reconcileFocusedTextSelection(event.target);
    doc.addEventListener("selectionchange", selectionchange);
    listElement.addEventListener("focusin", focusin);
    return () => {
      doc.removeEventListener("selectionchange", selectionchange);
      listElement.removeEventListener("focusin", focusin);
      unregisterNativeSelectionOwnership();
    };
  }, [commitBrowserSelection, listElement, reconcileFocusedTextSelection]);

  useLayoutEffect(() => {
    if (!listElement) return;
    const reflectPresentation = () =>
      applyNativeSelectionPaintMode(
        listElement,
        selectionController.getPresentationSnapshot().nativeSelectionPaintMode,
      );
    reflectPresentation();
    const unsubscribe =
      selectionController.presentation.subscribe(reflectPresentation);
    return () => {
      unsubscribe();
      clearNativeSelectionPaintMode(listElement);
    };
  }, [listElement, selectionController]);

  useLayoutEffect(() => {
    if (!listElement) return;
    if (
      !presentation.composition &&
      selectionController.endpoint.getSnapshot().phase !== "dragging" &&
      presentation.nativeSelectionPaintMode === "hidden-for-global-selection" &&
      !nativeInteractiveControlOwnsSelection(listElement)
    )
      restoreCanonicalInputProjection(listElement, editor, selectionController);
  }, [editor, listElement, presentation, selectionController]);
}

function domSelectionMatchesCanonicalInputProjection(
  selection: Selection,
  list: HTMLElement,
  controller: SelectionController,
  editor: EditableEditorRuntimePort,
): boolean {
  if (!selection.anchorNode || !selection.focusNode) return false;
  const rootFor = (node: Node) =>
    (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(
      editorEditableTextRootSelector,
    ) ?? null;
  const anchorRoot = rootFor(selection.anchorNode);
  const focusRoot = rootFor(selection.focusNode);
  if (!anchorRoot || anchorRoot !== focusRoot || !list.contains(anchorRoot)) {
    return false;
  }
  const shell = anchorRoot.closest<HTMLElement>(
    `${editorBlockShellSelector}[data-editor-block-id]`,
  );
  const blockId = shell?.dataset.editorBlockId as BlockId | undefined;
  if (!shell || !blockId) return false;
  const anchorOffset = textOffsetFromDomPoint(
    anchorRoot,
    selection.anchorNode,
    selection.anchorOffset,
  );
  const focusOffset = selection.isCollapsed
    ? anchorOffset
    : textOffsetFromDomPoint(
        anchorRoot,
        selection.focusNode,
        selection.focusOffset,
      );
  const canonical = controller.getCanonicalSnapshot();
  if (
    anchorOffset === null ||
    focusOffset === null ||
    canonical.kind !== "document"
  ) {
    return false;
  }
  const canonicalSelection = canonical.snapshot.documentSelection;
  const anchor = canonicalSelection.anchor;
  const focus = canonicalSelection.focus;
  const projectedCrossBlockFocusCaret = Boolean(
    selection.isCollapsed &&
    anchor &&
    focus &&
    anchor.blockId !== focus.blockId &&
    focus.blockId === blockId &&
    focus.textOffset === focusOffset &&
    editor.acknowledgeTextActivation?.(
      blockId,
      anchorRoot,
      focusOffset,
      selection.focusNode,
      selection.focusOffset,
    ),
  );
  if (projectedCrossBlockFocusCaret) return true;
  const matches = Boolean(
    anchor &&
    focus &&
    anchor.blockId === blockId &&
    focus.blockId === blockId &&
    anchor.textOffset === anchorOffset &&
    focus.textOffset === focusOffset &&
    (selection.isCollapsed ||
      canonicalSelection.direction === domSelectionDirection(selection)),
  );
  if (matches) {
    editor.acknowledgeTextActivation?.(
      blockId,
      anchorRoot,
      focusOffset,
      selection.focusNode,
      selection.focusOffset,
    );
  }
  return matches;
}

function domSelectionTouchesEditableTextRoot(
  selection: Selection,
  list: HTMLElement,
): boolean {
  const nodes = [selection.anchorNode, selection.focusNode];
  return nodes.some((node) => {
    const element = node instanceof Element ? node : node?.parentElement;
    const root = element?.closest(editorEditableTextRootSelector);
    return Boolean(root && list.contains(root));
  });
}

function restoreCanonicalInputProjection(
  list: HTMLElement,
  editor: EditableEditorRuntimePort,
  controller: SelectionController,
): void {
  const canonical = controller.getCanonicalSnapshot();
  if (canonical.kind !== "document") return;
  const anchor = canonical.snapshot.documentSelection.anchor;
  const focus = canonical.snapshot.documentSelection.focus;
  if (!anchor || !focus || !pointUsesContentSelectionEndpoint(focus)) {
    return;
  }
  const nativeFocus = editor.resolveNativeFocusTarget(
    list.ownerDocument.activeElement,
  );
  if (nativeFocus?.kind !== "text" || nativeFocus.blockId !== focus.blockId)
    return;
  claimEditorNativeSelectionOwnership(list, "projection");
  editor.nativeSelectionSynchronization.reconcileTextSelection(
    focus.blockId,
    anchor.blockId === focus.blockId ? anchor.textOffset : focus.textOffset,
    focus.textOffset,
  );
}

function domSelectionDirection(selection: Selection): "forward" | "backward" {
  if (selection.isCollapsed || !selection.anchorNode || !selection.focusNode)
    return "forward";
  if (selection.rangeCount === 0) return "forward";
  const range = selection.getRangeAt(0);
  return range.startContainer === selection.anchorNode &&
    range.startOffset === selection.anchorOffset
    ? "forward"
    : "backward";
}

function nativeInteractiveControlOwnsSelection(list: HTMLElement): boolean {
  const active = list.ownerDocument.activeElement;
  return Boolean(
    active instanceof Element &&
    (list.contains(active) || isInSameEditorInteractionScope(list, active)) &&
    isEditorInteractiveControlTarget(active),
  );
}

function logicalPointFromDomSelection(
  node: Node,
  offset: number,
  editor: EditableEditorRuntimePort,
  contentRuntime: EditorContentRuntime,
  selectionController: SelectionController,
  leases: Map<BlockId, EditorBlockContentLease>,
  collapsed: boolean,
  allowObjectDescendant = false,
): EditorLogicalSelectionPoint | null {
  const element = node instanceof Element ? node : node.parentElement;
  if (
    !element ||
    (!allowObjectDescendant &&
      element.closest("[data-editor-object-root='true']"))
  )
    return null;
  const shell = element.closest<HTMLElement>(
    `${editorBlockShellSelector}[data-editor-block-id]`,
  );
  const blockId = shell?.dataset.editorBlockId as BlockId | undefined;
  const target = blockId
    ? readEditorBlockSelectionTarget(editor, blockId)
    : null;
  if (!shell || !target || !blockUsesContentSelectionEndpoint(target))
    return null;
  const textRoot = shell.querySelector<HTMLElement>(editorTextRootSelector);
  if (!textRoot) return null;
  const projectedOffset = textOffsetFromDomPoint(textRoot, node, offset);
  if (projectedOffset === null) return null;
  const mountedOffset =
    collapsed &&
    textRoot.contains(textRoot.ownerDocument.activeElement)
      ? editor.readTextSelectionOffset(target.block.id)
      : null;
  const textOffset = mountedOffset ?? projectedOffset;
  const canonical = selectionController.getCanonicalSnapshot();
  const canonicalFocus =
    canonical.kind === "document"
      ? canonical.snapshot.documentSelection.focus
      : null;
  const affinity =
    canonicalFocus?.blockId === target.block.id &&
    canonicalFocus.textOffset === textOffset
      ? canonicalFocus.affinity
      : null;
  return createContentSelectionPoint(
    editor,
    contentRuntime,
    target,
    textOffset,
    affinity,
    leases,
  );
}

function createContentSelectionPoint(
  editor: EditableEditorRuntimePort,
  contentRuntime: EditorContentRuntime,
  target: EditorBlockSelectionTarget,
  textOffset: number,
  affinity: EditorLogicalSelectionPoint["affinity"],
  leases: Map<BlockId, EditorBlockContentLease>,
): EditorLogicalSelectionPoint | null {
  let lease = leases.get(target.block.id);
  if (!lease) {
    lease = contentRuntime.acquireBlockContent(
      target.block.id,
      target.block.type,
      "canonical-transaction",
    );
    leases.set(target.block.id, lease);
  }
  const anchor = createWebSelectionTextAnchorAtOffset({
    contentRuntime,
    contentLease: lease,
    blockId: target.block.id,
    blockType: target.block.type,
    textOffset,
    affinity,
  });
  if (!anchor.ok) return null;
  return createEditorLogicalSelectionPoint({
    graph: editor,
    blockId: target.block.id,
    textOffset: anchor.textOffset,
    textAnchor: anchor.textAnchor,
    affinity,
  });
}

function blockUsesContentSelectionEndpoint(
  target: EditorBlockSelectionTarget,
): boolean {
  return target.selection.projection.endpoint.kind === "content";
}

function pointUsesContentSelectionEndpoint(
  point: EditorLogicalSelectionPoint | null,
): boolean {
  return Boolean(point && isEditorSelectionTextAnchor(point.textAnchor));
}
