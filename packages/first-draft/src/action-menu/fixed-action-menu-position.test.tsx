import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditableEditor } from "@repo/editor-web/editor";
import { useFirstDraftFixedActionMenuPosition } from "./fixed-action-menu-position.ts";

const bounds = new WeakMap<Element, DOMRect>();
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  frames = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return bounds.get(this) ?? rect(0, 0, 0, 0);
    },
  );
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("First Draft fixed action-menu positioning", () => {
  it("uses the owning document-scroll viewport and repositions for scroll, resize, and geometry changes", () => {
    const geometry = createGeometry();
    const disconnected = vi.fn();
    const view = render(
      <PositionFixture geometry={geometry.port} onDisconnected={disconnected} />,
    );
    const boundary = view.getByTestId("boundary");
    const trigger = view.getByRole("button", { name: "Action trigger" });
    const menu = view.getByTestId("menu");
    bounds.set(boundary, rect(0, 100, 800, 400));
    bounds.set(trigger, rect(76, 400, 16, 40));
    bounds.set(menu, rect(0, 0, 208, 180));

    flushFrames();
    expect(menu.dataset.placement).toBe("top");
    expect(menu.dataset.availableHeight).toBe("286");
    expect(Number(menu.dataset.top)).toBeGreaterThanOrEqual(108);

    bounds.set(trigger, rect(76, 120, 16, 40));
    fireEvent.scroll(boundary);
    flushFrames();
    expect(menu.dataset.placement).toBe("bottom");
    expect(menu.dataset.availableHeight).toBe("326");

    bounds.set(trigger, rect(76, 390, 16, 40));
    act(() => geometry.invalidate());
    flushFrames();
    expect(menu.dataset.placement).toBe("top");

    bounds.set(trigger, rect(76, 130, 16, 40));
    fireEvent(window, new Event("resize"));
    flushFrames();
    expect(menu.dataset.placement).toBe("bottom");
    expect(disconnected).not.toHaveBeenCalled();
  });

  it("closes safely when the real trigger disconnects and cancels pending frames", () => {
    const geometry = createGeometry();
    const disconnected = vi.fn();
    const view = render(
      <PositionFixture geometry={geometry.port} onDisconnected={disconnected} />,
    );
    const trigger = view.getByRole("button", { name: "Action trigger" });
    const menu = view.getByTestId("menu");
    bounds.set(trigger, rect(20, 20, 24, 24));
    bounds.set(menu, rect(0, 0, 160, 120));
    flushFrames();

    trigger.remove();
    fireEvent.scroll(window);
    flushFrames();
    expect(disconnected).toHaveBeenCalledOnce();
    expect(menu.dataset.placement).toBeUndefined();

    act(() => geometry.invalidate());
    view.unmount();
    expect(window.cancelAnimationFrame).toHaveBeenCalled();
  });
});

function PositionFixture({
  geometry,
  onDisconnected,
}: {
  readonly geometry: EditableEditor["geometry"];
  readonly onDisconnected: () => void;
}) {
  const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
  const triggerRef = useCallback(
    (element: HTMLButtonElement | null) => setTrigger(element),
    [],
  );
  return (
    <div className="first-draft-example__document-scroll" data-testid="boundary">
      <button ref={triggerRef} type="button">
        Action trigger
      </button>
      {trigger ? (
        <PositionProbe
          geometry={geometry}
          trigger={trigger}
          onDisconnected={onDisconnected}
        />
      ) : null}
    </div>
  );
}

function PositionProbe({
  geometry,
  trigger,
  onDisconnected,
}: {
  readonly geometry: EditableEditor["geometry"];
  readonly trigger: HTMLButtonElement;
  readonly onDisconnected: () => void;
}) {
  const { menuRef, position } = useFirstDraftFixedActionMenuPosition({
    geometry,
    triggerElement: trigger,
    onDisconnected,
  });
  return (
    <div
      ref={menuRef}
      data-testid="menu"
      data-placement={position?.placement}
      data-available-height={position?.availableHeight}
      data-left={position?.left}
      data-top={position?.top}
    />
  );
}

function createGeometry(): {
  readonly port: EditableEditor["geometry"];
  invalidate(): void;
} {
  let revision = 0;
  const listeners = new Set<() => void>();
  return {
    port: {
      getRevision: () => revision,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as EditableEditor["geometry"],
    invalidate() {
      revision += 1;
      for (const listener of [...listeners]) listener();
    },
  };
}

function flushFrames(): void {
  act(() => {
    for (const callback of frames.splice(0)) callback(performance.now());
  });
}

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}
