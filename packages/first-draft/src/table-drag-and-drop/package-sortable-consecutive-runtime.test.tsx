import { act, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DragProvider,
  pointerToRectDistance,
  useSortable,
  type DragStartEvent,
  type DropEvent,
} from "@mk-drag-and-drop/react";

const group = "first-draft-package-isolation";
const initialOrder = ["alpha", "bravo", "charlie", "delta"] as const;
let animationFrames: FrameRequestCallback[];

describe("installed sortable package consecutive-drag isolation", () => {
  beforeEach(() => {
    animationFrames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(
      () => undefined,
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        if (this.dataset.packageSortable) {
          const siblings = [
            ...(this.parentElement?.querySelectorAll<HTMLElement>(
              ":scope > [data-package-sortable]",
            ) ?? []),
          ];
          const index = siblings.indexOf(this);
          return rect(20, 30 + index * 40, 240, 40);
        }
        if (this.dataset.packageOverlay) {
          const wrapper = this.parentElement;
          const [x, y] = readTranslate3d(wrapper?.style.transform ?? "");
          return rect(
            Number.parseFloat(wrapper?.style.left ?? "0") + x,
            Number.parseFloat(wrapper?.style.top ?? "0") + y,
            240,
            40,
          );
        }
        return rect(0, 0, 0, 0);
      },
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("restores its activation snapshot and starts five independent sortable sessions", () => {
    const starts: DragStartEvent[] = [];
    const restoredOrders: string[][] = [];
    const drops: DropEvent[] = [];
    const fixture = render(
      <PackageSortableFixture
        onStart={(event) => starts.push(event)}
        onRestored={(order) => restoredOrders.push(order)}
        onDropEvent={(event) => drops.push(event)}
      />,
    );

    const order = () =>
      [...fixture.container.querySelectorAll<HTMLElement>(
        "[data-package-sortable]",
      )].map((element) => element.dataset.packageSortable!);
    const drag = (
      sourceIndex: number,
      targetY: number,
      result: "drop" | "cancel",
    ) => {
      const canonicalBefore = order();
      const source = fixture.container.querySelectorAll<HTMLElement>(
        "[data-package-sortable]",
      )[sourceIndex]!;
      const sourceRect = source.getBoundingClientRect();
      const startY = sourceRect.top + sourceRect.height / 2;
      fireEvent(source, pointerEvent("pointerdown", startY));
      fireEvent(window, pointerEvent("pointermove", targetY));
      const activeY = targetY + 1;
      fireEvent(window, pointerEvent("pointermove", activeY));
      flushAnimationFrames();
      expect(starts.at(-1)?.sourceRect).toMatchObject({
        left: sourceRect.left,
        top: sourceRect.top,
        width: sourceRect.width,
        height: sourceRect.height,
      });
      const overlay = document.querySelector<HTMLElement>(
        "[data-package-overlay]",
      );
      expect(overlay?.getBoundingClientRect()).toMatchObject({
        left: sourceRect.left,
        top: sourceRect.top + activeY - startY,
      });
      fireEvent(
        window,
        pointerEvent(result === "drop" ? "pointerup" : "pointercancel", activeY),
      );
      expect(restoredOrders.at(-1)).toEqual(canonicalBefore);
      expect(new Set(order()).size).toBe(initialOrder.length);
      expect(document.querySelector("[data-package-overlay]")).toBeNull();
    };

    drag(0, 185, "drop");
    drag(2, 35, "drop");
    const firstRect = fixture.container
      .querySelector<HTMLElement>("[data-package-sortable]")!
      .getBoundingClientRect();
    drag(0, firstRect.top + firstRect.height / 2 + 7, "drop");
    drag(0, 185, "cancel");
    drag(3, 35, "drop");

    expect(starts).toHaveLength(5);
    expect(restoredOrders).toHaveLength(5);
    expect(drops.length).toBeGreaterThanOrEqual(3);
    fixture.unmount();
  });
});

function PackageSortableFixture({
  onStart,
  onRestored,
  onDropEvent,
}: {
  readonly onStart: (event: DragStartEvent) => void;
  readonly onRestored: (order: string[]) => void;
  readonly onDropEvent: (event: DropEvent) => void;
}) {
  const [items, setItems] = useState<readonly string[]>(initialOrder);
  const readDomOrder = () =>
    [...document.querySelectorAll<HTMLElement>("[data-package-sortable]")].map(
      (element) => element.dataset.packageSortable!,
    );
  return (
    <DragProvider
      targetingAlgorithm={pointerToRectDistance}
      pointerConfiguration={{ activationDistance: 6 }}
      dragOverlay={() => <div data-package-overlay />}
      onDragStart={onStart}
      onDragEnd={() => onRestored(readDomOrder())}
      onDrop={(event) => {
        onDropEvent(event);
        const placement = event.sortablePlacement;
        if (!placement?.targetDraggableId || !placement.side) return;
        const targetId = placement.targetDraggableId;
        const side = placement.side;
        setItems((current) =>
          projectOrder(current, event.draggableId, targetId, side),
        );
      }}
    >
      <div>
        {items.map((item) => (
          <PackageSortableItem key={item} id={item} />
        ))}
      </div>
    </DragProvider>
  );
}

function PackageSortableItem({ id }: { readonly id: string }) {
  const sortable = useSortable<HTMLDivElement>({
    draggableId: id,
    group,
    containerId: "package-isolation-container",
    axis: "vertical",
  });
  return <div {...sortable} data-package-sortable={id} />;
}

function projectOrder(
  order: readonly string[],
  sourceId: string,
  targetId: string,
  placement: "before" | "after",
): readonly string[] {
  if (sourceId === targetId) return order;
  const next = order.filter((id) => id !== sourceId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0) return order;
  next.splice(targetIndex + (placement === "after" ? 1 : 0), 0, sourceId);
  return next;
}

function pointerEvent(type: string, clientY: number): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    clientX: 80,
    clientY,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "isPrimary", { value: true });
  return event as PointerEvent;
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}

function readTranslate3d(transform: string): readonly [number, number] {
  const match = transform.match(
    /translate3d\((-?\d+(?:\.\d+)?)px,\s*(-?\d+(?:\.\d+)?)px,\s*0(?:px)?\)/u,
  );
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

function flushAnimationFrames(): void {
  act(() => {
    while (animationFrames.length > 0) {
      const frames = animationFrames.splice(0);
      for (const frame of frames) frame(0);
    }
  });
}
