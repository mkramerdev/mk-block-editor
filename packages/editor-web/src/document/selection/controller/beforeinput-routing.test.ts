import { describe, expect, it } from "vitest";
import { readCommittedSelectionTextFromBeforeInput } from "./committed-selection-text-input.ts";

function input(
  inputType: string,
  data: string | null,
  options: { readonly composing?: boolean } = {},
): InputEvent {
  return new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    data,
    inputType,
    isComposing: options.composing ?? false,
  });
}

describe("committed-selection beforeinput routing", () => {
  it.each([
    ["insertText", "plain"],
    ["insertReplacementText", "replacement"],
    ["insertFromDictation", "dictated"],
  ])("routes %s as semantic text", (inputType, text) => {
    expect(
      readCommittedSelectionTextFromBeforeInput(input(inputType, text)),
    ).toBe(text);
  });

  it.each([
    ["insertCompositionText", "draft", true],
    ["insertFromComposition", "composed", false],
    ["insertFromPaste", "pasted", false],
  ])("leaves %s to its single browser owner", (inputType, text, composing) => {
    expect(
      readCommittedSelectionTextFromBeforeInput(
        input(inputType, text, { composing }),
      ),
    ).toBeNull();
  });

  it("does not claim an event another browser adapter already accepted", () => {
    const event = input("insertReplacementText", "replacement");
    event.preventDefault();
    expect(readCommittedSelectionTextFromBeforeInput(event)).toBeNull();
  });
});
