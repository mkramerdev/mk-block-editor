import { createBlockId, type BlockId } from "@repo/editor-core/kernel";
import type { FirstDraftEditor } from "../../first-draft-editor-contracts.ts";

export interface FirstDraftTabsTarget {
  readonly tabsId: BlockId;
  readonly paneId: BlockId;
  readonly paneIds: readonly BlockId[];
  readonly paneIndex: number;
  readonly canonicalTitle: string | null;
  readonly displayedTitle: string;
}

export type FirstDraftTabsMutationResult =
  | { readonly kind: "applied"; readonly paneId: BlockId }
  | { readonly kind: "disabled"; readonly reason: string }
  | { readonly kind: "stale"; readonly reason: string }
  | { readonly kind: "rejected"; readonly reason: string };

export function resolveFirstDraftTabsTarget(
  editor: FirstDraftEditor,
  tabsId: BlockId,
  paneId: BlockId,
): FirstDraftTabsTarget | null {
  const tabs = editor.getBlock(tabsId);
  const pane = editor.getBlock(paneId);
  if (
    !tabs ||
    tabs.tombstone ||
    tabs.type !== "tabs" ||
    !pane ||
    pane.tombstone ||
    pane.type !== "tabPane" ||
    pane.parentId !== tabsId
  ) {
    return null;
  }
  const paneIds = editor.getChildBlockIds(tabsId).filter((candidateId) => {
    const candidate = editor.getBlock(candidateId);
    return (
      candidate !== null &&
      !candidate.tombstone &&
      candidate.type === "tabPane" &&
      candidate.parentId === tabsId
    );
  });
  const paneIndex = paneIds.indexOf(paneId);
  if (paneIndex < 0) return null;
  const canonicalTitle =
    typeof pane.metadata?.title === "string" ? pane.metadata.title : null;
  return {
    tabsId,
    paneId,
    paneIds,
    paneIndex,
    canonicalTitle,
    displayedTitle: canonicalTitle || `Tab ${paneIndex + 1}`,
  };
}

export function readFirstDraftTabActionAvailability(
  editor: FirstDraftEditor,
  tabsId: BlockId,
  paneId: BlockId,
): { readonly rename: boolean; readonly delete: boolean } | null {
  const target = resolveFirstDraftTabsTarget(editor, tabsId, paneId);
  return target ? { rename: true, delete: target.paneIds.length > 1 } : null;
}

export function chooseFirstDraftTabTitle(
  editor: FirstDraftEditor,
  paneIds: readonly BlockId[],
): string {
  const used = new Set(
    paneIds.flatMap((paneId) => {
      const title = editor.getBlock(paneId)?.metadata?.title;
      return typeof title === "string" ? [title] : [];
    }),
  );
  for (let index = 1; ; index += 1) {
    const title = `Tab ${index}`;
    if (!used.has(title)) return title;
  }
}

export function addFirstDraftTab(
  editor: FirstDraftEditor,
  tabsId: BlockId,
  createTabId: () => BlockId = createBlockId,
): FirstDraftTabsMutationResult {
  const tabs = editor.getBlock(tabsId);
  if (!tabs || tabs.tombstone || tabs.type !== "tabs") {
    return { kind: "stale", reason: "The tabs block is no longer available." };
  }
  const before = editor.getChildBlockIds(tabsId).filter((paneId) => {
    const pane = editor.getBlock(paneId);
    return (
      pane !== null &&
      !pane.tombstone &&
      pane.type === "tabPane" &&
      pane.parentId === tabsId
    );
  });
  const lastPaneId = before.at(-1);
  if (!lastPaneId) {
    return { kind: "stale", reason: "No valid tab pane remains." };
  }
  const usedTabIds = new Set(
    before.flatMap((paneId) => {
      const tabId = editor.getBlock(paneId)?.metadata?.tabId;
      return typeof tabId === "string" ? [tabId] : [];
    }),
  );
  let tabId = createTabId();
  for (let attempt = 0; usedTabIds.has(tabId) && attempt < 32; attempt += 1) {
    tabId = createTabId();
  }
  if (usedTabIds.has(tabId)) {
    return {
      kind: "rejected",
      reason: "A unique tab identity could not be created.",
    };
  }
  const result = editor.insertBlock({
    blockId: lastPaneId,
    blockType: "tabPane",
    metadata: { tabId, title: chooseFirstDraftTabTitle(editor, before) },
    selection: { kind: "clear" },
  });
  if (!result.ok) {
    return {
      kind: result.reason === "stale-plan" ? "stale" : "rejected",
      reason: result.message ?? "The tab could not be added.",
    };
  }
  const prior = new Set(before);
  const created = editor.getChildBlockIds(tabsId).filter((paneId) => {
    if (prior.has(paneId)) return false;
    const pane = editor.getBlock(paneId);
    return (
      pane !== null &&
      !pane.tombstone &&
      pane.type === "tabPane" &&
      pane.parentId === tabsId
    );
  });
  return created.length === 1
    ? { kind: "applied", paneId: created[0]! }
    : { kind: "rejected", reason: "The created tab could not be resolved." };
}

export function renameFirstDraftTab(
  editor: FirstDraftEditor,
  input: {
    readonly tabsId: BlockId;
    readonly paneId: BlockId;
    readonly initialCanonicalTitle: string | null;
    readonly initialDisplayedTitle: string;
    readonly nextTitle: string;
  },
): FirstDraftTabsMutationResult {
  const target = resolveFirstDraftTabsTarget(
    editor,
    input.tabsId,
    input.paneId,
  );
  if (!target || target.canonicalTitle !== input.initialCanonicalTitle) {
    return {
      kind: "stale",
      reason: "The tab title changed before the edit was saved.",
    };
  }
  const title = input.nextTitle.trim();
  if (
    title === target.canonicalTitle ||
    title === input.initialDisplayedTitle.trim()
  ) {
    return { kind: "disabled", reason: "The tab title is unchanged." };
  }
  const accepted = editor.updateBlockMetadata(
    [{ blockId: input.paneId, values: { title } }],
    { selectionEffect: { kind: "preserve" } },
  );
  return accepted
    ? { kind: "applied", paneId: input.paneId }
    : { kind: "rejected", reason: "The tab title could not be saved." };
}

export function deleteFirstDraftTab(
  editor: FirstDraftEditor,
  tabsId: BlockId,
  paneId: BlockId,
): FirstDraftTabsMutationResult {
  const target = resolveFirstDraftTabsTarget(editor, tabsId, paneId);
  if (!target) {
    return { kind: "stale", reason: "The tab is no longer available." };
  }
  if (target.paneIds.length <= 1) {
    return { kind: "disabled", reason: "The last tab cannot be deleted." };
  }
  const remainingPaneId =
    target.paneIds[target.paneIndex + 1] ??
    target.paneIds[target.paneIndex - 1];
  if (!remainingPaneId) {
    return { kind: "disabled", reason: "The last tab cannot be deleted." };
  }
  const result = editor.deleteBlock({ blockId: paneId });
  if (!result.ok) {
    return {
      kind: result.reason === "stale-plan" ? "stale" : "rejected",
      reason: result.message ?? "The tab could not be deleted.",
    };
  }
  return { kind: "applied", paneId: remainingPaneId };
}
