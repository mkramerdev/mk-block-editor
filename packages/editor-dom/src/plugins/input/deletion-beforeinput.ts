import {
  Plugin,
  PluginKey,
  type EditorView,
  type Transaction,
} from "../../prosemirror/index.ts";
import { isComposing } from "./composition.ts";

export type EditorOwnedDeletionInputType =
  | "deleteContentBackward"
  | "deleteContentForward";

interface EditorOwnedDeletionMeta {
  readonly inputType: EditorOwnedDeletionInputType;
}

export const editorOwnedDeletionPluginKey = new PluginKey<null>(
  "blockEditorOwnedDeletion",
);

/**
 * Claims browser-resolved ordinary deletion ranges before contenteditable is
 * mutated. Browsers without one usable target range deliberately retain the
 * native ProseMirror DOM-recovery path.
 */
export function createEditorOwnedDeletionPlugin(): Plugin<null> {
  return new Plugin<null>({
    key: editorOwnedDeletionPluginKey,
    state: {
      init: () => null,
      apply: () => null,
    },
    props: {
      handleDOMEvents: {
        beforeinput(view, event) {
          return claimEditorOwnedDeletion(view, event);
        },
      },
    },
  });
}

export function isEditorOwnedDeletionTransaction(
  transaction: Transaction,
): boolean {
  return Boolean(
    transaction.getMeta(editorOwnedDeletionPluginKey) as
      | EditorOwnedDeletionMeta
      | undefined,
  );
}

function claimEditorOwnedDeletion(view: EditorView, event: Event): boolean {
  if (!(event instanceof InputEvent)) return false;
  const inputType = supportedDeletionInputType(event.inputType);
  if (!inputType || event.defaultPrevented || !event.cancelable) return false;
  if (
    view.isDestroyed ||
    !view.editable ||
    !view.dom.isConnected ||
    !view.hasFocus() ||
    view.composing ||
    event.isComposing ||
    isComposing(view.state)
  ) {
    return false;
  }
  const target = event.target;
  if (!(target instanceof Node) || !nodeBelongsToRoot(target, view.dom)) {
    return false;
  }
  const getTargetRanges = event.getTargetRanges;
  if (typeof getTargetRanges !== "function") return false;
  const ranges = getTargetRanges.call(event);
  if (ranges.length !== 1) return false;
  const targetRange = ranges[0];
  if (!targetRange) return false;
  const { startContainer, startOffset, endContainer, endOffset } = targetRange;
  if (
    !nodeBelongsToRoot(startContainer, view.dom) ||
    !nodeBelongsToRoot(endContainer, view.dom)
  ) {
    return false;
  }

  let from: number;
  let to: number;
  try {
    // Bias element-boundary endpoints into the affected content. Text-node
    // endpoints, including surrogate and grapheme boundaries, remain exact.
    from = view.posAtDOM(startContainer, startOffset, 1);
    to = view.posAtDOM(endContainer, endOffset, -1);
  } catch {
    return false;
  }
  if (!isLegalInlineDeletion(view, from, to)) return false;

  const transaction = view.state.tr
    .delete(from, to)
    .setMeta(editorOwnedDeletionPluginKey, { inputType });
  if (!transaction.docChanged) return false;

  // Once claimed, native mutation must remain canceled even when the
  // canonical proposal is rejected—the proposal adapter will reinstall the
  // committed state in that case.
  event.preventDefault();
  view.dispatch(transaction);
  return true;
}

function supportedDeletionInputType(
  inputType: string,
): EditorOwnedDeletionInputType | null {
  return inputType === "deleteContentBackward" ||
    inputType === "deleteContentForward"
    ? inputType
    : null;
}

function nodeBelongsToRoot(node: Node, root: HTMLElement): boolean {
  return node === root || root.contains(node);
}

function isLegalInlineDeletion(
  view: EditorView,
  from: number,
  to: number,
): boolean {
  const textBlock = view.state.doc.firstChild;
  if (
    !textBlock?.isTextblock ||
    !textBlock.inlineContent ||
    view.state.doc.childCount !== 1 ||
    !Number.isSafeInteger(from) ||
    !Number.isSafeInteger(to) ||
    from >= to ||
    from < 1 ||
    to > textBlock.content.size + 1
  ) {
    return false;
  }
  const $from = view.state.doc.resolve(from);
  const $to = view.state.doc.resolve(to);
  return (
    $from.depth === 1 &&
    $to.depth === 1 &&
    $from.parent === textBlock &&
    $to.parent === textBlock &&
    $from.sameParent($to)
  );
}
