import {
  isRichTextDocument,
  normalizeRichTextDocument,
  validateRichTextAttrsJson,
  validateRichTextInlineNodeJson,
} from "./rich-inline-content.ts";
import type {
  RichTextDocumentNodeJson,
  RichTextInlineNodeJson,
} from "./rich-inline-types.ts";
import { applyInlineMarkUpdateToRichTextDocument } from "../marks/rich-text-mark-command.ts";
import {
  richInlineContentSize,
  richInlineNodeSize,
  sliceRichInlineContentUnits,
} from "./rich-inline-units.ts";
import type { BlockDefinition } from "../../definitions/block-definition.ts";
import type { EditorModelOperationValidationResult } from "../../operations/transactions/validation-result.ts";
import type { BlockType } from "../../document/model/block.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type { InlineMarkDefinition } from "../marks/types.ts";
import type { EditorLogicalContentOperation } from "../../operations/language/logical-operations.ts";
import { validateAllowedKeys } from "../../kernel/json/allowed-keys.ts";
import {
  cloneJsonValue,
  jsonValuesEqual,
  validateJsonObject,
} from "../../kernel/json/json-value.ts";
import { isStructuralKey } from "../../kernel/identity/uuid.ts";

export interface ApplyLogicalContentOperationOptions {
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly inlineMarks: readonly InlineMarkDefinition[];
  /** The authoritative runtime has already validated and canonicalized this base. */
  readonly validatedCanonicalBase?: boolean;
}

export function createInverseLogicalContentOperation(
  operation: EditorLogicalContentOperation,
): EditorLogicalContentOperation | null {
  switch (operation.kind) {
    case "insertInlineContent": {
      const insertedSize = operation.content.reduce(
        (total, node) => total + richInlineNodeSize(node),
        0,
      );
      return {
        kind: "deleteInlineRange",
        blockId: operation.blockId,
        blockType: operation.blockType,
        target: operation.target,
        range: {
          from: operation.position,
          to: {
            blockId: operation.position.blockId,
            offset: operation.position.offset + insertedSize,
            ...(operation.position.contentVersion === undefined
              ? {}
              : { contentVersion: operation.position.contentVersion }),
          },
        },
        deletedContent: operation.content,
      };
    }
    case "deleteInlineRange":
      return operation.deletedContent && operation.deletedContent.length > 0
        ? {
            kind: "insertInlineContent",
            blockId: operation.blockId,
            blockType: operation.blockType,
            target: operation.target,
            position: operation.range.from,
            content: operation.deletedContent,
          }
        : null;
    case "replaceInlineRange":
      return operation.deletedContent
        ? {
            kind: "replaceInlineRange",
            blockId: operation.blockId,
            blockType: operation.blockType,
            target: operation.target,
            range: {
              from: operation.range.from,
              to: {
                blockId: operation.range.from.blockId,
                offset:
                  operation.range.from.offset +
                  operation.content.reduce(
                    (total, node) => total + richInlineNodeSize(node),
                    0,
                  ),
                ...(operation.range.from.contentVersion === undefined
                  ? {}
                  : { contentVersion: operation.range.from.contentVersion }),
              },
            },
            content: operation.deletedContent,
            deletedContent: operation.content,
          }
        : null;
    case "addInlineMark":
      return {
        ...operation,
        kind: "removeInlineMark",
      };
    case "removeInlineMark":
      return {
        ...operation,
        kind: "addInlineMark",
      };
    case "setInlineEntity":
      return operation.deletedContent
        ? {
            kind: "replaceInlineRange",
            blockId: operation.blockId,
            blockType: operation.blockType,
            target: operation.target,
            range: operation.range,
            content: operation.deletedContent,
            deletedContent: [operation.entity],
          }
        : null;
  }
}

export function applyLogicalContentOperationToRichTextDocument(
  blockType: BlockType,
  content: unknown,
  operation: EditorLogicalContentOperation,
  options: ApplyLogicalContentOperationOptions,
): RichTextDocumentNodeJson | null {
  const base = normalizeRichTextApplyInput(
    blockType,
    content,
    options.validatedCanonicalBase,
  );
  if (!base) return null;
  switch (operation.kind) {
    case "insertInlineContent":
      return replaceInlineRangeExact(
        base,
        blockType,
        operation.position.offset,
        operation.position.offset,
        operation.content,
      );
    case "deleteInlineRange":
      return expectedContentMatchesExactRange(
        base,
        blockType,
        operation.range.from.offset,
        operation.range.to.offset,
        operation.deletedContent,
      )
        ? replaceInlineRangeExact(
            base,
            blockType,
            operation.range.from.offset,
            operation.range.to.offset,
            [],
          )
        : null;
    case "replaceInlineRange":
      return expectedContentMatchesExactRange(
        base,
        blockType,
        operation.range.from.offset,
        operation.range.to.offset,
        operation.deletedContent,
      )
        ? replaceInlineRangeExact(
            base,
            blockType,
            operation.range.from.offset,
            operation.range.to.offset,
            operation.content,
          )
        : null;
    case "setInlineEntity":
      return expectedContentMatchesExactRange(
        base,
        blockType,
        operation.range.from.offset,
        operation.range.to.offset,
        operation.deletedContent,
      )
        ? replaceInlineRangeExact(
            base,
            blockType,
            operation.range.from.offset,
            operation.range.to.offset,
            [operation.entity],
          )
        : null;
    case "addInlineMark":
    case "removeInlineMark": {
      if (
        !rangeWithinDocument(
          base,
          operation.range.from.offset,
          operation.range.to.offset,
        )
      )
        return null;
      const result = applyInlineMarkUpdateToRichTextDocument(
        blockType,
        base,
        operation.markName,
        {
          from: operation.range.from.offset,
          to: operation.range.to.offset,
        },
        {
          blockDefinitions: options.blockDefinitions,
          inlineMarks: options.inlineMarks,
          action: operation.kind === "addInlineMark" ? "add" : "remove",
          attrs: operation.attrs,
        },
      );
      return result.changed ? result.content : base;
    }
  }
}

export function validateLogicalContentOperation(
  operation: unknown,
): EditorModelOperationValidationResult {
  if (isValidPlainTextOperation(operation)) {
    return validOperationResult;
  }
  const errors = validateLogicalContentOperationErrors(operation);
  return { valid: errors.length === 0, errors };
}

const validOperationResult = Object.freeze({
  valid: true,
  errors: Object.freeze([]),
});

export function isValidPlainTextOperation(
  operation: unknown,
): boolean {
  if (!isRecord(operation) || !validContentOperationBaseFast(operation)) {
    return false;
  }
  if (operation.kind === "insertInlineContent") {
    return (
      exactKeys(operation, 6) &&
      validPointFast(operation.position) &&
      plainTextNodes(operation.content, true)
    );
  }
  if (operation.kind === "deleteInlineRange") {
    return (
      exactKeys(operation, operation.deletedContent === undefined ? 5 : 6) &&
      validRangeFast(operation.range) &&
      (operation.deletedContent === undefined ||
        plainTextNodes(operation.deletedContent, false))
    );
  }
  if (operation.kind === "replaceInlineRange") {
    return (
      exactKeys(operation, operation.deletedContent === undefined ? 6 : 7) &&
      validRangeFast(operation.range) &&
      plainTextNodes(operation.content, true) &&
      (operation.deletedContent === undefined ||
        plainTextNodes(operation.deletedContent, false))
    );
  }
  return false;
}

function validContentOperationBaseFast(
  operation: Record<string, unknown>,
): boolean {
  const target = operation.target;
  return (
    isBlockId(operation.blockId) &&
    isNonEmptyString(operation.blockType) &&
    isRecord(target) &&
    target.kind === "text" &&
    exactKeys(target, 1)
  );
}

function validRangeFast(value: unknown): boolean {
  if (!isRecord(value) || !exactKeys(value, 2)) return false;
  return (
    validPointFast(value.from) &&
    validPointFast(value.to) &&
    (value.to as { readonly offset: number }).offset >=
      (value.from as { readonly offset: number }).offset
  );
}

function validPointFast(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const contentVersion = value.contentVersion;
  return (
    exactKeys(value, contentVersion === undefined ? 2 : 3) &&
    isBlockId(value.blockId) &&
    Number.isSafeInteger(value.offset) &&
    Number(value.offset) >= 0 &&
    (contentVersion === undefined ||
      contentVersion === null ||
      isNonEmptyString(contentVersion))
  );
}

function plainTextNodes(value: unknown, requireNonEmpty: boolean): boolean {
  if (!Array.isArray(value) || (requireNonEmpty && value.length === 0)) {
    return false;
  }
  for (const node of value) {
    if (
      !isRecord(node) ||
      !exactKeys(node, 2) ||
      node.type !== "text" ||
      typeof node.text !== "string" ||
      node.text.length === 0
    ) {
      return false;
    }
  }
  return true;
}

function exactKeys(value: Record<string, unknown>, expected: number): boolean {
  let count = 0;
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    count += 1;
  }
  return count === expected;
}

export function isLogicalContentOperationKind(
  kind: unknown,
): kind is EditorLogicalContentOperation["kind"] {
  return (
    kind === "insertInlineContent" ||
    kind === "deleteInlineRange" ||
    kind === "replaceInlineRange" ||
    kind === "addInlineMark" ||
    kind === "removeInlineMark" ||
    kind === "setInlineEntity"
  );
}

function replaceInlineRangeExact(
  base: RichTextDocumentNodeJson,
  blockType: BlockType,
  from: number,
  to: number,
  replacement: readonly RichTextInlineNodeJson[],
): RichTextDocumentNodeJson | null {
  if (!rangeWithinDocument(base, from, to)) return null;
  const block = base.content[0] ?? { type: "paragraph" as const };
  const inline = block.content ?? [];
  const contentSize = richInlineContentSize(inline);
  if (from === contentSize && to === contentSize) {
    if (replacement.length === 0) return base;
    const next = [...inline];
    for (const replacementNode of replacement) {
      appendCanonicalInlineNode(next, cloneInlineNode(replacementNode));
    }
    return {
      type: "doc",
      content: [
        {
          ...block,
          type: "paragraph" as const,
          content: next,
        },
      ],
    };
  }
  const removed = sliceRichInlineContentUnits(inline, from, to);
  if (inlineContentEqual(removed, replacement)) return base;

  const next: RichTextInlineNodeJson[] = [];
  let cursor = 0;
  let inserted = false;
  for (const node of inline) {
    const size = richInlineNodeSize(node);
    const nodeStart = cursor;
    const nodeEnd = cursor + size;
    cursor = nodeEnd;
    if (nodeEnd <= from) {
      appendCanonicalInlineNode(next, node);
      continue;
    }
    if (!inserted) {
      if (nodeStart < from) {
        const prefix = sliceRichInlineContentUnits(
          [node],
          0,
          from - nodeStart,
        )[0];
        if (prefix) appendCanonicalInlineNode(next, prefix);
      }
      for (const replacementNode of replacement) {
        appendCanonicalInlineNode(next, cloneInlineNode(replacementNode));
      }
      inserted = true;
    }
    if (nodeEnd <= to) continue;
    if (nodeStart < to) {
      const suffix = sliceRichInlineContentUnits(
        [node],
        to - nodeStart,
        size,
      )[0];
      if (suffix) appendCanonicalInlineNode(next, suffix);
      continue;
    }
    appendCanonicalInlineNode(next, node);
  }
  if (!inserted) {
    for (const replacementNode of replacement) {
      appendCanonicalInlineNode(next, cloneInlineNode(replacementNode));
    }
  }
  const nextBlock = {
    ...block,
    type: "paragraph" as const,
    ...(next.length === 0 ? {} : { content: next }),
  };
  if (next.length === 0) delete nextBlock.content;
  return { type: "doc", content: [nextBlock] };
}

function expectedContentMatchesExactRange(
  base: RichTextDocumentNodeJson,
  blockType: BlockType,
  from: number,
  to: number,
  expectedContent: readonly RichTextInlineNodeJson[] | undefined,
): boolean {
  if (!rangeWithinDocument(base, from, to)) return false;
  if (!expectedContent || expectedContent.length === 0) return true;
  return inlineContentMatchesRange(base, blockType, from, to, expectedContent);
}

function rangeWithinDocument(
  base: RichTextDocumentNodeJson,
  from: number,
  to: number,
): boolean {
  const size = richInlineContentSize(base.content[0]?.content ?? []);
  return (
    Number.isInteger(from) &&
    Number.isInteger(to) &&
    from >= 0 &&
    to >= from &&
    to <= size
  );
}

function inlineContentMatchesRange(
  base: RichTextDocumentNodeJson,
  blockType: BlockType,
  from: number,
  to: number,
  expectedContent: readonly RichTextInlineNodeJson[],
): boolean {
  void blockType;
  const actual = sliceRichInlineContentUnits(
    base.content[0]?.content ?? [],
    from,
    to,
  );
  return inlineContentEqual(actual, expectedContent);
}

function inlineContentEqual(
  left: readonly RichTextInlineNodeJson[],
  right: readonly RichTextInlineNodeJson[],
): boolean {
  return (
    left.length === right.length &&
    left.every((unit, index) => inlineNodesEqual(unit, right[index]))
  );
}

function appendCanonicalInlineNode(
  target: RichTextInlineNodeJson[],
  node: RichTextInlineNodeJson,
): void {
  const previous = target[target.length - 1];
  if (
    previous?.type === "text" &&
    typeof previous.text === "string" &&
    node.type === "text" &&
    typeof node.text === "string" &&
    jsonValuesEqual(previous.marks ?? null, node.marks ?? null)
  ) {
    target[target.length - 1] = {
      ...previous,
      text: previous.text + node.text,
    };
    return;
  }
  target.push(node);
}

function validateLogicalContentOperationErrors(operation: unknown): string[] {
  if (!isRecord(operation)) return ["operation must be an object"];
  const jsonErrors = validateJsonObject(operation, "operation");
  switch (operation.kind) {
    case "insertInlineContent":
      return [
        ...jsonErrors,
        ...validateAllowedKeys(
          operation,
          ["kind", "blockId", "blockType", "target", "position", "content"],
          "operation",
        ),
        ...validateContentOperationBase(operation),
        ...validatePoint(operation.position, "operation.position"),
        ...validateInlineContent(operation.content, "operation.content", true),
      ];
    case "deleteInlineRange":
      return [
        ...jsonErrors,
        ...validateAllowedKeys(
          operation,
          ["kind", "blockId", "blockType", "target", "range", "deletedContent"],
          "operation",
        ),
        ...validateContentOperationBase(operation),
        ...validateRange(operation.range, "operation.range"),
        ...validateOptionalInlineContent(
          operation.deletedContent,
          "operation.deletedContent",
        ),
      ];
    case "replaceInlineRange":
      return [
        ...jsonErrors,
        ...validateAllowedKeys(
          operation,
          [
            "kind",
            "blockId",
            "blockType",
            "target",
            "range",
            "content",
            "deletedContent",
          ],
          "operation",
        ),
        ...validateContentOperationBase(operation),
        ...validateRange(operation.range, "operation.range"),
        ...validateInlineContent(operation.content, "operation.content", true),
        ...validateOptionalInlineContent(
          operation.deletedContent,
          "operation.deletedContent",
        ),
      ];
    case "addInlineMark":
    case "removeInlineMark":
      return [
        ...jsonErrors,
        ...validateAllowedKeys(
          operation,
          [
            "kind",
            "blockId",
            "blockType",
            "target",
            "range",
            "markName",
            "attrs",
          ],
          "operation",
        ),
        ...validateContentOperationBase(operation),
        ...validateRange(operation.range, "operation.range"),
        ...(isNonEmptyString(operation.markName)
          ? []
          : ["operation.markName is required"]),
        ...validateOptionalRichTextAttrs(operation.attrs, "operation.attrs"),
      ];
    case "setInlineEntity":
      return [
        ...jsonErrors,
        ...validateAllowedKeys(
          operation,
          [
            "kind",
            "blockId",
            "blockType",
            "target",
            "range",
            "entity",
            "deletedContent",
          ],
          "operation",
        ),
        ...validateContentOperationBase(operation),
        ...validateRange(operation.range, "operation.range"),
        ...validateRequiredInlineNode(operation.entity, "operation.entity"),
        ...validateOptionalInlineContent(
          operation.deletedContent,
          "operation.deletedContent",
        ),
      ];
    default:
      return [
        `unsupported logical content operation kind ${String(operation.kind)}`,
      ];
  }
}

function validateContentOperationBase(
  operation: Record<string, unknown>,
): string[] {
  return [
    ...validateBlockOperationBase(operation),
    ...validateTarget(operation.target, "operation.target"),
  ];
}

function validateBlockOperationBase(
  operation: Record<string, unknown>,
): string[] {
  return [
    ...(isBlockId(operation.blockId)
      ? []
      : ["operation.blockId must be a non-empty structural key"]),
    ...(isNonEmptyString(operation.blockType)
      ? []
      : ["operation.blockType is required"]),
  ];
}

function validateTarget(target: unknown, label: string): string[] {
  if (!isRecord(target)) return [`${label} must be an object`];
  const errors: string[] = [];
  if (target.kind !== "text") errors.push(`${label}.kind must be text`);
  errors.push(...validateAllowedKeys(target, ["kind"], label));
  return errors;
}

function validateRange(range: unknown, label: string): string[] {
  if (!isRecord(range)) return [`${label} must be an object`];
  const errors = [
    ...validateAllowedKeys(range, ["from", "to"], label),
    ...validatePoint(range.from, `${label}.from`),
    ...validatePoint(range.to, `${label}.to`),
  ];
  if (
    isRecord(range.from) &&
    isRecord(range.to) &&
    Number.isInteger(range.from.offset) &&
    Number.isInteger(range.to.offset) &&
    Number(range.to.offset) < Number(range.from.offset)
  ) {
    errors.push(
      `${label}.to.offset must be greater than or equal to from.offset`,
    );
  }
  return errors;
}

function validatePoint(point: unknown, label: string): string[] {
  if (!isRecord(point)) return [`${label} must be an object`];
  const errors: string[] = validateAllowedKeys(
    point,
    ["blockId", "offset", "contentVersion"],
    label,
  );
  if (!isBlockId(point.blockId))
    errors.push(`${label}.blockId must be a non-empty structural key`);
  if (!Number.isInteger(point.offset) || Number(point.offset) < 0)
    errors.push(`${label}.offset must be a non-negative integer`);
  if (
    point.contentVersion !== undefined &&
    point.contentVersion !== null &&
    !isNonEmptyString(point.contentVersion)
  ) {
    errors.push(`${label}.contentVersion must be a non-empty string or null`);
  }
  return errors;
}

function validateInlineContent(
  value: unknown,
  label: string,
  requireNonEmpty: boolean,
): string[] {
  if (!Array.isArray(value)) return [`${label} must be an array`];
  if (requireNonEmpty && value.length === 0)
    return [`${label} must not be empty`];
  const errors: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const node = value[index];
    if (!isRecord(node) || Array.isArray(node)) {
      errors.push(`${label}[${index}] must be a JSON object`);
      continue;
    }
    const result = validateRichTextInlineNodeJson(node, `${label}[${index}]`);
    if (!result.valid) errors.push(...result.errors);
  }
  return errors;
}

function validateOptionalInlineContent(
  value: unknown,
  label: string,
): string[] {
  return value === undefined ? [] : validateInlineContent(value, label, false);
}

function validateRequiredInlineNode(value: unknown, label: string): string[] {
  const result = validateRichTextInlineNodeJson(value, label);
  return result.valid ? [] : [...result.errors];
}

function validateOptionalRichTextAttrs(
  value: unknown,
  label: string,
): string[] {
  if (value === undefined || value === null) return [];
  const result = validateRichTextAttrsJson(value, label);
  return result.valid ? [] : [...result.errors];
}

function cloneInlineNode(node: RichTextInlineNodeJson): RichTextInlineNodeJson {
  return cloneJsonValue(node);
}

function inlineNodesEqual(
  left: RichTextInlineNodeJson | undefined,
  right: RichTextInlineNodeJson | undefined,
): boolean {
  return jsonValuesEqual(left ?? null, right ?? null);
}

function isBlockId(value: unknown): value is BlockId {
  return typeof value === "string" && isStructuralKey(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeRichTextApplyInput(
  blockType: BlockType,
  content: unknown,
  validatedCanonicalBase = false,
): RichTextDocumentNodeJson | null {
  if (validatedCanonicalBase) {
    return content &&
      typeof content === "object" &&
      !Array.isArray(content) &&
      (content as { readonly type?: unknown }).type === "doc" &&
      Array.isArray((content as { readonly content?: unknown }).content)
      ? (content as RichTextDocumentNodeJson)
      : null;
  }
  return isRichTextDocument(content)
    ? normalizeRichTextDocument(blockType, content)
    : null;
}
