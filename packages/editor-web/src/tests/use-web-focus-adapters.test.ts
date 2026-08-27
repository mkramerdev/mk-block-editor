import { createElement, useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { asContentVersion, type BlockId } from "@repo/editor-core/kernel";
import { contentSelection } from "@repo/editor-core/selection";
import {
  createEditorLogicalSelectionPoint,
  createEditorSelectionTextAnchor,
  createSelectionController,
  type EditorSelectionGraphReader,
} from "@repo/editor-react/selection";
import { describe, expect, it, vi } from "vitest";
import {
  useWebFocusAdapters,
  type WebFocusAdaptersOptions,
} from "../document/focus/use-web-focus-adapters.ts";

describe("web focus adapters", () => {
  it("does not convert blank list space into block or text focus", () => {
    const editor = {
      focusBlock: vi.fn(),
      focusText: vi.fn(),
      blurEditor: vi.fn(),
      resolveNativeFocusTarget: vi.fn(() => null),
    };
    render(createElement(FocusLifecycleHarness, { editor }));

    fireEvent.mouseDown(screen.getByTestId("focus-lifecycle-list"), {
      button: 0,
    });

    expect(editor.focusBlock).not.toHaveBeenCalled();
    expect(editor.focusText).not.toHaveBeenCalled();
  });

  it("releases composition without blurring through lifecycle boundaries or refocusing", () => {
    const blurEditor = vi.fn();
    const releaseComposition = vi.fn();
    const editor = {
      blurEditor,
      resolveNativeFocusTarget: vi.fn(() => null),
    };
    const rendered = render(
      createElement(FocusLifecycleHarness, {
        editor,
        releaseComposition,
      }),
    );
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

    expect(releaseComposition).toHaveBeenCalledTimes(3);
    expect(blurEditor).not.toHaveBeenCalled();

    releaseComposition.mockClear();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    expect(blurEditor).not.toHaveBeenCalled();
    expect(releaseComposition).not.toHaveBeenCalled();

    rendered.unmount();
    expect(blurEditor).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("pagehide"));
    expect(blurEditor).not.toHaveBeenCalled();
    expect(releaseComposition).not.toHaveBeenCalled();

    if (originalVisibility) {
      Object.defineProperty(document, "visibilityState", originalVisibility);
    } else {
      delete (document as unknown as { visibilityState?: string })
        .visibilityState;
    }
  });

  it("preserves active text focus, native caret, and canonical selection across tab lifecycle", () => {
    const blurEditor = vi.fn();
    const releaseComposition = vi.fn();
    const editor = {
      blurEditor,
      resolveNativeFocusTarget: vi.fn((target: EventTarget | null) => {
        const textRoot = screen.queryByTestId("focus-lifecycle-text-root");
        return target === textRoot && textRoot instanceof HTMLElement
          ? resolvedFocus(textRoot)
          : null;
      }),
    } satisfies WebFocusAdaptersOptions["editor"];
    const rendered = render(
      createElement(FocusLifecycleHarness, {
        editor,
        releaseComposition,
      }),
    );
    const textRoot = screen.getByTestId("focus-lifecycle-text-root");
    const text = textRoot.firstChild;
    if (!(text instanceof Text)) throw new Error("Missing focus fixture text");
    const selectionController = createSelectionController();
    const point = testSelectionPoint();
    selectionController.commitSelectionPoint(point, selectionGraph, 1, {
      publication: { kind: "silent" },
      cause: "focus",
    });
    const canonical = selectionController.getCanonicalSnapshot();
    const publications = vi.fn();
    selectionController.subscribeStandaloneSettlements(publications);
    const focus = vi.spyOn(textRoot as HTMLElement, "focus");
    const native = document.getSelection();
    const range = document.createRange();
    range.setStart(text, 3);
    range.collapse(true);

    (textRoot as HTMLElement).focus();
    native?.removeAllRanges();
    native?.addRange(range);
    focus.mockClear();
    expect(document.activeElement).toBe(textRoot);
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

    expect(releaseComposition).toHaveBeenCalledTimes(3);
    expect(blurEditor).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(textRoot);
    expect(native?.anchorNode).toBe(text);
    expect(native?.anchorOffset).toBe(3);
    expect(native?.focusNode).toBe(text);
    expect(native?.focusOffset).toBe(3);
    expect(selectionController.getCanonicalSnapshot()).toBe(canonical);
    expect(publications).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));

    expect(focus).not.toHaveBeenCalled();
    expect(blurEditor).not.toHaveBeenCalled();
    expect(selectionController.getCanonicalSnapshot()).toBe(canonical);
    expect(publications).not.toHaveBeenCalled();

    rendered.unmount();
    selectionController.dispose();
    native?.removeAllRanges();
    if (originalVisibility) {
      Object.defineProperty(document, "visibilityState", originalVisibility);
    } else {
      delete (document as unknown as { visibilityState?: string })
        .visibilityState;
    }
  });

  it("does not release native focus owned by external or block-internal controls", () => {
    const editor = {
      blurEditor: vi.fn(),
      resolveNativeFocusTarget: vi.fn(() => null),
    } satisfies WebFocusAdaptersOptions["editor"];
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
      resolveNativeFocusTarget: vi.fn(() => null),
    } satisfies WebFocusAdaptersOptions["editor"];
    render(createElement(FocusLifecycleHarness, { editor }));
    const list = screen.getByTestId("focus-lifecycle-list");
    const input = screen.getByTestId(
      "focus-lifecycle-editor-ui",
    ) as HTMLInputElement;

    input.focus();
    input.value = "https://editor-example.test/path";
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
    fireEvent.focusOut(list, { relatedTarget: external });
    expect(blurEditor).toHaveBeenCalledOnce();
    external.remove();
  });
});

function FocusLifecycleHarness({
  editor,
  releaseComposition,
}: {
  readonly editor: WebFocusAdaptersOptions["editor"];
  readonly releaseComposition?: () => void;
}) {
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const focus = useWebFocusAdapters({
    editor,
    listElement,
    releaseComposition,
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
      createElement(
        "div",
        {
          contentEditable: true,
          "data-editor-text-root": "true",
          "data-testid": "focus-lifecycle-text-root",
        },
        "hello",
      ),
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

const selectionGraph: EditorSelectionGraphReader = {
  getBlock: (blockId) =>
    blockId === ("text" as BlockId)
      ? {
          id: blockId,
          type: "textBlock",
          parentId: null,
          tombstone: null,
          metadataVersion: "1",
          contentVersion: asContentVersion("1"),
        }
      : null,
  getParentId: () => null,
  getRootBlockIds: () => ["text" as BlockId],
  getChildBlockIds: () => [],
  readBlockSelectionModel: () => contentSelection(),
};

function testSelectionPoint() {
  const anchor = createEditorSelectionTextAnchor({
    codec: "focus-lifecycle-test",
    payload: { encoded: "Mw==", assoc: 0 },
  });
  if (!anchor.ok) throw new Error(anchor.message);
  const point = createEditorLogicalSelectionPoint({
    graph: selectionGraph,
    blockId: "text" as BlockId,
    textOffset: 3,
    textAnchor: anchor.textAnchor,
  });
  if (!point) throw new Error("Missing focus fixture selection point");
  return point;
}

function resolvedFocus(target: HTMLElement) {
  return {
    kind: "text" as const,
    blockId: "text" as BlockId,
    registeredTarget: target,
  };
}
