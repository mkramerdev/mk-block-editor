import type { BlockId } from "@repo/editor-core/kernel";
import { richInlineTextUnitCount } from "@repo/editor-core/content";
import { isEditorSelectionTextAnchor } from "../anchors/text-anchor.ts";
import {
  keyboardSelectionDirectionFromKey,
  type EditorKeyboardSelectionDirection,
  type EditorKeyboardSelectionKey,
} from "./keyboard.ts";
import type {
  MapEditorKeyboardSelectionVisualLineOptions,
  MapEditorKeyboardSelectionVisualLineResult,
  MoveEditorKeyboardSelectionVisualLineOptions,
  MoveEditorKeyboardSelectionVisualLineResult,
} from "./visual-line-navigation.ts";
import {
  canTargetEditorBlockSelection,
  readEditorBlockSelectionTarget,
  type EditorBlockSelectionTarget,
  type EditorSelectionGraphReader,
} from "../graph/reader.ts";
import { findAdjacentEditorSelectionTarget } from "../graph/traversal.ts";
import { normalizeSelectionPointForGraph } from "../normalization/normalize-point.ts";
import type {
  EditorLogicalSelectionPoint,
  EditorSelectionFailureReason,
  EditorSelectionTextAffinity,
} from "../model/types.ts";

export interface CreateEditorKeyboardSelectionPointOptions {
  target: EditorBlockSelectionTarget;
  textOffset: number;
  affinity: EditorSelectionTextAffinity | null;
}

export interface MoveEditorKeyboardSelectionEndpointOptions {
  key: EditorKeyboardSelectionKey;
  focus: EditorLogicalSelectionPoint;
  graph: EditorSelectionGraphReader;
  readText(
    blockId: BlockId,
    target: EditorBlockSelectionTarget,
  ): string | null | undefined;
  createPoint(
    options: CreateEditorKeyboardSelectionPointOptions,
  ): EditorLogicalSelectionPoint | null;
  moveVisualLine?(
    options: MoveEditorKeyboardSelectionVisualLineOptions,
  ): MoveEditorKeyboardSelectionVisualLineResult;
  mapToVisualLine?(
    options: MapEditorKeyboardSelectionVisualLineOptions,
  ): MapEditorKeyboardSelectionVisualLineResult;
  canNavigateTo?(target: EditorBlockSelectionTarget): boolean;
  preferredX?: number | null;
  unit?: "grapheme" | "word";
}

export type MoveEditorKeyboardSelectionEndpointResult =
  | {
      ok: true;
      point: EditorLogicalSelectionPoint;
      preferredX: number | null;
    }
  | MoveEditorKeyboardSelectionEndpointFailure;

export interface MoveEditorKeyboardSelectionEndpointFailure {
  ok: false;
  reason: EditorSelectionFailureReason | "no-movement" | "geometry-unavailable";
  blockId?: BlockId;
  message?: string;
  preferredX?: number | null;
}

export function moveEditorKeyboardSelectionEndpoint({
  key,
  focus,
  graph,
  readText,
  createPoint,
  moveVisualLine,
  mapToVisualLine,
  canNavigateTo,
  preferredX = null,
  unit = "grapheme",
}: MoveEditorKeyboardSelectionEndpointOptions): MoveEditorKeyboardSelectionEndpointResult {
  const direction = keyboardSelectionDirectionFromKey(key);
  const validation = validateKeyboardSelectionFocus(focus, graph);
  if (!validation.ok) return validation;

  const normalizedFocus = validation.point;
  const target = validation.target;
  if (direction === "left" || direction === "right") {
    if (key === "Home" || key === "End") {
      const text = readBlockText(target, readText);
      if (!text.ok) return text;
      const visualLine = moveVisualLine?.({
        point: normalizedFocus,
        target,
        direction: key === "Home" ? "start" : "end",
        text: text.text,
        preferredX: null,
      });
      return createMovedPoint(
        target,
        (visualLine?.kind === "moved" ? visualLine.textOffset : undefined) ??
          (key === "Home" ? 0 : richInlineTextUnitCount(text.text)),
        key === "Home" ? "backward" : "forward",
        createPoint,
        null,
      );
    }
    return moveHorizontalEndpoint({
      focus: normalizedFocus,
      target,
      graph,
      direction,
      readText,
      createPoint,
      canNavigateTo,
      unit,
    });
  }

  return moveVerticalEndpoint({
    focus: normalizedFocus,
    target,
    graph,
    direction,
    readText,
    createPoint,
    moveVisualLine,
    mapToVisualLine,
    canNavigateTo,
    preferredX,
  });
}

function moveHorizontalEndpoint({
  focus,
  target,
  graph,
  direction,
  readText,
  createPoint,
  canNavigateTo,
  unit,
}: {
  focus: EditorLogicalSelectionPoint;
  target: EditorBlockSelectionTarget;
  graph: EditorSelectionGraphReader;
  direction: Extract<EditorKeyboardSelectionDirection, "left" | "right">;
  readText: MoveEditorKeyboardSelectionEndpointOptions["readText"];
  createPoint: MoveEditorKeyboardSelectionEndpointOptions["createPoint"];
  canNavigateTo: MoveEditorKeyboardSelectionEndpointOptions["canNavigateTo"];
  unit: "grapheme" | "word";
}): MoveEditorKeyboardSelectionEndpointResult {
  if (usesContentSelectionEndpoint(target)) {
    const text = readBlockText(target, readText);
    if (!text.ok) return text;
    const nextOffset =
      unit === "word"
        ? wordOffset(text.text, focus.textOffset, direction)
        : direction === "right"
          ? nextGraphemeOffset(text.text, focus.textOffset)
          : previousGraphemeOffset(text.text, focus.textOffset);
    if (nextOffset !== null) {
      return createMovedPoint(
        target,
        nextOffset,
        affinityForDirection(direction),
        createPoint,
        null,
      );
    }
  }

  return moveToAdjacentSelectableBlock({
    fromBlockId: target.block.id,
    graph,
    direction,
    readText,
    createPoint,
    canNavigateTo,
  });
}

function moveVerticalEndpoint({
  focus,
  target,
  graph,
  direction,
  readText,
  createPoint,
  moveVisualLine,
  mapToVisualLine,
  canNavigateTo,
  preferredX,
}: {
  focus: EditorLogicalSelectionPoint;
  target: EditorBlockSelectionTarget;
  graph: EditorSelectionGraphReader;
  direction: Extract<EditorKeyboardSelectionDirection, "up" | "down">;
  readText: MoveEditorKeyboardSelectionEndpointOptions["readText"];
  createPoint: MoveEditorKeyboardSelectionEndpointOptions["createPoint"];
  moveVisualLine: MoveEditorKeyboardSelectionEndpointOptions["moveVisualLine"];
  mapToVisualLine: MoveEditorKeyboardSelectionEndpointOptions["mapToVisualLine"];
  canNavigateTo: MoveEditorKeyboardSelectionEndpointOptions["canNavigateTo"];
  preferredX: number | null;
}): MoveEditorKeyboardSelectionEndpointResult {
  if (usesContentSelectionEndpoint(target)) {
    const text = readBlockText(target, readText);
    if (!text.ok) return text;
    const textLength = richInlineTextUnitCount(text.text);
    const visualLine = moveVisualLine?.({
      point: focus,
      target,
      direction,
      text: text.text,
      preferredX,
    });
    if (!visualLine) return keyboardMoveFailure("geometry-unavailable");
    if (visualLine.kind === "unavailable") {
      return keyboardMoveFailure(
        "geometry-unavailable",
        target.block.id,
        visualLine.reason,
        preferredX,
      );
    }
    if (visualLine.kind === "moved") {
      return createMovedPoint(
        target,
        clampOffset(visualLine.textOffset, textLength),
        affinityForDirection(direction),
        createPoint,
        visualLine.preferredX,
      );
    }
    preferredX = visualLine.preferredX;
  }

  return moveToAdjacentSelectableBlock({
    fromBlockId: target.block.id,
    graph,
    direction,
    readText,
    createPoint,
    preferredX,
    mapToVisualLine,
    canNavigateTo,
  });
}

function moveToAdjacentSelectableBlock({
  fromBlockId,
  graph,
  direction,
  readText,
  createPoint,
  preferredX = null,
  mapToVisualLine,
  canNavigateTo,
}: {
  fromBlockId: BlockId;
  graph: EditorSelectionGraphReader;
  direction: EditorKeyboardSelectionDirection;
  readText: MoveEditorKeyboardSelectionEndpointOptions["readText"];
  createPoint: MoveEditorKeyboardSelectionEndpointOptions["createPoint"];
  preferredX?: number | null;
  mapToVisualLine?: MoveEditorKeyboardSelectionEndpointOptions["mapToVisualLine"];
  canNavigateTo?: MoveEditorKeyboardSelectionEndpointOptions["canNavigateTo"];
}): MoveEditorKeyboardSelectionEndpointResult {
  const step = direction === "left" || direction === "up" ? -1 : 1;
  const current = readEditorBlockSelectionTarget(graph, fromBlockId);
  if (!current) return keyboardMoveFailure("missing-block", fromBlockId);
  const target = findAdjacentKeyboardSelectionTarget(
    graph,
    fromBlockId,
    step,
    canNavigateTo,
  );
  if (target) {
    if (!usesContentSelectionEndpoint(target)) {
      return createMovedPoint(
        target,
        step > 0 ? 1 : 0,
        affinityForDirection(direction),
        createPoint,
        direction === "up" || direction === "down" ? preferredX : null,
      );
    }
    const text = readBlockText(target, readText);
    if (!text.ok) return text;
    const textLength = richInlineTextUnitCount(text.text);
    if ((direction === "up" || direction === "down") && textLength === 0) {
      return createMovedPoint(
        target,
        0,
        affinityForDirection(direction),
        createPoint,
        preferredX,
      );
    }
    let textOffset: number;
    if (direction === "up" || direction === "down") {
      const mapped =
        preferredX !== null
          ? mapToVisualLine?.({
              target,
              line: direction === "up" ? "last" : "first",
              preferredX,
            })
          : undefined;
      if (!mapped) {
        return keyboardMoveFailure(
          "geometry-unavailable",
          target.block.id,
          "target-row-mapper-unavailable",
          preferredX,
        );
      }
      if (mapped.kind === "unavailable") {
        return keyboardMoveFailure(
          "geometry-unavailable",
          target.block.id,
          mapped.reason,
          preferredX,
        );
      }
      textOffset = clampOffset(mapped.textOffset, textLength);
    } else {
      textOffset = direction === "left" ? textLength : 0;
    }
    return createMovedPoint(
      target,
      textOffset,
      affinityForDirection(direction),
      createPoint,
      direction === "up" || direction === "down" ? preferredX : null,
    );
  }

  return keyboardMoveFailure(
    "no-movement",
    undefined,
    undefined,
    direction === "up" || direction === "down" ? preferredX : null,
  );
}

function findAdjacentKeyboardSelectionTarget(
  graph: EditorSelectionGraphReader,
  fromBlockId: BlockId,
  direction: -1 | 1,
  canNavigateTo: MoveEditorKeyboardSelectionEndpointOptions["canNavigateTo"],
): EditorBlockSelectionTarget | null {
  let cursor = fromBlockId;
  const visited = new Set<BlockId>();
  while (!visited.has(cursor)) {
    visited.add(cursor);
    const target = findAdjacentEditorSelectionTarget(
      graph,
      cursor,
      direction,
      true,
    );
    if (!target) return null;
    if (
      (canNavigateTo?.(target) ?? true) &&
      !hasSelectableDescendant(graph, target.block.id)
    ) {
      return target;
    }
    cursor = target.block.id;
  }
  return null;
}

function hasSelectableDescendant(
  graph: EditorSelectionGraphReader,
  blockId: BlockId,
): boolean {
  const pending = [...graph.getChildBlockIds(blockId)];
  const visited = new Set<BlockId>([blockId]);
  while (pending.length > 0) {
    const childId = pending.shift();
    if (!childId || visited.has(childId)) continue;
    visited.add(childId);
    const child = readEditorBlockSelectionTarget(graph, childId);
    if (child && canTargetEditorBlockSelection(child)) return true;
    pending.push(...graph.getChildBlockIds(childId));
  }
  return false;
}

function validateKeyboardSelectionFocus(
  focus: EditorLogicalSelectionPoint,
  graph: EditorSelectionGraphReader,
):
  | {
      ok: true;
      target: EditorBlockSelectionTarget;
      point: EditorLogicalSelectionPoint;
    }
  | MoveEditorKeyboardSelectionEndpointFailure {
  const target = readEditorBlockSelectionTarget(graph, focus.blockId);
  if (!target) return keyboardMoveFailure("missing-block", focus.blockId);
  if (!canTargetEditorBlockSelection(target)) {
    return keyboardMoveFailure("unsupported-block-type", focus.blockId);
  }
  if (
    usesContentSelectionEndpoint(target) &&
    !isEditorSelectionTextAnchor(focus.textAnchor)
  ) {
    return keyboardMoveFailure("invalid", focus.blockId);
  }
  const point = normalizeSelectionPointForGraph(focus, graph);
  if (!point) return keyboardMoveFailure("invalid", focus.blockId);
  const normalizedTarget = readEditorBlockSelectionTarget(graph, point.blockId);
  if (!normalizedTarget)
    return keyboardMoveFailure("missing-block", point.blockId);
  return { ok: true, target: normalizedTarget, point };
}

function readBlockText(
  target: EditorBlockSelectionTarget,
  readText: MoveEditorKeyboardSelectionEndpointOptions["readText"],
): { ok: true; text: string } | MoveEditorKeyboardSelectionEndpointFailure {
  const text = readText(target.block.id, target);
  return typeof text === "string"
    ? { ok: true, text }
    : keyboardMoveFailure("missing-text", target.block.id);
}

function usesContentSelectionEndpoint(
  target: EditorBlockSelectionTarget,
): boolean {
  return target.selection.projection.endpoint.kind === "content";
}

function createMovedPoint(
  target: EditorBlockSelectionTarget,
  textOffset: number,
  affinity: EditorSelectionTextAffinity | null,
  createPoint: MoveEditorKeyboardSelectionEndpointOptions["createPoint"],
  preferredX: number | null,
): MoveEditorKeyboardSelectionEndpointResult {
  const point = createPoint({
    target,
    textOffset,
    affinity,
  });
  if (!point) return keyboardMoveFailure("invalid", target.block.id);
  return {
    ok: true,
    point,
    preferredX,
  };
}

function nextGraphemeOffset(text: string, offset: number): number | null {
  const normalized = clampOffset(offset, richInlineTextUnitCount(text));
  return (
    graphemeBoundaries(text).find((boundary) => boundary > normalized) ?? null
  );
}

function previousGraphemeOffset(text: string, offset: number): number | null {
  const normalized = clampOffset(offset, richInlineTextUnitCount(text));
  const boundaries = graphemeBoundaries(text);
  for (let index = boundaries.length - 1; index >= 0; index -= 1) {
    const boundary = boundaries[index];
    if (boundary !== undefined && boundary < normalized) return boundary;
  }
  return null;
}

function wordOffset(
  text: string,
  offset: number,
  direction: "left" | "right",
): number | null {
  const normalized = clampOffset(offset, richInlineTextUnitCount(text));
  const boundaries = wordBoundaries(text);
  if (direction === "right")
    return boundaries.find((boundary) => boundary > normalized) ?? null;
  for (let index = boundaries.length - 1; index >= 0; index -= 1) {
    const boundary = boundaries[index];
    if (boundary !== undefined && boundary < normalized) return boundary;
  }
  return null;
}

function wordBoundaries(text: string): readonly number[] {
  const textLength = richInlineTextUnitCount(text);
  const boundaries = new Set<number>([0, textLength]);
  const segmenter =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter(undefined, { granularity: "word" })
      : null;
  if (segmenter) {
    for (const segment of segmenter.segment(text)) {
      const start = richInlineTextUnitCount(text.slice(0, segment.index));
      boundaries.add(start);
      boundaries.add(start + richInlineTextUnitCount(segment.segment));
    }
  } else {
    for (const match of text.matchAll(/\b/g))
      boundaries.add(richInlineTextUnitCount(text.slice(0, match.index)));
  }
  return [...boundaries].sort((left, right) => left - right);
}

function graphemeBoundaries(text: string): readonly number[] {
  const textLength = richInlineTextUnitCount(text);
  const boundaries = new Set<number>([0, textLength]);
  const segmenter =
    typeof Intl !== "undefined" && "Segmenter" in Intl
      ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
      : null;
  if (segmenter) {
    for (const segment of segmenter.segment(text)) {
      const start = richInlineTextUnitCount(text.slice(0, segment.index));
      boundaries.add(start);
      boundaries.add(start + richInlineTextUnitCount(segment.segment));
    }
  } else {
    let offset = 0;
    for (const grapheme of Array.from(text)) {
      boundaries.add(offset);
      offset += grapheme.length;
      boundaries.add(offset);
    }
  }
  return [...boundaries].sort((left, right) => left - right);
}

function affinityForDirection(
  direction: EditorKeyboardSelectionDirection,
): EditorSelectionTextAffinity {
  return direction === "left" || direction === "up" ? "backward" : "forward";
}

function clampOffset(offset: number, textLength: number): number {
  const normalized = Number.isFinite(offset) ? Math.trunc(offset) : textLength;
  return Math.min(Math.max(0, normalized), textLength);
}

function keyboardMoveFailure(
  reason: MoveEditorKeyboardSelectionEndpointFailure["reason"],
  blockId?: BlockId,
  message?: string,
  preferredX?: number | null,
): MoveEditorKeyboardSelectionEndpointFailure {
  return {
    ok: false,
    reason,
    ...(blockId === undefined ? {} : { blockId }),
    ...(message === undefined ? {} : { message }),
    ...(preferredX === undefined ? {} : { preferredX }),
  };
}
