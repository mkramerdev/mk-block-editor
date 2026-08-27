export type EditorScrollAlignment = "start" | "end" | "nearest";

export interface EditorViewportRectLike {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface EditorScrollAxisOptions {
  readonly alignment: EditorScrollAlignment;
  readonly margin: number;
}

export function resolveEditorScrollRoot(list: HTMLElement): HTMLElement {
  const view = list.ownerDocument.defaultView;
  for (
    let current: HTMLElement | null = list;
    current;
    current = current.parentElement
  ) {
    const style = view?.getComputedStyle(current);
    const overflow = `${style?.overflowY ?? ""} ${style?.overflow ?? ""} ${current.style.overflowY} ${current.style.overflow}`;
    if (/auto|scroll|overlay/.test(overflow)) return current;
  }
  const scrollingElement = list.ownerDocument.scrollingElement;
  if (scrollingElement instanceof HTMLElement) return scrollingElement;
  return list.ownerDocument.documentElement;
}

export function scrollEditorViewportRectIntoView(
  scrollRoot: HTMLElement,
  targetRect: EditorViewportRectLike,
  options: {
    readonly block?: EditorScrollAxisOptions;
    readonly inline?: EditorScrollAxisOptions;
  },
): boolean {
  const viewportRect = readEditorScrollViewportRect(scrollRoot);
  if (!isFiniteViewportRect(targetRect) || !isFiniteViewportRect(viewportRect))
    return false;
  let changed = false;
  if (options.block) {
    const deltaY = axisDeltaToRevealRange({
      start: targetRect.top,
      end: targetRect.top + targetRect.height,
      viewportStart: viewportRect.top,
      viewportEnd: viewportRect.top + viewportRect.height,
      margin: options.block.margin,
      alignment: options.block.alignment,
    });
    if (deltaY !== 0) {
      const next = clampScrollOffset(
        scrollRoot.scrollTop + deltaY,
        maxScrollTop(scrollRoot),
      );
      if (next !== scrollRoot.scrollTop) {
        scrollRoot.scrollTop = next;
        changed = true;
      }
    }
  }
  if (options.inline) {
    const deltaX = axisDeltaToRevealRange({
      start: targetRect.left,
      end: targetRect.left + targetRect.width,
      viewportStart: viewportRect.left,
      viewportEnd: viewportRect.left + viewportRect.width,
      margin: options.inline.margin,
      alignment: options.inline.alignment,
    });
    if (deltaX !== 0) {
      const next = clampScrollOffset(
        scrollRoot.scrollLeft + deltaX,
        maxScrollLeft(scrollRoot),
      );
      if (next !== scrollRoot.scrollLeft) {
        scrollRoot.scrollLeft = next;
        changed = true;
      }
    }
  }
  return changed;
}

export function boundedEditorScrollMargin(
  viewportSize: number,
  maximum: number,
): number {
  if (!Number.isFinite(viewportSize) || viewportSize <= 0) return 0;
  return Math.min(maximum, Math.max(0, viewportSize / 3));
}

export function readEditorScrollViewportRect(
  scrollRoot: HTMLElement,
): EditorViewportRectLike {
  const doc = scrollRoot.ownerDocument;
  const view = doc.defaultView;
  const rootScroller =
    scrollRoot === doc.scrollingElement ||
    scrollRoot === doc.documentElement ||
    scrollRoot === doc.body;
  if (view && rootScroller) {
    const viewport = view.visualViewport;
    const left = viewport?.offsetLeft ?? 0;
    const top = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? view.innerWidth;
    const height = viewport?.height ?? view.innerHeight;
    return { left, top, width, height };
  }
  const rect = scrollRoot.getBoundingClientRect();
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function axisDeltaToRevealRange({
  start,
  end,
  viewportStart,
  viewportEnd,
  margin,
  alignment,
}: {
  start: number;
  end: number;
  viewportStart: number;
  viewportEnd: number;
  margin: number;
  alignment: EditorScrollAlignment;
}): number {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(viewportStart) ||
    !Number.isFinite(viewportEnd)
  )
    return 0;
  if (viewportEnd <= viewportStart) return 0;
  const boundedMargin = Math.min(
    Math.max(0, margin),
    Math.max(0, (viewportEnd - viewportStart) / 2),
  );
  const revealStart = viewportStart + boundedMargin;
  const revealEnd = viewportEnd - boundedMargin;
  const targetSize = Math.max(0, end - start);
  const revealSize = Math.max(1, revealEnd - revealStart);
  if (targetSize > revealSize) {
    return alignedScrollDelta(start, end, revealStart, revealEnd, alignment);
  }
  if (start < revealStart) return start - revealStart;
  if (end > revealEnd) return end - revealEnd;
  return 0;
}

function alignedScrollDelta(
  start: number,
  end: number,
  revealStart: number,
  revealEnd: number,
  alignment: EditorScrollAlignment,
): number {
  const startDelta = start - revealStart;
  const endDelta = end - revealEnd;
  if (alignment === "start") return startDelta;
  if (alignment === "end") return endDelta;
  return Math.abs(startDelta) <= Math.abs(endDelta) ? startDelta : endDelta;
}

function isFiniteViewportRect(rect: EditorViewportRectLike): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    Number.isFinite(rect.width) &&
    Number.isFinite(rect.height) &&
    (rect.width > 0 || rect.height > 0)
  );
}

function maxScrollTop(element: HTMLElement): number {
  return Math.max(0, element.scrollHeight - element.clientHeight);
}

function maxScrollLeft(element: HTMLElement): number {
  return Math.max(0, element.scrollWidth - element.clientWidth);
}

function clampScrollOffset(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(0, value), max);
}
