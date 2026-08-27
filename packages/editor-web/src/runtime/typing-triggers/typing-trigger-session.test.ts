import type { BlockId } from "@repo/editor-core/kernel";
import {
  createCanonicalBlockFragment,
  materializeCanonicalBlockCreation,
  type CanonicalBlockFragment,
} from "@repo/editor-core/editing";
import { createBlockRichTextContentFromPlainText } from "@repo/editor-core/content/rich-text";
import { createEditorLogicalSelectionPoint } from "@repo/editor-react/selection";
import { describe, expect, it, vi } from "vitest";
import type { EditableEditorDefinition } from "../definition/contracts.ts";
import type {
  EditorChangeCallback,
  EditorSemanticChange,
} from "../document/contracts.ts";
import type { EditableEditorRuntimePort } from "../document/render-port.ts";
import { createTestEditorSnapshot } from "../../tests/editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import { initializeTestEditableEditor } from "../../tests/test-editor-initializers.ts";
import { createWebSelectionTextAnchorAtOffset } from "../../document/selection/anchors/text-anchor.ts";

describe("typing trigger sessions", () => {
  it("activates at text start, ASCII space, and hard break but not after an ordinary character", () => {
    const trigger = {
      id: "slash",
      trigger: "/",
      isAllowed: (context: { readonly textBeforeTrigger: string }) => {
        const preceding = Array.from(context.textBeforeTrigger).at(-1);
        return (
          preceding === undefined || preceding === " " || preceding === "\n"
        );
      },
    };
    const cases = [
      { id: "trigger-start", text: "", offset: 0, active: true },
      { id: "trigger-space", text: "x ", offset: 2, active: true },
      { id: "trigger-character", text: "x", offset: 1, active: false },
    ] as const;
    for (const input of cases) {
      const id = input.id as BlockId;
      const editor = createEditor(id, input.text, [trigger]);
      settleCaret(editor, id, input.offset);
      expect(typeAtCommittedSelection(editor, "/")).toBe(true);
      expect(editor.getTypingTriggerSession() !== null).toBe(input.active);
      editor.dispose();
    }

    const hardBreakId = "trigger-hard-break" as BlockId;
    const hardBreakEditor = initializeTestEditableEditor({
      definition: {
        ...testEditableEditorDefinition,
        typingTriggers: [trigger],
      },
      snapshot: createTestEditorSnapshot([
        {
          id: hardBreakId,
          type: "textBlock",
          content: {
            type: "doc",
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: "x" }, { type: "hard_break" }],
              },
            ],
          },
        },
      ]),
    }) as EditableEditorRuntimePort;
    settleCaret(hardBreakEditor, hardBreakId, 2);
    expect(typeAtCommittedSelection(hardBreakEditor, "/")).toBe(true);
    expect(hardBreakEditor.getTypingTriggerSession()).toMatchObject({
      triggerId: "slash",
      range: { from: 2, to: 3 },
    });
    hardBreakEditor.dispose();
  });

  it("does not activate when no trigger is configured", () => {
    const blockId = "typing-trigger-none" as BlockId;
    const editor = createEditor(blockId, "", []);
    settleCaret(editor, blockId, 0);
    const listener = vi.fn();
    const unsubscribe = editor.subscribeTypingTriggerSession(listener);
    expect(typeAtCommittedSelection(editor, "@")).toBe(true);
    expect(editor.getTypingTriggerSession()).toBeNull();
    expect(listener).not.toHaveBeenCalled();
    expect(
      editor.dismissTypingTriggerSession({
        sessionId: "missing" as never,
        revision: 1,
      }),
    ).toBe(false);
    unsubscribe();
    editor.dispose();
  });

  it("opens only from an accepted local typing edge and updates one immutable session", () => {
    const blockId = "typing-trigger-activation" as BlockId;
    const editor = createEditor(blockId, "", [{ id: "mention", trigger: "@" }]);
    settleCaret(editor, blockId, 0);
    const notifications = vi.fn();
    editor.subscribeTypingTriggerSession(notifications);

    expect(editor.getTypingTriggerSession()).toBeNull();
    expect(editor.insertText({ blockId, offset: 0, text: "@" })).toBe(true);
    expect(editor.getTypingTriggerSession()).toBeNull();
    expect(editor.undo()).toEqual({ status: "applied" });
    settleCaret(editor, blockId, 0);

    expect(typeAtCommittedSelection(editor, "@ab")).toBe(true);
    const session = editor.getTypingTriggerSession();
    expect(session).toMatchObject({
      triggerId: "mention",
      trigger: "@",
      blockId,
      blockType: "textBlock",
      range: { from: 0, to: 3 },
      query: "ab",
      revision: 1,
      selection: { blockId, offset: 3 },
    });
    expect(Object.isFrozen(session)).toBe(true);
    expect(Object.isFrozen(session?.range)).toBe(true);
    expect(editor.getTypingTriggerSession()).toBe(session);
    expect(notifications).toHaveBeenCalledTimes(1);

    expect(typeAtCommittedSelection(editor, "c")).toBe(true);
    expect(editor.getTypingTriggerSession()).toMatchObject({
      id: session?.id,
      range: { from: 0, to: 4 },
      query: "abc",
      revision: 2,
    });
    expect(notifications).toHaveBeenCalledTimes(2);
    editor.dispose();
  });

  it("validates freshness for dismissal and does not mutate document history", () => {
    const blockId = "typing-trigger-dismissal" as BlockId;
    const editor = createEditor(blockId, "", [{ id: "slash", trigger: "/" }]);
    settleCaret(editor, blockId, 0);
    expect(typeAtCommittedSelection(editor, "/a")).toBe(true);
    const first = editor.getTypingTriggerSession()!;

    expect(
      editor.dismissTypingTriggerSession({
        sessionId: first.id,
        revision: first.revision - 1,
      }),
    ).toBe(false);
    expect(editor.getTypingTriggerSession()).toBe(first);
    expect(
      editor.dismissTypingTriggerSession({
        sessionId: first.id,
        revision: first.revision,
      }),
    ).toBe(true);
    expect(editor.getTypingTriggerSession()).toBeNull();
    expect(editor.canUndo).toBe(true);
    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.getTypingTriggerSession()).toBeNull();
    editor.dispose();
  });

  it("does not rescan dismissed text and closes when the caret leaves the query", async () => {
    const blockId = "typing-trigger-selection-lifecycle" as BlockId;
    const editor = createEditor(blockId, "", [{ id: "mention", trigger: "@" }]);
    settleCaret(editor, blockId, 0);
    expect(typeAtCommittedSelection(editor, "@a")).toBe(true);
    const dismissed = editor.getTypingTriggerSession()!;
    expect(
      editor.dismissTypingTriggerSession({
        sessionId: dismissed.id,
        revision: dismissed.revision,
      }),
    ).toBe(true);

    expect(typeAtCommittedSelection(editor, "b")).toBe(true);
    expect(editor.getTypingTriggerSession()).toBeNull();
    expect(typeAtCommittedSelection(editor, " @")).toBe(true);
    expect(editor.getTypingTriggerSession()).toMatchObject({
      triggerId: "mention",
      query: "",
    });

    settleCaret(editor, blockId, 0);
    await Promise.resolve();
    expect(editor.getTypingTriggerSession()).toBeNull();
    editor.dispose();
  });

  it("replaces the exact session range once and rejects stale acceptance", () => {
    const blockId = "typing-trigger-inline-replacement" as BlockId;
    const changes = vi.fn();
    const editor = createEditor(
      blockId,
      "",
      [{ id: "mention", trigger: "@" }],
      {},
      changes,
    );
    settleCaret(editor, blockId, 0);
    expect(typeAtCommittedSelection(editor, "@ada")).toBe(true);
    const session = editor.getTypingTriggerSession()!;
    const acceptProposal = vi.spyOn(editor, "acceptContentOperationProposal");
    const focusText = vi.spyOn(editor, "focusText");
    changes.mockClear();

    expect(
      editor.replaceTypingTriggerWithInlineContent({
        sessionId: session.id,
        revision: session.revision,
        content: [{ type: "text", text: "Ada " }],
      }),
    ).toBe(true);
    expect(acceptProposal).toHaveBeenLastCalledWith(expect.any(Object), {
      origin: "typing-trigger-replacement",
      selectionPresentation: "restore-native",
      provenance: null,
    });
    expect(focusText).not.toHaveBeenCalled();
    const canonical = editor.selectionController.canonical.getSnapshot();
    expect(
      canonical.kind === "document"
        ? canonical.snapshot.documentSelection.focus?.textOffset
        : null,
    ).toBe(4);
    expect(editor.getTypingTriggerSession()).toBeNull();
    expect(editor.readBlockContent(blockId, "textBlock")).toMatchObject({
      content: [{ content: [{ type: "text", text: "Ada " }] }],
    });
    expect(changes).toHaveBeenCalledTimes(1);
    expect(
      editor.replaceTypingTriggerWithInlineContent({
        sessionId: session.id,
        revision: session.revision,
        content: [{ type: "text", text: "stale" }],
      }),
    ).toBe(false);
    expect(changes).toHaveBeenCalledTimes(1);

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.readBlockContent(blockId, "textBlock")).toMatchObject({
      content: [{ content: [{ type: "text", text: "@ada" }] }],
    });
    expect(editor.getTypingTriggerSession()).toBeNull();
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(editor.readBlockContent(blockId, "textBlock")).toMatchObject({
      content: [{ content: [{ type: "text", text: "Ada " }] }],
    });
    expect(editor.getTypingTriggerSession()).toBeNull();
    editor.dispose();
  });

  it("validates and atomically stores only configured inline atom metadata", () => {
    const blockId = "typing-trigger-inline-atom" as BlockId;
    const editor = createEditor(
      blockId,
      "",
      [{ id: "mention", trigger: "@" }],
      {
        inlineAtoms: [
          {
            type: "mention",
            metadata: {
              id: { type: "string", required: true },
            },
            render: () => null,
          },
        ],
      },
    );
    settleCaret(editor, blockId, 0);
    expect(typeAtCommittedSelection(editor, "@ada")).toBe(true);
    const session = editor.getTypingTriggerSession()!;
    expect(
      editor.replaceTypingTriggerWithInlineContent({
        sessionId: session.id,
        revision: session.revision,
        content: [{ type: "unknown", metadata: { id: "ada" } }],
      }),
    ).toBe(false);
    expect(editor.getTypingTriggerSession()).toBe(session);

    expect(
      editor.replaceTypingTriggerWithInlineContent({
        sessionId: session.id,
        revision: session.revision,
        content: [
          { type: "mention", metadata: { id: "ada" } },
          { type: "text", text: " " },
        ],
      }),
    ).toBe(true);
    expect(editor.readBlockContent(blockId, "textBlock")).toMatchObject({
      content: [
        {
          content: [
            { type: "mention", metadata: { id: "ada" } },
            { type: "text", text: " " },
          ],
        },
      ],
    });
    editor.dispose();
  });

  it("does not let isAllowed mutate the editor-owned session", () => {
    const blockId = "typing-trigger-allowed" as BlockId;
    const isAllowed = vi.fn((context: unknown) => {
      const mutable = context as {
        trigger: string;
        triggerRange: { from: number; to: number };
      };
      mutable.trigger = "#";
      mutable.triggerRange.from = 99;
      return true;
    });
    const editor = createEditor(blockId, "x ", [
      { id: "mention", trigger: "@", isAllowed },
    ]);
    settleCaret(editor, blockId, 2);
    expect(typeAtCommittedSelection(editor, "@")).toBe(true);
    expect(editor.getTypingTriggerSession()).toMatchObject({
      trigger: "@",
      range: { from: 2, to: 3 },
    });
    expect(isAllowed).toHaveBeenCalledOnce();
    editor.dispose();
  });

  it("keeps accepted typing when isAllowed throws and opens no session", () => {
    const blockId = "typing-trigger-allowed-throw" as BlockId;
    const isAllowed = vi.fn(() => {
      throw new Error("product activation policy failed");
    });
    const changes = vi.fn();
    const editor = createEditor(
      blockId,
      "",
      [{ id: "mention", trigger: "@", isAllowed }],
      {},
      changes,
    );
    settleCaret(editor, blockId, 0);

    expect(typeAtCommittedSelection(editor, "@")).toBe(true);
    expect(isAllowed).toHaveBeenCalledOnce();
    expect(editor.getTypingTriggerSession()).toBeNull();
    expect(editor.readBlockContent(blockId, "textBlock")).toMatchObject({
      content: [{ content: [{ type: "text", text: "@" }] }],
    });
    expect(changes).toHaveBeenCalledOnce();

    editor.dispose();
  });

  it("replaces a trigger range with one canonical fragment transaction", () => {
    const blockId = "typing-trigger-fragment" as BlockId;
    const changes = vi.fn();
    const editor = createEditor(
      blockId,
      "",
      [{ id: "slash", trigger: "/" }],
      {},
      changes,
    );
    settleCaret(editor, blockId, 0);
    expect(typeAtCommittedSelection(editor, "/")).toBe(true);
    const session = editor.getTypingTriggerSession()!;
    const materialized = materializeCanonicalBlockCreation({
      type: "textBlock",
      initialText: "result",
      blockDefinitions: editor.definition.blocks,
    });
    const beforeGraphRevision = editor.getSelectionGraphRevision();
    changes.mockClear();

    expect(
      editor.replaceTypingTriggerWithCanonicalFragment({
        sessionId: session.id,
        revision: session.revision,
        fragment: materialized.fragment,
        selectionBlockId: materialized.selectionBlockId!,
      }),
    ).toBe(true);
    expect(editor.getTypingTriggerSession()).toBeNull();
    expect(editor.getSelectionGraphRevision()).toBe(beforeGraphRevision + 1);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(editor.getRootBlockIds()).toEqual([materialized.rootBlockId]);
    expect(readRootPlainTexts(editor)).toContain("result");
    expect(publishedSelectionFocus(changes.mock.calls[0]![0])).toMatchObject({
      kind: "text",
      blockId: materialized.selectionBlockId,
      textOffset: 0,
    });

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(readRootPlainTexts(editor)).toContain("/");
    expect(editor.getTypingTriggerSession()).toBeNull();
    expect(editor.redo()).toEqual({ status: "applied" });
    expect(readRootPlainTexts(editor)).toContain("result");
    expect(editor.getTypingTriggerSession()).toBeNull();
    editor.dispose();
  });

  it("settles wrapper-fragment acceptance in its first editable descendant", () => {
    const blockId = "typing-trigger-wrapper-fragment" as BlockId;
    const editor = createEditor(blockId, "", [{ id: "slash", trigger: "/" }]);
    settleCaret(editor, blockId, 0);
    expect(typeAtCommittedSelection(editor, "/wrapper")).toBe(true);
    const session = editor.getTypingTriggerSession()!;
    const materialized = materializeCanonicalBlockCreation({
      type: "wrapperBlock",
      blockDefinitions: editor.definition.blocks,
    });

    expect(
      editor.replaceTypingTriggerWithCanonicalFragment({
        sessionId: session.id,
        revision: session.revision,
        fragment: materialized.fragment,
        selectionBlockId: materialized.selectionBlockId!,
      }),
    ).toBe(true);
    expect(materialized.selectionBlockId).not.toBeNull();
    expect(editor.getBlock(materialized.rootBlockId)?.type).toBe("wrapperBlock");
    editor.dispose();
  });

  it("selects an explicit atomic target before later text in canonical reading order", () => {
    const blockId = "typing-trigger-atomic-intent" as BlockId;
    const changes = vi.fn();
    const blocks = {
      ...testEditableEditorDefinition.blocks,
      mixedWrapper: {
        kind: "wrapper" as const,
        type: "mixedWrapper",
        rootLayout: "normal" as const,
        renderer: testEditableEditorDefinition.blocks.containerWrapper!.renderer,
        content: { required: ["atomicBlock", "textBlock"] },
        contentBoundary: false,
      },
    };
    const editor = createEditor(
      blockId,
      "prefix ",
      [{ id: "slash", trigger: "/" }],
      { blocks },
      changes,
    );
    settleCaret(editor, blockId, 7);
    expect(typeAtCommittedSelection(editor, "/mixed")).toBe(true);
    const session = editor.getTypingTriggerSession()!;
    const materialized = materializeCanonicalBlockCreation({
      type: "mixedWrapper",
      blockDefinitions: editor.definition.blocks,
    });
    const atomicId = materialized.selectionBlockId!;
    const laterTextId = materialized.fragment.blocks.find(
      ({ type }) => type === "textBlock",
    )!.id;
    const beforeRevision = editor.getSelectionGraphRevision();
    changes.mockClear();

    expect(
      editor.replaceTypingTriggerWithCanonicalFragment({
        sessionId: session.id,
        revision: session.revision,
        fragment: materialized.fragment,
        selectionBlockId: atomicId,
      }),
    ).toBe(true);
    expect(editor.getSelectionGraphRevision()).toBe(beforeRevision + 1);
    expect(changes).toHaveBeenCalledOnce();
    expect(publishedSelectionFocus(changes.mock.calls[0]![0])).toMatchObject({
      kind: "block",
      blockId: atomicId,
    });
    expect(
      publishedSelectionFocus(changes.mock.calls[0]![0])?.blockId,
    ).not.toBe(laterTextId);

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.getRootBlockIds()).toEqual([blockId]);
    expect(editor.readBlockPlainText(blockId, "textBlock")).toBe(
      "prefix /mixed",
    );
    editor.dispose();
  });

  it("selects a deliberately chosen later text record", () => {
    const blockId = "typing-trigger-later-text-intent" as BlockId;
    const changes = vi.fn<(commit: EditorSemanticChange) => void>();
    const editor = createEditor(
      blockId,
      "prefix ",
      [{ id: "slash", trigger: "/" }],
      {},
      changes,
    );
    settleCaret(editor, blockId, 7);
    expect(typeAtCommittedSelection(editor, "/later")).toBe(true);
    const session = editor.getTypingTriggerSession()!;
    const fragment = createTwoTextFragment(editor);
    const textRecords = fragment.blocks.filter(
      ({ type }) => type === "textBlock" || type === "alternateTextBlock",
    );
    const laterTextId = textRecords[1]!.id;
    changes.mockClear();

    expect(
      editor.replaceTypingTriggerWithCanonicalFragment({
        sessionId: session.id,
        revision: session.revision,
        fragment,
        selectionBlockId: laterTextId,
      }),
    ).toBe(true);
    expect(changes).toHaveBeenCalledOnce();
    expect(publishedSelectionFocus(changes.mock.calls[0]![0])).toMatchObject({
      kind: "text",
      blockId: laterTextId,
      textOffset: 0,
    });
    expect(
      publishedSelectionFocus(changes.mock.calls[0]![0])?.blockId,
    ).not.toBe(textRecords[0]!.id);
    editor.dispose();
  });

  it("rejects selection intent outside the fragment without consuming the session", () => {
    const blockId = "typing-trigger-outside-selection" as BlockId;
    const changes = vi.fn();
    const editor = createEditor(
      blockId,
      "",
      [{ id: "slash", trigger: "/" }],
      {},
      changes,
    );
    settleCaret(editor, blockId, 0);
    expect(typeAtCommittedSelection(editor, "/")).toBe(true);
    const session = editor.getTypingTriggerSession()!;
    const materialized = materializeCanonicalBlockCreation({
      type: "textBlock",
      blockDefinitions: editor.definition.blocks,
    });
    const beforeRevision = editor.getSelectionGraphRevision();
    changes.mockClear();

    expect(
      editor.replaceTypingTriggerWithCanonicalFragment({
        sessionId: session.id,
        revision: session.revision,
        fragment: materialized.fragment,
        selectionBlockId: "outside-fragment" as BlockId,
      }),
    ).toBe(false);
    expect(editor.getTypingTriggerSession()).toEqual(session);
    expect(editor.getSelectionGraphRevision()).toBe(beforeRevision);
    expect(editor.getRootBlockIds()).toEqual([blockId]);
    expect(editor.readBlockPlainText(blockId, "textBlock")).toBe("/");
    expect(changes).not.toHaveBeenCalled();
    editor.dispose();
  });

  it("rejects an invalid selection offset without creating a transaction", () => {
    const blockId = "typing-trigger-invalid-selection-offset" as BlockId;
    const changes = vi.fn<(commit: EditorSemanticChange) => void>();
    const editor = createEditor(
      blockId,
      "",
      [{ id: "slash", trigger: "/" }],
      {},
      changes,
    );
    settleCaret(editor, blockId, 0);
    expect(typeAtCommittedSelection(editor, "/")).toBe(true);
    const session = editor.getTypingTriggerSession()!;
    const materialized = materializeCanonicalBlockCreation({
      type: "textBlock",
      blockDefinitions: editor.definition.blocks,
    });
    const beforeRevision = editor.getSelectionGraphRevision();
    changes.mockClear();

    expect(
      editor.replaceTypingTriggerWithCanonicalFragment({
        sessionId: session.id,
        revision: session.revision,
        fragment: materialized.fragment,
        selectionBlockId: materialized.selectionBlockId!,
        selectionOffset: 1,
      }),
    ).toBe(false);
    expect(editor.getTypingTriggerSession()).toEqual(session);
    expect(editor.getSelectionGraphRevision()).toBe(beforeRevision);
    expect(editor.getRootBlockIds()).toEqual([blockId]);
    expect(editor.readBlockPlainText(blockId, "textBlock")).toBe("/");
    expect(changes).not.toHaveBeenCalled();
    editor.dispose();
  });

  it("deletes only the trigger range and retains source prefix, suffix, identity, and chosen type", () => {
    const blockId = "typing-trigger-prefix-suffix" as BlockId;
    const changes = vi.fn();
    const editor = createEditor(
      blockId,
      "prefix  suffix",
      [{ id: "slash", trigger: "/" }],
      {},
      changes,
    );
    settleCaret(editor, blockId, 7);
    expect(typeAtCommittedSelection(editor, "/head")).toBe(true);
    const session = editor.getTypingTriggerSession()!;
    const materialized = materializeCanonicalBlockCreation({
      type: "alternateTextBlock",
      metadata: { level: 3 },
      blockDefinitions: editor.definition.blocks,
    });
    changes.mockClear();

    expect(
      editor.replaceTypingTriggerWithCanonicalFragment({
        sessionId: session.id,
        revision: session.revision,
        fragment: materialized.fragment,
        selectionBlockId: materialized.selectionBlockId!,
      }),
    ).toBe(true);
    expect(editor.getBlock(blockId)?.type).toBe("textBlock");
    expect(editor.readBlockPlainText(blockId, "textBlock")).toBe(
      "prefix  suffix",
    );
    expect(editor.getRootBlockIds()).toEqual([
      blockId,
      materialized.fragment.rootBlockIds[0],
    ]);
    expect(editor.getBlock(materialized.fragment.rootBlockIds[0]!)?.type).toBe(
      "alternateTextBlock",
    );
    expect(changes).toHaveBeenCalledOnce();

    expect(editor.undo()).toEqual({ status: "applied" });
    expect(editor.getRootBlockIds()).toEqual([blockId]);
    expect(editor.readBlockPlainText(blockId, "textBlock")).toBe(
      "prefix /head suffix",
    );
    editor.dispose();
  });
});

function createEditor(
  blockId: BlockId,
  text: string,
  typingTriggers: NonNullable<EditableEditorDefinition["typingTriggers"]>,
  extra: Partial<EditableEditorDefinition> = {},
  onChange?: EditorChangeCallback,
): EditableEditorRuntimePort {
  return initializeTestEditableEditor({
    definition: { ...testEditableEditorDefinition, ...extra, typingTriggers },
    snapshot: createTestEditorSnapshot([
      { id: blockId, type: "textBlock", text },
    ]),
    onChange,
  }) as EditableEditorRuntimePort;
}

function settleCaret(
  editor: EditableEditorRuntimePort,
  blockId: BlockId,
  offset: number,
): void {
  const anchor = createWebSelectionTextAnchorAtOffset({
    contentRuntime: editor.contentRuntime,
    blockId,
    blockType: "textBlock",
    textOffset: offset,
  });
  if (!anchor.ok) throw new Error("Could not create text anchor");
  const point = createEditorLogicalSelectionPoint({
    blockId,
    textOffset: offset,
    textAnchor: anchor.textAnchor,
    graph: editor,
  });
  if (!point) throw new Error("Could not create logical selection point");
  if (
    editor.selectionController.commitSelectionPoint(
      point,
      editor,
      editor.getSelectionGraphRevision(),
      {
        publication: { kind: "standalone-local" },
        cause: "keyboard",
      },
    ).kind === "rejected"
  ) {
    throw new Error("Could not settle caret");
  }
}

function typeAtCommittedSelection(
  editor: EditableEditorRuntimePort,
  text: string,
): boolean {
  const canonical = editor.selectionController.canonical.getSnapshot();
  const snapshot =
    canonical.kind === "document" ? canonical.snapshot.documentSelection : null;
  const head = snapshot?.focus ?? null;
  if (!head) throw new Error("Missing committed caret");
  const nextPoint = {
    blockId: head.blockId,
    blockType: head.blockType,
    textOffset: head.textOffset + text.length,
    affinity: "forward" as const,
  };
  const base = editor.contentRuntime.readContentBaseToken(
    head.blockId,
    head.blockType,
    editor.getSelectionGraphRevision(),
  );
  const operation = {
    kind: "insertInlineContent" as const,
    blockId: head.blockId,
    blockType: head.blockType,
    target: { kind: "text" as const },
    position: {
      blockId: head.blockId,
      offset: head.textOffset,
      contentVersion: editor.getBlock(head.blockId)?.contentVersion ?? null,
    },
    content: [{ type: "text" as const, text }],
  };
  return editor.acceptContentOperationProposal(
    {
      base,
      operations: [operation],
      selectionAfter: {
        direction: "forward",
        anchor: nextPoint,
        focus: nextPoint,
      },
    },
    {
      origin: "prosemirror-proposal",
      selectionPresentation: "restore-native",
      provenance: { kind: "typing", text, inputType: "text" },
    },
  ).ok;
}

function readRootPlainTexts(editor: EditableEditorRuntimePort): readonly string[] {
  return editor.getRootBlockIds().flatMap((rootId) => {
    const block = editor.getBlock(rootId);
    return !block || block.tombstone
      ? []
      : [editor.readBlockPlainText(block.id, block.type)];
  });
}

function createTwoTextFragment(
  editor: EditableEditorRuntimePort,
): CanonicalBlockFragment {
  const wrapperId = "two-text-wrapper" as BlockId;
  const firstId = "two-text-first" as BlockId;
  const secondId = "two-text-second" as BlockId;
  return createCanonicalBlockFragment({
    blocks: [
      { id: wrapperId, type: "containerWrapper", parentId: null },
      {
        id: firstId,
        type: "textBlock",
        parentId: wrapperId,
        content: createBlockRichTextContentFromPlainText("textBlock", ""),
        plainText: "",
      },
      {
        id: secondId,
        type: "alternateTextBlock",
        parentId: wrapperId,
        metadata: { level: 2 },
        content: createBlockRichTextContentFromPlainText("alternateTextBlock", ""),
        plainText: "",
      },
    ],
    rootBlockIds: [wrapperId],
    start: { kind: "block", blockId: wrapperId },
    end: { kind: "block", blockId: wrapperId },
    blockDefinitions: editor.definition.blocks,
  });
}

function publishedSelectionFocus(change: EditorSemanticChange) {
  return change.selectionAfter.kind === "selection" &&
    change.selectionAfter.selection.kind === "document"
    ? change.selectionAfter.selection.focus
    : null;
}
