import type { RichTextDocumentNodeJson } from "../../content/rich-text/rich-inline-types.ts";
import type { RichInlineContentNormalizationOptions } from "../../content/rich-text/rich-inline-content.ts";
import {
  prepareLogicalContentOperationToRichTextDocument,
  validateLogicalContentOperation,
  isValidPlainTextOperation,
  type ApplyLogicalContentOperationOptions,
} from "../../content/rich-text/content-operations.ts";
import {
  isRichTextDocument,
  normalizeRichTextDocument,
  validateRichTextInlineNodeJson,
} from "../../content/rich-text/rich-inline-content.ts";
import { rebaseLogicalContentOperationByExpectedContent } from "../../content/rich-text/content-rebase.ts";
import type { BlockType } from "../../document/model/block.ts";
import type { EditorContentOperationUpdate } from "../../kernel/content/encoded-content.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import type { EditorLogicalContentOperation } from "../language/logical-operations.ts";
import { cloneJsonValue, jsonValuesEqual } from "../../kernel/json/json-value.ts";

export interface EditorContentBaseToken {
  readonly graphRevision: number;
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly contentRevision: number;
}

export interface EditorContentCommitChange {
  readonly baseToken: EditorContentBaseToken;
  readonly operations: readonly EditorLogicalContentOperation[];
}

export interface EditorContentCommitInput {
  readonly graphRevision: number;
  readonly resultingGraphRevision?: number;
  readonly changes: readonly EditorContentCommitChange[];
  readonly introducedBlocks?: Readonly<Partial<Record<BlockId, BlockType>>>;
  readonly removedBlockIds?: readonly BlockId[];
  readonly origin?: unknown;
}

export type ContentCommitRejectionReason =
  | "stale-graph-revision"
  | "missing-block"
  | "block-type-mismatch"
  | "stale-content-revision"
  | "invalid-operation"
  | "invalid-update";

export interface ContentCommitRejection {
  readonly ok: false;
  readonly reason: ContentCommitRejectionReason;
  readonly message: string;
  readonly changeIndex?: number;
  readonly blockId?: BlockId;
}

export interface ValidatedContentCommit {
  readonly kind: "validated-content-commit";
  readonly affectedBlockIds: readonly BlockId[];
  readonly blocks: readonly ValidatedContentBlock[];
  readonly removedBlocks: readonly ValidatedRemovedContentBlock[];
}

export interface ValidatedContentBlock {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly contentOperations: readonly EditorLogicalContentOperation[];
  readonly inverseContentOperations: readonly EditorLogicalContentOperation[];
}

/** Teardown data used only to construct an exact inverse graph transaction. */
export interface ValidatedRemovedContentBlock {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly inverseContentOperations: readonly EditorLogicalContentOperation[];
}

export interface EditorPreparedContentTextPoint {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly textOffset: number;
}

export type EditorPreparedContentTextPointValidation =
  | { readonly ok: true; readonly textOffset: number }
  | {
      readonly ok: false;
      readonly reason: "invalid" | "missing-text";
      readonly message?: string;
    };

export interface AppliedContentBlock {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly baseToken: EditorContentBaseToken;
  readonly committedToken: EditorContentBaseToken;
  readonly operationUpdate: EditorContentOperationUpdate;
  readonly contentOperations: readonly EditorLogicalContentOperation[];
  readonly inverseContentOperations: readonly EditorLogicalContentOperation[];
}

export interface AppliedContentCommit {
  readonly kind: "applied-content-commit";
  readonly baseGraphRevision: number;
  readonly graphRevision: number;
  readonly affectedBlockIds: readonly BlockId[];
  readonly blocks: readonly AppliedContentBlock[];
  readonly origin?: unknown;
}

export interface EditorRemoteContentUpdateProposal {
  readonly base: EditorContentBaseToken;
  readonly update: EditorContentOperationUpdate;
  readonly readProjection: RichTextDocumentNodeJson;
  readonly source?: unknown;
}

export interface EditorRemoteContentCommitInput {
  readonly graphRevision: number;
  readonly resultingGraphRevision: number;
  readonly updates: readonly EditorRemoteContentUpdateProposal[];
  readonly introducedBlocks?: Readonly<Partial<Record<BlockId, BlockType>>>;
  readonly removedBlockIds?: readonly BlockId[];
  readonly origin?: unknown;
}

export interface EditorContentCommitPort {
  readContentBaseToken(
    blockId: BlockId,
    blockType: BlockType,
    graphRevision: number,
  ): EditorContentBaseToken;
  validateContentCommit(
    input: EditorContentCommitInput,
  ): ValidatedContentCommit | ContentCommitRejection;
  validateRemoteContentCommit(
    input: EditorRemoteContentCommitInput,
  ): ValidatedContentCommit | ContentCommitRejection;
  validateContentTextPoint(
    validated: ValidatedContentCommit,
    point: EditorPreparedContentTextPoint,
  ): EditorPreparedContentTextPointValidation;
  readValidatedBlockContent(
    validated: ValidatedContentCommit,
    blockId: BlockId,
    blockType: BlockType,
  ): RichTextDocumentNodeJson | null;
  commitContent(validated: ValidatedContentCommit): AppliedContentCommit;
  publishContentCommit(applied: AppliedContentCommit): void;
  markInconsistent(message: string): never;
}

/** Establishes deep immutable ownership for logical values at publication. */
export function ownPublishedLogicalContentOperations(
  operations: readonly EditorLogicalContentOperation[],
): readonly EditorLogicalContentOperation[] {
  if (isDeeplyFrozen(operations)) return operations;
  return deepFreeze(cloneJsonValue(operations));
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function isDeeplyFrozen(value: unknown): boolean {
  if (!value || typeof value !== "object" || !Object.isFrozen(value)) {
    return value === null || typeof value !== "object";
  }
  return Object.values(value as Record<string, unknown>).every(isDeeplyFrozen);
}

export interface PrepareLogicalContentOperationsOptions
  extends ApplyLogicalContentOperationOptions {
  readonly normalization?: RichInlineContentNormalizationOptions;
  /** The owning runtime already validated the exact requested operations. */
  readonly validatedOperations?: boolean;
}

export type PreparedLogicalContentOperations =
  | {
      readonly ok: true;
      readonly content: RichTextDocumentNodeJson;
      readonly operations: readonly EditorLogicalContentOperation[];
      readonly inverseOperations: readonly EditorLogicalContentOperation[];
      readonly transitions: readonly PreparedLogicalContentTransition[];
    }
  | { readonly ok: false; readonly message: string };

export interface PreparedLogicalContentTransition {
  readonly before: RichTextDocumentNodeJson;
  readonly after: RichTextDocumentNodeJson;
  readonly operation: EditorLogicalContentOperation;
  readonly inverseOperation: EditorLogicalContentOperation;
}

/**
 * Validates the canonical transaction shape that is independent of a concrete
 * content store. Runtime-specific graph and content revision checks remain the
 * responsibility of the runtime preparing the commit.
 */
export function validateContentCommitInput(
  input: EditorContentCommitInput,
): ContentCommitRejection | null {
  if (!isValidGraphRevision(input.graphRevision)) {
    return rejection(
      "stale-graph-revision",
      `Content commit graph revision ${String(input.graphRevision)} is invalid`,
    );
  }
  if (
    input.resultingGraphRevision !== undefined &&
    !isValidGraphRevision(input.resultingGraphRevision)
  ) {
    return rejection(
      "stale-graph-revision",
      `Resulting content graph revision ${String(input.resultingGraphRevision)} is invalid`,
    );
  }

  if (
    input.changes.length === 1 &&
    input.introducedBlocks === undefined &&
    input.removedBlockIds === undefined
  ) {
    const change = input.changes[0]!;
    const blockId = change.baseToken.blockId;
    if (change.operations.length === 0) {
      return rejection(
        "invalid-operation",
        "Content operation batches must not be empty",
        blockId,
        0,
      );
    }
    if (change.baseToken.graphRevision !== input.graphRevision) {
      return rejection(
        "stale-graph-revision",
        `Content base token for ${blockId} does not match the transaction graph revision`,
        blockId,
        0,
      );
    }
    for (const operation of change.operations) {
      if (operation.blockId !== blockId) {
        return rejection(
          "invalid-operation",
          `Content operation target ${operation.blockId} does not match base token block ${blockId}`,
          blockId,
          0,
        );
      }
      if (operation.blockType !== change.baseToken.blockType) {
        return rejection(
          "block-type-mismatch",
          `Content operation type ${operation.blockType} does not match base token type ${change.baseToken.blockType}`,
          blockId,
          0,
        );
      }
      const validation = validateLogicalContentOperation(operation);
      if (!validation.valid) {
        return rejection(
          "invalid-operation",
          `Logical content operation is invalid: ${validation.errors.join(", ")}`,
          blockId,
          0,
        );
      }
    }
    return null;
  }

  const removedBlockIds = new Set(input.removedBlockIds ?? []);
  if (removedBlockIds.size !== (input.removedBlockIds?.length ?? 0)) {
    return rejection(
      "invalid-operation",
      "Removed content block ids must not contain duplicates",
    );
  }
  for (const blockId of Object.keys(
    input.introducedBlocks ?? {},
  ) as BlockId[]) {
    if (removedBlockIds.has(blockId)) {
      return rejection(
        "invalid-operation",
        `Content block ${blockId} cannot be introduced and removed together`,
        blockId,
      );
    }
  }

  const changedBlockIds = new Set<BlockId>();
  for (const [changeIndex, change] of input.changes.entries()) {
    const blockId = change.baseToken.blockId;
    if (change.operations.length === 0) {
      return rejection(
        "invalid-operation",
        "Content operation batches must not be empty",
        blockId,
        changeIndex,
      );
    }
    if (changedBlockIds.has(blockId)) {
      return rejection(
        "invalid-operation",
        `Duplicate content operation batch for ${blockId}`,
        blockId,
        changeIndex,
      );
    }
    changedBlockIds.add(blockId);
    if (change.baseToken.graphRevision !== input.graphRevision) {
      return rejection(
        "stale-graph-revision",
        `Content base token for ${blockId} does not match the transaction graph revision`,
        blockId,
        changeIndex,
      );
    }
    if (removedBlockIds.has(blockId)) {
      return rejection(
        "invalid-operation",
        `Removed content block ${blockId} cannot also receive operations`,
        blockId,
        changeIndex,
      );
    }
    for (const operation of change.operations) {
      if (operation.blockId !== blockId) {
        return rejection(
          "invalid-operation",
          `Content operation target ${operation.blockId} does not match base token block ${blockId}`,
          blockId,
          changeIndex,
        );
      }
      if (operation.blockType !== change.baseToken.blockType) {
        return rejection(
          "block-type-mismatch",
          `Content operation type ${operation.blockType} does not match base token type ${change.baseToken.blockType}`,
          blockId,
          changeIndex,
        );
      }
      const validation = validateLogicalContentOperation(operation);
      if (!validation.valid) {
        return rejection(
          "invalid-operation",
          `Logical content operation is invalid: ${validation.errors.join(", ")}`,
          blockId,
          changeIndex,
        );
      }
    }
  }
  return null;
}

/**
 * Prepares the exact effective operation sequence represented by a logical
 * content result. Inverses are derived once, from those effective operations.
 */
export function prepareLogicalContentOperations(input: {
  readonly blockType: BlockType;
  readonly content: RichTextDocumentNodeJson;
  readonly operations: readonly EditorLogicalContentOperation[];
  readonly origin?: unknown;
  readonly options: PrepareLogicalContentOperationsOptions;
}): PreparedLogicalContentOperations {
  let content = input.content;
  if (!input.options.validatedCanonicalBase) {
    if (!isRichTextDocument(content, input.options.normalization)) {
      return {
        ok: false,
        message: "Logical content base is not valid rich-text content",
      };
    }
    const normalized = normalizeRichTextDocument(
      input.blockType,
      content,
      input.options.normalization,
    );
    if (!jsonValuesEqual(content, normalized)) {
      return {
        ok: false,
        message: "Logical content base is not canonically normalized",
      };
    }
  }
  const operations: EditorLogicalContentOperation[] = [];
  const inverseOperations: EditorLogicalContentOperation[] = [];
  const transitions: PreparedLogicalContentTransition[] = [];
  for (const requestedOperation of input.operations) {
    if (!input.options.validatedOperations) {
      const requestedValidation =
        validateLogicalContentOperation(requestedOperation);
      if (!requestedValidation.valid) {
        return {
          ok: false,
          message: `Logical content operation is invalid: ${requestedValidation.errors.join(", ")}`,
        };
      }
    }
    const effectiveOperation =
      input.origin === "undo" || input.origin === "redo"
        ? rebaseLogicalContentOperationByExpectedContent(
            requestedOperation.blockType,
            content,
            requestedOperation,
          )
        : requestedOperation;
    if (!effectiveOperation) {
      return { ok: false, message: "Logical content operation is stale" };
    }
    if (
      !input.options.validatedOperations ||
      effectiveOperation !== requestedOperation
    ) {
      const effectiveValidation =
        validateLogicalContentOperation(effectiveOperation);
      if (!effectiveValidation.valid) {
        return {
          ok: false,
          message: `Effective logical content operation is invalid: ${effectiveValidation.errors.join(", ")}`,
        };
      }
    }
    const affectedContentFailure = validateAffectedInlineContent(
      effectiveOperation,
      input.options.normalization,
    );
    if (affectedContentFailure) {
      return { ok: false, message: affectedContentFailure };
    }
    const transition = prepareLogicalContentOperationToRichTextDocument(
      input.blockType,
      content,
      effectiveOperation,
      { ...input.options, validatedCanonicalBase: true },
    );
    if (!transition) {
      return {
        ok: false,
        message: "Logical content operation is inapplicable",
      };
    }
    if (!transition.inverseOperation) {
      return {
        ok: false,
        message: "Logical content operation is not reversibly representable",
      };
    }
    // These freshly prepared operations remain under the commit owner's
    // exclusive control. History freezes them at its durable ownership
    // boundary; recursively walking them here only repeats that work for every
    // character.
    const operation = transition.operation;
    const inverseOperation = transition.inverseOperation;
    transitions.push(
      Object.freeze({
        before: transition.before,
        after: transition.after,
        operation,
        inverseOperation,
      }),
    );
    content = transition.after;
    operations.push(operation);
    inverseOperations.unshift(inverseOperation);
  }
  if (inverseOperations.length !== operations.length) {
    return {
      ok: false,
      message: "Logical content operation inverses are incomplete",
    };
  }
  return {
    ok: true,
    content: Object.freeze(content),
    operations: Object.freeze(operations),
    inverseOperations: Object.freeze(inverseOperations),
    transitions: Object.freeze(transitions),
  };
}

function validateAffectedInlineContent(
  operation: EditorLogicalContentOperation,
  normalization: RichInlineContentNormalizationOptions | undefined,
): string | null {
  if (isValidPlainTextOperation(operation)) return null;
  const groups =
    operation.kind === "insertInlineContent"
      ? [operation.content]
      : operation.kind === "deleteInlineRange"
        ? [operation.deletedContent ?? []]
        : operation.kind === "replaceInlineRange"
          ? [operation.content, operation.deletedContent ?? []]
          : operation.kind === "setInlineEntity"
            ? [[operation.entity], operation.deletedContent ?? []]
            : [];
  for (const nodes of groups) {
    for (const [index, node] of nodes.entries()) {
      const validation = validateRichTextInlineNodeJson(
        node,
        `operation content[${index}]`,
        normalization,
      );
      if (!validation.valid) return validation.errors.join(", ");
    }
  }
  return null;
}

export function isContentCommitRejection(
  value: ValidatedContentCommit | ContentCommitRejection,
): value is ContentCommitRejection {
  return "ok" in value && value.ok === false;
}

function isValidGraphRevision(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0;
}

function rejection(
  reason: ContentCommitRejectionReason,
  message: string,
  blockId?: BlockId,
  changeIndex?: number,
): ContentCommitRejection {
  return {
    ok: false,
    reason,
    message,
    ...(blockId === undefined ? {} : { blockId }),
    ...(changeIndex === undefined ? {} : { changeIndex }),
  };
}
