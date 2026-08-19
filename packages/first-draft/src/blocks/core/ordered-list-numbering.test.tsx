import { act, cleanup, render, screen } from "@testing-library/react";
import type { BlockId } from "@repo/editor-core/kernel";
import type { FirstDraftEditor } from "../../first-draft-editor-contracts.ts";
import { afterEach, describe, expect, it } from "vitest";
import {
  OrderedListNumberingProvider,
  useOrderedListItemOrdinal,
} from "./ordered-list-numbering.tsx";

describe("ordered-list numbering projection", () => {
  afterEach(cleanup);

  it("owns one stable child-sequence subscription and projects structural changes", () => {
    const listId = id("list");
    const itemIds = [id("one"), id("two"), id("three"), id("four")];
    const source = createChildSequenceSource({ [listId]: itemIds });
    const rendered = render(
      <ProjectedList
        editor={source.editor}
        listId={listId}
        itemIds={itemIds}
      />,
    );

    expect(markerText()).toEqual(["1.", "2.", "3.", "4."]);
    expect(source.activeSubscriptions(listId)).toBe(1);
    expect(source.subscriptionCount(listId)).toBe(1);

    rendered.rerender(
      <ProjectedList
        editor={source.editor}
        listId={listId}
        itemIds={itemIds}
      />,
    );
    expect(source.activeSubscriptions(listId)).toBe(1);
    expect(source.subscriptionCount(listId)).toBe(1);

    const inserted = [id("inserted"), ...itemIds];
    act(() => {
      source.publish(listId, inserted);
      rendered.rerender(
        <ProjectedList
          editor={source.editor}
          listId={listId}
          itemIds={inserted}
        />,
      );
    });
    expect(markerText()).toEqual(["1.", "2.", "3.", "4.", "5."]);
    expect(source.subscriptionCount(listId)).toBe(1);

    const reordered = [itemIds[2]!, itemIds[0]!, itemIds[3]!];
    act(() => {
      source.publish(listId, reordered);
      rendered.rerender(
        <ProjectedList
          editor={source.editor}
          listId={listId}
          itemIds={reordered}
        />,
      );
    });
    expect(
      screen.getAllByTestId("marker").map((node) => node.dataset.itemId),
    ).toEqual(reordered);
    expect(markerText()).toEqual(["1.", "2.", "3."]);
    expect(source.activeSubscriptions(listId)).toBe(1);
    expect(source.subscriptionCount(listId)).toBe(1);

    rendered.unmount();
    expect(source.activeSubscriptions(listId)).toBe(0);
    expect(source.releaseCount(listId)).toBe(source.subscriptionCount(listId));
  });

  it("isolates nested providers and updates both projections when an item moves", () => {
    const outerId = id("outer");
    const innerId = id("inner");
    const secondId = id("second");
    const movedId = id("moved");
    const innerItemId = id("inner-item");
    const source = createChildSequenceSource({
      [outerId]: [movedId, secondId],
      [innerId]: [innerItemId],
    });
    const rendered = render(
      <NestedProjection
        editor={source.editor}
        outerId={outerId}
        outerItems={[movedId, secondId]}
        innerId={innerId}
        innerItems={[innerItemId]}
      />,
    );

    expect(markerText("outer-marker")).toEqual(["1.", "2."]);
    expect(markerText("inner-marker")).toEqual(["1."]);
    expect(source.activeSubscriptions(outerId)).toBe(1);
    expect(source.activeSubscriptions(innerId)).toBe(1);

    act(() => {
      source.publish(outerId, [secondId]);
      source.publish(innerId, [innerItemId, movedId]);
      rendered.rerender(
        <NestedProjection
          editor={source.editor}
          outerId={outerId}
          outerItems={[secondId]}
          innerId={innerId}
          innerItems={[innerItemId, movedId]}
        />,
      );
    });

    expect(markerText("outer-marker")).toEqual(["1."]);
    expect(markerText("inner-marker")).toEqual(["1.", "2."]);
    expect(source.activeSubscriptions(outerId)).toBe(1);
    expect(source.activeSubscriptions(innerId)).toBe(1);
  });
});

function ProjectedList({
  editor,
  listId,
  itemIds,
}: {
  readonly editor: FirstDraftEditor;
  readonly listId: BlockId;
  readonly itemIds: readonly BlockId[];
}) {
  return (
    <OrderedListNumberingProvider containerId={listId} editor={editor}>
      {itemIds.map((itemId) => (
        <Ordinal key={itemId} itemId={itemId} parentId={listId} />
      ))}
    </OrderedListNumberingProvider>
  );
}

function NestedProjection({
  editor,
  outerId,
  outerItems,
  innerId,
  innerItems,
}: {
  readonly editor: FirstDraftEditor;
  readonly outerId: BlockId;
  readonly outerItems: readonly BlockId[];
  readonly innerId: BlockId;
  readonly innerItems: readonly BlockId[];
}) {
  return (
    <OrderedListNumberingProvider containerId={outerId} editor={editor}>
      {outerItems.map((itemId) => (
        <Ordinal
          key={itemId}
          itemId={itemId}
          parentId={outerId}
          testId="outer-marker"
        />
      ))}
      <OrderedListNumberingProvider containerId={innerId} editor={editor}>
        {innerItems.map((itemId) => (
          <Ordinal
            key={itemId}
            itemId={itemId}
            parentId={innerId}
            testId="inner-marker"
          />
        ))}
      </OrderedListNumberingProvider>
    </OrderedListNumberingProvider>
  );
}

function Ordinal({
  itemId,
  parentId,
  testId = "marker",
}: {
  readonly itemId: BlockId;
  readonly parentId: BlockId;
  readonly testId?: string;
}) {
  const ordinal = useOrderedListItemOrdinal(itemId, parentId, true);
  return (
    <span data-testid={testId} data-item-id={itemId}>
      {ordinal}.
    </span>
  );
}

function markerText(testId = "marker") {
  return screen.getAllByTestId(testId).map((node) => node.textContent);
}

function createChildSequenceSource(
  initial: Readonly<Record<BlockId, readonly BlockId[]>>,
) {
  const sequences = new Map<BlockId, readonly BlockId[]>(
    Object.entries(initial) as [BlockId, readonly BlockId[]][],
  );
  const listeners = new Map<BlockId, Set<() => void>>();
  const subscriptions = new Map<BlockId, number>();
  const releases = new Map<BlockId, number>();
  const editor = {
    getChildBlockIds(parentId: BlockId) {
      return sequences.get(parentId) ?? [];
    },
    subscribeChildBlockIds(parentId: BlockId, listener: () => void) {
      const parentListeners = listeners.get(parentId) ?? new Set();
      parentListeners.add(listener);
      listeners.set(parentId, parentListeners);
      subscriptions.set(parentId, (subscriptions.get(parentId) ?? 0) + 1);
      return () => {
        parentListeners.delete(listener);
        releases.set(parentId, (releases.get(parentId) ?? 0) + 1);
      };
    },
  } as unknown as FirstDraftEditor;

  return {
    editor,
    publish(parentId: BlockId, childIds: readonly BlockId[]) {
      sequences.set(parentId, childIds);
      for (const listener of listeners.get(parentId) ?? []) listener();
    },
    activeSubscriptions(parentId: BlockId) {
      return listeners.get(parentId)?.size ?? 0;
    },
    subscriptionCount(parentId: BlockId) {
      return subscriptions.get(parentId) ?? 0;
    },
    releaseCount(parentId: BlockId) {
      return releases.get(parentId) ?? 0;
    },
  };
}

function id(value: string): BlockId {
  return value as BlockId;
}
