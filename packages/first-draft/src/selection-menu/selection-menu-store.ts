import type { BlockId } from "@repo/editor-core/kernel";
import { inlineMarkValuesEqual } from "@repo/editor-core/content/marks";
import type {
  CommittedSelectionSnapshot,
  EditorSelectionInlineMarkFormatRange,
  EditorSelectionInlineMarkFormatName,
  EditorSelectionTextAnchor,
  SelectionInlineMarkFormatStates,
} from "@repo/editor-react/selection";
import type { EditableEditor } from "@repo/editor-web/editor";
import type { FirstDraftSelectionLinkDraft } from "./first-draft-selection-link-form.tsx";

export const firstDraftSelectionMenuMarks = Object.freeze([
  "strong",
  "em",
  "underline",
  "strikethrough",
  "code",
  "link",
] satisfies readonly EditorSelectionInlineMarkFormatName[]);

export interface FirstDraftSelectionMenuSnapshot {
  readonly selection: CommittedSelectionSnapshot | null;
  readonly states: SelectionInlineMarkFormatStates;
  readonly blockIds: readonly BlockId[];
  readonly applicable: boolean;
  readonly linkSession: FirstDraftSelectionMenuLinkSession | null;
}

export interface FirstDraftSelectionMenuLinkSession {
  readonly selection: CommittedSelectionSnapshot;
  readonly states: SelectionInlineMarkFormatStates;
  readonly draft: FirstDraftSelectionLinkDraft;
  readonly canRemove: boolean;
}

const emptySnapshot: FirstDraftSelectionMenuSnapshot = Object.freeze({
  selection: null,
  states: Object.freeze({}),
  blockIds: Object.freeze([]),
  applicable: false,
  linkSession: null,
});

export interface FirstDraftSelectionMenuStore {
  getSnapshot(): FirstDraftSelectionMenuSnapshot;
  subscribe(listener: () => void): () => void;
  openLinkSession(session: FirstDraftSelectionMenuLinkSession): void;
  closeLinkSession(): void;
}

export function createFirstDraftSelectionMenuStore(
  editor: Pick<
    EditableEditor,
    | "editable"
    | "selection"
    | "readCurrentSelectionInlineMarkFormatStates"
    | "subscribeBlock"
  >,
): FirstDraftSelectionMenuStore {
  const listeners = new Set<() => void>();
  const blockReleases = new Map<BlockId, () => void>();
  let snapshot = emptySnapshot;
  let releaseSelection: (() => void) | null = null;

  const publish = (next: FirstDraftSelectionMenuSnapshot): void => {
    if (sameSelectionMenuSnapshot(snapshot, next)) return;
    snapshot = next;
    for (const listener of [...listeners]) listener();
  };

  const syncBlockSubscriptions = (blockIds: readonly BlockId[]): void => {
    const retained = new Set(blockIds);
    for (const [blockId, release] of blockReleases) {
      if (retained.has(blockId)) continue;
      release();
      blockReleases.delete(blockId);
    }
    for (const blockId of blockIds) {
      if (blockReleases.has(blockId)) continue;
      blockReleases.set(blockId, editor.subscribeBlock(blockId, recompute));
    }
  };

  function recompute(): void {
    const canonical = editor.selection.getSnapshot();
    if (!editor.editable || canonical.kind !== "document") {
      syncBlockSubscriptions([]);
      publish(emptySnapshot);
      return;
    }
    const result = editor.readCurrentSelectionInlineMarkFormatStates({
      marks: firstDraftSelectionMenuMarks,
    });
    if (!result.ok) {
      syncBlockSubscriptions([]);
      publish(
        Object.freeze({
          selection: canonical.snapshot,
          states: Object.freeze({}),
          blockIds: Object.freeze([]),
          applicable: false,
          linkSession: retainLinkSession(
            snapshot.linkSession,
            canonical.snapshot,
          ),
        }),
      );
      return;
    }
    syncBlockSubscriptions(result.blockIds);
    const applicable =
      result.blockIds.length > 0 &&
      firstDraftSelectionMenuMarks.some(
        (markName) => result.states[markName]?.canExecute === true,
      );
    publish(
      Object.freeze({
        selection: canonical.snapshot,
        states: result.states,
        blockIds: result.blockIds,
        applicable,
        linkSession: retainLinkSession(
          snapshot.linkSession,
          canonical.snapshot,
        ),
      }),
    );
  }

  const stop = (): void => {
    releaseSelection?.();
    releaseSelection = null;
    for (const release of blockReleases.values()) release();
    blockReleases.clear();
    snapshot = emptySnapshot;
  };

  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!releaseSelection) {
        releaseSelection = editor.selection.subscribe(recompute);
        recompute();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stop();
      };
    },
    openLinkSession(session: FirstDraftSelectionMenuLinkSession) {
      if (!sameSelectionAuthority(session.selection, snapshot.selection)) {
        return;
      }
      publish(
        Object.freeze({ ...snapshot, linkSession: Object.freeze(session) }),
      );
    },
    closeLinkSession() {
      if (!snapshot.linkSession) return;
      publish(Object.freeze({ ...snapshot, linkSession: null }));
    },
  });
}

function sameSelectionMenuSnapshot(
  left: FirstDraftSelectionMenuSnapshot,
  right: FirstDraftSelectionMenuSnapshot,
): boolean {
  if (
    !sameSelectionAuthority(left.selection, right.selection) ||
    left.linkSession !== right.linkSession ||
    left.applicable !== right.applicable ||
    left.blockIds.length !== right.blockIds.length ||
    left.blockIds.some((blockId, index) => right.blockIds[index] !== blockId)
  ) {
    return false;
  }
  return firstDraftSelectionMenuMarks.every((markName) => {
    const a = left.states[markName];
    const b = right.states[markName];
    if (a === b) return true;
    if (!a || !b) return false;
    return (
      a.active === b.active &&
      a.mixed === b.mixed &&
      a.canExecute === b.canExecute &&
      a.action === b.action &&
      a.reason === b.reason &&
      inlineMarkValuesEqual(a.value, b.value) &&
      sameFormatRanges(a.ranges, b.ranges)
    );
  });
}

function retainLinkSession(
  session: FirstDraftSelectionMenuLinkSession | null,
  selection: CommittedSelectionSnapshot,
): FirstDraftSelectionMenuLinkSession | null {
  return session && sameSelectionAuthority(session.selection, selection)
    ? session
    : null;
}

function sameSelectionAuthority(
  left: CommittedSelectionSnapshot | null,
  right: CommittedSelectionSnapshot | null,
): boolean {
  if (!left || !right) return left === right;
  if (left.revision !== right.revision || left.owner.kind !== right.owner.kind)
    return false;
  if (left.owner.kind === "document" || right.owner.kind === "document")
    return true;
  return (
    left.owner.blockId === right.owner.blockId &&
    left.owner.subsystem.id === right.owner.subsystem.id
  );
}

function sameFormatRanges(
  left: readonly EditorSelectionInlineMarkFormatRange[],
  right: readonly EditorSelectionInlineMarkFormatRange[],
): boolean {
  return (
    left.length === right.length &&
    left.every((range, index) => sameFormatRange(range, right[index]))
  );
}

function sameFormatRange(
  left: EditorSelectionInlineMarkFormatRange,
  right: EditorSelectionInlineMarkFormatRange | undefined,
): boolean {
  return Boolean(
    right &&
    left.blockId === right.blockId &&
    left.blockType === right.blockType &&
    left.from === right.from &&
    left.to === right.to &&
    left.coverage === right.coverage &&
    left.hasMark === right.hasMark &&
    left.hasUnmarkedText === right.hasUnmarkedText &&
    inlineMarkValuesEqual(left.value, right.value) &&
    sameTextAnchor(left.startTextAnchor, right.startTextAnchor) &&
    sameTextAnchor(left.endTextAnchor, right.endTextAnchor),
  );
}

function sameTextAnchor(
  left: EditorSelectionTextAnchor | undefined,
  right: EditorSelectionTextAnchor | undefined,
): boolean {
  return (
    left === right ||
    Boolean(
      left &&
      right &&
      left.kind === right.kind &&
      left.codec === right.codec &&
      left.version === right.version &&
      left.payload.encoded === right.payload.encoded &&
      (left.payload.assoc ?? 0) === (right.payload.assoc ?? 0),
    )
  );
}
