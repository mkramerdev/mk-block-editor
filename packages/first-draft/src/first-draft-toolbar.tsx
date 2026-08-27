import { Redo, Undo } from "lucide-react";

interface FirstDraftToolbarProps {
  readonly onUndo?: () => void;
  readonly onRedo?: () => void;
  readonly onResetDocument?: () => void;
  readonly resetError?: string | null;
  readonly collaborationStatus: string;
  readonly collaborationError?: string | null;
}

export function FirstDraftToolbar({
  onUndo,
  onRedo,
  onResetDocument,
  resetError = null,
  collaborationStatus,
  collaborationError = null,
}: FirstDraftToolbarProps) {
  return (
    <div
      className="first-draft-example__toolbar"
      role="toolbar"
      aria-label="Editor controls"
    >
      <button
        type="button"
        className="first-draft-example__toolbar-icon-button"
        aria-label="Undo"
        title="Undo"
        disabled={!onUndo}
        onClick={onUndo}
      >
        <Undo aria-hidden="true" />
      </button>
      <button
        type="button"
        className="first-draft-example__toolbar-icon-button"
        aria-label="Redo"
        title="Redo"
        disabled={!onRedo}
        onClick={onRedo}
      >
        <Redo aria-hidden="true" />
      </button>
      <button
        type="button"
        disabled={!onResetDocument}
        onClick={onResetDocument}
      >
        Reset document
      </button>
      <output
        className="first-draft-example__toolbar-collaboration-status"
        data-first-draft-collaboration-status={collaborationStatus}
        aria-live="polite"
      >
        Collaboration: {collaborationStatus}
        {collaborationError ? ` — ${collaborationError}` : ""}
      </output>
      {resetError ? (
        <span role="alert" className="first-draft-example__reset-error">
          {resetError}
        </span>
      ) : null}
    </div>
  );
}
