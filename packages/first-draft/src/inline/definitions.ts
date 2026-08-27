import {
  boldMarkDefinition,
  codeMarkDefinition,
  italicMarkDefinition,
  linkMarkDefinition,
  strikethroughMarkDefinition,
  underlineMarkDefinition,
} from "./marks.ts";
import { firstDraftMentionDefinition } from "./mentions.tsx";

export const firstDraftInlineMarks = Object.freeze([
  boldMarkDefinition,
  italicMarkDefinition,
  codeMarkDefinition,
  linkMarkDefinition,
  strikethroughMarkDefinition,
  underlineMarkDefinition,
]);

export const firstDraftInlineAtoms = Object.freeze([
  firstDraftMentionDefinition,
]);

