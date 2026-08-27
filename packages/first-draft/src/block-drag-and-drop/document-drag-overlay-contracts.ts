import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorViewportRect } from "@repo/editor-web/document-runtime";
import type { FirstDraftEditor } from "../first-draft-editor-contracts.ts";
import type { FirstDraftViewStateStore } from "../blocks/view-state.tsx";
import type { firstDraftBlockModelDefinitions } from "../server/block-definitions.ts";
import type { FirstDraftHeadingLevel } from "../heading-level.ts";

export type FirstDraftBlockType = keyof typeof firstDraftBlockModelDefinitions;

export type FirstDraftBlockDragPreviewBlock = VersionedBlock & {
  readonly type: FirstDraftBlockType;
};

export interface FirstDraftBlockDragColumnPresentation {
  readonly tracks: string;
  readonly orderedColumnIds: readonly BlockId[];
  readonly weights: readonly number[];
}

export interface FirstDraftBlockDragTablePresentation {
  readonly columnIds: readonly string[];
  readonly columnWidths: Readonly<Record<string, number>>;
  readonly tracks: string;
  readonly rowCount: number;
  readonly columnCount: number;
}

/** Captured product view state and derived visual context only. */
export interface FirstDraftBlockDragPresentationState {
  readonly headingLevel: FirstDraftHeadingLevel | null;
  readonly checked: boolean | null;
  readonly orderedListOrdinal: number | null;
  readonly collapsed: boolean | null;
  readonly selectedTabPaneId: BlockId | null;
  readonly columns: FirstDraftBlockDragColumnPresentation | null;
  readonly table: FirstDraftBlockDragTablePresentation | null;
}

export interface FirstDraftBlockDragPreviewNode {
  readonly block: FirstDraftBlockDragPreviewBlock;
  readonly content: RichTextDocumentNodeJson | null;
  readonly children: readonly FirstDraftBlockDragPreviewNode[];
  readonly presentation: FirstDraftBlockDragPresentationState;
}

export interface FirstDraftDocumentBlockSourcePlacement {
  readonly blockId: BlockId;
  readonly parentId: BlockId | null;
  readonly childIndex: number;
}

interface FirstDraftDocumentBlockDragSessionBase {
  readonly blockId: BlockId;
}

export interface FirstDraftValidDocumentBlockDragSession
  extends FirstDraftDocumentBlockDragSessionBase {
  readonly captureSucceeded: true;
  readonly preview: FirstDraftBlockDragPreviewNode;
  readonly sourceRect: EditorViewportRect;
  readonly sourcePlacement: FirstDraftDocumentBlockSourcePlacement;
}

export interface FirstDraftInvalidDocumentBlockDragSession
  extends FirstDraftDocumentBlockDragSessionBase {
  readonly captureSucceeded: false;
}

export type FirstDraftDocumentBlockDragSession =
  | FirstDraftValidDocumentBlockDragSession
  | FirstDraftInvalidDocumentBlockDragSession;

export type FirstDraftBlockDragPreviewEditor = Pick<
  FirstDraftEditor,
  | "getBlock"
  | "getParentId"
  | "getChildBlockIds"
  | "readBlockContent"
>;

export type FirstDraftBlockDragPreviewViewState = Pick<
  FirstDraftViewStateStore,
  "getSelectedTab" | "isBlockCollapsed"
>;
