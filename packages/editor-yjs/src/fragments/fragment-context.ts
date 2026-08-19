import type { XmlFragment } from "yjs";
import type { BlockContentDocContext } from "../block-content/doc/contracts.ts";
import { assertBlockContentDocContext } from "../block-content/metadata/validate.ts";
import type { EditorYjsFragmentContext } from "./contracts.ts";

/**
 * Creates a neutral fragment context inside an already validated block content document.
 */
export function createBlockContentFragmentContext(
  context: BlockContentDocContext,
  fragment: XmlFragment,
): EditorYjsFragmentContext {
  assertBlockContentDocContext(context);
  return {
    doc: context.doc,
    fragment,
    getFragment: () => fragment,
  };
}
