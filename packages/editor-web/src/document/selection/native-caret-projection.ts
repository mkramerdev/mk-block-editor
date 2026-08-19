import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorSelectionTextAffinity } from "@repo/editor-react/selection";
import type { TextActivationFocusMode } from "../../runtime/document/text-activation.ts";
import { createSemanticDomTextLayout } from "../geometry/semantic-dom-coordinates.ts";

export interface NativeCaretProjectionRequest {
  readonly root: HTMLElement;
  readonly blockId: BlockId;
  readonly canonicalSelectionRevision: number;
  readonly canonicalTextOffset: number;
  readonly affinity: EditorSelectionTextAffinity | null;
  readonly activationIdentity: symbol;
  readonly focusMode: TextActivationFocusMode;
}

export type NativeCaretProjectionResult =
  | {
      readonly status: "projected";
      readonly nativePoint: { readonly node: Node; readonly offset: number };
    }
  | { readonly status: "rejected" };

/**
 * Projects canonical affinity through the browser Selection only. The
 * semantic DOM remains untouched: a true wrap boundary is approached from
 * the requested visual row using the browser's line-boundary movement.
 */
export function projectNativeCaret(
  request: NativeCaretProjectionRequest,
): NativeCaretProjectionResult {
  const { root, canonicalTextOffset, affinity } = request;
  if (!root.isConnected) return { status: "rejected" };
  const selection = root.ownerDocument.getSelection();
  if (!selection) return { status: "rejected" };
  const layout = createSemanticDomTextLayout(root);
  const offset = Math.min(
    Math.max(0, Math.trunc(canonicalTextOffset)),
    layout.length,
  );
  const directPoint = layout.pointFromCanonicalOffset(offset);
  if (!directPoint) return { status: "rejected" };
  let attemptedAffinityProjection = false;

  if (
    affinity === "backward" &&
    offset > 0 &&
    typeof selection.modify === "function"
  ) {
    const precedingPoint = layout.pointFromCanonicalOffset(offset - 1);
    if (!precedingPoint) return { status: "rejected" };
    attemptedAffinityProjection = true;
    selection.setBaseAndExtent(
      precedingPoint.node,
      precedingPoint.offset,
      precedingPoint.node,
      precedingPoint.offset,
    );
    selection.modify("move", "forward", "lineboundary");
  } else if (
    affinity === "forward" &&
    offset < layout.length &&
    typeof selection.modify === "function"
  ) {
    const followingPoint = layout.pointFromCanonicalOffset(offset + 1);
    if (!followingPoint) return { status: "rejected" };
    attemptedAffinityProjection = true;
    selection.setBaseAndExtent(
      followingPoint.node,
      followingPoint.offset,
      followingPoint.node,
      followingPoint.offset,
    );
    selection.modify("move", "backward", "lineboundary");
  } else {
    selection.setBaseAndExtent(
      directPoint.node,
      directPoint.offset,
      directPoint.node,
      directPoint.offset,
    );
  }

  if (
    attemptedAffinityProjection &&
    !selectionMatchesCanonicalOffset(selection, root, layout, offset)
  ) {
    // Line-boundary movement is a browser affinity probe, not a second source
    // of position truth. If the requested visual side does not exist at this
    // offset, restore the exact semantic point instead of leaving the browser
    // caret at whichever line boundary it chose.
    selection.setBaseAndExtent(
      directPoint.node,
      directPoint.offset,
      directPoint.node,
      directPoint.offset,
    );
    attemptedAffinityProjection = false;
  }

  const node = selection.anchorNode;
  if (
    !node ||
    !selectionMatchesCanonicalOffset(selection, root, layout, offset)
  ) {
    return { status: "rejected" };
  }
  if (
    !attemptedAffinityProjection &&
    (node !== directPoint.node || selection.anchorOffset !== directPoint.offset)
  )
    return { status: "rejected" };
  return {
    status: "projected",
    nativePoint: { node, offset: selection.anchorOffset },
  };
}

function selectionMatchesCanonicalOffset(
  selection: Selection,
  root: HTMLElement,
  layout: ReturnType<typeof createSemanticDomTextLayout>,
  offset: number,
): boolean {
  const node = selection.anchorNode;
  return Boolean(
    selection.isCollapsed &&
    node &&
    (node === root || root.contains(node)) &&
    layout.canonicalOffsetFromPoint(node, selection.anchorOffset) === offset,
  );
}
