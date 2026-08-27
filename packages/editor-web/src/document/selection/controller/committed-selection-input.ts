import {
  executeStructuralEditComposition,
  resolveCanonicalEditComposition,
  type EditorLocalMutationProvenance,
} from "@repo/editor-react/editor";
import {
  resolveStructuralEditRange,
  type CommittedSelectionSnapshot,
} from "@repo/editor-react/selection";
import type { EditorContentBaseToken } from "@repo/editor-core/operations";
import type { EditableEditorRuntimePort } from "../../../runtime/document/render-port.ts";
import { materializeCanonicalTextInput } from "./text-input-materialization.ts";
import { canonicalTextLength } from "../hit-testing/canonical-text-offset.ts";

export interface ApplyTextInsertionToCommittedSelectionInput {
  readonly editor: EditableEditorRuntimePort;
  readonly selection: CommittedSelectionSnapshot;
  readonly text: string;
  readonly expectedSelectionRevision: number;
  readonly expectedContentBases?: readonly EditorContentBaseToken[];
  readonly provenance: EditorLocalMutationProvenance | null;
}

export interface ApplyTextInsertionToCommittedSelectionResult {
  readonly accepted: boolean;
  readonly changed: boolean;
  readonly reason?:
    | "stale-selection"
    | "stale-content"
    | "invalid-selection"
    | "unsupported-input"
    | "commit-rejected";
}

/**
 * Replaces a committed logical selection through the ordinary editor command
 * path. Browser events, DOM selection, renderer state, CRDT state, and
 * recording policy are intentionally absent from this boundary.
 */
export function applyTextInsertionToCommittedSelection(
  input: ApplyTextInsertionToCommittedSelectionInput,
): ApplyTextInsertionToCommittedSelectionResult {
  const { editor, selection, text, expectedSelectionRevision } = input;
  const controller = editor.selectionController;
  if (
    selection.revision !== expectedSelectionRevision ||
    !controller.isCommittedSnapshotCurrent(selection)
  ) {
    return { accepted: false, changed: false, reason: "stale-selection" };
  }
  const graphRevision = editor.getSelectionGraphRevision();
  if (selection.documentSelection.graphRevision !== graphRevision) {
    return { accepted: false, changed: false, reason: "stale-selection" };
  }
  if (
    input.expectedContentBases &&
    !contentBasesAreCurrent(editor, input.expectedContentBases, graphRevision)
  ) {
    return { accepted: false, changed: false, reason: "stale-content" };
  }

  if (!controller.isCommittedSnapshotCurrent(selection)) {
    return { accepted: false, changed: false, reason: "invalid-selection" };
  }
  const range = resolveStructuralEditRange({
    snapshot: selection.documentSelection,
    graph: editor,
    graphRevision,
    blockDefinitions: editor.definition.blocks,
    readBlockContent: (blockId, blockType) =>
      editor.contentRuntime.readBlockProjection(blockId, blockType),
  });
  if (!range) {
    return { accepted: false, changed: false, reason: "invalid-selection" };
  }
  const selectionBlockType =
    selection.endpoints.head?.blockType ??
    selection.endpoints.anchor?.blockType;
  const blockType =
    editor.definition.contentImport?.plainTextBlockType ??
    (selectionBlockType &&
    editor.definition.blocks[selectionBlockType]?.kind === "text"
      ? selectionBlockType
      : null);
  if (blockType === null) {
    return { accepted: false, changed: false, reason: "unsupported-input" };
  }
  const fragment =
    text.length === 0
      ? null
      : materializeCanonicalTextInput({
          text,
          blockType,
          blockDefinitions: editor.definition.blocks,
        });
  if (text.length > 0 && !fragment) {
    return { accepted: false, changed: false, reason: "unsupported-input" };
  }
  const insertedTextLength = canonicalTextLength(text);
  const resolvedComposition = fragment
    ? resolveCanonicalEditComposition({
        graph: {
          blockDefinitions: editor.definition.blocks,
          getBlock: (blockId) => editor.getBlock(blockId),
          getRootBlockIds: () => editor.getRootBlockIds(),
          getChildBlockIds: (parentId) => editor.getChildBlockIds(parentId),
          readBlockContent: (blockId, type) =>
            editor.contentRuntime.readBlockProjection(blockId, type),
        },
        target: { kind: "selection", range },
        fragment,
      })
    : { deletion: range };
  const composition =
    resolvedComposition && range.start.kind === "text"
      ? {
          ...resolvedComposition,
          finalSelection: {
            kind: "text" as const,
            blockId: range.start.blockId,
            offset: range.start.offset + insertedTextLength,
          },
        }
      : resolvedComposition;
  if (
    !composition ||
    !controller.isCommittedSnapshotCurrent(selection) ||
    editor.getSelectionGraphRevision() !== graphRevision
  ) {
    return { accepted: false, changed: false, reason: "stale-selection" };
  }
  const selectedStartBlock = range.blocks.find(
    (selected) => selected.blockId === range.start.blockId,
  );
  const provenance =
    input.provenance?.kind === "typing" &&
    range.start.kind === "text" &&
    selectedStartBlock
      ? {
          ...input.provenance,
          finalSelection: {
            blockId: range.start.blockId,
            blockType: selectedStartBlock.blockType,
            offset: range.start.offset + insertedTextLength,
          },
        }
      : input.provenance;
  const result = executeStructuralEditComposition(editor, composition, {
    provenance,
  });
  return result.ok
    ? { accepted: true, changed: result.changed }
    : { accepted: false, changed: false, reason: "commit-rejected" };
}

function contentBasesAreCurrent(
  editor: EditableEditorRuntimePort,
  expected: readonly EditorContentBaseToken[],
  graphRevision: number,
): boolean {
  for (const base of expected) {
    const block = editor.getBlock(base.blockId);
    if (!block || block.tombstone || block.type !== base.blockType)
      return false;
    const current = editor.contentRuntime.readContentBaseToken(
      base.blockId,
      base.blockType,
      graphRevision,
    );
    if (
      current.graphRevision !== base.graphRevision ||
      current.contentRevision !== base.contentRevision
    )
      return false;
  }
  return true;
}
