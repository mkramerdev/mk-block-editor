import type { EditorView } from "../../prosemirror/index.ts";
import {
  canonicalOffsetToProseMirrorPosition,
  proseMirrorPositionToCanonicalOffset,
} from "./offset-codec.ts";

export function domPointToCanonicalOffset(
  view: EditorView,
  node: Node,
  offset: number,
): number | null {
  if (!view.dom.contains(node)) return null;
  try {
    return proseMirrorPositionToCanonicalOffset(
      view.posAtDOM(node, offset),
      view.state,
    );
  } catch {
    return null;
  }
}

export function canonicalPointToDomPoint(
  view: EditorView,
  offset: number,
): { node: Node; offset: number } | null {
  try {
    const point = view.domAtPos(
      canonicalOffsetToProseMirrorPosition(offset, view.state),
    );
    return {
      node: point.node,
      offset: point.offset,
    };
  } catch {
    return null;
  }
}
