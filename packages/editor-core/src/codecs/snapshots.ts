import type { InlineMarkDefinition } from "../content/marks/types.ts";
import type { InlineMetadataFieldDefinition } from "../content/inline-atoms/types.ts";
import {
  findInlineMarkDefinition,
  primitiveInlineMarkDefinitions,
} from "../content/marks/schema.ts";
import {
  normalizeRichTextDocument,
  validateRichTextDocumentNodeJson,
} from "../content/rich-text/rich-inline-content.ts";
import type { BlockDefinition } from "../definitions/block-definition.ts";
import type { Block, BlockType } from "../document/model/block.ts";
import type {
  EditorInstanceBlockSlice,
  EditorInstanceSnapshot,
  EditorTextBlockContent,
} from "../document/model/snapshot.ts";
export type {
  EditorTextBlockContent,
  EditorInstanceBlockSlice,
  EditorInstanceSnapshot,
} from "../document/model/snapshot.ts";
import { assertValidBlockGraphVersion } from "../document/lifecycle/block-graph-version.ts";
import { deriveCanonicalOrderContext } from "../document/ordering/canonical-order.ts";
import { isStructuralKey } from "../kernel/identity/uuid.ts";
import type { BlockId } from "../kernel/identity/ids.ts";
import { EditorImmutableBinary } from "../kernel/content/encoded-content.ts";
import { validateBlockMetadata } from "../metadata/block-metadata.ts";
import { ownJsonValue } from "../kernel/json/json-value.ts";

export interface EditorSnapshotValidationOptions {
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly inlineMarks?: readonly InlineMarkDefinition[];
  readonly inlineAtoms?: readonly {
    readonly type: string;
    readonly metadata: Readonly<Record<string, InlineMetadataFieldDefinition>>;
  }[];
}

export type EditorInstanceSnapshotValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly string[] };

export type EditorInstanceBlockSliceValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly errors: readonly string[] };

const validatedEditorInstanceSnapshot = Symbol(
  "validated-editor-instance-snapshot",
);

/** Evidence that a runtime snapshot crossed the model trust boundary. */
export interface ValidatedEditorInstanceSnapshot {
  readonly snapshot: EditorInstanceSnapshot;
  /** Canonical projection references produced by this trust boundary. */
  readonly canonicalContent: Readonly<
    Partial<Record<BlockId, EditorTextBlockContent>>
  >;
  readonly [validatedEditorInstanceSnapshot]: true;
}

const snapshotKeys = new Set([
  "blockGraphVersion",
  "blocks",
  "rootBlockIds",
  "childIdsByParentId",
  "content",
  "opaqueContentCheckpoints",
]);
const sliceKeys = new Set([
  "blockGraphVersion",
  "blocks",
  "rootBlockIds",
  "childIdsByParentId",
  "content",
  "contentCheckpoints",
  "affectedBlockIds",
  "deletedBlockIds",
]);
const blockKeys = new Set(["id", "type", "parentId", "metadata", "tombstone"]);

export function assertValidEditorInstanceSnapshot(
  value: unknown,
  options: EditorSnapshotValidationOptions,
): asserts value is EditorInstanceSnapshot {
  const result = validateEditorInstanceSnapshot(value, options);
  if (!result.ok) throw new Error(result.errors.join("; "));
}

export function validateEditorInstanceSnapshotAtBoundary(
  value: unknown,
  options: EditorSnapshotValidationOptions,
): ValidatedEditorInstanceSnapshot {
  assertValidEditorInstanceSnapshot(value, options);
  const source = value;
  const blocks = Object.fromEntries(
    Object.entries(source.blocks).map(([blockId, block]) => [
      blockId,
      Object.freeze({
        ...block,
        ...(block.metadata === undefined
          ? {}
          : { metadata: ownJsonValue(block.metadata) }),
        tombstone:
          block.tombstone === null
            ? null
            : Object.freeze({ ...block.tombstone }),
      }),
    ]),
  ) as Record<BlockId, Block>;
  const childIdsByParentId = Object.fromEntries(
    Object.entries(source.childIdsByParentId).map(([parentId, childIds]) => [
      parentId,
      Object.freeze([...(childIds ?? [])]),
    ]),
  ) as Partial<Record<BlockId, readonly BlockId[]>>;
  const content = Object.fromEntries(
    Object.entries(source.content).flatMap(([blockId, projection]) =>
      projection === undefined
        ? []
        : [[blockId, ownJsonValue(projection)] as const],
    ),
  ) as Partial<Record<BlockId, EditorTextBlockContent>>;
  const opaqueContentCheckpoints = Object.fromEntries(
    Object.entries(source.opaqueContentCheckpoints).map(
      ([blockId, checkpoint]) => [
        blockId,
        checkpoint === undefined ? undefined : Object.freeze({ ...checkpoint }),
      ],
    ),
  ) as EditorInstanceSnapshot["opaqueContentCheckpoints"];
  const snapshot: EditorInstanceSnapshot = Object.freeze({
    blockGraphVersion: source.blockGraphVersion,
    blocks: Object.freeze(blocks),
    rootBlockIds: Object.freeze([...source.rootBlockIds]),
    childIdsByParentId: Object.freeze(childIdsByParentId),
    content: Object.freeze(content),
    opaqueContentCheckpoints: Object.freeze(opaqueContentCheckpoints),
  });
  const canonicalContent = {} as Partial<
    Record<BlockId, EditorTextBlockContent>
  >;
  for (const [blockId, projection] of Object.entries(snapshot.content)) {
    const block = snapshot.blocks[blockId as BlockId];
    if (!block || projection === undefined) continue;
    canonicalContent[blockId as BlockId] = ownJsonValue(
      normalizeRichTextDocument(block.type, projection, {
        inlineMarks: options.inlineMarks ?? primitiveInlineMarkDefinitions,
        ...(options.inlineAtoms === undefined
          ? {}
          : { inlineAtoms: options.inlineAtoms }),
      }),
    );
  }
  return Object.freeze({
    snapshot,
    canonicalContent: Object.freeze(canonicalContent),
    [validatedEditorInstanceSnapshot]: true as const,
  });
}

export function validateEditorInstanceSnapshot(
  value: unknown,
  options: EditorSnapshotValidationOptions,
): EditorInstanceSnapshotValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return {
      ok: false,
      errors: ["editor instance snapshot must be an object"],
    };
  }
  validateKnownKeys(value, snapshotKeys, "editor instance snapshot", errors);
  validateVersion(value, "editor instance snapshot", errors);
  const blocks = record(value.blocks);
  const roots = array(value.rootBlockIds);
  const children = record(value.childIdsByParentId);
  const content = record(value.content);
  const contentCheckpoints = record(value.opaqueContentCheckpoints);
  if (!blocks) errors.push("editor instance snapshot blocks must be a record");
  if (!roots)
    errors.push("editor instance snapshot rootBlockIds must be an array");
  if (!children) {
    errors.push("editor instance snapshot childIdsByParentId must be a record");
  }
  if (!content)
    errors.push("editor instance snapshot content must be a record");
  if (!contentCheckpoints) {
    errors.push(
      "editor instance snapshot opaqueContentCheckpoints must be a record",
    );
  }
  if (!blocks || !roots || !children || !content || !contentCheckpoints) {
    return { ok: false, errors };
  }

  validateBlockRecords("editor instance snapshot", blocks, errors, false);
  if (Object.keys(blocks).length === 0) {
    errors.push(
      "editor instance snapshot blocks must contain at least one block",
    );
  }
  validateIdArray(
    roots,
    "editor instance snapshot rootBlockIds",
    errors,
    false,
  );
  validateChildren(
    children,
    "editor instance snapshot childIdsByParentId",
    errors,
  );

  let liveIds = new Set<BlockId>();
  try {
    liveIds = new Set(
      deriveCanonicalOrderContext({
        blocks: blocks as Record<BlockId, Block>,
        rootBlockIds: roots as BlockId[],
        childIdsByParentId: children as Partial<
          Record<BlockId, readonly BlockId[]>
        >,
      }).blockIds,
    );
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  validateContentOwnership(
    "editor instance snapshot",
    blocks,
    content,
    liveIds,
    options,
    errors,
  );
  validateContentCheckpoints(
    "editor instance snapshot",
    blocks,
    contentCheckpoints,
    liveIds,
    options,
    errors,
    "opaque",
  );
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateContentCheckpoints(
  label: string,
  blocks: Record<string, unknown>,
  checkpoints: Record<string, unknown>,
  liveIds: ReadonlySet<BlockId>,
  options: EditorSnapshotValidationOptions,
  errors: string[],
  representation: "opaque" | "binary",
): void {
  for (const blockId of liveIds) {
    const block = blocks[blockId];
    if (!isRecord(block) || typeof block.type !== "string") continue;
    if (
      options.blockDefinitions[block.type]?.kind === "text" &&
      !Object.prototype.hasOwnProperty.call(checkpoints, blockId)
    ) {
      errors.push(`${label} text block ${blockId} is missing a checkpoint`);
    }
  }
  for (const [blockId, value] of Object.entries(checkpoints)) {
    const block = blocks[blockId];
    if (!liveIds.has(blockId as BlockId) || !isRecord(block)) {
      errors.push(`${label} checkpoint ${blockId} does not own a live block`);
      continue;
    }
    const definition =
      options.blockDefinitions[
        typeof block.type === "string" ? block.type : ""
      ];
    if (definition?.kind !== "text") {
      errors.push(`${label} checkpoint ${blockId} targets a contentless block`);
    }
    if (
      !isRecord(value) ||
      value.kind !== "checkpoint" ||
      typeof value.format !== "string" ||
      value.format.length === 0 ||
      !Number.isSafeInteger(value.version) ||
      (representation === "opaque"
        ? !isCanonicalBase64(value.payloadBase64)
        : !(value.payload instanceof EditorImmutableBinary))
    ) {
      errors.push(`${label} checkpoint ${blockId} is not a tagged checkpoint`);
    }
  }
}

function isCanonicalBase64(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    return false;
  }
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  if (value.endsWith("==")) {
    return (alphabet.indexOf(value[value.length - 3]!) & 15) === 0;
  }
  if (value.endsWith("=")) {
    return (alphabet.indexOf(value[value.length - 2]!) & 3) === 0;
  }
  return true;
}

export function assertValidEditorInstanceBlockSlice(
  value: unknown,
  options: EditorSnapshotValidationOptions,
): asserts value is EditorInstanceBlockSlice {
  const result = validateEditorInstanceBlockSlice(value, options);
  if (!result.ok) throw new Error(result.errors.join("; "));
}

export function validateEditorInstanceBlockSlice(
  value: unknown,
  options: EditorSnapshotValidationOptions,
): EditorInstanceBlockSliceValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return {
      ok: false,
      errors: ["editor instance block slice must be an object"],
    };
  }
  validateKnownKeys(value, sliceKeys, "editor instance block slice", errors);
  validateVersion(value, "editor instance block slice", errors);
  const affected = array(value.affectedBlockIds);
  const deleted =
    value.deletedBlockIds === undefined ? [] : array(value.deletedBlockIds);
  const blocks = record(value.blocks);
  const roots = array(value.rootBlockIds);
  const children = record(value.childIdsByParentId);
  const content = record(value.content);
  const contentCheckpoints = record(value.contentCheckpoints);
  if (!affected) {
    errors.push(
      "editor instance block slice affectedBlockIds must be an array",
    );
  }
  if (!deleted) {
    errors.push("editor instance block slice deletedBlockIds must be an array");
  }
  if (!blocks)
    errors.push("editor instance block slice blocks must be a record");
  if (!roots)
    errors.push("editor instance block slice rootBlockIds must be an array");
  if (!children) {
    errors.push(
      "editor instance block slice childIdsByParentId must be a record",
    );
  }
  if (!content)
    errors.push("editor instance block slice content must be a record");
  if (!contentCheckpoints) {
    errors.push(
      "editor instance block slice contentCheckpoints must be a record",
    );
  }
  if (
    !affected ||
    !deleted ||
    !blocks ||
    !roots ||
    !children ||
    !content ||
    !contentCheckpoints
  ) {
    return { ok: false, errors };
  }

  const affectedIds = collectIds(
    affected,
    "editor instance block slice affectedBlockIds",
    errors,
  );
  const deletedIds = collectIds(
    deleted,
    "editor instance block slice deletedBlockIds",
    errors,
  );
  if (affected.length === 0 && deleted.length === 0) {
    errors.push(
      "editor instance block slice must contain an affected or deleted block",
    );
  }
  validateBlockRecords("editor instance block slice", blocks, errors, true);
  validateIdArray(
    roots,
    "editor instance block slice rootBlockIds",
    errors,
    true,
  );
  validateChildren(
    children,
    "editor instance block slice childIdsByParentId",
    errors,
  );
  for (const blockId of Object.keys(blocks)) {
    if (!affectedIds.has(blockId)) {
      errors.push(
        `editor instance block slice block record ${blockId} is not affected`,
      );
    }
    if (deletedIds.has(blockId)) {
      errors.push(
        `editor instance block slice block record ${blockId} is also deleted`,
      );
    }
  }
  validateContentOwnership(
    "editor instance block slice",
    blocks,
    content,
    new Set(Object.keys(blocks) as BlockId[]),
    options,
    errors,
  );
  validateContentCheckpoints(
    "editor instance block slice",
    blocks,
    contentCheckpoints,
    new Set(Object.keys(blocks) as BlockId[]),
    options,
    errors,
    "binary",
  );
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

function validateContentOwnership(
  label: string,
  blocks: Record<string, unknown>,
  content: Record<string, unknown>,
  liveIds: ReadonlySet<BlockId>,
  options: EditorSnapshotValidationOptions,
  errors: string[],
): void {
  for (const blockId of liveIds) {
    const block = blocks[blockId];
    if (!isRecord(block) || typeof block.type !== "string") continue;
    const definition = options.blockDefinitions[block.type];
    if (!definition) {
      errors.push(
        `${label} block ${blockId} has unsupported type ${block.type}`,
      );
      continue;
    }
    const ownsContent = Object.prototype.hasOwnProperty.call(content, blockId);
    if (definition.kind === "text" && !ownsContent) {
      errors.push(
        `${label} text block ${blockId} is missing rich-text content`,
      );
    }
    if (definition.kind !== "text" && ownsContent) {
      errors.push(
        `${label} ${definition.kind} block ${blockId} must not have text content`,
      );
    }
  }

  for (const [blockId, value] of Object.entries(content)) {
    if (!isStructuralKey(blockId)) {
      errors.push(`${label} content key ${blockId} must be a structural key`);
      continue;
    }
    if (!liveIds.has(blockId as BlockId)) {
      errors.push(
        `${label} content references missing or tombstoned block ${blockId}`,
      );
      continue;
    }
    const block = blocks[blockId];
    const definition =
      isRecord(block) && typeof block.type === "string"
        ? options.blockDefinitions[block.type]
        : undefined;
    if (definition?.kind !== "text") continue;
    validateRichTextContent(
      value,
      `${label} content for ${blockId}`,
      options.inlineMarks ?? primitiveInlineMarkDefinitions,
      options.inlineAtoms,
      errors,
    );
  }
}

function validateRichTextContent(
  value: unknown,
  label: string,
  inlineMarks: readonly InlineMarkDefinition[],
  inlineAtoms:
    | readonly {
        readonly type: string;
        readonly metadata: Readonly<
          Record<string, InlineMetadataFieldDefinition>
        >;
      }[]
    | undefined,
  errors: string[],
): void {
  const result = validateRichTextDocumentNodeJson(value, label, {
    inlineMarks,
    ...(inlineAtoms === undefined ? {} : { inlineAtoms }),
  });
  if (!result.valid) {
    errors.push(...result.errors);
    return;
  }
  for (const block of result.value.content) {
    for (const node of block.content ?? []) {
      for (const mark of node.marks ?? []) {
        if (!findInlineMarkDefinition(inlineMarks, mark.type)) {
          errors.push(`${label} uses unsupported inline mark ${mark.type}`);
        }
      }
    }
  }
}

function validateBlockRecords(
  label: string,
  blocks: Record<string, unknown>,
  errors: string[],
  rejectTombstones: boolean,
): void {
  for (const [blockId, value] of Object.entries(blocks)) {
    if (!isStructuralKey(blockId)) {
      errors.push(
        `${label} block record key ${blockId} must be a structural key`,
      );
      continue;
    }
    if (!isRecord(value)) {
      errors.push(`${label} block record ${blockId} must be an object`);
      continue;
    }
    validateKnownKeys(
      value,
      blockKeys,
      `${label} block record ${blockId}`,
      errors,
    );
    if (value.id !== blockId || !isStructuralKey(String(value.id ?? ""))) {
      errors.push(`${label} block record ${blockId} has mismatched id`);
    }
    if (typeof value.type !== "string" || value.type.length === 0) {
      errors.push(`${label} block ${blockId} type must be a non-empty string`);
    }
    if (
      value.parentId !== null &&
      (typeof value.parentId !== "string" || !isStructuralKey(value.parentId))
    ) {
      errors.push(
        `${label} block ${blockId} parentId must be null or a block id`,
      );
    }
    if (value.tombstone !== null && !isRecord(value.tombstone)) {
      errors.push(
        `${label} block ${blockId} tombstone must be null or an object`,
      );
    }
    if (rejectTombstones && value.tombstone !== null) {
      errors.push(`${label} block record ${blockId} must be live`);
    }
    if (value.metadata !== undefined) {
      errors.push(
        ...validateBlockMetadata(
          value.metadata,
          `${label} block ${blockId} metadata`,
        ),
      );
    }
  }
}

function validateChildren(
  children: Record<string, unknown>,
  label: string,
  errors: string[],
): void {
  for (const [parentId, value] of Object.entries(children)) {
    if (!isStructuralKey(parentId)) {
      errors.push(`${label} parent ${parentId} must be a structural key`);
    }
    if (!Array.isArray(value)) {
      errors.push(`${label}.${parentId} must be an array`);
      continue;
    }
    validateIdArray(value, `${label}.${parentId}`, errors, true);
  }
}

function validateIdArray(
  value: readonly unknown[],
  label: string,
  errors: string[],
  allowEmpty: boolean,
): void {
  if (!allowEmpty && value.length === 0) {
    errors.push(`${label} must contain at least one block`);
  }
  collectIds(value, label, errors);
}

function collectIds(
  value: readonly unknown[],
  label: string,
  errors: string[],
): Set<string> {
  const result = new Set<string>();
  for (const blockId of value) {
    if (typeof blockId !== "string" || !isStructuralKey(blockId)) {
      errors.push(`${label} contains an invalid structural block key`);
      continue;
    }
    if (result.has(blockId))
      errors.push(`${label} contains duplicate block ${blockId}`);
    result.add(blockId);
  }
  return result;
}

function validateKnownKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  label: string,
  errors: string[],
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key))
      errors.push(`${label} contains unsupported field ${key}`);
  }
}

function validateVersion(
  value: Record<string, unknown>,
  label: string,
  errors: string[],
): void {
  try {
    assertValidBlockGraphVersion(value.blockGraphVersion as number);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  if (value.blockGraphVersion === undefined) {
    errors.push(`${label} blockGraphVersion is required`);
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function array(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
