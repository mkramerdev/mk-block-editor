"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  CanonicalLocalSelection,
  SelectionController,
} from "@repo/editor-react/selection";
import type { AdditionalSelectionRecord } from "../../runtime/collaboration/contracts.ts";
import type { EditableEditor } from "../../runtime/document/contracts.ts";

export interface EditorBlockScopedSelectionSnapshot {
  readonly local: CanonicalLocalSelection;
  readonly additional: readonly AdditionalSelectionRecord[];
}

const emptyAdditional = Object.freeze(
  [],
) as readonly AdditionalSelectionRecord[];
const readEmptyAdditional = () => emptyAdditional;

/**
 * Wrapper-facing logical selection state. The subscriptions are scoped to the
 * requested canonical subtree and the editable editor's presence projection.
 */
export function useEditorBlockScopedSelection(input: {
  readonly editor: EditableEditor;
  readonly selectionController: SelectionController;
  readonly blockId: BlockId;
}): EditorBlockScopedSelectionSnapshot {
  const { editor, selectionController, blockId } = input;
  const subscribeLocal = useCallback(
    (listener: () => void) =>
      selectionController.endpoint.subscribeBlock(blockId, listener),
    [blockId, selectionController],
  );
  const readLocal = useCallback(
    () => selectionController.getCanonicalSnapshot(),
    [selectionController],
  );
  const local = useSyncExternalStore(subscribeLocal, readLocal, readLocal);

  const additionalReader = editor.additionalSelections;
  const subscribeAdditional = useCallback(
    (listener: () => void) =>
      additionalReader.subscribeBlock(blockId, listener),
    [additionalReader, blockId],
  );
  const readAdditional = useCallback(
    () => additionalReader.getBlockSnapshot(blockId),
    [additionalReader, blockId],
  );
  const additional = useSyncExternalStore(
    subscribeAdditional,
    readAdditional,
    readEmptyAdditional,
  );

  return useMemo(() => ({ local, additional }), [additional, local]);
}
