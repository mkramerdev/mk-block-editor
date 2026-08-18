export interface FirstDraftSelectionMenuCaretRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export type FirstDraftSelectionMenuPlacement = "above" | "below";

export interface FirstDraftSelectionMenuViewport {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface FirstDraftSelectionMenuPosition {
  readonly left: number;
  readonly top: number;
  readonly placement: FirstDraftSelectionMenuPlacement;
}

const viewportMargin = 8;
const caretGap = 8;

export function placeFirstDraftSelectionMenu(
  caret: FirstDraftSelectionMenuCaretRect,
  menuSize: { readonly width: number; readonly height: number },
  viewport: FirstDraftSelectionMenuViewport,
  preferredPlacement: FirstDraftSelectionMenuPlacement,
): FirstDraftSelectionMenuPosition | null {
  if (
    menuSize.width <= 0 ||
    menuSize.height <= 0 ||
    viewport.width <= 0 ||
    viewport.height <= 0
  ) {
    return null;
  }
  const viewportBottom = viewport.top + viewport.height;
  const caretBottom = caret.top + caret.height;
  if (caretBottom < viewport.top || caret.top > viewportBottom) return null;
  const minimumLeft = viewport.left + viewportMargin;
  const maximumLeft = Math.max(
    minimumLeft,
    viewport.left + viewport.width - viewportMargin - menuSize.width,
  );
  const left = clamp(
    caret.left + caret.width / 2 - menuSize.width / 2,
    minimumLeft,
    maximumLeft,
  );
  const above = caret.top - caretGap - menuSize.height;
  const below = caretBottom + caretGap;
  const minimumTop = viewport.top + viewportMargin;
  const maximumBottom = viewportBottom - viewportMargin;
  const fits = (top: number): boolean =>
    top >= minimumTop && top + menuSize.height <= maximumBottom;
  const preferredTop = preferredPlacement === "above" ? above : below;
  const oppositePlacement = preferredPlacement === "above" ? "below" : "above";
  const oppositeTop = oppositePlacement === "above" ? above : below;
  const placement = fits(preferredTop)
    ? preferredPlacement
    : fits(oppositeTop)
      ? oppositePlacement
      : preferredPlacement;
  const requestedTop = placement === "above" ? above : below;
  const maximumTop = Math.max(
    minimumTop,
    viewport.top + viewport.height - viewportMargin - menuSize.height,
  );
  return {
    left,
    top: clamp(requestedTop, minimumTop, maximumTop),
    placement,
  };
}

export function deriveFirstDraftSelectionMenuPreferredPlacement(
  anchor: FirstDraftSelectionMenuCaretRect,
  head: FirstDraftSelectionMenuCaretRect,
): FirstDraftSelectionMenuPlacement {
  const sameVisualRow =
    anchor.top < head.top + head.height &&
    head.top < anchor.top + anchor.height;
  if (sameVisualRow) return "above";
  const anchorCenterY = anchor.top + anchor.height / 2;
  const headCenterY = head.top + head.height / 2;
  return headCenterY > anchorCenterY ? "below" : "above";
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}
