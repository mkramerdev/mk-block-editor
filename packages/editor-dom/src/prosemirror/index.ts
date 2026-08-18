/** Centralized ProseMirror imports used by editor-dom adapter modules. */

export { Fragment, Schema, DOMParser, DOMSerializer } from "prosemirror-model";
export type {
  DOMOutputSpec,
  Mark,
  MarkSpec,
  Node as PMNode,
  NodeSpec,
} from "prosemirror-model";

export {
  EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  TextSelection,
} from "prosemirror-state";
export type { Command, Transaction } from "prosemirror-state";

export { EditorView, Decoration, DecorationSet } from "prosemirror-view";
export type {
  DirectEditorProps,
  NodeView,
  NodeViewConstructor,
} from "prosemirror-view";

export { keymap } from "prosemirror-keymap";
export { dropCursor } from "prosemirror-dropcursor";
