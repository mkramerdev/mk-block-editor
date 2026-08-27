"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  editorSelectionBoundsDataAttributes,
  useDirectChildBlocks,
} from "@repo/editor-web/block-renderer";
import { Plus } from "lucide-react";
import type {
  FirstDraftBlockRendererProps,
  FirstDraftEditor,
} from "../../first-draft-editor-contracts.ts";
import {
  FIRST_DRAFT_BLOCK_CONTROL_OFFSETS,
  FirstDraftBlockChrome,
} from "../../block-controls/index.ts";
import {
  COLUMN_PREFERRED_MIN_WIDTH_PX,
  columnWeightsToGridTracks,
  resolveColumnLayoutPresentation,
  resizeAdjacentColumnWeights,
  type OrderedColumnWeight,
} from "../columns/model.ts";
import {
  resolveEffectiveFirstDraftTabPaneId,
  useFirstDraftViewStateStore,
  useSelectTab,
  useSelectedTab,
} from "../view-state.tsx";
import {
  useOptionalFirstDraftTabsActionUiSnapshot,
  useOptionalFirstDraftTabsActionUiStore,
  type FirstDraftTabsRenameSession,
} from "../../tabs-action-menu/index.ts";
import { addFirstDraftTab, renameFirstDraftTab } from "./tabs-mutations.ts";
import {
  isFirstDraftBlockDropAnchorEligible,
  useFirstDraftBlockDropTargetRef,
} from "../../block-drag-and-drop/index.ts";
import { FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET } from "../../block-drag-and-drop/document-drag-visual-bounds.ts";
import { EmptyWrapperAddTextControl } from "../empty-wrapper-add-text-control.tsx";
import { FirstDraftAppendParagraphSurface } from "../append-paragraph-surface.tsx";
import {
  ColumnBoundaryPresentation,
  ColumnsBoundaryOverlay,
  ColumnsPresentation,
} from "../presentations.tsx";

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

export function ColumnsRenderer(props: Props) {
  const afterTargetRef = useAfterBlockTargetRef(props.block.id);
  const hasAfterTarget = shouldRenderAfterBlockTarget(props.editor, props.block.id);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const initialLayout = resolveColumnLayoutPresentation({
    columnsId: props.block.id,
    records: props.editor
      .getChildBlockIds(props.block.id)
      .map((blockId) => props.editor.getBlock(blockId)),
  });
  return <>
    <ColumnsPresentation
      tracks={initialLayout.tracks}
      rootRef={gridRef}
      rootAttributes={editorSelectionBoundsDataAttributes(props.block.id, {
        target: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
      })}
    >
      {props.children}
      <ColumnResizeController
        block={props.block}
        editor={props.editor}
        gridRef={gridRef}
      />
    </ColumnsPresentation>
    {hasAfterTarget ? <div ref={afterTargetRef} className="first-draft-block-drop-target" data-first-draft-block-drop-target-active="false" data-editor-ui="true" aria-hidden="true" /> : null}
  </>;
}

function ColumnResizeController({
  block,
  editor,
  gridRef,
}: Pick<Props, "block" | "editor"> & {
  readonly gridRef: RefObject<HTMLDivElement | null>;
}) {
  const directChildren = useDirectChildBlocks(editor, block.id);
  const layout = useMemo(
    () => resolveColumnLayoutPresentation({
      columnsId: block.id,
      records: directChildren,
    }),
    [block.id, directChildren],
  );
  const columns = layout.columns;
  const valid = layout.resizeValid;
  const gestureRef = useRef<ColumnResizeGesture | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const revision = columns.map(({ id, weight }) => `${id}:${weight}`).join("|");
  const revisionRef = useRef(revision);
  const tracks = layout.tracks;

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
      const overlayElement = overlayRef.current;
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
    [cancelResize, columns, editor, gridRef, revision, tracks, valid],
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
    setColumnTrackProperty(gridRef.current, tracks);
    revisionRef.current = revision;
    const gesture = gestureRef.current;
    if (gesture && gesture.revision !== revision) {
      // External column authority invalidates the local preview.
      cancelResize(false);
    }
  }, [cancelResize, gridRef, revision, tracks]);
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
    [columns, editor, gridRef],
  );

  return columns.length > 1 ? (
    <ColumnsBoundaryOverlay tracks={tracks} rootRef={overlayRef}>
      {columns.slice(0, -1).map((left, index) => {
        const right = columns[index + 1]!;
        return (
          <ColumnBoundaryPresentation key={`${left.id}|${right.id}`}>
            {valid ? (
              <div
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
            ) : null}
          </ColumnBoundaryPresentation>
        );
      })}
    </ColumnsBoundaryOverlay>
  ) : null;
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

function setColumnTrackProperty(
  element: HTMLElement | null,
  tracks: string,
): void {
  if (
    element?.style.getPropertyValue("--columns-block-tracks") !== tracks
  ) {
    element?.style.setProperty("--columns-block-tracks", tracks);
  }
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
  const childStartTargetRef = useChildStartTargetRef(block.id);
  const hasChildTarget = shouldRenderChildStartTarget(editor, block.id);
  return (
    <section className="columns-block__lane" aria-label="Column">
      {hasChildTarget ? <div ref={childStartTargetRef} className="first-draft-block-drop-target" data-first-draft-block-drop-target-active="false" data-editor-ui="true" aria-hidden="true" /> : null}
      {children}
      <FirstDraftAppendParagraphSurface
        editor={editor}
        parentId={block.id}
        scope="column"
        ariaLabel="Add paragraph at end of column"
      />
    </section>
  );
}

export function TabsRenderer(props: Props) {
  const afterTargetRef = useAfterBlockTargetRef(props.block.id);
  const hasAfterTarget = shouldRenderAfterBlockTarget(props.editor, props.block.id);
  return <>
    <FirstDraftBlockChrome
      blockId={props.block.id}
      editor={props.editor}
      blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.tabs}
    />
    <div
      className="tabs-block__tabs"
      role="group"
      aria-label="Tabs"
      {...editorSelectionBoundsDataAttributes(props.block.id, {
        target: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
      })}
    >
      <TabsNavigationController block={props.block} editor={props.editor} />
      <div className="tabs-block__panel" role="tabpanel">
        {props.children}
      </div>
    </div>
    {hasAfterTarget ? <div ref={afterTargetRef} className="first-draft-block-drop-target" data-first-draft-block-drop-target-active="false" data-editor-ui="true" aria-hidden="true" /> : null}
  </>;
}

function TabsNavigationController({
  block,
  editor,
}: Pick<Props, "block" | "editor">) {
  const blocks = useDirectChildBlocks(editor, block.id);
  const selected = useSelectedTab(block.id);
  const select = useSelectTab(block.id);
  const actionStore = useOptionalFirstDraftTabsActionUiStore();
  const actionSnapshot = useOptionalFirstDraftTabsActionUiSnapshot();
  const headerRef = useRef<HTMLDivElement | null>(null);
  const active =
    blocks.find((candidate) => candidate.id === selected) ?? blocks[0] ?? null;
  useLayoutEffect(() => {
    const header = headerRef.current;
    if (!actionStore || !header) return;
    return actionStore.registerTabsRoot(block.id, header);
  }, [actionStore, block.id]);
  const focusPane = useCallback((paneId: BlockId) => {
    const root = headerRef.current;
    for (const candidate of root?.querySelectorAll<HTMLElement>(
      "[data-tab-pane-id]",
    ) ?? []) {
      if (candidate.dataset.tabPaneId === paneId) {
        candidate.focus({ preventScroll: true });
        break;
      }
    }
  }, []);
  const activateAt = useCallback(
    (index: number) => {
      const pane = blocks[index];
      if (!pane) return;
      select(pane.id);
      focusPane(pane.id);
    },
    [blocks, focusPane, select],
  );
  return (
        <div
          ref={headerRef}
          className="tabs-block__header"
          tabIndex={-1}
          data-editor-ui="true"
          data-editor-preserve-selection="true"
        >
          <div className="tabs-block__tablist" role="tablist" aria-label="Tabs">
            {blocks.map((pane, index) => {
              const title =
                typeof pane.metadata?.title === "string" && pane.metadata.title
                  ? pane.metadata.title
                  : `Tab ${index + 1}`;
              const renaming =
                actionSnapshot.kind === "rename" &&
                actionSnapshot.tabsId === block.id &&
                actionSnapshot.paneId === pane.id;
              return (
                <div className="tabs-block__tab-slot" key={pane.id}>
                  {renaming && actionStore ? (
                    <TabsRenameInput
                      editor={editor}
                      session={actionSnapshot}
                      store={actionStore}
                      restoreFocus={() => focusPane(pane.id)}
                    />
                  ) : (
                    <button
                      type="button"
                      className="tabs-block__tab"
                      role="tab"
                      aria-selected={pane.id === active?.id}
                      tabIndex={pane.id === active?.id ? 0 : -1}
                      data-editor-ui="true"
                      data-editor-preserve-selection="true"
                      data-tab-pane-id={pane.id}
                      onPointerDown={(event) => event.stopPropagation()}
                      onMouseDown={(event) => event.stopPropagation()}
                      onClick={(event) => {
                        event.stopPropagation();
                        select(pane.id);
                      }}
                      onContextMenu={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        select(pane.id);
                        actionStore?.openMenu({
                          kind: "open",
                          tabsId: block.id,
                          paneId: pane.id,
                          triggerElement: event.currentTarget,
                        });
                      }}
                      onKeyDown={(event) => {
                        if (
                          event.key === "ContextMenu" ||
                          (event.shiftKey && event.key === "F10")
                        ) {
                          event.preventDefault();
                          event.stopPropagation();
                          select(pane.id);
                          actionStore?.openMenu({
                            kind: "open",
                            tabsId: block.id,
                            paneId: pane.id,
                            triggerElement: event.currentTarget,
                          });
                          return;
                        }
                        let next: number | null = null;
                        if (event.key === "ArrowLeft") {
                          next = (index - 1 + blocks.length) % blocks.length;
                        } else if (event.key === "ArrowRight") {
                          next = (index + 1) % blocks.length;
                        } else if (event.key === "Home") next = 0;
                        else if (event.key === "End") next = blocks.length - 1;
                        if (next === null) return;
                        event.preventDefault();
                        event.stopPropagation();
                        activateAt(next);
                      }}
                    >
                      {title}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {editor.editable ? (
            <button
              type="button"
              className="tabs-block__add"
              aria-label="Add tab"
              data-editor-ui="true"
              data-editor-preserve-selection="true"
              onPointerDown={(event) => event.stopPropagation()}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                const result = addFirstDraftTab(editor, block.id);
                if (result.kind === "applied") select(result.paneId);
              }}
            >
              <Plus aria-hidden="true" />
            </button>
          ) : null}
        </div>
  );
}

function TabsRenameInput({
  editor,
  session,
  store,
  restoreFocus,
}: {
  readonly editor: FirstDraftEditor;
  readonly session: FirstDraftTabsRenameSession;
  readonly store: import("../../tabs-action-menu/index.ts").FirstDraftTabsActionUiStore;
  readonly restoreFocus: () => void;
}) {
  const [value, setValue] = useState(session.initialDisplayedTitle);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const settled = useRef(false);
  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, []);
  const settle = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    renameFirstDraftTab(editor, {
      tabsId: session.tabsId,
      paneId: session.paneId,
      initialCanonicalTitle: session.initialCanonicalTitle,
      initialDisplayedTitle: session.initialDisplayedTitle,
      nextTitle: value,
    });
    store.finishRename();
  }, [editor, session, store, value]);
  const cancel = useCallback(() => {
    if (settled.current) return;
    settled.current = true;
    store.cancelRename();
    queueMicrotask(restoreFocus);
  }, [restoreFocus, store]);
  const onKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLInputElement>) => {
      if (event.nativeEvent.isComposing) return;
      if (event.key === "Enter") {
        event.preventDefault();
        inputRef.current?.blur();
      } else if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        cancel();
      }
    },
    [cancel],
  );
  return (
    <input
      ref={inputRef}
      type="text"
      className="tabs-block__rename"
      aria-label={`Rename ${session.initialDisplayedTitle} tab`}
      value={value}
      size={Math.max(1, value.length)}
      data-editor-ui="true"
      data-editor-preserve-selection="true"
      data-tab-pane-id={session.paneId}
      onChange={(event) => setValue(event.currentTarget.value)}
      onBlur={settle}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    />
  );
}

export function TabPaneRenderer(props: Props) {
  const childStartTargetRef = useChildStartTargetRef(props.block.id);
  const hasChildTarget = shouldRenderChildStartTarget(props.editor, props.block.id);
  const paneRef = useRef<HTMLDivElement | null>(null);
  const viewState = useFirstDraftViewStateStore();
  const directPaneIds = props.block.parentId
    ? props.editor.getChildBlockIds(props.block.parentId)
    : [];
  const initiallyActive = props.block.parentId !== null &&
    resolveEffectiveFirstDraftTabPaneId(
      viewState,
      props.block.parentId,
      directPaneIds,
    ) === props.block.id;
  return <>
    {hasChildTarget ? <div ref={childStartTargetRef} className="first-draft-block-drop-target" data-first-draft-block-drop-target-active="false" data-editor-ui="true" aria-hidden="true" /> : null}
    <div ref={paneRef} className="tabs-block__pane" hidden={!initiallyActive}>
      <TabPaneVisibilityController
        block={props.block}
        editor={props.editor}
        paneRef={paneRef}
      />
      <div className="tabs-block__pane-contents">
        {props.children}
        <EmptyWrapperAddTextControl
          editor={props.editor}
          wrapperId={props.block.id}
        />
      </div>
    </div>
  </>;
}

function TabPaneVisibilityController({
  block,
  editor,
  paneRef,
}: Pick<Props, "block" | "editor"> & {
  readonly paneRef: RefObject<HTMLDivElement | null>;
}) {
  const tabsId = block.parentId!;
  const selected = useSelectedTab(tabsId);
  const panes = useDirectChildBlocks(editor, tabsId);
  const activePaneId =
    panes.find((candidate) => candidate.id === selected)?.id ??
    panes[0]?.id ??
    null;
  const active = block.id === activePaneId;
  useLayoutEffect(() => {
    if (paneRef.current) paneRef.current.hidden = !active;
  }, [active, paneRef]);
  return (
    <FirstDraftBlockChrome
      blockId={block.id}
      editor={editor}
      blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.tabPane}
      visible={active}
    />
  );
}

function useAfterBlockTargetRef(blockId: BlockId) {
  return useFirstDraftBlockDropTargetRef({ kind: "after-block", blockId });
}

function useChildStartTargetRef(wrapperId: BlockId) {
  return useFirstDraftBlockDropTargetRef({ kind: "wrapper-child-start", wrapperId });
}

function shouldRenderAfterBlockTarget(
  editor: Props["editor"],
  blockId: BlockId,
): boolean {
  return isFirstDraftBlockDropAnchorEligible(editor, {
    kind: "after-block",
    blockId,
  });
}

function shouldRenderChildStartTarget(
  editor: Props["editor"],
  wrapperId: BlockId,
): boolean {
  return isFirstDraftBlockDropAnchorEligible(editor, {
    kind: "wrapper-child-start",
    wrapperId,
  });
}
