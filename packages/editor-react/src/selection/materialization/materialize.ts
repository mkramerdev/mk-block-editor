import type { BlockDefinition } from "@repo/editor-core/definitions";
import {
  createCanonicalBlockFragment,
  type CanonicalBlockFragment,
  type CanonicalBlockRecord,
  type CanonicalFragmentBoundary,
} from "@repo/editor-core/editing";
import { type BlockType } from "@repo/editor-core/document";
import {
  createBlockRichTextContentFromPlainText,
  extractPlainTextFromRichTextDocument,
  isRichTextDocument,
  normalizeRichTextDocument,
  richTextDocumentContentSize,
  sliceRichTextDocument,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import {
  createBlockRecord,
  normalizeBlockMetadata,
} from "@repo/editor-core/metadata";
import { type BlockId, type JsonObject } from "@repo/editor-core/kernel";
import type {
  BlockSelectionCustomFragmentNode,
  BlockSelectionFragmentDescriptor,
  BlockSelectionWrapperFragmentDescriptor,
} from "@repo/editor-core/selection";
import {
  isEditorSelectionTextAnchor,
  resolveEditorSelectionTextAnchorPoint,
} from "../anchors/text-anchor.ts";
import { rebaseCommittedSelectionAnchors } from "../anchors/rebase-committed-selection.ts";
import type { CommittedSelectionSnapshot } from "../model/committed-selection-snapshot.ts";
import type {
  EditorLogicalSelectionPoint,
  EditorSelectionFailure,
  EditorSelectionRangeBlock,
  EditorSelectionSnapshot,
  EditorSelectionTextAnchorResolver,
} from "../model/types.ts";
import type {
  EditorBlockSelectionTarget,
  EditorSelectionGraphReader,
} from "../graph/reader.ts";
import { readEditorBlockSelectionTarget } from "../graph/reader.ts";
import {
  getEditorSelectionCommandEligibility,
  type EditorSelectionCommandIneligibleReason,
} from "./command-eligibility.ts";
import { createEditorSelectionContentCompletenessChecker } from "../completeness/effective-content-completeness.ts";

export interface MaterializeEditorSelectionFragmentOptions {
  readonly snapshot: EditorSelectionSnapshot;
  readonly graph: EditorSelectionGraphReader;
  readonly graphRevision?: number;
  readonly readBlockPlainText: (
    blockId: BlockId,
    blockType: BlockType,
  ) => string;
  readonly readBlockContent?: (
    blockId: BlockId,
    blockType: BlockType,
  ) => RichTextDocumentNodeJson | null;
  readonly textAnchorResolver?: EditorSelectionTextAnchorResolver;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly resolveVisibleChildBlockIds?: (input: {
    readonly blockId: BlockId;
    readonly blockType: BlockType;
    readonly childBlockIds: readonly BlockId[];
  }) => readonly BlockId[];
}

export type MaterializeEditorSelectionFragmentResult =
  | { readonly ok: true; readonly fragment: CanonicalBlockFragment }
  | {
      readonly ok: false;
      readonly reason:
        | EditorSelectionFailure["reason"]
        | EditorSelectionCommandIneligibleReason;
      readonly blockId?: BlockId;
      readonly message?: string;
    };

export type ResolveEditorSelectionSnapshotTextAnchorsResult =
  | { readonly ok: true; readonly snapshot: EditorSelectionSnapshot }
  | EditorSelectionFailure;

export type ResolveCommittedSelectionSnapshotTextAnchorsResult =
  | {
      readonly ok: true;
      readonly sourceSelectionRevision: number;
      readonly changed: boolean;
      readonly normalizationInvoked: false;
      readonly snapshot: EditorSelectionSnapshot;
    }
  | EditorSelectionFailure;

/** Command adapter over the committed-anchor rebase boundary. */
export function resolveCommittedSelectionSnapshotTextAnchors({
  captured,
  graph,
  textAnchorResolver,
  graphRevision,
}: {
  readonly captured: CommittedSelectionSnapshot;
  readonly graph: EditorSelectionGraphReader;
  readonly textAnchorResolver?: EditorSelectionTextAnchorResolver | null;
  readonly graphRevision: number;
}): ResolveCommittedSelectionSnapshotTextAnchorsResult {
  const rebased = rebaseCommittedSelectionAnchors(captured, {
    graph,
    textAnchorResolver,
    graphRevision,
    expectedSelectionRevision: captured.revision,
  });
  if (!rebased.ok) {
    return {
      ok: false,
      reason:
        rebased.reason === "missing-block"
          ? "missing-block"
          : rebased.reason === "stale-selection-revision"
            ? "stale-graph"
            : "invalid",
      blockId: rebased.affectedBlockIds?.[0],
      message: rebased.reason,
    };
  }
  return {
    ok: true,
    sourceSelectionRevision: rebased.sourceSelectionRevision,
    changed: rebased.changed,
    normalizationInvoked: false,
    snapshot: rebased.snapshot.documentSelection,
  };
}

export function resolveEditorSelectionSnapshotTextAnchors({
  snapshot,
  graph,
  textAnchorResolver,
}: {
  readonly snapshot: EditorSelectionSnapshot;
  readonly graph: EditorSelectionGraphReader;
  readonly textAnchorResolver?: EditorSelectionTextAnchorResolver | null;
}): ResolveEditorSelectionSnapshotTextAnchorsResult {
  if (!textAnchorResolver) return { ok: true, snapshot };
  const resolvedAnchor = resolveSnapshotPoint(
    snapshot.anchor,
    graph,
    textAnchorResolver,
  );
  if (!resolvedAnchor.ok) return resolvedAnchor;
  const resolvedFocus = resolveSnapshotPoint(
    snapshot.focus,
    graph,
    textAnchorResolver,
  );
  if (!resolvedFocus.ok) return resolvedFocus;
  const resolvedStart = resolveSnapshotPoint(
    snapshot.normalizedStart,
    graph,
    textAnchorResolver,
  );
  if (!resolvedStart.ok) return resolvedStart;
  const resolvedEnd = resolveSnapshotPoint(
    snapshot.normalizedEnd,
    graph,
    textAnchorResolver,
  );
  if (!resolvedEnd.ok) return resolvedEnd;
  if (
    !resolvedAnchor.point ||
    !resolvedFocus.point ||
    !resolvedStart.point ||
    !resolvedEnd.point
  ) {
    return { ok: true, snapshot };
  }
  const changed =
    resolvedAnchor.point !== snapshot.anchor ||
    resolvedFocus.point !== snapshot.focus ||
    resolvedStart.point !== snapshot.normalizedStart ||
    resolvedEnd.point !== snapshot.normalizedEnd;
  if (!changed) return { ok: true, snapshot };
  return {
    ok: true,
    snapshot: {
      ...snapshot,
      anchor: resolvedAnchor.point,
      focus: resolvedFocus.point,
      normalizedStart: resolvedStart.point,
      normalizedEnd: resolvedEnd.point,
      rangeBlocks: rebaseBoundaryBlocks(
        snapshot.rangeBlocks,
        resolvedStart.point,
        resolvedEnd.point,
      ),
    },
  };
}

export function materializeEditorSelectionFragment({
  snapshot,
  graph,
  graphRevision,
  readBlockPlainText,
  readBlockContent,
  textAnchorResolver,
  blockDefinitions,
  resolveVisibleChildBlockIds,
}: MaterializeEditorSelectionFragmentOptions): MaterializeEditorSelectionFragmentResult {
  const resolved = resolveEditorSelectionSnapshotTextAnchors({
    snapshot,
    graph,
    textAnchorResolver,
  });
  if (!resolved.ok) return resolved;
  const eligibility = getEditorSelectionCommandEligibility(resolved.snapshot);
  if (!eligibility.eligible) return { ok: false, reason: eligibility.reason };
  if (
    graphRevision !== undefined &&
    graphRevision !== resolved.snapshot.graphRevision
  ) {
    return { ok: false, reason: "stale-graph" };
  }

  try {
    const builder = new SelectionFragmentBuilder({
      snapshot: resolved.snapshot,
      graph,
      readBlockPlainText,
      readBlockContent,
      blockDefinitions,
      resolveVisibleChildBlockIds,
    });
    return { ok: true, fragment: builder.build() };
  } catch (error) {
    return {
      ok: false,
      reason: "invalid",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createPlainTextCanonicalFragment(
  text: string,
  blockType: BlockType,
  blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>,
): CanonicalBlockFragment | null {
  if (text.length === 0) return null;
  const block = createBlockRecord({ type: blockType });
  const content = createBlockRichTextContentFromPlainText(blockType, text);
  return createCanonicalBlockFragment({
    blocks: [
      {
        id: block.id,
        type: block.type,
        parentId: null,
        content,
        plainText: text,
      },
    ],
    rootBlockIds: [block.id],
    start: { kind: "text", blockId: block.id },
    end: { kind: "text", blockId: block.id },
    blockDefinitions,
  });
}

interface PendingFragmentNode {
  readonly key: string;
  readonly type: BlockType;
  readonly metadata?: JsonObject;
  readonly content?: RichTextDocumentNodeJson;
  readonly plainText?: string;
  readonly children: readonly PendingFragmentNode[];
  readonly edge: "block" | "text" | "children";
}

interface SelectionFragmentBuilderOptions {
  readonly snapshot: EditorSelectionSnapshot;
  readonly graph: EditorSelectionGraphReader;
  readonly readBlockPlainText: (
    blockId: BlockId,
    blockType: BlockType,
  ) => string;
  readonly readBlockContent?: (
    blockId: BlockId,
    blockType: BlockType,
  ) => RichTextDocumentNodeJson | null;
  readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  readonly resolveVisibleChildBlockIds?: (input: {
    readonly blockId: BlockId;
    readonly blockType: BlockType;
    readonly childBlockIds: readonly BlockId[];
  }) => readonly BlockId[];
}

class SelectionFragmentBuilder {
  private readonly rangeById: ReadonlyMap<BlockId, EditorSelectionRangeBlock>;
  private readonly hasCompleteContent: (blockId: BlockId) => boolean;
  private syntheticKey = 0;

  constructor(private readonly options: SelectionFragmentBuilderOptions) {
    this.rangeById = new Map(
      options.snapshot.rangeBlocks.map((block) => [block.blockId, block]),
    );
    this.hasCompleteContent = createEditorSelectionContentCompletenessChecker({
      graph: options.graph,
      rangeById: this.rangeById,
      blockDefinitions: options.blockDefinitions,
      readTextContentSize: (blockId, blockType) => {
        const target = readEditorBlockSelectionTarget(options.graph, blockId);
        return target?.block.type === blockType
          ? this.readTextContentSize(target)
          : null;
      },
      getChildBlockIds: (blockId) => {
        const target = readEditorBlockSelectionTarget(options.graph, blockId);
        return target ? this.selectionChildIds(target) : [];
      },
    });
  }

  build(): CanonicalBlockFragment {
    const selectedRoots = this.options.graph
      .getRootBlockIds()
      .flatMap((rootId) => this.collectSelected(rootId));
    const roots = this.wrapCanonicalListItemRuns(selectedRoots);
    if (roots.length === 0) throw new Error("selection materialized no blocks");

    const allocated = new Map<string, ReturnType<typeof createBlockRecord>>();
    const allocate = (node: PendingFragmentNode): void => {
      allocated.set(
        node.key,
        createBlockRecord({ type: node.type, metadata: node.metadata }),
      );
      for (const child of node.children) allocate(child);
    };
    for (const root of roots) allocate(root);

    const records: CanonicalBlockRecord[] = [];
    const emit = (
      node: PendingFragmentNode,
      parentId: BlockId | null,
    ): void => {
      const allocatedBlock = allocated.get(node.key);
      if (!allocatedBlock)
        throw new Error(`missing allocation for ${node.key}`);
      records.push({
        id: allocatedBlock.id,
        type: allocatedBlock.type,
        parentId,
        ...(allocatedBlock.metadata === undefined
          ? {}
          : { metadata: allocatedBlock.metadata }),
        ...(node.content === undefined ? {} : { content: node.content }),
        ...(node.plainText === undefined ? {} : { plainText: node.plainText }),
      });
      for (const child of node.children) emit(child, allocatedBlock.id);
    };
    for (const root of roots) emit(root, null);

    const start = this.boundaryForNode(roots[0]!, "start", allocated);
    const end = this.boundaryForNode(
      roots[roots.length - 1]!,
      "end",
      allocated,
    );
    return createCanonicalBlockFragment({
      blocks: records,
      rootBlockIds: roots.map((root) => allocated.get(root.key)!.id),
      start,
      end,
      blockDefinitions: this.options.blockDefinitions,
    });
  }

  private wrapCanonicalListItemRuns(
    roots: readonly PendingFragmentNode[],
  ): readonly PendingFragmentNode[] {
    const result: PendingFragmentNode[] = [];
    for (let index = 0; index < roots.length; ) {
      const root = roots[index]!;
      const source = this.options.graph.getBlock(root.key as BlockId);
      const policy = source
        ? this.options.blockDefinitions[source.type]?.list
        : undefined;
      const parent = source?.parentId
        ? this.options.graph.getBlock(source.parentId)
        : null;
      if (
        !source ||
        policy?.kind !== "item" ||
        !parent ||
        parent.type !== policy.containerType
      ) {
        result.push(root);
        index += 1;
        continue;
      }
      const children: PendingFragmentNode[] = [root];
      let cursor = index + 1;
      while (cursor < roots.length) {
        const candidate = roots[cursor]!;
        const candidateSource = this.options.graph.getBlock(
          candidate.key as BlockId,
        );
        if (
          !candidateSource ||
          candidateSource.parentId !== parent.id ||
          candidateSource.type !== source.type
        ) {
          break;
        }
        children.push(candidate);
        cursor += 1;
      }
      const metadata = normalizeBlockMetadata(parent.metadata);
      result.push({
        key: `${parent.id}:selected-list-run:${this.syntheticKey++}`,
        type: parent.type,
        ...(metadata === undefined ? {} : { metadata }),
        children,
        edge: "children",
      });
      index = cursor;
    }
    return result;
  }

  private collectSelected(blockId: BlockId): readonly PendingFragmentNode[] {
    const own = this.buildSelectedNode(blockId, false, false);
    if (own) return [own];
    const target = readEditorBlockSelectionTarget(this.options.graph, blockId);
    if (!target) return [];
    return this.selectionChildIds(target).flatMap((childId) =>
      this.collectSelected(childId),
    );
  }

  private buildSelectedNode(
    blockId: BlockId,
    forceComplete: boolean,
    forceStructure: boolean,
  ): PendingFragmentNode | null {
    const target = readEditorBlockSelectionTarget(this.options.graph, blockId);
    if (!target) return null;
    const range = this.rangeById.get(blockId);
    const descriptor = fragmentDescriptorForRangeBlock(range);
    const selected = forceComplete || (range && range.coverage !== "none");

    if (descriptor?.kind === "custom") {
      const custom = descriptor.nodes?.[0];
      return custom ? this.buildCustomNode(custom, target.block.id) : null;
    }

    const definition = this.options.blockDefinitions[target.block.type];
    if (!definition) throw new Error(`unknown block type ${target.block.type}`);
    if (definition.kind === "text") {
      if (!selected) return null;
      return this.buildTextNode(
        target,
        range,
        forceComplete || descriptor?.kind === "block",
      );
    }
    if (definition.kind === "atomic") {
      return selected && (forceComplete || descriptor?.kind === "block")
        ? this.nodeForTarget(target, [], "block")
        : null;
    }

    const wrapperDescriptor =
      descriptor?.kind === "wrapper" ? descriptor : undefined;
    const selectionChildIds = this.selectionChildIds(target, wrapperDescriptor);
    const selectedChildIds = selectionChildIds.filter((childId) =>
      this.hasSelectedContent(childId),
    );
    const completeContent =
      selectionChildIds.length > 0 &&
      selectionChildIds.every((childId) => this.hasCompleteContent(childId));
    const inclusion = wrapperDescriptor?.inclusion ?? "complete-content";
    const structurallySelected =
      forceComplete ||
      forceStructure ||
      range?.coverage === "complete-block" ||
      (selected && descriptor?.kind === "block") ||
      (inclusion === "complete-content" && completeContent) ||
      (inclusion === "multiple-selected-children" &&
        selectedChildIds.length > 1);
    if (!structurallySelected) return null;

    const forceAllChildren =
      forceComplete ||
      range?.coverage === "complete-block" ||
      wrapperDescriptor?.preservedChildren === "all";
    const childIds = forceAllChildren
      ? this.options.graph.getChildBlockIds(blockId)
      : selectedChildIds;
    const children = childIds.flatMap((childId) => {
      const child = this.buildSelectedNode(childId, forceAllChildren, true);
      return child ? [child] : this.collectSelected(childId);
    });
    if (children.length === 0) {
      throw new Error(
        `selected wrapper ${blockId} contains no selected children`,
      );
    }
    return this.nodeForTarget(
      target,
      children,
      range?.coverage === "complete-block" ? "block" : "children",
    );
  }

  private selectionChildIds(
    target: EditorBlockSelectionTarget,
    descriptor?: BlockSelectionWrapperFragmentDescriptor,
  ): readonly BlockId[] {
    const candidate =
      descriptor ??
      fragmentDescriptorForRangeBlock(this.rangeById.get(target.block.id));
    const resolvedDescriptor =
      candidate?.kind === "wrapper" ? candidate : undefined;
    const childIds = this.options.graph.getChildBlockIds(target.block.id);
    if (
      resolvedDescriptor?.contentScope !== "visible" ||
      !this.options.resolveVisibleChildBlockIds
    ) {
      return childIds;
    }
    const visible = new Set(
      this.options.resolveVisibleChildBlockIds({
        blockId: target.block.id,
        blockType: target.block.type,
        childBlockIds: childIds,
      }),
    );
    return childIds.filter((childId) => visible.has(childId));
  }

  private hasSelectedContent(blockId: BlockId): boolean {
    const target = readEditorBlockSelectionTarget(this.options.graph, blockId);
    if (!target) return false;
    const range = this.rangeById.get(blockId);
    if (range && range.coverage !== "none") return true;
    return this.selectionChildIds(target).some((childId) =>
      this.hasSelectedContent(childId),
    );
  }

  private readTextContentSize(target: EditorBlockSelectionTarget): number {
    const readContent = this.options.readBlockContent?.(
      target.block.id,
      target.block.type,
    );
    const content = isRichTextDocument(readContent)
      ? normalizeRichTextDocument(target.block.type, readContent)
      : createBlockRichTextContentFromPlainText(
          target.block.type,
          this.options.readBlockPlainText(target.block.id, target.block.type),
        );
    return richTextDocumentContentSize(content);
  }

  private buildTextNode(
    target: EditorBlockSelectionTarget,
    range: EditorSelectionRangeBlock | undefined,
    completeBlock: boolean,
  ): PendingFragmentNode {
    const fullText = this.options.readBlockPlainText(
      target.block.id,
      target.block.type,
    );
    const readContent = this.options.readBlockContent?.(
      target.block.id,
      target.block.type,
    );
    const content = isRichTextDocument(readContent)
      ? normalizeRichTextDocument(target.block.type, readContent)
      : createBlockRichTextContentFromPlainText(target.block.type, fullText);
    const length = richTextDocumentContentSize(content);
    const from =
      completeBlock || range?.coverage === "complete-content"
        ? 0
        : normalizeTextBoundary(range?.startOffset, 0, length);
    const to =
      completeBlock || range?.coverage === "complete-content"
        ? length
        : normalizeTextBoundary(range?.endOffset, length, length);
    const start = Math.min(from, to);
    const end = Math.max(from, to);
    const selectedContent =
      start === 0 && end === length
        ? content
        : sliceRichTextDocument(target.block.type, content, start, end);
    return this.nodeForTarget(target, [], completeBlock ? "block" : "text", {
      content: selectedContent,
      plainText: extractPlainTextFromRichTextDocument(selectedContent),
    });
  }

  private buildCustomNode(
    source: BlockSelectionCustomFragmentNode,
    sourceKey: BlockId,
  ): PendingFragmentNode {
    const definition = this.options.blockDefinitions[source.type];
    if (!definition)
      throw new Error(`unknown custom fragment type ${source.type}`);
    const children = (source.children ?? []).map((child) =>
      this.buildCustomNode(child, sourceKey),
    );
    const content =
      source.content === undefined
        ? undefined
        : normalizeRichTextDocument(source.type, source.content);
    return {
      key: `${sourceKey}:custom:${this.syntheticKey++}`,
      type: source.type,
      ...(normalizeBlockMetadata(source.metadata) === undefined
        ? {}
        : { metadata: normalizeBlockMetadata(source.metadata) }),
      ...(content === undefined ? {} : { content }),
      ...(content === undefined
        ? {}
        : { plainText: extractPlainTextFromRichTextDocument(content) }),
      children,
      edge: definition.kind === "text" ? "text" : "block",
    };
  }

  private nodeForTarget(
    target: EditorBlockSelectionTarget,
    children: readonly PendingFragmentNode[],
    edge: PendingFragmentNode["edge"],
    overrides: {
      readonly metadata?: JsonObject;
      readonly content?: RichTextDocumentNodeJson;
      readonly plainText?: string;
    } = {},
  ): PendingFragmentNode {
    const metadata =
      overrides.metadata ?? normalizeBlockMetadata(target.block.metadata);
    return {
      key: target.block.id,
      type: target.block.type,
      ...(metadata === undefined ? {} : { metadata }),
      ...(overrides.content === undefined
        ? {}
        : { content: overrides.content }),
      ...(overrides.plainText === undefined
        ? {}
        : { plainText: overrides.plainText }),
      children,
      edge,
    };
  }

  private boundaryForNode(
    node: PendingFragmentNode,
    edge: "start" | "end",
    allocated: ReadonlyMap<string, ReturnType<typeof createBlockRecord>>,
  ): CanonicalFragmentBoundary {
    if (node.edge === "children") {
      const child =
        edge === "start"
          ? node.children[0]
          : node.children[node.children.length - 1];
      if (!child)
        throw new Error(`fragment boundary wrapper ${node.key} is empty`);
      return this.boundaryForNode(child, edge, allocated);
    }
    return { kind: node.edge, blockId: allocated.get(node.key)!.id };
  }
}

function rebaseBoundaryBlocks(
  blocks: readonly EditorSelectionRangeBlock[],
  start: EditorLogicalSelectionPoint,
  end: EditorLogicalSelectionPoint,
): readonly EditorSelectionRangeBlock[] {
  let changed = false;
  const rebased = blocks.map((rangeBlock) => {
    const isStart =
      rangeBlock.blockId === start.blockId && Boolean(start.textAnchor);
    const isEnd = rangeBlock.blockId === end.blockId && Boolean(end.textAnchor);
    if (!isStart && !isEnd) return rangeBlock;
    const startOffset = isStart ? start.textOffset : rangeBlock.startOffset;
    const endOffset = isEnd ? end.textOffset : rangeBlock.endOffset;
    if (
      startOffset === rangeBlock.startOffset &&
      endOffset === rangeBlock.endOffset
    ) {
      return rangeBlock;
    }
    changed = true;
    return {
      ...rangeBlock,
      ...(isStart ? { startOffset, startTextAnchor: start.textAnchor! } : {}),
      ...(isEnd ? { endOffset, endTextAnchor: end.textAnchor! } : {}),
    };
  });
  return changed ? Object.freeze(rebased) : blocks;
}

function fragmentDescriptorForRangeBlock(
  rangeBlock: EditorSelectionRangeBlock | undefined,
): BlockSelectionFragmentDescriptor | null {
  const value = rangeBlock?.coverageResult.fragment;
  if (!isRecord(value) || typeof value.kind !== "string") return null;
  return value.kind === "content" ||
    value.kind === "wrapper" ||
    value.kind === "block" ||
    value.kind === "custom"
    ? (value as unknown as BlockSelectionFragmentDescriptor)
    : null;
}

function resolveSnapshotPoint(
  point: EditorLogicalSelectionPoint | null,
  graph: EditorSelectionGraphReader,
  textAnchorResolver: EditorSelectionTextAnchorResolver,
):
  | { readonly ok: true; readonly point: EditorLogicalSelectionPoint | null }
  | EditorSelectionFailure {
  if (!point || !isEditorSelectionTextAnchor(point.textAnchor)) {
    return { ok: true, point };
  }
  const resolved = resolveEditorSelectionTextAnchorPoint(
    point,
    graph,
    textAnchorResolver,
  );
  if (!resolved.ok) return resolved;
  if (resolved.textOffset === point.textOffset) return { ok: true, point };
  return {
    ok: true,
    point: {
      ...point,
      textOffset: resolved.textOffset,
      textAnchor: resolved.textAnchor,
      affinity: resolved.affinity,
    },
  };
}

function normalizeTextBoundary(
  value: number | undefined,
  fallback: number,
  max: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(0, Math.trunc(value ?? fallback)), max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
