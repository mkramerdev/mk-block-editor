import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import type { InlineMarkDefinition } from "@repo/editor-core/content/marks";
import {
  sanitizeFirstDraftLinkAttributes,
  type FirstDraftLinkAttributes,
} from "./link-range.ts";

export interface FirstDraftLinkFormDraft {
  readonly href: string;
  readonly title: string;
  readonly target: "" | "_blank";
  readonly mixed?: boolean;
}

export interface FirstDraftLinkFormProps {
  readonly definition: InlineMarkDefinition;
  readonly initialDraft: FirstDraftLinkFormDraft;
  readonly canRemove: boolean;
  readonly showRemove?: boolean;
  readonly ariaLabel?: string;
  readonly onApply: (attrs: FirstDraftLinkAttributes) => string | null;
  readonly onRemove: () => string | null;
  readonly onClose: () => void;
}

export function FirstDraftLinkForm({
  definition,
  initialDraft,
  canRemove,
  showRemove = true,
  ariaLabel = "Edit link",
  onApply,
  onRemove,
  onClose,
}: FirstDraftLinkFormProps) {
  const [href, setHref] = useState(initialDraft.href);
  const [title, setTitle] = useState(initialDraft.title);
  const [target, setTarget] = useState<"" | "_blank">(initialDraft.target);
  const [error, setError] = useState<string | null>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const mixedDescriptionId = useId();

  useLayoutEffect(() => {
    urlRef.current?.focus({ preventScroll: true });
  }, []);

  const apply = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    if (!href.trim()) {
      setError("Enter a URL.");
      return;
    }
    const attrs = sanitizeFirstDraftLinkAttributes(definition, {
      href,
      title: title.trim() || null,
      target: target || null,
    });
    if (!attrs) {
      setError("Enter a valid web, email, or document URL.");
      return;
    }
    const nextError = onApply(attrs);
    if (nextError) setError(nextError);
  };

  const remove = (): void => {
    const nextError = onRemove();
    if (nextError) setError(nextError);
  };

  return (
    <form
      className="first-draft-selection-link-form"
      data-editor-ui="true"
      data-editor-preserve-selection="true"
      aria-label={ariaLabel}
      onSubmit={apply}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
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
          id={mixedDescriptionId}
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
          aria-describedby={initialDraft.mixed ? mixedDescriptionId : undefined}
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
        {showRemove ? (
          <button type="button" disabled={!canRemove} onClick={remove}>
            Remove
          </button>
        ) : null}
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}
