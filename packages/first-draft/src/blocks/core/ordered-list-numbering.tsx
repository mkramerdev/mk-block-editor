"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import type { FirstDraftEditor } from "../../first-draft-editor-contracts.ts";

interface OrderedListNumberingProjection {
  readonly containerId: BlockId;
  readonly ordinalByItemId: ReadonlyMap<BlockId, number>;
}

const OrderedListNumberingContext =
  createContext<OrderedListNumberingProjection | null>(null);

export function OrderedListNumberingProvider({
  containerId,
  editor,
  children,
}: {
  readonly containerId: BlockId;
  readonly editor: FirstDraftEditor;
  readonly children?: ReactNode;
}) {
  const subscribe = useCallback(
    (listener: () => void) =>
      editor.subscribeChildBlockIds(containerId, listener),
    [containerId, editor],
  );
  const getSnapshot = useCallback(
    () => editor.getChildBlockIds(containerId),
    [containerId, editor],
  );
  const childIds = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const projection = useMemo<OrderedListNumberingProjection>(
    () => ({
      containerId,
      ordinalByItemId: new Map(
        childIds.map((itemId, index) => [itemId, index + 1] as const),
      ),
    }),
    [childIds, containerId],
  );

  return (
    <OrderedListNumberingContext.Provider value={projection}>
      {children}
    </OrderedListNumberingContext.Provider>
  );
}

export function useOrderedListItemOrdinal(
  itemId: BlockId,
  parentId: BlockId | null,
  ordered: boolean,
): number | null {
  const projection = useContext(OrderedListNumberingContext);
  if (!ordered) return null;
  if (!projection || projection.containerId !== parentId) {
    throw new Error(
      `Ordered-list item ${itemId} is not rendered beneath its canonical list container`,
    );
  }
  const ordinal = projection.ordinalByItemId.get(itemId);
  if (
    typeof ordinal !== "number" ||
    !Number.isFinite(ordinal) ||
    !Number.isInteger(ordinal) ||
    ordinal < 1
  ) {
    throw new Error(
      `Ordered-list item ${itemId} is absent from its canonical child sequence`,
    );
  }
  return ordinal;
}
