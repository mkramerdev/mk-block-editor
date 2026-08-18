import type { EditorState, PMNode } from "../../prosemirror/index.ts";

export function readBlockTextContentSize(state: EditorState): number {
  return readDocumentTextContentSize(state.doc);
}

export function readDocumentTextContentSize(doc: PMNode): number {
  const textBlock = doc.firstChild;
  if (!textBlock) return 0;
  let size = 0;
  textBlock.forEach((node) => {
    size += node.isText ? Array.from(node.text ?? "").length : 1;
  });
  return size;
}

export function canonicalOffsetToProseMirrorPosition(
  offset: number,
  state: EditorState,
): number {
  return canonicalOffsetToProseMirrorDocumentPosition(offset, state.doc);
}

export function canonicalOffsetToProseMirrorDocumentPosition(
  offset: number,
  doc: PMNode,
): number {
  const textBlock = doc.firstChild;
  if (!textBlock) return 1;
  const target = clampTextOffset(offset, readDocumentTextContentSize(doc));
  let canonicalCursor = 0;
  let proseMirrorCursor = 0;
  let resolved: number | null = null;
  textBlock.forEach((node) => {
    if (resolved !== null) return;
    const canonicalSize = node.isText ? Array.from(node.text ?? "").length : 1;
    if (target <= canonicalCursor + canonicalSize) {
      const localCanonicalOffset = target - canonicalCursor;
      const localProseMirrorOffset = node.isText
        ? Array.from(node.text ?? "")
            .slice(0, localCanonicalOffset)
            .join("").length
        : Math.min(localCanonicalOffset, 1);
      resolved = 1 + proseMirrorCursor + localProseMirrorOffset;
      return;
    }
    canonicalCursor += canonicalSize;
    proseMirrorCursor += node.nodeSize;
  });
  return resolved ?? 1 + textBlock.content.size;
}

export function proseMirrorPositionToCanonicalOffset(
  position: number,
  state: EditorState,
): number {
  return proseMirrorDocumentPositionToCanonicalOffset(position, state.doc);
}

export function proseMirrorDocumentPositionToCanonicalOffset(
  position: number,
  doc: PMNode,
): number {
  const textBlock = doc.firstChild;
  if (!textBlock) return 0;
  const target = clampTextOffset(position - 1, textBlock.content.size);
  let proseMirrorCursor = 0;
  let canonicalCursor = 0;
  let resolved: number | null = null;
  textBlock.forEach((node) => {
    if (resolved !== null) return;
    const proseMirrorSize = node.nodeSize;
    if (target <= proseMirrorCursor + proseMirrorSize) {
      const localProseMirrorOffset = target - proseMirrorCursor;
      resolved =
        canonicalCursor +
        (node.isText
          ? Array.from((node.text ?? "").slice(0, localProseMirrorOffset))
              .length
          : Math.min(localProseMirrorOffset, 1));
      return;
    }
    proseMirrorCursor += proseMirrorSize;
    canonicalCursor += node.isText ? Array.from(node.text ?? "").length : 1;
  });
  return resolved ?? readDocumentTextContentSize(doc);
}

function clampTextOffset(offset: number, maxOffset: number): number {
  if (!Number.isFinite(offset)) return maxOffset;
  return Math.min(Math.max(0, Math.trunc(offset)), maxOffset);
}
