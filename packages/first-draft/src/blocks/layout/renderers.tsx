"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import { useDirectChildBlocks } from "@repo/editor-web/block-renderer";
import type { FirstDraftBlockRendererProps } from "../../first-draft-editor-contracts.ts";
import {
  FIRST_DRAFT_BLOCK_CONTROL_OFFSETS,
  FirstDraftBlockChrome,
} from "../../block-controls/index.ts";
import {
  COLUMN_PREFERRED_MIN_WIDTH_PX,
  columnWeightsToGridTracks,
  readColumnLayoutWeight,
  resizeAdjacentColumnWeights,
  type OrderedColumnWeight,
} from "../columns/model.ts";
import { useSelectTab, useSelectedTab } from "../view-state.tsx";

type Props = FirstDraftBlockRendererProps;

const COLUMN_SHELL_SELECTOR =
  ':scope > [data-editor-block-shell="true"][data-editor-block-type="column"]';

interface ColumnResizeGesture {
  readonly pointerId: number;
  readonly startX: number;
  readonly index: number;
  readonly leftWidth: number;
  readonly rightWidth: number;
  readonly leftId: BlockId;
  readonly rightId: BlockId;
  readonly revision: string;
  readonly direction: "ltr" | "rtl";
  readonly captureElement: HTMLDivElement;
  readonly gridElement: HTMLDivElement;
  readonly overlayElement: HTMLDivElement;
  readonly committedTracks: string;
  readonly initialLeftWeight: number;
  readonly initialColumns: readonly OrderedColumnWeight[];
  preview: readonly OrderedColumnWeight[];
}

export function ColumnsRenderer({ block, editor, children }: Props) {
  const directChildren = useDirectChildBlocks(editor, block.id);
  const columns = useMemo(
    () =>
      directChildren.map((child) => ({
        id: child.id,
        weight: readColumnLayoutWeight(child.metadata) ?? 0,
      })),
    [directChildren],
  );
  const valid =
    columns.length >= 2 && columns.every(({ weight }) => weight > 0);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const gestureRef = useRef<ColumnResizeGesture | null>(null);
  const revision = columns.map(({ id, weight }) => `${id}:${weight}`).join("|");
  const revisionRef = useRef(revision);
  const tracks = columnWeightsToGridTracks(columns) ?? "none";
  const style = { "--columns-block-tracks": tracks } as CSSProperties;

  const cancelResize = useCallback((restorePreview = true) => {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (gesture) {
      releasePointerCapture(gesture.captureElement, gesture.pointerId);
      if (restorePreview) restoreColumnPreview(gesture);
    }
  }, []);

  const begin = useCallback(
    (index: number, event: ReactPointerEvent<HTMLDivElement>) => {
      if (
        !editor.editable ||
        !valid ||
        gestureRef.current ||
        event.button !== 0 ||
        event.isPrimary === false
      )
        return;
      const lanes = gridRef.current?.querySelectorAll<HTMLElement>(
        COLUMN_SHELL_SELECTOR,
      );
      const leftWidth = lanes?.[index]?.getBoundingClientRect().width;
      const rightWidth = lanes?.[index + 1]?.getBoundingClientRect().width;
      const left = columns[index];
      const right = columns[index + 1];
      const gridElement = gridRef.current;
      const overlayElement = event.currentTarget.parentElement;
      if (
        !left ||
        !right ||
        !gridElement ||
        !(overlayElement instanceof HTMLDivElement) ||
        !Number.isFinite(leftWidth) ||
        !Number.isFinite(rightWidth) ||
        !leftWidth ||
        !rightWidth
      )
        return;
      const captureElement = event.currentTarget;
      const gesture: ColumnResizeGesture = {
        pointerId: event.pointerId,
        startX: event.clientX,
        index,
        leftWidth,
        rightWidth,
        leftId: left.id,
        rightId: right.id,
        revision,
        direction:
          getComputedStyle(gridElement).direction === "rtl" ? "rtl" : "ltr",
        captureElement,
        gridElement,
        overlayElement,
        committedTracks: tracks,
        initialLeftWeight: left.weight,
        initialColumns: columns,
        preview: columns,
      };
      event.preventDefault();
      event.stopPropagation();
      gestureRef.current = gesture;
      try {
        captureElement.setPointerCapture(event.pointerId);
        if (!captureElement.hasPointerCapture(event.pointerId)) {
          throw new Error("Column resize pointer capture was not acquired");
        }
      } catch {
        cancelResize(false);
        return;
      }
      editor.blurEditor();
    },
    [cancelResize, columns, editor, revision, tracks, valid],
  );
  const move = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      const stillCaptured =
        typeof gesture.captureElement.hasPointerCapture === "function" &&
        gesture.captureElement.hasPointerCapture(gesture.pointerId);
      if (
        (event.buttons & 1) === 0 ||
        !stillCaptured ||
        revisionRef.current !== gesture.revision
      ) {
        cancelResize(revisionRef.current === gesture.revision);
        return;
      }
      const next = previewResizeAt(gesture, event.clientX);
      if (!next) {
        cancelResize();
        return;
      }
      gesture.preview = next;
      projectColumnPreview(gesture, next);
    },
    [cancelResize],
  );
  const completeResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      if (revisionRef.current !== gesture.revision) {
        cancelResize(false);
        return;
      }
      const finalPreview = previewResizeAt(gesture, event.clientX);
      if (!finalPreview) {
        cancelResize();
        return;
      }
      const left = finalPreview[gesture.index];
      const right = finalPreview[gesture.index + 1];
      const initialLeft = gesture.initialColumns[gesture.index];
      const initialRight = gesture.initialColumns[gesture.index + 1];
      gestureRef.current = null;
      releasePointerCapture(gesture.captureElement, gesture.pointerId);
      if (
        !left ||
        !right ||
        left.id !== gesture.leftId ||
        right.id !== gesture.rightId ||
        !initialLeft ||
        !initialRight ||
        (left.weight === initialLeft.weight &&
          right.weight === initialRight.weight)
      ) {
        restoreColumnPreview(gesture);
        return;
      }
      editor.updateBlockMetadata(
        [
          { blockId: left.id, values: { layoutWeight: left.weight } },
          { blockId: right.id, values: { layoutWeight: right.weight } },
        ],
        { editorSuggestion: null },
      );
    },
    [cancelResize, editor],
  );

  useLayoutEffect(() => {
    revisionRef.current = revision;
    const gesture = gestureRef.current;
    if (gesture && gesture.revision !== revision) {
      // External column authority invalidates the local preview.
      cancelResize(false);
    }
  }, [cancelResize, revision]);
  useEffect(() => () => cancelResize(false), [cancelResize]);

  const keyboardResize = useCallback(
    (index: number, physicalDelta: number) => {
      const lanes = gridRef.current?.querySelectorAll<HTMLElement>(
        COLUMN_SHELL_SELECTOR,
      );
      const leftWidth = lanes?.[index]?.getBoundingClientRect().width;
      const rightWidth = lanes?.[index + 1]?.getBoundingClientRect().width;
      if (!leftWidth || !rightWidth) return;
      const direction = getComputedStyle(gridRef.current!).direction;
      const next = resizeAdjacentColumnWeights({
        columns,
        leftIndex: index,
        leftWidth,
        rightWidth,
        delta: direction === "rtl" ? -physicalDelta : physicalDelta,
        minimumWidth: Math.min(
          COLUMN_PREFERRED_MIN_WIDTH_PX,
          (leftWidth + rightWidth) / 2,
        ),
      });
      const left = next?.[index];
      const right = next?.[index + 1];
      if (!left || !right) return;
      editor.updateBlockMetadata(
        [
          { blockId: left.id, values: { layoutWeight: left.weight } },
          { blockId: right.id, values: { layoutWeight: right.weight } },
        ],
        { editorSuggestion: null },
      );
    },
    [columns, editor],
  );

  return (
    <div
      ref={gridRef}
      className="columns-block__grid"
      role="group"
      aria-label="Columns layout"
      style={style}
    >
      {children}
      {valid ? (
        <div className="columns-block__resize-overlay" style={style}>
          {columns.slice(0, -1).map((left, index) => {
            const right = columns[index + 1]!;
            return (
              <div
                key={`${left.id}|${right.id}`}
                className="columns-block__resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label={`Resize between columns ${index + 1} and ${index + 2}`}
                aria-valuemin={1}
                aria-valuenow={left.weight}
                aria-valuemax={left.weight + right.weight - 1}
                tabIndex={0}
                onPointerDown={(event) => begin(index, event)}
                onPointerMove={move}
                onPointerUp={completeResize}
                onPointerCancel={(event) => {
                  if (gestureRef.current?.pointerId !== event.pointerId) return;
                  event.preventDefault();
                  event.stopPropagation();
                  cancelResize();
                }}
                onLostPointerCapture={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    gestureRef.current?.pointerId === event.pointerId
                  )
                    cancelResize();
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelResize();
                    return;
                  }
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
                    return;
                  event.preventDefault();
                  event.stopPropagation();
                  const amount = event.shiftKey ? 32 : 8;
                  keyboardResize(
                    index,
                    event.key === "ArrowLeft" ? -amount : amount,
                  );
                }}
              />
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function previewResizeAt(
  gesture: ColumnResizeGesture,
  clientX: number,
): readonly OrderedColumnWeight[] | null {
  const physicalDelta = clientX - gesture.startX;
  return resizeAdjacentColumnWeights({
    columns: gesture.initialColumns,
    leftIndex: gesture.index,
    leftWidth: gesture.leftWidth,
    rightWidth: gesture.rightWidth,
    delta: gesture.direction === "rtl" ? -physicalDelta : physicalDelta,
    minimumWidth: Math.min(
      COLUMN_PREFERRED_MIN_WIDTH_PX,
      (gesture.leftWidth + gesture.rightWidth) / 2,
    ),
  });
}

function projectColumnPreview(
  gesture: ColumnResizeGesture,
  preview: readonly OrderedColumnWeight[],
): void {
  const tracks = columnWeightsToGridTracks(preview);
  const left = preview[gesture.index];
  if (!tracks || !left) return;
  gesture.gridElement.style.setProperty("--columns-block-tracks", tracks);
  gesture.overlayElement.style.setProperty("--columns-block-tracks", tracks);
  gesture.captureElement.setAttribute("aria-valuenow", String(left.weight));
}

function restoreColumnPreview(gesture: ColumnResizeGesture): void {
  gesture.gridElement.style.setProperty(
    "--columns-block-tracks",
    gesture.committedTracks,
  );
  gesture.overlayElement.style.setProperty(
    "--columns-block-tracks",
    gesture.committedTracks,
  );
  gesture.captureElement.setAttribute(
    "aria-valuenow",
    String(gesture.initialLeftWeight),
  );
}

function releasePointerCapture(element: HTMLElement, pointerId: number): void {
  try {
    if (
      typeof element.hasPointerCapture !== "function" ||
      element.hasPointerCapture(pointerId)
    ) {
      element.releasePointerCapture(pointerId);
    }
  } catch {
    // Capture may already be gone after cancellation or DOM removal.
  }
}

export function ColumnRenderer({ block, editor, children }: Props) {
  const siblings = useDirectChildBlocks(editor, block.parentId!);
  const index = siblings.findIndex((candidate) => candidate.id === block.id);
  return (
    <section className="columns-block__lane" aria-label={`Column ${index + 1}`}>
      {children}
    </section>
  );
}

export function TabsRenderer({ block, editor, children }: Props) {
  const blocks = useDirectChildBlocks(editor, block.id);
  const selected = useSelectedTab(block.id);
  const select = useSelectTab(block.id);
  const active =
    blocks.find((candidate) => candidate.id === selected) ?? blocks[0] ?? null;
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.tabs}
      />
      <div className="tabs-block__tabs" role="group" aria-label="Tabs">
        <div className="tabs-block__tablist" role="tablist" aria-label="Tabs">
          {blocks.map((pane, index) => {
            const title =
              typeof pane.metadata?.title === "string" && pane.metadata.title
                ? pane.metadata.title
                : `Tab ${index + 1}`;
            return (
              <button
                type="button"
                className="tabs-block__tab"
                role="tab"
                aria-selected={pane.id === active?.id}
                key={pane.id}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  select(pane.id as BlockId);
                }}
              >
                {title}
              </button>
            );
          })}
        </div>
        <div className="tabs-block__panel" role="tabpanel">
          {children}
        </div>
      </div>
    </>
  );
}

export function TabPaneRenderer({ block, editor, children }: Props) {
  const tabsId = block.parentId!;
  const selected = useSelectedTab(tabsId);
  const panes = useDirectChildBlocks(editor, tabsId);
  const activePaneId =
    panes.find((candidate) => candidate.id === selected)?.id ??
    panes[0]?.id ??
    null;
  return (
    <div className="tabs-block__pane" hidden={block.id !== activePaneId}>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.tabPane}
        visible={block.id === activePaneId}
      />
      <div className="tabs-block__pane-contents">{children}</div>
    </div>
  );
}
