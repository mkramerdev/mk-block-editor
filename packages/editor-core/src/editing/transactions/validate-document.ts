import type { BlockDefinition } from "../../definitions/block-definition.ts";
import {
  blockDefinitionAcceptsParent,
  blockDefinitionAcceptsSequence,
} from "../../definitions/structural-queries.ts";
import type {
  Block,
  BlockType,
  OrderedBlockGraph,
  VersionedBlock,
} from "../../document/model/block.ts";
import { deriveCanonicalOrderContext } from "../../document/ordering/canonical-order.ts";
import type { BlockId } from "../../kernel/identity/ids.ts";
import { validateBlockMetadataForDefinitionWithChildren } from "../../metadata/validation.ts";
import {
  isRichTextDocument,
  richTextDocumentContentSize,
} from "../../content/rich-text/rich-inline-content.ts";
import type { RichTextDocumentNodeJson } from "../../content/rich-text/rich-inline-types.ts";
import type {
  TransactionSelectionTarget,
  TransactionReadableContent,
} from "./types.ts";

const supportedBlockFields = new Set([
  "id",
  "type",
  "parentId",
  "tombstone",
  "metadata",
  "metadataVersion",
  "contentVersion",
]);

export type StructuralDocumentIssueKind =
  | "missing-root"
  | "duplicate-block-id"
  | "mismatched-block-id"
  | "unsupported-block-field"
  | "duplicate-containment"
  | "unknown-containment"
  | "parent-disagreement"
  | "unreachable-block"
  | "tombstone-in-containment"
  | "unknown-block-type"
  | "missing-parent"
  | "parent-cycle"
  | "invalid-parent"
  | "invalid-child-sequence"
  | "invalid-content"
  | "invalid-selection"
  | "invalid-selection";

export interface StructuralDocumentIssue {
  readonly kind: StructuralDocumentIssueKind;
  readonly message: string;
  readonly blockId?: BlockId;
  readonly blockType?: BlockType;
  readonly parentId?: BlockId | null;
  readonly relatedBlockId?: BlockId;
  readonly constraint?: string;
  readonly expected?: string;
  readonly actualChildTypes?: readonly BlockType[];
}

export interface StructuralDocumentSelectionPoint {
  readonly blockId: BlockId;
  readonly offset: number;
}

export interface StructuralDocumentSelection {
  readonly anchor: StructuralDocumentSelectionPoint;
  readonly focus: StructuralDocumentSelectionPoint;
}

export interface ValidateStructuralDocumentInput extends OrderedBlockGraph<
  Block | VersionedBlock
> {
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly readContent?: (
    blockId: BlockId,
    blockType: BlockType,
  ) => TransactionReadableContent | null;
  readonly validateContent?: (
    blockType: BlockType,
    content: RichTextDocumentNodeJson,
  ) => boolean;
  readonly selectionTarget?: TransactionSelectionTarget;
  readonly selection?: StructuralDocumentSelection | null;
  readonly validators?: readonly StructuralDocumentValidator[];
}

export interface StructuralDocumentValidatorInput extends OrderedBlockGraph<
  Block | VersionedBlock
> {
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  /**
   * When present, the candidate is derived from a previously validated
   * document by a structurally validated local transaction. Product policy
   * validators may limit their work to these blocks and their owning
   * structures. Untrusted snapshots and remote transactions omit the scope
   * and therefore require complete validation.
   */
  readonly candidateBlockIds?: readonly BlockId[];
  readonly readContent?: (
    blockId: BlockId,
    blockType: BlockType,
  ) => TransactionReadableContent | null;
}

/** Product-owned final policy over one complete, read-only candidate. */
export type StructuralDocumentValidator = (
  input: StructuralDocumentValidatorInput,
) => readonly string[];

export type StructuralDocumentValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | {
      readonly valid: false;
      readonly issues: readonly StructuralDocumentIssue[];
    };

export function validateStructuralDocument(
  input: ValidateStructuralDocumentInput,
): StructuralDocumentValidationResult {
  const issues: StructuralDocumentIssue[] = [];
  if (input.rootBlockIds.length === 0) {
    addIssue(
      issues,
      "missing-root",
      "an editor document must contain at least one live root",
    );
  }
  const contentByBlockId = new Map<
    BlockId,
    TransactionReadableContent | null
  >();
  const readContent = (
    blockId: BlockId,
    blockType: BlockType,
  ): TransactionReadableContent | null => {
    if (!input.readContent) return null;
    if (contentByBlockId.has(blockId))
      return contentByBlockId.get(blockId) ?? null;
    const content = input.readContent(blockId, blockType);
    contentByBlockId.set(blockId, content);
    return content;
  };
  for (const [recordId, block] of Object.entries(input.blocks) as [
    BlockId,
    Block | VersionedBlock,
  ][]) {
    if (block.id !== recordId) {
      addIssue(
        issues,
        "mismatched-block-id",
        `block ${block.id} is stored under ${recordId}`,
        block.id,
      );
    }
    for (const field of Object.keys(block)) {
      if (!supportedBlockFields.has(field)) {
        addIssue(
          issues,
          "unsupported-block-field",
          `block ${block.id} contains unsupported field ${field}`,
          block.id,
        );
      }
    }
  }

  let orderedIds: readonly BlockId[] = [];
  try {
    orderedIds = deriveCanonicalOrderContext(input).blockIds;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addIssue(issues, classifyContainmentIssue(message), message);
  }

  for (const blockId of orderedIds) {
    const block = input.blocks[blockId];
    if (!block || block.tombstone) continue;
    const definition = input.blockDefinitions[block.type];
    if (!definition) {
      addIssue(
        issues,
        "unknown-block-type",
        `block type ${block.type} is unknown`,
        block.id,
      );
      continue;
    }
    const childIds = input.childIdsByParentId[block.id] ?? [];
    const childTypes = childIds.flatMap((childId) => {
      const child = input.blocks[childId];
      return child && !child.tombstone ? [child.type] : [];
    });
    if (
      !blockDefinitionAcceptsSequence(
        input.blockDefinitions,
        definition,
        childTypes,
      )
    ) {
      addIssue(
        issues,
        "invalid-child-sequence",
        `children of ${block.id} violate the direct ${block.type} content definition`,
        block.id,
        undefined,
        {
          blockType: block.type,
          parentId: block.parentId,
          constraint: "direct-child-sequence",
          actualChildTypes: childTypes,
        },
      );
    }
    const parentType =
      block.parentId === null
        ? null
        : (input.blocks[block.parentId]?.type ?? null);
    if (!blockDefinitionAcceptsParent(definition, parentType)) {
      addIssue(
        issues,
        "invalid-parent",
        `block ${block.id} of type ${block.type} rejects direct parent ${parentType ?? "root"}`,
        block.id,
        block.parentId ?? undefined,
        { blockType: block.type, parentId: block.parentId },
      );
    }
    for (const message of validateBlockMetadataForDefinitionWithChildren(
      block.metadata,
      definition,
      { blockId, directChildIds: childIds },
      `metadata for ${block.id}`,
    )) {
      addIssue(issues, "invalid-content", message, block.id);
    }
    validateContent(block, definition, input, readContent, issues);
  }

  for (const validator of input.validators ?? []) {
    let messages: readonly string[];
    try {
      messages = validator({
        blocks: input.blocks,
        rootBlockIds: input.rootBlockIds,
        childIdsByParentId: input.childIdsByParentId,
        blockDefinitions: input.blockDefinitions,
        ...(input.readContent ? { readContent } : {}),
      });
    } catch (error) {
      messages = [error instanceof Error ? error.message : String(error)];
    }
    for (const message of messages) {
      addIssue(issues, "invalid-content", message);
    }
  }

  if (input.selectionTarget) {
    validateSelectionTarget(input.selectionTarget, input, readContent, issues);
  }
  if (input.selection)
    validateSelection(input.selection, input, readContent, issues);
  return issues.length === 0
    ? { valid: true, issues: [] }
    : { valid: false, issues };
}

function validateContent(
  block: Block | VersionedBlock,
  definition: BlockDefinition,
  input: ValidateStructuralDocumentInput,
  readContent: (
    blockId: BlockId,
    blockType: BlockType,
  ) => TransactionReadableContent | null,
  issues: StructuralDocumentIssue[],
): void {
  if (!input.readContent) return;
  const content = readContent(block.id, block.type);
  if (definition.kind !== "text") {
    if (content) {
      addIssue(
        issues,
        "invalid-content",
        `${definition.kind} block ${block.id} must not have text content`,
        block.id,
      );
    }
    return;
  }
  if (!content) {
    addIssue(
      issues,
      "invalid-content",
      `content for ${block.id} is unavailable`,
      block.id,
    );
    return;
  }
  if (!isRichTextDocument(content.content)) {
    addIssue(
      issues,
      "invalid-content",
      `content for text block ${block.id} is not rich text`,
      block.id,
    );
  }
  if (
    input.validateContent &&
    !input.validateContent(block.type, content.content)
  ) {
    addIssue(
      issues,
      "invalid-content",
      `content for ${block.id} violates its block definition`,
      block.id,
    );
  }
}

function validateSelectionTarget(
  target: TransactionSelectionTarget,
  input: ValidateStructuralDocumentInput,
  readContent: (
    blockId: BlockId,
    blockType: BlockType,
  ) => TransactionReadableContent | null,
  issues: StructuralDocumentIssue[],
): void {
  if (target.kind === "none") return;
  const block = liveBlock(input.blocks, target.blockId);
  if (!block) {
    addIssue(
      issues,
      "invalid-selection",
      `selection block ${target.blockId} is unavailable`,
    );
    return;
  }
  const definition = input.blockDefinitions[block.type];
  if (!definition) return;
  if (target.kind === "atomic") {
    if (definition.kind !== "atomic") {
      addIssue(
        issues,
        "invalid-selection",
        `selection block ${block.id} is not atomic`,
      );
    }
    return;
  }
  if (target.kind !== "text-offset") return;
  if (definition.kind !== "text") {
    addIssue(
      issues,
      "invalid-selection",
      `selection block ${block.id} is not text`,
    );
    return;
  }
  if (input.readContent) {
    const content = readContent(block.id, block.type);
    if (
      !content ||
      !isRichTextDocument(content.content) ||
      target.offset < 0 ||
      target.offset > richTextDocumentContentSize(content.content)
    ) {
      addIssue(
        issues,
        "invalid-selection",
        `selection offset for ${block.id} is invalid`,
      );
    }
  }
}

function validateSelection(
  selection: StructuralDocumentSelection,
  input: ValidateStructuralDocumentInput,
  readContent: (
    blockId: BlockId,
    blockType: BlockType,
  ) => TransactionReadableContent | null,
  issues: StructuralDocumentIssue[],
): void {
  for (const point of [selection.anchor, selection.focus]) {
    const block = liveBlock(input.blocks, point.blockId);
    if (!block) {
      addIssue(
        issues,
        "invalid-selection",
        `selection block ${point.blockId} is unavailable`,
      );
      continue;
    }
    const definition = input.blockDefinitions[block.type];
    const content = input.readContent
      ? readContent(block.id, block.type)
      : null;
    if (
      definition?.kind !== "text" ||
      point.offset < 0 ||
      !Number.isInteger(point.offset) ||
      (input.readContent &&
        (!content ||
          !isRichTextDocument(content.content) ||
          point.offset > richTextDocumentContentSize(content.content)))
    ) {
      addIssue(
        issues,
        "invalid-selection",
        `selection offset for ${point.blockId} is invalid`,
      );
    }
  }
}

function classifyContainmentIssue(
  message: string,
): StructuralDocumentIssueKind {
  if (
    message.includes("more than once") ||
    message.includes("duplicate child")
  ) {
    return "duplicate-containment";
  }
  if (message.includes("unknown")) return "unknown-containment";
  if (message.includes("disagrees")) return "parent-disagreement";
  if (message.includes("cycle")) return "parent-cycle";
  if (message.includes("tombstoned")) return "tombstone-in-containment";
  if (message.includes("unreachable")) return "unreachable-block";
  return "invalid-child-sequence";
}

function liveBlock(
  blocks: Readonly<Record<BlockId, Block | VersionedBlock>>,
  blockId: BlockId,
): Block | VersionedBlock | null {
  const block = blocks[blockId];
  return block && !block.tombstone ? block : null;
}

function addIssue(
  issues: StructuralDocumentIssue[],
  kind: StructuralDocumentIssueKind,
  message: string,
  blockId?: BlockId,
  relatedBlockId?: BlockId,
  details: Omit<
    StructuralDocumentIssue,
    "kind" | "message" | "blockId" | "relatedBlockId"
  > = {},
): void {
  issues.push({
    kind,
    message,
    ...(blockId ? { blockId } : {}),
    ...(relatedBlockId ? { relatedBlockId } : {}),
    ...details,
  });
}
