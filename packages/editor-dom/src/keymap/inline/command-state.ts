import {
  createInlineMarkCursorCommandState,
  inactiveInlineMarkCommandState,
  validateInlineMarkCommandAttrs,
  type InlineMarkCommandState,
  type InlineMarkDefinition,
} from "@repo/editor-core/content/marks";
import type { EditorState } from "../../prosemirror/index.ts";

export function readInlineMarkCommandState(
  state: EditorState,
  definition: InlineMarkDefinition,
  attrs?: Readonly<Record<string, unknown>> | null,
): InlineMarkCommandState {
  const markName = definition.name;
  const markType = state.schema.marks[markName];
  if (!markType)
    return inactiveInlineMarkCommandState(definition, "missing-mark");
  if (!validateInlineMarkCommandAttrs(definition, attrs)) {
    return inactiveInlineMarkCommandState(definition, "invalid-attrs");
  }

  if (state.selection.empty) {
    const canExecute =
      state.selection.$from.parent.inlineContent &&
      state.selection.$from.parent.type.allowsMarkType(markType);
    if (!canExecute)
      return inactiveInlineMarkCommandState(definition, "unsupported-context");
    const mark = markType.isInSet(
      state.storedMarks ?? state.selection.$from.marks(),
    );
    return createInlineMarkCursorCommandState(
      definition,
      mark ? { ...mark.attrs } : null,
    );
  }

  return inactiveInlineMarkCommandState(definition, "unsupported-context");
}
