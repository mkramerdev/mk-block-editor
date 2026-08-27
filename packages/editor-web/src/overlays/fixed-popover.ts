export interface FixedPopoverPosition {
  top: number;
  left: number;
  placement: "top" | "bottom";
  availableHeight: number;
}

export interface FixedPopoverPlacementOptions {
  width?: number;
  height?: number;
  gap?: number;
  margin?: number;
  viewport?: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
  };
}

export function fixedPopoverPositionForAnchor(
  anchor: HTMLElement,
  ownerWindow: Window,
  options: FixedPopoverPlacementOptions = {},
): FixedPopoverPosition {
  const rect = anchor.getBoundingClientRect();
  const width = options.width ?? 272;
  const height = options.height ?? 240;
  const gap = options.gap ?? 6;
  const margin = options.margin ?? 8;
  const viewport = options.viewport ?? {
    left: 0,
    top: 0,
    width: ownerWindow.innerWidth,
    height: ownerWindow.innerHeight,
  };
  const viewportRight = viewport.left + viewport.width;
  const viewportBottom = viewport.top + viewport.height;
  const spaceBelow = Math.max(0, viewportBottom - rect.bottom - margin - gap);
  const spaceAbove = Math.max(0, rect.top - viewport.top - margin - gap);
  // Fixed popovers choose the vertical side with the greatest usable space.
  // Bottom is the deterministic tie-breaker. Menu height affects only the
  // final coordinate, never side selection.
  const placement = spaceAbove > spaceBelow ? "top" : "bottom";
  const availableHeight = placement === "top" ? spaceAbove : spaceBelow;
  const renderedHeight = Math.min(height, availableHeight);
  const unclampedTop =
    placement === "top" ? rect.top - gap - renderedHeight : rect.bottom + gap;
  return {
    top: clamp(
      unclampedTop,
      viewport.top + margin,
      Math.max(viewport.top + margin, viewportBottom - margin - renderedHeight),
    ),
    left: clamp(
      rect.left,
      viewport.left + margin,
      Math.max(viewport.left + margin, viewportRight - width - margin),
    ),
    placement,
    availableHeight,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
