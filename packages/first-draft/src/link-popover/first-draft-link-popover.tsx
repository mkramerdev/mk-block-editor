"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type SyntheticEvent,
} from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import {
  findInlineMarkDefinition,
  inlineMarkValuesEqual,
} from "@repo/editor-core/content/marks";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditableEditor } from "@repo/editor-web/editor";
import type { EditorDocumentLayerInteractionPort } from "@repo/editor-web/document-runtime";
import {
  resolveFirstDraftLinkAtRange,
  sanitizeFirstDraftLinkAttributes,
  type FirstDraftResolvedLink,
} from "./link-range.ts";

export interface FirstDraftLinkPopoverProps {
  readonly editor: EditableEditor;
  readonly geometry: EditableEditor["geometry"];
  readonly interactions: EditorDocumentLayerInteractionPort;
}

interface HoveredLink extends FirstDraftResolvedLink {
  readonly anchor: HTMLAnchorElement;
  readonly candidateRange: { readonly from: number; readonly to: number };
}

interface LinkPopoverPosition {
  readonly left: number;
  readonly top: number;
  readonly placement: "above" | "below";
}

const closeDelayMs = 140;
const popoverGap = 8;
const popoverWidth = 352;
const compactPopoverHeight = 56;

export function FirstDraftLinkPopover({
  editor,
  geometry,
  interactions,
}: FirstDraftLinkPopoverProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const linkHoveredRef = useRef(false);
  const popoverHoveredRef = useRef(false);
  const stateRef = useRef<HoveredLink | null>(null);
  const editingRef = useRef(false);
  const editInputRef = useRef<HTMLInputElement>(null);
  const [hovered, setHovered] = useState<HoveredLink | null>(null);
  const [editing, setEditing] = useState(false);
  const [hrefDraft, setHrefDraft] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const geometryRevision = useSyncExternalStore(
    geometry.subscribe,
    geometry.getRevision,
    readZero,
  );

  useLayoutEffect(() => {
    stateRef.current = hovered;
  }, [hovered]);

  useLayoutEffect(() => {
    editingRef.current = editing;
    if (!editing) return;
    const input = editInputRef.current;
    input?.focus({ preventScroll: true });
    input?.select();
  }, [editing]);

  const cancelClose = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const close = useCallback(() => {
    cancelClose();
    stateRef.current = null;
    linkHoveredRef.current = false;
    popoverHoveredRef.current = false;
    setHovered(null);
    editingRef.current = false;
    setEditing(false);
    setHrefDraft("");
    setActionError(null);
  }, [cancelClose]);

  const cancelEditing = useCallback(() => {
    editingRef.current = false;
    setEditing(false);
    setHrefDraft("");
    setActionError(null);
  }, []);

  const scheduleClose = useCallback(() => {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      if (
        !linkHoveredRef.current &&
        !popoverHoveredRef.current &&
        editInputRef.current !== document.activeElement
      ) {
        close();
      }
    }, closeDelayMs);
  }, [cancelClose, close]);

  useLayoutEffect(() => {
    const layer = layerRef.current;
    const root = layer?.closest<HTMLElement>(
      '[data-editor-block-list-root="true"]',
    );
    if (!root) return;

    const handlePointerOver = (event: PointerEvent): void => {
      const anchor = eventAnchor(event.target);
      if (
        !anchor ||
        anchor.closest('[data-editor-block-list-root="true"]') !== root
      )
        return;
      if (
        event.relatedTarget instanceof Node &&
        anchor.contains(event.relatedTarget)
      )
        return;
      if (root.querySelector('[data-first-draft-selection-menu="true"]')) {
        close();
        return;
      }
      const textRoot = anchor.closest<HTMLElement>(
        '[data-editor-text-root="true"]',
      );
      const shell = anchor.closest<HTMLElement>(
        '[data-editor-block-shell="true"][data-editor-block-id]',
      );
      if (
        !textRoot ||
        !shell ||
        textRoot.closest('[data-editor-block-list-root="true"]') !== root
      ) {
        return;
      }
      const blockId = shell.dataset.editorBlockId as BlockId | undefined;
      if (!blockId) return;
      const candidateRange = geometry.readTextNodeRange(blockId, anchor);
      if (!candidateRange) return;
      const resolved = resolveFirstDraftLinkAtRange(
        editor,
        blockId,
        candidateRange,
      );
      if (!resolved) return;
      cancelClose();
      linkHoveredRef.current = true;
      editingRef.current = false;
      setEditing(false);
      setHrefDraft("");
      setActionError(null);
      setHovered({ ...resolved, anchor, candidateRange });
    };

    const handlePointerOut = (event: PointerEvent): void => {
      const anchor = eventAnchor(event.target);
      if (!anchor || anchor !== stateRef.current?.anchor) return;
      if (
        event.relatedTarget instanceof Node &&
        anchor.contains(event.relatedTarget)
      )
        return;
      linkHoveredRef.current = false;
      scheduleClose();
    };

    root.addEventListener("pointerover", handlePointerOver);
    root.addEventListener("pointerout", handlePointerOut);
    return () => {
      root.removeEventListener("pointerover", handlePointerOver);
      root.removeEventListener("pointerout", handlePointerOut);
      cancelClose();
    };
  }, [cancelClose, close, editor, geometry, scheduleClose]);

  useLayoutEffect(
    () =>
      interactions.registerKeydownHandler((event) => {
        if (event.key !== "Escape" || !stateRef.current) return "unhandled";
        if (editingRef.current) cancelEditing();
        else close();
        return "handled";
      }),
    [cancelEditing, close, interactions],
  );

  useEffect(() => {
    if (!hovered) return;
    return editor.subscribeBlock(hovered.blockId, close);
  }, [close, editor, hovered]);

  useEffect(() => {
    if (!hovered) return;
    return editor.selection.subscribe(close);
  }, [close, editor, hovered]);

  useEffect(() => {
    if (!hovered) return;
    const ownerDocument = hovered.anchor.ownerDocument;
    const interactionScope = hovered.anchor.closest(
      '[data-editor-interaction-scope="true"]',
    );
    const dismissOutside = (event: PointerEvent): void => {
      const target = event.target instanceof Node ? event.target : null;
      if (!target) return;
      const targetScope =
        target instanceof Element
          ? target.closest('[data-editor-interaction-scope="true"]')
          : target.parentElement?.closest(
              '[data-editor-interaction-scope="true"]',
            );
      if (targetScope && targetScope !== interactionScope) return;
      if (
        hovered.anchor.contains(target) ||
        layerRef.current?.contains(target)
      ) {
        return;
      }
      close();
    };
    ownerDocument.addEventListener("pointerdown", dismissOutside, true);
    return () =>
      ownerDocument.removeEventListener("pointerdown", dismissOutside, true);
  }, [close, hovered]);

  useEffect(
    () =>
      geometry.subscribe(() => {
        const current = stateRef.current;
        if (current && !readCurrentHoveredLink(editor, geometry, current)) {
          close();
        }
      }),
    [close, editor, geometry],
  );

  const position = calculateLinkPopoverPosition(
    geometry,
    hovered,
    geometryRevision,
  );
  const definition = findInlineMarkDefinition(
    editor.definition.inlineMarks,
    "link",
  );
  const style: CSSProperties = position
    ? { left: position.left, top: position.top, visibility: "visible" }
    : { visibility: "hidden" };

  const updateCurrentLink = (update: (current: HoveredLink) => boolean) => {
    const current = hovered
      ? readCurrentHoveredLink(editor, geometry, hovered)
      : null;
    if (!current) {
      close();
      return false;
    }
    const changed = update(current);
    if (changed) close();
    return changed;
  };

  const saveLink = (): void => {
    if (!definition || !hrefDraft.trim()) {
      setActionError("Enter a URL.");
      return;
    }
    const current = hovered
      ? readCurrentHoveredLink(editor, geometry, hovered)
      : null;
    if (!current) {
      close();
      return;
    }
    const attrs = sanitizeFirstDraftLinkAttributes(definition, {
      href: hrefDraft,
      title: current.attrs.title,
      target: current.attrs.target,
    });
    if (!attrs) {
      setActionError("Enter a valid web, email, or document URL.");
      return;
    }
    const changed = editor.updateMark(
      {
        blockId: current.blockId,
        range: current.range,
        mark: { type: "link", attrs },
        enabled: true,
      },
      { selectionEffect: { kind: "preserve" } },
    );
    if (changed) close();
    else setActionError("The link could not be updated.");
  };

  return (
    <div
      ref={layerRef}
      className="first-draft-link-popover-layer"
      data-first-draft-link-popover-layer="true"
    >
      {hovered && definition ? (
        <div
          className="first-draft-link-popover"
          role="dialog"
          aria-label="Link options"
          data-editor-ui="true"
          data-editor-preserve-selection="true"
          data-first-draft-link-popover="true"
          data-placement={position?.placement}
          style={style}
          onPointerEnter={() => {
            popoverHoveredRef.current = true;
            cancelClose();
          }}
          onPointerLeave={() => {
            popoverHoveredRef.current = false;
            scheduleClose();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            if (editingRef.current) cancelEditing();
            else close();
          }}
        >
          {editing ? (
            <form
              className="first-draft-link-popover__row"
              aria-label="Edit link destination"
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                event.stopPropagation();
                saveLink();
              }}
            >
              <input
                ref={editInputRef}
                className="first-draft-link-popover__input"
                aria-label="Link URL"
                type="text"
                inputMode="url"
                value={hrefDraft}
                onChange={(event) => {
                  setHrefDraft(event.currentTarget.value);
                  setActionError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  event.currentTarget.form?.requestSubmit();
                }}
              />
              <button type="submit" aria-label="Save link">
                <Check aria-hidden="true" focusable="false" />
              </button>
              <button
                type="button"
                className="first-draft-link-popover__cancel"
                aria-label="Cancel editing link"
                onPointerDown={preventPointerFocus}
                onMouseDown={preventPointerFocus}
                onClick={cancelEditing}
              >
                <X aria-hidden="true" focusable="false" />
              </button>
              {actionError ? (
                <p className="first-draft-link-popover__error" role="alert">
                  {actionError}
                </p>
              ) : null}
            </form>
          ) : (
            <div className="first-draft-link-popover__row">
              <span
                className="first-draft-link-popover__url"
                title={hovered.attrs.href}
              >
                {hovered.attrs.href}
              </span>
              <button
                type="button"
                aria-label="Edit link"
                onClick={() => {
                  editingRef.current = true;
                  setHrefDraft(hovered.attrs.href);
                  setActionError(null);
                  setEditing(true);
                }}
              >
                <Pencil aria-hidden="true" focusable="false" />
              </button>
              <RemoveLinkButton
                remove={() => {
                  const changed = updateCurrentLink((current) =>
                    editor.updateMark(
                      {
                        blockId: current.blockId,
                        range: current.range,
                        mark: { type: "link" },
                        enabled: false,
                      },
                      { selectionEffect: { kind: "preserve" } },
                    ),
                  );
                  if (!changed)
                    setActionError("The link is no longer available.");
                }}
              />
              {actionError ? (
                <p className="first-draft-link-popover__error" role="alert">
                  {actionError}
                </p>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function calculateLinkPopoverPosition(
  geometry: EditableEditor["geometry"],
  hovered: HoveredLink | null,
  geometryRevision: number,
): LinkPopoverPosition | null {
  void geometryRevision;
  if (!hovered) return null;
  const rangeRects = geometry.readTextRangeRects(
    hovered.blockId,
    hovered.range,
  );
  const boundary = geometry.readTextRootRect(hovered.blockId);
  if (rangeRects.length === 0 || !boundary) return null;
  const rangeLeft = Math.min(...rangeRects.map((rect) => rect.left));
  const rangeRight = Math.max(
    ...rangeRects.map((rect) => rect.left + rect.width),
  );
  const rangeTop = Math.min(...rangeRects.map((rect) => rect.top));
  const rangeBottom = Math.max(
    ...rangeRects.map((rect) => rect.top + rect.height),
  );
  const placement =
    rangeTop >= compactPopoverHeight + popoverGap ? "above" : "below";
  const width = Math.min(popoverWidth, boundary.width);
  const centeredLeft = (rangeLeft + rangeRight) / 2 - width / 2;
  const left = Math.max(
    boundary.left,
    Math.min(centeredLeft, boundary.left + boundary.width - width),
  );
  return {
    left,
    top:
      placement === "above"
        ? rangeTop - popoverGap
        : rangeBottom + popoverGap,
    placement,
  };
}

function RemoveLinkButton({ remove }: { readonly remove: () => void }) {
  return (
    <button
      type="button"
      aria-label="Remove link"
      onPointerDown={preventPointerFocus}
      onMouseDown={preventPointerFocus}
      onClick={remove}
    >
      <Trash2 aria-hidden="true" focusable="false" />
    </button>
  );
}

function readCurrentHoveredLink(
  editor: EditableEditor,
  geometry: EditableEditor["geometry"],
  hovered: HoveredLink,
): HoveredLink | null {
  if (!hovered.anchor.isConnected) return null;
  const candidateRange = geometry.readTextNodeRange(
    hovered.blockId,
    hovered.anchor,
  );
  if (!candidateRange) return null;
  const resolved = resolveFirstDraftLinkAtRange(
    editor,
    hovered.blockId,
    candidateRange,
  );
  if (
    !resolved ||
    resolved.range.from !== hovered.range.from ||
    resolved.range.to !== hovered.range.to ||
    !inlineMarkValuesEqual(resolved.attrs, hovered.attrs)
  ) {
    return null;
  }
  return { ...resolved, anchor: hovered.anchor, candidateRange };
}

function eventAnchor(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest("a") : null;
}

function preventPointerFocus(event: SyntheticEvent): void {
  event.preventDefault();
  event.stopPropagation();
}

function readZero(): number {
  return 0;
}
