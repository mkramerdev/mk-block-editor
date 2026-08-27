import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { addEditorBlockOperations } from "@repo/editor-web/block-operations";
import {
  EditorDocument,
  type EditorChangeCallback,
} from "@repo/editor-web/document-runtime";
import { initializeTestEditableEditor as initializeEditableEditor } from "../test-editor.ts";
import {
  createFirstDraftViewStateStore,
  FirstDraftViewStateProvider,
} from "../blocks/view-state.tsx";
import { createFirstDraftEditorDefinition } from "../first-draft-definition.tsx";
import type { FirstDraftBlockRendererProps } from "../first-draft-editor-contracts.ts";
import type { EditableEditorDefinition } from "@repo/editor-web/editor";
import {
  TabPaneRenderer,
  TabsRenderer,
} from "../blocks/layout/renderers.tsx";
import { createFirstDraftSnapshot } from "../first-draft-fixture.ts";
import {
  createFirstDraftTabsActionUiStore,
  FirstDraftTabsActionUiProvider,
} from "./store.tsx";
import { FirstDraftTabsActionMenuLayer } from "./tabs-action-menu-layer.tsx";
import { FirstDraftBlockHoverProvider } from "../block-controls/index.ts";
import {
  createFirstDraftTableActionMenuStore,
  FirstDraftTableActionMenuProvider,
} from "../table-action-menu/index.ts";

const id = (value: string) => value as BlockId;
const disposables: Array<{ dispose(): void }> = [];
let animationFrames: FrameRequestCallback[];
let elementBounds: WeakMap<HTMLElement, DOMRect>;
let documentBounds: DOMRect;
let menuBounds: DOMRect;
let resizeObservers: TestResizeObserver[];

beforeEach(() => {
  animationFrames = [];
  elementBounds = new WeakMap();
  documentBounds = domRect(0, 0, 800, 600);
  menuBounds = domRect(0, 0, 176, 80);
  resizeObservers = [];
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    animationFrames.push(callback);
    return animationFrames.length;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      return (
        elementBounds.get(this) ??
        (this.classList.contains("first-draft-example__document-scroll")
          ? documentBounds
          : this.classList.contains("first-draft-tabs-action-menu")
            ? menuBounds
            : domRect(0, 0, 0, 0))
      );
    },
  );
  class ResizeObserverDouble implements ResizeObserver {
    readonly targets = new Set<Element>();
    constructor(readonly callback: ResizeObserverCallback) {
      resizeObservers.push(this);
    }
    observe(target: Element): void {
      this.targets.add(target);
    }
    unobserve(target: Element): void {
      this.targets.delete(target);
    }
    disconnect(): void {
      this.targets.clear();
    }
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverDouble);
});

afterEach(() => {
  cleanup();
  for (const editor of disposables.splice(0)) editor.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderTabs(
  options: {
    readonly onChange?: EditorChangeCallback;
    readonly selectedPaneId?: BlockId | null;
    readonly definition?: (
      viewState: ReturnType<typeof createFirstDraftViewStateStore>,
    ) => EditableEditorDefinition;
  } = {},
) {
  const selectedPaneId = options.selectedPaneId === undefined
    ? id("fd-tab-overview")
    : options.selectedPaneId;
  const viewState = createFirstDraftViewStateStore({
    selectedTabs: selectedPaneId
      ? { [id("fd-tabs")]: selectedPaneId }
      : undefined,
  });
  const editor = addEditorBlockOperations(
    initializeEditableEditor({
      definition: options.definition
        ? options.definition(viewState)
        : createFirstDraftEditorDefinition(viewState),
      snapshot: createFirstDraftSnapshot(),
      onChange: options.onChange,
    }),
  );
  disposables.push(editor);
  const store = createFirstDraftTabsActionUiStore();
  const tableMenuStore = createFirstDraftTableActionMenuStore();
  let geometryRevision = editor.geometry.getRevision();
  const geometryListeners = new Set<() => void>();
  const geometry = {
    ...editor.geometry,
    getRevision: () => geometryRevision,
    subscribe(listener: () => void) {
      geometryListeners.add(listener);
      return () => geometryListeners.delete(listener);
    },
  };
  const result = render(
    <FirstDraftViewStateProvider store={viewState}>
      <FirstDraftTableActionMenuProvider store={tableMenuStore}>
        <FirstDraftTabsActionUiProvider store={store}>
          <section
            className="first-draft-example"
            data-editor-interaction-scope="true"
          >
            <div className="first-draft-example__document-scroll">
              <FirstDraftBlockHoverProvider enabled={editor.editable}>
                <EditorDocument
                  editor={editor}
                  renderDocumentLayers={(context) => (
                    <FirstDraftTabsActionMenuLayer
                      editor={editor}
                      geometry={geometry}
                      interactions={context.interactions}
                      store={store}
                      selectTab={(tabsId, paneId) =>
                        viewState.selectTab(tabsId, paneId)
                      }
                    />
                  )}
                />
              </FirstDraftBlockHoverProvider>
            </div>
          </section>
        </FirstDraftTabsActionUiProvider>
      </FirstDraftTableActionMenuProvider>
    </FirstDraftViewStateProvider>,
  );
  const tabsShell = result.container.querySelector<HTMLElement>(
    '[data-editor-block-id="fd-tabs"]',
  )!;
  return {
    ...result,
    editor,
    store,
    viewState,
    tabsShell,
    bumpGeometry() {
      act(() => {
        geometryRevision += 1;
        for (const listener of [...geometryListeners]) listener();
      });
    },
  };
}

function pills(root: ParentNode): HTMLButtonElement[] {
  return [...root.querySelectorAll<HTMLButtonElement>(".tabs-block__tab")];
}

function openMenu(button: HTMLButtonElement): MouseEvent {
  const event = new MouseEvent("contextmenu", {
    bubbles: true,
    cancelable: true,
    button: 2,
  });
  act(() => {
    expect(button.dispatchEvent(event)).toBe(false);
  });
  return event;
}

describe("First Draft editable tabs runtime", () => {
  it("renders a valid selection or first-pane fallback before effects run", () => {
    const selected = renderTabs({ selectedPaneId: id("fd-tab-details") });
    expect(pills(selected.tabsShell).map((pill) => pill.ariaSelected)).toEqual([
      "false",
      "true",
      "false",
    ]);
    expect(
      [...selected.tabsShell.querySelectorAll<HTMLElement>(".tabs-block__pane")]
        .map((pane) => pane.hidden),
    ).toEqual([true, false, true]);

    const stale = renderTabs({ selectedPaneId: id("deleted-pane") });
    expect(pills(stale.tabsShell).map((pill) => pill.ariaSelected)).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(
      [...stale.tabsShell.querySelectorAll<HTMLElement>(".tabs-block__pane")]
        .map((pane) => pane.hidden),
    ).toEqual([false, true, true]);
    expect(stale.viewState.getSnapshot().selectedTabs[id("fd-tabs")]).toBe(
      id("deleted-pane"),
    );
  });

  it("uses roving stable pills and switches only local mounted presentation", () => {
    const onChange = vi.fn();
    const fixture = renderTabs({ onChange });
    const initialPills = pills(fixture.tabsShell);
    const paneElements = [
      ...fixture.tabsShell.querySelectorAll<HTMLElement>(".tabs-block__pane"),
    ];
    const selection = fixture.editor.selection.getSnapshot();
    const header = fixture.tabsShell.querySelector(".tabs-block__header")!;
    expect(header.children[0]?.classList).toContain("tabs-block__tablist");
    expect(header.children[1]?.classList).toContain("tabs-block__add");
    expect(initialPills).toHaveLength(3);
    expect(paneElements.map((pane) => pane.hidden)).toEqual([
      false,
      true,
      true,
    ]);
    const paneTextRoots = paneElements.map((pane) =>
      pane.querySelector('[data-editor-text-root="true"]'),
    );
    expect(
      initialPills.map((pill) => pill.getAttribute("aria-selected")),
    ).toEqual(["true", "false", "false"]);
    expect(initialPills.map((pill) => pill.tabIndex)).toEqual([0, -1, -1]);

    fireEvent.click(initialPills[1]!);
    expect(
      pills(fixture.tabsShell).map((pill) =>
        pill.getAttribute("aria-selected"),
      ),
    ).toEqual(["false", "true", "false"]);
    expect(onChange).not.toHaveBeenCalled();
    expect(fixture.editor.selection.getSnapshot()).toBe(selection);
    expect([
      ...fixture.tabsShell.querySelectorAll<HTMLElement>(".tabs-block__pane"),
    ]).toEqual(paneElements);
    expect(paneElements.map((pane) => pane.hidden)).toEqual([
      true,
      false,
      true,
    ]);
    expect(
      paneElements.map((pane) =>
        pane.querySelector('[data-editor-text-root="true"]'),
      ),
    ).toEqual(paneTextRoots);

    fireEvent.keyDown(pills(fixture.tabsShell)[1]!, { key: "ArrowRight" });
    expect(pills(fixture.tabsShell)[2]!.getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(document.activeElement).toBe(pills(fixture.tabsShell)[2]);
    fireEvent.keyDown(pills(fixture.tabsShell)[2]!, { key: "Home" });
    expect(pills(fixture.tabsShell)[0]!.getAttribute("aria-selected")).toBe(
      "true",
    );
    fireEvent.keyDown(pills(fixture.tabsShell)[0]!, { key: "End" });
    expect(pills(fixture.tabsShell)[2]!.getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(
      fireEvent.keyDown(pills(fixture.tabsShell)[2]!, { key: "Enter" }),
    ).toBe(true);
    expect(fireEvent.keyDown(pills(fixture.tabsShell)[2]!, { key: " " })).toBe(
      true,
    );
    expect(onChange).not.toHaveBeenCalled();
  });

  it("opens an isolated document-layer menu, activates on right click, and dismisses safely", async () => {
    const first = renderTabs();
    const second = renderTabs();
    const inactive = pills(first.tabsShell)[1]!;
    const nativeEvent = openMenu(inactive);
    expect(nativeEvent.defaultPrevented).toBe(true);
    expect(inactive.getAttribute("aria-selected")).toBe("true");
    const menu = document.querySelector<HTMLElement>(
      "[data-first-draft-tabs-action-menu='true']",
    )!;
    expect(menu).not.toBeNull();
    expect(
      menu.closest('[data-editor-document-layer-host="true"]'),
    ).not.toBeNull();
    expect(
      [...menu.querySelectorAll('[role="menuitem"]')].map((item) =>
        item.textContent?.trim(),
      ),
    ).toEqual(["Rename", "Delete"]);
    expect(second.store.getSnapshot().kind).toBe("closed");

    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(first.store.getSnapshot().kind).toBe("closed"));
    expect(document.activeElement).toBe(inactive);

    openMenu(inactive);
    fireEvent.keyDown(document.activeElement!, { key: "Tab" });
    await waitFor(() => expect(first.store.getSnapshot().kind).toBe("closed"));

    openMenu(inactive);
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(first.store.getSnapshot().kind).toBe("closed"));
    expect(document.activeElement).toBe(inactive);
  });

  it("renames through one blur settlement and cancels Escape without a transaction", async () => {
    const onChange = vi.fn();
    const fixture = renderTabs({ onChange });
    const original = pills(fixture.tabsShell)[0]!;
    openMenu(original);
    fireEvent.click(document.querySelector('[data-action="rename"]')!);
    const input = fixture.tabsShell.querySelector<HTMLInputElement>(
      ".tabs-block__rename",
    )!;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe("Writing");
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe("Writing".length);
    fireEvent.change(input, { target: { value: "  New title  " } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledOnce();
    expect(
      fixture.editor.getBlock(id("fd-tab-overview"))?.metadata,
    ).toMatchObject({
      tabId: "writing",
      title: "New title",
    });
    expect(fixture.editor.getChildBlockIds(id("fd-tab-overview"))).toEqual([
      id("fd-tab-overview-text"),
    ]);

    const renamed = pills(fixture.tabsShell)[0]!;
    openMenu(renamed);
    fireEvent.click(document.querySelector('[data-action="rename"]')!);
    const cancelInput = fixture.tabsShell.querySelector<HTMLInputElement>(
      ".tabs-block__rename",
    )!;
    fireEvent.change(cancelInput, { target: { value: "Discard me" } });
    fireEvent.keyDown(cancelInput, { key: "Escape" });
    await waitFor(() =>
      expect(document.activeElement).toBe(pills(fixture.tabsShell)[0]),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(
      fixture.editor.getBlock(id("fd-tab-overview"))?.metadata?.title,
    ).toBe("New title");
  });

  it("commits Enter through blur once, shows the empty-title fallback, and rejects stale local input", () => {
    const onChange = vi.fn();
    const fixture = renderTabs({ onChange });
    openMenu(pills(fixture.tabsShell)[0]!);
    fireEvent.click(document.querySelector('[data-action="rename"]')!);
    let input = fixture.tabsShell.querySelector<HTMLInputElement>(
      ".tabs-block__rename",
    )!;
    fireEvent.change(input, { target: { value: "Keyboard title" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledOnce();
    expect(
      fixture.editor.getBlock(id("fd-tab-overview"))?.metadata?.title,
    ).toBe("Keyboard title");

    openMenu(pills(fixture.tabsShell)[0]!);
    fireEvent.click(document.querySelector('[data-action="rename"]')!);
    input = fixture.tabsShell.querySelector<HTMLInputElement>(
      ".tabs-block__rename",
    )!;
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(
      fixture.editor.getBlock(id("fd-tab-overview"))?.metadata?.title,
    ).toBe("");
    expect(pills(fixture.tabsShell)[0]!.textContent).toBe("Tab 1");

    openMenu(pills(fixture.tabsShell)[0]!);
    fireEvent.click(document.querySelector('[data-action="rename"]')!);
    input = fixture.tabsShell.querySelector<HTMLInputElement>(
      ".tabs-block__rename",
    )!;
    fireEvent.change(input, { target: { value: "Stale local" } });
    fixture.editor.updateBlockMetadata(
      [{ blockId: id("fd-tab-overview"), values: { title: "Remote title" } }],
      { selectionEffect: { kind: "preserve" } },
    );
    expect(onChange).toHaveBeenCalledTimes(3);
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledTimes(3);
    expect(
      fixture.editor.getBlock(id("fd-tab-overview"))?.metadata?.title,
    ).toBe("Remote title");
  });

  it("adds a canonical empty pane and deletes the selected subtree once", () => {
    const onChange = vi.fn();
    const fixture = renderTabs({ onChange });
    const add = fixture.tabsShell.querySelector<HTMLButtonElement>(
      'button[aria-label="Add tab"]',
    )!;
    expect(add).not.toBeNull();
    fireEvent.click(add);
    expect(onChange).toHaveBeenCalledOnce();
    const paneIds = fixture.editor.getChildBlockIds(id("fd-tabs"));
    expect(paneIds).toHaveLength(4);
    const addedId = paneIds.at(-1)!;
    expect(fixture.editor.getBlock(addedId)?.type).toBe("tabPane");
    expect(fixture.editor.getChildBlockIds(addedId)).toEqual([]);
    expect(pills(fixture.tabsShell).at(-1)?.getAttribute("aria-selected")).toBe(
      "true",
    );

    openMenu(pills(fixture.tabsShell)[1]!);
    fireEvent.click(document.querySelector('[data-action="delete"]')!);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(fixture.editor.getBlock(id("fd-tab-details"))).toBeNull();
    expect(pills(fixture.tabsShell)[1]!.textContent).toBe("Collaboration");
    expect(pills(fixture.tabsShell)[1]!.getAttribute("aria-selected")).toBe(
      "true",
    );
  });

  it("adds, focuses, hides, and restores empty-pane content without re-executing pane renderers", () => {
    const onChange = vi.fn();
    let paneExecutions = 0;
    let tabsExecutions = 0;
    const fixture = renderTabs({
      onChange,
      definition(viewState) {
        const base = createFirstDraftEditorDefinition(viewState);
        const CountingTabPaneRenderer = (
          props: FirstDraftBlockRendererProps,
        ) => {
          paneExecutions += 1;
          return <TabPaneRenderer {...props} />;
        };
        const CountingTabsRenderer = (
          props: FirstDraftBlockRendererProps,
        ) => {
          tabsExecutions += 1;
          return <TabsRenderer {...props} />;
        };
        return {
          ...base,
          blocks: {
            ...base.blocks,
            tabPane: {
              ...base.blocks.tabPane!,
              renderer: CountingTabPaneRenderer,
            },
            tabs: {
              ...base.blocks.tabs!,
              renderer: CountingTabsRenderer,
            },
          },
        };
      },
    });
    act(() => {
      expect(
        fixture.editor.focusText(id("fd-tab-overview-text"), {
          offset: 0,
          preventScroll: true,
        }).status,
      ).toBe("focused");
    });
    const add = fixture.tabsShell.querySelector<HTMLButtonElement>(
      'button[aria-label="Add tab"]',
    )!;
    add.focus();
    fireEvent.click(add);
    expect(document.activeElement).toBe(add);
    expect(fixture.editor.selection.getSnapshot().kind).toBe("none");
    expect(onChange).toHaveBeenCalledOnce();

    const paneId = fixture.editor.getChildBlockIds(id("fd-tabs")).at(-1)!;
    const paneShell = fixture.tabsShell.querySelector<HTMLElement>(
      `[data-editor-block-id="${paneId}"]`,
    )!;
    const pane = paneShell.querySelector<HTMLElement>(".tabs-block__pane")!;
    expect(pane.hidden).toBe(false);
    const button = pane.querySelector<HTMLButtonElement>(
      ".empty-wrapper-add-text-button",
    )!;
    expect(button).not.toBeNull();
    expect(button.draggable).toBe(false);
    expect(button.hasAttribute("data-first-draft-block-drop-target-active")).toBe(
      false,
    );
    expect(paneShell.querySelector(".first-draft-block-drop-target")).not.toBeNull();
    const executionsBeforeInsertion = paneExecutions;
    const tabsExecutionsBeforeInsertion = tabsExecutions;
    fireEvent.click(button);

    expect(onChange).toHaveBeenCalledTimes(2);
    const paragraphId = fixture.editor.getChildBlockIds(paneId)[0]!;
    expect(fixture.editor.getBlock(paragraphId)?.type).toBe("paragraph");
    expect(pane.querySelector(".empty-wrapper-add-text-button")).toBeNull();
    expect(document.activeElement).toBe(
      pane.querySelector('[data-editor-text-root="true"]'),
    );
    expect(paneExecutions).toBe(executionsBeforeInsertion);
    expect(tabsExecutions).toBe(tabsExecutionsBeforeInsertion);

    const publications = onChange.mock.calls.length;
    fireEvent.click(pills(fixture.tabsShell)[0]!);
    expect(pane.hidden).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(publications);
    fireEvent.click(pills(fixture.tabsShell).at(-1)!);
    expect(pane.hidden).toBe(false);
    expect(onChange).toHaveBeenCalledTimes(publications);

    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getChildBlockIds(paneId)).toEqual([]);
    expect(pane.querySelector(".empty-wrapper-add-text-button")).not.toBeNull();
    expect(paneExecutions).toBe(executionsBeforeInsertion);
    expect(tabsExecutions).toBe(tabsExecutionsBeforeInsertion);
    expect(
      fixture.tabsShell.querySelector(
        `[data-editor-block-id="${paneId}"]`,
      ),
    ).toBe(paneShell);
    act(() => expect(fixture.editor.undo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getBlock(paneId)).toBeNull();
    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getChildBlockIds(paneId)).toEqual([]);
    act(() => expect(fixture.editor.redo()).toEqual({ status: "applied" }));
    expect(fixture.editor.getChildBlockIds(paneId)).toEqual([paragraphId]);
  });

  it("disables deletion for the final pane without dispatching", () => {
    const onChange = vi.fn();
    const fixture = renderTabs({ onChange });
    expect(
      fixture.editor.deleteBlock({ blockId: id("fd-tab-details") }).ok,
    ).toBe(true);
    expect(
      fixture.editor.deleteBlock({ blockId: id("fd-tab-collaboration") }).ok,
    ).toBe(true);
    onChange.mockClear();
    const only = pills(fixture.tabsShell)[0]!;
    openMenu(only);
    const action = document.querySelector<HTMLButtonElement>(
      '[data-action="delete"]',
    )!;
    expect(action.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(action);
    expect(onChange).not.toHaveBeenCalled();
    expect(fixture.editor.getChildBlockIds(id("fd-tabs"))).toEqual([
      id("fd-tab-overview"),
    ]);
  });

  it.each([
    {
      name: "below",
      rect: domRect(80, 40, 100, 40),
      placement: "bottom",
      available: 506,
    },
    {
      name: "above",
      rect: domRect(80, 500, 100, 40),
      placement: "top",
      available: 486,
    },
    {
      name: "below on a tie",
      rect: domRect(80, 280, 100, 40),
      placement: "bottom",
      available: 266,
    },
  ])(
    "positions $name using the greater usable space",
    ({ rect, placement, available }) => {
      const fixture = renderTabs();
      flushAnimationFrames();
      const trigger = pills(fixture.tabsShell)[0]!;
      elementBounds.set(trigger, rect);
      openMenu(trigger);
      flushAnimationFrames();
      const menu = document.getElementById(fixture.store.menuId)!;
      expect(menu.dataset.placement).toBe(placement);
      expect(
        menu.style.getPropertyValue(
          "--first-draft-tabs-menu-available-block-size",
        ),
      ).toBe(`${available}px`);
    },
  );

  it("intersects its boundary and repositions on scroll and resize observation", () => {
    const fixture = renderTabs();
    flushAnimationFrames();
    const trigger = pills(fixture.tabsShell)[0]!;
    const boundary = fixture.container.querySelector<HTMLElement>(
      ".first-draft-example__document-scroll",
    )!;
    documentBounds = domRect(0, 100, 800, 400);
    elementBounds.set(trigger, domRect(80, 400, 100, 40));
    openMenu(trigger);
    flushAnimationFrames();
    const menu = document.getElementById(fixture.store.menuId)!;
    expect(menu.dataset.placement).toBe("top");
    expect(
      menu.style.getPropertyValue(
        "--first-draft-tabs-menu-available-block-size",
      ),
    ).toBe("286px");
    expect(
      resizeObservers.some((observer) => observer.targets.has(boundary)),
    ).toBe(true);

    elementBounds.set(trigger, domRect(80, 120, 100, 40));
    fireEvent.scroll(boundary);
    flushAnimationFrames();
    expect(document.getElementById(fixture.store.menuId)).toBe(menu);
    expect(menu.dataset.placement).toBe("bottom");

    elementBounds.set(trigger, domRect(80, 420, 100, 40));
    fixture.bumpGeometry();
    flushAnimationFrames();
    expect(menu.dataset.placement).toBe("top");

    elementBounds.set(trigger, domRect(80, 120, 100, 40));
    const observer = resizeObservers.find((candidate) =>
      candidate.targets.has(boundary),
    )!;
    act(() => {
      observer.callback([], observer);
    });
    flushAnimationFrames();
    expect(menu.dataset.placement).toBe("bottom");
  });
});

class TestResizeObserver implements ResizeObserver {
  readonly targets = new Set<Element>();
  constructor(readonly callback: ResizeObserverCallback) {}
  observe(target: Element): void {
    this.targets.add(target);
  }
  unobserve(target: Element): void {
    this.targets.delete(target);
  }
  disconnect(): void {
    this.targets.clear();
  }
}

function flushAnimationFrames(): void {
  act(() => {
    while (animationFrames.length > 0) {
      const frames = animationFrames.splice(0);
      for (const frame of frames) frame(0);
    }
  });
}

function domRect(
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({}),
  };
}
