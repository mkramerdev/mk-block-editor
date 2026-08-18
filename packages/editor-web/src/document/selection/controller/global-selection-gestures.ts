"use client";

import { useLayoutEffect } from "react";
import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  BlockSelectionChildCoverage,
  BlockSelectionCoverage,
  BlockSelectionCoverageResult,
} from "@repo/editor-core/selection";
import {
  richTextBlockInlineContent,
  richTextDocumentContentSize,
} from "@repo/editor-core/content/rich-text";
import {
  collectEditorSelectionTraversalIds,
  canTargetEditorBlockSelection,
  compareEditorSelectionOrder,
  createEditorLogicalSelectionPoint,
  isEditorSelectionTextAnchor,
  moveEditorKeyboardSelectionEndpoint,
  readEditorBlockSelectionTarget,
  type EditorBlockSelectionTarget,
  type EditorKeyboardSelectionKey,
  type EditorLogicalSelectionPoint,
  type EditorSelectionRangeBlock,
  type SelectionController,
} from "@repo/editor-react/selection";
import type {
  EditorBlockContentLease,
  EditorWebContentRuntime,
} from "../../../runtime/content/content-runtime.ts";
import type { AnyEditorRuntimePort } from "../../../runtime/document/render-port.ts";
import type { EditorDocumentLayerKeyboardDispatcher } from "../../../runtime/document/document-layer-interactions.ts";
import { createEditorDocumentInputRouting } from "../../../runtime/keybindings/document-input-routing.ts";
import type { EditorBlockDomRegistryReader } from "../../blocks/block-dom-registry.ts";
import {
  createEdgeScrollController,
  type EdgeScrollController,
} from "../../interaction/edge-scroll.ts";
import { registerDocumentInteractionOwner } from "../../interaction/document-interaction-router.ts";
import { routeEditorDocumentKeydown } from "../../interaction/document-layer-keydown-routing.ts";
import {
  resolveEditorSelectionPointerHit,
  type EditorSelectionPointerHit,
} from "../hit-testing/dom-selection-hit-testing.ts";
import { createWebSelectionTextAnchorAtOffset } from "../anchors/text-anchor.ts";
import { semanticDomOffsetCanCarrySoftWrapAffinity } from "../../geometry/semantic-dom-coordinates.ts";
import type { CaptureStructuralSelection } from "./browser-selection-types.ts";
import {
  EDITOR_BLOCK_INTERNAL_SELECTION_EXTEND_OUTSIDE_EVENT,
  isEditorBlockInternalSelectionExtendOutsideDetail,
} from "./block-internal-transition-event.ts";
import { hasEligibleFocusedTextCaret } from "./focus-insertion-target.ts";
import {
  resolveGlobalSelectionScrollRoot,
  scrollKeyboardSelectionFocusIntoView,
} from "./keyboard-scroll.ts";
import {
  blurFocusedEditorElement,
  capturePointer,
  clearKeyboardSelectionActive,
  clearNativeSelection,
  isKeyboardEventFromUnrelatedExternalControl,
  isPointerEventFromEditorInteractiveControl,
  markKeyboardSelectionActive,
  pointerEventTargetElement,
  releasePointer,
  setTextSelectionDragActive,
  suppressNativeSelection,
} from "./pointer-gesture.ts";
import {
  deriveDocumentSelectionPaintPrimitives,
  type DocumentSelectionPaintPrimitive,
} from "../paint/selection-paint-plan.ts";
import type { TransientPointerSelectionPaint } from "../paint/selection-paint-layer.tsx";

const editorOwnerByBlockList = new WeakMap<HTMLElement, AnyEditorRuntimePort>();
const DRAG_THRESHOLD_PX = 4;
const EDGE_SCROLL_ZONE_PX = 64;
const EDGE_SCROLL_MAX_SPEED = 900;

interface BrowserPointerResource {
  readonly pointerId: number;
  readonly graphRevision: number;
  anchorCandidate: PointerSelectionCandidate;
  focusCandidate: PointerSelectionCandidate;
  readonly startClientX: number;
  readonly startClientY: number;
  lastClientX: number;
  lastClientY: number;
  phase: "pending" | "dragging";
  restoreNativeSelection: (() => void) | null;
  readonly settlementLeases: EditorBlockContentLease[];
}

interface PointerSelectionCandidate {
  readonly pointerId: number;
  readonly graphRevision: number;
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly textOffset: number;
  readonly affinity: EditorLogicalSelectionPoint["affinity"];
  readonly phase: "candidate" | "dragging";
}

export interface UseGlobalSelectionGesturesOptions {
  readonly listElement: HTMLElement | null;
  readonly blockDom: EditorBlockDomRegistryReader;
  readonly editor: AnyEditorRuntimePort;
  readonly contentRuntime: EditorWebContentRuntime;
  readonly selectionController: SelectionController;
  readonly captureStructuralSelection: CaptureStructuralSelection;
  readonly documentLayerKeyboard: EditorDocumentLayerKeyboardDispatcher;
  readonly onTransientPointerPaintChange: (
    paint: TransientPointerSelectionPaint | null,
  ) => void;
}

/**
 * Owns pointer and keyboard gesture resources. Outside pointer-down clears
 * committed selection even when its target will not receive focus; browser
 * blur and window lifecycle focus synchronization remain in
 * useWebFocusAdapters.
 */
export function useGlobalSelectionGestures({
  listElement,
  blockDom,
  editor,
  contentRuntime,
  selectionController,
  captureStructuralSelection,
  documentLayerKeyboard,
  onTransientPointerPaintChange,
}: UseGlobalSelectionGesturesOptions): void {
  useLayoutEffect(() => {
    if (!listElement) return;
    const list = listElement;
    const doc = list.ownerDocument;
    const documentInput = editor.editable
      ? createEditorDocumentInputRouting(doc, {
          definition: editor.definition,
          store: editor.store,
          editor,
        })
      : null;
    editorOwnerByBlockList.set(list, editor);
    let pointer: BrowserPointerResource | null = null;
    let suppressCompletedDragClick = false;
    let edgeScroll: EdgeScrollController | null = null;
    let transientPaintRevision = 0;

    const resolveHit = (
      target: EventTarget | null,
      clientX: number,
      clientY: number,
      requireStartEligible = false,
    ) =>
      resolveEditorSelectionPointerHit({
        list,
        target,
        clientX,
        clientY,
        graph: editor,
        requireStartEligible,
      });

    const updatePointer = (
      resource: BrowserPointerResource,
      hit: EditorSelectionPointerHit,
    ) => {
      resource.focusCandidate = pointerCandidateFromHit(
        hit,
        resource.pointerId,
        resource.graphRevision,
        resource.phase === "dragging" ? "dragging" : "candidate",
      );
      if (resource.phase !== "dragging") return;
      const primitives = deriveTransientPointerPaintPrimitives(
        resource.anchorCandidate,
        resource.focusCandidate,
        editor,
      );
      onTransientPointerPaintChange(
        primitives
          ? Object.freeze({
              revision: ++transientPaintRevision,
              primitives,
            })
          : null,
      );
    };
    const requestSettledTextPresentation = (
      point: EditorLogicalSelectionPoint,
    ): boolean => {
      if (!editor.editable || !pointUsesContentSelectionEndpoint(point)) {
        return false;
      }
      const canonical = selectionController.getCanonicalSnapshot();
      if (canonical.kind !== "document") return false;
      const focus = canonical.snapshot.documentSelection.focus;
      if (
        !focus ||
        focus.blockId !== point.blockId ||
        focus.textOffset !== point.textOffset
      ) {
        return false;
      }
      return editor.requestTextPresentation(point.blockId, {
        offset: point.textOffset,
        canonicalSelectionRevision: canonical.revision,
        ...(point.affinity ? { affinity: point.affinity } : {}),
        preventScroll: true,
      });
    };
    const refreshPointer = () => {
      if (pointer?.phase !== "dragging") return;
      const target = doc.elementFromPoint?.(
        pointer.lastClientX,
        pointer.lastClientY,
      );
      const hit = resolveHit(target, pointer.lastClientX, pointer.lastClientY);
      if (hit) updatePointer(pointer, hit);
    };
    const finishPointer = () => {
      if (!pointer) return;
      const current = pointer;
      pointer = null;
      onTransientPointerPaintChange(null);
      releaseContentLeases(current.settlementLeases);
      delete list.dataset.editorNativeCaretPointerPending;
      current.restoreNativeSelection?.();
      if (current.phase === "dragging") releasePointer(list, current.pointerId);
      setTextSelectionDragActive(list, false);
      edgeScroll?.stop();
    };
    const beginActiveDrag = (
      resource: BrowserPointerResource,
      clientX: number,
      clientY: number,
    ): boolean => {
      if (editor.getSelectionGraphRevision() !== resource.graphRevision) {
        finishPointer();
        return false;
      }
      selectionController.resetKeyboardNavigation();
      resource.restoreNativeSelection ??= suppressNativeSelection(list);
      setTextSelectionDragActive(list, true);
      if (!capturePointer(list, resource.pointerId)) {
        setTextSelectionDragActive(list, false);
        finishPointer();
        return false;
      }
      resource.phase = "dragging";
      resource.anchorCandidate = pointerCandidateWithPhase(
        resource.anchorCandidate,
        "dragging",
      );
      edgeScroll ??= createEdgeScrollController({
        scrollElement: resolveGlobalSelectionScrollRoot(list),
        axes: { y: true },
        edgeZonePx: EDGE_SCROLL_ZONE_PX,
        maxSpeedPxPerSecond: EDGE_SCROLL_MAX_SPEED,
        onTick: refreshPointer,
      });
      edgeScroll.start({ clientX, clientY });
      return true;
    };
    const pointerdown = (event: PointerEvent) => {
      suppressCompletedDragClick = false;
      if (pointer) finishPointer();
      if (
        event.button !== 0 ||
        isPointerEventFromEditorInteractiveControl(event, list)
      )
        return;
      const target = pointerEventTargetElement(event);
      if (!target || !list.contains(target)) return;
      if (
        target.closest('[data-editor-block-internal-selection-host="true"]')
      ) {
        return;
      }
      const hit = resolveHit(event.target, event.clientX, event.clientY, true);
      if (!hit) return;
      const graphRevision = editor.getSelectionGraphRevision();
      const candidate = pointerCandidateFromHit(
        hit,
        event.pointerId,
        graphRevision,
        "candidate",
      );
      pointer = {
        pointerId: event.pointerId,
        graphRevision,
        anchorCandidate: candidate,
        focusCandidate: candidate,
        startClientX: event.clientX,
        startClientY: event.clientY,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        phase: "pending",
        restoreNativeSelection: suppressNativeSelection(list),
        settlementLeases: [],
      };
      list.dataset.editorNativeCaretPointerPending = "true";
      // Once the DOM gesture controller has accepted an ordinary text
      // gesture, it owns every endpoint. Prevent the browser from beginning a
      // parallel native range during the pending threshold window. Canonical
      // hit testing carries soft-wrap affinity through settlement, and the
      // active input projection remains the collapsed canonical caret.
      event.preventDefault();
      if (
        editor.editable &&
        blockUsesContentSelectionEndpoint(hit.target)
      ) {
        // ProseMirror's compatibility-mouse gesture must not independently
        // normalize the same DOM point to its default soft-wrap side.
        event.stopPropagation();
      }
    };
    const extendBlockInternalSelection = (event: Event) => {
      if (
        !(event instanceof CustomEvent) ||
        !isEditorBlockInternalSelectionExtendOutsideDetail(event.detail) ||
        pointer
      )
        return;
      const detail = event.detail;
      const captured = selectionController.getCommittedSnapshot();
      if (
        captured?.kind !== "block-internal" ||
        captured.internal?.blockId !== detail.hostBlockId
      )
        return;
      const hostTarget = readEditorBlockSelectionTarget(
        editor,
        detail.hostBlockId,
      );
      const shell = blockDom.getBlockShell(detail.hostBlockId);
      const target = doc.elementFromPoint?.(detail.clientX, detail.clientY);
      const focusHit = resolveHit(target, detail.clientX, detail.clientY);
      if (!hostTarget || !shell || !focusHit || !list.contains(shell)) {
        return;
      }
      const order = compareEditorSelectionOrder(
        editor,
        detail.hostBlockId,
        focusHit.target.block.id,
      );
      if (order === null || order === 0) {
        return;
      }
      const graphRevision = editor.getSelectionGraphRevision();
      pointer = {
        pointerId: detail.pointerId,
        graphRevision,
        anchorCandidate: pointerCandidateFromTarget(
          hostTarget,
          0,
          order < 0 ? "forward" : "backward",
          detail.pointerId,
          graphRevision,
          "dragging",
        ),
        focusCandidate: pointerCandidateFromHit(
          focusHit,
          detail.pointerId,
          graphRevision,
          "dragging",
        ),
        startClientX: detail.startClientX,
        startClientY: detail.startClientY,
        lastClientX: detail.clientX,
        lastClientY: detail.clientY,
        phase: "pending",
        restoreNativeSelection: suppressNativeSelection(list),
        settlementLeases: [],
      };
      if (!beginActiveDrag(pointer, detail.clientX, detail.clientY)) return;
      blurFocusedEditorElement(list);
      updatePointer(pointer, focusHit);
    };
    const pointermove = (event: PointerEvent) => {
      if (!pointer || pointer.pointerId !== event.pointerId) return;
      pointer.lastClientX = event.clientX;
      pointer.lastClientY = event.clientY;
      if (pointer.phase === "pending") {
        const dx = event.clientX - pointer.startClientX;
        const dy = event.clientY - pointer.startClientY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
          event.preventDefault();
          return;
        }
        const hit = resolveHit(event.target, event.clientX, event.clientY);
        if (!hit) {
          finishPointer();
          event.preventDefault();
          return;
        }
        if (!beginActiveDrag(pointer, event.clientX, event.clientY)) {
          event.preventDefault();
          return;
        }
        updatePointer(pointer, hit);
      } else {
        edgeScroll?.updatePointer({
          clientX: event.clientX,
          clientY: event.clientY,
        });
        const hit = resolveHit(event.target, event.clientX, event.clientY);
        if (!hit) {
          event.preventDefault();
          return;
        }
        updatePointer(pointer, hit);
      }
      event.preventDefault();
    };
    const mousedown = (event: MouseEvent) => {
      const target = pointerEventTargetElement(event);
      if (!pointer || event.button !== 0 || !target || !list.contains(target)) {
        return;
      }
      // The pointer pipeline already owns canonical settlement. ProseMirror's
      // compatibility-mouse gesture and the browser default would
      // independently create a native range or normalize the caret to the
      // default soft-wrap side.
      event.preventDefault();
      event.stopPropagation();
    };
    const mouseup = (event: MouseEvent) => {
      const target = pointerEventTargetElement(event);
      if (
        !suppressCompletedDragClick ||
        event.button !== 0 ||
        !target ||
        !list.contains(target)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
    };
    const pointerup = (event: PointerEvent) => {
      if (!pointer || pointer.pointerId !== event.pointerId) return;
      const current = pointer;
      if (editor.getSelectionGraphRevision() !== current.graphRevision) {
        finishPointer();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const hit = resolveHit(event.target, event.clientX, event.clientY);
      if (!hit && current.phase === "pending") {
        finishPointer();
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (hit) {
        if (current.phase === "dragging") updatePointer(current, hit);
        else {
          current.focusCandidate = pointerCandidateFromHit(
            hit,
            current.pointerId,
            current.graphRevision,
            "candidate",
          );
        }
      }
      const points = materializePointerSettlement(
        current,
        editor,
        contentRuntime,
      );
      selectionController.resetKeyboardNavigation();
      const settlement = points
        ? selectionController.extendSelection(
            points.anchor,
            points.focus,
            editor,
            current.graphRevision,
            {
              publication: { kind: "standalone-local" },
              cause: "pointer",
            },
          )
        : {
            kind: "rejected" as const,
            retainedSelection: selectionController.getCanonicalSnapshot(),
          };
      if (settlement.kind !== "rejected" && editor.editable) {
        const committed = selectionController.getCommittedSnapshot();
        const inputPoint = committed?.focus.target ?? null;
        if (inputPoint && pointUsesContentSelectionEndpoint(inputPoint)) {
          requestSettledTextPresentation(inputPoint);
        }
      }
      event.preventDefault();
      event.stopPropagation();
      suppressCompletedDragClick = true;
      finishPointer();
    };
    const click = (event: MouseEvent) => {
      if (!suppressCompletedDragClick) return;
      suppressCompletedDragClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const pointercancel = (event: PointerEvent) => {
      if (!pointer || pointer.pointerId !== event.pointerId) return;
      finishPointer();
    };
    const lostpointercapture = (event: PointerEvent) => {
      if (
        event.target !== list ||
        event.currentTarget !== list ||
        pointer?.phase !== "dragging" ||
        pointer.pointerId !== event.pointerId
      )
        return;
      finishPointer();
    };
    const documentLoss = () => finishPointer();
    const visibilitychange = () => {
      if (doc.visibilityState === "hidden") documentLoss();
    };
    const releaseInteractionOwner = () => {
      finishPointer();
      if (editor.editable) editor.blurEditor();
      clearNativeSelection(doc);
    };
    const keydown = (event: KeyboardEvent) => {
      const eventTarget = event.target instanceof Element ? event.target : null;
      if (
        editor.editable &&
        (!editor.ownsNativeFocusTarget(event.target) ||
          !editor.ownsActiveElement(doc))
      ) {
        return;
      }
      if (
        eventTarget &&
        list.contains(eventTarget) &&
        eventTarget.closest(
          '[data-editor-block-internal-selection-host="true"]',
        ) &&
        !eventTarget.closest(
          '[data-editor-text-root="true"][contenteditable="true"]',
        )
      ) {
        return;
      }
      if (event.defaultPrevented) return;
      if (
        event.key.toLowerCase() === "a" &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.isComposing &&
        !isKeyboardEventFromUnrelatedExternalControl(event, list)
      ) {
        const selectionLeases: EditorBlockContentLease[] = [];
        const range = resolveCanonicalSelectAllRange(
          list,
          editor,
          contentRuntime,
          selectionLeases,
        );
        if (!range) {
          releaseContentLeases(selectionLeases);
          return;
        }
        const settlement = selectionController.extendSelection(
          range.anchor,
          range.focus,
          editor,
          editor.getSelectionGraphRevision(),
          {
            publication: { kind: "standalone-local" },
            cause: "keyboard",
          },
          null,
        );
        if (settlement.kind === "rejected") {
          releaseContentLeases(selectionLeases);
          return;
        }
        selectionController.resetKeyboardNavigation();
        if (editor.editable && pointUsesContentSelectionEndpoint(range.focus)) {
          requestSettledTextPresentation(range.focus);
        }
        releaseContentLeases(selectionLeases);
        markKeyboardSelectionActive(list);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "Escape") {
        if (selectionController.getPresentationSnapshot().composition) return;
        if (pointer) {
          finishPointer();
          event.preventDefault();
          return;
        }
        const committed = selectionController.getCommittedSnapshot();
        if (committed) {
          const anchor = committed.endpoints?.anchor ?? null;
          selectionController.resetKeyboardNavigation();
          selectionController.clearSelection({
            publication: { kind: "standalone-local" },
            cause: "keyboard",
          });
          if (
            editor.editable &&
            anchor &&
            pointUsesContentSelectionEndpoint(anchor)
          ) {
            editor.projectActiveTextSelection(
              anchor.blockId,
              anchor.textOffset,
              anchor.textOffset,
            );
          }
          event.preventDefault();
          return;
        }
        if (selectionController.getCommittedSnapshot()) {
          selectionController.clearSelection({
            publication: { kind: "standalone-local" },
            cause: "keyboard",
          });
          event.preventDefault();
        }
        return;
      }
      if (
        editor.editable &&
        event.key === "Enter" &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.isComposing
      ) {
        const selection = selectionController.getCommittedSnapshot();
        const anchor = selection?.endpoints?.anchor;
        const head = selection?.endpoints?.head;
        if (
          anchor &&
          head &&
          anchor.blockId === head.blockId &&
          anchor.textOffset !== head.textOffset
        ) {
          const block = editor.getBlock(anchor.blockId);
          if (!block) return;
          const from = Math.min(anchor.textOffset, head.textOffset);
          const to = Math.max(anchor.textOffset, head.textOffset);
          const handled = editor.executeCoreBlockKeyBehavior({
            blockId: block.id,
            blockType: block.type,
            key: "enter",
            cursorOffset: from,
            selectionRange: { from, to },
          });
          if (!handled) return;
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      if (
        editor.editable &&
        (event.key === "Backspace" || event.key === "Delete") &&
        committedSelectionIsNoncollapsed(
          selectionController.getCommittedSnapshot(),
        ) &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        const captured = selectionController.getCommittedSnapshot();
        const capture = captured ? captureStructuralSelection(captured) : null;
        if (!capture?.isCurrent()) return;
        if (
          capture.range.start.kind === "text" &&
          capture.range.end.kind === "text" &&
          capture.range.start.blockId === capture.range.end.blockId
        ) {
          return;
        }
        const result = editor.executeStructuralRangeDeletion(capture.range, {
          intent: "delete",
          provenance: null,
          selectionPresentation: "native-final-selection",
          resolveVisibleChildBlockIds:
            editor.definition.selectionFragment?.resolveVisibleChildBlockIds,
        });
        if (!result.ok) return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (
        !isEditorKeyboardSelectionKey(event.key) ||
        selectionNavigationModifiersUnsupported(event) ||
        event.isComposing ||
        isKeyboardEventFromUnrelatedExternalControl(event, list)
      )
        return;
      const extendsSelection = event.shiftKey;
      const start = resolveKeyboardSelectionStart(
        list,
        editor,
        contentRuntime,
        selectionController,
      );
      if (!start) return;
      const keyboard = selectionController.readKeyboardNavigation();
      const navigationLeases: EditorBlockContentLease[] = [];
      const effectiveKey = effectiveSelectionNavigationKey(event, event.key);
      const movesToTextBoundary =
        (effectiveKey === "Home" || effectiveKey === "End") &&
        (event.ctrlKey || event.metaKey);
      const rangeCollapse =
        !extendsSelection &&
        !sameLogicalSelectionPoint(start.anchor, start.focus)
          ? rangeCollapsePoint(start, effectiveKey, editor)
          : null;
      const move = rangeCollapse
        ? { ok: true as const, point: rangeCollapse, preferredX: null }
        : moveEditorKeyboardSelectionEndpoint({
            key: effectiveKey,
            focus: start.focus,
            graph: editor,
            preferredX: keyboard?.preferredX ?? null,
            readText: (blockId, target) =>
              readCanonicalKeyboardNavigationText(
                contentRuntime,
                blockId,
                target.block.type,
              ),
            createPoint: ({ target, textOffset, affinity }) =>
              createKeyboardSelectionPoint(
                list,
                editor,
                contentRuntime,
                target,
                textOffset,
                affinity,
                navigationLeases,
              ),
            canNavigateTo: (target) =>
              isBlockPresentedForKeyboardNavigation(blockDom, target.block.id),
            moveVisualLine: movesToTextBoundary
              ? undefined
              : ({ target, point, direction, preferredX }) => {
                  if (direction === "start" || direction === "end") {
                    const offset = editor.geometry.readTextVisualRowBoundary(
                      target.block.id,
                      point.textOffset,
                      direction,
                      point.affinity ?? undefined,
                    );
                    return offset === null
                      ? {
                          kind: "unavailable" as const,
                          reason: "visual-row-boundary-unavailable",
                        }
                      : {
                          kind: "moved" as const,
                          textOffset: offset,
                          preferredX: 0,
                        };
                  }
                  const moved = editor.geometry.moveTextVertically(
                    target.block.id,
                    point.textOffset,
                    direction,
                    preferredX,
                    point.affinity ?? undefined,
                  );
                  return moved.kind === "moved"
                    ? {
                        kind: "moved" as const,
                        textOffset: moved.offset,
                        preferredX: moved.preferredX,
                      }
                    : moved;
                },
            mapToVisualLine: ({ target, line, preferredX }) => {
              const mapped = editor.geometry.mapTextToVisualRow(
                target.block.id,
                line,
                preferredX,
              );
              return mapped.kind === "mapped"
                ? {
                    kind: "mapped" as const,
                    textOffset: mapped.offset,
                  }
                : mapped;
            },
            unit:
              event.altKey || event.ctrlKey || event.metaKey
                ? "word"
                : "grapheme",
          });
      const vertical =
        effectiveKey === "ArrowUp" || effectiveKey === "ArrowDown";
      if (!move.ok) {
        releaseContentLeases(navigationLeases);
        if (vertical) {
          const navigation = selectionController.readKeyboardNavigation();
          selectionController.setKeyboardNavigation({
            preferredX: move.preferredX ?? navigation?.preferredX ?? null,
          });
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }
      const settlement = (() => {
        const context = {
          publication: { kind: "standalone-local" as const },
          cause: "keyboard" as const,
        };
        if (extendsSelection) {
          return selectionController.extendSelection(
            start.anchor,
            move.point,
            editor,
            editor.getSelectionGraphRevision(),
            context,
            move.preferredX,
          );
        }
        return selectionController.commitSelectionPoint(
          move.point,
          editor,
          editor.getSelectionGraphRevision(),
          context,
        );
      })();
      if (settlement.kind === "rejected") {
        releaseContentLeases(navigationLeases);
        return;
      }
      if (
        editor.editable &&
        extendsSelection &&
        start.anchor.blockId === move.point.blockId &&
        pointUsesContentSelectionEndpoint(start.anchor) &&
        pointUsesContentSelectionEndpoint(move.point)
      ) {
        editor.projectActiveTextSelection(
          move.point.blockId,
          start.anchor.textOffset,
          move.point.textOffset,
        );
      }
      if (
        editor.editable &&
        pointUsesContentSelectionEndpoint(move.point) &&
        (!extendsSelection || move.point.blockId !== start.focus.blockId)
      ) {
        requestSettledTextPresentation(move.point);
      }
      releaseContentLeases(navigationLeases);
      selectionController.setKeyboardNavigation({
        preferredX: vertical ? move.preferredX : null,
      });
      markKeyboardSelectionActive(list);
      scrollKeyboardSelectionFocusIntoView(
        blockDom,
        list,
        move.point,
        effectiveKey,
      );
      // The mounted block, live caret, valid endpoint move, and settled
      // canonical range establish ownership. Keep the same accepted gesture
      // from also becoming a block-local ProseMirror selection proposal.
      event.preventDefault();
      event.stopPropagation();
    };
    const keyup = (event: KeyboardEvent) => {
      if (event.key !== "Shift") return;
      const navigation = selectionController.readKeyboardNavigation();
      if (navigation) {
        selectionController.setKeyboardNavigation({
          preferredX: navigation.preferredX,
        });
      }
      const canonical = selectionController.getCanonicalSnapshot();
      if (canonical.kind !== "document" || !editor.editable) return;
      const anchor = canonical.snapshot.documentSelection.anchor;
      const focus = canonical.snapshot.documentSelection.focus;
      if (!focus || !pointUsesContentSelectionEndpoint(focus)) return;
      if (
        anchor &&
        anchor.blockId === focus.blockId &&
        anchor.textOffset !== focus.textOffset
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      requestSettledTextPresentation(focus);
      event.preventDefault();
      event.stopPropagation();
    };

    list.addEventListener("pointerdown", pointerdown, true);
    doc.addEventListener("mousedown", mousedown, true);
    doc.addEventListener("mouseup", mouseup, true);
    doc.addEventListener("click", click, true);
    list.addEventListener(
      EDITOR_BLOCK_INTERNAL_SELECTION_EXTEND_OUTSIDE_EVENT,
      extendBlockInternalSelection,
    );
    const unregisterInteractionOwner = registerDocumentInteractionOwner(doc, {
      list,
      releaseInteraction: releaseInteractionOwner,
      pointerdown: () => undefined,
      pointermove,
      pointerup,
      pointercancel,
      beforeinput: (event) => documentInput?.beforeinput(event),
      keydown: (event) =>
        routeEditorDocumentKeydown(
          event,
          documentLayerKeyboard,
          documentInput,
          keydown,
        ),
      keyup,
      scroll: refreshPointer,
    });
    list.addEventListener("lostpointercapture", lostpointercapture, true);
    doc.defaultView?.addEventListener("blur", documentLoss);
    doc.defaultView?.addEventListener("pagehide", documentLoss);
    doc.addEventListener("visibilitychange", visibilitychange);
    return () => {
      finishPointer();
      suppressCompletedDragClick = false;
      edgeScroll?.dispose();
      selectionController.resetKeyboardNavigation();
      clearKeyboardSelectionActive(list);
      list.removeEventListener("pointerdown", pointerdown, true);
      doc.removeEventListener("mousedown", mousedown, true);
      doc.removeEventListener("mouseup", mouseup, true);
      doc.removeEventListener("click", click, true);
      list.removeEventListener(
        EDITOR_BLOCK_INTERNAL_SELECTION_EXTEND_OUTSIDE_EVENT,
        extendBlockInternalSelection,
      );
      unregisterInteractionOwner();
      list.removeEventListener("lostpointercapture", lostpointercapture, true);
      doc.defaultView?.removeEventListener("blur", documentLoss);
      doc.defaultView?.removeEventListener("pagehide", documentLoss);
      doc.removeEventListener("visibilitychange", visibilitychange);
      if (editorOwnerByBlockList.get(list) === editor)
        editorOwnerByBlockList.delete(list);
    };
  }, [
    blockDom,
    captureStructuralSelection,
    contentRuntime,
    documentLayerKeyboard,
    editor,
    listElement,
    onTransientPointerPaintChange,
    selectionController,
  ]);
}

function readCanonicalKeyboardNavigationText(
  contentRuntime: EditorWebContentRuntime,
  blockId: BlockId,
  blockType: BlockType,
): string | null {
  const content = contentRuntime.readBlockProjection(blockId, blockType);
  if (!content) return null;
  return richTextBlockInlineContent(content)
    .map((node) => {
      if (node.type === "text") return node.text;
      if (node.type === "hard_break") return "\n";
      return "\uFFFC";
    })
    .join("");
}

function committedSelectionIsNoncollapsed(
  selection: ReturnType<SelectionController["getCommittedSnapshot"]>,
): boolean {
  const anchor = selection?.endpoints?.anchor;
  const head = selection?.endpoints?.head;
  return Boolean(
    anchor &&
      head &&
      (anchor.blockId !== head.blockId ||
        anchor.textOffset !== head.textOffset ||
        !anchor.textAnchor ||
        !head.textAnchor),
  );
}

function resolveKeyboardSelectionStart(
  list: HTMLElement,
  editor: AnyEditorRuntimePort,
  contentRuntime: EditorWebContentRuntime,
  controller: SelectionController,
): {
  readonly anchor: EditorLogicalSelectionPoint;
  readonly focus: EditorLogicalSelectionPoint;
  readonly originalCaret: EditorLogicalSelectionPoint;
} | null {
  const snapshot = controller.endpoint.getSnapshot();
  if (snapshot.phase !== "idle") {
    if (!snapshot.anchor || !snapshot.focus) return null;
    const keyboard = controller.readKeyboardNavigation();
    if (
      !keyboard &&
      sameLogicalSelectionPoint(snapshot.anchor, snapshot.focus)
    ) {
      const mountedCaret = resolveFocusedKeyboardCaret(list, editor);
      if (mountedCaret) {
        return {
          anchor: mountedCaret,
          focus: mountedCaret,
          originalCaret: mountedCaret,
        };
      }
    }
    const original = pointUsesContentSelectionEndpoint(snapshot.anchor)
      ? snapshot.anchor
      : snapshot.focus;
    return {
      anchor: snapshot.anchor,
      focus: snapshot.focus,
      originalCaret: original,
    };
  }
  const point = resolveFocusedKeyboardCaret(list, editor);
  return point ? { anchor: point, focus: point, originalCaret: point } : null;
}

function resolveFocusedKeyboardCaret(
  list: HTMLElement,
  editor: AnyEditorRuntimePort,
): EditorLogicalSelectionPoint | null {
  if (!editor.editable) return null;
  const canonical = editor.selectionController.getCanonicalSnapshot();
  if (canonical.kind !== "document") return null;
  const selection = canonical.snapshot.documentSelection;
  const point = selection.focus;
  if (
    !point ||
    !selection.anchor ||
    selection.anchor.blockId !== point.blockId ||
    selection.anchor.textOffset !== point.textOffset ||
    !point.textAnchor ||
    !hasEligibleFocusedTextCaret(list, editor, point.blockId)
  ) {
    return null;
  }
  const target = readEditorBlockSelectionTarget(editor, point.blockId);
  if (
    !target ||
    !target.canStartSelection ||
    !blockUsesContentSelectionEndpoint(target)
  )
    return null;
  return point;
}

function sameLogicalSelectionPoint(
  left: EditorLogicalSelectionPoint,
  right: EditorLogicalSelectionPoint,
): boolean {
  return left.blockId === right.blockId && left.textOffset === right.textOffset;
}

function createKeyboardSelectionPoint(
  list: HTMLElement,
  editor: AnyEditorRuntimePort,
  contentRuntime: EditorWebContentRuntime,
  target: EditorBlockSelectionTarget,
  textOffset: number,
  affinity: EditorLogicalSelectionPoint["affinity"],
  leases: EditorBlockContentLease[],
): EditorLogicalSelectionPoint | null {
  const normalizedAffinity = blockUsesContentSelectionEndpoint(target)
    ? normalizeMountedTextAffinity(list, target.block.id, textOffset, affinity)
    : affinity;
  const lease = blockUsesContentSelectionEndpoint(target)
    ? contentRuntime.acquireBlockContent(
        target.block.id,
        target.block.type,
        "canonical-transaction",
      )
    : null;
  if (lease) leases.push(lease);
  const anchor = lease
    ? createWebSelectionTextAnchorAtOffset({
        contentRuntime,
        contentLease: lease,
        blockId: target.block.id,
        blockType: target.block.type,
        textOffset,
        affinity: normalizedAffinity,
      })
    : null;
  if (anchor && !anchor.ok) return null;
  return createEditorLogicalSelectionPoint({
    graph: editor,
    blockId: target.block.id,
    textOffset: anchor?.textOffset ?? textOffset,
    textAnchor: anchor?.textAnchor ?? null,
    affinity: normalizedAffinity,
  });
}

function normalizeMountedTextAffinity(
  list: HTMLElement,
  blockId: BlockId,
  textOffset: number,
  affinity: EditorLogicalSelectionPoint["affinity"],
): EditorLogicalSelectionPoint["affinity"] {
  if (!affinity) return null;
  const shell = [
    ...list.querySelectorAll<HTMLElement>("[data-editor-block-id]"),
  ].find((candidate) => candidate.dataset.editorBlockId === blockId);
  const root = shell?.querySelector<HTMLElement>(
    '[data-editor-text-root="true"]',
  );
  return root && semanticDomOffsetCanCarrySoftWrapAffinity(root, textOffset)
    ? affinity
    : null;
}

function resolveCanonicalSelectAllRange(
  list: HTMLElement,
  editor: AnyEditorRuntimePort,
  contentRuntime: EditorWebContentRuntime,
  leases: EditorBlockContentLease[],
): {
  readonly anchor: EditorLogicalSelectionPoint;
  readonly focus: EditorLogicalSelectionPoint;
} | null {
  const targets = collectEditorSelectionTraversalIds(editor)
    .map((blockId) => readEditorBlockSelectionTarget(editor, blockId))
    .filter((target): target is EditorBlockSelectionTarget => target !== null);
  const first = targets[0];
  const last = targets.at(-1);
  if (!first || !last) return null;
  const lastContent = blockUsesContentSelectionEndpoint(last)
    ? contentRuntime.readBlockProjection(last.block.id, last.block.type)
    : null;
  if (blockUsesContentSelectionEndpoint(last) && !lastContent) return null;
  const anchor = createKeyboardSelectionPoint(
    list,
    editor,
    contentRuntime,
    first,
    0,
    "forward",
    leases,
  );
  const focus = createKeyboardSelectionPoint(
    list,
    editor,
    contentRuntime,
    last,
    lastContent ? richTextDocumentContentSize(lastContent) : 0,
    "backward",
    leases,
  );
  return anchor && focus ? { anchor, focus } : null;
}

function releaseContentLeases(leases: EditorBlockContentLease[]): void {
  for (const lease of leases.splice(0)) lease.release();
}

function pointerCandidateFromTarget(
  target: EditorBlockSelectionTarget,
  textOffset: number,
  affinity: EditorLogicalSelectionPoint["affinity"],
  pointerId: number,
  graphRevision: number,
  phase: PointerSelectionCandidate["phase"],
): PointerSelectionCandidate {
  return Object.freeze({
    pointerId,
    graphRevision,
    blockId: target.block.id,
    blockType: target.block.type,
    textOffset,
    affinity,
    phase,
  });
}

function pointerCandidateWithPhase(
  candidate: PointerSelectionCandidate,
  phase: PointerSelectionCandidate["phase"],
): PointerSelectionCandidate {
  return candidate.phase === phase
    ? candidate
    : Object.freeze({ ...candidate, phase });
}

function deriveTransientPointerPaintPrimitives(
  anchor: PointerSelectionCandidate,
  focus: PointerSelectionCandidate,
  editor: AnyEditorRuntimePort,
): readonly DocumentSelectionPaintPrimitive[] | null {
  const graphRevision = editor.getSelectionGraphRevision();
  if (
    anchor.graphRevision !== graphRevision ||
    focus.graphRevision !== graphRevision ||
    (anchor.blockId === focus.blockId &&
      anchor.textOffset === focus.textOffset)
  )
    return null;
  const anchorTarget = readEditorBlockSelectionTarget(editor, anchor.blockId);
  const focusTarget = readEditorBlockSelectionTarget(editor, focus.blockId);
  if (
    !anchorTarget ||
    !focusTarget ||
    !canTargetEditorBlockSelection(anchorTarget) ||
    !canTargetEditorBlockSelection(focusTarget)
  )
    return null;
  const operationBlockIds = collectEditorSelectionTraversalIds(editor);
  const orderByBlockId = new Map<BlockId, number>();
  operationBlockIds.forEach((blockId, index) =>
    orderByBlockId.set(blockId, index),
  );
  const comparison = comparePointerCandidates(
    anchor,
    focus,
    orderByBlockId,
  );
  if (comparison === null) return null;
  const normalizedStart = comparison <= 0 ? anchor : focus;
  const normalizedEnd = comparison <= 0 ? focus : anchor;
  const startIndex = orderByBlockId.get(normalizedStart.blockId);
  const endIndex = orderByBlockId.get(normalizedEnd.blockId);
  if (startIndex === undefined || endIndex === undefined) return null;
  const selectedBlockIds = new Set(
    operationBlockIds.slice(startIndex, endIndex + 1),
  );
  const targetIds = new Set(selectedBlockIds);
  for (const blockId of selectedBlockIds) {
    let parentId = editor.getParentId(blockId);
    const visited = new Set<BlockId>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      targetIds.add(parentId);
      parentId = editor.getParentId(parentId);
    }
  }
  const targets = operationBlockIds
    .filter((blockId) => targetIds.has(blockId))
    .map((blockId) => readEditorBlockSelectionTarget(editor, blockId))
    .filter((target): target is EditorBlockSelectionTarget => target !== null);
  const context: TransientPointerCoverageContext = {
    editor,
    selectedBlockIds,
    normalizedStart,
    normalizedEnd,
  };
  const rangeBlocks: EditorSelectionRangeBlock[] = [];
  for (const target of targets) {
    const coverageResult = evaluateTransientPointerCoverage(target, context);
    if (
      !selectedBlockIds.has(target.block.id) &&
      coverageResult.coverage === "none"
    )
      continue;
    rangeBlocks.push(
      transientPointerRangeBlock(
        target,
        coverageResult,
        normalizedStart,
        normalizedEnd,
      ),
    );
  }
  const derived = deriveDocumentSelectionPaintPrimitives(rangeBlocks);
  return derived.ok ? derived.primitives : null;
}

interface TransientPointerCoverageContext {
  readonly editor: AnyEditorRuntimePort;
  readonly selectedBlockIds: ReadonlySet<BlockId>;
  readonly normalizedStart: PointerSelectionCandidate;
  readonly normalizedEnd: PointerSelectionCandidate;
}

function evaluateTransientPointerCoverage(
  target: EditorBlockSelectionTarget,
  context: TransientPointerCoverageContext,
): BlockSelectionCoverageResult {
  const model = target.selection;
  const directCoverage = directTransientPointerCoverage(target, context);
  let coverage = directCoverage;
  let childCoverages: readonly BlockSelectionChildCoverage[] | undefined;
  if (model.children?.scope) {
    const children = context.editor
      .getChildBlockIds(target.block.id)
      .map((blockId) =>
        readEditorBlockSelectionTarget(context.editor, blockId),
      )
      .filter((child): child is EditorBlockSelectionTarget => child !== null)
      .map((child) => evaluateTransientPointerCoverage(child, context));
    childCoverages = Object.freeze(
      children.map((child) => ({
        blockId: child.blockId,
        coverage: child.coverage,
      })),
    );
    coverage = aggregateTransientPointerCoverage(
      directCoverage,
      childCoverages,
    );
  }
  return {
    blockId: target.block.id,
    blockType: target.block.type,
    modelId: model.id,
    coverage,
    ...(model.paint === undefined ? {} : { paint: model.paint }),
    ...(model.fragment === undefined ? {} : { fragment: model.fragment }),
    ...(model.edit === undefined ? {} : { edit: model.edit }),
    ...(model.delete === undefined ? {} : { delete: model.delete }),
    ...(model.cut === undefined ? {} : { cut: model.cut }),
    ...(model.move === undefined ? {} : { move: model.move }),
    ...(childCoverages?.length ? { childCoverages } : {}),
  };
}

function directTransientPointerCoverage(
  target: EditorBlockSelectionTarget,
  context: TransientPointerCoverageContext,
): BlockSelectionCoverage {
  if (!context.selectedBlockIds.has(target.block.id)) return "none";
  if (blockUsesContentSelectionEndpoint(target)) {
    return target.block.id === context.normalizedStart.blockId ||
      target.block.id === context.normalizedEnd.blockId
      ? "partial"
      : "complete-content";
  }
  return target.selection.coverage.selected;
}

function aggregateTransientPointerCoverage(
  directCoverage: BlockSelectionCoverage,
  childCoverages: readonly BlockSelectionChildCoverage[],
): BlockSelectionCoverage {
  if (directCoverage === "complete-block") return "complete-block";
  if (directCoverage === "partial") return "partial";
  if (childCoverages.length === 0) return directCoverage;
  const selected = childCoverages.filter(
    (child) => child.coverage !== "none",
  );
  if (selected.length === 0) return directCoverage;
  if (childCoverages.some((child) => child.coverage === "partial"))
    return "partial";
  return selected.length === childCoverages.length
    ? "complete-content"
    : "partial";
}

function transientPointerRangeBlock(
  target: EditorBlockSelectionTarget,
  coverageResult: BlockSelectionCoverageResult,
  normalizedStart: PointerSelectionCandidate,
  normalizedEnd: PointerSelectionCandidate,
): EditorSelectionRangeBlock {
  const rangeBlock: EditorSelectionRangeBlock = {
    blockId: target.block.id,
    blockType: target.block.type,
    category: target.category,
    coverage: coverageResult.coverage,
    coverageResult,
    selectable: target.selectable,
  };
  if (!blockUsesContentSelectionEndpoint(target)) return rangeBlock;
  if (target.block.id === normalizedStart.blockId)
    rangeBlock.startOffset = Math.max(
      0,
      Math.trunc(normalizedStart.textOffset),
    );
  if (target.block.id === normalizedEnd.blockId)
    rangeBlock.endOffset = Math.max(0, Math.trunc(normalizedEnd.textOffset));
  return rangeBlock;
}

function comparePointerCandidates(
  left: PointerSelectionCandidate,
  right: PointerSelectionCandidate,
  orderByBlockId: ReadonlyMap<BlockId, number>,
): number | null {
  if (left.blockId === right.blockId)
    return left.textOffset - right.textOffset;
  const leftIndex = orderByBlockId.get(left.blockId);
  const rightIndex = orderByBlockId.get(right.blockId);
  return leftIndex === undefined || rightIndex === undefined
    ? null
    : leftIndex - rightIndex;
}

function pointerCandidateFromHit(
  hit: EditorSelectionPointerHit,
  pointerId: number,
  graphRevision: number,
  phase: PointerSelectionCandidate["phase"],
): PointerSelectionCandidate {
  return Object.freeze({
    pointerId,
    graphRevision,
    blockId: hit.target.block.id,
    blockType: hit.target.block.type,
    textOffset: hit.textOffset,
    affinity: hit.affinity,
    phase,
  });
}

function materializePointerSettlement(
  resource: BrowserPointerResource,
  editor: AnyEditorRuntimePort,
  contentRuntime: EditorWebContentRuntime,
): {
  readonly direction: "forward" | "backward";
  readonly anchor: EditorLogicalSelectionPoint;
  readonly focus: EditorLogicalSelectionPoint;
} | null {
  if (editor.getSelectionGraphRevision() !== resource.graphRevision) return null;
  const collapsed =
    resource.phase === "pending" ||
    (resource.anchorCandidate.blockId === resource.focusCandidate.blockId &&
      resource.anchorCandidate.textOffset === resource.focusCandidate.textOffset);
  const anchorCandidate = collapsed
    ? resource.focusCandidate
    : resource.anchorCandidate;
  const anchor = materializePointerCandidate(
    anchorCandidate,
    editor,
    contentRuntime,
    resource.settlementLeases,
  );
  if (!anchor) return null;
  const focus = collapsed
    ? anchor
    : materializePointerCandidate(
        resource.focusCandidate,
        editor,
        contentRuntime,
        resource.settlementLeases,
      );
  if (!focus) return null;
  const order = compareEditorSelectionOrder(
    editor,
    anchor.blockId,
    focus.blockId,
  );
  if (order === null) return null;
  return Object.freeze({
    direction:
      order < 0 || (order === 0 && anchor.textOffset <= focus.textOffset)
        ? "forward"
        : "backward",
    anchor,
    focus,
  });
}

function materializePointerCandidate(
  candidate: PointerSelectionCandidate,
  editor: AnyEditorRuntimePort,
  contentRuntime: EditorWebContentRuntime,
  leases: EditorBlockContentLease[],
): EditorLogicalSelectionPoint | null {
  if (candidate.graphRevision !== editor.getSelectionGraphRevision()) return null;
  const target = readEditorBlockSelectionTarget(editor, candidate.blockId);
  if (
    !target ||
    target.block.type !== candidate.blockType ||
    !canTargetEditorBlockSelection(target)
  )
    return null;
  const textOffset = Math.max(0, Math.trunc(candidate.textOffset));
  if (!blockUsesContentSelectionEndpoint(target))
    return createEditorLogicalSelectionPoint({
      graph: editor,
      blockId: target.block.id,
      textOffset,
      textAnchor: null,
      affinity: candidate.affinity,
    });
  let lease = leases.find((current) => current.blockId === candidate.blockId);
  if (!lease) {
    lease = contentRuntime.acquireBlockContent(
      candidate.blockId,
      candidate.blockType,
      "canonical-transaction",
    );
    leases.push(lease);
  }
  const anchor = createWebSelectionTextAnchorAtOffset({
    contentRuntime,
    contentLease: lease,
    blockId: candidate.blockId,
    blockType: candidate.blockType,
    textOffset,
    affinity: candidate.affinity,
  });
  return anchor.ok
    ? createEditorLogicalSelectionPoint({
        graph: editor,
        blockId: target.block.id,
        textOffset: anchor.textOffset,
        textAnchor: anchor.textAnchor,
        affinity: candidate.affinity,
      })
    : null;
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

function isBlockPresentedForKeyboardNavigation(
  blockDom: EditorBlockDomRegistryReader,
  blockId: BlockId,
): boolean {
  const shell = blockDom.getBlockShell(blockId);
  if (!shell) return true;
  return shell.closest("[hidden], [aria-hidden='true']") === null;
}

function isEditorKeyboardSelectionKey(
  key: string,
): key is EditorKeyboardSelectionKey {
  return (
    key === "ArrowUp" ||
    key === "ArrowDown" ||
    key === "ArrowLeft" ||
    key === "ArrowRight" ||
    key === "Home" ||
    key === "End"
  );
}

function selectionNavigationModifiersUnsupported(
  event: KeyboardEvent,
): boolean {
  if (!event.altKey && !event.ctrlKey && !event.metaKey) return false;
  if (event.key === "Home" || event.key === "End") {
    return event.altKey || (event.ctrlKey && event.metaKey);
  }
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return true;
  return event.metaKey && (event.altKey || event.ctrlKey);
}

function effectiveSelectionNavigationKey(
  event: KeyboardEvent,
  key: EditorKeyboardSelectionKey,
): EditorKeyboardSelectionKey {
  if (event.metaKey && key === "ArrowLeft") return "Home";
  if (event.metaKey && key === "ArrowRight") return "End";
  return key;
}

function rangeCollapsePoint(
  start: {
    readonly anchor: EditorLogicalSelectionPoint;
    readonly focus: EditorLogicalSelectionPoint;
  },
  key: EditorKeyboardSelectionKey,
  graph: AnyEditorRuntimePort,
): EditorLogicalSelectionPoint {
  const towardStart =
    key === "ArrowLeft" || key === "ArrowUp" || key === "Home";
  const order = compareEditorSelectionOrder(
    graph,
    start.anchor.blockId,
    start.focus.blockId,
  );
  if (order === null || order === 0) {
    const anchorBeforeFocus =
      start.anchor.blockId === start.focus.blockId
        ? start.anchor.textOffset <= start.focus.textOffset
        : start.anchor.blockId < start.focus.blockId;
    return towardStart === anchorBeforeFocus ? start.anchor : start.focus;
  }
  return towardStart === order < 0 ? start.anchor : start.focus;
}
