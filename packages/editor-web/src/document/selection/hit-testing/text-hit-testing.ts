import {
  createSemanticDomTextLayout,
  semanticDomCanonicalOffsetForPoint,
  semanticDomPointForCanonicalOffset,
  type SemanticDomAffinity,
} from "../../geometry/semantic-dom-coordinates.ts";

export interface EditorTextPointHit {
  readonly offset: number;
  readonly affinity: SemanticDomAffinity | null;
}

export function textPointFromPoint(
  mount: HTMLElement,
  clientX: number,
  clientY: number,
  textLength: number,
): EditorTextPointHit | null {
  const hit = createSemanticDomTextLayout(mount).hitTest(clientX, clientY);
  return hit
    ? {
        offset: clampTextOffset(hit.offset, textLength),
        affinity: hit.affinity,
      }
    : null;
}

export function textOffsetFromPoint(
  mount: HTMLElement,
  clientX: number,
  clientY: number,
  textLength: number,
): number | null {
  return (
    textPointFromPoint(mount, clientX, clientY, textLength)?.offset ?? null
  );
}

export function clampTextOffset(offset: number, textLength: number): number {
  const normalized = Number.isFinite(offset) ? Math.trunc(offset) : textLength;
  return Math.min(Math.max(0, normalized), textLength);
}

export function textOffsetFromDomPoint(
  root: HTMLElement,
  node: Node,
  offset: number,
): number | null {
  return semanticDomCanonicalOffsetForPoint(root, node, offset);
}

export function textDomPointForOffset(
  root: HTMLElement,
  offset: number,
  textLength: number,
): { node: Node; offset: number } | null {
  const target = clampTextOffset(offset, textLength);
  return semanticDomPointForCanonicalOffset(root, target);
}
