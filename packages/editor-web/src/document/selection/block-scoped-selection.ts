"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  CanonicalLocalSelection,
  SelectionController,
} from "@repo/editor-react/selection";
import type { AdditionalSelectionRecord } from "../../runtime/collaboration/contracts.ts";
import type { Editor } from "../../runtime/document/contracts.ts";

export interface EditorBlockScopedSelectionSnapshot {
  readonly local: CanonicalLocalSelection;
  readonly additional: readonly AdditionalSelectionRecord[];
}

const emptyAdditional = Object.freeze(
  [],
) as readonly AdditionalSelectionRecord[];
const subscribeNever = () => () => undefined;
const readEmptyAdditional = () => emptyAdditional;

/**
 * Wrapper-facing logical selection state. The subscriptions are scoped to the
 * requested canonical subtree; read editors never access an additional reader.
 */
export function useEditorBlockScopedSelection(input: {
  readonly editor: Editor;
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

  const additionalReader = editor.editable ? editor.additionalSelections : null;
  const subscribeAdditional = useCallback(
    (listener: () => void) =>
      additionalReader
        ? additionalReader.subscribeBlock(blockId, listener)
        : subscribeNever(),
    [additionalReader, blockId],
  );
  const readAdditional = useCallback(
    () => additionalReader?.getBlockSnapshot(blockId) ?? emptyAdditional,
    [additionalReader, blockId],
  );
  const additional = useSyncExternalStore(
    additionalReader ? subscribeAdditional : subscribeNever,
    additionalReader ? readAdditional : readEmptyAdditional,
    readEmptyAdditional,
  );

  return useMemo(() => ({ local, additional }), [additional, local]);
}
