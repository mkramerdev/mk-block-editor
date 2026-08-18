import { validateLogicalBlockGraphOperation } from "./block-graph.ts";
import {
  isLogicalContentOperationKind,
  validateLogicalContentOperation,
} from "../../content/rich-text/content-operations.ts";
import { validateUpdateBlockMetadataOperation } from "../../metadata/operation-validation.ts";
export {
  validateUpdateBlockMetadataOperation,
} from "../../metadata/operation-validation.ts";
import type { EditorModelOperationValidationResult } from "../transactions/validation-result.ts";
export type {
  EditorDeleteInlineRangeOperation,
  BlockMetadataDeletion,
  BlockMetadataUpdate,
  EditorInlineMarkRangeOperation,
  EditorInsertInlineContentOperation,
  EditorLogicalBlockGraphOperation,
  EditorLogicalBlockMetadataOperation,
  EditorLogicalContentOperation,
  EditorLogicalInlineTarget,
  EditorLogicalOperation,
  EditorLogicalRichTextPoint,
  EditorLogicalRichTextRange,
  EditorReplaceInlineRangeOperation,
  EditorSetInlineEntityOperation,
  UpdateBlockMetadataOperation,
} from "../language/logical-operations.ts";

export function validateEditorLogicalOperationBody(
  operation: unknown,
): EditorModelOperationValidationResult {
  if (!isRecord(operation))
    return { valid: false, errors: ["operation must be an object"] };
  if (operation.kind === "blockGraph")
    return validateLogicalBlockGraphOperation(operation);
  if (operation.kind === "updateBlockMetadata")
    return validateUpdateBlockMetadataOperation(operation);
  if (isLogicalContentOperationKind(operation.kind))
    return validateLogicalContentOperation(operation);
  return {
    valid: false,
    errors: [`unsupported logical operation kind ${String(operation.kind)}`],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
