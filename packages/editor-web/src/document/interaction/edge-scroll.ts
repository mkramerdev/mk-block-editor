export interface EdgeScrollAxes {
  x?: boolean;
  y?: boolean;
}

export interface EdgeScrollPointer {
  clientX: number;
  clientY: number;
}

export interface EdgeScrollTick {
  pointer: EdgeScrollPointer;
  elapsedMs: number;
  velocityX: number;
  velocityY: number;
  deltaX: number;
  deltaY: number;
  didScrollX: boolean;
  didScrollY: boolean;
  didScroll: boolean;
  scrollLeft: number;
  scrollTop: number;
}

export interface EdgeScrollController {
  start(pointer?: EdgeScrollPointer): void;
  updatePointer(pointer: EdgeScrollPointer): void;
  stop(): void;
  dispose(): void;
  isActive(): boolean;
}

export interface EdgeScrollControllerOptions {
  scrollElement: HTMLElement;
  axes?: EdgeScrollAxes;
  edgeZonePx?: number;
  maxSpeedPxPerSecond?: number;
  speedRamp?: (edgeRatio: number) => number;
  onTick?: (tick: EdgeScrollTick) => void;
  onScroll?: (tick: EdgeScrollTick) => void;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  now?: () => number;
}

export const DEFAULT_EDGE_SCROLL_EDGE_ZONE_PX = 64;
export const DEFAULT_EDGE_SCROLL_MAX_SPEED_PX_PER_SECOND = 900;

export function createEdgeScrollController(options: EdgeScrollControllerOptions): EdgeScrollController {
  return new DomEdgeScrollController(options);
}

class DomEdgeScrollController implements EdgeScrollController {
  private readonly scrollElement: HTMLElement;
  private readonly axes: Required<EdgeScrollAxes>;
  private readonly edgeZonePx: number;
  private readonly maxSpeedPxPerSecond: number;
  private readonly speedRamp: (edgeRatio: number) => number;
  private readonly onTick: ((tick: EdgeScrollTick) => void) | undefined;
  private readonly onScroll: ((tick: EdgeScrollTick) => void) | undefined;
  private readonly requestFrame: (callback: FrameRequestCallback) => number;
  private readonly cancelFrame: (handle: number) => void;
  private readonly frameSchedulingAvailable: boolean;
  private readonly readNow: () => number;
  private pointer: EdgeScrollPointer | null = null;
  private active = false;
  private frameHandle: number | null = null;
  private lastFrameTime: number | null = null;

  constructor(options: EdgeScrollControllerOptions) {
    this.scrollElement = options.scrollElement;
    this.axes = {
      x: options.axes?.x ?? false,
      y: options.axes?.y ?? true,
    };
    this.edgeZonePx = Math.max(1, options.edgeZonePx ?? DEFAULT_EDGE_SCROLL_EDGE_ZONE_PX);
    this.maxSpeedPxPerSecond = Math.max(0, options.maxSpeedPxPerSecond ?? DEFAULT_EDGE_SCROLL_MAX_SPEED_PX_PER_SECOND);
    this.speedRamp = options.speedRamp ?? linearSpeedRamp;
    this.onTick = options.onTick;
    this.onScroll = options.onScroll;
    const view = options.scrollElement.ownerDocument.defaultView;
    this.readNow = options.now ?? (() => view?.performance.now() ?? globalThis.performance?.now() ?? Date.now());
    const frameScheduler = resolveEdgeScrollFrameScheduler(options, view);
    this.requestFrame = frameScheduler.requestFrame;
    this.cancelFrame = frameScheduler.cancelFrame;
    this.frameSchedulingAvailable = frameScheduler.available;
  }

  start(pointer?: EdgeScrollPointer): void {
    if (pointer) this.pointer = normalizePointer(pointer);
    if (this.active) {
      this.ensureFrameIfNeeded();
      return;
    }
    this.active = true;
    this.lastFrameTime = this.readNow();
    this.ensureFrameIfNeeded();
  }

  updatePointer(pointer: EdgeScrollPointer): void {
    this.pointer = normalizePointer(pointer);
    if (!this.active) return;
    this.ensureFrameIfNeeded();
  }

  stop(): void {
    this.active = false;
    this.lastFrameTime = null;
    if (this.frameHandle === null) return;
    this.cancelFrame(this.frameHandle);
    this.frameHandle = null;
  }

  dispose(): void {
    this.stop();
    this.pointer = null;
  }

  isActive(): boolean {
    return this.active;
  }

  private ensureFrameIfNeeded(): void {
    if (!this.active || this.frameHandle !== null) return;
    if (!this.hasScrollIntent()) return;
    if (!this.frameSchedulingAvailable) return;
    this.frameHandle = this.requestFrame((timestamp) => this.tick(timestamp));
  }

  private tick(timestamp: number): void {
    this.frameHandle = null;
    if (!this.active || !this.pointer) return;

    const previousFrameTime = this.lastFrameTime ?? timestamp;
    const elapsedMs = Math.max(0, timestamp - previousFrameTime);
    this.lastFrameTime = timestamp;

    const { velocityX, velocityY } = this.resolveVelocities();
    const elapsedSeconds = elapsedMs / 1000;
    const deltaX = velocityX * elapsedSeconds;
    const deltaY = velocityY * elapsedSeconds;
    const previousScrollLeft = this.scrollElement.scrollLeft;
    const previousScrollTop = this.scrollElement.scrollTop;
    const nextScrollLeft = this.axes.x
      ? clamp(previousScrollLeft + deltaX, 0, maxScrollLeft(this.scrollElement))
      : previousScrollLeft;
    const nextScrollTop = this.axes.y
      ? clamp(previousScrollTop + deltaY, 0, maxScrollTop(this.scrollElement))
      : previousScrollTop;

    if (nextScrollLeft !== previousScrollLeft) this.scrollElement.scrollLeft = nextScrollLeft;
    if (nextScrollTop !== previousScrollTop) this.scrollElement.scrollTop = nextScrollTop;

    const didScrollX = nextScrollLeft !== previousScrollLeft;
    const didScrollY = nextScrollTop !== previousScrollTop;
    const tick = {
      pointer: this.pointer,
      elapsedMs,
      velocityX,
      velocityY,
      deltaX: nextScrollLeft - previousScrollLeft,
      deltaY: nextScrollTop - previousScrollTop,
      didScrollX,
      didScrollY,
      didScroll: didScrollX || didScrollY,
      scrollLeft: this.scrollElement.scrollLeft,
      scrollTop: this.scrollElement.scrollTop,
    } satisfies EdgeScrollTick;

    this.onTick?.(tick);
    if (tick.didScroll) this.onScroll?.(tick);
    this.ensureFrameIfNeeded();
  }

  private hasScrollIntent(): boolean {
    if (!this.pointer) return false;
    const { velocityX, velocityY } = this.resolveVelocities();
    return velocityX !== 0 || velocityY !== 0;
  }

  private resolveVelocities(): { velocityX: number; velocityY: number } {
    if (!this.pointer || this.maxSpeedPxPerSecond <= 0) {
      return { velocityX: 0, velocityY: 0 };
    }
    const rect = resolveEdgeScrollViewportRect(this.scrollElement);
    return {
      velocityX: this.axes.x ? this.resolveAxisVelocity(this.pointer.clientX, rect.left, rect.right) : 0,
      velocityY: this.axes.y ? this.resolveAxisVelocity(this.pointer.clientY, rect.top, rect.bottom) : 0,
    };
  }

  private resolveAxisVelocity(clientPosition: number, start: number, end: number): number {
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
    const leadingDistance = start + this.edgeZonePx - clientPosition;
    if (leadingDistance > 0) return -this.speedForEdgeDistance(leadingDistance);
    const trailingDistance = clientPosition - (end - this.edgeZonePx);
    if (trailingDistance > 0) return this.speedForEdgeDistance(trailingDistance);
    return 0;
  }

  private speedForEdgeDistance(distance: number): number {
    const ratio = clamp(distance / this.edgeZonePx, 0, 1);
    return this.maxSpeedPxPerSecond * clamp(this.speedRamp(ratio), 0, 1);
  }
}

function linearSpeedRamp(edgeRatio: number): number {
  return edgeRatio;
}

function resolveEdgeScrollFrameScheduler(
  options: EdgeScrollControllerOptions,
  view: Window | null,
): {
  requestFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
  available: boolean;
} {
  const requestFrame = options.requestAnimationFrame ?? view?.requestAnimationFrame?.bind(view);
  if (!requestFrame) {
    return {
      requestFrame: () => 0,
      cancelFrame: () => undefined,
      available: false,
    };
  }
  return {
    requestFrame,
    cancelFrame: options.cancelAnimationFrame ?? view?.cancelAnimationFrame?.bind(view) ?? (() => undefined),
    available: true,
  };
}

function normalizePointer(pointer: EdgeScrollPointer): EdgeScrollPointer {
  return {
    clientX: Number.isFinite(pointer.clientX) ? pointer.clientX : 0,
    clientY: Number.isFinite(pointer.clientY) ? pointer.clientY : 0,
  };
}

function maxScrollLeft(element: HTMLElement): number {
  return Math.max(0, element.scrollWidth - element.clientWidth);
}

function maxScrollTop(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function resolveEdgeScrollViewportRect(element: HTMLElement): Pick<DOMRect, "left" | "top" | "right" | "bottom"> {
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  const rootScroller = element === doc.scrollingElement || element === doc.documentElement || element === doc.body;
  if (view && rootScroller) {
    const viewport = view.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? view.innerWidth;
    const height = viewport?.height ?? view.innerHeight;
    return {
      left,
      top,
      right: left + width,
      bottom: top + height,
    };
  }
  return element.getBoundingClientRect();
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
