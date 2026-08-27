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
  EditorTypingTriggerFragmentReplacement,
} from "@repo/editor-web/document-runtime";
import type { EditableEditor } from "@repo/editor-web/editor";
import type { EditorTypingTriggerSession } from "@repo/editor-web/typing-triggers";
import { firstDraftBlockDefinitions } from "../first-draft-definition.tsx";
import { FirstDraftSlashMenu } from "./first-draft-slash-menu.tsx";
import { firstDraftSlashActionCatalog } from "./catalog.ts";

const expectedIcons: ReadonlyMap<string, string> = new Map([
  ["paragraph", "Type"],
  ["heading-1", "Heading1"],
  ["heading-2", "Heading2"],
  ["heading-3", "Heading3"],
  ["bullet-list", "List"],
  ["numbered-list", "ListOrdered"],
  ["checklist", "ListTodo"],
  ["quote", "Quote"],
  ["code", "CodeXml"],
  ["callout", "Lightbulb"],
  ["toggle-heading-1", "Heading1"],
  ["toggle-heading-2", "Heading2"],
  ["toggle-heading-3", "Heading3"],
  ["toggle-list", "ListCollapse"],
  ["divider", "Minus"],
  ["columns-2", "Columns2"],
  ["columns-3", "Columns3"],
  ["columns-4", "Columns4"],
  ["tabs", "Folder"],
  ["table", "Table"],
] as const);

describe("FirstDraftSlashMenu", () => {
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
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (HTMLElement.prototype as Partial<HTMLElement>).scrollIntoView;
  });

  it("renders exactly one decorative mapped Lucide icon for every catalog action", () => {
    const { editor } = editorFixture();
    const interaction = interactionFixture();
    render(
      <FirstDraftSlashMenu
        editor={editor}
        geometry={editor.geometry}
        interactions={interaction.port}
      />,
    );

    expect([...expectedIcons.keys()]).toEqual(
      firstDraftSlashActionCatalog.map(({ id }) => id),
    );
    screen.getByRole("listbox", { hidden: true }).style.visibility = "visible";
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(firstDraftSlashActionCatalog.length);
    for (const [index, candidate] of firstDraftSlashActionCatalog.entries()) {
      const option = options[index]!;
      const icon = option.querySelector<HTMLElement>(
        ":scope > .first-draft-slash-menu__icon",
      );
      const svgs = option.querySelectorAll("svg");
      expect(icon?.dataset.firstDraftSlashActionIcon).toBe(
        expectedIcons.get(candidate.id),
      );
      expect(icon?.getAttribute("aria-hidden")).toBe("true");
      expect(svgs).toHaveLength(1);
      expect(svgs[0]?.getAttribute("aria-hidden")).toBe("true");
      expect(svgs[0]?.getAttribute("focusable")).toBe("false");
      expect(option.querySelector(".first-draft-slash-menu__label")?.textContent).toBe(
        candidate.label,
      );
      expect(
        screen.getByRole("option", {
          name: `${candidate.label}${candidate.category}`,
        }),
      ).toBe(option);
    }
  });

  it("uses one active state for arrows, pointer, Enter, and click", () => {
    const { editor, replace } = editorFixture();
    const interaction = interactionFixture();
    const editorTextRoot = document.createElement("div");
    editorTextRoot.tabIndex = 0;
    document.body.append(editorTextRoot);
    editorTextRoot.focus();
    render(
      <FirstDraftSlashMenu
        editor={editor}
        geometry={editor.geometry}
        interactions={interaction.port}
      />,
    );
    expect(
      screen
        .getByRole("listbox", { hidden: true })
        .getAttribute("data-editor-preserve-selection"),
    ).toBe("true");
    const options = screen.getAllByRole("option", { hidden: true });
    expect(selectedOptions(options)).toHaveLength(1);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");

    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);
    scrollIntoView.mockClear();
    expect(interaction.dispatch("ArrowUp")).toBe("handled");
    expect(options.at(-1)?.getAttribute("aria-selected")).toBe("true");
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    expect(interaction.dispatch("ArrowDown")).toBe("handled");
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");

    fireEvent.pointerMove(options[2]!);
    expect(options[2]?.getAttribute("aria-selected")).toBe("true");
    expect(selectedOptions(options)).toHaveLength(1);
    expect(interaction.dispatch("Enter")).toBe("handled");
    expect(replace).toHaveBeenCalledOnce();
    const replacement = replace.mock.calls[0]?.[0];
    if (!replacement) throw new Error("Expected slash-menu replacement");
    expect(
      replacement.fragment.blocks.some(
        ({ id }: { readonly id: BlockId }) =>
          id === replacement.selectionBlockId,
      ),
    ).toBe(true);

    fireEvent.pointerDown(options[4]!);
    fireEvent.click(options[4]!);
    expect(replace).toHaveBeenCalledTimes(2);
    expect(scrollIntoView).toHaveBeenCalled();
    expect(document.activeElement).toBe(editorTextRoot);
    editorTextRoot.remove();
  });

  it("claims arrows while the active session temporarily has no candidates", () => {
    const { editor, selectionSnapshot } = editorFixture("no-such-block");
    const interaction = interactionFixture();
    render(
      <FirstDraftSlashMenu
        editor={editor}
        geometry={editor.geometry}
        interactions={interaction.port}
      />,
    );
    const before = editor.selection.getSnapshot();

    expect(interaction.dispatch("ArrowDown")).toBe("handled");
    expect(interaction.dispatch("ArrowUp")).toBe("handled");
    expect(editor.selection.getSnapshot()).toBe(before);
    expect(editor.selection.getSnapshot()).toBe(selectionSnapshot);
    expect(screen.queryAllByRole("option", { hidden: true })).toHaveLength(0);
    expect(screen.getByText("No matching blocks")).not.toBeNull();
  });

  it("handles Escape and valid Enter but leaves ordinary and modified input unhandled", () => {
    const { editor, dismiss } = editorFixture();
    const interaction = interactionFixture();
    render(
      <FirstDraftSlashMenu
        editor={editor}
        geometry={editor.geometry}
        interactions={interaction.port}
      />,
    );

    for (const key of ["a", " ", "Space", "Tab"]) {
      expect(interaction.dispatch(key)).toBe("unhandled");
    }
    expect(interaction.dispatch("ArrowDown", { shiftKey: true })).toBe(
      "unhandled",
    );
    expect(interaction.dispatch("ArrowUp", { ctrlKey: true })).toBe(
      "unhandled",
    );
    expect(interaction.dispatch("ArrowDown", { altKey: true })).toBe(
      "unhandled",
    );
    expect(interaction.dispatch("ArrowUp", { metaKey: true })).toBe(
      "unhandled",
    );
    expect(interaction.dispatch("ArrowDown", { isComposing: true })).toBe(
      "unhandled",
    );
    expect(interaction.dispatch("Escape")).toBe("handled");
    expect(dismiss).toHaveBeenCalledOnce();
  });

  it("positions an upward menu from rendered height instead of scrollHeight", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 600,
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 120,
      width: 200,
      height: 120,
      toJSON: () => ({}),
    });
    Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
      configurable: true,
      get: () => 900,
    });
    const { editor } = editorFixture();
    vi.mocked(editor.geometry.readViewportTextCaretRect).mockReturnValue({
      left: 100,
      top: 400,
      width: 1,
      height: 18,
    });
    const interaction = interactionFixture();
    render(
      <FirstDraftSlashMenu
        editor={editor}
        geometry={editor.geometry}
        interactions={interaction.port}
      />,
    );

    const menu = screen.getByRole("listbox");
    expect(menu.getAttribute("data-placement")).toBe("top");
    expect(menu.style.top).toBe("274px");
    expect(
      menu.style.getPropertyValue(
        "--first-draft-slash-menu-available-block-size",
      ),
    ).toBe("386px");
  });

  it("publishes a shorter chosen-side constraint separately from the design cap", () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 800,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 200,
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 200,
      bottom: 120,
      width: 200,
      height: 120,
      toJSON: () => ({}),
    });
    const { editor } = editorFixture();
    vi.mocked(editor.geometry.readViewportTextCaretRect).mockReturnValue({
      left: 100,
      top: 80,
      width: 1,
      height: 18,
    });
    const interaction = interactionFixture();
    render(
      <FirstDraftSlashMenu
        editor={editor}
        geometry={editor.geometry}
        interactions={interaction.port}
      />,
    );

    const menu = screen.getByRole("listbox");
    expect(menu.getAttribute("data-placement")).toBe("bottom");
    expect(
      menu.style.getPropertyValue(
        "--first-draft-slash-menu-available-block-size",
      ),
    ).toBe("88px");
  });
});

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

function editorFixture(query = "") {
  const blockId = "slash-source" as BlockId;
  const session = {
    id: "typing-trigger-1",
    triggerId: "slash",
    trigger: "/",
    blockId,
    blockType: "paragraph",
    range: { from: 0, to: query.length + 1 },
    query,
    revision: 1,
    selection: { blockId, offset: query.length + 1 },
  } as EditorTypingTriggerSession;
  const replace = vi.fn(
    (replacement: EditorTypingTriggerFragmentReplacement) => {
      void replacement;
      return true;
    },
  );
  const dismiss = vi.fn(() => true);
  const selectionSnapshot = { kind: "none" as const, revision: 0 };
  const editor = {
    editable: true,
    definition: {
      blocks: firstDraftBlockDefinitions,
      defaultRoot: "paragraph",
      inlineMarks: [],
      inlineAtoms: [],
    },
    getTypingTriggerSession: vi.fn(() => session),
    subscribeTypingTriggerSession: vi.fn(() => () => undefined),
    dismissTypingTriggerSession: dismiss,
    replaceTypingTriggerWithCanonicalFragment: replace,
    getRootBlockIds: vi.fn(() => [blockId]),
    getChildBlockIds: vi.fn(() => []),
    getBlock: vi.fn((id: BlockId) =>
      id === blockId
        ? {
            id: blockId,
            type: "paragraph",
            parentId: null,
            tombstone: false,
            metadataVersion: "metadata",
            contentVersion: "content",
          }
        : null,
    ),
    selection: { getSnapshot: vi.fn(() => selectionSnapshot) },
    geometry: {
      subscribe: vi.fn(() => () => undefined),
      getRevision: vi.fn(() => 1),
      readViewportTextCaretRect: vi.fn(() => ({
        left: 20,
        top: 20,
        width: 1,
        height: 18,
      })),
    },
  } as unknown as EditableEditor;
  return { editor, replace, dismiss, selectionSnapshot };
}
