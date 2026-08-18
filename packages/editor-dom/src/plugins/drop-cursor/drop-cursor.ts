import { dropCursor, type Plugin } from "../../prosemirror/index.ts";

const blockDropCursorClassName = "editor-block-drop-cursor";

export function createBlockDropCursorPlugin(): Plugin {
  return dropCursor({ width: 2, class: blockDropCursorClassName });
}
