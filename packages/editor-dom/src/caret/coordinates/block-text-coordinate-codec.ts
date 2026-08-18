import type { TextPoint } from "@repo/editor-core/document";
import {
  TextSelection,
  type EditorState,
  type EditorView,
} from "../../prosemirror/index.ts";
import {
  canonicalPointToDomPoint,
  domPointToCanonicalOffset,
} from "./dom-point-codec.ts";
import {
  canonicalOffsetToProseMirrorPosition,
  proseMirrorPositionToCanonicalOffset,
  readBlockTextContentSize,
} from "./offset-codec.ts";

export interface ProseMirrorTextCoordinateCodec {
  canonicalOffsetToProseMirrorPosition(
    offset: number,
    state: EditorState,
  ): number;
  proseMirrorPositionToCanonicalOffset(
    position: number,
    state: EditorState,
  ): number;
  domPointToCanonicalOffset(
    view: EditorView,
    node: Node,
    offset: number,
  ): number | null;
  canonicalPointToDomPoint(
    view: EditorView,
    offset: number,
  ): { node: Node; offset: number } | null;
  createCaret(state: EditorState, point: TextPoint): TextSelection;
  readContentSize(state: EditorState): number;
}

export const blockTextCoordinateCodec: ProseMirrorTextCoordinateCodec = {
  canonicalOffsetToProseMirrorPosition,
  proseMirrorPositionToCanonicalOffset,
  domPointToCanonicalOffset,
  canonicalPointToDomPoint,
  createCaret: createProseMirrorCaretFromPoint,
  readContentSize: readBlockTextContentSize,
};

export function textPointToProseMirrorPosition(
  point: TextPoint,
  state: EditorState,
): number {
  return blockTextCoordinateCodec.canonicalOffsetToProseMirrorPosition(
    point.offset,
    state,
  );
}

export function createProseMirrorCaretFromPoint(
  state: EditorState,
  point: TextPoint,
): TextSelection {
  const position = textPointToProseMirrorPosition(point, state);
  return TextSelection.create(state.doc, position);
}
