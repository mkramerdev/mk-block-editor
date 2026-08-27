"use client";

import { createContext, useCallback, useContext, useEffect, useRef } from "react";
import { useDroppable } from "@mk-drag-and-drop/react";
import type { BlockPlacement } from "@repo/editor-core/editing";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import { FirstDraftActiveDropTargetStoreContext } from "./active-drop-target-store.tsx";

export const EDITOR_BLOCK_DND_GROUP = "first-draft-editor-blocks";

export const FirstDraftRootDropTargetRefContext = createContext<
  (element: HTMLDivElement | null) => void
>(() => undefined);

export type FirstDraftBlockDropAnchor =
  | { readonly kind: "root-start" }
  | { readonly kind: "wrapper-child-start"; readonly wrapperId: BlockId }
  | { readonly kind: "after-block"; readonly blockId: BlockId };

export interface FirstDraftBlockPlacementReader {
  getBlock(blockId: BlockId): VersionedBlock | null;
  getRootBlockIds(): readonly BlockId[];
  getChildBlockIds(parentId: BlockId): readonly BlockId[];
}

export interface FirstDraftBlockPlacementRegistry {
  get(dropTargetId: string): BlockPlacement | null;
}

export function createFirstDraftBlockPlacementRegistry(
  editor: FirstDraftBlockPlacementReader,
): FirstDraftBlockPlacementRegistry {
  return Object.freeze({
    get(dropTargetId: string) {
      const anchor = parseFirstDraftBlockDropTargetId(dropTargetId);
      return anchor ? resolveFirstDraftBlockDropAnchor(editor, anchor) : null;
    },
  });
}

export function resolveFirstDraftBlockDropAnchor(
  editor: FirstDraftBlockPlacementReader,
  anchor: FirstDraftBlockDropAnchor,
): BlockPlacement | null {
  if (!isFirstDraftBlockDropAnchorEligible(editor, anchor)) return null;
  if (anchor.kind === "root-start") return { parentId: null, childIndex: 0 };
  if (anchor.kind === "wrapper-child-start") {
    return { parentId: anchor.wrapperId, childIndex: 0 };
  }
  const block = editor.getBlock(anchor.blockId);
  if (!block || block.tombstone) return null;
  const siblings =
    block.parentId === null
      ? editor.getRootBlockIds()
      : editor.getChildBlockIds(block.parentId);
  const childIndex = siblings.indexOf(block.id);
  return childIndex < 0
    ? null
    : { parentId: block.parentId, childIndex: childIndex + 1 };
}

/**
 * First Draft document-block DnD positions. Fixed product structures deliberately
 * expose no anchor even when their generic definition kind is a wrapper.
 */
export function isFirstDraftBlockDropAnchorEligible(
  editor: FirstDraftBlockPlacementReader,
  anchor: FirstDraftBlockDropAnchor,
): boolean {
  if (anchor.kind === "root-start") return true;
  if (anchor.kind === "wrapper-child-start") {
    const wrapper = liveBlock(editor, anchor.wrapperId);
    if (!wrapper) return false;
    switch (wrapper.type) {
      case "callout":
        return hasCanonicalParentMembership(editor, wrapper);
      case "toggleHeadingBody":
        return isCanonicalToggleBody(editor, wrapper, "toggleHeading", "heading");
      case "toggleListItemBody":
        return isCanonicalToggleBody(editor, wrapper, "toggleListItem", "paragraph");
      case "column":
        return hasParentType(editor, wrapper, "columns");
      case "tabPane":
        return hasParentType(editor, wrapper, "tabs");
      default:
        return false;
    }
  }
  const block = liveBlock(editor, anchor.blockId);
  if (!block) return false;
  const siblings = siblingIds(editor, block);
  const index = siblings.indexOf(block.id);
  if (index < 0) return false;
  if (block.parentId === null) return true;
  const parent = liveBlock(editor, block.parentId);
  if (!parent) return false;
  switch (parent.type) {
    case "callout":
    case "toggleHeadingBody":
    case "toggleListItemBody":
    case "column":
    case "tabPane":
      return isFirstDraftBlockDropAnchorEligible(editor, {
        kind: "wrapper-child-start",
        wrapperId: parent.id,
      });
    case "bulletListItem":
    case "orderedListItem":
    case "checklistItem":
      return index >= 0 && isCanonicalListItem(editor, parent);
    default:
      return false;
  }
}

function liveBlock(
  editor: FirstDraftBlockPlacementReader,
  blockId: BlockId,
): VersionedBlock | null {
  const block = editor.getBlock(blockId);
  return block && !block.tombstone ? block : null;
}

function siblingIds(
  editor: FirstDraftBlockPlacementReader,
  block: VersionedBlock,
): readonly BlockId[] {
  return block.parentId === null
    ? editor.getRootBlockIds()
    : editor.getChildBlockIds(block.parentId);
}

function hasCanonicalParentMembership(
  editor: FirstDraftBlockPlacementReader,
  block: VersionedBlock,
): boolean {
  return siblingIds(editor, block).includes(block.id);
}

function hasParentType(
  editor: FirstDraftBlockPlacementReader,
  block: VersionedBlock,
  parentType: string,
): boolean {
  if (block.parentId === null || !hasCanonicalParentMembership(editor, block)) {
    return false;
  }
  return liveBlock(editor, block.parentId)?.type === parentType;
}

function isCanonicalToggleBody(
  editor: FirstDraftBlockPlacementReader,
  body: VersionedBlock,
  wrapperType: "toggleHeading" | "toggleListItem",
  primaryType: "heading" | "paragraph",
): boolean {
  if (body.parentId === null) return false;
  const wrapper = liveBlock(editor, body.parentId);
  if (!wrapper || wrapper.type !== wrapperType) return false;
  const children = editor.getChildBlockIds(wrapper.id);
  if (children.length !== 2 || children[1] !== body.id) return false;
  return liveBlock(editor, children[0]!)?.type === primaryType;
}

function isCanonicalListItem(
  editor: FirstDraftBlockPlacementReader,
  item: VersionedBlock,
): boolean {
  if (item.parentId === null) return false;
  const container = liveBlock(editor, item.parentId);
  const expectedContainer =
    item.type === "bulletListItem"
      ? "bulletList"
      : item.type === "orderedListItem"
        ? "orderedList"
        : "checklist";
  if (!container || container.type !== expectedContainer) return false;
  const children = editor.getChildBlockIds(item.id);
  return children.length > 0 && liveBlock(editor, children[0]!)?.type === "paragraph";
}

export function createFirstDraftBlockDropTargetId(
  anchor: FirstDraftBlockDropAnchor,
): string {
  switch (anchor.kind) {
    case "root-start":
      return "first-draft-block-anchor:root-start";
    case "wrapper-child-start":
      return `first-draft-block-anchor:child-start:${anchor.wrapperId}`;
    case "after-block":
      return `first-draft-block-anchor:after:${anchor.blockId}`;
  }
}

export function parseFirstDraftBlockDropTargetId(
  value: string,
): FirstDraftBlockDropAnchor | null {
  if (value === "first-draft-block-anchor:root-start") {
    return { kind: "root-start" };
  }
  const childPrefix = "first-draft-block-anchor:child-start:";
  if (value.startsWith(childPrefix) && value.length > childPrefix.length) {
    return {
      kind: "wrapper-child-start",
      wrapperId: value.slice(childPrefix.length) as BlockId,
    };
  }
  const afterPrefix = "first-draft-block-anchor:after:";
  if (value.startsWith(afterPrefix) && value.length > afterPrefix.length) {
    return {
      kind: "after-block",
      blockId: value.slice(afterPrefix.length) as BlockId,
    };
  }
  return null;
}

export function useFirstDraftBlockDropTargetRef(
  anchor: FirstDraftBlockDropAnchor,
): (element: HTMLDivElement | null) => void {
  const dropTargetId = createFirstDraftBlockDropTargetId(anchor);
  const droppable = useDroppable<HTMLDivElement>({
    dropTargetId,
    group: EDITOR_BLOCK_DND_GROUP,
  });
  const store = useContext(FirstDraftActiveDropTargetStoreContext);
  const elementRef = useRef<HTMLDivElement | null>(null);
  const update = useCallback(() => {
    elementRef.current?.setAttribute(
      "data-first-draft-block-drop-target-active",
      store.getActiveDropTargetId() === dropTargetId ? "true" : "false",
    );
  }, [dropTargetId, store]);
  useEffect(() => store.subscribe(dropTargetId, update), [dropTargetId, store, update]);
  return useCallback(
    (element: HTMLDivElement | null) => {
      elementRef.current = element;
      droppable.ref(element);
      update();
    },
    [droppable, update],
  );
}
