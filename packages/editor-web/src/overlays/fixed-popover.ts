export interface FixedPopoverPosition {
  top: number;
  left: number;
  placement: "top" | "bottom";
}

export interface FixedPopoverPlacementOptions {
  width?: number;
  height?: number;
  gap?: number;
  margin?: number;
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
  const viewportWidth = ownerWindow.innerWidth;
  const viewportHeight = ownerWindow.innerHeight;
  const spaceBelow = viewportHeight - rect.bottom - margin - gap;
  const spaceAbove = rect.top - margin - gap;
  const openUpward = spaceBelow < height && spaceAbove > spaceBelow;
  const unclampedTop = openUpward ? rect.top - gap - height : rect.bottom + gap;
  return {
    top: clamp(
      unclampedTop,
      margin,
      Math.max(margin, viewportHeight - margin - height),
    ),
    left: clamp(
      rect.left,
      margin,
      Math.max(margin, viewportWidth - width - margin),
    ),
    placement: openUpward ? "top" : "bottom",
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
