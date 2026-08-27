import { afterEach, describe, expect, it, vi } from "vitest";
import { createAutoScroll, type AutoScrollEvent } from "mk-autoscroll";

const frames: FrameRequestCallback[] = [];

afterEach(() => {
  frames.length = 0;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("installed mk-autoscroll nested table behavior", () => {
  it("moves table X and document Y in the same animation frame", () => {
    const { table, documentScroll } = nestedContainers();
    const events: AutoScrollEvent[] = [];
    mockAnimationFrames();
    const autoScroll = createAutoScroll({
      container: () => [table, documentScroll],
      axis: "both",
      outsideBehavior: "continue",
      onScroll: (event) => events.push(event),
    });
    autoScroll.updatePoint({ x: 219, y: 299 });
    autoScroll.start();
    flushFrame(0);
    flushFrame(100);

    expect(table.scrollLeft).toBeGreaterThan(0);
    expect(documentScroll.scrollTop).toBeGreaterThan(0);
    expect(events).toHaveLength(1);
    expect(events[0]!.changes).toEqual([
      expect.objectContaining({ container: table, deltaX: expect.any(Number) }),
      expect.objectContaining({
        container: documentScroll,
        deltaY: expect.any(Number),
      }),
    ]);
    autoScroll.stop();
  });

  it("scrolls left, continues document Y outside, and honors cross-axis safety", () => {
    const { table, documentScroll } = nestedContainers();
    mockAnimationFrames();
    const onScroll = vi.fn();
    const autoScroll = createAutoScroll({
      container: () => [table, documentScroll],
      axis: "both",
      outsideBehavior: "continue",
      onScroll,
    });
    table.scrollLeft = 400;
    autoScroll.updatePoint({ x: 21, y: 200 });
    autoScroll.start();
    flushFrame(0);
    flushFrame(100);
    expect(table.scrollLeft).toBeLessThan(400);

    const previousTop = documentScroll.scrollTop;
    autoScroll.updatePoint({ x: 150, y: 340 });
    flushFrame(200);
    expect(documentScroll.scrollTop).toBeGreaterThan(previousTop);

    const safeTop = documentScroll.scrollTop;
    autoScroll.updatePoint({ x: 350, y: 340 });
    flushFrame(300);
    expect(documentScroll.scrollTop).toBe(safeTop);
    autoScroll.stop();
  });

  it("does not report containers that are already at their axis limit", () => {
    const { table, documentScroll } = nestedContainers();
    mockAnimationFrames();
    const onScroll = vi.fn();
    table.scrollLeft = 800;
    documentScroll.scrollTop = 700;
    const autoScroll = createAutoScroll({
      container: [table, documentScroll],
      axis: "both",
      outsideBehavior: "continue",
      onScroll,
    });
    autoScroll.updatePoint({ x: 219, y: 299 });
    autoScroll.start();
    flushFrame(0);
    flushFrame(100);
    expect(onScroll).not.toHaveBeenCalled();
    autoScroll.stop();
  });
});

function nestedContainers(): {
  readonly table: HTMLDivElement;
  readonly documentScroll: HTMLDivElement;
} {
  const documentScroll = scrollElement({
    clientWidth: 300,
    clientHeight: 300,
    scrollWidth: 300,
    scrollHeight: 1_000,
    rect: [0, 0, 300, 300],
  });
  const table = scrollElement({
    clientWidth: 200,
    clientHeight: 200,
    scrollWidth: 1_000,
    scrollHeight: 200,
    rect: [20, 100, 200, 200],
  });
  documentScroll.append(table);
  document.body.append(documentScroll);
  return { table, documentScroll };
}

function scrollElement(input: {
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  readonly rect: readonly [number, number, number, number];
}): HTMLDivElement {
  const element = document.createElement("div");
  Object.defineProperties(element, {
    clientWidth: { configurable: true, value: input.clientWidth },
    clientHeight: { configurable: true, value: input.clientHeight },
    scrollWidth: { configurable: true, value: input.scrollWidth },
    scrollHeight: { configurable: true, value: input.scrollHeight },
  });
  const [left, top, width, height] = input.rect;
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  } as DOMRect);
  return element;
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
