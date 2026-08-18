import { createElement, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { EditorImplementation } from "@repo/editor-react/editor";
import { useWebFocusAdapters } from "../document/focus/use-web-focus-adapters.ts";

describe("web focus adapters", () => {
  it("does not convert blank list space into block or text focus", () => {
    const editor = {
      focusBlock: vi.fn(),
      focusText: vi.fn(),
      blurEditor: vi.fn(),
      ownsNativeFocusTarget: vi.fn(() => false),
      ownsActiveElement: vi.fn(() => false),
    } as unknown as EditorImplementation;
    render(createElement(FocusLifecycleHarness, { editor }));

    fireEvent.mouseDown(screen.getByTestId("focus-lifecycle-list"), {
      button: 0,
    });

    expect(editor.focusBlock).not.toHaveBeenCalled();
    expect(editor.focusText).not.toHaveBeenCalled();
  });

  it("blurs through hidden lifecycle boundaries but stays inert on refocus", () => {
    const blurEditor = vi.fn();
    const editor = {
      blurEditor,
      ownsNativeFocusTarget: vi.fn(() => false),
      ownsActiveElement: vi.fn(() => false),
    } as unknown as EditorImplementation;
    const rendered = render(createElement(FocusLifecycleHarness, { editor }));
    const originalVisibility = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );

    window.dispatchEvent(new Event("blur"));
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("pagehide"));
    fireEvent.wheel(screen.getByTestId("focus-lifecycle-list"));

    expect(blurEditor).toHaveBeenCalledTimes(3);

    blurEditor.mockClear();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    expect(blurEditor).not.toHaveBeenCalled();

    rendered.unmount();
    expect(blurEditor).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("pagehide"));
    expect(blurEditor).not.toHaveBeenCalled();

    if (originalVisibility) {
      Object.defineProperty(document, "visibilityState", originalVisibility);
    } else {
      delete (document as unknown as { visibilityState?: string })
        .visibilityState;
    }
  });

  it("releases editor-owned text focus through the editor lifecycle at the window-blur boundary", () => {
    const blurEditor = vi.fn();
    const editor = {
      blurEditor,
      ownsNativeFocusTarget: vi.fn(() => false),
      ownsActiveElement: vi.fn(() => false),
    } as unknown as EditorImplementation;
    render(createElement(FocusLifecycleHarness, { editor }));
    const textRoot = screen.getByTestId("focus-lifecycle-text-root");
    blurEditor.mockImplementation(() => textRoot.blur());

    textRoot.focus();
    expect(document.activeElement).toBe(textRoot);

    window.dispatchEvent(new Event("blur"));

    expect(blurEditor).toHaveBeenCalledOnce();
    expect(
      screen
        .getByTestId("focus-lifecycle-list")
        .contains(document.activeElement),
    ).toBe(false);
  });

  it("does not release native focus owned by external or block-internal controls", () => {
    const editor = {
      blurEditor: vi.fn(),
      ownsNativeFocusTarget: vi.fn(() => false),
      ownsActiveElement: vi.fn(() => false),
      selectionController: {
        getCanonicalSnapshot: vi.fn(() => ({ kind: "none" })),
      },
    } as unknown as EditorImplementation;
    render(createElement(FocusLifecycleHarness, { editor }));
    const external = document.createElement("input");
    document.body.append(external);

    external.focus();
    window.dispatchEvent(new Event("blur"));
    expect(document.activeElement).toBe(external);

    const internalControl = screen.getByTestId("focus-lifecycle-control");
    internalControl.focus();
    window.dispatchEvent(new Event("blur"));
    expect(document.activeElement).toBe(internalControl);
    external.remove();
  });

  it("keeps editor-owned UI focus inside the interaction scope without registering an atomic target", () => {
    const blurEditor = vi.fn();
    const editor = {
      blurEditor,
      ownsNativeFocusTarget: vi.fn(() => false),
      ownsActiveElement: vi.fn(() => false),
    } as unknown as EditorImplementation;
    render(createElement(FocusLifecycleHarness, { editor }));
    const list = screen.getByTestId("focus-lifecycle-list");
    const input = screen.getByTestId(
      "focus-lifecycle-editor-ui",
    ) as HTMLInputElement;

    input.focus();
    input.value = "https://first-draft.test/path";
    input.setSelectionRange(8, 19);
    fireEvent.blur(list, { relatedTarget: input });

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(8);
    expect(input.selectionEnd).toBe(19);
    expect(blurEditor).not.toHaveBeenCalled();

    const title = screen.getByTestId("focus-lifecycle-editor-ui-title");
    title.focus();
    fireEvent.blur(list, { relatedTarget: title });
    expect(document.activeElement).toBe(title);
    expect(blurEditor).not.toHaveBeenCalled();

    const external = document.createElement("input");
    document.body.append(external);
    fireEvent.blur(list, { relatedTarget: external });
    expect(blurEditor).toHaveBeenCalledOnce();
    external.remove();
  });
});

function FocusLifecycleHarness({
  editor,
}: {
  readonly editor: EditorImplementation;
}) {
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const focus = useWebFocusAdapters({
    editor,
    listElement,
  });
  return createElement(
    "div",
    {
      "data-editor-interaction-scope": "true",
    },
    createElement(
      "div",
      {
        ref: setListElement,
        onBlur: focus.handleListBlur,
        "data-testid": "focus-lifecycle-list",
      },
      createElement("div", {
        contentEditable: true,
        "data-editor-text-root": "true",
        "data-testid": "focus-lifecycle-text-root",
      }),
      createElement("button", {
        type: "button",
        "data-testid": "focus-lifecycle-control",
      }),
      createElement(
        "div",
        { "data-editor-ui": "true" },
        createElement("input", {
          "data-testid": "focus-lifecycle-editor-ui",
        }),
        createElement("input", {
          "data-testid": "focus-lifecycle-editor-ui-title",
        }),
      ),
    ),
  );
}
