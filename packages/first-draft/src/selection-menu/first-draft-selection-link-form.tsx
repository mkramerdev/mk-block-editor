import { findInlineMarkDefinition } from "@repo/editor-core/content/marks";
import type { CommittedSelectionSnapshot } from "@repo/editor-react/selection";
import type { EditableEditor } from "@repo/editor-web/editor";
import {
  FirstDraftLinkForm,
  type FirstDraftLinkFormDraft,
} from "../link-popover/first-draft-link-form.tsx";

export type FirstDraftSelectionLinkDraft = FirstDraftLinkFormDraft & {
  readonly mixed: boolean;
};

export interface FirstDraftSelectionLinkFormProps {
  readonly editor: EditableEditor;
  readonly selection: CommittedSelectionSnapshot;
  readonly initialDraft: FirstDraftSelectionLinkDraft;
  readonly canRemove: boolean;
  readonly onClose: () => void;
}

export function FirstDraftSelectionLinkForm({
  editor,
  selection,
  initialDraft,
  canRemove,
  onClose,
}: FirstDraftSelectionLinkFormProps) {
  const definition = findInlineMarkDefinition(
    editor.definition.inlineMarks,
    "link",
  );
  if (!definition) return null;
  return (
    <FirstDraftLinkForm
      definition={definition}
      initialDraft={initialDraft}
      canRemove={canRemove}
      onApply={(attrs) => {
        const result = editor.formatSelectionInlineMark({
          selection,
          markName: "link",
          action: "add",
          attrs,
        });
        if (!result.ok) return selectionFormatError(result.reason);
        onClose();
        return null;
      }}
      onRemove={() => {
        const result = editor.formatSelectionInlineMark({
          selection,
          markName: "link",
          action: "remove",
        });
        if (!result.ok) return selectionFormatError(result.reason);
        onClose();
        return null;
      }}
      onClose={onClose}
    />
  );
}

function selectionFormatError(reason: string): string {
  return reason === "no-change"
    ? "The selected text already has that link."
    : "The original text selection is no longer available.";
}
