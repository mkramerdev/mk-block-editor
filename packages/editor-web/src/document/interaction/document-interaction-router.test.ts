import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerDocumentInteractionOwner,
  type DocumentInteractionOwner,
} from "./document-interaction-router.ts";

describe("document interaction router", () => {
  afterEach(() => {
    document.body.replaceChildren();
    document.getSelection()?.removeAllRanges();
  });

  it("routes keyboard and captured pointer events to exactly one editor", () => {
    const first = appendEditor("first");
    const second = appendEditor("second");
    const external = document.createElement("input");
    document.body.append(external);
    const firstOwner = owner(first.list);
    const secondOwner = owner(second.list);
    const unregisterFirst = registerDocumentInteractionOwner(
      document,
      firstOwner,
    );
    const unregisterSecond = registerDocumentInteractionOwner(
      document,
      secondOwner,
    );

    first.editable.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
    );
    expect(firstOwner.keydown).toHaveBeenCalledOnce();
    expect(secondOwner.keydown).not.toHaveBeenCalled();

    external.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
    );
    expect(firstOwner.keydown).toHaveBeenCalledOnce();
    expect(secondOwner.keydown).not.toHaveBeenCalled();

    second.editable.dispatchEvent(pointerEvent("pointerdown", 7));
    first.editable.dispatchEvent(pointerEvent("pointermove", 7));
    document.body.dispatchEvent(pointerEvent("pointerup", 7));
    expect(firstOwner.pointerdown).not.toHaveBeenCalled();
    expect(firstOwner.pointermove).not.toHaveBeenCalled();
    expect(secondOwner.pointerdown).toHaveBeenCalledOnce();
    expect(secondOwner.pointermove).toHaveBeenCalledOnce();
    expect(secondOwner.pointerup).toHaveBeenCalledOnce();

    unregisterSecond();
    unregisterFirst();
  });

  it("retains the active editor for BODY keyboard events after its focused projection disappears", () => {
    const editor = appendEditor("editor");
    const editorOwner = owner(editor.list);
    const unregister = registerDocumentInteractionOwner(document, editorOwner);

    editor.editable.dispatchEvent(pointerEvent("pointerdown", 1));
    editor.editable.remove();
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "y",
        ctrlKey: true,
        bubbles: true,
      }),
    );

    expect(editorOwner.keydown).toHaveBeenCalledOnce();
    unregister();
  });

  it("transfers explicit ownership and releases the previous interaction", () => {
    const first = appendEditor("first");
    const second = appendEditor("second");
    const firstOwner = owner(first.list);
    const secondOwner = owner(second.list);
    const unregisterFirst = registerDocumentInteractionOwner(
      document,
      firstOwner,
    );
    const unregisterSecond = registerDocumentInteractionOwner(
      document,
      secondOwner,
    );

    first.editable.dispatchEvent(pointerEvent("pointerdown", 1));
    second.editable.dispatchEvent(pointerEvent("pointerdown", 2));

    expect(firstOwner.releaseInteraction).toHaveBeenCalledOnce();
    expect(secondOwner.releaseInteraction).not.toHaveBeenCalled();
    second.editable.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(firstOwner.keydown).not.toHaveBeenCalled();
    expect(secondOwner.keydown).toHaveBeenCalledOnce();

    unregisterSecond();
    unregisterFirst();
  });

  it("lets a scoped control establish ownership while leaving ordinary control keys native", () => {
    const editor = appendEditor("editor");
    const button = document.createElement("button");
    editor.list.parentElement?.prepend(button);
    const editorOwner = owner(editor.list);
    const unregister = registerDocumentInteractionOwner(document, editorOwner);

    button.dispatchEvent(pointerEvent("pointerdown", 1));
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }),
    );

    expect(editorOwner.pointerdown).toHaveBeenCalledOnce();
    expect(editorOwner.keydown).toHaveBeenCalledOnce();
    expect(editorOwner.releaseInteraction).not.toHaveBeenCalled();
    unregister();
  });

  it("releases interaction ownership for controls outside the declared scope", () => {
    const editor = appendEditor("editor");
    const external = document.createElement("button");
    document.body.append(external);
    const editorOwner = owner(editor.list);
    const unregister = registerDocumentInteractionOwner(document, editorOwner);

    editor.editable.dispatchEvent(pointerEvent("pointerdown", 1));
    external.dispatchEvent(pointerEvent("pointerdown", 2));
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );

    expect(editorOwner.releaseInteraction).toHaveBeenCalledOnce();
    expect(editorOwner.keydown).not.toHaveBeenCalled();
    unregister();
  });

  it("routes native history beforeinput only to the target editor", () => {
    const first = appendEditor("first");
    const second = appendEditor("second");
    const firstOwner = owner(first.list);
    const secondOwner = owner(second.list);
    const unregisterFirst = registerDocumentInteractionOwner(
      document,
      firstOwner,
    );
    const unregisterSecond = registerDocumentInteractionOwner(
      document,
      secondOwner,
    );

    first.editable.dispatchEvent(beforeInput("historyUndo"));

    expect(firstOwner.beforeinput).toHaveBeenCalledOnce();
    expect(secondOwner.beforeinput).not.toHaveBeenCalled();
    unregisterSecond();
    unregisterFirst();
  });

  it("routes captured scroll from an external ancestor to the active pointer owner", () => {
    const editor = appendEditor("editor");
    const editorOwner = owner(editor.list);
    const unregister = registerDocumentInteractionOwner(document, editorOwner);

    editor.editable.dispatchEvent(pointerEvent("pointerdown", 31));
    editor.list.parentElement?.dispatchEvent(new Event("scroll"));

    expect(editorOwner.scroll).toHaveBeenCalledOnce();
    unregister();
  });
});

function appendEditor(label: string): {
  readonly list: HTMLElement;
  readonly editable: HTMLElement;
} {
  const scope = document.createElement("section");
  scope.dataset.editorInteractionScope = "true";
  const list = document.createElement("div");
  list.dataset.editorBlockListRoot = "true";
  const editable = document.createElement("div");
  editable.contentEditable = "true";
  editable.textContent = label;
  list.append(editable);
  scope.append(list);
  document.body.append(scope);
  return { list, editable };
}

function owner(list: HTMLElement): DocumentInteractionOwner {
  return {
    list,
    releaseInteraction: vi.fn(),
    pointerdown: vi.fn(),
    pointermove: vi.fn(),
    pointerup: vi.fn(),
    pointercancel: vi.fn(),
    beforeinput: vi.fn(),
    keydown: vi.fn(),
    keyup: vi.fn(),
    scroll: vi.fn(),
  };
}

function beforeInput(inputType: "historyUndo" | "historyRedo"): InputEvent {
  return new InputEvent("beforeinput", {
    inputType,
    bubbles: true,
    cancelable: true,
  });
}

function pointerEvent(type: string, pointerId: number): PointerEvent {
  const event = new Event(type, { bubbles: true }) as PointerEvent;
  Object.defineProperty(event, "pointerId", { value: pointerId });
  return event;
}
