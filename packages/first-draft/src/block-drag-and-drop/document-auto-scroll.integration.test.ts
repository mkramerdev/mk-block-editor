import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutoScroll, type AutoScrollEvent } from "mk-autoscroll";

const frames: FrameRequestCallback[] = [];

afterEach(() => {
  frames.length = 0;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("shared First Draft document autoscroll package", () => {
  it("reports actual upward and downward element scrolling", () => {
    const container = scrollContainer();
    const events: AutoScrollEvent[] = [];
    mockAnimationFrames();
    const autoScroll = createAutoScroll({
      container,
      axis: "y",
      outsideBehavior: "continue",
      onScroll: (event) => events.push(event),
    });
    container.scrollTop = 400;
    autoScroll.updatePoint({ x: 50, y: 1 });
    autoScroll.start();
    flushFrame(0);
    flushFrame(100);
    const upwardPosition = container.scrollTop;
    expect(upwardPosition).toBeLessThan(400);
    expect(events.at(-1)?.changes[0]?.deltaY).toBeLessThan(0);

    autoScroll.updatePoint({ x: 50, y: 199 });
    flushFrame(200);
    expect(container.scrollTop).toBeGreaterThan(upwardPosition);
    expect(events.at(-1)?.changes[0]?.deltaY).toBeGreaterThan(0);
    autoScroll.stop();
    autoScroll.updatePoint(null);
  });

  it("emits no scroll callback at the top or bottom boundary", () => {
    const container = scrollContainer();
    const onScroll = vi.fn();
    mockAnimationFrames();
    const autoScroll = createAutoScroll({
      container,
      axis: "y",
      outsideBehavior: "continue",
      onScroll,
    });

    container.scrollTop = 0;
    autoScroll.updatePoint({ x: 50, y: 1 });
    autoScroll.start();
    flushFrame(0);
    flushFrame(100);
    expect(onScroll).not.toHaveBeenCalled();

    autoScroll.stop();
    container.scrollTop = 800;
    autoScroll.updatePoint({ x: 50, y: 199 });
    autoScroll.start();
    flushFrame(200);
    flushFrame(300);
    expect(onScroll).not.toHaveBeenCalled();
    autoScroll.stop();
    autoScroll.updatePoint(null);
  });
});

function scrollContainer(): HTMLDivElement {
  const container = document.createElement("div");
  document.body.append(container);
  Object.defineProperties(container, {
    clientHeight: { configurable: true, value: 200 },
    clientWidth: { configurable: true, value: 100 },
    scrollHeight: { configurable: true, value: 1_000 },
    scrollWidth: { configurable: true, value: 100 },
  });
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    top: 0,
    right: 100,
    bottom: 200,
    left: 0,
    width: 100,
    height: 200,
    toJSON: () => ({}),
  } as DOMRect);
  return container;
}

function mockAnimationFrames(): void {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    frames.push(callback);
    return frames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
}

function flushFrame(timestamp: number): void {
  const frame = frames.shift();
  if (!frame) throw new Error("Expected an autoscroll animation frame");
  frame(timestamp);
}
