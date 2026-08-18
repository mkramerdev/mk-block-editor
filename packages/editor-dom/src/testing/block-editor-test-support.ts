import { asBlockId } from "@repo/editor-core/kernel";
import { blockTextCoordinateCodec } from "../caret/coordinates/block-text-coordinate-codec.ts";
import type { EditorState } from "../prosemirror/index.ts";

export const testBlockId = asBlockId("01890f07-1c00-7000-8000-000000000101");

export function textStart(): number {
  return 1;
}

export function textEnd(state: EditorState): number {
  return 1 + (state.doc.firstChild?.content.size ?? 0);
}

export function withCaret(state: EditorState, position: number): EditorState {
  return state.apply(
    state.tr.setSelection(
      blockTextCoordinateCodec.createCaret(state, {
        blockId: testBlockId,
        offset: position - 1,
      }),
    ),
  );
}
