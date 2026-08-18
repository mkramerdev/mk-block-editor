import {
  extractPlainTextFromRichTextDocument,
  richTextBlockInlineContent,
  richTextDocumentContentSize,
  sliceRichTextDocument,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content/rich-text";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  EditorLocalMutationProvenance,
  EditorLocalTypingProvenance,
} from "@repo/editor-react/editor";
import type { CompiledEditorTypingTriggers } from "../definition/typing-triggers.ts";
import type {
  EditorTypingTriggerSession,
  EditorTypingTriggerSessionId,
  EditorTypingTriggerSessionReference,
} from "../document/contracts.ts";

export interface EditorTypingTriggerSelection {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly offset: number;
  readonly selectionRevision: number;
}

export interface EditorTypingTriggerSessionReader {
  getBlock(blockId: BlockId): VersionedBlock | null;
  readBlockContent(
    blockId: BlockId,
    blockType: BlockType,
  ): RichTextDocumentNodeJson | null;
  readCollapsedDocumentSelection(): EditorTypingTriggerSelection | null;
}

interface PendingAcceptance {
  readonly acceptanceToken: number;
  readonly sessionId: EditorTypingTriggerSessionId;
  readonly revision: number;
  consumed: boolean;
}

/**
 * Runtime-owned transient state for one editor. It observes finalized
 * canonical state but never commits content, records history, or renders UI.
 */
export class EditorTypingTriggerSessionController {
  private active: EditorTypingTriggerSession | null = null;
  private readonly listeners = new Set<() => void>();
  private nextAcceptanceToken = 1;
  private nextSessionId = 1;
  private pendingAcceptance: PendingAcceptance | null = null;
  private selectionReconciliationQueued = false;
  private disposed = false;

  constructor(
    private readonly triggers: CompiledEditorTypingTriggers,
    private readonly reader: EditorTypingTriggerSessionReader,
  ) {}

  getSnapshot = (): EditorTypingTriggerSession | null => this.active;

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  };

  beginAcceptance(
    reference: EditorTypingTriggerSessionReference,
  ): number | null {
    if (!this.isCurrentReference(reference) || !this.reconcileActive(true)) {
      return null;
    }
    const acceptanceToken = this.nextAcceptanceToken++;
    this.pendingAcceptance = {
      acceptanceToken,
      sessionId: reference.sessionId,
      revision: reference.revision,
      consumed: false,
    };
    return acceptanceToken;
  }

  releaseAcceptance(token: number | null): void {
    if (token !== null && this.pendingAcceptance?.acceptanceToken === token) {
      this.pendingAcceptance = null;
    }
  }

  /**
   * Runs after canonical content and selection have settled, before public
   * transaction observers are notified.
   */
  reconcileFinalizedLocalMutation(
    provenance: EditorLocalMutationProvenance | null,
  ): void {
    if (this.disposed) return;
    const acceptance = this.pendingAcceptance;
    if (acceptance && !acceptance.consumed) {
      acceptance.consumed = true;
      if (
        this.active?.id === acceptance.sessionId &&
        this.active.revision === acceptance.revision
      ) {
        this.close();
      }
      return;
    }

    if (provenance?.kind === "typing") {
      if (this.active) {
        this.reconcileActive(true);
      } else {
        this.openFromTypingEdge(provenance);
      }
      return;
    }
    this.reconcileActive(true);
  }

  reconcileFinalizedHistoryMutation(): void {
    this.close();
  }

  reconcileRemoteMutation(affectedBlockIds?: readonly BlockId[]): void {
    if (
      !this.active ||
      (affectedBlockIds && !affectedBlockIds.includes(this.active.blockId))
    ) {
      return;
    }
    this.close();
  }

  scheduleSelectionReconciliation(): void {
    if (this.disposed || this.selectionReconciliationQueued || !this.active) {
      return;
    }
    this.selectionReconciliationQueued = true;
    queueMicrotask(() => {
      this.selectionReconciliationQueued = false;
      if (!this.disposed) this.reconcileActive(false);
    });
  }

  dismiss(reference: EditorTypingTriggerSessionReference): boolean {
    if (!this.isCurrentReference(reference)) return false;
    this.close();
    return true;
  }

  isCurrentReference(reference: EditorTypingTriggerSessionReference): boolean {
    return Boolean(
      this.active &&
        reference &&
        reference.sessionId === this.active.id &&
        Number.isSafeInteger(reference.revision) &&
        reference.revision === this.active.revision,
    );
  }

  readCurrentSession(
    reference: EditorTypingTriggerSessionReference,
  ): EditorTypingTriggerSession | null {
    return this.isCurrentReference(reference) && this.reconcileActive(true)
      ? this.active
      : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingAcceptance = null;
    this.active = null;
    this.listeners.clear();
  }

  private openFromTypingEdge(input: EditorLocalTypingProvenance): void {
    if (input.text.length === 0) return;
    const selection = input.finalSelection
      ? {
          ...input.finalSelection,
          selectionRevision: 0,
        }
      : this.reader.readCollapsedDocumentSelection();
    if (!selection) return;
    const potentiallyCompletesTrigger = this.triggers.definitions.some(
      ({ trigger }) =>
        trigger.length <= selection.offset &&
        (input.text.includes(trigger) || trigger.endsWith(input.text)),
    );
    if (!potentiallyCompletesTrigger) return;
    const block = this.reader.getBlock(selection.blockId);
    if (!block || block.tombstone || block.type !== selection.blockType) {
      return;
    }
    const content = this.reader.readBlockContent(block.id, block.type);
    if (!content) return;
    const contentSize = richTextDocumentContentSize(content);
    if (selection.offset > contentSize || input.text.length > selection.offset)
      return;
    const insertedFrom = selection.offset - input.text.length;
    const candidates: {
      readonly definition: CompiledEditorTypingTriggers["definitions"][number];
      readonly from: number;
      readonly triggerEnd: number;
      readonly query: string;
    }[] = [];

    for (const definition of this.triggers.definitions) {
      const earliestEnd = Math.max(definition.trigger.length, insertedFrom + 1);
      for (
        let triggerEnd = selection.offset;
        triggerEnd >= earliestEnd;
        triggerEnd -= 1
      ) {
        const from = triggerEnd - definition.trigger.length;
        if (from < 0 || triggerEnd <= insertedFrom) continue;
        if (
          readPlainTextRange(content, block.type, from, triggerEnd) !==
            definition.trigger ||
          !isTriggerBoundary(content, block.type, from)
        ) {
          continue;
        }
        const query = readSupportedQuery(
          content,
          block.type,
          triggerEnd,
          selection.offset,
        );
        if (query === null) continue;
        candidates.push({ definition, from, triggerEnd, query });
        break;
      }
    }
    candidates.sort(
      (left, right) =>
        right.definition.trigger.length - left.definition.trigger.length ||
        right.from - left.from ||
        left.definition.id.localeCompare(right.definition.id),
    );
    const match = candidates[0];
    if (!match) return;
    const activationContext = Object.freeze({
      blockId: block.id,
      blockType: block.type,
      trigger: match.definition.trigger,
      triggerRange: Object.freeze({
        from: match.from,
        to: match.triggerEnd,
      }),
      textBeforeTrigger: extractPlainTextFromRichTextDocument(
        sliceRichTextDocument(block.type, content, 0, match.from),
      ),
    });
    try {
      if (match.definition.isAllowed) {
        const allowed = match.definition.isAllowed(activationContext);
        if (typeof allowed !== "boolean" || !allowed) return;
      }
    } catch {
      return;
    }
    const sessionId =
      `typing-trigger-${this.nextSessionId++}` as EditorTypingTriggerSessionId;
    this.publish(
      freezeSession({
        id: sessionId,
        triggerId: match.definition.id,
        trigger: match.definition.trigger,
        blockId: block.id,
        blockType: block.type,
        range: { from: match.from, to: selection.offset },
        query: match.query,
        revision: 1,
        selection: { blockId: block.id, offset: selection.offset },
      }),
    );
  }

  private reconcileActive(allowEndpointChange: boolean): boolean {
    const current = this.active;
    if (!current) return false;
    const selection = this.reader.readCollapsedDocumentSelection();
    const block = this.reader.getBlock(current.blockId);
    if (
      !selection ||
      selection.blockId !== current.blockId ||
      selection.blockType !== current.blockType ||
      (!allowEndpointChange && selection.offset !== current.range.to) ||
      selection.offset < current.range.from + current.trigger.length ||
      !block ||
      block.tombstone ||
      block.type !== current.blockType
    ) {
      this.close();
      return false;
    }
    const content = this.reader.readBlockContent(block.id, block.type);
    if (
      !content ||
      readPlainTextRange(
        content,
        block.type,
        current.range.from,
        current.range.from + current.trigger.length,
      ) !== current.trigger
    ) {
      this.close();
      return false;
    }
    const query = readSupportedQuery(
      content,
      block.type,
      current.range.from + current.trigger.length,
      selection.offset,
    );
    if (query === null) {
      this.close();
      return false;
    }
    if (
      query === current.query &&
      selection.offset === current.range.to &&
      selection.offset === current.selection.offset
    ) {
      return true;
    }
    this.publish(
      freezeSession({
        ...current,
        range: { from: current.range.from, to: selection.offset },
        query,
        revision: current.revision + 1,
        selection: { blockId: block.id, offset: selection.offset },
      }),
    );
    return true;
  }

  private close(): void {
    if (!this.active) return;
    this.active = null;
    this.notify();
  }

  private publish(session: EditorTypingTriggerSession): void {
    this.active = session;
    this.notify();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // A session observer cannot interrupt canonical editor finalization.
      }
    }
  }
}

function freezeSession(
  session: EditorTypingTriggerSession,
): EditorTypingTriggerSession {
  return Object.freeze({
    ...session,
    range: Object.freeze({ ...session.range }),
    selection: Object.freeze({ ...session.selection }),
  });
}

function readPlainTextRange(
  content: RichTextDocumentNodeJson,
  blockType: BlockType,
  from: number,
  to: number,
): string | null {
  if (from < 0 || to < from || to > richTextDocumentContentSize(content))
    return null;
  const nodes = richTextBlockInlineContent(
    sliceRichTextDocument(blockType, content, from, to),
  );
  if (nodes.some((node) => node.type !== "text")) return null;
  return nodes
    .map((node) =>
      "text" in node && typeof node.text === "string" ? node.text : "",
    )
    .join("");
}

function readSupportedQuery(
  content: RichTextDocumentNodeJson,
  blockType: BlockType,
  from: number,
  to: number,
): string | null {
  return readPlainTextRange(content, blockType, from, to);
}

function isTriggerBoundary(
  content: RichTextDocumentNodeJson,
  blockType: BlockType,
  triggerFrom: number,
): boolean {
  if (triggerFrom === 0) return true;
  const previous = richTextBlockInlineContent(
    sliceRichTextDocument(blockType, content, triggerFrom - 1, triggerFrom),
  );
  const node = previous[0];
  return Boolean(
    node &&
      ((node.type === "text" &&
        "text" in node &&
        typeof node.text === "string" &&
        /\s/u.test(node.text)) ||
        node.type === "hard_break"),
  );
}
