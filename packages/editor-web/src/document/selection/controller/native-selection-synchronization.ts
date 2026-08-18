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
import type { EditorWebContentRuntime } from "../../../runtime/content/content-runtime.ts";
import type { AnyEditorRuntimePort } from "../../../runtime/document/render-port.ts";
import {
  editorBlockShellSelector,
  editorEditableTextRootSelector,
  editorTextRootSelector,
  isInSameEditorInteractionScope,
} from "../../dom-markers.ts";
import { isEditorInteractiveControlTarget } from "../../interaction/interactive-targets.ts";
import { createWebSelectionTextAnchorAtOffset } from "../anchors/text-anchor.ts";
import type { EditorBlockContentLease } from "../../../runtime/content/content-runtime.ts";
import { textOffsetFromDomPoint } from "../hit-testing/text-hit-testing.ts";
import {
  applyNativeSelectionPaintMode,
  clearNativeSelectionPaintMode,
} from "./selection-paint.ts";

export interface UseNativeSelectionSynchronizationOptions {
  readonly listElement: HTMLElement | null;
  readonly editor: AnyEditorRuntimePort;
  readonly contentRuntime: EditorWebContentRuntime;
  readonly selectionController: SelectionController;
  readonly presentation: {
    readonly nativeSelectionPaintMode: NativeSelectionPaintMode;
    readonly composition: SelectionCompositionSessionSnapshot | null;
  };
  readonly textAnchorResolver: EditorSelectionTextAnchorResolver;
}

/**
 * Owns the browser Selection boundary. Exact activation projection is
 * acknowledged; subsequent selections inside the active real text view are
 * canonical input. Unmappable and cross-scope browser selections are rejected.
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
        editor.editable &&
        !selection.isCollapsed &&
        domSelectionTouchesEditableTextRoot(selection, list) &&
        !domSelectionIsOwnedByEditableInternalSelectionHost(selection, list)
      ) {
        // Browser engines can still report a compatibility-mouse range even
        // when the canonical pointer boundary canceled its default actions.
        // Collapse it synchronously inside selectionchange, before the next
        // paint, without publishing or disturbing the in-progress endpoints.
        restoreCanonicalInputProjection(editor, selectionController);
      }
      return;
    }

    const canonical = selectionController.getCanonicalSnapshot();
    if (
      canonical.kind === "block-internal" &&
      canonical.snapshot.internal &&
      domSelectionBelongsToBlock(selection, canonical.snapshot.internal.blockId)
    )
      return;

    const editableTextSelection =
      editor.editable &&
      domSelectionTouchesEditableTextRoot(selection, list);
    const internalHostTextSelection =
      editableTextSelection &&
      domSelectionIsOwnedByEditableInternalSelectionHost(selection, list);
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
    if (editableTextSelection && !internalHostTextSelection) {
      restoreCanonicalInputProjection(editor, selectionController);
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
        internalHostTextSelection,
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
            internalHostTextSelection,
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
      restoreCanonicalInputProjection(editor, selectionController);
    },
    [editor, listElement, selectionController],
  );

  useLayoutEffect(() => {
    if (!listElement) return;
    const doc = listElement.ownerDocument;
    const selectionchange = () => commitBrowserSelection();
    const focusin = (event: FocusEvent) =>
      reconcileFocusedTextSelection(event.target);
    doc.addEventListener("selectionchange", selectionchange);
    listElement.addEventListener("focusin", focusin);
    return () => {
      doc.removeEventListener("selectionchange", selectionchange);
      listElement.removeEventListener("focusin", focusin);
    };
  }, [commitBrowserSelection, listElement, reconcileFocusedTextSelection]);

  useLayoutEffect(() => {
    if (!listElement) return;
    applyNativeSelectionPaintMode(
      listElement,
      presentation.nativeSelectionPaintMode,
    );
    if (
      !presentation.composition &&
      selectionController.endpoint.getSnapshot().phase !== "dragging" &&
      presentation.nativeSelectionPaintMode === "hidden-for-global-selection" &&
      !nativeInteractiveControlOwnsSelection(listElement) &&
      !selectionIsOwnedByEditableInternalSelectionHost(
        listElement.ownerDocument.getSelection(),
        listElement,
      )
    )
      restoreCanonicalInputProjection(editor, selectionController);
    return () => clearNativeSelectionPaintMode(listElement);
  }, [editor, listElement, presentation, selectionController]);
}

function domSelectionIsOwnedByEditableInternalSelectionHost(
  selection: Selection,
  list: HTMLElement,
): boolean {
  if (!selection.anchorNode || !selection.focusNode) return false;
  const rootFor = (node: Node): HTMLElement | null => {
    const element = node instanceof Element ? node : node.parentElement;
    return (
      element?.closest<HTMLElement>(editorEditableTextRootSelector) ?? null
    );
  };
  const anchorRoot = rootFor(selection.anchorNode);
  const focusRoot = rootFor(selection.focusNode);
  if (!anchorRoot || anchorRoot !== focusRoot || !list.contains(anchorRoot)) {
    return false;
  }
  return Boolean(
    anchorRoot.closest('[data-editor-block-internal-selection-host="true"]'),
  );
}

function selectionIsOwnedByEditableInternalSelectionHost(
  selection: Selection | null,
  list: HTMLElement,
): boolean {
  return Boolean(
    selection &&
      domSelectionIsOwnedByEditableInternalSelectionHost(selection, list),
  );
}

function domSelectionMatchesCanonicalInputProjection(
  selection: Selection,
  list: HTMLElement,
  controller: SelectionController,
  editor: AnyEditorRuntimePort,
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
  if (matches && editor.editable) {
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
  editor: AnyEditorRuntimePort,
  controller: SelectionController,
): void {
  if (!editor.editable) return;
  const canonical = controller.getCanonicalSnapshot();
  if (canonical.kind !== "document") return;
  const anchor = canonical.snapshot.documentSelection.anchor;
  const focus = canonical.snapshot.documentSelection.focus;
  if (!anchor || !focus || !pointUsesContentSelectionEndpoint(focus)) {
    return;
  }
  if (!editor.ownsActiveTextTarget(focus.blockId)) return;
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
  editor: AnyEditorRuntimePort,
  contentRuntime: EditorWebContentRuntime,
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
    editor.editable &&
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
  editor: AnyEditorRuntimePort,
  contentRuntime: EditorWebContentRuntime,
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

function domSelectionBelongsToBlock(
  selection: Selection,
  blockId: BlockId,
): boolean {
  const anchor =
    selection.anchorNode instanceof Element
      ? selection.anchorNode
      : selection.anchorNode?.parentElement;
  const focus =
    selection.focusNode instanceof Element
      ? selection.focusNode
      : selection.focusNode?.parentElement;
  return Boolean(
    anchor?.closest(`[data-editor-block-id="${CSS.escape(blockId)}"]`) &&
      focus?.closest(`[data-editor-block-id="${CSS.escape(blockId)}"]`),
  );
}
