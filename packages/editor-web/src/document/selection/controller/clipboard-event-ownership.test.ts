import { describe, expect, it } from "vitest";
import type { CommittedSelectionSnapshot } from "@repo/editor-react/selection";
import {
  claimEditorClipboardEvent,
  resolveEditorClipboardEventOwnership,
} from "./clipboard-event-ownership.ts";

describe("editor clipboard event ownership", () => {
  it("routes a current canonical selection only from an exact native target", () => {
    const list = document.createElement("div");
    const target = document.createElement("div");
    list.append(target);
    const selection = {} as CommittedSelectionSnapshot;

    expect(
      resolveEditorClipboardEventOwnership({
        event: eventFromPath(target, list),
        editorIdentity: {},
        list,
        committedSelection: selection,
        isCommittedSelectionCurrent: (candidate) => candidate === selection,
        ownsNativeTarget: (candidate) => candidate === target,
        ownsActiveElement: () => false,
      }),
    ).toEqual({ kind: "selection", selection });
  });

  it("routes structural editor gestures from the owning block list", () => {
    const list = document.createElement("div");
    const structuralHandle = document.createElement("div");
    list.append(structuralHandle);
    const selection = {} as CommittedSelectionSnapshot;

    expect(
      resolveEditorClipboardEventOwnership({
        event: eventFromPath(structuralHandle, list),
        editorIdentity: {},
        list,
        committedSelection: selection,
        isCommittedSelectionCurrent: (candidate) => candidate === selection,
        ownsNativeTarget: () => false,
        ownsActiveElement: () => false,
      }),
    ).toEqual({ kind: "selection", selection });
  });

  it("allows only the first editor to claim one event", () => {
    const event = new Event("paste");
    const first = {};
    const second = {};
    expect(claimEditorClipboardEvent(event, first)).toBe(true);
    expect(claimEditorClipboardEvent(event, first)).toBe(true);
    expect(claimEditorClipboardEvent(event, second)).toBe(false);
  });

  it.each(["input", "textarea", "select"])(
    "does not intercept an external %s despite retained selection",
    (tagName) => {
      const list = document.createElement("div");
      const control = document.createElement(tagName);
      const selection = {} as CommittedSelectionSnapshot;
      expect(
        resolveEditorClipboardEventOwnership({
          event: eventFromPath(control),
          editorIdentity: {},
          list,
          committedSelection: selection,
          isCommittedSelectionCurrent: () => true,
          ownsNativeTarget: () => false,
          ownsActiveElement: () => false,
        }),
      ).toEqual({ kind: "none" });
    },
  );

  it("does not capture editor UI or an unrelated contenteditable control", () => {
    const list = document.createElement("div");
    const chrome = document.createElement("button");
    chrome.dataset.editorUi = "true";
    const unrelated = document.createElement("div");
    unrelated.contentEditable = "true";
    const selection = {} as CommittedSelectionSnapshot;
    list.append(chrome, unrelated);
    for (const target of [chrome, unrelated]) {
      expect(
        resolveEditorClipboardEventOwnership({
          event: eventFromPath(target, list),
          editorIdentity: {},
          list,
          committedSelection: selection,
          isCommittedSelectionCurrent: () => true,
          ownsNativeTarget: () => false,
          ownsActiveElement: () => false,
        }),
      ).toEqual({ kind: "none" });
    }
  });

  it("uses a shadow-DOM composed path for exact ownership", () => {
    const host = document.createElement("div");
    const shadow = host.attachShadow({ mode: "open" });
    const list = document.createElement("div");
    const target = document.createElement("span");
    const selection = {} as CommittedSelectionSnapshot;
    shadow.append(list);
    list.append(target);

    expect(
      resolveEditorClipboardEventOwnership({
        event: eventFromPath(target, list, shadow, host),
        editorIdentity: {},
        list,
        committedSelection: selection,
        isCommittedSelectionCurrent: () => true,
        ownsNativeTarget: (candidate) => candidate === target,
        ownsActiveElement: () => false,
      }),
    ).toEqual({ kind: "selection", selection });
  });
});

function eventFromPath(target: EventTarget, ...path: EventTarget[]): Event {
  const event = new Event("paste", { bubbles: true, composed: true });
  Object.defineProperties(event, {
    target: { value: target },
    composedPath: { value: () => [target, ...path] },
  });
  return event;
}
