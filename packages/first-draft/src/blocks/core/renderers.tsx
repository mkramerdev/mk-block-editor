"use client";

import {
  Children,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { EditableTextBlockPrimitive } from "@repo/editor-web/editable-block-renderer";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  blockHeadingLevel,
  normalizeHeadingLevel,
  useDirectChildBlocks,
  useEditorAtomicFocusTarget,
} from "@repo/editor-web/block-renderer";
import type { FirstDraftBlockRendererProps } from "../../first-draft-editor-contracts.ts";
import {
  delegateFirstDraftBlockHover,
  FIRST_DRAFT_BLOCK_CONTROL_OFFSETS,
  FirstDraftBlockChrome,
  useSetHoveredFirstDraftBlockId,
} from "../../block-controls/index.ts";
import { useCollapsed } from "../view-state.tsx";

type Props = FirstDraftBlockRendererProps;

export function ParagraphRenderer({ block, editor }: Props) {
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.paragraph}
      />
      <div className="paragraph-block__paragraph">
        <EditableTextBlockPrimitive
          block={block}
          editor={editor}
          placeholder={{ text: "Type something…", visibility: "active" }}
          rootAttributes={{ "aria-label": "Paragraph text" }}
        />
      </div>
    </>
  );
}

export function HeadingRenderer({ block, editor }: Props) {
  const level = normalizeHeadingLevel(block.metadata?.level);
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.heading[level]}
      />
      <div
        className="heading-block__heading"
        data-editor-heading-level={String(level)}
      >
        <EditableTextBlockPrimitive
          block={block}
          editor={editor}
          placeholder={{ text: "Heading", visibility: "always" }}
          rootAttributes={{ "aria-label": `Heading level ${level}` }}
        />
      </div>
    </>
  );
}

export function ListItemRenderer({ block, editor, children }: Props) {
  const primaryBlock = useDirectChildBlocks(editor, block.id)[0] ?? null;
  const elements = Children.toArray(children);
  const setHoveredBlockId = useSetHoveredFirstDraftBlockId();
  const delegatedIds = useDelegatedIds(block.id, primaryBlock?.id);
  const ordered = block.type === "orderedListItem";
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.listItem}
      />
      <div
        className="list-item-block__item"
        data-list-item-id={block.id}
        data-list-kind={ordered ? "ordered" : "bullet"}
        onPointerMove={(event) =>
          delegateFirstDraftBlockHover(
            event,
            delegatedIds,
            block.id,
            setHoveredBlockId,
          )
        }
      >
        <span className="list-item-block__marker" aria-hidden="true" />
        <div className="list-item-block__content">{elements}</div>
      </div>
    </>
  );
}

export function ListContainerRenderer({ children }: Props): ReactNode {
  return children;
}

export function ChecklistContainerRenderer({ children }: Props): ReactNode {
  return children;
}

export function QuoteRenderer({ block, editor, children }: Props) {
  const primaryBlock = useDirectChildBlocks(editor, block.id)[0] ?? null;
  const setHoveredBlockId = useSetHoveredFirstDraftBlockId();
  const delegatedIds = useDelegatedIds(block.id, primaryBlock?.id);
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.quote}
      />
      <blockquote
        className="quote-block__quote"
        onPointerMove={(event) =>
          delegateFirstDraftBlockHover(
            event,
            delegatedIds,
            block.id,
            setHoveredBlockId,
          )
        }
      >
        {children}
      </blockquote>
    </>
  );
}

export function CodeRenderer({ block, editor, children }: Props) {
  const primaryBlock = useDirectChildBlocks(editor, block.id)[0] ?? null;
  const setHoveredBlockId = useSetHoveredFirstDraftBlockId();
  const delegatedIds = useDelegatedIds(block.id, primaryBlock?.id);
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.code}
      />
      <div
        className="code-block__presentation"
        onPointerMove={(event) =>
          delegateFirstDraftBlockHover(
            event,
            delegatedIds,
            block.id,
            setHoveredBlockId,
          )
        }
      >
        {children}
      </div>
    </>
  );
}

export function ChecklistItemRenderer({ block, editor, children }: Props) {
  const checked = block.metadata?.checked === true;
  const elements = Children.toArray(children);
  const primaryBlock = useDirectChildBlocks(editor, block.id)[0] ?? null;
  const setHoveredBlockId = useSetHoveredFirstDraftBlockId();
  const delegatedIds = useDelegatedIds(block.id, primaryBlock?.id);
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.checklist}
      />
      <div
        className="checklist-block__item"
        data-checked={String(checked)}
        onPointerMove={(event) =>
          delegateFirstDraftBlockHover(
            event,
            delegatedIds,
            block.id,
            setHoveredBlockId,
          )
        }
      >
        <input
          type="checkbox"
          disabled={!editor.editable}
          checked={checked}
          aria-label="Checklist item complete"
          onPointerDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
          onFocus={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) =>
            editor.updateBlockMetadata(
              [
                {
                  blockId: block.id,
                  values: { checked: event.currentTarget.checked },
                },
              ],
              { selectionEffect: { kind: "preserve" } },
            )
          }
        />
        <div className="checklist-block__content">{elements}</div>
      </div>
    </>
  );
}

const CALLOUT_ICONS = [
  { id: "idea", label: "Idea", glyph: "💡" },
  { id: "info", label: "Info", glyph: "ⓘ" },
  { id: "warning", label: "Warning", glyph: "⚠" },
  { id: "task", label: "Task", glyph: "☑" },
] as const;

export function CalloutRenderer({ block, editor, children }: Props) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const icon =
    CALLOUT_ICONS.find((entry) => entry.id === block.metadata?.icon) ??
    CALLOUT_ICONS[0];
  const firstChild = useDirectChildBlocks(editor, block.id)[0] ?? null;
  const setHoveredBlockId = useSetHoveredFirstDraftBlockId();
  const delegatedIds = useDelegatedIds(block.id, firstChild?.id);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        pickerRef.current?.contains(event.target)
      )
        return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.callout}
      />
      <div
        className="callout-block__callout"
        role="group"
        aria-label="Callout block"
        data-editor-first-child-heading-level={blockHeadingLevel(firstChild)}
        data-callout-icon={icon.id}
        data-callout-picker-open={open ? "true" : undefined}
        onPointerMove={(event) =>
          delegateFirstDraftBlockHover(
            event,
            delegatedIds,
            block.id,
            setHoveredBlockId,
          )
        }
      >
        <div className="callout-block__icon-wrap" ref={pickerRef}>
          <button
            type="button"
            className="callout-block__icon-button"
            aria-label="Change callout icon"
            aria-expanded={open}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setOpen((value) => !value);
            }}
          >
            <span aria-hidden="true">{icon.glyph}</span>
          </button>
          {open ? (
            <div className="callout-block__picker" role="menu">
              {CALLOUT_ICONS.map((candidate) => (
                <button
                  type="button"
                  role="menuitem"
                  key={candidate.id}
                  onClick={() => {
                    editor.updateBlockMetadata(
                      [{ blockId: block.id, values: { icon: candidate.id } }],
                      { editorSuggestion: { selection: null } },
                    );
                    setOpen(false);
                  }}
                >
                  {candidate.glyph} {candidate.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        <div className="callout-block__body">{children}</div>
      </div>
    </>
  );
}

export function ToggleHeadingRenderer(props: Props) {
  return <ToggleRenderer {...props} variant="heading" />;
}

export function ToggleListItemRenderer(props: Props) {
  return <ToggleRenderer {...props} variant="list" />;
}

function ToggleRenderer({
  block,
  editor,
  children,
  variant,
}: Props & { readonly variant: "heading" | "list" }) {
  const [collapsed, toggle] = useCollapsed(block.id);
  const childBlocks = useDirectChildBlocks(editor, block.id);
  const elements = Children.toArray(children);
  const summaryBlock = childBlocks[0] ?? null;
  const setHoveredBlockId = useSetHoveredFirstDraftBlockId();
  const delegatedIds = useDelegatedIds(block.id, summaryBlock?.id);
  const summaryHeadingLevel = blockHeadingLevel(summaryBlock);
  const prefix =
    variant === "heading" ? "toggle-heading-block" : "toggle-list-item-block";
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={
          variant === "heading"
            ? FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.toggleHeading
            : FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.toggleList
        }
      />
      <div
        className={`${prefix}__toggle`}
        role="group"
        aria-expanded={!collapsed}
        onPointerMove={(event) =>
          delegateFirstDraftBlockHover(
            event,
            delegatedIds,
            block.id,
            setHoveredBlockId,
          )
        }
      >
        <div
          className={`${prefix}__summary`}
          data-editor-summary-heading-level={summaryHeadingLevel}
        >
          <button
            type="button"
            className={`${prefix}__chevron`}
            aria-label={collapsed ? "Expand toggle" : "Collapse toggle"}
            onClick={(event) => {
              event.stopPropagation();
              toggle();
            }}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              data-expanded={String(!collapsed)}
            >
              <path
                d="M6 4l4 4-4 4"
                fill="none"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <div className={`${prefix}__summary-children`}>
            {elements[0] ?? null}
          </div>
        </div>
        <div className={`${prefix}__body`} hidden={collapsed}>
          {elements[1] ?? null}
        </div>
      </div>
    </>
  );
}

export function TransparentWrapperRenderer({ children }: Props) {
  return <>{children}</>;
}

export function DividerRenderer({ block, editor }: Props) {
  const atomicFocusRef = useEditorAtomicFocusTarget(editor, block.id);
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.divider}
      />
      <hr
        ref={atomicFocusRef}
        className="divider-block__rule"
        aria-label="Divider"
        tabIndex={-1}
        data-editor-object-root="true"
      />
    </>
  );
}

export function PlaceholderRenderer({ block, editor }: Props) {
  const [executing, setExecuting] = useState(false);
  const atomicFocusRef = useEditorAtomicFocusTarget(editor, block.id);
  if (!editor.editable) return null;
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.placeholder}
      />
      <button
        ref={atomicFocusRef}
        type="button"
        className="placeholder-block__button"
        aria-label="Add paragraph"
        disabled={executing}
        data-editor-object-root="true"
        onMouseDown={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
          setExecuting(true);
          editor.blurEditor();
          const result = editor.replaceBlock({
            blockId: block.id,
            blockType: "paragraph",
            selection: true,
          });
          if (!result.ok) setExecuting(false);
        }}
      >
        + Add text
      </button>
    </>
  );
}

function useDelegatedIds(
  ownerId: BlockId,
  delegatedChildId: BlockId | undefined,
): ReadonlySet<BlockId> {
  return useMemo(
    () => new Set(delegatedChildId ? [ownerId, delegatedChildId] : [ownerId]),
    [delegatedChildId, ownerId],
  );
}
