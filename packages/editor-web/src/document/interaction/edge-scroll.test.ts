import { afterEach, describe, expect, it, vi } from "vitest";
import { createEdgeScrollController } from "./edge-scroll.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createEdgeScrollController", () => {
  it("scrolls downward with a time-delta speed ramp near the bottom edge", () => {
    const raf = createRafDriver();
    const scrollElement = createScrollableElement({ scrollTop: 0 });
    const ticks: unknown[] = [];
    const scrolls: unknown[] = [];
    const controller = createEdgeScrollController({
      scrollElement,
      axes: { y: true },
      edgeZonePx: 64,
      maxSpeedPxPerSecond: 900,
      now: () => 0,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      onTick: (tick) => ticks.push(tick),
      onScroll: (tick) => scrolls.push(tick),
    });

    controller.start({ clientX: 100, clientY: 100 });
    raf.step(100);

    expect(scrollElement.scrollTop).toBe(90);
    expect(ticks).toHaveLength(1);
    expect(scrolls).toHaveLength(1);
  });

  it("scrolls upward near the top edge and clamps at document boundaries", () => {
    const raf = createRafDriver();
    const scrollElement = createScrollableElement({ scrollTop: 40 });
    const scrolls: unknown[] = [];
    const controller = createEdgeScrollController({
      scrollElement,
      axes: { y: true },
      edgeZonePx: 64,
      maxSpeedPxPerSecond: 900,
      now: () => 0,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      onScroll: (tick) => scrolls.push(tick),
    });

    controller.start({ clientX: 100, clientY: 0 });
    raf.step(100);

    expect(scrollElement.scrollTop).toBe(0);
    expect(scrolls).toHaveLength(1);

    raf.step(200);
    expect(scrollElement.scrollTop).toBe(0);
  });

  it("stays inactive until started and cancels the animation frame on stop", () => {
    const raf = createRafDriver();
    const scrollElement = createScrollableElement({ scrollTop: 0 });
    const controller = createEdgeScrollController({
      scrollElement,
      now: () => 0,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
    });

    controller.updatePointer({ clientX: 100, clientY: 100 });
    expect(raf.pendingCount()).toBe(0);
    expect(scrollElement.scrollTop).toBe(0);

    controller.start();
    expect(raf.pendingCount()).toBe(1);

    controller.stop();
    expect(controller.isActive()).toBe(false);
    expect(raf.pendingCount()).toBe(0);
  });

  it("supports horizontal-axis configuration without vertical scrolling", () => {
    const raf = createRafDriver();
    const scrollElement = createScrollableElement({
      scrollLeft: 0,
      scrollTop: 50,
      scrollWidth: 1000,
      clientWidth: 200,
    });
    const controller = createEdgeScrollController({
      scrollElement,
      axes: { x: true, y: false },
      edgeZonePx: 64,
      maxSpeedPxPerSecond: 900,
      now: () => 0,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
    });

    controller.start({ clientX: 200, clientY: 100 });
    raf.step(100);

    expect(scrollElement.scrollLeft).toBe(90);
    expect(scrollElement.scrollTop).toBe(50);
  });

  it("uses the visible viewport bounds for the document scrolling element", () => {
    const raf = createRafDriver();
    const scrollElement = document.documentElement;
    Object.defineProperty(document, "scrollingElement", {
      configurable: true,
      value: scrollElement,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollElement, "clientHeight", {
      configurable: true,
      value: 100,
    });
    Object.defineProperty(scrollElement, "scrollHeight", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(scrollElement, "clientWidth", {
      configurable: true,
      value: 200,
    });
    Object.defineProperty(scrollElement, "scrollWidth", {
      configurable: true,
      value: 200,
    });
    scrollElement.scrollTop = 0;
    vi.spyOn(scrollElement, "getBoundingClientRect").mockReturnValue(
      domRect({
        left: 0,
        top: 0,
        right: 200,
        bottom: 1000,
        width: 200,
        height: 1000,
      }),
    );
    const controller = createEdgeScrollController({
      scrollElement,
      axes: { y: true },
      edgeZonePx: 64,
      maxSpeedPxPerSecond: 900,
      now: () => 0,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
    });

    controller.start({ clientX: 100, clientY: 96 });
    raf.step(100);

    expect(scrollElement.scrollTop).toBeGreaterThan(0);
  });

  it("does not require selection callbacks to scroll", () => {
    const raf = createRafDriver();
    const scrollElement = createScrollableElement({ scrollTop: 0 });
    const onTick = vi.fn();
    const onScroll = vi.fn();
    const controller = createEdgeScrollController({
      scrollElement,
      axes: { y: true },
      now: () => 0,
      requestAnimationFrame: raf.requestAnimationFrame,
      cancelAnimationFrame: raf.cancelAnimationFrame,
      onTick,
      onScroll,
    });

    controller.start({ clientX: 100, clientY: 100 });
    raf.step(100);

    expect(scrollElement.scrollTop).toBeGreaterThan(0);
    expect(onTick).toHaveBeenCalledTimes(1);
    expect(onScroll).toHaveBeenCalledTimes(1);
  });
});

function createScrollableElement(
  options: {
    scrollTop?: number;
    scrollLeft?: number;
    clientHeight?: number;
    scrollHeight?: number;
    clientWidth?: number;
    scrollWidth?: number;
  } = {},
): HTMLElement {
  const element = document.createElement("div");
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: options.clientHeight ?? 100,
  });
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: options.scrollHeight ?? 1000,
  });
  Object.defineProperty(element, "clientWidth", {
    configurable: true,
    value: options.clientWidth ?? 200,
  });
  Object.defineProperty(element, "scrollWidth", {
    configurable: true,
    value: options.scrollWidth ?? 200,
  });
  element.scrollTop = options.scrollTop ?? 0;
  element.scrollLeft = options.scrollLeft ?? 0;
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue(
    domRect({
      left: 0,
      top: 0,
      right: options.clientWidth ?? 200,
      bottom: options.clientHeight ?? 100,
      width: options.clientWidth ?? 200,
      height: options.clientHeight ?? 100,
    }),
  );
  return element;
}

function createRafDriver(): {
  requestAnimationFrame: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame: (handle: number) => void;
  step: (timestamp: number) => void;
  pendingCount: () => number;
} {
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  return {
    requestAnimationFrame: (callback) => {
      const handle = nextHandle;
      nextHandle += 1;
      callbacks.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame: (handle) => {
      callbacks.delete(handle);
    },
    step: (timestamp) => {
      const pending = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pending) callback(timestamp);
    },
    pendingCount: () => callbacks.size,
  };
}

function domRect(rect: Partial<DOMRect>): DOMRect {
  const left = rect.left ?? 0;
  const top = rect.top ?? 0;
  const width = rect.width ?? Math.max(0, (rect.right ?? left) - left);
  const height = rect.height ?? Math.max(0, (rect.bottom ?? top) - top);
  return {
    x: rect.x ?? left,
    y: rect.y ?? top,
    left,
    top,
    width,
    height,
    right: rect.right ?? left + width,
    bottom: rect.bottom ?? top + height,
    toJSON: () => ({}),
  } as DOMRect;
}
