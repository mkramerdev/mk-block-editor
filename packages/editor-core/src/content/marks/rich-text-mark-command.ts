import type { BlockDefinition } from "../../definitions/block-definition.ts";
import {
  findInlineMarkDefinition,
  isInlineMarkName,
  sanitizeInlineMarkAttrs,
} from "./schema.ts";
import {
  assertRichTextAttrsJson,
  extractPlainTextFromRichTextDocument,
  mergeAdjacentTextNodes,
  normalizeRichTextDocument,
  richInlineNodeSize,
  richTextBlockInlineContent,
  richTextDocumentContentSize,
  richTextDocumentWithInlineContent,
} from "../rich-text/rich-inline-content.ts";
import type {
  RichTextDocumentNodeJson,
  RichTextInlineNodeJson,
  RichTextMarkJson,
} from "../rich-text/rich-inline-types.ts";
import {
  clampRichInlineOffset,
  sliceRichInlineTextUnits,
} from "../rich-text/rich-inline-units.ts";
import type { BlockType } from "../../document/model/block.ts";
import type { InlineTextContext } from "../rich-text/inline-attributes.ts";
import type { InlineMarkDefinition, InlineMarkName } from "./types.ts";
import { cloneJsonValue, jsonValuesEqual } from "../../kernel/json/json-value.ts";
import {
  createInlineMarkCommandStateFromRange,
  createInlineMarkCursorCommandState,
  inactiveInlineMarkCommandState,
  missingInlineMarkCommandState,
  planInlineMarkCommand,
  resolveInlineMarkCommandAction,
  resolveInlineMarkCommandAttrs,
  validateInlineMarkCommandAttrs,
  type InlineMarkCommandAction,
  type InlineMarkCommandRangeSegment,
  type InlineMarkCommandState,
  type ResolvedInlineMarkCommandAction,
} from "./mark-command.ts";

export interface RichTextInlineMarkCommandRange {
  from: number;
  to: number;
}

export interface RichTextInlineMarkCommandOptions {
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  inlineMarks: readonly InlineMarkDefinition[];
  action?: InlineMarkCommandAction;
  attrs?: Readonly<Record<string, unknown>> | null;
  context?: InlineTextContext;
}

export interface RichTextInlineMarkCommandResult {
  state: InlineMarkCommandState;
  content: RichTextDocumentNodeJson;
  plainText: string;
  changed: boolean;
}

export function readInlineMarkCommandStateFromRichTextDocument(
  blockType: BlockType,
  content: RichTextDocumentNodeJson,
  markName: InlineMarkName,
  range: RichTextInlineMarkCommandRange,
  options: Pick<
    RichTextInlineMarkCommandOptions,
    "attrs" | "context" | "blockDefinitions" | "inlineMarks"
  >,
): InlineMarkCommandState {
  const definition = findInlineMarkDefinition(options.inlineMarks, markName);
  if (!definition) return missingInlineMarkCommandState(markName);
  if (
    !canApplyInlineMarkInContext(
      blockType,
      definition,
      options.context ?? "text",
      options.blockDefinitions,
    )
  ) {
    return inactiveInlineMarkCommandState(definition, "unsupported-context");
  }
  if (!validateInlineMarkCommandAttrs(definition, options.attrs)) {
    return inactiveInlineMarkCommandState(definition, "invalid-attrs");
  }
  const doc = normalizeRichTextDocument(blockType, content);
  const size = richTextDocumentContentSize(doc);
  const from = clampRichInlineOffset(Math.min(range.from, range.to), size);
  const to = clampRichInlineOffset(Math.max(range.from, range.to), size);
  if (from === to) {
    const mark = marksAtInlineOffset(doc, from, options.inlineMarks).find(
      (candidate) => candidate.type === markName,
    );
    return createInlineMarkCursorCommandState(
      definition,
      mark && isRecord(mark.attrs) ? { ...mark.attrs } : mark ? {} : null,
    );
  }
  return createInlineMarkCommandStateFromRange(
    definition,
    inlineMarkCommandRangeSegmentsFromRichTextDocument(
      doc,
      markName,
      { from, to },
      options.inlineMarks,
    ),
  );
}

export function applyInlineMarkUpdateToRichTextDocument(
  blockType: BlockType,
  content: RichTextDocumentNodeJson,
  markName: InlineMarkName,
  range: RichTextInlineMarkCommandRange,
  options: RichTextInlineMarkCommandOptions,
): RichTextInlineMarkCommandResult {
  const state = readInlineMarkCommandStateFromRichTextDocument(
    blockType,
    content,
    markName,
    range,
    options,
  );
  const base = normalizeRichTextDocument(blockType, content);
  if (!state.canExecute) {
    return {
      state,
      content: base,
      plainText: extractPlainTextFromRichTextDocument(base),
      changed: false,
    };
  }
  const action = resolveInlineMarkCommandAction(state, options.action);
  const definition = findInlineMarkDefinition(options.inlineMarks, markName);
  if (!definition) {
    return {
      state: missingInlineMarkCommandState(markName),
      content: base,
      plainText: extractPlainTextFromRichTextDocument(base),
      changed: false,
    };
  }
  const attrs = resolveInlineMarkCommandAttrs(
    definition,
    action,
    options.attrs,
  );
  if (!attrs) {
    return {
      state: inactiveInlineMarkCommandState(definition, "invalid-attrs"),
      content: base,
      plainText: extractPlainTextFromRichTextDocument(base),
      changed: false,
    };
  }

  const size = richTextDocumentContentSize(base);
  const normalizedRange = {
    from: clampRichInlineOffset(Math.min(range.from, range.to), size),
    to: clampRichInlineOffset(Math.max(range.from, range.to), size),
  };
  if (normalizedRange.from === normalizedRange.to) {
    return {
      state,
      content: base,
      plainText: extractPlainTextFromRichTextDocument(base),
      changed: false,
    };
  }
  const plan = planInlineMarkCommand({
    definition,
    segments: inlineMarkCommandRangeSegmentsFromRichTextDocument(
      base,
      markName,
      normalizedRange,
      options.inlineMarks,
    ),
    action,
    attrs: options.attrs,
  });
  if (!plan) {
    return {
      state: state.canExecute
        ? inactiveInlineMarkCommandState(definition, "empty-range")
        : state,
      content: base,
      plainText: extractPlainTextFromRichTextDocument(base),
      changed: false,
    };
  }
  const nextInlineContent = plan.ranges.reduce(
    (current, plannedRange) =>
      mapInlineContentInRange(
        current,
        plannedRange,
        (node) =>
          applyMarkToInlineNode(
            node,
            markName,
            plan.action,
            plan.attrs,
            options.inlineMarks,
          ),
        options.inlineMarks,
      ),
    richTextBlockInlineContent(base),
  );
  const nextContent = richTextDocumentWithInlineContent(
    blockType,
    base,
    nextInlineContent,
    {
      inlineMarks: options.inlineMarks,
    },
  );
  return {
    state,
    content: nextContent,
    plainText: extractPlainTextFromRichTextDocument(nextContent),
    changed: !jsonValuesEqual(base, nextContent),
  };
}

function canApplyInlineMarkInContext(
  blockType: BlockType,
  definition: InlineMarkDefinition,
  context: InlineTextContext,
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
): boolean {
  if (!definition.contexts.includes(context)) return false;
  if (
    definition.blockPolicy.allowBlockTypes &&
    !definition.blockPolicy.allowBlockTypes.includes(blockType)
  )
    return false;
  if (definition.blockPolicy.denyBlockTypes?.includes(blockType)) return false;
  const blockDefinition = blockDefinitions[blockType];
  return (
    blockDefinition !== undefined &&
    (definition.blockPolicy.requireText !== true ||
      blockDefinition.kind === "text")
  );
}

function inlineMarkCommandRangeSegmentsFromRichTextDocument(
  content: RichTextDocumentNodeJson,
  markName: InlineMarkName,
  range: RichTextInlineMarkCommandRange,
  inlineMarks: readonly InlineMarkDefinition[],
): InlineMarkCommandRangeSegment[] {
  const segments: InlineMarkCommandRangeSegment[] = [];
  let cursor = 0;
  for (const node of richTextBlockInlineContent(content)) {
    const size = richInlineNodeSize(node);
    const start = cursor;
    const end = cursor + size;
    cursor = end;
    if (end <= range.from || start >= range.to) continue;
    const segmentFrom = Math.max(start, range.from);
    const segmentTo = Math.min(end, range.to);
    const mark = findInlineMark(node, markName, inlineMarks);
    const markAttrs = mark
      ? isRecord(mark.attrs)
        ? { ...mark.attrs }
        : {}
      : null;
    if (node.type === "hard_break") {
      segments.push({
        from: segmentFrom,
        to: segmentTo,
        kind: "hard-break",
        markAttrs,
      });
      continue;
    }
    if (isRichTextTextNode(node)) {
      const text = sliceRichInlineTextUnits(
        node.text,
        Math.max(0, range.from - start),
        Math.min(size, range.to - start),
      );
      segments.push({
        from: segmentFrom,
        to: segmentTo,
        kind: "text",
        text,
        markAttrs,
      });
      continue;
    }
    segments.push({
      from: segmentFrom,
      to: segmentTo,
      kind: "inline-atom",
      markAttrs,
    });
  }
  return segments;
}

function marksAtInlineOffset(
  content: RichTextDocumentNodeJson,
  offset: number,
  inlineMarks: readonly InlineMarkDefinition[],
): RichTextMarkJson[] {
  const inlineContent = richTextBlockInlineContent(content);
  let cursor = 0;
  let previousTextMarks: RichTextMarkJson[] = [];
  for (const node of inlineContent) {
    const size = richInlineNodeSize(node);
    const start = cursor;
    const end = cursor + size;
    cursor = end;
    if (isRichTextTextNode(node) && node.marks)
      previousTextMarks = normalizedCommandMarks(node.marks, inlineMarks);
    if (offset >= start && offset < end)
      return normalizedCommandMarks(node.marks, inlineMarks);
    if (offset === end && isRichTextTextNode(node))
      previousTextMarks = normalizedCommandMarks(node.marks, inlineMarks);
  }
  return previousTextMarks;
}

function mapInlineContentInRange(
  content: readonly RichTextInlineNodeJson[],
  range: RichTextInlineMarkCommandRange,
  mapNode: (node: RichTextInlineNodeJson) => RichTextInlineNodeJson,
  inlineMarks: readonly InlineMarkDefinition[],
): RichTextInlineNodeJson[] {
  const result: RichTextInlineNodeJson[] = [];
  let cursor = 0;
  for (const node of content) {
    const size = richInlineNodeSize(node);
    const start = cursor;
    const end = cursor + size;
    cursor = end;
    if (end <= range.from || start >= range.to || node.type === "hard_break") {
      result.push(cloneJsonValue(node));
      continue;
    }
    if (!isRichTextTextNode(node)) {
      result.push(mapNode(cloneJsonValue(node)));
      continue;
    }
    const localFrom = Math.max(0, range.from - start);
    const localTo = Math.min(size, range.to - start);
    if (localFrom > 0)
      result.push({
        ...cloneJsonValue(node),
        text: sliceRichInlineTextUnits(node.text, 0, localFrom),
      });
    const selectedText = sliceRichInlineTextUnits(
      node.text,
      localFrom,
      localTo,
    );
    if (selectedText)
      result.push(mapNode({ ...cloneJsonValue(node), text: selectedText }));
    if (localTo < size)
      result.push({
        ...cloneJsonValue(node),
        text: sliceRichInlineTextUnits(node.text, localTo, size),
      });
  }
  return mergeAdjacentTextNodes(result, { inlineMarks });
}

function isRichTextTextNode(
  node: RichTextInlineNodeJson,
): node is Extract<RichTextInlineNodeJson, { text: string }> {
  return node.type === "text" && typeof node.text === "string";
}

function applyMarkToInlineNode(
  node: RichTextInlineNodeJson,
  markName: InlineMarkName,
  action: ResolvedInlineMarkCommandAction,
  attrs: Readonly<Record<string, unknown>>,
  inlineMarks: readonly InlineMarkDefinition[],
): RichTextInlineNodeJson {
  const marks = normalizedCommandMarks(node.marks, inlineMarks).filter(
    (mark) => mark.type !== markName,
  );
  if (action === "add") {
    marks.push(createCommandMark(markName, attrs));
  }
  const next = { ...node };
  if (marks.length > 0) next.marks = sortMarks(marks);
  else delete next.marks;
  return next;
}

function normalizedCommandMarks(
  marks: unknown,
  inlineMarks: readonly InlineMarkDefinition[],
): RichTextMarkJson[] {
  if (!Array.isArray(marks)) return [];
  return marks.flatMap((mark) => {
    if (!isRecord(mark) || !isInlineMarkName(mark.type)) return [];
    const definition = findInlineMarkDefinition(inlineMarks, mark.type);
    if (!definition) return [];
    const attrs = isRecord(mark.attrs)
      ? sanitizeInlineMarkAttrs(definition, mark.attrs)
      : sanitizeInlineMarkAttrs(definition, {});
    if (!attrs) return [];
    return [createCommandMark(definition.name, attrs)];
  });
}

function findInlineMark(
  node: RichTextInlineNodeJson,
  markName: InlineMarkName,
  inlineMarks: readonly InlineMarkDefinition[],
): RichTextMarkJson | null {
  return (
    normalizedCommandMarks(node.marks, inlineMarks).find(
      (mark) => mark.type === markName,
    ) ?? null
  );
}

function createCommandMark(
  type: InlineMarkName,
  attrs: Readonly<Record<string, unknown>>,
): RichTextMarkJson {
  if (Object.keys(attrs).length === 0) return { type };
  const clonedAttrs = cloneJsonValue({ ...attrs });
  assertRichTextAttrsJson(clonedAttrs);
  return { type, attrs: clonedAttrs };
}

function sortMarks(marks: readonly RichTextMarkJson[]): RichTextMarkJson[] {
  return [...marks].sort((left, right) => left.type.localeCompare(right.type));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
