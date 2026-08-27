"use client";

import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  DragProvider,
  pointerToRectDistance,
  useRecomputeActiveDrag,
  useRemeasureDropTargets,
  type DragEndEvent,
  type DragOverlayInput,
  type DragPoint,
  type DragStartEvent,
  type DragUpdateEvent,
  type DropEvent,
} from "@mk-drag-and-drop/react";
import type {
  FirstDraftTableColumnMoveResult,
  FirstDraftTableColumnMutationTarget,
  FirstDraftTableRowMoveResult,
} from "../blocks/table/mutations.ts";
import {
  FirstDraftTableDragOverlay,
  FirstDraftTableDragStoreProvider,
  TABLE_COLUMN_DND_GROUP,
  TABLE_ROW_DND_GROUP,
  createFirstDraftTableDragStore,
  type FirstDraftTableDragSnapshot,
  type FirstDraftTableDragStore,
} from "../table-drag-and-drop/index.ts";
import {
  EDITOR_BLOCK_DND_GROUP,
  FirstDraftRootDropTargetRefContext,
  useFirstDraftBlockDropTargetRef,
  type FirstDraftBlockPlacementRegistry,
} from "./stable-anchors.tsx";
import {
  createFirstDraftActiveDropTargetStore,
  FirstDraftActiveDropTargetStoreProvider,
} from "./active-drop-target-store.tsx";
import { FirstDraftDocumentBlockDragPreview } from "./document-drag-overlay.tsx";
import type { FirstDraftDocumentBlockDragSession } from "./document-drag-overlay-contracts.ts";

export type FirstDraftActiveDragGroup =
  | typeof EDITOR_BLOCK_DND_GROUP
  | typeof TABLE_ROW_DND_GROUP
  | typeof TABLE_COLUMN_DND_GROUP
  | null;

const FirstDraftActiveDragGroupContext =
  createContext<FirstDraftActiveDragGroup>(null);

export function useFirstDraftActiveDragGroup(): FirstDraftActiveDragGroup {
  return useContext(FirstDraftActiveDragGroupContext);
}

export interface FirstDraftBlockDragAndDropBridge {
  readonly placementRegistry: FirstDraftBlockPlacementRegistry;
  readonly captureDocumentBlockDragSession: (
    blockId: BlockId,
  ) => FirstDraftDocumentBlockDragSession;
  readonly moveDocumentBlock: (
    expectedSource: Extract<
      FirstDraftDocumentBlockDragSession,
      { readonly captureSucceeded: true }
    >["sourcePlacement"],
    position: NonNullable<ReturnType<FirstDraftBlockPlacementRegistry["get"]>>,
  ) => unknown;
  readonly moveTableRow?: (
    tableId: BlockId,
    rowId: BlockId,
    finalRowIds: readonly BlockId[],
  ) => FirstDraftTableRowMoveResult;
  readonly moveTableColumn?: (
    tableId: BlockId,
    source: FirstDraftTableColumnMutationTarget,
    finalTargets: readonly FirstDraftTableColumnMutationTarget[],
  ) => FirstDraftTableColumnMoveResult;
  readonly closeTableActionMenu?: () => void;
  readonly closeBlockActionMenuForDocumentDrag?: (blockId: BlockId) => void;
  readonly startDocumentBlockAutoScroll: (
    group: string,
    point: DragPoint,
  ) => void;
  readonly updateDocumentBlockAutoScrollPoint: (
    group: string,
    point: DragPoint,
  ) => void;
  readonly stopDocumentBlockAutoScroll: (group: string) => void;
  readonly startTableDragAutoScroll: (
    group: string,
    tableId: BlockId,
    tableScrollElement: HTMLElement,
    point: DragPoint,
  ) => boolean;
  readonly updateTableDragAutoScrollPoint: (
    group: string,
    tableId: BlockId,
    point: DragPoint,
  ) => void;
  readonly stopTableDragAutoScroll: (
    group: string,
    tableId: BlockId,
  ) => void;
  readonly registerAutoScrollSynchronization: (
    synchronize: ((event: FirstDraftAutoScrollSynchronizationEvent) => void) | null,
  ) => void;
}

export type FirstDraftAutoScrollSynchronizationEvent =
  | { readonly kind: "scroll"; readonly group: string }
  | { readonly kind: "stopped"; readonly group: string };

export function FirstDraftBlockDragAndDropProvider({
  bridge,
  tableDragStore: suppliedTableDragStore,
  children,
}: {
  readonly bridge?: FirstDraftBlockDragAndDropBridge;
  readonly tableDragStore?: FirstDraftTableDragStore;
  readonly children: ReactNode;
}) {
  const [activeDropTargetStore] = useState(
    createFirstDraftActiveDropTargetStore,
  );
  const [ownedTableDragStore] = useState(createFirstDraftTableDragStore);
  const [activeDragGroup, setActiveDragGroup] =
    useState<FirstDraftActiveDragGroup>(null);
  const tableDragStore = suppliedTableDragStore ?? ownedTableDragStore;
  const geometrySynchronization = useRef<DragGeometrySynchronization | null>(
    null,
  );
  const documentDragSession = useRef<FirstDraftDocumentBlockDragSession | null>(
    null,
  );

  useLayoutEffect(
    () => () => {
      if (documentDragSession.current?.captureSucceeded) {
        bridge?.stopDocumentBlockAutoScroll(EDITOR_BLOCK_DND_GROUP);
      }
      geometrySynchronization.current?.end(EDITOR_BLOCK_DND_GROUP);
      activeDropTargetStore.setActiveDropTargetId(null);
      documentDragSession.current = null;
    },
    [activeDropTargetStore, bridge],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      if (!isFirstDraftDragGroup(event.group)) return;
      bridge?.closeTableActionMenu?.();
      switch (event.group) {
        case EDITOR_BLOCK_DND_GROUP:
          bridge?.closeBlockActionMenuForDocumentDrag?.(
            event.draggableId as BlockId,
          );
          documentDragSession.current =
            bridge?.captureDocumentBlockDragSession(
              event.draggableId as BlockId,
            ) ?? invalidDocumentDragSession(event.draggableId as BlockId);
          activeDropTargetStore.setActiveDropTargetId(null);
          if (!documentDragSession.current.captureSucceeded) return;
          setActiveDragGroup(event.group);
          geometrySynchronization.current?.begin({ group: event.group });
          bridge?.startDocumentBlockAutoScroll(
            event.group,
            event.pointerPosition,
          );
          return;
        case TABLE_ROW_DND_GROUP:
          documentDragSession.current = null;
          setActiveDragGroup(event.group);
          activeDropTargetStore.setActiveDropTargetId(null);
          if (
            !tableDragStore.beginRowDrag(
              event.draggableId as BlockId,
              event.sourceRect,
            )
          )
            return;
          {
            const session = tableDragStore.getSnapshot().session;
            const tableScrollElement =
              session?.axis === "row"
                ? tableDragStore.getTableScrollElement(session.tableId)
                : null;
            if (
              session?.axis !== "row" ||
              !tableScrollElement ||
              (bridge &&
                !bridge.startTableDragAutoScroll(
                  event.group,
                  session.tableId,
                  tableScrollElement,
                  event.pointerPosition,
                ))
            ) {
              if (session?.axis === "row") {
                tableDragStore.invalidateActiveDrag(session.tableId);
              }
              return;
            }
            geometrySynchronization.current?.begin({
              group: event.group,
              tableId: session.tableId,
              tableScrollElement,
            });
          }
          return;
        case TABLE_COLUMN_DND_GROUP:
          documentDragSession.current = null;
          setActiveDragGroup(event.group);
          activeDropTargetStore.setActiveDropTargetId(null);
          if (
            !tableDragStore.beginColumnDrag(
              event.draggableId,
              event.sourceRect,
            )
          ) {
            return;
          }
          {
            const session = tableDragStore.getSnapshot().session;
            const tableScrollElement =
              session?.axis === "column"
                ? tableDragStore.getTableScrollElement(session.tableId)
                : null;
            if (
              session?.axis !== "column" ||
              !tableScrollElement ||
              (bridge &&
                !bridge.startTableDragAutoScroll(
                  event.group,
                  session.tableId,
                  tableScrollElement,
                  event.pointerPosition,
                ))
            ) {
              if (session?.axis === "column") {
                tableDragStore.invalidateActiveDrag(session.tableId);
              }
              return;
            }
            geometrySynchronization.current?.begin({
              group: event.group,
              tableId: session.tableId,
              tableScrollElement,
            });
          }
          return;
      }
    },
    [activeDropTargetStore, bridge, tableDragStore],
  );

  const handleDragUpdate = useCallback(
    (event: DragUpdateEvent) => {
      switch (event.group) {
        case EDITOR_BLOCK_DND_GROUP:
          if (
            documentDragSession.current?.blockId !== event.draggableId ||
            !documentDragSession.current.captureSucceeded
          ) {
            activeDropTargetStore.setActiveDropTargetId(null);
            return;
          }
          activeDropTargetStore.setActiveDropTargetId(
            event.activeDropTargetId,
          );
          bridge?.updateDocumentBlockAutoScrollPoint(
            event.group,
            event.pointerPosition,
          );
          return;
        case TABLE_ROW_DND_GROUP:
          {
            const session = tableDragStore.getSnapshot().session;
            if (session?.axis === "row") {
              bridge?.updateTableDragAutoScrollPoint(
                event.group,
                session.tableId,
                event.pointerPosition,
              );
            }
          }
          tableDragStore.updateRowPreview(event.sortablePreview);
          return;
        case TABLE_COLUMN_DND_GROUP:
          {
            const session = tableDragStore.getSnapshot().session;
            if (session?.axis === "column") {
              bridge?.updateTableDragAutoScrollPoint(
                event.group,
                session.tableId,
                event.pointerPosition,
              );
            }
          }
          tableDragStore.updateColumnPreview(event.sortablePreview);
          return;
      }
    },
    [activeDropTargetStore, bridge, tableDragStore],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (
        isFirstDraftDragGroup(event.group) &&
        event.result !== "dropped"
      ) {
        setActiveDragGroup((current) =>
          current === event.group ? null : current,
        );
      }
      geometrySynchronization.current?.end(event.group);
      switch (event.group) {
        case EDITOR_BLOCK_DND_GROUP:
          if (documentDragSession.current?.captureSucceeded) {
            bridge?.stopDocumentBlockAutoScroll(event.group);
          }
          activeDropTargetStore.setActiveDropTargetId(null);
          if (event.result !== "dropped") documentDragSession.current = null;
          return;
        case TABLE_ROW_DND_GROUP:
          {
            const session = tableDragStore.getSnapshot().session;
            if (session?.axis === "row") {
              bridge?.stopTableDragAutoScroll(event.group, session.tableId);
            }
          }
          tableDragStore.endRowDrag(event.result);
          return;
        case TABLE_COLUMN_DND_GROUP:
          {
            const session = tableDragStore.getSnapshot().session;
            if (session?.axis === "column") {
              bridge?.stopTableDragAutoScroll(event.group, session.tableId);
            }
          }
          tableDragStore.endColumnDrag(event.result);
          return;
      }
    },
    [activeDropTargetStore, bridge, tableDragStore],
  );

  const handleDrop = useCallback(
    (event: DropEvent) => {
      if (!isFirstDraftDragGroup(event.group)) return;
      try {
        if (event.group === EDITOR_BLOCK_DND_GROUP) {
          const session = documentDragSession.current;
          if (
            !bridge ||
            !session?.captureSucceeded ||
            session.blockId !== event.draggableId
          ) {
            return;
          }
          const position = bridge.placementRegistry.get(event.dropTargetId);
          if (!position) return;
          bridge.moveDocumentBlock(session.sourcePlacement, position);
          return;
        }
        if (event.group === TABLE_COLUMN_DND_GROUP) {
          const resolution = tableDragStore.resolveColumnDrop(
            event.draggableId,
            event.sortablePlacement,
          );
          if (resolution.kind !== "move") return;
          if (!bridge?.moveTableColumn) {
            tableDragStore.clearColumnDrag();
            return;
          }
          const result = bridge.moveTableColumn(
            resolution.tableId,
            resolution.sourceTarget,
            resolution.finalTargets,
          );
          if (result.kind !== "moved") {
            tableDragStore.clearColumnDrag();
            return;
          }
          tableDragStore.completeColumnCommit({
            columnIds: result.expectedColumnIds,
            cellIdsByRow: result.expectedCellIdsByRow,
          });
          if (tableDragStore.getSnapshot().session) {
            tableDragStore.clearColumnDrag();
          }
          return;
        }
        const session = tableDragStore.getSnapshot().session;
        const resolution = tableDragStore.resolveRowDrop(
          event.draggableId as BlockId,
          event.sortablePlacement,
        );
        if (resolution.kind !== "move") return;
        if (session?.axis !== "row" || !bridge?.moveTableRow) {
          tableDragStore.clearRowDrag();
          return;
        }
        const result = bridge.moveTableRow(
          session.tableId,
          session.sourceRowId,
          resolution.finalRowIds,
        );
        if (result.kind !== "moved") {
          tableDragStore.clearRowDrag();
          return;
        }
        tableDragStore.reconcileActiveTable();
        if (tableDragStore.getSnapshot().session) {
          tableDragStore.clearRowDrag();
        }
      } catch (error) {
        if (event.group === TABLE_COLUMN_DND_GROUP) {
          tableDragStore.clearColumnDrag();
        } else if (event.group === TABLE_ROW_DND_GROUP) {
          tableDragStore.clearRowDrag();
        } else {
          throw error;
        }
      } finally {
        if (event.group === EDITOR_BLOCK_DND_GROUP) {
          documentDragSession.current = null;
        }
        setActiveDragGroup((current) =>
          current === event.group ? null : current,
        );
      }
    },
    [bridge, tableDragStore],
  );

  return (
    <DragProvider
      targetingAlgorithm={pointerToRectDistance}
      pointerConfiguration={{
        activationDelay: 180,
        activationDistance: 6,
      }}
      dragOverlay={(input) => {
        switch (input.dragState.group) {
          case EDITOR_BLOCK_DND_GROUP:
            return renderFirstDraftDocumentBlockDragOverlay(
              input,
              documentDragSession.current,
            );
          case TABLE_ROW_DND_GROUP:
          case TABLE_COLUMN_DND_GROUP:
            return (
              <FirstDraftTableDragOverlay
                dragState={input.dragState}
                store={tableDragStore}
              />
            );
          default:
            return null;
        }
      }}
      onDragStart={handleDragStart}
      onDragUpdate={handleDragUpdate}
      onDragEnd={handleDragEnd}
      onDrop={handleDrop}
    >
      <FirstDraftActiveDragGroupContext.Provider value={activeDragGroup}>
        <FirstDraftTableDragStoreProvider store={tableDragStore}>
          <FirstDraftActiveDropTargetStoreProvider
            store={activeDropTargetStore}
          >
            <FirstDraftDragGeometrySynchronization
              store={tableDragStore}
              registerAutoScrollSynchronization={
                bridge?.registerAutoScrollSynchronization
              }
              stopInvalidTableSession={(group, tableId) =>
                bridge?.stopTableDragAutoScroll(group, tableId)
              }
              register={(value) => {
                geometrySynchronization.current = value;
              }}
            />
            <FirstDraftRootDropTargetRegistration>
              {children}
            </FirstDraftRootDropTargetRegistration>
          </FirstDraftActiveDropTargetStoreProvider>
        </FirstDraftTableDragStoreProvider>
      </FirstDraftActiveDragGroupContext.Provider>
    </DragProvider>
  );
}

export function renderFirstDraftDocumentBlockDragOverlay(
  input: DragOverlayInput,
  session: FirstDraftDocumentBlockDragSession | null,
): ReactNode {
  const { dragState } = input;
  if (
    !session?.captureSucceeded ||
    session.blockId !== dragState.draggableId
  ) {
    return (
      <div
        className="first-draft-document-block-drag-overlay"
        aria-hidden="true"
        inert
        style={{
          width: dragState.sourceRect.width,
          minHeight: dragState.sourceRect.height,
        }}
      />
    );
  }
  const offsetX = session.sourceRect.left - dragState.sourceRect.left;
  const offsetY = session.sourceRect.top - dragState.sourceRect.top;
  return (
    <FirstDraftDocumentBlockDragPreview
      snapshot={session.preview}
      style={{
        width: session.sourceRect.width,
        minHeight: session.sourceRect.height,
        transform: `translate3d(${offsetX}px, ${offsetY}px, 0)`,
      }}
    />
  );
}

function invalidDocumentDragSession(
  blockId: BlockId,
): FirstDraftDocumentBlockDragSession {
  return Object.freeze({ blockId, captureSucceeded: false });
}

function FirstDraftRootDropTargetRegistration({
  children,
}: {
  readonly children: ReactNode;
}) {
  const rootTargetRef = useFirstDraftBlockDropTargetRef({ kind: "root-start" });
  return (
    <FirstDraftRootDropTargetRefContext.Provider value={rootTargetRef}>
      {children}
    </FirstDraftRootDropTargetRefContext.Provider>
  );
}

function isFirstDraftDragGroup(
  group: string,
): group is Exclude<FirstDraftActiveDragGroup, null> {
  return (
    group === EDITOR_BLOCK_DND_GROUP ||
    group === TABLE_ROW_DND_GROUP ||
    group === TABLE_COLUMN_DND_GROUP
  );
}

interface ActiveDragGeometrySynchronization {
  readonly generation: number;
  readonly group: string;
  readonly tableId?: BlockId;
  readonly tableScrollElement?: HTMLElement;
}

interface DragGeometrySynchronization {
  begin(
    input: Omit<ActiveDragGeometrySynchronization, "generation">,
  ): void;
  scheduleScroll(group: string): void;
  end(group: string): void;
}

function FirstDraftDragGeometrySynchronization({
  store,
  registerAutoScrollSynchronization,
  stopInvalidTableSession,
  register,
}: {
  readonly store: FirstDraftTableDragStore;
  readonly registerAutoScrollSynchronization?: FirstDraftBlockDragAndDropBridge["registerAutoScrollSynchronization"];
  readonly stopInvalidTableSession: (
    group: string,
    tableId: BlockId,
  ) => void;
  readonly register: (value: DragGeometrySynchronization | null) => void;
}) {
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );
  const remeasureDropTargets = useRemeasureDropTargets();
  const recomputeActiveDrag = useRecomputeActiveDrag();
  const active = useRef<ActiveDragGeometrySynchronization | null>(null);
  const nextGeneration = useRef(0);
  const frame = useRef<{ readonly id: number; readonly view: Window } | null>(
    null,
  );
  const dirtyGeometry = useRef(false);
  const pendingProjectionKey = useRef<string | null>(null);
  const lastSynchronizedProjectionKey = useRef<string | null>(null);
  const observedProjectionRevision = useRef(snapshot.projectionRevision);
  const observedGeometryRevision = useRef(snapshot.geometryRevision);

  const cancelFrame = useCallback(() => {
    if (frame.current) {
      frame.current.view.cancelAnimationFrame(frame.current.id);
      frame.current = null;
    }
    dirtyGeometry.current = false;
    pendingProjectionKey.current = null;
  }, []);

  const isLive = useCallback(
    (candidate: ActiveDragGeometrySynchronization): boolean => {
      if (active.current?.generation !== candidate.generation) return false;
      if (candidate.group === EDITOR_BLOCK_DND_GROUP) return true;
      const session = store.getSnapshot().session;
      const expectedGroup =
        session?.axis === "row"
          ? TABLE_ROW_DND_GROUP
          : session?.axis === "column"
            ? TABLE_COLUMN_DND_GROUP
            : null;
      return (
        session?.status === "dragging" &&
        session.valid &&
        expectedGroup === candidate.group &&
        session.tableId === candidate.tableId &&
        candidate.tableScrollElement?.isConnected === true &&
        store.getTableScrollElement(session.tableId) ===
          candidate.tableScrollElement
      );
    },
    [store],
  );

  const schedule = useCallback(
    (group: string, reason: "projection" | "scroll" | "geometry") => {
      const candidate = active.current;
      if (!candidate || candidate.group !== group || !isLive(candidate)) return;
      if (reason === "projection") {
        const key = projectionLayoutKey(store.getSnapshot());
        if (
          key === lastSynchronizedProjectionKey.current ||
          key === pendingProjectionKey.current
        ) {
          return;
        }
        pendingProjectionKey.current = key;
      } else {
        dirtyGeometry.current = true;
      }
      if (frame.current) return;
      const view =
        candidate.tableScrollElement?.ownerDocument.defaultView ?? window;
      const generation = candidate.generation;
      const id = view.requestAnimationFrame(() => {
        frame.current = null;
        const current = active.current;
        if (
          !current ||
          current.generation !== generation ||
          current.group !== group ||
          !isLive(current)
        ) {
          dirtyGeometry.current = false;
          pendingProjectionKey.current = null;
          return;
        }
        const synchronizedProjectionKey = pendingProjectionKey.current;
        dirtyGeometry.current = false;
        pendingProjectionKey.current = null;
        remeasureDropTargets({ group });
        recomputeActiveDrag();
        if (active.current?.generation === generation) {
          lastSynchronizedProjectionKey.current =
            synchronizedProjectionKey ??
            projectionLayoutKey(store.getSnapshot());
        }
      });
      frame.current = { id, view };
    },
    [isLive, recomputeActiveDrag, remeasureDropTargets, store],
  );

  const api = useMemo<DragGeometrySynchronization>(
    () => ({
      begin(input) {
        cancelFrame();
        const generation = ++nextGeneration.current;
        active.current = { ...input, generation };
        if (input.group === EDITOR_BLOCK_DND_GROUP) {
          lastSynchronizedProjectionKey.current = null;
          return;
        }
        lastSynchronizedProjectionKey.current = projectionLayoutKey(
          store.getSnapshot(),
        );
        const current = store.getSnapshot();
        observedProjectionRevision.current = current.projectionRevision;
        observedGeometryRevision.current = current.geometryRevision;
      },
      scheduleScroll(group) {
        schedule(group, "scroll");
      },
      end(group) {
        if (active.current?.group !== group) return;
        cancelFrame();
        active.current = null;
        lastSynchronizedProjectionKey.current = null;
        nextGeneration.current += 1;
      },
    }),
    [cancelFrame, schedule, store],
  );

  useLayoutEffect(() => {
    register(api);
    return () => register(null);
  }, [api, register]);

  useLayoutEffect(() => {
    if (!registerAutoScrollSynchronization) return;
    registerAutoScrollSynchronization((event) => {
      if (event.kind === "scroll") api.scheduleScroll(event.group);
      else api.end(event.group);
    });
    return () => registerAutoScrollSynchronization(null);
  }, [api, registerAutoScrollSynchronization]);

  useLayoutEffect(() => {
    const candidate = active.current;
    if (!candidate) {
      observedProjectionRevision.current = snapshot.projectionRevision;
      observedGeometryRevision.current = snapshot.geometryRevision;
      return;
    }
    if (!isLive(candidate)) {
      if (candidate.tableId) {
        stopInvalidTableSession(candidate.group, candidate.tableId);
      }
      api.end(candidate.group);
      return;
    }
    if (
      observedProjectionRevision.current !== snapshot.projectionRevision
    ) {
      observedProjectionRevision.current = snapshot.projectionRevision;
      schedule(candidate.group, "projection");
    }
    if (observedGeometryRevision.current !== snapshot.geometryRevision) {
      observedGeometryRevision.current = snapshot.geometryRevision;
      schedule(candidate.group, "geometry");
    }
  }, [api, isLive, schedule, snapshot, stopInvalidTableSession]);

  useLayoutEffect(() => () => {
    cancelFrame();
    active.current = null;
    registerAutoScrollSynchronization?.(null);
  }, [cancelFrame, registerAutoScrollSynchronization]);
  return null;
}

function projectionLayoutKey(snapshot: FirstDraftTableDragSnapshot): string {
  const session = snapshot.session;
  if (!session) return "inactive";
  return session.axis === "row"
    ? `row:${session.tableId}:${session.projectedRowIds.join("\u0000")}`
    : `column:${session.tableId}:${session.projectedItems
        .map((item) => item.dragId)
        .join("\u0000")}`;
}
