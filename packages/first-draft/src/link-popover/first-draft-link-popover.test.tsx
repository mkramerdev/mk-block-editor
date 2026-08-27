import { StrictMode } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { linkMarkDefinition } from "@repo/editor-core/content/marks";
import type { RichTextDocumentNodeJson } from "@repo/editor-core/content/rich-text";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditableEditor } from "@repo/editor-web/editor";
import type {
  EditorDocumentGeometryReader,
  EditorDocumentLayerInteractionPort,
  EditorDocumentLayerKeydownHandler,
} from "@repo/editor-web/document-runtime";
import { FirstDraftLinkForm } from "./first-draft-link-form.tsx";
import { FirstDraftLinkPopover } from "./first-draft-link-popover.tsx";

const blockId = "hover-link" as BlockId;

describe("FirstDraftLinkPopover", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("opens from delegated hover, shows the canonical URL, and ignores nested movement", () => {
    const fixture = createFixture();
    renderFixture(fixture);

    fireEvent.pointerOver(fixture.strong);
    expect(screen.getByRole("dialog", { name: "Link options" })).toBeTruthy();
    expect(screen.getByText("https://canonical.test/path")).toBeTruthy();
    const edit = screen.getByRole("button", { name: "Edit link" });
    const remove = screen.getByRole("button", { name: "Remove link" });
    expect(edit.querySelector(".lucide-pencil")).toBeTruthy();
    expect(remove.querySelector(".lucide-trash-2")).toBeTruthy();
    expect(edit.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByText("Replace link")).toBeNull();
    expect(screen.queryByText("Remove link")).toBeNull();
    expect(fixture.geometry.readTextNodeRange).toHaveBeenCalledWith(
      blockId,
      fixture.anchor,
    );
    fireEvent.pointerOut(fixture.strong, { relatedTarget: fixture.anchor });
    fireEvent.pointerOver(fixture.anchor, { relatedTarget: fixture.strong });
    expect(screen.getByRole("dialog", { name: "Link options" })).toBeTruthy();
  });

  it("opens from an active ProseMirror text projection", () => {
    const fixture = createFixture();
    renderFixture(fixture);
    const textRoot = fixture.anchor.closest<HTMLElement>(
      '[data-editor-text-root="true"]',
    );
    textRoot?.setAttribute("contenteditable", "true");
    textRoot?.classList.add("ProseMirror");

    fireEvent.pointerOver(fixture.anchor);

    expect(screen.getByRole("dialog", { name: "Link options" })).toBeTruthy();
    expect(screen.getByText("https://canonical.test/path")).toBeTruthy();
  });

  it("keeps the popover open across the hover gap and closes after both are left", () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    renderFixture(fixture);
    fireEvent.pointerOver(fixture.anchor);
    const popover = screen.getByRole("dialog", { name: "Link options" });

    fireEvent.pointerOut(fixture.anchor, { relatedTarget: popover });
    fireEvent.pointerEnter(popover);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole("dialog", { name: "Link options" })).toBeTruthy();

    fireEvent.pointerLeave(popover);
    act(() => vi.advanceTimersByTime(139));
    expect(screen.getByRole("dialog", { name: "Link options" })).toBeTruthy();
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole("dialog", { name: "Link options" })).toBeNull();
  });

  it("keeps a focused compact editor open after the pointer leaves", () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    renderFixture(fixture);
    fireEvent.pointerOver(fixture.anchor);
    fireEvent.click(screen.getByRole("button", { name: "Edit link" }));
    const input = screen.getByRole("textbox", { name: "Link URL" });
    expect(document.activeElement).toBe(input);

    fireEvent.pointerOut(fixture.anchor);
    fireEvent.pointerLeave(screen.getByRole("dialog", { name: "Link options" }));
    act(() => vi.advanceTimersByTime(200));

    expect(screen.getByRole("dialog", { name: "Link options" })).toBeTruthy();
    expect(document.activeElement).toBe(input);
  });

  it("dismisses a focused edit on outside pointerdown without applying or swallowing it", () => {
    const fixture = createFixture();
    renderFixture(fixture);
    fireEvent.pointerOver(fixture.anchor);
    fireEvent.click(screen.getByRole("button", { name: "Edit link" }));
    const input = screen.getByRole("textbox", { name: "Link URL" });
    fireEvent.change(input, { target: { value: "discarded.test" } });

    fireEvent.pointerDown(input);
    expect(screen.getByRole("dialog", { name: "Link options" })).toBeTruthy();

    const editorScope = fixture.anchor.closest<HTMLElement>(
      '[data-editor-interaction-scope="true"]',
    );
    if (!editorScope) throw new Error("Missing editor interaction scope");
    const receivedOutsidePointer = vi.fn();
    editorScope.addEventListener("pointerdown", receivedOutsidePointer);
    fireEvent.pointerDown(editorScope);

    expect(receivedOutsidePointer).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog", { name: "Link options" })).toBeNull();
    expect(fixture.editor.updateMark).not.toHaveBeenCalled();
    editorScope.removeEventListener("pointerdown", receivedOutsidePointer);
  });

  it("removes the complete canonical link once and preserves selection", () => {
    const fixture = createFixture();
    renderFixture(fixture);
    fireEvent.pointerOver(fixture.anchor);
    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));

    expect(fixture.editor.updateMark).toHaveBeenCalledOnce();
    expect(fixture.editor.updateMark).toHaveBeenCalledWith(
      {
        blockId,
        range: { from: 0, to: 10 },
        mark: { type: "link" },
        enabled: false,
      },
      { selectionEffect: { kind: "preserve" } },
    );
    expect(fixture.anchor.getAttribute("href")).toBe(
      "https://dom-is-not-authority.test",
    );
    expect(screen.queryByRole("dialog", { name: "Link options" })).toBeNull();
  });

  it("replaces remove with a decorative X cancel while editing", () => {
    const fixture = createFixture();
    renderFixture(fixture);
    fireEvent.pointerOver(fixture.anchor);
    fireEvent.click(screen.getByRole("button", { name: "Edit link" }));

    expect(screen.queryByRole("button", { name: "Remove link" })).toBeNull();
    const cancel = screen.getByRole("button", {
      name: "Cancel editing link",
    });
    expect(cancel.className).toContain("first-draft-link-popover__cancel");
    expect(cancel.querySelector(".lucide-x")).toBeTruthy();
    expect(cancel.querySelector("svg")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(cancel.querySelector("svg")?.getAttribute("focusable")).toBe(
      "false",
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Link URL" }), {
      target: { value: "changed.test" },
    });
    fireEvent.click(cancel);

    expect(fixture.editor.updateMark).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox", { name: "Link URL" })).toBeNull();
    expect(screen.getByText("https://canonical.test/path")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove link" })).toBeTruthy();
  });

  it.each([
    {
      name: "Enter",
      confirm: (input: HTMLElement) =>
        fireEvent.keyDown(input, { key: "Enter" }),
    },
    {
      name: "Check",
      confirm: () =>
        fireEvent.click(screen.getByRole("button", { name: "Save link" })),
    },
  ])(
    "confirms with $name once and preserves canonical title and target",
    ({ confirm }) => {
      const fixture = createFixture();
      renderFixture(fixture);
      fireEvent.pointerOver(fixture.anchor);
      fireEvent.click(screen.getByRole("button", { name: "Edit link" }));
      const input = screen.getByRole("textbox", { name: "Link URL" });
      expect(input).toHaveProperty("value", "https://canonical.test/path");
      expect(document.activeElement).toBe(input);
      expect((input as HTMLInputElement).selectionStart).toBe(0);
      expect((input as HTMLInputElement).selectionEnd).toBe(
        "https://canonical.test/path".length,
      );
      expect(screen.queryByRole("button", { name: "Edit link" })).toBeNull();
      expect(screen.getByRole("button", { name: "Save link" })).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Cancel editing link" }),
      ).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Remove link" })).toBeNull();
      expect(fixture.editor.updateMark).not.toHaveBeenCalled();

      fireEvent.change(input, { target: { value: "replacement.test/new" } });
      expect(fixture.editor.updateMark).not.toHaveBeenCalled();
      confirm(input);

      expect(fixture.editor.updateMark).toHaveBeenCalledOnce();
      expect(fixture.editor.updateMark).toHaveBeenCalledWith(
        {
          blockId,
          range: { from: 0, to: 10 },
          mark: {
            type: "link",
            attrs: {
              href: "https://replacement.test/new",
              title: "Canonical",
              target: "_blank",
            },
          },
          enabled: true,
        },
        { selectionEffect: { kind: "preserve" } },
      );
      expect(screen.queryByRole("dialog", { name: "Link options" })).toBeNull();
    },
  );

  it.each([
    { value: "", message: "Enter a URL." },
    {
      value: "javascript:alert(1)",
      message: "Enter a valid web, email, or document URL.",
    },
  ])(
    "keeps invalid URL '$value' open without a transaction",
    ({ value, message }) => {
      const fixture = createFixture();
      renderFixture(fixture);
      fireEvent.pointerOver(fixture.anchor);
      fireEvent.click(screen.getByRole("button", { name: "Edit link" }));
      const input = screen.getByRole("textbox", { name: "Link URL" });
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(
        screen.getByRole("form", { name: "Edit link destination" }),
      );

      expect(screen.getByRole("alert").textContent).toBe(message);
      expect(document.activeElement).toBe(input);
      expect(fixture.editor.updateMark).not.toHaveBeenCalled();
    },
  );

  it("cancels compact editing on Escape, then closes from read mode", () => {
    const fixture = createFixture();
    renderFixture(fixture);
    fireEvent.pointerOver(fixture.anchor);
    fireEvent.click(screen.getByRole("button", { name: "Edit link" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Link URL" }), {
      target: { value: "changed.test" },
    });

    fireEvent.keyDown(screen.getByRole("textbox", { name: "Link URL" }), {
      key: "Escape",
    });
    expect(fixture.editor.updateMark).not.toHaveBeenCalled();
    expect(screen.getByText("https://canonical.test/path")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Edit link" })).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("dialog", { name: "Link options" }), {
      key: "Escape",
    });
    expect(screen.queryByRole("dialog", { name: "Link options" })).toBeNull();
  });

  it("does not update a canonically changed link range", () => {
    const fixture = createFixture();
    renderFixture(fixture);
    fireEvent.pointerOver(fixture.anchor);
    fireEvent.click(screen.getByRole("button", { name: "Edit link" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Link URL" }), {
      target: { value: "replacement.test" },
    });
    fixture.setCanonicalHref("https://remote.test/change");

    fireEvent.submit(
      screen.getByRole("form", { name: "Edit link destination" }),
    );

    expect(fixture.editor.updateMark).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "Link options" })).toBeNull();
  });

  it("centers from the complete multiline range and repositions on revisions", () => {
    const fixture = createFixture();
    vi.mocked(fixture.geometry.readTextRootRect).mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 300,
    });
    vi.mocked(fixture.geometry.readTextRangeRects).mockReturnValue([
      { left: 400, top: 100, width: 100, height: 18 },
      { left: 300, top: 120, width: 50, height: 18 },
    ]);
    renderFixture(fixture);
    fireEvent.pointerOver(fixture.anchor);
    const popover = screen.getByRole("dialog", { name: "Link options" });
    expect(popover.dataset.placement).toBe("above");
    expect(popover.style.left).toBe("224px");
    expect(popover.style.top).toBe("92px");
    expect(fixture.geometry.readTextRangeRects).toHaveBeenCalledWith(blockId, {
      from: 0,
      to: 10,
    });

    vi.mocked(fixture.geometry.readTextRangeRects).mockReturnValue([
      { left: 450, top: 20, width: 20, height: 18 },
    ]);
    act(() => fixture.publishGeometry());
    expect(popover.dataset.placement).toBe("below");
    expect(popover.style.left).toBe("284px");
    expect(popover.style.top).toBe("46px");
  });

  it.each([
    { rectLeft: -50, expected: "10px" },
    { rectLeft: 490, expected: "158px" },
  ])(
    "clamps centered positioning at a horizontal edge",
    ({ rectLeft, expected }) => {
      const fixture = createFixture();
      vi.mocked(fixture.geometry.readTextRangeRects).mockReturnValue([
        { left: rectLeft, top: 100, width: 50, height: 18 },
      ]);
      renderFixture(fixture);
      fireEvent.pointerOver(fixture.anchor);

      expect(
        screen.getByRole("dialog", { name: "Link options" }).style.left,
      ).toBe(expected);
    },
  );

  it("dismisses on remote block changes, deletion, selection changes, and Escape", () => {
    const fixture = createFixture();
    renderFixture(fixture);
    fireEvent.pointerOver(fixture.anchor);
    fireEvent.click(screen.getByRole("button", { name: "Edit link" }));
    act(() => fixture.publishBlock());
    expect(screen.queryByRole("dialog", { name: "Link options" })).toBeNull();

    fireEvent.pointerOver(fixture.anchor);
    act(() => fixture.publishSelection());
    expect(screen.queryByRole("dialog", { name: "Link options" })).toBeNull();

    fireEvent.pointerOver(fixture.anchor);
    act(() => fixture.keydown?.({ key: "Escape" } as never));
    expect(screen.queryByRole("dialog", { name: "Link options" })).toBeNull();
  });

  it("keeps the full selection-toolbar link form functional", () => {
    const apply = vi.fn(() => null);
    render(
      <FirstDraftLinkForm
        definition={linkMarkDefinition}
        initialDraft={{ href: "", title: "", target: "" }}
        canRemove={false}
        onApply={apply}
        onRemove={() => null}
        onClose={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText("URL"), {
      target: { value: "https://toolbar.test/path" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(apply).toHaveBeenCalledWith({
      href: "https://toolbar.test/path",
      title: null,
      target: null,
    });
  });

  it("uses compact focus styling and contains no popover triangle", () => {
    const css = readFileSync(
      resolve(process.cwd(), "src/first-draft.css"),
      "utf8",
    );
    expect(css).not.toContain(".first-draft-link-popover::after");
    expect(css).not.toContain(
      '.first-draft-link-popover[data-placement="above"]::after',
    );
    expect(css).not.toContain(
      '.first-draft-link-popover[data-placement="below"]::after',
    );
    expect(css).toMatch(
      /\.first-draft-example \.first-draft-link-popover__input\s*\{[^}]*border:\s*1px solid var\(--color-border\);[^}]*border-radius:\s*0\.375rem;[^}]*color:\s*var\(--color-text\);[^}]*font-size:\s*0\.8125rem;[^}]*line-height:\s*1\.35;[^}]*outline:\s*none;/s,
    );
    expect(css).toMatch(
      /\.first-draft-example \.first-draft-link-popover__input:focus\s*\{[^}]*border-color:\s*var\(--color-border-highlight\);/s,
    );
    expect(css).toMatch(
      /\.first-draft-link-popover__url\s*\{[^}]*font-size:\s*0\.8125rem;/s,
    );
    expect(css).toMatch(
      /\.first-draft-link-popover__row button\s*\{[^}]*color:\s*var\(--color-text\);/s,
    );
    expect(css).not.toMatch(
      /\.first-draft-link-popover__row button(?:\s*:[^{]+)?\s*\{[^}]*color:\s*var\(--color-foreground\);/s,
    );
    expect(css).toMatch(
      /button\.first-draft-link-popover__cancel\s*\{[^}]*color:\s*var\(--fd-danger\);/s,
    );
    expect(css).toMatch(
      /button\.first-draft-link-popover__cancel\s+svg\s*\{[^}]*inline-size:\s*1\.25rem;[^}]*block-size:\s*1\.25rem;/s,
    );
  });

  it("isolates editors, suppresses selection-menu overlap, and cleans up in Strict Mode", () => {
    const first = createFixture();
    const second = createFixture("second" as BlockId);
    const { unmount } = render(
      <StrictMode>
        <FixtureView fixture={first} selectionMenu={true} />
        <FixtureView fixture={second} />
      </StrictMode>,
    );
    fireEvent.pointerOver(first.anchor);
    expect(screen.queryByRole("dialog", { name: "Link options" })).toBeNull();
    fireEvent.pointerOver(second.anchor);
    expect(
      screen.getAllByRole("dialog", { name: "Link options" }),
    ).toHaveLength(1);
    expect(first.geometry.readTextNodeRange).not.toHaveBeenCalled();
    // Strict Mode must not leave a second delegated listener behind.
    expect(second.geometry.readTextNodeRange).toHaveBeenCalledOnce();
    const firstScope = first.anchor.closest<HTMLElement>(
      '[data-editor-interaction-scope="true"]',
    );
    if (!firstScope) throw new Error("Missing first editor interaction scope");
    fireEvent.pointerDown(firstScope);
    expect(
      screen.getAllByRole("dialog", { name: "Link options" }),
    ).toHaveLength(1);
    unmount();
    expect(second.removeKeydown).toHaveBeenCalled();
  });
});

function renderFixture(fixture: ReturnType<typeof createFixture>) {
  return render(<FixtureView fixture={fixture} />);
}

function FixtureView({
  fixture,
  selectionMenu = false,
}: {
  readonly fixture: ReturnType<typeof createFixture>;
  readonly selectionMenu?: boolean;
}) {
  return (
    <div
      data-editor-interaction-scope="true"
      data-editor-block-list-root="true"
    >
      <div
        data-editor-block-shell="true"
        data-editor-block-id={fixture.blockId}
      >
        <div data-editor-text-root="true">
          <a
            data-link-popover-fixture-anchor={fixture.fixtureId}
            href="https://dom-is-not-authority.test"
          >
            before
            <strong data-link-popover-fixture-strong={fixture.fixtureId}>
              bold
            </strong>
          </a>
        </div>
      </div>
      {selectionMenu ? <div data-first-draft-selection-menu="true" /> : null}
      <FirstDraftLinkPopover
        editor={fixture.editor as EditableEditor}
        geometry={fixture.geometry}
        interactions={fixture.interactions}
      />
    </div>
  );
}

function createFixture(id: BlockId = blockId) {
  const fixtureId = String(id);
  const geometryListeners = new Set<() => void>();
  const blockListeners = new Set<() => void>();
  const selectionListeners = new Set<() => void>();
  let revision = 0;
  let keydown: EditorDocumentLayerKeydownHandler | null = null;
  const removeKeydown = vi.fn();
  let content = linkContent("https://canonical.test/path");
  const geometry = {
    getRevision: () => revision,
    subscribe(listener: () => void) {
      geometryListeners.add(listener);
      return () => geometryListeners.delete(listener);
    },
    readTextNodeRange: vi.fn(() => ({ from: 2, to: 6 })),
    readTextRangeRects: vi.fn(() => [
      { left: 30, top: 100, width: 80, height: 18 },
    ]),
    readTextRootRect: vi.fn(() => ({
      left: 10,
      top: 0,
      width: 500,
      height: 200,
    })),
  } as unknown as EditorDocumentGeometryReader;
  const editor = {
    editable: true,
    definition: { inlineMarks: [linkMarkDefinition] },
    geometry,
    getBlock(requested: BlockId) {
      return requested === id
        ? {
            id,
            type: "paragraph",
            parentId: null,
            tombstone: null,
            metadataVersion: "1",
            contentVersion: "1",
          }
        : null;
    },
    readBlockContent: (requested: BlockId) =>
      requested === id ? content : null,
    subscribeBlock(_blockId: BlockId, listener: () => void) {
      blockListeners.add(listener);
      return () => blockListeners.delete(listener);
    },
    selection: {
      subscribe(listener: () => void) {
        selectionListeners.add(listener);
        return () => selectionListeners.delete(listener);
      },
    },
    updateMark: vi.fn(() => true),
  } as unknown as EditableEditor;
  const interactions = {
    registerKeydownHandler(handler: EditorDocumentLayerKeydownHandler) {
      keydown = handler;
      return removeKeydown;
    },
  } as EditorDocumentLayerInteractionPort;
  return {
    blockId: id,
    fixtureId,
    editor,
    geometry,
    interactions,
    get anchor() {
      const element = document.querySelector<HTMLAnchorElement>(
        `[data-link-popover-fixture-anchor="${fixtureId}"]`,
      );
      if (!element) throw new Error("missing link popover anchor fixture");
      return element;
    },
    get strong() {
      const element = document.querySelector<HTMLElement>(
        `[data-link-popover-fixture-strong="${fixtureId}"]`,
      );
      if (!element) throw new Error("missing link popover strong fixture");
      return element;
    },
    removeKeydown,
    get keydown() {
      return keydown;
    },
    publishGeometry() {
      revision += 1;
      for (const listener of geometryListeners) listener();
    },
    publishBlock() {
      for (const listener of blockListeners) listener();
    },
    publishSelection() {
      for (const listener of selectionListeners) listener();
    },
    setCanonicalHref(href: string) {
      content = linkContent(href);
    },
  };
}

function linkContent(href: string): RichTextDocumentNodeJson {
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "before", marks: [link(href)] },
          {
            type: "text",
            text: "bold",
            marks: [link(href), { type: "strong" }],
          },
        ],
      },
    ],
  };
}

function link(href = "https://canonical.test/path") {
  return {
    type: "link" as const,
    attrs: {
      href,
      title: "Canonical",
      target: "_blank",
    },
  };
}
