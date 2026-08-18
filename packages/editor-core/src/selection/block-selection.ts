import type { BlockType } from "../document/model/block.ts";
import type { EditorTextBlockContent } from "../document/model/snapshot.ts";
import type { BlockId } from "../kernel/identity/ids.ts";
import type { JsonValue } from "../kernel/json/json-value.ts";

export type BlockSelectionCoverage =
  | "none"
  | "partial"
  | "complete-content"
  | "complete-block";

export type BlockSelectionProjectionCategory = "text" | "wrapper" | "object";

export type BlockSelectionEndpointKind = "content" | "block";

export interface BlockSelectionEndpoint {
  readonly kind: BlockSelectionEndpointKind;
}

export interface BlockSelectionProjection {
  readonly category: BlockSelectionProjectionCategory;
  readonly endpoint: BlockSelectionEndpoint;
  readonly canStartSelection: boolean;
  readonly selectable: boolean;
}

export interface BlockSelectionChildScope {
  readonly kind: "all";
}

export interface BlockSelectionChildrenModel {
  readonly scope: BlockSelectionChildScope;
}

export interface BlockSelectionCoveragePolicy {
  readonly selected: BlockSelectionCoverage;
  readonly range: readonly BlockSelectionCoverage[];
}

export interface BlockSelectionContentPaintDescriptor {
  readonly kind: "content";
}

export interface BlockSelectionBlockSurfacePaintDescriptor {
  readonly kind: "block-surface";
  readonly target?: string;
  readonly coverage?: readonly Extract<
    BlockSelectionCoverage,
    "complete-content" | "complete-block"
  >[];
}

export type BlockSelectionPaintDescriptor =
  | BlockSelectionContentPaintDescriptor
  | BlockSelectionBlockSurfacePaintDescriptor;

export interface BlockSelectionContentFragmentDescriptor {
  readonly kind: "content";
}

export interface BlockSelectionWrapperFragmentDescriptor {
  readonly kind: "wrapper";
  /**
   * Controls when a wrapper survives document-selection fragment shaping.
   * The default requires every in-scope child to be selected completely.
   */
  readonly inclusion?:
    | "complete-content"
    | "multiple-selected-children"
    | "never";
  /** Limit completeness checks to product-visible direct children. */
  readonly contentScope?: "all" | "visible";
  /** Copy every canonical child once the wrapper qualifies (for hidden content). */
  readonly preservedChildren?: "selected" | "all";
}

export interface BlockSelectionBlockFragmentDescriptor {
  readonly kind: "block";
}

export interface BlockSelectionCustomFragmentNode {
  readonly type: BlockType;
  readonly metadata?: Record<string, unknown>;
  readonly content?: EditorTextBlockContent;
  readonly plainText?: string;
  readonly children?: readonly BlockSelectionCustomFragmentNode[];
}

export interface BlockSelectionCustomFragmentDescriptor {
  readonly kind: "custom";
  readonly nodes?: readonly BlockSelectionCustomFragmentNode[];
  readonly plainText?: string;
}

export type BlockSelectionFragmentDescriptor =
  | BlockSelectionContentFragmentDescriptor
  | BlockSelectionWrapperFragmentDescriptor
  | BlockSelectionBlockFragmentDescriptor
  | BlockSelectionCustomFragmentDescriptor;

export interface BlockSelectionContentEditDescriptor {
  readonly kind: "content";
}

export interface BlockSelectionWrapperEditDescriptor {
  readonly kind: "wrapper";
}

export interface BlockSelectionBlockEditDescriptor {
  readonly kind: "block";
}

export interface BlockSelectionCustomEditDescriptor {
  readonly kind: "custom";
  readonly removeBlock?: boolean;
  readonly behavior?: unknown;
}

export type BlockSelectionEditDescriptor =
  | BlockSelectionContentEditDescriptor
  | BlockSelectionWrapperEditDescriptor
  | BlockSelectionBlockEditDescriptor
  | BlockSelectionCustomEditDescriptor;

export interface BlockSelectionChildCoverage {
  readonly blockId: BlockId;
  readonly coverage: BlockSelectionCoverage;
}

export interface BlockSelectionRuntimeCoverageResult<
  InternalSelection = unknown,
  PaintDescriptor = unknown,
  FragmentDescriptor = unknown,
  EditBehavior = unknown,
> {
  readonly coverage: BlockSelectionCoverage;
  readonly internal?: InternalSelection;
  readonly paint?: PaintDescriptor;
  readonly fragment?: FragmentDescriptor;
  readonly edit?: EditBehavior;
  readonly delete?: EditBehavior;
  readonly cut?: EditBehavior;
  readonly move?: EditBehavior;
  readonly childCoverages?: readonly BlockSelectionChildCoverage[];
}

export interface BlockSelectionCoverageResult<
  InternalSelection = unknown,
  PaintDescriptor = unknown,
  FragmentDescriptor = unknown,
  EditBehavior = unknown,
> {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly modelId: string;
  readonly coverage: BlockSelectionCoverage;
  readonly internal?: InternalSelection;
  readonly paint?: PaintDescriptor;
  readonly fragment?: FragmentDescriptor;
  readonly edit?: EditBehavior;
  readonly delete?: EditBehavior;
  readonly cut?: EditBehavior;
  readonly move?: EditBehavior;
  readonly childCoverages?: readonly BlockSelectionChildCoverage[];
  /** Transport-safe projection of `internal`; `internal` remains canonical. */
  readonly stableSelectionPayload?: JsonValue;
}

export interface BlockSelectionModel<
  InternalSelection = unknown,
  PaintDescriptor = BlockSelectionPaintDescriptor,
  FragmentDescriptor = BlockSelectionFragmentDescriptor,
  EditBehavior = BlockSelectionEditDescriptor,
> {
  readonly id: string;
  readonly coverage: BlockSelectionCoveragePolicy;
  readonly projection: BlockSelectionProjection;
  readonly children?: BlockSelectionChildrenModel;
  readonly internal?: InternalSelection;
  readonly paint?: PaintDescriptor;
  readonly fragment?: FragmentDescriptor;
  readonly edit?: EditBehavior;
  readonly delete?: EditBehavior;
  readonly cut?: EditBehavior;
  readonly move?: EditBehavior;
}

export function contentSelection(): BlockSelectionModel {
  return {
    id: "content",
    coverage: {
      selected: "complete-content",
      range: ["none", "partial", "complete-content"],
    },
    projection: {
      category: "text",
      endpoint: { kind: "content" },
      canStartSelection: true,
      selectable: true,
    },
    paint: { kind: "content" },
    fragment: { kind: "content" },
    edit: { kind: "content" },
    delete: { kind: "content" },
    cut: { kind: "content" },
    move: { kind: "content" },
  };
}

export function wrapperSelection(
  options: {
    readonly children?: BlockSelectionChildrenModel;
    readonly fragment?: BlockSelectionWrapperFragmentDescriptor;
  } = {},
): BlockSelectionModel {
  return {
    id: "wrapper",
    coverage: {
      selected: "none",
      range: ["none", "partial", "complete-content", "complete-block"],
    },
    projection: {
      category: "wrapper",
      endpoint: { kind: "block" },
      canStartSelection: false,
      selectable: false,
    },
    children: options.children ?? { scope: { kind: "all" } },
    paint: { kind: "block-surface" },
    fragment: options.fragment ?? { kind: "wrapper" },
    edit: { kind: "wrapper" },
    delete: { kind: "wrapper" },
    cut: { kind: "wrapper" },
    move: { kind: "wrapper" },
  };
}

export function wholeSelection(): BlockSelectionModel {
  return {
    id: "whole",
    coverage: {
      selected: "complete-block",
      range: ["none", "complete-block"],
    },
    projection: {
      category: "object",
      endpoint: { kind: "block" },
      canStartSelection: false,
      selectable: true,
    },
    paint: { kind: "block-surface" },
    fragment: { kind: "block" },
    edit: { kind: "block" },
    delete: { kind: "block" },
    cut: { kind: "block" },
    move: { kind: "block" },
  };
}
