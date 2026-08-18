"use client";

import { useState } from "react";
import type { JsonObject } from "@repo/editor-core/kernel";
import { useEditorAtomicFocusTarget } from "@repo/editor-web/block-renderer";
import type { FirstDraftBlockRendererProps } from "../../first-draft-editor-contracts.ts";
import {
  FIRST_DRAFT_BLOCK_CONTROL_OFFSETS,
  FirstDraftBlockChrome,
} from "../../block-controls/index.ts";

type Props = FirstDraftBlockRendererProps;

export function BookmarkRenderer({ block, editor }: Props) {
  const atomicFocusRef = useEditorAtomicFocusTarget(editor, block.id);
  const url = stringMetadata(block.metadata, "url");
  const normalized = normalizeUrl(url);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(url);
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.bookmark}
      />
      <div
        ref={atomicFocusRef}
        className="bookmark-block__object"
        role="group"
        aria-label="Bookmark card"
        data-editor-object-root="true"
        tabIndex={-1}
      >
        {normalized ? (
          <a
            className="bookmark-block__card"
            href={normalized}
            target="_blank"
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <span className="bookmark-block__copy">
              <strong>{host(normalized)}</strong>
              <span>{normalized}</span>
            </span>
            <span aria-hidden="true">↗</span>
          </a>
        ) : (
          <MediaEmpty label="Bookmark has no URL" />
        )}
        <button
          type="button"
          className="media-block__edit"
          aria-expanded={open}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setOpen((value) => !value)}
        >
          Change URL
        </button>
        {open ? (
          <form
            className="media-block__source-form"
            onPointerDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              const next = normalizeUrl(draft);
              if (!next) return;
              editor.updateBlockMetadata([
                { blockId: block.id, values: { url: next } },
              ]);
              setOpen(false);
            }}
          >
            <label>
              Bookmark URL
              <input
                aria-label="Bookmark URL"
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
              />
            </label>
            <button type="submit">Use URL</button>
          </form>
        ) : null}
      </div>
    </>
  );
}

function MediaEmpty({ label }: { readonly label: string }) {
  return <div className="media-block__empty">{label}</div>;
}

function stringMetadata(metadata: JsonObject | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

function normalizeUrl(value: string): string | null {
  const candidate = /^[a-z][a-z\d+.-]*:/iu.test(value.trim())
    ? value.trim()
    : value.trim()
      ? `https://${value.trim()}`
      : "";
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function host(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./u, "");
  } catch {
    return "";
  }
}
