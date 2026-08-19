import { XmlElement, XmlText } from "yjs";
import type { EditorYjsFragmentContext } from "../fragments/contracts.ts";
import type {
  RichTextDocumentNodeJson,
  RichTextInlineNodeJson,
  RichTextMarkJson,
  RichTextAtomNodeJson,
  RichTextTextNodeJson,
} from "@repo/editor-core/content/rich-text";
import {
  richTextBlockInlineContent,
  sliceRichTextDocument,
} from "@repo/editor-core/content/rich-text";
import type { EditorLogicalContentOperation } from "@repo/editor-core/operations";
import { jsonValuesEqual } from "@repo/editor-core/kernel";

const ROOT_NAME = "canonical-rich-text";
const FORMAT_VERSION = "1";

interface CanonicalUnit {
  readonly text: string;
  readonly attributes: Readonly<Record<string, string>>;
}

export interface CanonicalYjsContentMutationPlan {
  readonly text: XmlText;
  readonly kind: "replace" | "format";
  readonly index: number;
  readonly length: number;
  readonly insertedUnits: readonly CanonicalUnit[];
  readonly formatRuns: readonly {
    readonly index: number;
    readonly length: number;
    readonly marks: string | null;
  }[];
}

export function validateCanonicalYjsContentBase(
  context: EditorYjsFragmentContext,
  content: RichTextDocumentNodeJson,
): boolean {
  const text = readCanonicalYjsTextType(context);
  return Boolean(text && text.length === canonicalDocumentYjsLength(content));
}

export function planCanonicalYjsContentMutation(input: {
  readonly context: EditorYjsFragmentContext;
  readonly before: RichTextDocumentNodeJson;
  readonly after: RichTextDocumentNodeJson;
  readonly operation: EditorLogicalContentOperation;
}): CanonicalYjsContentMutationPlan | null {
  const text = readCanonicalYjsTextType(input.context);
  if (!text) return null;
  const offsets = operationOffsets(input.operation);
  const range = canonicalDocumentYjsRange(
    input.before,
    offsets.from,
    offsets.to,
  );
  if (!range) return null;
  const { index, end } = range;
  if (
    input.operation.kind === "addInlineMark" ||
    input.operation.kind === "removeInlineMark"
  ) {
    return {
      text,
      kind: "format",
      index,
      length: end - index,
      insertedUnits: [],
      formatRuns: markFormatRuns(input.after, offsets.from, offsets.to, index),
    };
  }
  const inserted =
    input.operation.kind === "insertInlineContent"
      ? input.operation.content
      : input.operation.kind === "replaceInlineRange"
        ? input.operation.content
        : input.operation.kind === "setInlineEntity"
          ? [input.operation.entity]
          : [];
  return {
    text,
    kind: "replace",
    index,
    length: end - index,
    insertedUnits: canonicalInlineUnits(inserted),
    formatRuns: [],
  };
}

export function applyPlannedCanonicalYjsContentMutation(
  plan: CanonicalYjsContentMutationPlan,
): void {
  if (plan.kind === "format") {
    for (const run of plan.formatRuns) {
      plan.text.format(run.index, run.length, { marks: run.marks });
    }
    return;
  }
  if (plan.length > 0) plan.text.delete(plan.index, plan.length);
  insertUnits(plan.text, plan.index, plan.insertedUnits);
}

export function ensureCanonicalYjsBlockContent(
  context: EditorYjsFragmentContext,
  content: RichTextDocumentNodeJson,
  origin: unknown,
): boolean {
  if (context.fragment.length > 0) return false;
  context.doc.transact(() => {
    const root = new XmlElement(ROOT_NAME);
    root.setAttribute("version", FORMAT_VERSION);
    const text = new XmlText();
    root.insert(0, [text]);
    context.fragment.insert(0, [root]);
    insertUnits(text, 0, canonicalUnits(content));
  }, origin);
  return true;
}

export function writeCanonicalYjsBlockContent(
  context: EditorYjsFragmentContext,
  content: RichTextDocumentNodeJson,
  origin: unknown,
): void {
  const current = readCanonicalYjsTextType(context);
  if (!current) {
    if (context.fragment.length > 0) {
      context.doc.transact(
        () => context.fragment.delete(0, context.fragment.length),
        origin,
      );
    }
    ensureCanonicalYjsBlockContent(context, content, origin);
    return;
  }
  const before = unitsFromDelta(current.toDelta());
  const after = canonicalUnits(content);
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    unitEqual(before[prefix]!, after[prefix]!)
  )
    prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    unitEqual(
      before[before.length - suffix - 1]!,
      after[after.length - suffix - 1]!,
    )
  )
    suffix += 1;
  const remove = before
    .slice(prefix, before.length - suffix)
    .reduce((length, unit) => length + unit.text.length, 0);
  const insert = after.slice(prefix, after.length - suffix);
  const insertionIndex = before
    .slice(0, prefix)
    .reduce((length, unit) => length + unit.text.length, 0);
  context.doc.transact(() => {
    if (remove > 0) current.delete(insertionIndex, remove);
    insertUnits(current, insertionIndex, insert);
  }, origin);
}

export function readCanonicalYjsBlockContent(
  context: EditorYjsFragmentContext,
): RichTextDocumentNodeJson | null {
  const text = readCanonicalYjsTextType(context);
  if (!text) return null;
  const inline: RichTextInlineNodeJson[] = [];
  for (const unit of unitsFromDelta(text.toDelta())) {
    const marks = parseMarks(unit.attributes.marks);
    if (unit.attributes.atom) {
      const atom = parseAtom(unit.attributes.atom);
      if (!atom) return null;
      inline.push({
        ...atom,
        ...(marks.length === 0 ? {} : { marks }),
      } as RichTextAtomNodeJson);
    } else if (unit.attributes.hardBreak === "1") {
      inline.push({
        type: "hard_break",
        ...(marks.length === 0 ? {} : { marks }),
      });
    } else {
      const previous = inline.at(-1);
      if (
        previous?.type === "text" &&
        jsonValuesEqual(previous.marks ?? [], marks)
      ) {
        inline[inline.length - 1] = {
          ...previous,
          text: previous.text + unit.text,
        };
      } else {
        inline.push({
          type: "text",
          text: unit.text,
          ...(marks.length === 0 ? {} : { marks }),
        });
      }
    }
  }
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        ...(inline.length === 0 ? {} : { content: inline }),
      },
    ],
  };
}

export function readCanonicalYjsBlockPlainText(
  context: EditorYjsFragmentContext,
): string {
  return unitsFromDelta(readCanonicalYjsTextType(context)?.toDelta() ?? [])
    .map((unit) => (unit.attributes.atom ? "\uFFFC" : unit.text))
    .join("");
}

export function readCanonicalYjsTextType(
  context: EditorYjsFragmentContext,
): XmlText | null {
  if (context.fragment.length !== 1) return null;
  const root = context.fragment.get(0);
  if (
    !(root instanceof XmlElement) ||
    root.nodeName !== ROOT_NAME ||
    root.getAttribute("version") !== FORMAT_VERSION ||
    root.length !== 1
  )
    return null;
  const text = root.get(0);
  return text instanceof XmlText ? text : null;
}

export function canonicalOffsetToYjsIndex(
  text: XmlText,
  offset: number,
): number | null {
  const units = unitsFromDelta(text.toDelta());
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > units.length)
    return null;
  return units
    .slice(0, offset)
    .reduce((index, unit) => index + unit.text.length, 0);
}

export function yjsIndexToCanonicalOffset(
  text: XmlText,
  index: number,
): number | null {
  if (!Number.isSafeInteger(index) || index < 0) return null;
  let yjsIndex = 0;
  let canonicalOffset = 0;
  for (const unit of unitsFromDelta(text.toDelta())) {
    if (yjsIndex === index) return canonicalOffset;
    yjsIndex += unit.text.length;
    canonicalOffset += 1;
    if (yjsIndex > index) return null;
  }
  return yjsIndex === index ? canonicalOffset : null;
}

function canonicalUnits(content: RichTextDocumentNodeJson): CanonicalUnit[] {
  const units: CanonicalUnit[] = [];
  for (const block of content.content) {
    for (const inline of block.content ?? []) {
      const attributes: Record<string, string> = {};
      if (inline.marks?.length) attributes.marks = JSON.stringify(inline.marks);
      if (inline.type === "hard_break") {
        attributes.hardBreak = "1";
        units.push({ text: "\n", attributes });
      } else if (inline.type === "text") {
        for (const character of [...(inline as RichTextTextNodeJson).text])
          units.push({ text: character, attributes });
      } else {
        attributes.atom = JSON.stringify({
          type: inline.type,
          metadata: inline.metadata,
        });
        units.push({ text: "\uFFFC", attributes });
      }
    }
  }
  return units;
}

function canonicalInlineUnits(
  content: readonly RichTextInlineNodeJson[],
): CanonicalUnit[] {
  return canonicalUnits({
    type: "doc",
    content: [
      {
        type: "paragraph",
        ...(content.length ? { content: [...content] } : {}),
      },
    ],
  });
}

function operationOffsets(operation: EditorLogicalContentOperation): {
  readonly from: number;
  readonly to: number;
} {
  return operation.kind === "insertInlineContent"
    ? { from: operation.position.offset, to: operation.position.offset }
    : { from: operation.range.from.offset, to: operation.range.to.offset };
}

function canonicalDocumentYjsLength(content: RichTextDocumentNodeJson): number {
  let length = 0;
  for (const node of content.content[0]?.content ?? []) {
    length +=
      node.type === "text" && typeof node.text === "string"
        ? node.text.length
        : 1;
  }
  return length;
}

function canonicalDocumentYjsRange(
  content: RichTextDocumentNodeJson,
  from: number,
  to: number,
): { readonly index: number; readonly end: number } | null {
  if (
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from < 0 ||
    to < from
  )
    return null;
  const inline = content.content[0]?.content ?? [];
  if (inline.length === 1) {
    const node = inline[0];
    if (
      node?.type === "text" &&
      typeof node.text === "string" &&
      !hasHighSurrogate(node.text)
    ) {
      return to <= node.text.length ? { index: from, end: to } : null;
    }
  }
  let canonicalOffset = 0;
  let yjsIndex = 0;
  let index: number | null = from === 0 ? 0 : null;
  let end: number | null = to === 0 ? 0 : null;
  for (const node of content.content[0]?.content ?? []) {
    if (node.type !== "text" || typeof node.text !== "string") {
      if (canonicalOffset === from) index = yjsIndex;
      if (canonicalOffset === to) end = yjsIndex;
      canonicalOffset += 1;
      yjsIndex += 1;
      if (canonicalOffset === from) index = yjsIndex;
      if (canonicalOffset === to) end = yjsIndex;
      if (index !== null && end !== null) return { index, end };
      continue;
    }
    for (const character of node.text) {
      if (canonicalOffset === from) index = yjsIndex;
      if (canonicalOffset === to) end = yjsIndex;
      if (index !== null && end !== null) return { index, end };
      canonicalOffset += 1;
      yjsIndex += character.length;
    }
  }
  if (canonicalOffset === from) index = yjsIndex;
  if (canonicalOffset === to) end = yjsIndex;
  return index === null || end === null ? null : { index, end };
}

function hasHighSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) return true;
  }
  return false;
}

function markFormatRuns(
  content: RichTextDocumentNodeJson,
  from: number,
  to: number,
  startIndex: number,
): CanonicalYjsContentMutationPlan["formatRuns"] {
  const units = canonicalInlineUnits(
    richTextBlockInlineContent(
      sliceRichTextDocument("paragraph", content, from, to),
    ),
  );
  const runs: Array<{ index: number; length: number; marks: string | null }> =
    [];
  let index = startIndex;
  for (const unit of units) {
    const marks = unit.attributes.marks ?? null;
    const previous = runs.at(-1);
    if (
      previous &&
      previous.marks === marks &&
      previous.index + previous.length === index
    ) {
      previous.length += unit.text.length;
    } else {
      runs.push({ index, length: unit.text.length, marks });
    }
    index += unit.text.length;
  }
  return runs;
}

function unitsFromDelta(
  delta: ReturnType<XmlText["toDelta"]>,
): CanonicalUnit[] {
  const units: CanonicalUnit[] = [];
  for (const part of delta) {
    if (typeof part.insert !== "string") continue;
    const attributes = Object.fromEntries(
      Object.entries(part.attributes ?? {}).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : [],
      ),
    );
    for (const character of [...part.insert])
      units.push({ text: character, attributes });
  }
  return units;
}

function insertUnits(
  text: XmlText,
  at: number,
  units: readonly CanonicalUnit[],
): void {
  let index = at;
  for (const unit of units) {
    text.insert(index, unit.text, unit.attributes);
    index += unit.text.length;
  }
}

function unitEqual(left: CanonicalUnit, right: CanonicalUnit): boolean {
  return (
    left.text === right.text &&
    attributesEqual(left.attributes, right.attributes)
  );
}

function attributesEqual(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
): boolean {
  if (left === right) return true;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    const leftValue = left[key]!;
    const rightValue = right[key]!;
    if (leftValue === rightValue) continue;
    if (key !== "marks" && key !== "atom") return false;
    if (!encodedJsonValuesEqual(leftValue, rightValue)) return false;
  }
  return true;
}

function encodedJsonValuesEqual(left: string, right: string): boolean {
  try {
    return jsonValuesEqual(JSON.parse(left), JSON.parse(right));
  } catch {
    return false;
  }
}

function parseMarks(value: string | undefined): RichTextMarkJson[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as RichTextMarkJson[]) : [];
  } catch {
    return [];
  }
}

function parseAtom(value: string): RichTextAtomNodeJson | null {
  try {
    const parsed = JSON.parse(value) as { type?: unknown; metadata?: unknown };
    return typeof parsed.type === "string" &&
      parsed.metadata &&
      typeof parsed.metadata === "object" &&
      !Array.isArray(parsed.metadata)
      ? {
          type: parsed.type,
          metadata: parsed.metadata as Record<string, never>,
        }
      : null;
  } catch {
    return null;
  }
}
