import type { BlockDomTextSelectionRange } from "../../block-editor/options/key-behavior.ts";
import type { EditorState, PMNode } from "../../prosemirror/index.ts";

export function inlineAtomDeleteRangeBackward(
  state: EditorState,
): BlockDomTextSelectionRange | null {
  if (!state.selection.empty) return null;
  const $cursor = state.selection.$from;
  if (!$cursor.parent.inlineContent) return null;
  const parentOffset = $cursor.parentOffset;
  const blockStart = $cursor.start($cursor.depth);
  const childBefore = childEndingAt($cursor.parent, parentOffset);
  if (!childBefore) return null;
  if (isInlineAtomNode(childBefore.node)) {
    return { from: blockStart + childBefore.start, to: $cursor.pos };
  }
  if (childBefore.node.isText && childBefore.node.text === " ") {
    const atomBeforeSpace = childEndingAt($cursor.parent, childBefore.start);
    if (atomBeforeSpace && isInlineAtomNode(atomBeforeSpace.node)) {
      return { from: blockStart + atomBeforeSpace.start, to: $cursor.pos };
    }
  }
  return null;
}

export function inlineAtomDeleteRangeForward(
  state: EditorState,
): BlockDomTextSelectionRange | null {
  if (!state.selection.empty) return null;
  const $cursor = state.selection.$from;
  if (!$cursor.parent.inlineContent) return null;
  const parentOffset = $cursor.parentOffset;
  const blockStart = $cursor.start($cursor.depth);
  const childAfter = childStartingAt($cursor.parent, parentOffset);
  if (!childAfter || !isInlineAtomNode(childAfter.node)) return null;
  const range = {
    from: blockStart + childAfter.start,
    to: blockStart + childAfter.end,
  };
  return includeFollowingSingleSpace(state, range);
}

function includeFollowingSingleSpace(
  state: EditorState,
  range: BlockDomTextSelectionRange,
): BlockDomTextSelectionRange {
  const $to = state.doc.resolve(range.to);
  if (!$to.parent.inlineContent) return range;
  const offset = $to.parentOffset;
  const childAfter = childStartingAt($to.parent, offset);
  if (!childAfter?.node.isText || !childAfter.node.text?.startsWith(" "))
    return range;
  return { from: range.from, to: range.to + 1 };
}

function childEndingAt(
  parent: PMNode,
  offset: number,
): { node: PMNode; start: number; end: number } | null {
  const child = parent.childBefore(offset);
  if (!child.node) return null;
  const start = child.offset;
  const end = start + child.node.nodeSize;
  return end === offset ? { node: child.node, start, end } : null;
}

function childStartingAt(
  parent: PMNode,
  offset: number,
): { node: PMNode; start: number; end: number } | null {
  const child = parent.childAfter(offset);
  if (!child.node || child.offset !== offset) return null;
  return {
    node: child.node,
    start: child.offset,
    end: child.offset + child.node.nodeSize,
  };
}

function isInlineAtomNode(node: PMNode): boolean {
  return node.isInline && node.type.spec.atom === true;
}
