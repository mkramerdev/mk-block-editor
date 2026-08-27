"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditableEditor } from "@repo/editor-web/editor";

export interface TableActionControlRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type TableActionControlLayout = TableActionControlRect;

export interface TableRowCarrierLaneLayout {
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

export interface TableRowCarrierLayout {
  readonly width: number;
  readonly height: number;
}

export interface TableColumnCarrierLaneLayout {
  readonly left: number;
  readonly top: number;
  readonly height: number;
}

export interface TableColumnCarrierLayout {
  readonly width: number;
  readonly height: number;
}

interface TableActionGeometryElements {
  readonly object: HTMLElement | null;
  readonly scroll: HTMLElement | null;
  readonly grid: HTMLElement | null;
  readonly rows: ReadonlyMap<BlockId, HTMLElement>;
}

export interface FirstDraftTableGeometryRegistry {
  getRevision(): number;
  getElements(): TableActionGeometryElements;
  subscribe(listener: () => void): () => void;
  registerObject(element: HTMLElement): () => void;
  registerScroll(element: HTMLElement): () => void;
  registerGrid(element: HTMLElement): () => void;
  registerRow(rowId: BlockId, element: HTMLElement): () => void;
}

type ElementKey = "object" | "scroll" | "grid";

export function createFirstDraftTableGeometryRegistry(): FirstDraftTableGeometryRegistry {
  const elements: Record<ElementKey, HTMLElement | null> = {
    object: null,
    scroll: null,
    grid: null,
  };
  const tokens = new Map<ElementKey, symbol>();
  const rows = new Map<BlockId, HTMLElement>();
  const rowTokens = new Map<BlockId, symbol>();
  const listeners = new Set<() => void>();
  let revision = 0;
  const publish = (): void => {
    revision += 1;
    for (const listener of [...listeners]) listener();
  };
  const registerElement = (key: ElementKey, element: HTMLElement) => {
    const token = Symbol(key);
    elements[key] = element;
    tokens.set(key, token);
    publish();
    return () => {
      if (tokens.get(key) !== token) return;
      tokens.delete(key);
      elements[key] = null;
      publish();
    };
  };
  const registry: FirstDraftTableGeometryRegistry = {
    getRevision: () => revision,
    getElements: () => ({ ...elements, rows }),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    registerObject: (element) => registerElement("object", element),
    registerScroll: (element) => registerElement("scroll", element),
    registerGrid: (element) => registerElement("grid", element),
    registerRow(rowId, element) {
      const token = Symbol("row");
      rows.set(rowId, element);
      rowTokens.set(rowId, token);
      publish();
      return () => {
        if (rowTokens.get(rowId) !== token) return;
        rowTokens.delete(rowId);
        rows.delete(rowId);
        publish();
      };
    },
  };
  return Object.freeze(registry);
}

const Context = createContext<FirstDraftTableGeometryRegistry | null>(null);

export function FirstDraftTableGeometryProvider({
  registry,
  children,
}: {
  readonly registry: FirstDraftTableGeometryRegistry;
  readonly children: ReactNode;
}) {
  return <Context.Provider value={registry}>{children}</Context.Provider>;
}

export function useFirstDraftTableRowGeometryRef(rowId: BlockId) {
  const registry = useContext(Context);
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return useCallback(
    (element: HTMLDivElement | null) => {
      cleanup.current?.();
      cleanup.current =
        element && registry ? registry.registerRow(rowId, element) : null;
    },
    [registry, rowId],
  );
}

export function useFirstDraftTableGeometryElementRef(
  registry: FirstDraftTableGeometryRegistry,
  kind: ElementKey,
  additionalRegistration?: (element: HTMLElement) => () => void,
) {
  const cleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanup.current?.(), []);
  return useCallback(
    (element: HTMLElement | null) => {
      cleanup.current?.();
      cleanup.current = null;
      if (!element) return;
      const unregisterGeometry =
        kind === "object"
          ? registry.registerObject(element)
          : kind === "scroll"
            ? registry.registerScroll(element)
            : registry.registerGrid(element);
      const unregisterAdditional = additionalRegistration?.(element);
      cleanup.current = () => {
        unregisterAdditional?.();
        unregisterGeometry();
      };
    },
    [additionalRegistration, kind, registry],
  );
}

export interface TableActionControlLayouts {
  readonly rowLane: TableRowCarrierLaneLayout | null;
  readonly columnLane: TableColumnCarrierLaneLayout | null;
  readonly rows: ReadonlyMap<BlockId, TableRowCarrierLayout>;
  readonly columns: ReadonlyMap<string, TableColumnCarrierLayout>;
  readonly rowTriggers: ReadonlyMap<BlockId, TableActionControlLayout>;
  readonly columnTriggers: ReadonlyMap<string, TableActionControlLayout>;
}

// Matches the 1rem trigger thickness plus the 0.25rem table-facing gap.
// Keeping the zone to this cross-axis size makes its outer edge coincide with
// the button instead of adding an invisible hover band behind it.
const actionControlCrossSize = 20;

const emptyLayouts: TableActionControlLayouts = Object.freeze({
  rowLane: null,
  columnLane: null,
  rows: new Map(),
  columns: new Map(),
  rowTriggers: new Map(),
  columnTriggers: new Map(),
});

export function useFirstDraftTableActionControlLayouts(
  registry: FirstDraftTableGeometryRegistry,
  geometry: EditableEditor["geometry"],
  columnIds: readonly string[],
  columnWidths: readonly number[],
): TableActionControlLayouts {
  const [layouts, setLayouts] = useState(emptyLayouts);
  const frame = useRef<number | null>(null);
  const measureRef = useRef<() => void>(() => undefined);
  const registryRevision = useSyncExternalStore(
    registry.subscribe,
    registry.getRevision,
    readZero,
  );
  const geometryRevision = useSyncExternalStore(
    geometry.subscribe,
    geometry.getRevision,
    readZero,
  );
  const widthsKey = columnWidths.join(",");

  const measure = useCallback(() => {
    frame.current = null;
    setLayouts(readTableActionControlLayouts(registry, columnIds, columnWidths));
  }, [columnIds, columnWidths, registry]);

  useLayoutEffect(() => {
    measureRef.current = measure;
  }, [measure]);

  const schedule = useCallback(() => {
    if (frame.current !== null) return;
    const view = registry.getElements().object?.ownerDocument.defaultView;
    if (typeof view?.requestAnimationFrame === "function") {
      frame.current = view.requestAnimationFrame(() => measureRef.current());
    } else {
      frame.current = -1;
      queueMicrotask(() => {
        if (frame.current === -1) measureRef.current();
      });
    }
  }, [registry]);

  useLayoutEffect(() => {
    void geometryRevision;
    void registryRevision;
    void widthsKey;
    schedule();
  }, [geometryRevision, registryRevision, schedule, widthsKey]);

  useEffect(() => {
    const { object, scroll, grid, rows } = registry.getElements();
    const ownerWindow = object?.ownerDocument.defaultView ?? window;
    const viewport = ownerWindow.visualViewport;
    const Observer = ownerWindow.ResizeObserver ?? globalThis.ResizeObserver;
    const observer =
      typeof Observer === "function" ? new Observer(schedule) : null;
    for (const element of [object, scroll, grid, ...rows.values()]) {
      if (element) observer?.observe(element);
    }
    scroll?.addEventListener("scroll", schedule, { passive: true });
    object?.ownerDocument.addEventListener("scroll", schedule, true);
    ownerWindow.addEventListener("resize", schedule);
    viewport?.addEventListener("resize", schedule);
    viewport?.addEventListener("scroll", schedule);
    return () => {
      observer?.disconnect();
      scroll?.removeEventListener("scroll", schedule);
      object?.ownerDocument.removeEventListener("scroll", schedule, true);
      ownerWindow.removeEventListener("resize", schedule);
      viewport?.removeEventListener("resize", schedule);
      viewport?.removeEventListener("scroll", schedule);
      if (frame.current !== null && frame.current >= 0)
        ownerWindow.cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [registry, registryRevision, schedule]);

  if (layouts !== emptyLayouts) return layouts;
  const initial = readTableActionControlLayouts(
    registry,
    columnIds,
    columnWidths,
  );
  return initial.rowLane || initial.columnLane ? initial : layouts;
}

function readTableActionControlLayouts(
  registry: FirstDraftTableGeometryRegistry,
  columnIds: readonly string[],
  columnWidths: readonly number[],
): TableActionControlLayouts {
  const { object, scroll, grid, rows } = registry.getElements();
  if (!object?.isConnected || !scroll?.isConnected || !grid?.isConnected) {
    return emptyLayouts;
  }
  const objectRect = toRect(object.getBoundingClientRect());
  const scrollRect = toRect(scroll.getBoundingClientRect());
  const gridRect = toRect(grid.getBoundingClientRect());
  if (!objectRect || !scrollRect || !gridRect) return emptyLayouts;
  const rowRects: Array<readonly [BlockId, TableActionControlRect]> = [];
  for (const [rowId, row] of rows) {
    if (!row.isConnected) continue;
    const rowRect = toRect(row.getBoundingClientRect());
    if (rowRect) rowRects.push([rowId, rowRect]);
  }
  const rowCarrierLayouts = tableRowCarrierLayouts(
    objectRect,
    scrollRect,
    gridRect,
    rowRects,
  );
  const columnCarrierLayouts = tableColumnCarrierLayouts(
    objectRect,
    scrollRect,
    gridRect,
    columnIds,
    columnWidths,
  );
  return {
    rowLane: rowCarrierLayouts.lane,
    columnLane: columnCarrierLayouts.lane,
    rows: rowCarrierLayouts.carriers,
    columns: columnCarrierLayouts.carriers,
    rowTriggers: rowCarrierLayouts.triggers,
    columnTriggers: columnCarrierLayouts.triggers,
  };
}

export function tableRowCarrierLaneLayout(
  object: TableActionControlRect,
  viewport: TableActionControlRect,
  grid: TableActionControlRect,
): TableRowCarrierLaneLayout | null {
  if (
    object.width <= 0 ||
    object.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0 ||
    grid.width <= 0 ||
    grid.height <= 0
  ) {
    return null;
  }
  return {
    left: grid.left - object.left,
    top: grid.top - object.top,
    width: grid.width,
  };
}

export function tableRowCarrierLayouts(
  object: TableActionControlRect,
  viewport: TableActionControlRect,
  grid: TableActionControlRect,
  rows: readonly (readonly [BlockId, TableActionControlRect])[],
): {
  readonly lane: TableRowCarrierLaneLayout | null;
  readonly carriers: ReadonlyMap<BlockId, TableRowCarrierLayout>;
  readonly triggers: ReadonlyMap<BlockId, TableActionControlLayout>;
} {
  const lane = tableRowCarrierLaneLayout(object, viewport, grid);
  const carriers = new Map<BlockId, TableRowCarrierLayout>();
  const triggers = new Map<BlockId, TableActionControlLayout>();
  if (!lane) return { lane, carriers, triggers };
  for (const [rowId, row] of rows) {
    if (row.width <= 0 || row.height <= 0) continue;
    carriers.set(rowId, {
      width: lane.width,
      height: row.height,
    });
    const trigger = tableRowActionControlLayout(object, viewport, grid, row);
    if (trigger) triggers.set(rowId, trigger);
  }
  return { lane, carriers, triggers };
}

export function tableRowActionControlLayout(
  object: TableActionControlRect,
  viewport: TableActionControlRect,
  grid: TableActionControlRect,
  row: TableActionControlRect,
): TableActionControlLayout | null {
  const visibleGridLeft = Math.max(grid.left, viewport.left);
  const visibleGridRight = Math.min(
    grid.left + grid.width,
    viewport.left + viewport.width,
  );
  if (visibleGridRight <= visibleGridLeft) return null;
  const availableGutter = Math.max(0, visibleGridLeft - object.left);
  if (availableGutter < actionControlCrossSize) return null;
  return {
    left: visibleGridLeft - object.left - actionControlCrossSize,
    top: row.top - object.top,
    width: actionControlCrossSize,
    height: row.height,
  };
}

export function tableColumnActionControlLayouts(
  object: TableActionControlRect,
  viewport: TableActionControlRect,
  grid: TableActionControlRect,
  columnIds: readonly string[],
  columnWidths: readonly number[],
): ReadonlyMap<string, TableActionControlLayout> {
  const result = new Map<string, TableActionControlLayout>();
  const visibleGridTop = Math.max(grid.top, viewport.top);
  const visibleGridBottom = Math.min(
    grid.top + grid.height,
    viewport.top + viewport.height,
  );
  if (visibleGridBottom <= visibleGridTop) return result;
  let columnLeft = grid.left;
  columnIds.forEach((columnId, index) => {
    const width = columnWidths[index] ?? 0;
    const visibleLeft = Math.max(columnLeft, viewport.left);
    const visibleRight = Math.min(
      columnLeft + width,
      viewport.left + viewport.width,
    );
    if (width > 0 && visibleRight > visibleLeft) {
      result.set(columnId, {
        left: visibleLeft - object.left,
        top: visibleGridTop - object.top - actionControlCrossSize,
        width: visibleRight - visibleLeft,
        height: actionControlCrossSize,
      });
    }
    columnLeft += width;
  });
  return result;
}

export function tableColumnCarrierLayouts(
  object: TableActionControlRect,
  viewport: TableActionControlRect,
  grid: TableActionControlRect,
  columnIds: readonly string[],
  columnWidths: readonly number[],
): {
  readonly lane: TableColumnCarrierLaneLayout | null;
  readonly carriers: ReadonlyMap<string, TableColumnCarrierLayout>;
  readonly triggers: ReadonlyMap<string, TableActionControlLayout>;
} {
  const carriers = new Map<string, TableColumnCarrierLayout>();
  if (
    grid.width <= 0 ||
    grid.height <= 0 ||
    columnIds.length !== columnWidths.length
  ) {
    return { lane: null, carriers, triggers: new Map() };
  }
  const lane: TableColumnCarrierLaneLayout = {
    left: grid.left - object.left,
    top: grid.top - object.top,
    height: grid.height,
  };
  const triggers = tableColumnActionControlLayouts(
    object,
    viewport,
    grid,
    columnIds,
    columnWidths,
  );
  columnIds.forEach((columnId, index) => {
    const width = columnWidths[index] ?? 0;
    if (!(width > 0)) return;
    carriers.set(columnId, {
      width,
      height: lane.height,
    });
  });
  return { lane, carriers, triggers };
}

function toRect(
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
): TableActionControlRect | null {
  return [rect.left, rect.top, rect.width, rect.height].every(
    Number.isFinite,
  ) &&
    rect.width >= 0 &&
    rect.height >= 0
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : null;
}

function readZero(): number {
  return 0;
}
