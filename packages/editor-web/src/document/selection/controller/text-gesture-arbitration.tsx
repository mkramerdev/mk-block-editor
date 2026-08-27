"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useRef,
  type RefCallback,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorSelectionTextAffinity } from "@repo/editor-react/selection";

export interface EditorTextGestureStart {
  readonly pointerId: number;
  readonly graphRevision: number;
  readonly blockId: BlockId;
  readonly textOffset: number;
  readonly affinity: EditorSelectionTextAffinity | null;
  readonly clientX: number;
  readonly clientY: number;
  readonly target: EventTarget | null;
}

export interface EditorTextGesturePointer {
  readonly pointerId: number;
  readonly clientX: number;
  readonly clientY: number;
  readonly target: EventTarget | null;
}

export interface EditorTransferredPointerGesture {
  readonly pointerId: number;
  move(pointer: EditorTextGesturePointer): void;
  finish(pointer: EditorTextGesturePointer): void;
  cancel(): void;
}

export interface EditorTextGestureBoundarySession {
  shouldTransfer(pointer: EditorTextGesturePointer): boolean;
  transfer(
    pointer: EditorTextGesturePointer,
  ): EditorTransferredPointerGesture | null;
  cancel(): void;
}

export interface EditorTextGestureBoundary {
  begin(start: EditorTextGestureStart): EditorTextGestureBoundarySession | null;
}

export interface EditorTextGestureArbitration {
  register(
    element: HTMLElement,
    boundary: EditorTextGestureBoundary,
  ): () => void;
  begin(
    target: EventTarget | null,
    start: EditorTextGestureStart,
  ): EditorTextGestureBoundarySession | null;
}

export function createEditorTextGestureArbitration(): EditorTextGestureArbitration {
  const boundaries = new Map<HTMLElement, EditorTextGestureBoundary>();
  return {
    register(element, boundary) {
      boundaries.set(element, boundary);
      return () => {
        if (boundaries.get(element) === boundary) boundaries.delete(element);
      };
    },
    begin(target, start) {
      let element =
        target instanceof Element
          ? target
          : target instanceof Node
            ? target.parentElement
            : null;
      while (element) {
        const boundary =
          element instanceof HTMLElement ? boundaries.get(element) : undefined;
        if (boundary) return boundary.begin(start);
        element = element.parentElement;
      }
      return null;
    },
  };
}

const EditorTextGestureArbitrationContext =
  createContext<EditorTextGestureArbitration | null>(null);

export const EditorTextGestureArbitrationProvider =
  EditorTextGestureArbitrationContext.Provider;

/** Registers one renderer-owned promotion boundary around nested text. */
export function useEditorTextGestureBoundary(
  boundary: EditorTextGestureBoundary,
): RefCallback<HTMLElement> {
  const arbitration = useContext(EditorTextGestureArbitrationContext);
  const boundaryRef = useRef(boundary);
  const unregisterRef = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    boundaryRef.current = boundary;
  }, [boundary]);
  useLayoutEffect(
    () => () => {
      unregisterRef.current?.();
      unregisterRef.current = null;
    },
    [],
  );
  return useCallback(
    (element) => {
      unregisterRef.current?.();
      unregisterRef.current = null;
      if (!element || !arbitration) return;
      unregisterRef.current = arbitration.register(element, {
        begin: (start) => boundaryRef.current.begin(start),
      });
    },
    [arbitration],
  );
}
