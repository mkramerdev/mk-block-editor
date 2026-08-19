import type { EditorLogicalContentOperation } from "@repo/editor-core/operations";
import type { RichTextInlineNodeJson } from "@repo/editor-core/content/rich-text";
import { cloneJsonValue } from "@repo/editor-core/kernel";
import { canonicalOffsetToProseMirrorDocumentPosition } from "../../caret/coordinates/offset-codec.ts";
import {
  Fragment,
  TextSelection,
  type EditorState,
  type Mark,
  type PMNode,
} from "../../prosemirror/index.ts";

/** Applies finalized canonical operations to an existing block-local state. */
export function applyFinalizedContentOperations(
  state: EditorState,
  operations: readonly EditorLogicalContentOperation[],
): EditorState | null {
  let next = state;
  try {
    for (const operation of operations) {
      if (
        operation.kind !== "insertInlineContent" &&
        operation.kind !== "deleteInlineRange" &&
        operation.kind !== "replaceInlineRange"
      ) {
        return null;
      }
      const transaction = next.tr.setMeta("addToHistory", false);
      if (operation.kind === "insertInlineContent") {
        transaction.insert(
          canonicalOffsetToProseMirrorDocumentPosition(
            operation.position.offset,
            next.doc,
          ),
          inlineFragment(next, operation.content),
        );
      } else {
        const from = canonicalOffsetToProseMirrorDocumentPosition(
          operation.range.from.offset,
          next.doc,
        );
        const to = canonicalOffsetToProseMirrorDocumentPosition(
          operation.range.to.offset,
          next.doc,
        );
        if (operation.kind === "deleteInlineRange") {
          transaction.delete(from, to);
        } else {
          transaction.replaceWith(
            from,
            to,
            inlineFragment(next, operation.content),
          );
        }
      }
      next = next.apply(transaction);
    }
    return next;
  } catch {
    return null;
  }
}

export function projectFinalizedTextSelection(
  state: EditorState,
  anchorOffset: number,
  focusOffset: number,
): EditorState {
  const anchor = canonicalOffsetToProseMirrorDocumentPosition(
    anchorOffset,
    state.doc,
  );
  const focus = canonicalOffsetToProseMirrorDocumentPosition(
    focusOffset,
    state.doc,
  );
  const selection = TextSelection.create(state.doc, anchor, focus);
  return selection.eq(state.selection)
    ? state
    : state.apply(
        state.tr.setSelection(selection).setMeta("addToHistory", false),
      );
}

function inlineFragment(
  state: EditorState,
  content: readonly RichTextInlineNodeJson[],
): PMNode["content"] {
  const marks = (node: RichTextInlineNodeJson): readonly Mark[] =>
    (node.marks ?? []).map((mark) =>
      state.schema.mark(
        mark.type,
        mark.attrs === undefined ? undefined : cloneJsonValue(mark.attrs),
      ),
    );
  return Fragment.fromArray(
    content.map((node) => {
      const nodeMarks = marks(node);
      if (node.type === "text") {
        if (typeof node.text !== "string") {
          throw new TypeError("Finalized text node has no string content");
        }
        return state.schema.text(node.text, nodeMarks);
      }
      if (node.type === "hard_break") {
        return state.schema.node(node.type, undefined, undefined, nodeMarks);
      }
      if (typeof node.type !== "string") {
        throw new TypeError("Finalized inline atom has no node type");
      }
      return state.schema.node(
        node.type,
        { metadata: cloneJsonValue(node.metadata) },
        undefined,
        nodeMarks,
      );
    }),
  );
}
