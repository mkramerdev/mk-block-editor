import {
  canonicalOffsetToUtf16Offset,
  canonicalTextLength,
} from "../selection/hit-testing/canonical-text-offset.ts";

export type SemanticDomSegmentKind = "text" | "hard-break" | "inline-atom";

export interface SemanticDomSegment {
  readonly kind: SemanticDomSegmentKind;
  readonly node: Node;
  readonly start: number;
  readonly end: number;
  readonly size: number;
  point(localOffset: number): { readonly node: Node; readonly offset: number };
}

export type SemanticDomAffinity = "backward" | "forward";

export interface SemanticDomRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface SemanticDomPointHit {
  readonly offset: number;
  readonly affinity: SemanticDomAffinity | null;
}

export type SemanticDomVerticalMovement =
  | {
      readonly kind: "moved";
      readonly offset: number;
      readonly preferredX: number;
    }
  | { readonly kind: "boundary"; readonly preferredX: number }
  | { readonly kind: "unavailable"; readonly reason: string };

export type SemanticDomVisualRowMapping =
  | { readonly kind: "mapped"; readonly offset: number }
  | { readonly kind: "unavailable"; readonly reason: string };

/** Projection-neutral browser layout for a mounted canonical text root. */
export interface SemanticDomTextLayout {
  readonly length: number;
  pointFromCanonicalOffset(
    offset: number,
    affinity?: SemanticDomAffinity,
  ): { readonly node: Node; readonly offset: number } | null;
  canonicalOffsetFromPoint(
    node: Node,
    offset: number,
    affinity?: SemanticDomAffinity,
  ): number | null;
  hitTest(clientX: number, clientY: number): SemanticDomPointHit | null;
  caretRect(
    offset: number,
    affinity?: SemanticDomAffinity,
  ): SemanticDomRect | null;
  rangeRects(from: number, to: number): readonly SemanticDomRect[];
  visualRowBoundary(
    offset: number,
    edge: "start" | "end",
    affinity?: SemanticDomAffinity,
  ): number | null;
  moveVertically(
    offset: number,
    direction: "up" | "down",
    preferredX: number | null,
    affinity?: SemanticDomAffinity,
  ): SemanticDomVerticalMovement;
  mapToVisualRow(
    edge: "first" | "last",
    preferredX: number,
  ): SemanticDomVisualRowMapping;
}

export function createSemanticDomTextLayout(
  root: HTMLElement,
): SemanticDomTextLayout {
  const segments = collectSemanticDomSegments(root);
  const length = segments.at(-1)?.end ?? 0;
  const pointFromCanonicalOffset = (
    offset: number,
    affinity: SemanticDomAffinity = "forward",
  ) =>
    semanticDomPointForCanonicalOffsetWithSegments(
      root,
      segments,
      offset,
      affinity,
    );
  const canonicalOffsetFromPoint = (
    node: Node,
    offset: number,
    affinity: SemanticDomAffinity = "forward",
  ) =>
    semanticDomCanonicalOffsetForPointWithSegments(
      root,
      segments,
      node,
      offset,
      affinity,
    );
  const caretRect = (
    offset: number,
    affinity: SemanticDomAffinity = "forward",
  ): SemanticDomRect | null =>
    measureSemanticCaretRect(root, segments, length, offset, affinity);
  const rows = (): readonly SemanticDomVisualRow[] =>
    collectSemanticVisualRows(length, caretRect);
  return {
    length,
    pointFromCanonicalOffset,
    canonicalOffsetFromPoint,
    hitTest(clientX: number, clientY: number): SemanticDomPointHit | null {
      const point = browserCaretPoint(root.ownerDocument, clientX, clientY);
      if (point && (point.node === root || root.contains(point.node))) {
        const offset = canonicalOffsetFromPoint(point.node, point.offset);
        if (offset !== null) {
          const before = caretRect(offset, "backward");
          const after = caretRect(offset, "forward");
          const affinity =
            before &&
            after &&
            !semanticBoundaryInterruptsTextFlow(segments, offset) &&
            !rectsShareVisualRow(before, after)
              ? Math.abs(clientY - rectCenterY(before)) <
                Math.abs(clientY - rectCenterY(after))
                ? "backward"
                : "forward"
              : null;
          return { offset, affinity };
        }
      }
      const visualRows = rows();
      if (visualRows.length === 0)
        return length === 0 ? { offset: 0, affinity: null } : null;
      const row = nearestVisualRow(visualRows, clientY);
      const candidate = row.points.reduce((best, current) =>
        Math.abs(current.rect.left - clientX) <
        Math.abs(best.rect.left - clientX)
          ? current
          : best,
      );
      const hasTwoRows =
        visualRows.filter((candidateRow) =>
          candidateRow.points.some(
            (point) => point.offset === candidate.offset,
          ),
        ).length > 1 &&
        !semanticBoundaryInterruptsTextFlow(segments, candidate.offset);
      return {
        offset: candidate.offset,
        affinity: hasTwoRows ? candidate.affinity : null,
      };
    },
    caretRect,
    rangeRects(from: number, to: number) {
      return measureSemanticRangeRects(root, segments, length, from, to);
    },
    visualRowBoundary(
      offset: number,
      edge: "start" | "end",
      affinity: SemanticDomAffinity = "forward",
    ) {
      const row = visualRowForPoint(rows(), offset, affinity);
      if (!row) return null;
      return edge === "start" ? row.start : row.end;
    },
    moveVertically(
      offset: number,
      direction: "up" | "down",
      preferredX: number | null,
      affinity: SemanticDomAffinity = "forward",
    ): SemanticDomVerticalMovement {
      const visualRows = rows();
      const currentRow = visualRowForPoint(visualRows, offset, affinity);
      const rowIndex = currentRow ? visualRows.indexOf(currentRow) : -1;
      if (rowIndex < 0) {
        return { kind: "unavailable", reason: "current-row-unmeasurable" };
      }
      const current =
        currentRow?.points.find(
          (point) => point.offset === offset && point.affinity === affinity,
        ) ?? currentRow?.points.find((point) => point.offset === offset);
      const resolvedX = preferredX ?? current?.rect.left;
      if (
        resolvedX === null ||
        resolvedX === undefined ||
        !Number.isFinite(resolvedX)
      ) {
        return { kind: "unavailable", reason: "current-caret-unmeasurable" };
      }
      const target = visualRows[rowIndex + (direction === "down" ? 1 : -1)];
      if (!target) return { kind: "boundary", preferredX: resolvedX };
      const candidate = target.points.reduce((best, point) =>
        Math.abs(point.rect.left - resolvedX) <
        Math.abs(best.rect.left - resolvedX)
          ? point
          : best,
      );
      return {
        kind: "moved",
        offset: candidate.offset,
        preferredX: resolvedX,
      };
    },
    mapToVisualRow(
      edge: "first" | "last",
      preferredX: number,
    ): SemanticDomVisualRowMapping {
      const visualRows = rows();
      const row = edge === "first" ? visualRows[0] : visualRows.at(-1);
      if (!row || !Number.isFinite(preferredX)) {
        return { kind: "unavailable", reason: "target-row-unmeasurable" };
      }
      return {
        kind: "mapped",
        offset: row.points.reduce((best, point) =>
          Math.abs(point.rect.left - preferredX) <
          Math.abs(best.rect.left - preferredX)
            ? point
            : best,
        ).offset,
      };
    },
  };
}

export function readSemanticDomCanonicalLength(root: HTMLElement): number {
  const segments = collectSemanticDomSegments(root);
  return segments.at(-1)?.end ?? 0;
}

/** True only when one semantic text offset has two layout-created caret rows. */
export function semanticDomOffsetCanCarrySoftWrapAffinity(
  root: HTMLElement,
  offset: number,
): boolean {
  const segments = collectSemanticDomSegments(root);
  const length = segments.at(-1)?.end ?? 0;
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > length ||
    semanticBoundaryInterruptsTextFlow(segments, offset)
  ) {
    return false;
  }
  const backward = measureSemanticCaretRect(
    root,
    segments,
    length,
    offset,
    "backward",
  );
  const forward = measureSemanticCaretRect(
    root,
    segments,
    length,
    offset,
    "forward",
  );
  return Boolean(
    backward && forward && !rectsShareVisualRow(backward, forward),
  );
}

function semanticBoundaryInterruptsTextFlow(
  segments: readonly SemanticDomSegment[],
  offset: number,
): boolean {
  return segments.some(
    (segment) =>
      segment.kind !== "text" &&
      offset >= segment.start &&
      offset <= segment.end,
  );
}

export function semanticDomPointForCanonicalOffset(
  root: HTMLElement,
  offset: number,
): { readonly node: Node; readonly offset: number } | null {
  return semanticDomPointForCanonicalOffsetWithSegments(
    root,
    collectSemanticDomSegments(root),
    offset,
    "forward",
  );
}

function semanticDomPointForCanonicalOffsetWithSegments(
  root: HTMLElement,
  segments: readonly SemanticDomSegment[],
  offset: number,
  affinity: SemanticDomAffinity,
): { readonly node: Node; readonly offset: number } | null {
  if (!Number.isSafeInteger(offset) || offset < 0) return null;
  const length = segments.at(-1)?.end ?? 0;
  if (offset > length) return null;
  if (segments.length === 0) return { node: root, offset: 0 };
  for (const [index, segment] of segments.entries()) {
    if (offset < segment.end) return segment.point(offset - segment.start);
    if (offset === segment.end) {
      const next = segments[index + 1];
      return affinity === "forward" && next?.start === offset
        ? next.point(0)
        : segment.point(segment.size);
    }
  }
  return null;
}

export function semanticDomCanonicalOffsetForPoint(
  root: HTMLElement,
  target: Node,
  targetOffset: number,
  _affinity: SemanticDomAffinity = "forward",
): number | null {
  void _affinity;
  if (target !== root && !root.contains(target)) return null;
  const state = { offset: 0, result: null as number | null };

  const visit = (node: Node): void => {
    if (state.result !== null) return;
    if (node === target) {
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.textContent ?? "";
        const utf16Offset = clampDomOffset(targetOffset, text.length);
        state.result =
          state.offset + canonicalTextLength(text.slice(0, utf16Offset));
        return;
      }
      const childOffset = clampDomOffset(targetOffset, node.childNodes.length);
      for (let index = 0; index < childOffset; index += 1) {
        const child = node.childNodes[index];
        if (child) state.offset += semanticNodeSize(child);
      }
      state.result = state.offset;
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      state.offset += canonicalTextLength(node.textContent ?? "");
      return;
    }
    if (!isElement(node)) return;
    if (isLayoutSentinel(node)) return;
    if (isSemanticHardBreak(node) || isInlineAtom(node)) {
      if (node.contains(target)) {
        state.result = state.offset + (targetOffset > 0 ? 1 : 0);
      } else {
        state.offset += 1;
      }
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  };

  visit(root);
  return state.result;
}

function semanticDomCanonicalOffsetForPointWithSegments(
  root: HTMLElement,
  segments: readonly SemanticDomSegment[],
  target: Node,
  targetOffset: number,
  affinity: SemanticDomAffinity,
): number | null {
  if (target !== root && !root.contains(target)) return null;
  if (target.nodeType === Node.TEXT_NODE) {
    const segment = segments.find((candidate) => candidate.node === target);
    if (segment?.kind === "text") {
      const text = target.textContent ?? "";
      const utf16Offset = clampDomOffset(targetOffset, text.length);
      return segment.start + canonicalTextLength(text.slice(0, utf16Offset));
    }
  }
  return semanticDomCanonicalOffsetForPoint(
    root,
    target,
    targetOffset,
    affinity,
  );
}

interface SemanticDomVisualPoint {
  readonly offset: number;
  readonly affinity: SemanticDomAffinity;
  readonly rect: SemanticDomRect;
}

interface SemanticDomVisualRow {
  readonly top: number;
  readonly bottom: number;
  readonly start: number;
  readonly end: number;
  readonly points: readonly SemanticDomVisualPoint[];
}

export function collectSemanticVisualRows(
  length: number,
  readCaret: (
    offset: number,
    affinity?: SemanticDomAffinity,
  ) => SemanticDomRect | null,
): readonly SemanticDomVisualRow[] {
  const points: SemanticDomVisualPoint[] = [];
  for (let offset = 0; offset <= length; offset += 1) {
    for (const affinity of ["backward", "forward"] as const) {
      const rect = readCaret(offset, affinity);
      if (!rect) continue;
      if (
        points.some(
          (point) =>
            point.offset === offset &&
            rectsShareVisualPosition(point.rect, rect),
        )
      )
        continue;
      points.push({ offset, affinity, rect });
    }
  }
  points.sort(
    (left, right) =>
      left.rect.top - right.rect.top ||
      left.rect.left - right.rect.left ||
      left.offset - right.offset,
  );
  const rows: Array<{
    top: number;
    bottom: number;
    points: SemanticDomVisualPoint[];
  }> = [];
  for (const point of points) {
    const center = rectCenterY(point.rect);
    const row = rows.find(
      (candidate) =>
        center >= candidate.top - 1 && center <= candidate.bottom + 1,
    );
    if (row) {
      row.top = Math.min(row.top, point.rect.top);
      row.bottom = Math.max(row.bottom, point.rect.top + point.rect.height);
      row.points.push(point);
    } else {
      rows.push({
        top: point.rect.top,
        bottom: point.rect.top + point.rect.height,
        points: [point],
      });
    }
  }
  return rows.map((row) => {
    row.points.sort(
      (left, right) =>
        left.rect.left - right.rect.left || left.offset - right.offset,
    );
    return {
      top: row.top,
      bottom: row.bottom,
      start: Math.min(...row.points.map((point) => point.offset)),
      end: Math.max(...row.points.map((point) => point.offset)),
      points: row.points,
    };
  });
}

function measureSemanticCaretRect(
  root: HTMLElement,
  segments: readonly SemanticDomSegment[],
  length: number,
  offset: number,
  affinity: SemanticDomAffinity,
): SemanticDomRect | null {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > length)
    return null;
  if (!readHorizontalInlineDirection(root, root)) return null;
  if (length === 0) return elementContentCaret(root, false);

  const adjacentOffset = affinity === "forward" ? offset : offset - 1;
  if (adjacentOffset >= 0 && adjacentOffset < length) {
    const adjacent = measureSemanticUnitCaret(
      root,
      segments,
      adjacentOffset,
      affinity === "forward" ? "leading" : "trailing",
    );
    if (adjacent.kind === "unsupported") return null;
    if (adjacent.rect) return adjacent.rect;
  }

  // At document start and end only one adjacent semantic unit exists. Both
  // affinity requests intentionally resolve to that unit's endpoint.
  const endpointOffset =
    offset === 0 ? 0 : offset === length ? length - 1 : null;
  if (endpointOffset !== null && endpointOffset !== adjacentOffset) {
    const endpoint = measureSemanticUnitCaret(
      root,
      segments,
      endpointOffset,
      offset === 0 ? "leading" : "trailing",
    );
    if (endpoint.kind === "unsupported") return null;
    if (endpoint.rect) return endpoint.rect;
  }

  // A collapsed Range is reserved for geometry that has no representable
  // adjacent unit endpoint, such as the position after a terminal hard break.
  return (
    measureCollapsedCaretFallback(root, segments, offset, affinity) ??
    elementContentCaret(root, offset === length)
  );
}

type SemanticInlineEdge = "leading" | "trailing";

type SemanticUnitCaretMeasurement =
  | { readonly kind: "measured"; readonly rect: SemanticDomRect | null }
  | { readonly kind: "unsupported" };

function measureSemanticUnitCaret(
  root: HTMLElement,
  segments: readonly SemanticDomSegment[],
  unitOffset: number,
  edge: SemanticInlineEdge,
): SemanticUnitCaretMeasurement {
  const segment = segments.find(
    (candidate) => unitOffset >= candidate.start && unitOffset < candidate.end,
  );
  if (!segment) return { kind: "measured", rect: null };
  const direction = readHorizontalInlineDirection(root, segment.node);
  if (!direction) return { kind: "unsupported" };

  if (segment.kind === "hard-break") {
    if (edge === "trailing") {
      const following = segments.find(
        (candidate) => candidate.start === segment.end,
      );
      if (!following) return { kind: "measured", rect: null };
      return measureSemanticUnitCaret(
        root,
        segments,
        following.start,
        "leading",
      );
    }
    const hardBreak = measureSemanticHardBreakRect(root, segments, segment);
    return {
      kind: "measured",
      rect: hardBreak
        ? toLogicalCaretRect(hardBreak, "leading", direction)
        : null,
    };
  }

  const fragments = measureUnitRects(
    root,
    segments,
    unitOffset,
    unitOffset + 1,
  );
  const fragment = edge === "leading" ? fragments[0] : fragments.at(-1);
  return {
    kind: "measured",
    rect: fragment ? toLogicalCaretRect(fragment, edge, direction) : null,
  };
}

function measureCollapsedCaretFallback(
  root: HTMLElement,
  segments: readonly SemanticDomSegment[],
  offset: number,
  affinity: SemanticDomAffinity,
): SemanticDomRect | null {
  const point = semanticDomPointForCanonicalOffsetWithSegments(
    root,
    segments,
    offset,
    affinity,
  );
  if (!point) return null;
  const range = root.ownerDocument.createRange();
  try {
    range.setStart(point.node, point.offset);
    range.collapse(true);
    const direct = firstUsableRect(range);
    return direct ? physicalCaretRect(direct, direct.left) : null;
  } catch {
    return null;
  } finally {
    range.detach();
  }
}

function measureSemanticRangeRects(
  root: HTMLElement,
  segments: readonly SemanticDomSegment[],
  length: number,
  from: number,
  to: number,
): readonly SemanticDomRect[] {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to <= from ||
    to > length
  )
    return [];
  const measured: SemanticDomRect[] = [];
  const start = semanticDomPointForCanonicalOffsetWithSegments(
    root,
    segments,
    from,
    "forward",
  );
  const end = semanticDomPointForCanonicalOffsetWithSegments(
    root,
    segments,
    to,
    "backward",
  );
  const range = root.ownerDocument.createRange();
  try {
    if (start && end) {
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      for (const rect of readRects(range))
        if (rect.width > 0 && rect.height > 0) measured.push(rect);
    }
  } finally {
    range.detach();
  }
  for (const segment of segments) {
    if (
      segment.kind !== "hard-break" ||
      segment.start < from ||
      segment.end > to
    )
      continue;
    const rect = measureSemanticHardBreakRect(root, segments, segment);
    if (!rect) continue;
    if (
      !measured.some((candidate) => rectsShareVisualPosition(candidate, rect))
    )
      measured.push(rect);
  }
  return measured.sort(
    (left, right) => left.top - right.top || left.left - right.left,
  );
}

function measureSemanticHardBreakRect(
  root: HTMLElement,
  segments: readonly SemanticDomSegment[],
  segment: SemanticDomSegment,
): SemanticDomRect | null {
  const dpr = Math.max(
    1,
    root.ownerDocument.defaultView?.devicePixelRatio ?? 1,
  );
  const minimumWidth = 1 / dpr;
  const nodeRect =
    segment.node instanceof Element
      ? rectFromDom(segment.node.getBoundingClientRect())
      : null;
  if (nodeRect && nodeRect.height > 0) {
    return { ...nodeRect, width: Math.max(minimumWidth, nodeRect.width) };
  }
  const index = segments.indexOf(segment);
  let precedingBreaks = 0;
  let precedingText: SemanticDomSegment | null = null;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const previous = segments[cursor]!;
    if (previous.kind === "hard-break") {
      precedingBreaks += 1;
      continue;
    }
    if (previous.kind === "text") precedingText = previous;
    break;
  }
  const previous = precedingText
    ? measureUnitRect(root, segments, precedingText.end - 1, precedingText.end)
    : null;
  const rootRect = rectFromDom(root.getBoundingClientRect());
  const computed = root.ownerDocument.defaultView?.getComputedStyle(
    segment.node.parentElement ?? root,
  );
  const pixels = (value?: string) =>
    value && value !== "normal" ? Number.parseFloat(value) || 0 : 0;
  const lineHeight = Math.max(
    1,
    pixels(computed?.lineHeight) ||
      pixels(computed?.fontSize) * 1.2 ||
      previous?.height ||
      1,
  );
  const contentLeft =
    (rootRect?.left ?? 0) +
    pixels(computed?.paddingLeft) +
    pixels(computed?.borderLeftWidth);
  const contentTop =
    (rootRect?.top ?? previous?.top ?? 0) +
    pixels(computed?.paddingTop) +
    pixels(computed?.borderTopWidth);
  return {
    left:
      precedingBreaks === 0 && previous
        ? previous.left + previous.width
        : contentLeft,
    top: (previous?.top ?? contentTop) + precedingBreaks * lineHeight,
    width: minimumWidth,
    height: previous?.height || lineHeight,
  };
}

function measureUnitRect(
  root: HTMLElement,
  segments: readonly SemanticDomSegment[],
  from: number,
  to: number,
): SemanticDomRect | null {
  return measureUnitRects(root, segments, from, to)[0] ?? null;
}

function measureUnitRects(
  root: HTMLElement,
  segments: readonly SemanticDomSegment[],
  from: number,
  to: number,
): readonly SemanticDomRect[] {
  const start = semanticDomPointForCanonicalOffsetWithSegments(
    root,
    segments,
    from,
    "forward",
  );
  const end = semanticDomPointForCanonicalOffsetWithSegments(
    root,
    segments,
    to,
    "backward",
  );
  if (!start || !end) return [];
  const range = root.ownerDocument.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
    const measured = readRects(range);
    const renderedFragments = measured.filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    return renderedFragments.length > 0
      ? renderedFragments
      : measured.filter((rect) => rect.width > 0 || rect.height > 0);
  } finally {
    range.detach();
  }
}

function browserCaretPoint(
  doc: Document,
  x: number,
  y: number,
): { node: Node; offset: number } | null {
  const range = (
    doc as Document & {
      caretRangeFromPoint?: (x: number, y: number) => Range | null;
    }
  ).caretRangeFromPoint?.(x, y);
  if (range) return { node: range.startContainer, offset: range.startOffset };
  const position = doc.caretPositionFromPoint?.(x, y);
  return position
    ? { node: position.offsetNode, offset: position.offset }
    : null;
}

function readRects(range: Range): SemanticDomRect[] {
  return typeof range.getClientRects === "function"
    ? Array.from(range.getClientRects())
        .map(rectFromDom)
        .filter((rect): rect is SemanticDomRect => rect !== null)
    : [];
}

function firstUsableRect(range: Range): SemanticDomRect | null {
  return (
    readRects(range).find((rect) => rect.width > 0 || rect.height > 0) ?? null
  );
}

function rectFromDom(
  rect: Pick<DOMRect, "left" | "top" | "width" | "height">,
): SemanticDomRect | null {
  return [rect.left, rect.top, rect.width, rect.height].every(
    Number.isFinite,
  ) &&
    rect.width >= 0 &&
    rect.height >= 0
    ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
    : null;
}

function toLogicalCaretRect(
  rect: SemanticDomRect,
  edge: SemanticInlineEdge,
  direction: "ltr" | "rtl",
): SemanticDomRect {
  const useRight = (edge === "leading") === (direction === "rtl");
  return physicalCaretRect(rect, useRight ? rect.left + rect.width : rect.left);
}

function physicalCaretRect(
  rect: SemanticDomRect,
  left: number,
): SemanticDomRect {
  return {
    left,
    top: rect.top,
    width: 1,
    height: Math.max(1, rect.height),
  };
}

function readHorizontalInlineDirection(
  root: HTMLElement,
  node: Node,
): "ltr" | "rtl" | null {
  const element = node instanceof Element ? node : (node.parentElement ?? root);
  const computed = root.ownerDocument.defaultView?.getComputedStyle(element);
  const writingMode = computed?.writingMode || "horizontal-tb";
  if (writingMode !== "horizontal-tb") return null;
  return computed?.direction === "rtl" ? "rtl" : "ltr";
}

function elementContentCaret(
  root: HTMLElement,
  end: boolean,
): SemanticDomRect | null {
  const rect = rectFromDom(root.getBoundingClientRect());
  if (!rect || rect.height <= 0) return null;
  const computed = root.ownerDocument.defaultView?.getComputedStyle(root);
  const px = (value?: string) =>
    value && value !== "normal" ? Number.parseFloat(value) || 0 : 0;
  const lineHeight = Math.max(
    1,
    px(computed?.lineHeight) || px(computed?.fontSize) * 1.2 || rect.height,
  );
  return {
    left: end ? rect.left + rect.width : rect.left + px(computed?.paddingLeft),
    top: rect.top + px(computed?.paddingTop),
    width: 1,
    height: Math.min(rect.height, lineHeight),
  };
}

function nearestVisualRow(
  rows: readonly SemanticDomVisualRow[],
  y: number,
): SemanticDomVisualRow {
  return rows.reduce((best, row) =>
    Math.abs((row.top + row.bottom) / 2 - y) <
    Math.abs((best.top + best.bottom) / 2 - y)
      ? row
      : best,
  );
}

function visualRowForPoint(
  rows: readonly SemanticDomVisualRow[],
  offset: number,
  affinity: SemanticDomAffinity,
): SemanticDomVisualRow | null {
  return (
    rows.find((row) =>
      row.points.some(
        (point) => point.offset === offset && point.affinity === affinity,
      ),
    ) ??
    rows.find((row) => rowContainsOffset(row, offset)) ??
    null
  );
}

function rowContainsOffset(row: SemanticDomVisualRow, offset: number): boolean {
  return row.points.some((point) => point.offset === offset);
}

function rectCenterY(rect: SemanticDomRect): number {
  return rect.top + rect.height / 2;
}
function rectsShareVisualPosition(
  left: SemanticDomRect,
  right: SemanticDomRect,
): boolean {
  return (
    Math.abs(left.left - right.left) <= 0.5 &&
    Math.abs(rectCenterY(left) - rectCenterY(right)) <=
      Math.max(1, Math.min(left.height, right.height) / 3)
  );
}

function rectsShareVisualRow(
  left: SemanticDomRect,
  right: SemanticDomRect,
): boolean {
  return (
    Math.abs(rectCenterY(left) - rectCenterY(right)) <=
    Math.max(1, Math.min(left.height, right.height) / 3)
  );
}

export function collectSemanticDomSegments(
  root: HTMLElement,
): readonly SemanticDomSegment[] {
  const segments: SemanticDomSegment[] = [];
  let offset = 0;
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      const size = canonicalTextLength(text);
      if (size === 0) return;
      const start = offset;
      offset += size;
      segments.push({
        kind: "text",
        node,
        start,
        end: offset,
        size,
        point(localOffset) {
          return {
            node,
            offset: canonicalOffsetToUtf16Offset(text, localOffset),
          };
        },
      });
      return;
    }
    if (!isElement(node) || isLayoutSentinel(node)) return;
    const kind = isSemanticHardBreak(node)
      ? "hard-break"
      : isInlineAtom(node)
        ? "inline-atom"
        : null;
    if (kind) {
      const parent = node.parentNode;
      if (!parent) return;
      const index = Array.prototype.indexOf.call(
        parent.childNodes,
        node,
      ) as number;
      const start = offset;
      offset += 1;
      segments.push({
        kind,
        node,
        start,
        end: offset,
        size: 1,
        point(localOffset) {
          return { node: parent, offset: index + (localOffset > 0 ? 1 : 0) };
        },
      });
      return;
    }
    for (const child of Array.from(node.childNodes)) visit(child);
  };
  for (const child of Array.from(root.childNodes)) visit(child);
  return segments;
}

function semanticNodeSize(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) {
    return canonicalTextLength(node.textContent ?? "");
  }
  if (!isElement(node) || isLayoutSentinel(node)) return 0;
  if (isSemanticHardBreak(node) || isInlineAtom(node)) return 1;
  return Array.from(node.childNodes).reduce(
    (size, child) => size + semanticNodeSize(child),
    0,
  );
}

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

function isSemanticHardBreak(node: Element): boolean {
  return node.tagName === "BR" && !isLayoutSentinel(node);
}

function isLayoutSentinel(node: Element): boolean {
  return (
    node.tagName === "BR" &&
    (node.classList.contains("ProseMirror-trailingBreak") ||
      node.matches('[data-editor-read-trailing-break="true"]'))
  );
}

function isInlineAtom(node: Element): boolean {
  return node.matches("[data-inline-atom-type], [data-editor-inline-atom]");
}

function clampDomOffset(offset: number, max: number): number {
  const normalized = Number.isFinite(offset) ? Math.trunc(offset) : max;
  return Math.min(Math.max(0, normalized), max);
}
