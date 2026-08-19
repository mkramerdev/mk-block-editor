import type { BlockId } from "@repo/editor-core/kernel";
import type { BlockType } from "@repo/editor-core/document";
import type { InlineMarkDefinition } from "@repo/editor-core/content/marks";
import type { InlineTextContext } from "@repo/editor-core/content/rich-text";
import type { JsonObject } from "@repo/editor-core/kernel";
import {
  findInlineMarkDefinition,
  type InlineMarkName,
} from "@repo/editor-core/content/marks";
import {
  combineInlineMarkCommandStates,
  inactiveInlineMarkCommandState,
  readInlineMarkCommandStateFromRichTextDocument,
  resolveInlineMarkCommandAction,
  type InlineMarkCommandAction,
  type InlineMarkCommandReason,
  type InlineMarkCommandState,
  type ResolvedInlineMarkCommandAction,
} from "@repo/editor-core/content/marks";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import {
  richTextDocumentContentSize,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { EditorSelectionGraphReader } from "../graph/reader.ts";
import {
  getEditorSelectionCommandEligibility,
  type EditorSelectionCommandIneligibleReason,
} from "../materialization/command-eligibility.ts";
import { resolveCommittedSelectionSnapshotTextAnchors } from "../materialization/materialize.ts";
import type { CommittedSelectionSnapshot } from "../model/committed-selection-snapshot.ts";
import type {
  EditorSelectionFailure,
  EditorSelectionRangeBlock,
  EditorSelectionSnapshot,
  EditorSelectionTextAnchor,
  EditorSelectionTextAnchorResolver,
} from "../model/types.ts";

export type EditorSelectionInlineMarkFormatName = InlineMarkName;

export type EditorSelectionInlineMarkFormatIneligibleReason =
  | EditorSelectionCommandIneligibleReason
  | EditorSelectionFailure["reason"]
  | InlineMarkCommandReason
  | "block-internal-selection"
  | "no-eligible-text"
  | "no-change"
  | "transaction-failed"
  | "unsupported-context";

export type EditorSelectionInlineMarkFormatAction = InlineMarkCommandAction;

export interface EditorSelectionInlineMarkFormatRange {
  blockId: BlockId;
  blockType: BlockType;
  from: number;
  to: number;
  coverage: "partial" | "complete-content";
  hasMark: boolean;
  hasUnmarkedText: boolean;
  value: Record<string, unknown> | null;
  startTextAnchor?: EditorSelectionTextAnchor;
  endTextAnchor?: EditorSelectionTextAnchor;
}

export type EditorSelectionInlineMarkFormatState = Omit<
  InlineMarkCommandState,
  "reason"
> & {
  action: ResolvedInlineMarkCommandAction | null;
  ranges: readonly EditorSelectionInlineMarkFormatRange[];
  reason?: EditorSelectionInlineMarkFormatIneligibleReason;
};

export interface EditorSelectionInlineMarkFormatPlan {
  graphRevision: number;
  selectionRevision: number;
  markName: EditorSelectionInlineMarkFormatName;
  action: ResolvedInlineMarkCommandAction;
  attrs?: JsonObject | null;
  ranges: readonly EditorSelectionInlineMarkFormatRange[];
}

export interface ReadCurrentSelectionInlineMarkFormatStatesOptions {
  readonly selection: CommittedSelectionSnapshot;
  readonly marks: readonly EditorSelectionInlineMarkFormatName[];
  readonly graph: EditorSelectionGraphReader;
  readonly graphRevision: number;
  readonly inlineMarks: readonly InlineMarkDefinition[];
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly context?: InlineTextContext;
  readonly readCanonicalTextProjection: (
    blockId: BlockId,
    blockType: BlockType,
  ) => RichTextDocumentNodeJson | null;
}

export type SelectionInlineMarkFormatStates = Readonly<
  Partial<
    Record<
      EditorSelectionInlineMarkFormatName,
      EditorSelectionInlineMarkFormatState
    >
  >
>;

export type ReadSelectionInlineMarkFormatStatesResult =
  | {
      readonly ok: true;
      readonly snapshot: EditorSelectionSnapshot & { phase: "committed" };
      readonly states: SelectionInlineMarkFormatStates;
      readonly blockIds: readonly BlockId[];
    }
  | {
      readonly ok: false;
      readonly reason: EditorSelectionInlineMarkFormatIneligibleReason;
      readonly blockId?: BlockId;
      readonly message?: string;
    };

export interface FormatSelectionInlineMarkOptions {
  readonly selection?: CommittedSelectionSnapshot;
  readonly markName: EditorSelectionInlineMarkFormatName;
  readonly action?: EditorSelectionInlineMarkFormatAction;
  readonly attrs?: JsonObject | null;
}

export interface EditorReadCurrentSelectionInlineMarkFormatStatesOptions {
  readonly marks: readonly EditorSelectionInlineMarkFormatName[];
}

export type FormatSelectionInlineMarkResult =
  | {
      readonly ok: true;
      readonly changed: true;
      readonly selection: CommittedSelectionSnapshot;
      readonly plan: EditorSelectionInlineMarkFormatPlan;
    }
  | {
      readonly ok: false;
      readonly reason: EditorSelectionInlineMarkFormatIneligibleReason;
      readonly blockId?: BlockId;
      readonly message?: string;
    };

interface PreparedInlineMarkFormatRange {
  readonly selectionRange: EditorSelectionRangeBlock;
  readonly content: RichTextDocumentNodeJson;
}

/**
 * Reads the offsets already owned by the current canonical committed selection
 * and prepares every intersecting validated projection once. This path never
 * resolves stable anchors or acquires writable content access.
 */
export function readCurrentSelectionInlineMarkFormatStates(
  options: ReadCurrentSelectionInlineMarkFormatStatesOptions,
): ReadSelectionInlineMarkFormatStatesResult {
  if (options.selection.kind !== "document") {
    return formatFailure("block-internal-selection");
  }
  if (
    options.selection.documentSelection.graphRevision !== options.graphRevision
  )
    return formatFailure("stale-graph");
  return readInlineMarkFormatStatesFromCurrentOffsets(
    options.selection.documentSelection,
    options,
  );
}

export function readInlineMarkFormatStatesFromCurrentOffsets(
  snapshot: EditorSelectionSnapshot,
  options: Omit<ReadCurrentSelectionInlineMarkFormatStatesOptions, "selection">,
): ReadSelectionInlineMarkFormatStatesResult {
  const eligibility = getEditorSelectionCommandEligibility(snapshot);
  if (!eligibility.eligible) return formatFailure(eligibility.reason);

  const definitions = new Map<
    EditorSelectionInlineMarkFormatName,
    InlineMarkDefinition
  >();
  for (const markName of options.marks) {
    if (definitions.has(markName)) continue;
    const definition = findInlineMarkDefinition(options.inlineMarks, markName);
    if (!definition) return formatFailure("missing-mark");
    definitions.set(markName, definition);
  }

  const prepared: PreparedInlineMarkFormatRange[] = [];
  const blockIds: BlockId[] = [];
  for (const rangeBlock of eligibility.snapshot.rangeBlocks) {
    const blockDefinition = options.blockDefinitions[rangeBlock.blockType];
    if (!blockDefinition || blockDefinition.kind !== "text") continue;
    const block = options.graph.getBlock(rangeBlock.blockId);
    if (!block || block.tombstone) {
      return formatFailure("missing-block", rangeBlock.blockId);
    }
    const content = options.readCanonicalTextProjection(block.id, block.type);
    if (!content) return formatFailure("missing-text", block.id);
    const size = richTextDocumentContentSize(content);
    const from =
      rangeBlock.coverage === "complete-content"
        ? 0
        : clampOffset(rangeBlock.startOffset ?? 0, size);
    const to =
      rangeBlock.coverage === "complete-content"
        ? size
        : clampOffset(rangeBlock.endOffset ?? size, size);
    if (Math.min(from, to) === Math.max(from, to)) continue;
    prepared.push({ selectionRange: rangeBlock, content });
    blockIds.push(block.id);
  }

  const states: Partial<
    Record<
      EditorSelectionInlineMarkFormatName,
      EditorSelectionInlineMarkFormatState
    >
  > = {};
  for (const markName of options.marks) {
    if (states[markName]) continue;
    const definition = definitions.get(markName);
    if (!definition) return formatFailure("missing-mark");
    const ranges: EditorSelectionInlineMarkFormatRange[] = [];
    const commandStates: InlineMarkCommandState[] = [];
    for (const item of prepared) {
      if (
        !isInlineMarkFormatRangeEligible(
          definition,
          item.selectionRange,
          options,
        )
      )
        continue;
      const range = formatRangeFromSelectionBlock(
        item.selectionRange,
        item.content,
        definition,
        options,
      );
      if (!range) continue;
      ranges.push(range.range);
      commandStates.push(range.state);
    }
    if (ranges.length === 0) {
      states[markName] = unavailableFormatState(definition, "no-eligible-text");
      continue;
    }
    const commandState = combineInlineMarkCommandStates(
      definition,
      commandStates,
    );
    states[markName] = {
      ...commandState,
      action: commandState.canExecute
        ? resolveInlineMarkCommandAction(commandState, undefined)
        : null,
      ranges,
    };
  }

  return {
    ok: true,
    snapshot: eligibility.snapshot,
    states,
    blockIds: [...new Set(blockIds)],
  };
}

/**
 * Captured commands call this only after acquiring every selected content
 * context, so stable-anchor rebasing has one explicit mutation boundary.
 */
export function prepareCapturedSelectionInlineMarkFormatStates(
  options: ReadCurrentSelectionInlineMarkFormatStatesOptions & {
    readonly textAnchorResolver?: EditorSelectionTextAnchorResolver | null;
  },
): ReadSelectionInlineMarkFormatStatesResult {
  if (options.selection.kind !== "document")
    return formatFailure("block-internal-selection");
  const resolved = resolveCommittedSelectionSnapshotTextAnchors({
    captured: options.selection,
    graph: options.graph,
    graphRevision: options.graphRevision,
    textAnchorResolver: options.textAnchorResolver,
  });
  if (!resolved.ok)
    return formatFailure(resolved.reason, resolved.blockId, resolved.message);
  return readInlineMarkFormatStatesFromCurrentOffsets(
    resolved.snapshot,
    options,
  );
}

function isInlineMarkFormatRangeEligible(
  definition: InlineMarkDefinition,
  rangeBlock: EditorSelectionRangeBlock,
  options: Pick<
    ReadCurrentSelectionInlineMarkFormatStatesOptions,
    "blockDefinitions" | "context"
  >,
): boolean {
  const context = options.context ?? "text";
  if (!definition.contexts.includes(context)) return false;
  const blockDefinition = options.blockDefinitions[rangeBlock.blockType];
  if (!blockDefinition) return false;
  return blockDefinition.kind === "text";
}

function formatRangeFromSelectionBlock(
  rangeBlock: EditorSelectionRangeBlock,
  content: RichTextDocumentNodeJson,
  definition: InlineMarkDefinition,
  options: Pick<
    ReadCurrentSelectionInlineMarkFormatStatesOptions,
    "blockDefinitions" | "context"
  >,
): {
  range: EditorSelectionInlineMarkFormatRange;
  state: InlineMarkCommandState;
} | null {
  const size = richTextDocumentContentSize(content);
  const from =
    rangeBlock.coverage === "complete-content"
      ? 0
      : clampOffset(rangeBlock.startOffset ?? 0, size);
  const to =
    rangeBlock.coverage === "complete-content"
      ? size
      : clampOffset(rangeBlock.endOffset ?? size, size);
  const start = Math.min(from, to);
  const end = Math.max(from, to);
  if (start === end) return null;
  const commandState = readInlineMarkCommandStateFromRichTextDocument(
    rangeBlock.blockType,
    content,
    definition.name,
    { from: start, to: end },
    {
      blockDefinitions: options.blockDefinitions,
      inlineMarks: [definition],
      context: options.context ?? "text",
    },
  );
  if (!commandState.canExecute) return null;
  return {
    range: {
      blockId: rangeBlock.blockId,
      blockType: rangeBlock.blockType,
      from: start,
      to: end,
      coverage:
        rangeBlock.coverage === "complete-content"
          ? "complete-content"
          : "partial",
      hasMark: commandState.active || commandState.mixed,
      hasUnmarkedText: !commandState.active || commandState.mixed,
      value: commandState.value,
      ...(rangeBlock.startTextAnchor
        ? { startTextAnchor: rangeBlock.startTextAnchor }
        : {}),
      ...(rangeBlock.endTextAnchor
        ? { endTextAnchor: rangeBlock.endTextAnchor }
        : {}),
    },
    state: commandState,
  };
}

function unavailableFormatState(
  definition: InlineMarkDefinition,
  reason: EditorSelectionInlineMarkFormatIneligibleReason,
): EditorSelectionInlineMarkFormatState {
  return {
    ...inactiveInlineMarkCommandState(
      definition,
      modelInlineMarkCommandReason(reason) ?? "empty-range",
    ),
    reason,
    action: null,
    ranges: [],
  };
}

function modelInlineMarkCommandReason(
  reason: EditorSelectionInlineMarkFormatIneligibleReason,
): InlineMarkCommandReason | null {
  switch (reason) {
    case "missing-mark":
    case "unsupported-context":
    case "empty-range":
    case "invalid-attrs":
      return reason;
    default:
      return null;
  }
}

function formatFailure(
  reason: EditorSelectionInlineMarkFormatIneligibleReason,
  blockId?: BlockId,
  message?: string,
): Extract<ReadSelectionInlineMarkFormatStatesResult, { ok: false }> {
  return {
    ok: false,
    reason,
    ...(blockId === undefined ? {} : { blockId }),
    ...(message === undefined ? {} : { message }),
  };
}

function clampOffset(offset: number, length: number): number {
  if (!Number.isFinite(offset)) return length;
  return Math.min(Math.max(0, Math.trunc(offset)), length);
}
