import type { Doc, XmlFragment } from "yjs";

export interface EditorYjsFragmentContext {
  readonly doc: Doc;
  readonly fragment: XmlFragment;
  getFragment(): XmlFragment;
}
