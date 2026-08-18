import { cloneJsonValue } from "../../kernel/json/json-value.ts";
import type { RichTextInlineNodeJson } from "./rich-inline-types.ts";

export function richInlineTextUnitCount(text: string): number {
  if (!hasHighSurrogate(text)) return text.length;
  let count = 0;
  for (let index = 0; index < text.length; count += 1) {
    const codePoint = text.codePointAt(index);
    index += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
  }
  return count;
}

export function richInlineNodeSize(node: RichTextInlineNodeJson): number {
  return isTextNode(node) ? richInlineTextUnitCount(node.text) : 1;
}

export function richInlineContentSize(content: readonly RichTextInlineNodeJson[]): number {
  return content.reduce((size, node) => size + richInlineNodeSize(node), 0);
}

export function clampRichInlineOffset(offset: number, length: number): number {
  if (!Number.isFinite(offset)) return length;
  return Math.min(Math.max(0, Math.trunc(offset)), length);
}

export function sliceRichInlineTextUnits(text: string, from: number, to: number): string {
  if (from === to) return "";
  if (!hasHighSurrogate(text)) return text.slice(from, to);
  let unit = 0;
  let start = from === 0 ? 0 : text.length;
  let end = to === 0 ? 0 : text.length;
  for (let index = 0; index < text.length && unit < to; unit += 1) {
    if (unit === from) start = index;
    const codePoint = text.codePointAt(index);
    index += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    if (unit + 1 === to) end = index;
  }
  return text.slice(start, end);
}

function hasHighSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) return true;
  }
  return false;
}

export function sliceRichInlineNodeUnits(
  node: RichTextInlineNodeJson,
  from: number,
  to: number,
): RichTextInlineNodeJson | null {
  if (isTextNode(node)) {
    const text = sliceRichInlineTextUnits(node.text, from, to);
    if (!text) return null;
    if (text === node.text) return node;
    return { ...node, text };
  }
  return from <= 0 && to >= 1 ? node : null;
}

export function sliceRichInlineContentUnits(
  content: readonly RichTextInlineNodeJson[],
  from: number,
  to: number,
): RichTextInlineNodeJson[] {
  const result: RichTextInlineNodeJson[] = [];
  let cursor = 0;
  for (const node of content) {
    const size = richInlineNodeSize(node);
    const nodeStart = cursor;
    const nodeEnd = cursor + size;
    cursor = nodeEnd;
    if (nodeEnd <= from || nodeStart >= to) continue;
    const sliceFrom = Math.max(0, from - nodeStart);
    const sliceTo = Math.min(size, to - nodeStart);
    const sliced = sliceRichInlineNodeUnits(node, sliceFrom, sliceTo);
    if (sliced) result.push(sliced);
  }
  return result;
}

export function richInlineNodesToUnits(nodes: readonly RichTextInlineNodeJson[]): RichTextInlineNodeJson[] {
  const units: RichTextInlineNodeJson[] = [];
  for (const node of nodes) {
    const size = richInlineNodeSize(node);
    if (isTextNode(node)) {
      for (const unit of Array.from(node.text)) {
        units.push({ ...cloneJsonValue(node), text: unit });
      }
      continue;
    }
    if (size > 0) units.push(cloneJsonValue(node));
  }
  return units;
}

export interface RichInlineNodeUnitPartition {
  readonly size: number;
  readonly before: RichTextInlineNodeJson | null;
  readonly selected: RichTextInlineNodeJson | null;
  readonly after: RichTextInlineNodeJson | null;
}

/** Splits one inline node at code-point offsets while scanning its text once. */
export function partitionRichInlineNodeUnits(
  node: RichTextInlineNodeJson,
  from: number,
  to: number,
): RichInlineNodeUnitPartition {
  if (!isTextNode(node)) {
    const selected = from < 1 && to > 0;
    return {
      size: 1,
      before: from >= 1 ? node : null,
      selected: selected ? node : null,
      after: to <= 0 ? node : null,
    };
  }
  const startUnit = Math.max(0, Math.trunc(from));
  const endUnit = Math.max(startUnit, Math.trunc(to));
  let size = 0;
  let startIndex: number | null = startUnit === 0 ? 0 : null;
  let endIndex: number | null = endUnit === 0 ? 0 : null;
  for (let index = 0; index < node.text.length; ) {
    const codePoint = node.text.codePointAt(index);
    index += codePoint !== undefined && codePoint > 0xffff ? 2 : 1;
    size += 1;
    if (size === startUnit) startIndex = index;
    if (size === endUnit) endIndex = index;
  }
  startIndex ??= node.text.length;
  endIndex ??= node.text.length;
  return {
    size,
    before: textNodeUnitSlice(node, 0, startIndex),
    selected: textNodeUnitSlice(node, startIndex, endIndex),
    after: textNodeUnitSlice(node, endIndex, node.text.length),
  };
}

function textNodeUnitSlice(
  node: Extract<RichTextInlineNodeJson, { text: string }>,
  from: number,
  to: number,
): RichTextInlineNodeJson | null {
  if (from === to) return null;
  if (from === 0 && to === node.text.length) return node;
  return { ...node, text: node.text.slice(from, to) };
}

function isTextNode(
  node: RichTextInlineNodeJson,
): node is Extract<RichTextInlineNodeJson, { text: string }> {
  return node.type === "text" && typeof node.text === "string";
}
