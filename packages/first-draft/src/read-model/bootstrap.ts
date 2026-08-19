import {
  validateEditorInstanceSnapshotAtBoundary,
  type EditorInstanceSnapshot,
  type EditorTextBlockContent,
  type ValidatedEditorInstanceSnapshot,
} from "@repo/editor-core/codecs";
import type { Block } from "@repo/editor-core/document";
import type {
  BlockId,
  EditorOpaqueContentCheckpoint,
} from "@repo/editor-core/kernel";
import {
  EDITOR_YJS_CONTENT_FORMAT,
  EDITOR_YJS_CONTENT_FORMAT_VERSION,
} from "@repo/editor-yjs/checkpoint-format";
import {
  firstDraftBlockModelDefinitions,
  firstDraftInlineAtomModels,
} from "../server/block-definitions.ts";
import { validateFirstDraftTableStructure } from "../blocks/table/structural-validator.ts";

const validatedBootstrap = Symbol("validated-first-draft-bootstrap");
const BOOTSTRAP_KEYS = Object.freeze([
  "documentId",
  "revision",
  "blockGraphVersion",
  "blocks",
] as const);
const BLOCK_KEYS = new Set(["block", "readProjection", "checkpoint"]);
const CHECKPOINT_KEYS = new Set(["kind", "format", "version", "payloadBase64"]);

export interface FirstDraftBootstrapBlock {
  readonly block: Block;
  readonly readProjection?: EditorTextBlockContent;
  readonly checkpoint?: EditorOpaqueContentCheckpoint;
}

export interface FirstDraftBootstrapData {
  readonly documentId: string;
  readonly revision: number;
  readonly blockGraphVersion: number;
  /** Flat canonical block-row order. Parent/child indexes are derived. */
  readonly blocks: readonly FirstDraftBootstrapBlock[];
}

export interface ValidatedFirstDraftBootstrap extends ValidatedEditorInstanceSnapshot {
  readonly documentId: string;
  readonly revision: number;
  readonly [validatedBootstrap]: true;
}

/** The canonical bootstrap is already plain RSC-safe data. */
export type SerializedFirstDraftBootstrap = FirstDraftBootstrapData;

export class InvalidFirstDraftBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFirstDraftBootstrapError";
  }
}

export function validateFirstDraftBootstrap(
  value: FirstDraftBootstrapData,
): ValidatedFirstDraftBootstrap {
  return validateBootstrapBoundary(value);
}

export function serializeFirstDraftBootstrap(
  bootstrap: ValidatedFirstDraftBootstrap,
): SerializedFirstDraftBootstrap {
  const entries: FirstDraftBootstrapBlock[] = [];
  const snapshot = bootstrap.snapshot;
  const visit = (blockId: BlockId): void => {
    const block = snapshot.blocks[blockId];
    if (!block || block.tombstone) return;
    const readProjection = snapshot.content[blockId];
    const checkpoint = snapshot.opaqueContentCheckpoints[blockId];
    entries.push({
      block,
      ...(readProjection === undefined ? {} : { readProjection }),
      ...(checkpoint === undefined ? {} : { checkpoint }),
    });
    for (const childId of snapshot.childIdsByParentId[blockId] ?? []) {
      visit(childId);
    }
  };
  for (const rootId of snapshot.rootBlockIds) visit(rootId);
  return {
    documentId: bootstrap.documentId,
    revision: bootstrap.revision,
    blockGraphVersion: snapshot.blockGraphVersion,
    blocks: entries,
  };
}

/**
 * Validates graph, projections, and opaque checkpoint envelopes at the WebSocket
 * boundary. It never decodes checkpoint payloads or constructs binary/Yjs data.
 */
export function decodeFirstDraftBootstrap(
  value: unknown,
): ValidatedFirstDraftBootstrap {
  return validateBootstrapBoundary(value);
}

export function firstDraftBootstrapSnapshot(
  bootstrap: ValidatedFirstDraftBootstrap,
): EditorInstanceSnapshot {
  return bootstrap.snapshot;
}

export function firstDraftBootstrapValidatedSnapshot(
  bootstrap: ValidatedFirstDraftBootstrap,
): ValidatedEditorInstanceSnapshot {
  return bootstrap;
}

export function createFirstDraftBootstrapFromSnapshot(input: {
  readonly documentId: string;
  readonly revision: number;
  readonly snapshot: EditorInstanceSnapshot;
}): ValidatedFirstDraftBootstrap {
  const entries: FirstDraftBootstrapBlock[] = [];
  const visit = (blockId: BlockId): void => {
    const block = input.snapshot.blocks[blockId];
    if (!block || block.tombstone) return;
    const projection = input.snapshot.content[blockId];
    const checkpoint = input.snapshot.opaqueContentCheckpoints[blockId];
    entries.push({
      block,
      ...(projection === undefined ? {} : { readProjection: projection }),
      ...(checkpoint === undefined
        ? {}
        : {
            checkpoint,
          }),
    });
    for (const childId of input.snapshot.childIdsByParentId[blockId] ?? []) {
      visit(childId);
    }
  };
  for (const rootId of input.snapshot.rootBlockIds) visit(rootId);
  return validateFirstDraftBootstrap({
    documentId: input.documentId,
    revision: input.revision,
    blockGraphVersion: input.snapshot.blockGraphVersion,
    blocks: entries,
  });
}

function validateBootstrapBoundary(
  value: unknown,
): ValidatedFirstDraftBootstrap {
  if (!isRecord(value) || !hasExactKeys(value, BOOTSTRAP_KEYS)) {
    throw new InvalidFirstDraftBootstrapError(
      "Serialized First Draft bootstrap has unknown or missing keys",
    );
  }
  assertDocumentIdentity(value.documentId);
  assertRevision(value.revision, "revision");
  if (
    !Number.isSafeInteger(value.blockGraphVersion) ||
    value.blockGraphVersion === 0
  ) {
    throw new InvalidFirstDraftBootstrapError(
      "First Draft block graph version is invalid",
    );
  }
  if (!Array.isArray(value.blocks) || value.blocks.length === 0) {
    throw new InvalidFirstDraftBootstrapError(
      "First Draft bootstrap blocks must be a non-empty array",
    );
  }

  const entries: FirstDraftBootstrapBlock[] = [];
  for (const [index, candidate] of value.blocks.entries()) {
    if (!isRecord(candidate) || !hasAllowedExactKeys(candidate, BLOCK_KEYS)) {
      throw new InvalidFirstDraftBootstrapError(
        `Serialized First Draft block ${index} is malformed`,
      );
    }
    if (!isRecord(candidate.block)) {
      throw new InvalidFirstDraftBootstrapError(
        `Serialized First Draft block ${index} has no block record`,
      );
    }
    if (
      candidate.checkpoint !== undefined &&
      !isOpaqueCheckpoint(candidate.checkpoint)
    ) {
      throw new InvalidFirstDraftBootstrapError(
        `Serialized checkpoint for block ${index} is malformed`,
      );
    }
    entries.push({
      block: candidate.block as unknown as Block,
      ...(candidate.readProjection === undefined
        ? {}
        : {
            readProjection: candidate.readProjection as EditorTextBlockContent,
          }),
      ...(candidate.checkpoint === undefined
        ? {}
        : {
            checkpoint:
              candidate.checkpoint as unknown as EditorOpaqueContentCheckpoint,
          }),
    });
  }

  const blocks = {} as Record<BlockId, Block>;
  const rootBlockIds: BlockId[] = [];
  const childIdsByParentId = {} as Record<BlockId, BlockId[]>;
  const content = {} as Partial<Record<BlockId, EditorTextBlockContent>>;
  const opaqueContentCheckpoints = {} as Partial<
    Record<BlockId, EditorOpaqueContentCheckpoint>
  >;
  for (const entry of entries) {
    const block = entry.block;
    if (blocks[block.id]) {
      throw new InvalidFirstDraftBootstrapError(
        `First Draft bootstrap contains duplicate block ${block.id}`,
      );
    }
    blocks[block.id] = block;
    if (block.parentId === null) rootBlockIds.push(block.id);
    else (childIdsByParentId[block.parentId] ??= []).push(block.id);
    if (entry.readProjection !== undefined)
      content[block.id] = entry.readProjection;
    if (entry.checkpoint !== undefined) {
      opaqueContentCheckpoints[block.id] = entry.checkpoint;
    }
  }
  const snapshot: EditorInstanceSnapshot = {
    blockGraphVersion: value.blockGraphVersion as number,
    blocks,
    rootBlockIds,
    childIdsByParentId: Object.fromEntries(
      Object.entries(childIdsByParentId).map(([id, ids]) => [id, ids]),
    ) as Readonly<Partial<Record<BlockId, readonly BlockId[]>>>,
    content,
    opaqueContentCheckpoints,
  };
  let evidence: ValidatedEditorInstanceSnapshot;
  try {
    evidence = validateEditorInstanceSnapshotAtBoundary(snapshot, {
      blockDefinitions: firstDraftBlockModelDefinitions,
      inlineAtoms: firstDraftInlineAtomModels,
    });
    const tableErrors = validateFirstDraftTableStructure({
      blocks: evidence.snapshot.blocks,
      rootBlockIds: evidence.snapshot.rootBlockIds,
      childIdsByParentId: evidence.snapshot.childIdsByParentId,
      blockDefinitions: firstDraftBlockModelDefinitions,
    });
    if (tableErrors.length > 0) throw new Error(tableErrors.join("; "));
  } catch (error) {
    throw new InvalidFirstDraftBootstrapError(
      error instanceof Error ? error.message : String(error),
    );
  }
  return Object.freeze({
    ...evidence,
    documentId: value.documentId,
    revision: value.revision,
    [validatedBootstrap]: true as const,
  });
}

function isOpaqueCheckpoint(
  value: unknown,
): value is EditorOpaqueContentCheckpoint {
  return (
    isRecord(value) &&
    hasExactKeySet(value, CHECKPOINT_KEYS) &&
    value.kind === "checkpoint" &&
    value.format === EDITOR_YJS_CONTENT_FORMAT &&
    value.version === EDITOR_YJS_CONTENT_FORMAT_VERSION &&
    isCanonicalBase64(value.payloadBase64)
  );
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

function assertDocumentIdentity(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(value)
  ) {
    throw new InvalidFirstDraftBootstrapError(
      "First Draft document identity is invalid",
    );
  }
}

function assertRevision(
  value: unknown,
  label: string,
): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new InvalidFirstDraftBootstrapError(
      `First Draft ${label} is invalid`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return hasExactKeySet(value, new Set(keys));
}

function hasExactKeySet(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>,
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function hasAllowedExactKeys(
  value: Record<string, unknown>,
  keys: ReadonlySet<string>,
): boolean {
  const actual = Object.keys(value);
  return actual.includes("block") && actual.every((key) => keys.has(key));
}
