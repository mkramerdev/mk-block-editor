"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { EditableTextBlockPrimitive } from "@repo/editor-web/editable-block-renderer";
import type { TextDomPresentation } from "@repo/editor-web/editable-block-renderer";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  editorSelectionBoundsDataAttributes,
  useEditorAtomicFocusTarget,
} from "@repo/editor-web/block-renderer";
import type { FirstDraftBlockRendererProps } from "../../first-draft-editor-contracts.ts";
import {
  FIRST_DRAFT_BLOCK_CONTROL_OFFSETS,
  FirstDraftBlockChrome,
} from "../../block-controls/index.ts";
import { useCollapsed } from "../view-state.tsx";
import {
  OrderedListNumberingProvider,
  useOrderedListItemOrdinal,
} from "./ordered-list-numbering.tsx";
import {
  FIRST_DRAFT_CALLOUT_ICONS,
  resolveFirstDraftCalloutIcon,
} from "../../callout-icons.ts";
import {
  isFirstDraftBlockDropAnchorEligible,
  useFirstDraftBlockDropTargetRef,
} from "../../block-drag-and-drop/index.ts";
import { FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET } from "../../block-drag-and-drop/document-drag-visual-bounds.ts";
import { EmptyWrapperAddTextControl } from "../empty-wrapper-add-text-control.tsx";
import {
  CalloutPresentation,
  HeadingPresentation,
  ParagraphPresentation,
} from "../presentations.tsx";
import {
  normalizeFirstDraftHeadingLevel,
  type FirstDraftHeadingLevel,
} from "../../heading-level.ts";

type Props = FirstDraftBlockRendererProps;

export function ParagraphRenderer({ block, editor }: Props) {
  const afterTargetRef = useAfterBlockTargetRef(block.id);
  const hasAfterTarget = shouldRenderAfterBlockTarget(editor, block.id);
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.paragraph}
      />
      <ParagraphPresentation>
        <EditableTextBlockPrimitive
          block={block}
          editor={editor}
          placeholder={{ text: "Type something…", visibility: "active" }}
          rootAttributes={{ "aria-label": "Paragraph text" }}
        />
      </ParagraphPresentation>
      {hasAfterTarget ? <div
          ref={afterTargetRef}
          className="first-draft-block-drop-target"
          data-first-draft-block-drop-target-active="false"
          data-editor-ui="true"
          aria-hidden="true"
        /> : null}
    </>
  );
}

export function HeadingRenderer({ block, editor }: Props) {
  const level = normalizeFirstDraftHeadingLevel(block.metadata?.level);
  const afterTargetRef = useAfterBlockTargetRef(block.id);
  const hasAfterTarget = shouldRenderAfterBlockTarget(editor, block.id);
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.heading[level]}
      />
      <HeadingPresentation
        level={level}
        rootAttributes={editorSelectionBoundsDataAttributes(block.id, {
          target: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
        })}
      >
        <EditableTextBlockPrimitive
          block={block}
          editor={editor}
          placeholder={{ text: "Heading", visibility: "always" }}
          textDomPresentation={headingTextDomPresentation(level)}
          rootAttributes={{ "aria-label": `Heading level ${level}` }}
        />
      </HeadingPresentation>
      {hasAfterTarget ? <div
          ref={afterTargetRef}
          className="first-draft-block-drop-target"
          data-first-draft-block-drop-target-active="false"
          data-editor-ui="true"
          aria-hidden="true"
        /> : null}
    </>
  );
}

export function ListItemRenderer({ block, editor, children }: Props) {
  const ordered = block.type === "orderedListItem";
  const afterTargetRef = useAfterBlockTargetRef(block.id);
  const hasAfterTarget = shouldRenderAfterBlockTarget(editor, block.id);
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
        data-first-draft-hover-primary-owner={block.id}
      >
        <ListItemMarker
          blockId={block.id}
          parentId={block.parentId}
          ordered={ordered}
        />
        {children}
      </div>
      {hasAfterTarget ? <div
        ref={afterTargetRef}
        className="first-draft-block-drop-target"
        data-first-draft-block-drop-target-active="false"
        data-editor-ui="true"
        aria-hidden="true"
      /> : null}
    </>
  );
}

export function ListContainerRenderer({
  block,
  editor,
  children,
}: Props): ReactNode {
  const afterTargetRef = useAfterBlockTargetRef(block.id);
  const hasAfterTarget = shouldRenderAfterBlockTarget(editor, block.id);
  const sequence = block.type === "orderedList" ? (
    <OrderedListNumberingProvider containerId={block.id} editor={editor}>
      {children}
    </OrderedListNumberingProvider>
  ) : (
    children
  );
  return (
    <>
      {sequence}
      {hasAfterTarget ? <div
        ref={afterTargetRef}
        className="first-draft-block-drop-target"
        data-first-draft-block-drop-target-active="false"
        data-editor-ui="true"
        aria-hidden="true"
      /> : null}
    </>
  );
}

export function ChecklistContainerRenderer({ block, editor, children }: Props): ReactNode {
  const afterTargetRef = useAfterBlockTargetRef(block.id);
  const hasAfterTarget = shouldRenderAfterBlockTarget(editor, block.id);
  return (
    <>
      {children}
      {hasAfterTarget ? <div ref={afterTargetRef} className="first-draft-block-drop-target" data-first-draft-block-drop-target-active="false" data-editor-ui="true" aria-hidden="true" /> : null}
    </>
  );
}

export function QuoteRenderer({ block, editor, children }: Props) {
  const afterTargetRef = useAfterBlockTargetRef(block.id);
  const hasAfterTarget = shouldRenderAfterBlockTarget(editor, block.id);
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.quote}
      />
      <blockquote
        className="quote-block__quote"
        data-first-draft-hover-primary-owner={block.id}
        {...editorSelectionBoundsDataAttributes(block.id, {
          target: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
        })}
      >
        {children}
      </blockquote>
      {hasAfterTarget ? <div ref={afterTargetRef} className="first-draft-block-drop-target" data-first-draft-block-drop-target-active="false" data-editor-ui="true" aria-hidden="true" /> : null}
    </>
  );
}

export function CodeRenderer({ block, editor, children }: Props) {
  const afterTargetRef = useAfterBlockTargetRef(block.id);
  const hasAfterTarget = shouldRenderAfterBlockTarget(editor, block.id);
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.code}
      />
      <div
        className="code-block__presentation"
        data-first-draft-hover-primary-owner={block.id}
        {...editorSelectionBoundsDataAttributes(block.id, {
          target: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
        })}
      >
        {children}
      </div>
      {hasAfterTarget ? <div ref={afterTargetRef} className="first-draft-block-drop-target" data-first-draft-block-drop-target-active="false" data-editor-ui="true" aria-hidden="true" /> : null}
    </>
  );
}

export function ChecklistItemRenderer({ block, editor, children }: Props) {
  const afterTargetRef = useAfterBlockTargetRef(block.id);
  const hasAfterTarget = shouldRenderAfterBlockTarget(editor, block.id);
  const checked = isChecklistItemChecked(block);
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.checklist}
      />
      <div
        className="checklist-block__item"
        data-checked={checked ? "true" : "false"}
        data-first-draft-hover-primary-owner={block.id}
      >
        <ChecklistControl block={block} editor={editor} checked={checked} />
        {children}
      </div>
      {hasAfterTarget ? <div ref={afterTargetRef} className="first-draft-block-drop-target" data-first-draft-block-drop-target-active="false" data-editor-ui="true" aria-hidden="true" /> : null}
    </>
  );
}

export function CalloutRenderer({ block, editor, children }: Props) {
  const childStartTargetRef = useChildStartTargetRef(block.id);
  const afterTargetRef = useAfterBlockTargetRef(block.id);
  const hasChildStartTarget = shouldRenderChildStartTarget(editor, block.id);
  const hasAfterTarget = shouldRenderAfterBlockTarget(editor, block.id);
  return (
    <>
      <FirstDraftBlockChrome
        blockId={block.id}
        editor={editor}
        blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.callout}
      />
      {hasChildStartTarget ? <div
        ref={childStartTargetRef}
        className="first-draft-block-drop-target"
        data-first-draft-block-drop-target-active="false"
        data-editor-ui="true"
        aria-hidden="true"
      /> : null}
      <CalloutPresentation
        icon={<CalloutIconControl block={block} editor={editor} />}
        rootAttributes={{
          ...editorSelectionBoundsDataAttributes(block.id, {
            target: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
          }),
          role: "group",
          "aria-label": "Callout block",
          "data-callout-icon": resolveFirstDraftCalloutIcon(
            block.metadata?.icon,
          ).id,
          "data-first-draft-hover-primary-owner": block.id,
        }}
        bodyAttributes={{
          "data-first-draft-hover-primary-owner": block.id,
        }}
      >
        {children}
      </CalloutPresentation>
      {hasAfterTarget ? <div ref={afterTargetRef} className="first-draft-block-drop-target" data-first-draft-block-drop-target-active="false" data-editor-ui="true" aria-hidden="true" /> : null}
    </>
  );
}

function CalloutIconControl({ block, editor }: Pick<Props, "block" | "editor">) {
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const icon = resolveFirstDraftCalloutIcon(block.metadata?.icon);
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
    <div className="callout-block__icon-wrap" ref={pickerRef} data-callout-picker-open={open ? "true" : undefined}>
          <button
            type="button"
            className="callout-block__icon callout-block__icon-button"
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
              {FIRST_DRAFT_CALLOUT_ICONS.map((candidate) => (
                <button
                  type="button"
                  role="menuitem"
                  aria-label={candidate.label}
                  key={candidate.id}
                  onClick={() => {
                    editor.updateBlockMetadata(
                      [{ blockId: block.id, values: { icon: candidate.id } }],
                      { editorSuggestion: { selection: null } },
                    );
                    setOpen(false);
                  }}
                >
                  <span aria-hidden="true">{candidate.glyph}</span>
                </button>
              ))}
            </div>
          ) : null}
    </div>
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
  const prefix =
    variant === "heading" ? "toggle-heading-block" : "toggle-list-item-block";
  const afterTargetRef = useAfterBlockTargetRef(block.id);
  const hasAfterTarget = shouldRenderAfterBlockTarget(editor, block.id);
  return (
    <>
      {variant === "heading" ? (
        <ToggleHeadingBlockChrome blockId={block.id} editor={editor} />
      ) : (
        <FirstDraftBlockChrome
          blockId={block.id}
          editor={editor}
          blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.toggleList}
        />
      )}
      <div
        className={`${prefix}__toggle`}
        role="group"
        data-first-draft-hover-primary-owner={block.id}
        {...editorSelectionBoundsDataAttributes(block.id, {
          target: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
        })}
      >
        <ToggleDisclosureButton
          blockId={block.id}
          editor={editor}
          prefix={prefix}
        />
        {children}
        {hasAfterTarget ? <div
          ref={afterTargetRef}
          className="first-draft-block-drop-target"
          data-first-draft-block-drop-target-active="false"
          data-editor-ui="true"
          aria-hidden="true"
        /> : null}
      </div>
    </>
  );
}

function ToggleHeadingBlockChrome({
  blockId,
  editor,
}: {
  readonly blockId: BlockId;
  readonly editor: Props["editor"];
}) {
  const subscribeToChildren = useCallback(
    (listener: () => void) => editor.subscribeChildBlockIds(blockId, listener),
    [blockId, editor],
  );
  const readSummaryId = useCallback(
    () => editor.getChildBlockIds(blockId)[0] ?? null,
    [blockId, editor],
  );
  const summaryId = useSyncExternalStore(
    subscribeToChildren,
    readSummaryId,
    readSummaryId,
  );
  const subscribeToSummary = useCallback(
    (listener: () => void) =>
      summaryId === null
        ? () => undefined
        : editor.subscribeBlock(summaryId, listener),
    [editor, summaryId],
  );
  const readSummary = useCallback(
    () => (summaryId === null ? null : editor.getBlock(summaryId)),
    [editor, summaryId],
  );
  const summary = useSyncExternalStore(
    subscribeToSummary,
    readSummary,
    readSummary,
  );
  const level = normalizeFirstDraftHeadingLevel(summary?.metadata?.level);

  return (
    <FirstDraftBlockChrome
      blockId={blockId}
      editor={editor}
      blockStartOffset={FIRST_DRAFT_BLOCK_CONTROL_OFFSETS.toggleHeading[level]}
    />
  );
}

function ToggleDisclosureButton({
  blockId,
  editor,
  prefix,
}: {
  readonly blockId: BlockId;
  readonly editor: Props["editor"];
  readonly prefix: string;
}) {
  const [collapsed, toggle] = useCollapsed(blockId);
  return (
    <button
      type="button"
      className={`${prefix}__chevron`}
      aria-label={collapsed ? "Expand toggle" : "Collapse toggle"}
      aria-expanded={!collapsed}
      data-first-draft-toggle-expanded={String(!collapsed)}
      data-editor-ui="true"
      data-editor-preserve-selection="true"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        if (!collapsed) settleSelectionBeforeToggleCollapse(editor, blockId);
        toggle();
      }}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" data-expanded={String(!collapsed)}>
        <path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function settleSelectionBeforeToggleCollapse(
  editor: Props["editor"],
  toggleId: BlockId,
): void {
  const toggleChildren = editor.getChildBlockIds(toggleId);
  const summaryId = toggleChildren[0];
  const bodyId = toggleChildren[1];
  if (!summaryId || !bodyId) return;
  const selection = editor.selection.getSnapshot();
  if (selection.kind !== "document") return;
  const { normalizedStart, normalizedEnd } =
    selection.snapshot.documentSelection;
  if (!normalizedStart || !normalizedEnd) return;
  if (
    !isBlockWithin(editor, normalizedStart.blockId, bodyId) &&
    !isBlockWithin(editor, normalizedEnd.blockId, bodyId)
  ) {
    return;
  }
  editor.focusText(summaryId, { offset: 0, preventScroll: true });
}

function isBlockWithin(
  editor: Props["editor"],
  blockId: BlockId,
  ancestorId: BlockId,
): boolean {
  let current: BlockId | null = blockId;
  const visited = new Set<BlockId>();
  while (current !== null && !visited.has(current)) {
    if (current === ancestorId) return true;
    visited.add(current);
    current = editor.getParentId(current);
  }
  return false;
}

export function ToggleBodyRenderer({ block, editor, children }: Props) {
  const childStartTargetRef = useChildStartTargetRef(block.id);
  const afterTargetRef = useAfterBlockTargetRef(block.id);
  const hasChildTarget = shouldRenderChildStartTarget(editor, block.id);
  const hasAfterTarget = shouldRenderAfterBlockTarget(editor, block.id);
  return <>
    {hasChildTarget ? <div ref={childStartTargetRef} className="first-draft-block-drop-target" data-first-draft-block-drop-target-active="false" data-editor-ui="true" aria-hidden="true" /> : null}
    {children}
    <EmptyWrapperAddTextControl editor={editor} wrapperId={block.id} />
    {hasAfterTarget ? <div ref={afterTargetRef} className="first-draft-block-drop-target" data-first-draft-block-drop-target-active="false" data-editor-ui="true" aria-hidden="true" /> : null}
  </>;
}

export function DividerRenderer({ block, editor }: Props) {
  const atomicFocusRef = useEditorAtomicFocusTarget(editor, block.id);
  const afterTargetRef = useAfterBlockTargetRef(block.id);
  const hasAfterTarget = shouldRenderAfterBlockTarget(editor, block.id);
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
        {...editorSelectionBoundsDataAttributes(block.id, {
          target: FIRST_DRAFT_DOCUMENT_DRAG_VISUAL_BOUNDS_TARGET,
        })}
      />
      {hasAfterTarget ? <div ref={afterTargetRef} className="first-draft-block-drop-target" data-first-draft-block-drop-target-active="false" data-editor-ui="true" aria-hidden="true" /> : null}
    </>
  );
}

function ListItemMarker({ blockId, parentId, ordered }: { readonly blockId: BlockId; readonly parentId: BlockId | null; readonly ordered: boolean }) {
  const ordinal = useOrderedListItemOrdinal(blockId, parentId, ordered);
  return <span className="list-item-block__marker" aria-hidden="true">{ordinal === null ? null : `${ordinal}.`}</span>;
}

function ChecklistControl({ block, editor, checked }: Pick<Props, "block" | "editor"> & { readonly checked: boolean }) {
  return <input
    type="checkbox"
    disabled={!editor.editable}
    checked={checked}
    aria-label="Checklist item complete"
    onPointerDown={(event) => event.stopPropagation()}
    onMouseDown={(event) => event.stopPropagation()}
    onFocus={(event) => event.stopPropagation()}
    onClick={(event) => event.stopPropagation()}
    onChange={(event) => editor.updateBlockMetadata(
      [{ blockId: block.id, values: { checked: event.currentTarget.checked } }],
      { selectionEffect: { kind: "preserve" } },
    )}
  />;
}

function isChecklistItemChecked(block: Props["block"]): boolean {
  return block.metadata?.checked === true;
}

function headingTextDomPresentation(
  level: FirstDraftHeadingLevel,
): TextDomPresentation {
  return {
    element: `h${level}`,
    attributes: { "data-editor-heading-level": String(level) },
  };
}

function useAfterBlockTargetRef(blockId: BlockId) {
  return useFirstDraftBlockDropTargetRef({ kind: "after-block", blockId });
}

function useChildStartTargetRef(wrapperId: BlockId) {
  return useFirstDraftBlockDropTargetRef({ kind: "wrapper-child-start", wrapperId });
}

function shouldRenderAfterBlockTarget(editor: Props["editor"], blockId: BlockId): boolean {
  return isFirstDraftBlockDropAnchorEligible(editor, {
    kind: "after-block",
    blockId,
  });
}

function shouldRenderChildStartTarget(editor: Props["editor"], wrapperId: BlockId): boolean {
  return isFirstDraftBlockDropAnchorEligible(editor, {
    kind: "wrapper-child-start",
    wrapperId,
  });
}
