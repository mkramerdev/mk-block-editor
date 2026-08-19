import { validateAndCloneInlineAtomMetadata } from "../inline-atoms/schema.ts";
import type { InlineMetadataFieldDefinition } from "../inline-atoms/types.ts";
import {
  findInlineMarkDefinition,
  isInlineMarkName,
  primitiveInlineMarkDefinitions,
  sanitizeInlineMarkAttrs,
} from "../marks/schema.ts";
import {
  clampRichInlineOffset,
  richInlineContentSize as richInlineContentUnitSize,
  richInlineNodeSize as richInlineNodeUnitSize,
  sliceRichInlineContentUnits,
} from "./rich-inline-unit-operations.ts";
import { validateAllowedKeys } from "../../kernel/json/allowed-keys.ts";
import type { BlockType } from "../../document/model/block.ts";
import type { InlineMarkDefinition, InlineMarkName } from "../marks/types.ts";
import {
  cloneJsonValue,
  jsonValuesEqual,
  validateJsonObject,
  type JsonValue,
} from "../../kernel/json/json-value.ts";
import type {
  RichTextAttrsJson,
  RichTextBlockNodeJson,
  RichTextDocumentNodeJson,
  RichTextInlineNodeJson,
  RichTextJsonValidationResult,
  RichTextMarkJson,
} from "./rich-inline-types.ts";
export type {
  RichTextAttrsJson,
  RichTextAtomNodeJson,
  RichTextBlockNodeJson,
  RichTextDocumentNodeJson,
  RichTextHardBreakNodeJson,
  RichTextInlineNodeJson,
  RichTextJsonValidationResult,
  RichTextMarkJson,
  RichTextTextNodeJson,
} from "./rich-inline-types.ts";

export interface RichInlineContentNormalizationOptions {
  readonly inlineMarks?: readonly InlineMarkDefinition[];
  readonly inlineAtoms?: readonly {
    readonly type: string;
    readonly metadata: Readonly<Record<string, InlineMetadataFieldDefinition>>;
  }[];
}

export function textBlockNodeNameForBlockType(
  _blockType: BlockType,
): "paragraph" {
  void _blockType;
  return "paragraph";
}

export function createBlockRichTextContentFromPlainText(
  blockType: BlockType,
  text: string,
): RichTextDocumentNodeJson {
  const textblock: RichTextBlockNodeJson = {
    type: textBlockNodeNameForBlockType(blockType),
    ...(text.length > 0 ? { content: [{ type: "text", text }] } : {}),
  };
  return { type: "doc", content: [textblock] };
}

export function validateRichTextDocumentNodeJson(
  content: unknown,
  label = "content",
  options: RichInlineContentNormalizationOptions = {},
): RichTextJsonValidationResult<RichTextDocumentNodeJson> {
  return validationResult(
    content,
    validateRichTextDocumentNodeJsonErrors(content, label, options),
  );
}

export function validateRichTextBlockNodeJson(
  block: unknown,
  label = "block",
  options: RichInlineContentNormalizationOptions = {},
): RichTextJsonValidationResult<RichTextBlockNodeJson> {
  return validationResult(
    block,
    validateRichTextBlockNodeJsonErrors(block, label, options),
  );
}

export function validateRichTextInlineNodeJson(
  node: unknown,
  label = "node",
  options: RichInlineContentNormalizationOptions = {},
): RichTextJsonValidationResult<RichTextInlineNodeJson> {
  return validationResult(
    node,
    validateRichTextInlineNodeJsonErrors(node, label, options),
  );
}

export function validateRichTextMarkJson(
  mark: unknown,
  label = "mark",
): RichTextJsonValidationResult<RichTextMarkJson> {
  return validationResult(mark, validateRichTextMarkJsonErrors(mark, label));
}

export function validateRichTextAttrsJson(
  attrs: unknown,
  label = "attrs",
): RichTextJsonValidationResult<RichTextAttrsJson> {
  return validationResult(attrs, validateRichTextAttrsJsonErrors(attrs, label));
}

export function assertRichTextDocumentNodeJson(
  content: unknown,
  label = "content",
  options: RichInlineContentNormalizationOptions = {},
): asserts content is RichTextDocumentNodeJson {
  assertRichTextValidation(
    validateRichTextDocumentNodeJson(content, label, options),
    "rich text document",
  );
}

export function assertRichTextBlockNodeJson(
  block: unknown,
  label = "block",
  options: RichInlineContentNormalizationOptions = {},
): asserts block is RichTextBlockNodeJson {
  assertRichTextValidation(
    validateRichTextBlockNodeJson(block, label, options),
    "rich text block",
  );
}

export function assertRichTextInlineNodeJson(
  node: unknown,
  label = "node",
  options: RichInlineContentNormalizationOptions = {},
): asserts node is RichTextInlineNodeJson {
  assertRichTextValidation(
    validateRichTextInlineNodeJson(node, label, options),
    "rich text inline node",
  );
}

export function assertRichTextMarkJson(
  mark: unknown,
  label = "mark",
): asserts mark is RichTextMarkJson {
  assertRichTextValidation(
    validateRichTextMarkJson(mark, label),
    "rich text mark",
  );
}

export function assertRichTextAttrsJson(
  attrs: unknown,
  label = "attrs",
): asserts attrs is RichTextAttrsJson {
  assertRichTextValidation(
    validateRichTextAttrsJson(attrs, label),
    "rich text attrs",
  );
}

export function isRichTextDocument(
  content: unknown,
  options: RichInlineContentNormalizationOptions = {},
): content is RichTextDocumentNodeJson {
  return validateRichTextDocumentNodeJson(content, "content", options).valid;
}

export function normalizeRichTextDocument(
  blockType: BlockType,
  content: RichTextDocumentNodeJson,
  options: RichInlineContentNormalizationOptions = {},
): RichTextDocumentNodeJson {
  assertRichTextDocumentNodeJson(content, "content", options);
  return retargetRichTextDocument(content, blockType, options);
}

export function retargetRichTextDocument(
  content: RichTextDocumentNodeJson,
  blockType: BlockType,
  options: RichInlineContentNormalizationOptions = {},
): RichTextDocumentNodeJson {
  assertRichTextDocumentNodeJson(content, "content", options);
  const blocks =
    content.content.length > 0
      ? content.content
      : [{ type: textBlockNodeNameForBlockType(blockType) }];
  return {
    type: "doc",
    content: blocks.map((block) => {
      const inlineContent = block.content
        ? mergeAdjacentTextNodes(block.content, options)
        : [];
      const nextBlock: RichTextBlockNodeJson = {
        type: textBlockNodeNameForBlockType(blockType),
        ...(inlineContent.length > 0 ? { content: inlineContent } : {}),
      };
      return nextBlock;
    }),
  };
}

export function richTextBlock(
  content: RichTextDocumentNodeJson,
): RichTextBlockNodeJson {
  const first = content.content[0];
  return first ? cloneJsonValue(first) : { type: "paragraph" };
}

export function richTextBlockInlineContent(
  content: RichTextDocumentNodeJson,
): RichTextInlineNodeJson[] {
  const textblock = richTextBlock(content);
  return textblock.content
    ? textblock.content.map((node) => cloneJsonValue(node))
    : [];
}

export function richTextDocumentWithInlineContent(
  blockType: BlockType,
  baseDoc: RichTextDocumentNodeJson,
  inlineContent: readonly RichTextInlineNodeJson[],
  options: RichInlineContentNormalizationOptions = {},
): RichTextDocumentNodeJson {
  assertRichTextDocumentNodeJson(baseDoc);
  const {
    attrs: _attrs,
    content: _content,
    ...textblock
  } = richTextBlock(baseDoc);
  void _attrs;
  void _content;
  const content = mergeAdjacentTextNodes(inlineContent, options);
  const nextTextblock: RichTextBlockNodeJson = {
    ...textblock,
    type: textBlockNodeNameForBlockType(blockType),
    ...(content.length > 0 ? { content } : {}),
  };
  return { type: "doc", content: [nextTextblock] };
}

export function extractPlainTextFromRichTextDocument(
  content: RichTextDocumentNodeJson,
): string {
  return richTextBlockInlineContent(content)
    .map((node) => {
      if (isRichTextTextNode(node)) return node.text;
      if (node.type === "hard_break") return "\n";
      return "";
    })
    .join("");
}

export function richTextDocumentContentSize(
  content: RichTextDocumentNodeJson,
): number {
  return richInlineContentSize(richTextBlockInlineContent(content));
}

export function richInlineContentSize(
  content: readonly RichTextInlineNodeJson[],
): number {
  return richInlineContentUnitSize(content);
}

export function richInlineNodeSize(node: RichTextInlineNodeJson): number {
  return richInlineNodeUnitSize(node);
}

export function richTextDocumentHasDurableInlineContent(
  content: RichTextDocumentNodeJson,
): boolean {
  return richTextBlockInlineContent(content).some(
    (node) =>
      hasKnownMarks(node) ||
      node.type === "hard_break" ||
      isRichTextAtomNode(node),
  );
}

export function sliceRichTextDocument(
  blockType: BlockType,
  content: RichTextDocumentNodeJson,
  from: number,
  to: number,
): RichTextDocumentNodeJson {
  const doc = normalizeRichTextDocument(blockType, content);
  const inlineContent = richTextBlockInlineContent(doc);
  const size = richInlineContentSize(inlineContent);
  const slicedContent = sliceRichInlineContentUnits(
    inlineContent,
    clampRichInlineOffset(from, size),
    clampRichInlineOffset(to, size),
  );
  return richTextDocumentWithInlineContent(blockType, doc, slicedContent);
}

export function concatenateRichTextDocuments(
  blockType: BlockType,
  left: RichTextDocumentNodeJson,
  right: RichTextDocumentNodeJson,
): RichTextDocumentNodeJson {
  const leftDoc = normalizeRichTextDocument(blockType, left);
  const rightDoc = normalizeRichTextDocument(blockType, right);
  return richTextDocumentWithInlineContent(blockType, leftDoc, [
    ...richTextBlockInlineContent(leftDoc),
    ...richTextBlockInlineContent(rightDoc),
  ]);
}

export function appendPlainTextToRichTextDocument(
  blockType: BlockType,
  content: RichTextDocumentNodeJson,
  text: string,
): RichTextDocumentNodeJson {
  if (!text) return normalizeRichTextDocument(blockType, content);
  return concatenateRichTextDocuments(
    blockType,
    content,
    createBlockRichTextContentFromPlainText(blockType, text),
  );
}

export function removeTextRangeFromRichTextDocument(
  blockType: BlockType,
  content: RichTextDocumentNodeJson,
  from: number,
  to: number,
): RichTextDocumentNodeJson {
  const doc = normalizeRichTextDocument(blockType, content);
  const size = richTextDocumentContentSize(doc);
  const boundedFrom = clampRichInlineOffset(from, size);
  const boundedTo = clampRichInlineOffset(to, size);
  return concatenateRichTextDocuments(
    blockType,
    sliceRichTextDocument(blockType, doc, 0, boundedFrom),
    sliceRichTextDocument(blockType, doc, boundedTo, size),
  );
}

export function mergeAdjacentTextNodes(
  content: readonly RichTextInlineNodeJson[],
  options: RichInlineContentNormalizationOptions = {},
): RichTextInlineNodeJson[] {
  const merged: RichTextInlineNodeJson[] = [];
  for (const node of content) {
    const clone = normalizeInlineNode(cloneJsonValue(node), options);
    const previous = merged[merged.length - 1];
    if (
      previous?.type === "text" &&
      isRichTextTextNode(previous) &&
      isRichTextTextNode(clone) &&
      inlineMarksEqual(previous.marks, clone.marks, options)
    ) {
      merged[merged.length - 1] = {
        ...previous,
        text: previous.text + clone.text,
      };
      continue;
    }
    merged.push(clone);
  }
  return merged;
}

function validateRichTextDocumentNodeJsonErrors(
  content: unknown,
  label: string,
  options: RichInlineContentNormalizationOptions,
): string[] {
  const record = validateJsonRecord(content, label);
  if (!record.valid) return [...record.errors];
  const errors: string[] = [
    ...validateAllowedKeys(record.value, ["type", "content"], label),
    ...(record.value.type === "doc" ? [] : [`${label}.type must be doc`]),
  ];
  if (!Array.isArray(record.value.content)) {
    errors.push(`${label}.content must be an array`);
    return errors;
  }
  for (let index = 0; index < record.value.content.length; index += 1) {
    errors.push(
      ...validateRichTextBlockNodeJsonErrors(
        record.value.content[index],
        `${label}.content[${index}]`,
        options,
      ),
    );
  }
  return errors;
}

function validateRichTextBlockNodeJsonErrors(
  block: unknown,
  label: string,
  options: RichInlineContentNormalizationOptions,
): string[] {
  const record = validateJsonRecord(block, label);
  if (!record.valid) return [...record.errors];
  const errors: string[] = [
    ...validateAllowedKeys(record.value, ["type", "content", "attrs"], label),
    ...(record.value.type === "paragraph"
      ? []
      : [`${label}.type must be paragraph`]),
  ];
  if (record.value.attrs !== undefined) {
    errors.push(
      ...validateRichTextAttrsJsonErrors(record.value.attrs, `${label}.attrs`),
    );
  }
  if (record.value.content !== undefined) {
    if (!Array.isArray(record.value.content)) {
      errors.push(`${label}.content must be an array`);
    } else {
      for (let index = 0; index < record.value.content.length; index += 1) {
        errors.push(
          ...validateRichTextInlineNodeJsonErrors(
            record.value.content[index],
            `${label}.content[${index}]`,
            options,
          ),
        );
      }
    }
  }
  return errors;
}

function validateRichTextInlineNodeJsonErrors(
  node: unknown,
  label: string,
  options: RichInlineContentNormalizationOptions,
): string[] {
  const record = validateJsonRecord(node, label);
  if (!record.valid) return [...record.errors];
  if (record.value.type === "text")
    return validateRichTextTextNodeJsonErrors(record.value, label);
  if (record.value.type === "hard_break")
    return validateRichTextHardBreakNodeJsonErrors(record.value, label);
  return validateRichTextAtomNodeJsonErrors(record.value, label, options);
}

function validateRichTextTextNodeJsonErrors(
  node: Record<string, unknown>,
  label: string,
): string[] {
  const errors: string[] = [
    ...validateAllowedKeys(node, ["type", "text", "marks"], label),
    ...(typeof node.text === "string"
      ? []
      : [`${label}.text must be a string`]),
  ];
  errors.push(...validateOptionalRichTextMarks(node.marks, `${label}.marks`));
  return errors;
}

function validateRichTextHardBreakNodeJsonErrors(
  node: Record<string, unknown>,
  label: string,
): string[] {
  return [
    ...validateAllowedKeys(node, ["type", "marks"], label),
    ...validateOptionalRichTextMarks(node.marks, `${label}.marks`),
  ];
}

function validateRichTextAtomNodeJsonErrors(
  node: Record<string, unknown>,
  label: string,
  options: RichInlineContentNormalizationOptions,
): string[] {
  const type = node.type;
  const errors: string[] = [
    ...validateAllowedKeys(node, ["type", "metadata", "marks"], label),
    ...(isValidAtomNodeType(type)
      ? []
      : [`${label}.type must be a valid inline atom type`]),
    ...validateOptionalRichTextMarks(node.marks, `${label}.marks`),
  ];
  if (!isValidAtomNodeType(type)) return errors;
  const definition = options.inlineAtoms?.find(
    (candidate) => candidate.type === type,
  );
  if (options.inlineAtoms && !definition) {
    errors.push(`${label}.type ${type} is not registered`);
    return errors;
  }
  if (!definition) {
    errors.push(...validateJsonObject(node.metadata, `${label}.metadata`));
    return errors;
  }
  const validation = validateAndCloneInlineAtomMetadata(
    node.metadata,
    definition.metadata,
    `${label}.metadata`,
  );
  if (!validation.valid) errors.push(...validation.errors);
  return errors;
}

function validateRichTextMarkJsonErrors(
  mark: unknown,
  label: string,
): string[] {
  const record = validateJsonRecord(mark, label);
  if (!record.valid) return [...record.errors];
  const markType = record.value.type;
  const errors: string[] = [
    ...validateAllowedKeys(record.value, ["type", "attrs"], label),
    ...(isInlineMarkName(markType)
      ? []
      : [`${label}.type must be a known inline mark`]),
  ];
  if (!isInlineMarkName(markType)) return errors;
  errors.push(
    ...validateMarkAttrs(markType, record.value.attrs, `${label}.attrs`),
  );
  return errors;
}

function validateRichTextAttrsJsonErrors(
  attrs: unknown,
  label: string,
): string[] {
  return [...validateJsonObject(attrs, label)];
}

function validateOptionalRichTextMarks(
  marks: unknown,
  label: string,
): string[] {
  if (marks === undefined) return [];
  if (!Array.isArray(marks)) return [`${label} must be an array`];
  const errors: string[] = [];
  for (let index = 0; index < marks.length; index += 1) {
    errors.push(
      ...validateRichTextMarkJsonErrors(marks[index], `${label}[${index}]`),
    );
  }
  return errors;
}

function validateMarkAttrs(
  markType: InlineMarkName,
  attrs: unknown,
  label: string,
): string[] {
  const definition = findInlineMarkDefinition(
    primitiveInlineMarkDefinitions,
    markType,
  );
  if (!definition) return [`${label} is not supported for ${markType}`];
  if (attrs === undefined) {
    return Object.values(definition.attrs).some((contract) => contract.required)
      ? [`${label} is required for ${markType}`]
      : [];
  }
  const attrsRecord = validateJsonRecord(attrs, label);
  if (!attrsRecord.valid) return [...attrsRecord.errors];
  const errors = [
    ...validateAllowedKeys(
      attrsRecord.value,
      Object.keys(definition.attrs),
      label,
    ),
  ];
  for (const [attrName, contract] of Object.entries(definition.attrs)) {
    if (contract.required && !Object.hasOwn(attrsRecord.value, attrName))
      errors.push(`${label}.${attrName} is required`);
  }
  const sanitized = sanitizeInlineMarkAttrs(definition, attrsRecord.value);
  if (!sanitized) {
    errors.push(`${label} is invalid for ${markType}`);
    return errors;
  }
  for (const key of Object.keys(attrsRecord.value)) {
    if (
      !Object.hasOwn(sanitized, key) ||
      !jsonValuesEqual(attrsRecord.value[key], sanitized[key])
    ) {
      errors.push(`${label}.${key} is invalid for ${markType}`);
    }
  }
  return errors;
}

function normalizeInlineNode(
  node: RichTextInlineNodeJson,
  options: RichInlineContentNormalizationOptions,
): RichTextInlineNodeJson {
  const marks = normalizedMarks(node.marks, options);
  if (isRichTextAtomNode(node)) {
    const definition = options.inlineAtoms?.find(
      (candidate) => candidate.type === node.type,
    );
    const metadata = definition
      ? validateAndCloneInlineAtomMetadata(node.metadata, definition.metadata)
      : null;
    if (definition && !metadata?.valid) {
      throw new TypeError(`Invalid rich text inline atom ${node.type}`);
    }
    const next = {
      ...node,
      metadata: metadata?.valid
        ? metadata.value
        : cloneJsonValue(node.metadata),
    };
    if (marks.length > 0) next.marks = sortMarks(marks);
    else delete next.marks;
    return next;
  }
  const next = { ...node };
  if (marks.length > 0) next.marks = sortMarks(marks);
  else delete next.marks;
  return next;
}

function normalizedMarks(
  marks: unknown,
  options: RichInlineContentNormalizationOptions = {},
): RichTextMarkJson[] {
  const inlineMarks = options.inlineMarks ?? primitiveInlineMarkDefinitions;
  if (!Array.isArray(marks)) return [];
  return marks.flatMap((mark) => {
    const validation = validateRichTextMarkJson(mark);
    if (!validation.valid) return [];
    const definition = findInlineMarkDefinition(
      inlineMarks,
      validation.value.type,
    );
    if (!definition) return [];
    const attrs = sanitizeInlineMarkAttrs(
      definition,
      validation.value.attrs ?? {},
    );
    if (!attrs) return [];
    return [createRichTextMark(definition.name, attrs)];
  });
}

function createRichTextMark(
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

function hasKnownMarks(node: RichTextInlineNodeJson): boolean {
  return normalizedMarks(node.marks).length > 0;
}

function inlineMarksEqual(
  left: unknown,
  right: unknown,
  options: RichInlineContentNormalizationOptions,
): boolean {
  const leftMarks = normalizedMarks(left, options);
  const rightMarks = normalizedMarks(right, options);
  if (leftMarks.length !== rightMarks.length) return false;
  return leftMarks.every((mark, index) => {
    const other = rightMarks[index];
    return Boolean(
      other &&
      mark.type === other.type &&
      inlineAttrsEqual(mark.attrs ?? {}, other.attrs ?? {}),
    );
  });
}

function inlineAttrsEqual(
  left: Readonly<Record<string, unknown>>,
  right: Readonly<Record<string, unknown>>,
): boolean {
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key, index) =>
      key === rightKeys[index] && jsonValuesEqual(left[key], right[key]),
  );
}

function validationResult<T>(
  value: unknown,
  errors: readonly string[],
): RichTextJsonValidationResult<T> {
  return errors.length === 0
    ? { valid: true, value: value as T, errors: [] }
    : { valid: false, value: null, errors };
}

function assertRichTextValidation<T>(
  result: RichTextJsonValidationResult<T>,
  kind: string,
): asserts result is Extract<RichTextJsonValidationResult<T>, { valid: true }> {
  if (!result.valid)
    throw new TypeError(`Invalid ${kind}: ${result.errors.join("; ")}`);
}

function validateJsonRecord(
  value: unknown,
  label: string,
): RichTextJsonValidationResult<Record<string, unknown>> {
  if (!isRecord(value))
    return {
      valid: false,
      value: null,
      errors: [`${label} must be a JSON object`],
    };
  const jsonErrors = validateJsonObject(value, label);
  return jsonErrors.length === 0
    ? { valid: true, value, errors: [] }
    : { valid: false, value: null, errors: [...jsonErrors] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isRichTextTextNode(
  node: RichTextInlineNodeJson,
): node is Extract<RichTextInlineNodeJson, { text: string }> {
  return node.type === "text" && typeof node.text === "string";
}

function isRichTextAtomNode(
  node: RichTextInlineNodeJson,
): node is Extract<RichTextInlineNodeJson, { metadata: JsonValue }> {
  return Object.hasOwn(node, "metadata");
}

function isValidAtomNodeType(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[a-z][a-z0-9_]*$/.test(value) &&
    value !== "text" &&
    value !== "hard_break" &&
    value !== "doc" &&
    value !== "paragraph"
  );
}
