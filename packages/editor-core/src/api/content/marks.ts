export {
  boldMarkDefinition,
  codeMarkDefinition,
  findInlineMarkDefinition,
  inlineMarkDefinitionByName,
  isInlineMarkName,
  italicMarkDefinition,
  linkMarkDefinition,
  primitiveInlineMarkDefinitions,
  sanitizeInlineMarkAttrs,
  strikethroughMarkDefinition,
  underlineMarkDefinition,
} from "../../content/marks/schema.ts";
export type {
  InlineMarkBlockPolicy,
  InlineMarkDefinition,
  InlineMarkName,
} from "../../content/marks/types.ts";
export {
  combineInlineMarkCommandStates,
  createInlineMarkCommandStateFromRange,
  createInlineMarkCursorCommandState,
  distinctInlineMarkValues,
  inactiveInlineMarkCommandState,
  inlineMarkValuesEqual,
  isInlineMarkCommandRangeSegmentMarkable,
  missingInlineMarkCommandState,
  planInlineMarkCommand,
  resolveInlineMarkCommandAction,
  resolveInlineMarkCommandAttrs,
  validateInlineMarkCommandAttrs,
} from "../../content/marks/mark-command.ts";
export type {
  InlineMarkCommandAction,
  InlineMarkCommandPlan,
  InlineMarkCommandRange,
  InlineMarkCommandRangeSegment,
  InlineMarkCommandRangeSegmentKind,
  InlineMarkCommandReason,
  InlineMarkCommandState,
  ResolvedInlineMarkCommandAction,
} from "../../content/marks/mark-command.ts";
export {
  applyInlineMarkUpdateToRichTextDocument,
  readInlineMarkCommandStateFromRichTextDocument,
} from "../../content/marks/rich-text-mark-command.ts";
export type {
  RichTextInlineMarkCommandOptions,
  RichTextInlineMarkCommandRange,
  RichTextInlineMarkCommandResult,
} from "../../content/marks/rich-text-mark-command.ts";
