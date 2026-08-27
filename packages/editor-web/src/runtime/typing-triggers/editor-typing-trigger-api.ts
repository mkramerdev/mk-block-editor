import {
  richInlineContentSize,
  richTextBlockInlineContent,
  sliceRichTextDocument,
  validateRichTextInlineNodeJson,
  type RichTextInlineNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { EditorLogicalContentOperation } from "@repo/editor-core/operations";
import {
  assertValidCanonicalBlockFragment,
  type CanonicalBlockFragment,
} from "@repo/editor-core/editing";
import { cloneJsonValue, type BlockId } from "@repo/editor-core/kernel";
import type { BlockType } from "@repo/editor-core/document";
import {
  executeStructuralEditComposition,
  resolveTypingTriggerFragmentComposition,
  type EditorContentMutationOptions,
  type EditorPreparedContentSelection,
} from "@repo/editor-react/editor";
import type {
  EditableEditor,
  EditorTypingTriggerFragmentReplacement,
  EditorTypingTriggerInlineReplacement,
} from "../document/contracts.ts";
import type { EditableEditorRuntimePort } from "../document/render-port.ts";
import type { EditorTypingTriggerSessionController } from "./session-controller.ts";
import { resolveCanonicalCreationSelection } from "../../block-operations/canonical-creation-selection.ts";

export function createEditorTypingTriggerApi(
  editor: EditableEditorRuntimePort,
  controller: EditorTypingTriggerSessionController | null,
): Pick<
  EditableEditor,
  | "getTypingTriggerSession"
  | "subscribeTypingTriggerSession"
  | "dismissTypingTriggerSession"
  | "replaceTypingTriggerWithInlineContent"
  | "replaceTypingTriggerWithCanonicalFragment"
> {
  if (controller === null) {
    return {
      getTypingTriggerSession: () => null,
      subscribeTypingTriggerSession: () => () => undefined,
      dismissTypingTriggerSession: () => false,
      replaceTypingTriggerWithInlineContent: () => false,
      replaceTypingTriggerWithCanonicalFragment: () => false,
    };
  }
  return {
    getTypingTriggerSession: controller.getSnapshot,
    subscribeTypingTriggerSession: controller.subscribe,
    dismissTypingTriggerSession(dismissal) {
      return controller.dismiss(dismissal);
    },
    replaceTypingTriggerWithInlineContent(replacement, options) {
      return replaceInlineContent(editor, controller, replacement, options);
    },
    replaceTypingTriggerWithCanonicalFragment(replacement, options) {
      return replaceCanonicalFragment(editor, controller, replacement, options);
    },
  };
}

function replaceInlineContent(
  editor: EditableEditorRuntimePort,
  controller: EditorTypingTriggerSessionController,
  replacement: EditorTypingTriggerInlineReplacement,
  _options: EditorContentMutationOptions | undefined,
): boolean {
  void _options;
  if (!replacement || !Array.isArray(replacement.content)) return false;
  const session = controller.readCurrentSession(replacement);
  if (!session) return false;
  const content = captureInlineContent(editor, replacement.content);
  if (!content) return false;
  const block = editor.getBlock(session.blockId);
  const current =
    block && !block.tombstone && block.type === session.blockType
      ? editor.contentRuntime.readBlockProjection(block.id, block.type)
      : null;
  if (!block || !current) return false;
  const deletedContent = richTextBlockInlineContent(
    sliceRichTextDocument(
      block.type,
      current,
      session.range.from,
      session.range.to,
    ),
  );
  const point = (offset: number) => ({
    blockId: block.id,
    offset,
    contentVersion: block.contentVersion,
  });
  const operation: EditorLogicalContentOperation =
    content.length === 0
      ? {
          kind: "deleteInlineRange",
          blockId: block.id,
          blockType: block.type,
          target: { kind: "text" },
          range: {
            from: point(session.range.from),
            to: point(session.range.to),
          },
          deletedContent,
        }
      : {
          kind: "replaceInlineRange",
          blockId: block.id,
          blockType: block.type,
          target: { kind: "text" },
          range: {
            from: point(session.range.from),
            to: point(session.range.to),
          },
          content,
          deletedContent,
        };
  const base = editor.contentRuntime.readContentBaseToken(
    block.id,
    block.type,
    editor.getSelectionGraphRevision(),
  );
  const selectionAfter = createCollapsedPreparedSelection(
    block.id,
    block.type,
    session.range.from + richInlineContentSize(content),
  );

  const acceptance = controller.beginAcceptance(replacement);
  if (acceptance === null) return false;
  try {
    const result = editor.acceptContentOperationProposal(
      {
        base,
        operations: [operation],
        selectionAfter,
      },
      {
        origin: "typing-trigger-replacement",
        selectionPresentation: "restore-native",
        provenance: null,
      },
    );
    return result.ok;
  } finally {
    controller.releaseAcceptance(acceptance);
  }
}

function replaceCanonicalFragment(
  editor: EditableEditorRuntimePort,
  controller: EditorTypingTriggerSessionController,
  replacement: EditorTypingTriggerFragmentReplacement,
  _options: EditorContentMutationOptions | undefined,
): boolean {
  void _options;
  if (!replacement?.fragment) return false;
  const session = controller.readCurrentSession(replacement);
  if (!session) return false;
  let fragment: CanonicalBlockFragment;
  try {
    fragment = cloneJsonValue(
      replacement.fragment,
    ) as unknown as CanonicalBlockFragment;
    assertValidCanonicalBlockFragment(fragment, {
      blockDefinitions: editor.definition.blocks,
    });
  } catch {
    return false;
  }
  const selection = resolveCanonicalCreationSelection(
    fragment,
    editor.definition.blocks,
    {
      selectionBlockId: replacement.selectionBlockId,
      ...(replacement.selectionOffset === undefined
        ? {}
        : { selectionOffset: replacement.selectionOffset }),
    },
  );
  if (!selection.ok) return false;
  const block = editor.getBlock(session.blockId);
  if (!block || block.tombstone || block.type !== session.blockType)
    return false;
  const sourceContent = editor.contentRuntime.readBlockProjection(
    block.id,
    block.type,
  );
  if (!sourceContent) return false;
  if (fragment.blocks.some((record) => editor.getBlock(record.id) !== null)) {
    return false;
  }
  const composition = resolveTypingTriggerFragmentComposition({
    graph: {
      blockDefinitions: editor.definition.blocks,
      getBlock: (blockId) => editor.getBlock(blockId),
      getRootBlockIds: () => editor.getRootBlockIds(),
      getChildBlockIds: (parentId) => editor.getChildBlockIds(parentId),
      readBlockContent: (blockId, blockType) =>
        editor.contentRuntime.readBlockProjection(blockId, blockType),
    },
    sourceBlock: block,
    range: session.range,
    graphRevision: editor.getSelectionGraphRevision(),
    fragment,
  });
  if (!composition) return false;
  const selectionComposition = {
    ...composition,
    finalSelection: selection.selection,
  };

  const acceptance = controller.beginAcceptance(replacement);
  if (acceptance === null) return false;
  try {
    const result = executeStructuralEditComposition(
      editor,
      selectionComposition,
      {
        provenance: null,
        selectionPresentation: "native-final-selection",
      },
    );
    return result.ok && result.changed;
  } finally {
    controller.releaseAcceptance(acceptance);
  }
}

function captureInlineContent(
  editor: EditableEditorRuntimePort,
  input: readonly RichTextInlineNodeJson[],
): readonly RichTextInlineNodeJson[] | null {
  let captured: readonly RichTextInlineNodeJson[];
  try {
    captured = cloneJsonValue(
      input,
    ) as unknown as readonly RichTextInlineNodeJson[];
  } catch {
    return null;
  }
  for (let index = 0; index < captured.length; index += 1) {
    const result = validateRichTextInlineNodeJson(
      captured[index],
      `replacement.content[${index}]`,
      {
        inlineMarks: editor.definition.inlineMarks,
        inlineAtoms: editor.definition.inlineAtoms.map(
          ({ type, metadata }) => ({ type, metadata }),
        ),
      },
    );
    if (!result.valid) return null;
  }
  return Object.freeze(captured.map((node) => Object.freeze(node)));
}

function createCollapsedPreparedSelection(
  blockId: BlockId,
  blockType: BlockType,
  offset: number,
): EditorPreparedContentSelection {
  const point = {
    blockId,
    blockType,
    textOffset: offset,
    affinity: "forward" as const,
  };
  return { anchor: point, focus: point, direction: "forward" };
}
