"use client";

import {
  createContext,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createIdleSelectionSnapshot,
  type EditorSelectionSnapshot,
  type EditorSelectionSnapshotEndpoint,
} from "@repo/editor-react/selection";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  deriveEditorSelectionRangeBlockForBlock,
  deriveEditorBlockSelectionPaint,
  isSelectionCoverageContentPaint,
  type EditorSelectionPaint,
  type EditorSelectionTextRangePaint,
} from "../paint/selection-paint.ts";

type EditorSelectionTextLengthInput = number | (() => number);

interface SelectionContextValue {
  readonly endpoint: EditorSelectionSnapshotEndpoint;
}

interface SelectionProviderProps {
  readonly endpoint: EditorSelectionSnapshotEndpoint;
  readonly children: ReactNode;
}

const idleSelectionSnapshot = createIdleSelectionSnapshot();
const SelectionContext = createContext<SelectionContextValue | null>(null);

export function SelectionProvider({
  endpoint,
  children,
}: SelectionProviderProps) {
  const value = useMemo(() => ({ endpoint }), [endpoint]);

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useEditorSelectionEndpoint(): EditorSelectionSnapshotEndpoint | null {
  return useContext(SelectionContext)?.endpoint ?? null;
}

export function useEditorSelectionSnapshot(): EditorSelectionSnapshot {
  const endpoint = useEditorSelectionEndpoint();
  return useSyncExternalStore(
    endpoint ? (listener) => endpoint.subscribe(listener) : subscribeNoop,
    endpoint ? () => endpoint.getSnapshot() : getIdleSelectionSnapshot,
    getIdleSelectionSnapshot,
  );
}

export function useEditorBlockSelectionPaint(
  blockId: BlockId,
  textLength: EditorSelectionTextLengthInput = 0,
): EditorSelectionPaint {
  const endpoint = useEditorSelectionEndpoint();
  const [paint, setPaint] = useState<EditorSelectionPaint>(() => {
    const snapshot = endpoint?.getSnapshot() ?? idleSelectionSnapshot;
    return deriveEditorBlockSelectionPaint({
      blockId,
      snapshot,
      textLength: resolveSelectionPaintTextLength(
        blockId,
        snapshot,
        textLength,
      ),
    });
  });
  const paintRef = useRef(paint);

  useLayoutEffect(() => {
    const readPaint = () => {
      const snapshot = endpoint?.getSnapshot() ?? idleSelectionSnapshot;
      return deriveEditorBlockSelectionPaint({
        blockId,
        snapshot,
        textLength: resolveSelectionPaintTextLength(
          blockId,
          snapshot,
          textLength,
        ),
      });
    };
    const syncPaint = () => {
      const nextPaint = readPaint();
      if (editorBlockSelectionPaintEqual(paintRef.current, nextPaint)) return;
      paintRef.current = nextPaint;
      setPaint(nextPaint);
    };

    syncPaint();
    if (!endpoint) return undefined;
    return endpoint.subscribeBlock(blockId, syncPaint);
  }, [blockId, endpoint, textLength]);

  return paint;
}

function resolveSelectionPaintTextLength(
  blockId: BlockId,
  snapshot: EditorSelectionSnapshot,
  textLength: EditorSelectionTextLengthInput,
): number {
  const rangeBlock = deriveEditorSelectionRangeBlockForBlock(blockId, snapshot);
  if (!rangeBlock || !isSelectionCoverageContentPaint(rangeBlock)) return 0;
  return typeof textLength === "function" ? textLength() : textLength;
}

function subscribeNoop(): () => void {
  return () => undefined;
}

function getIdleSelectionSnapshot(): EditorSelectionSnapshot {
  return idleSelectionSnapshot;
}

function editorBlockSelectionPaintEqual(
  left: EditorSelectionPaint,
  right: EditorSelectionPaint,
): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "none":
      return true;
    case "text-range":
      return (
        right.kind === "text-range" &&
        left.blockId === right.blockId &&
        left.coverageResult.coverage === right.coverageResult.coverage &&
        left.coverageResult.modelId === right.coverageResult.modelId &&
        editorSelectionTextPaintRangesEqual(left.ranges, right.ranges)
      );
    case "block-surface":
      return (
        right.kind === "block-surface" &&
        left.blockId === right.blockId &&
        left.coverageResult.coverage === right.coverageResult.coverage &&
        left.coverageResult.modelId === right.coverageResult.modelId &&
        left.target === right.target
      );
    case "block-internal":
      return (
        right.kind === "block-internal" &&
        left.blockId === right.blockId &&
        left.subsystem === right.subsystem &&
        left.selection === right.selection &&
        left.coverageResult === right.coverageResult
      );
  }
}

function editorSelectionTextPaintRangesEqual(
  left: readonly EditorSelectionTextRangePaint[],
  right: readonly EditorSelectionTextRangePaint[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((leftRange, index) => {
    const rightRange = right[index];
    return Boolean(
      rightRange &&
        leftRange.startOffset === rightRange.startOffset &&
        leftRange.endOffset === rightRange.endOffset &&
        leftRange.coverage === rightRange.coverage,
    );
  });
}
