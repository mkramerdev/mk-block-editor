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
  type EditorSelection,
  type EditorSelectionRangeBlock,
  type SelectionController,
  type TextPointerGesturePresentationClaim,
} from "@repo/editor-react/selection";
import type {
  EditorBlockContentLease,
  EditorContentRuntime,
} from "@repo/editor-core/content";
import type { EditableEditorRuntimePort } from "../../../runtime/document/render-port.ts";
import type { EditorDocumentLayerKeyboardDispatcher } from "../../../runtime/document/document-layer-interactions.ts";
import { createEditorDocumentInputRouting } from "../../../runtime/keybindings/document-input-routing.ts";
import type { EditorBlockDomRegistryReader } from "../../blocks/block-dom-registry.ts";
import { registerDocumentInteractionOwner } from "../../interaction/document-interaction-router.ts";
import { routeEditorDocumentKeydown } from "../../interaction/document-layer-keydown-routing.ts";
import type { ResolvedNativeFocusTarget } from "../../../runtime/document/native-focus-coordinator.ts";
import { pointerEventPreservesEditorSelection } from "../../interaction/interactive-targets.ts";
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
import { scrollKeyboardSelectionFocusIntoView } from "./keyboard-scroll.ts";
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
  suppressNativeSelection,
} from "./pointer-gesture.ts";
import {
  deriveDocumentSelectionPaintPrimitives,
  type DocumentSelectionPaintPrimitive,
} from "../paint/selection-paint-plan.ts";
import type { TransientPointerSelectionPaint } from "../paint/selection-paint-layer.tsx";
import type {
  EditorSelectionDragCallback,
  EditorSelectionDragSnapshot,
} from "../../../runtime/document/contracts.ts";
import {
  claimEditorNativeSelectionOwnership,
  registerEditorNativeSelectionOwnership,
  revokeEditorNativeSelectionOwnership,
} from "./native-selection-ownership.ts";
import type {
  EditorTextGestureArbitration,
  EditorTextGestureBoundarySession,
  EditorTextGesturePointer,
  EditorTransferredPointerGesture,
} from "./text-gesture-arbitration.tsx";

const editorOwnerByBlockList = new WeakMap<HTMLElement, EditableEditorRuntimePort>();
const DRAG_THRESHOLD_PX = 4;

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
  pointerPresentation: TextPointerGesturePresentationClaim | null;
  readonly settlementLeases: EditorBlockContentLease[];
  boundarySession: EditorTextGestureBoundarySession | null;
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
  readonly editor: EditableEditorRuntimePort;
  readonly contentRuntime: EditorContentRuntime;
  readonly selectionController: SelectionController;
  readonly captureStructuralSelection: CaptureStructuralSelection;
  readonly documentLayerKeyboard: EditorDocumentLayerKeyboardDispatcher;
  readonly textGestureArbitration: EditorTextGestureArbitration;
  readonly onTransientPointerPaintChange: (
    paint: TransientPointerSelectionPaint | null,
  ) => void;
  readonly onSelectionDragStart?: EditorSelectionDragCallback;
  readonly onSelectionDragUpdate?: EditorSelectionDragCallback;
  readonly onSelectionDragEnd?: EditorSelectionDragCallback;
  readonly shouldPublishSelectionDrag?: () => boolean;
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
  textGestureArbitration,
  onTransientPointerPaintChange,
  onSelectionDragStart,
  onSelectionDragUpdate,
  onSelectionDragEnd,
  shouldPublishSelectionDrag,
}: UseGlobalSelectionGesturesOptions): void {
  useLayoutEffect(() => {
    if (!listElement) return;
    const list = listElement;
    const doc = list.ownerDocument;
    const unregisterNativeSelectionOwnership =
      registerEditorNativeSelectionOwnership(list);
    const documentInput = createEditorDocumentInputRouting(doc, {
      definition: editor.definition,
      store: editor.store,
      editor,
    });
    editorOwnerByBlockList.set(list, editor);
    let pointer: BrowserPointerResource | null = null;
    let transferredPointer: EditorTransferredPointerGesture | null = null;
    let suppressCompletedDragClick = false;
    let transientPaintRevision = 0;
    let lastSelectionDragSnapshot: EditorSelectionDragSnapshot | null = null;

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
          ? {
              revision: ++transientPaintRevision,
              primitives,
            }
          : null,
      );
      publishSelectionDrag(resource);
    };
    const selectionDragLifecycleIsObserved = () =>
      shouldPublishSelectionDrag?.() ??
      Boolean(
        onSelectionDragStart || onSelectionDragUpdate || onSelectionDragEnd,
      );
    const publishSelectionDrag = (resource: BrowserPointerResource) => {
      if (!selectionDragLifecycleIsObserved()) return;
      const snapshot = materializeSelectionDragSnapshot(
        resource,
        editor,
        contentRuntime,
      );
      if (!snapshot) return;
      const started = lastSelectionDragSnapshot !== null;
      lastSelectionDragSnapshot = snapshot;
      if (started) onSelectionDragUpdate?.(snapshot);
      else onSelectionDragStart?.(snapshot);
    };
    const requestSettledTextPresentation = (
      point: EditorLogicalSelectionPoint,
    ): boolean => {
      if (!pointUsesContentSelectionEndpoint(point)) {
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
      else publishSelectionDrag(pointer);
    };
    const detachPointerResources = (): BrowserPointerResource | null => {
      if (!pointer) return null;
      const current = pointer;
      const endedSelectionDrag = lastSelectionDragSnapshot;
      pointer = null;
      lastSelectionDragSnapshot = null;
      onTransientPointerPaintChange(null);
      releaseContentLeases(current.settlementLeases);
      delete list.dataset.editorNativeCaretPointerPending;
      current.restoreNativeSelection?.();
      if (current.phase === "dragging") releasePointer(list, current.pointerId);
      if (endedSelectionDrag) onSelectionDragEnd?.(endedSelectionDrag);
      return current;
    };
    const finishPointer = (terminal: "settled" | "canceled") => {
      const current = detachPointerResources();
      if (!current) return;
      if (terminal === "canceled") suppressCompletedDragClick = false;
      current.boundarySession?.cancel();
      // Presentation is the final pointer resource to be released. Settled
      // range ownership or the retained caret therefore already determines
      // the next authoritative mode when this synchronous release publishes.
      current.pointerPresentation?.release();
    };
    const finishTransferredPointer = (cancel: boolean) => {
      const current = transferredPointer;
      transferredPointer = null;
      if (cancel) current?.cancel();
    };
    const pointerInput = (
      event: PointerEvent,
      target: EventTarget | null,
    ): EditorTextGesturePointer => ({
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      target,
    });
    const transferPointer = (
      resource: BrowserPointerResource,
      input: EditorTextGesturePointer,
    ): boolean => {
      const session = resource.boundarySession;
      if (!session || !session.shouldTransfer(input)) return false;
      resource.boundarySession = null;
      const current = detachPointerResources();
      if (!current) return false;
      try {
        const transferred = session.transfer(input);
        if (!transferred) {
          session.cancel();
          return true;
        }
        transferredPointer = transferred;
        return true;
      } finally {
        // Table transfer is synchronous: it first removes the native input
        // projection and commits block-internal paint. Only then may text
        // pointer presentation relinquish native suppression.
        current.pointerPresentation?.release();
      }
    };
    const clearSelectionForPointer = () => {
      revokeEditorNativeSelectionOwnership(list);
      finishPointer("canceled");
      selectionController.resetKeyboardNavigation();
      clearKeyboardSelectionActive(list);
      list.dataset.editorCanonicalSelectionClearPending = "true";
      try {
        selectionController.clearSelection({
          publication: { kind: "standalone-local" },
          cause: "pointer",
        });
        editor.blurEditor();
        clearNativeSelection(doc);
      } finally {
        delete list.dataset.editorCanonicalSelectionClearPending;
      }
    };
    const beginActiveDrag = (resource: BrowserPointerResource): boolean => {
      if (
        editor.getSelectionGraphRevision() !== resource.graphRevision
      ) {
        finishPointer("canceled");
        return false;
      }
      selectionController.resetKeyboardNavigation();
      resource.restoreNativeSelection ??= suppressNativeSelection(list);
      if (!capturePointer(list, resource.pointerId)) {
        finishPointer("canceled");
        return false;
      }
      resource.phase = "dragging";
      resource.anchorCandidate = pointerCandidateWithPhase(
        resource.anchorCandidate,
        "dragging",
      );
      return true;
    };
    const pointerdown = (event: PointerEvent) => {
      suppressCompletedDragClick = false;
      if (pointer) finishPointer("canceled");
      finishTransferredPointer(true);
      if (event.button !== 0) return;
      if (pointerEventPreservesEditorSelection(event)) return;
      const target = pointerEventTargetElement(event);
      if (!target || !list.contains(target)) {
        clearSelectionForPointer();
        return;
      }
      claimEditorNativeSelectionOwnership(list, "pointer");
      if (
        isPointerEventFromEditorInteractiveControl(event, list)
      ) {
        clearSelectionForPointer();
        return;
      }
      const hit = resolveHit(event.target, event.clientX, event.clientY, true);
      if (!hit) {
        clearSelectionForPointer();
        return;
      }
      const graphRevision = editor.getSelectionGraphRevision();
      const internalHost = pointerEventPathMatches(
        event,
        '[data-editor-block-internal-selection-host="true"]',
      );
      const startsInTextRoot = Boolean(
        target.closest('[data-editor-text-root="true"]'),
      );
      const boundarySession =
        internalHost && startsInTextRoot
          ? textGestureArbitration.begin(event.target, {
              pointerId: event.pointerId,
              graphRevision,
              blockId: hit.target.block.id,
              textOffset: hit.textOffset,
              affinity: hit.affinity,
              clientX: event.clientX,
              clientY: event.clientY,
              target: event.target,
            })
          : null;
      if (internalHost && !boundarySession) return;
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
        pointerPresentation: blockUsesContentSelectionEndpoint(hit.target)
          ? selectionController.claimTextPointerGesturePresentation()
          : null,
        settlementLeases: [],
        boundarySession,
      };
      list.dataset.editorNativeCaretPointerPending = "true";
      // Once the DOM gesture controller has accepted an ordinary text
      // gesture, it owns every endpoint. Prevent the browser from beginning a
      // parallel native range during the pending threshold window. Canonical
      // hit testing carries soft-wrap affinity through settlement, and the
      // active input projection remains the collapsed canonical caret.
      event.preventDefault();
      if (boundarySession) {
        const activation = editor.focusText(hit.target.block.id, {
          offset: hit.textOffset,
          affinity: hit.affinity,
          preventScroll: true,
        });
        if (activation.status === "rejected") {
          finishPointer("canceled");
          event.stopPropagation();
          return;
        }
      }
      if (blockUsesContentSelectionEndpoint(hit.target)) {
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
        pointerPresentation: null,
        settlementLeases: [],
        boundarySession: null,
      };
      if (!beginActiveDrag(pointer)) return;
      blurFocusedEditorElement(list);
      updatePointer(pointer, focusHit);
    };
    const pointermove = (event: PointerEvent) => {
      if (
        transferredPointer &&
        transferredPointer.pointerId === event.pointerId
      ) {
        const target = doc.elementFromPoint?.(event.clientX, event.clientY);
        transferredPointer.move(pointerInput(event, target));
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!pointer || pointer.pointerId !== event.pointerId) return;
      pointer.lastClientX = event.clientX;
      pointer.lastClientY = event.clientY;
      const pointedTarget =
        doc.elementFromPoint?.(event.clientX, event.clientY) ?? event.target;
      if (pointer.phase === "pending") {
        const dx = event.clientX - pointer.startClientX;
        const dy = event.clientY - pointer.startClientY;
        if (dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
          event.preventDefault();
          return;
        }
        if (transferPointer(pointer, pointerInput(event, pointedTarget))) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const hit = resolveHit(pointedTarget, event.clientX, event.clientY);
        if (!hit) {
          finishPointer("canceled");
          event.preventDefault();
          return;
        }
        if (!beginActiveDrag(pointer)) {
          event.preventDefault();
          return;
        }
        updatePointer(pointer, hit);
      } else {
        if (transferPointer(pointer, pointerInput(event, pointedTarget))) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        const hit = resolveHit(pointedTarget, event.clientX, event.clientY);
        if (!hit) {
          publishSelectionDrag(pointer);
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
      if (
        transferredPointer &&
        transferredPointer.pointerId === event.pointerId
      ) {
        const current = transferredPointer;
        transferredPointer = null;
        const target = doc.elementFromPoint?.(event.clientX, event.clientY);
        current.finish(pointerInput(event, target));
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (!pointer || pointer.pointerId !== event.pointerId) return;
      const current = pointer;
      current.lastClientX = event.clientX;
      current.lastClientY = event.clientY;
      if (editor.getSelectionGraphRevision() !== current.graphRevision) {
        finishPointer("canceled");
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      const hit = resolveHit(event.target, event.clientX, event.clientY);
      if (!hit && current.phase === "pending") {
        finishPointer("canceled");
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
      } else if (current.phase === "dragging") publishSelectionDrag(current);
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
      if (settlement.kind !== "rejected") {
        const committed = selectionController.getCommittedSnapshot();
        const inputPoint = committed?.focus.target ?? null;
        if (inputPoint && pointUsesContentSelectionEndpoint(inputPoint)) {
          requestSettledTextPresentation(inputPoint);
        }
      }
      event.preventDefault();
      event.stopPropagation();
      suppressCompletedDragClick = true;
      finishPointer("settled");
    };
    const click = (event: MouseEvent) => {
      if (!suppressCompletedDragClick) return;
      suppressCompletedDragClick = false;
      event.preventDefault();
      event.stopPropagation();
    };
    const pointercancel = (event: PointerEvent) => {
      if (
        transferredPointer &&
        transferredPointer.pointerId === event.pointerId
      ) {
        finishTransferredPointer(true);
        return;
      }
      if (!pointer || pointer.pointerId !== event.pointerId) return;
      finishPointer("canceled");
    };
    const lostpointercapture = (event: PointerEvent) => {
      if (
        transferredPointer &&
        transferredPointer.pointerId === event.pointerId
      ) {
        finishTransferredPointer(true);
        return;
      }
      if (
        event.target !== list ||
        event.currentTarget !== list ||
        pointer?.phase !== "dragging" ||
        pointer.pointerId !== event.pointerId
      )
        return;
      finishPointer("canceled");
    };
    const documentLoss = () => {
      finishPointer("canceled");
      finishTransferredPointer(true);
    };
    const visibilitychange = () => {
      if (doc.visibilityState === "hidden") documentLoss();
    };
    const releaseInteractionOwner = () => {
      clearSelectionForPointer();
    };
    const interactionOwnerPointerdown = (event: PointerEvent) => {
      if (
        event.button !== 0 ||
        pointerEventPreservesEditorSelection(event) ||
        pointerEventPathContains(event, list)
      ) {
        return;
      }
      clearSelectionForPointer();
    };
    const keydown = (
      event: KeyboardEvent,
      nativeFocus: ResolvedNativeFocusTarget,
    ) => {
      const eventTarget = event.target instanceof Element ? event.target : null;
      if (!nativeFocus) return;
      claimEditorNativeSelectionOwnership(list, "keyboard");
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
        if (pointUsesContentSelectionEndpoint(range.focus)) {
          requestSettledTextPresentation(range.focus);
        }
        releaseContentLeases(selectionLeases);
        markKeyboardSelectionActive(list);
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.key === "Escape") {
        if (transferredPointer) {
          finishTransferredPointer(true);
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        if (selectionController.getPresentationSnapshot().composition) return;
        if (pointer) {
          finishPointer("canceled");
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
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        committedSelectionIsNoncollapsed(
          selectionController.getCommittedSnapshot(),
        ) &&
        !event.isComposing &&
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
        event.preventDefault();
        event.stopPropagation();
        const productPlan =
          editor.definition.selectionFragment?.planStructuralRangeDeletion?.({
            intent: "delete",
            range: capture.range,
            graph: editor,
            readBlockContent: (blockId, blockType) =>
              contentRuntime.readBlockProjection(blockId, blockType),
          }) ?? null;
        const result = productPlan
          ? editor.executeStructuralTransaction(productPlan, {
              provenance: null,
              selectionPresentation: "native-before-removal",
            })
          : editor.executeStructuralRangeDeletion(capture.range, {
              intent: "delete",
              provenance: null,
              selectionPresentation: "native-final-selection",
              resolveVisibleChildBlockIds:
                editor.definition.selectionFragment
                  ?.resolveVisibleChildBlockIds,
            });
        if (!result.ok) return;
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
      const focusedCaret = !extendsSelection
        ? resolveFocusedKeyboardCaret(list, editor)
        : null;
      const focusedBlock = focusedCaret
        ? editor.getBlock(focusedCaret.blockId)
        : null;
      const focusedContent = focusedBlock
        ? contentRuntime.readBlockProjection(focusedBlock.id, focusedBlock.type)
        : null;
      if (
        focusedCaret &&
        eventTarget?.closest(
          '[data-editor-text-root="true"][contenteditable="true"]',
        ) &&
        !committedSelectionIsNoncollapsed(
          selectionController.getCommittedSnapshot(),
        ) &&
        ((event.key === "ArrowLeft" && focusedCaret.textOffset > 0) ||
          (event.key === "ArrowRight" &&
            focusedContent !== null &&
            focusedCaret.textOffset <
              richTextDocumentContentSize(focusedContent)) ||
          ((event.key === "Home" || event.key === "End") &&
            !event.ctrlKey &&
            !event.metaKey))
      ) {
        // A collapsed caret in the active text projection remains a native
        // editing concern. ProseMirror performs the movement and the collapsed
        // selection mirror is synchronized afterward.
        return;
      }
      const start = resolveKeyboardSelectionStart(
        list,
        editor,
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
      if (canonical.kind !== "document") return;
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
      revokeNativeSelectionOwnership: () =>
        revokeEditorNativeSelectionOwnership(list),
      releaseInteraction: releaseInteractionOwner,
      pointerdown: interactionOwnerPointerdown,
      pointermove,
      pointerup,
      pointercancel,
      beforeinput: (event) => {
        claimEditorNativeSelectionOwnership(list, "input");
        if (
          event.inputType !== "historyUndo" &&
          event.inputType !== "historyRedo"
        ) {
          return;
        }
        documentInput?.beforeinput(
          event,
          editor.resolveNativeFocusTarget(event.target),
        );
      },
      keydown: (event) =>
        routeEditorDocumentKeydown(
          event,
          documentLayerKeyboard,
          documentInput,
          (target) => editor.resolveNativeFocusTarget(target),
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
      finishPointer("canceled");
      finishTransferredPointer(true);
      suppressCompletedDragClick = false;
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
      unregisterNativeSelectionOwnership();
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
    onSelectionDragEnd,
    onSelectionDragStart,
    onSelectionDragUpdate,
    selectionController,
    shouldPublishSelectionDrag,
    textGestureArbitration,
  ]);
}

function pointerEventPathContains(event: Event, element: Element): boolean {
  const path = event.composedPath?.() ?? [];
  if (path.includes(element)) return true;
  const target = pointerEventTargetElement(event);
  return Boolean(target && element.contains(target));
}

function pointerEventPathMatches(event: Event, selector: string): boolean {
  const path = event.composedPath?.() ?? [];
  if (
    path.some((target) => target instanceof Element && target.matches(selector))
  ) {
    return true;
  }
  return Boolean(pointerEventTargetElement(event)?.closest(selector));
}

function materializeSelectionDragSnapshot(
  resource: BrowserPointerResource,
  editor: EditableEditorRuntimePort,
  contentRuntime: EditorContentRuntime,
): EditorSelectionDragSnapshot | null {
  const points = materializePointerSettlement(resource, editor, contentRuntime);
  if (!points) return null;
  const selection: EditorSelection = {
    direction: points.direction,
    anchor: points.anchor,
    focus: points.focus,
  };
  return {
    selection,
    anchor: points.anchor,
    focus: points.focus,
    pointer: {
      clientX: resource.lastClientX,
      clientY: resource.lastClientY,
    },
  };
}

function readCanonicalKeyboardNavigationText(
  contentRuntime: EditorContentRuntime,
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
  editor: EditableEditorRuntimePort,
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
  editor: EditableEditorRuntimePort,
): EditorLogicalSelectionPoint | null {
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
  editor: EditableEditorRuntimePort,
  contentRuntime: EditorContentRuntime,
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
  editor: EditableEditorRuntimePort,
  contentRuntime: EditorContentRuntime,
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
  return {
    pointerId,
    graphRevision,
    blockId: target.block.id,
    blockType: target.block.type,
    textOffset,
    affinity,
    phase,
  };
}

function pointerCandidateWithPhase(
  candidate: PointerSelectionCandidate,
  phase: PointerSelectionCandidate["phase"],
): PointerSelectionCandidate {
  return candidate.phase === phase ? candidate : { ...candidate, phase };
}

function deriveTransientPointerPaintPrimitives(
  anchor: PointerSelectionCandidate,
  focus: PointerSelectionCandidate,
  editor: EditableEditorRuntimePort,
): readonly DocumentSelectionPaintPrimitive[] | null {
  const graphRevision = editor.getSelectionGraphRevision();
  if (
    anchor.graphRevision !== graphRevision ||
    focus.graphRevision !== graphRevision ||
    (anchor.blockId === focus.blockId && anchor.textOffset === focus.textOffset)
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
  const comparison = comparePointerCandidates(anchor, focus, orderByBlockId);
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
  readonly editor: EditableEditorRuntimePort;
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
      .map((blockId) => readEditorBlockSelectionTarget(context.editor, blockId))
      .filter((child): child is EditorBlockSelectionTarget => child !== null)
      .map((child) => evaluateTransientPointerCoverage(child, context));
    childCoverages = children.map((child) => ({
      blockId: child.blockId,
      coverage: child.coverage,
    }));
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
  const selected = childCoverages.filter((child) => child.coverage !== "none");
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
  if (left.blockId === right.blockId) return left.textOffset - right.textOffset;
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
  return {
    pointerId,
    graphRevision,
    blockId: hit.target.block.id,
    blockType: hit.target.block.type,
    textOffset: hit.textOffset,
    affinity: hit.affinity,
    phase,
  };
}

function materializePointerSettlement(
  resource: BrowserPointerResource,
  editor: EditableEditorRuntimePort,
  contentRuntime: EditorContentRuntime,
): {
  readonly direction: "forward" | "backward";
  readonly anchor: EditorLogicalSelectionPoint;
  readonly focus: EditorLogicalSelectionPoint;
} | null {
  if (editor.getSelectionGraphRevision() !== resource.graphRevision)
    return null;
  const collapsed =
    resource.phase === "pending" ||
    (resource.anchorCandidate.blockId === resource.focusCandidate.blockId &&
      resource.anchorCandidate.textOffset ===
        resource.focusCandidate.textOffset);
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
  return {
    direction:
      order < 0 || (order === 0 && anchor.textOffset <= focus.textOffset)
        ? "forward"
        : "backward",
    anchor,
    focus,
  };
}

function materializePointerCandidate(
  candidate: PointerSelectionCandidate,
  editor: EditableEditorRuntimePort,
  contentRuntime: EditorContentRuntime,
  leases: EditorBlockContentLease[],
): EditorLogicalSelectionPoint | null {
  if (candidate.graphRevision !== editor.getSelectionGraphRevision())
    return null;
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
  graph: EditableEditorRuntimePort,
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
