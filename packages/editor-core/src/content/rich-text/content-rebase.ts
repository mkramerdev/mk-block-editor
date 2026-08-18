import {
  isRichTextDocument,
  normalizeRichTextDocument,
  richTextBlockInlineContent,
  richTextDocumentContentSize,
  sliceRichTextDocument,
} from "./rich-inline-content.ts";
import type {
  RichTextDocumentNodeJson,
  RichTextInlineNodeJson,
} from "./rich-inline-types.ts";
import {
  richInlineNodesToUnits,
  richInlineNodeSize,
} from "./rich-inline-units.ts";
import type { BlockType } from "../../document/model/block.ts";
import type {
  EditorLogicalContentOperation,
  EditorLogicalRichTextRange,
} from "../../operations/language/logical-operations.ts";
import { cloneJsonValue, jsonValuesEqual } from "../../kernel/json/json-value.ts";

export function rebaseLogicalContentOperationByExpectedContent(
  blockType: BlockType,
  content: unknown,
  operation: EditorLogicalContentOperation,
): EditorLogicalContentOperation | null {
  if (!isRichTextDocument(content)) return null;
  const base = normalizeRichTextDocument(blockType, content);
  switch (operation.kind) {
    case "deleteInlineRange":
    case "replaceInlineRange":
    case "setInlineEntity":
      return rebaseRangeOperationByExpectedContent(base, blockType, operation);
    case "insertInlineContent":
    case "addInlineMark":
    case "removeInlineMark":
      return cloneJsonValue(operation);
  }
}

function rebaseRangeOperationByExpectedContent(
  base: RichTextDocumentNodeJson,
  blockType: BlockType,
  operation: Extract<EditorLogicalContentOperation, { readonly range: EditorLogicalRichTextRange }>,
): EditorLogicalContentOperation | null {
  const expectedContent = "deletedContent" in operation ? operation.deletedContent : undefined;
  if (!expectedContent || expectedContent.length === 0) return cloneJsonValue(operation);
  if (inlineContentMatchesRange(base, blockType, operation.range.from.offset, operation.range.to.offset, expectedContent)) {
    return cloneJsonValue(operation);
  }
  const relocatedFrom = findNearestInlineContentOffset(base, operation.range.from.offset, expectedContent);
  if (relocatedFrom === null) return null;
  const expectedSize = expectedContent.reduce((total, node) => total + richInlineNodeSize(node), 0);
  const size = richTextDocumentContentSize(base);
  if (relocatedFrom + expectedSize > size) return null;
  return {
    ...cloneJsonValue(operation),
    range: {
      from: {
        ...operation.range.from,
        offset: relocatedFrom,
      },
      to: {
        ...operation.range.to,
        offset: relocatedFrom + expectedSize,
      },
    },
  } as EditorLogicalContentOperation;
}

function inlineContentMatchesRange(
  base: RichTextDocumentNodeJson,
  blockType: BlockType,
  from: number,
  to: number,
  expectedContent: readonly RichTextInlineNodeJson[],
): boolean {
  if (!rangeWithinDocument(base, from, to)) return false;
  const actual = richInlineNodesToUnits(richTextBlockInlineContent(sliceRichTextDocument(blockType, base, from, to)));
  const expected = richInlineNodesToUnits(expectedContent);
  return inlineUnitRangesEqual(actual, expected);
}

function findNearestInlineContentOffset(
  base: RichTextDocumentNodeJson,
  preferredOffset: number,
  expectedContent: readonly RichTextInlineNodeJson[],
): number | null {
  const actualUnits = richInlineNodesToUnits(richTextBlockInlineContent(base));
  const expectedUnits = richInlineNodesToUnits(expectedContent);
  if (expectedUnits.length === 0 || expectedUnits.length > actualUnits.length) return null;
  let bestOffset: number | null = null;
  for (let offset = 0; offset <= actualUnits.length - expectedUnits.length; offset += 1) {
    if (!inlineUnitRangesEqual(actualUnits.slice(offset, offset + expectedUnits.length), expectedUnits)) continue;
    if (bestOffset === null || Math.abs(offset - preferredOffset) < Math.abs(bestOffset - preferredOffset)) {
      bestOffset = offset;
    }
  }
  return bestOffset;
}

function inlineUnitRangesEqual(
  left: readonly RichTextInlineNodeJson[],
  right: readonly RichTextInlineNodeJson[],
): boolean {
  return left.length === right.length && left.every((unit, index) => jsonValuesEqual(unit, right[index] ?? null));
}

function rangeWithinDocument(base: RichTextDocumentNodeJson, from: number, to: number): boolean {
  const size = richTextDocumentContentSize(base);
  return Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to >= from && to <= size;
}
