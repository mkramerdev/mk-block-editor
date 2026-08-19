import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  EditorDocumentLayerInteractionPort,
  EditorDocumentLayerKeyboardEvent,
  EditorDocumentLayerKeydownHandler,
  EditorDocumentLayerKeydownResult,
  EditorTypingTriggerInlineReplacement,
  EditorTypingTriggerSessionId,
} from "@repo/editor-web/document-runtime";
import type { EditableEditor } from "@repo/editor-web/editor";
import type { EditorTypingTriggerSession } from "@repo/editor-web/typing-triggers";
import { FirstDraftMentionMenu } from "./first-draft-mention-menu.tsx";

describe("FirstDraftMentionMenu", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 240,
      bottom: 180,
      width: 240,
      height: 180,
      toJSON: () => ({}),
    });
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 600,
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  it("renders only for mention and always exposes exactly one active candidate", () => {
    const fixture = editorFixture(session("slash", ""));
    const interaction = interactionFixture();
    renderMenu(fixture.editor, interaction.port);
    expect(screen.queryByRole("listbox")).toBeNull();

    fixture.setSession(session("mention", ""));
    expect(
      screen
        .getByRole("listbox", { hidden: true })
        .getAttribute("data-editor-preserve-selection"),
    ).toBe("true");
    const options = screen.getAllByRole("option", { hidden: true });
    expect(selectedOptions(options)).toHaveLength(1);
    expect(options[0]?.id).toBe("first-draft-mention-option-person-001");
    expect(
      screen
        .getByRole("listbox", { hidden: true })
        .getAttribute("aria-activedescendant"),
    ).toBe(options[0]?.id);
  });

  it("retains an active person across matching queries and resets when absent", () => {
    const fixture = editorFixture(session("mention", ""));
    const interaction = interactionFixture();
    renderMenu(fixture.editor, interaction.port);
    fireEvent.pointerMove(screen.getByText("Nina Petrova").closest("button")!);
    expect(
      screen
        .getByText("Nina Petrova")
        .closest("button")
        ?.getAttribute("aria-selected"),
    ).toBe("true");

    fixture.setSession(session("mention", "data", 2));
    expect(
      screen
        .getByText("Nina Petrova")
        .closest("button")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    fixture.setSession(session("mention", "sam", 3));
    expect(
      screen
        .getByText("Sam Okafor")
        .closest("button")
        ?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(selectedOptions(screen.getAllByRole("option"))).toHaveLength(1);
  });

  it("routes arrows through the interaction port and shares active state with hover", () => {
    const fixture = editorFixture(session("mention", ""));
    const interaction = interactionFixture();
    renderMenu(fixture.editor, interaction.port);
    vi.mocked(HTMLElement.prototype.scrollIntoView).mockClear();

    const third = screen.getAllByRole("option")[2]!;
    fireEvent.pointerEnter(third);
    expect(third.getAttribute("aria-selected")).toBe("true");
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();

    expect(interaction.dispatch("ArrowDown")).toBe("handled");
    expect(
      screen.getAllByRole("option")[3]?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
    });
    expect(fixture.replace).not.toHaveBeenCalled();
    expect(fixture.unrelated.focusText).not.toHaveBeenCalled();
    expect(fixture.unrelated.undo).not.toHaveBeenCalled();
  });

  it("claims arrows with no results but ignores modified, composing, and ordinary keys", () => {
    const fixture = editorFixture(session("mention", "no-such-person"));
    const interaction = interactionFixture();
    renderMenu(fixture.editor, interaction.port);
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No matching people")).toBeTruthy();
    expect(
      screen.getByRole("listbox").hasAttribute("aria-activedescendant"),
    ).toBe(false);
    expect(interaction.dispatch("ArrowDown")).toBe("handled");
    expect(interaction.dispatch("ArrowUp")).toBe("handled");
    expect(interaction.dispatch("ArrowDown", { ctrlKey: true })).toBe(
      "unhandled",
    );
    expect(interaction.dispatch("ArrowUp", { isComposing: true })).toBe(
      "unhandled",
    );
    for (const key of ["a", "Backspace", "Delete", " ", "Tab"]) {
      expect(interaction.dispatch(key)).toBe("unhandled");
    }
  });

  it("uses the same precise stable-ID replacement for Enter and click", () => {
    const fixture = editorFixture(session("mention", ""));
    const interaction = interactionFixture();
    renderMenu(fixture.editor, interaction.port);
    expect(interaction.dispatch("ArrowDown")).toBe("handled");
    expect(interaction.dispatch("Enter")).toBe("handled");
    fireEvent.click(screen.getByText("Aisha Rahman").closest("button")!);

    expect(fixture.replace).toHaveBeenCalledTimes(2);
    expect(fixture.replace.mock.calls[0]?.[0]).toEqual({
      sessionId: "mention-session",
      revision: 1,
      content: [
        { type: "mention", metadata: { id: "person-002" } },
        { type: "text", text: " " },
      ],
    });
    expect(fixture.replace.mock.calls[1]?.[0].content).toEqual([
      { type: "mention", metadata: { id: "person-003" } },
      { type: "text", text: " " },
    ]);
    expect(fixture.unrelated.focusText).not.toHaveBeenCalled();
    expect(fixture.unrelated.focusBlock).not.toHaveBeenCalled();
  });

  it("dismisses the exact session on Escape and rejects stale acceptance", () => {
    const fixture = editorFixture(session("mention", ""));
    const interaction = interactionFixture();
    renderMenu(fixture.editor, interaction.port);
    fixture.setCurrentWithoutPublishing(session("mention", "m", 2));
    expect(interaction.dispatch("Enter")).toBe("handled");
    expect(fixture.replace).not.toHaveBeenCalled();

    fixture.setSession(session("mention", "m", 2));
    expect(interaction.dispatch("Escape")).toBe("handled");
    expect(fixture.dismiss).toHaveBeenCalledWith({
      sessionId: "mention-session",
      revision: 2,
    });
  });

  it("prevents pointer interaction from moving native focus into the menu", () => {
    const textTarget = document.createElement("input");
    document.body.append(textTarget);
    textTarget.focus();
    const fixture = editorFixture(session("mention", ""));
    const interaction = interactionFixture();
    renderMenu(fixture.editor, interaction.port);
    const menu = screen.getByRole("listbox");
    expect(fireEvent.pointerDown(menu)).toBe(false);
    expect(document.activeElement).toBe(textTarget);
    fireEvent.click(screen.getAllByRole("option")[0]!);
    expect(document.activeElement).toBe(textTarget);
    textTarget.remove();
  });

  it("publishes placement and the selected-side available-height constraint", () => {
    const fixture = editorFixture(session("mention", ""));
    vi.mocked(
      fixture.editor.geometry.readViewportTextCaretRect,
    ).mockReturnValue({
      left: 100,
      top: 400,
      width: 1,
      height: 18,
    });
    const interaction = interactionFixture();
    renderMenu(fixture.editor, interaction.port);
    const menu = screen.getByRole("listbox");
    expect(menu.getAttribute("data-placement")).toBe("top");
    expect(menu.style.top).toBe("214px");
    expect(
      menu.style.getPropertyValue(
        "--first-draft-mention-menu-available-block-size",
      ),
    ).toBe("386px");
  });
});

function renderMenu(
  editor: EditableEditor,
  interactions: EditorDocumentLayerInteractionPort,
) {
  return render(
    <FirstDraftMentionMenu
      editor={editor}
      geometry={editor.geometry}
      interactions={interactions}
    />,
  );
}

function selectedOptions(options: HTMLElement[]): HTMLElement[] {
  return options.filter(
    (option) => option.getAttribute("aria-selected") === "true",
  );
}

function interactionFixture() {
  let handler: EditorDocumentLayerKeydownHandler | null = null;
  const port: EditorDocumentLayerInteractionPort = {
    registerKeydownHandler(nextHandler) {
      handler = nextHandler;
      return () => {
        if (handler === nextHandler) handler = null;
      };
    },
  };
  return {
    port,
    dispatch(
      key: string,
      overrides: Partial<EditorDocumentLayerKeyboardEvent> = {},
    ): EditorDocumentLayerKeydownResult {
      const event: EditorDocumentLayerKeyboardEvent = {
        key,
        code: key,
        shiftKey: false,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        repeat: false,
        isComposing: false,
        ...overrides,
      };
      let result: EditorDocumentLayerKeydownResult = "unhandled";
      act(() => {
        result = handler?.(event) ?? "unhandled";
      });
      return result;
    },
  };
}

function session(
  triggerId: "mention" | "slash",
  query: string,
  revision = 1,
): EditorTypingTriggerSession {
  const blockId = "mention-source" as BlockId;
  return {
    id: typingTriggerSessionId("mention-session"),
    triggerId,
    trigger: triggerId === "mention" ? "@" : "/",
    blockId,
    blockType: "paragraph",
    range: { from: 4, to: query.length + 5 },
    query,
    revision,
    selection: { blockId, offset: query.length + 5 },
  };
}

function typingTriggerSessionId(value: string): EditorTypingTriggerSessionId {
  if (value.trim() === "")
    throw new Error("Typing-trigger session ID is empty");
  return value as EditorTypingTriggerSessionId;
}

function editorFixture(initial: EditorTypingTriggerSession | null) {
  let current = initial;
  const listeners = new Set<() => void>();
  const replace = vi.fn((replacement: EditorTypingTriggerInlineReplacement) => {
    void replacement;
    return true;
  });
  const dismiss = vi.fn(() => true);
  const unrelated = {
    focusText: vi.fn(),
    focusBlock: vi.fn(),
    undo: vi.fn(),
  };
  const editor = {
    editable: true,
    getTypingTriggerSession: vi.fn(() => current),
    subscribeTypingTriggerSession: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    dismissTypingTriggerSession: dismiss,
    replaceTypingTriggerWithInlineContent: replace,
    focusText: unrelated.focusText,
    focusBlock: unrelated.focusBlock,
    undo: unrelated.undo,
    geometry: {
      subscribe: vi.fn(() => () => undefined),
      getRevision: vi.fn(() => 1),
      readViewportTextCaretRect: vi.fn(() => ({
        left: 20,
        top: 20,
        right: 21,
        bottom: 38,
        width: 1,
        height: 18,
      })),
    },
  } as unknown as EditableEditor;
  return {
    editor,
    replace,
    dismiss,
    unrelated,
    setCurrentWithoutPublishing(next: EditorTypingTriggerSession | null) {
      current = next;
    },
    setSession(next: EditorTypingTriggerSession | null) {
      current = next;
      act(() => {
        for (const listener of listeners) listener();
      });
    },
  };
}
