import {
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { CommittedSelectionSnapshot } from "@repo/editor-react/selection";
import type { EditableEditor } from "@repo/editor-web/editor";

export interface FirstDraftSelectionLinkDraft {
  readonly href: string;
  readonly title: string;
  readonly target: "" | "_blank";
  readonly mixed: boolean;
}

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
  const [href, setHref] = useState(initialDraft.href);
  const [title, setTitle] = useState(initialDraft.title);
  const [target, setTarget] = useState<"" | "_blank">(initialDraft.target);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    urlRef.current?.focus({ preventScroll: true });
  }, []);

  const apply = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const trimmedHref = href.trim();
    if (!trimmedHref) {
      setError("Enter a URL.");
      return;
    }
    const result = editor.formatSelectionInlineMark({
      selection,
      markName: "link",
      action: "add",
      attrs: {
        href: trimmedHref,
        title: title.trim() || null,
        target: target || null,
      },
    });
    if (!result.ok) {
      setError(selectionFormatError(result.reason));
      return;
    }
    onClose();
  };

  const remove = (): void => {
    const result = editor.formatSelectionInlineMark({
      selection,
      markName: "link",
      action: "remove",
    });
    if (!result.ok) {
      setError(selectionFormatError(result.reason));
      return;
    }
    onClose();
  };

  return (
    <form
      className="first-draft-selection-link-form"
      data-editor-ui="true"
      aria-label="Edit link"
      onSubmit={apply}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      {initialDraft.mixed ? (
        <p
          className="first-draft-selection-link-form__mixed"
          id="first-draft-selection-link-mixed"
        >
          The selection contains different links. Applying replaces them.
        </p>
      ) : null}
      <label className="first-draft-selection-link-form__field">
        <span>URL</span>
        <input
          ref={urlRef}
          required
          type="url"
          inputMode="url"
          value={href}
          aria-describedby={
            initialDraft.mixed ? "first-draft-selection-link-mixed" : undefined
          }
          onChange={(event) => {
            setHref(event.currentTarget.value);
            setError(null);
          }}
        />
      </label>
      <label className="first-draft-selection-link-form__field">
        <span>Title (optional)</span>
        <input
          type="text"
          value={title}
          onChange={(event) => {
            setTitle(event.currentTarget.value);
            setError(null);
          }}
        />
      </label>
      <label className="first-draft-selection-link-form__field">
        <span>Target</span>
        <select
          value={target}
          onChange={(event) => {
            setTarget(event.currentTarget.value === "_blank" ? "_blank" : "");
            setError(null);
          }}
        >
          <option value="">Same tab</option>
          <option value="_blank">New tab</option>
        </select>
      </label>
      {error ? (
        <p className="first-draft-selection-link-form__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="first-draft-selection-link-form__actions">
        <button type="submit">Apply</button>
        <button type="button" disabled={!canRemove} onClick={remove}>
          Remove
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function selectionFormatError(reason: string): string {
  return reason === "no-change"
    ? "The selected text already has that link."
    : "The original text selection is no longer available.";
}
