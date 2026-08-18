import { describe, expect, it } from "vitest";
import { LocalTypingProvenanceBridge } from "./local-typing-provenance-bridge.ts";

describe("LocalTypingProvenanceBridge", () => {
  it("retains trusted typing through microtasks and consumes it once", async () => {
    const bridge = new LocalTypingProvenanceBridge();

    bridge.captureBeforeInput(beforeInput("@", "insertText"));
    await Promise.resolve();
    await Promise.resolve();

    expect(bridge.consume()).toEqual({
      kind: "typing",
      text: "@",
      inputType: "text",
    });
    expect(bridge.consume()).toBeNull();
  });

  it("keeps only the newest accepted edge and maps supported input types", () => {
    const bridge = new LocalTypingProvenanceBridge();
    bridge.captureBeforeInput(beforeInput("a", "insertText"));
    bridge.captureBeforeInput(beforeInput("b", "insertReplacementText"));
    bridge.captureBeforeInput(beforeInput("c", "insertFromDictation"));

    expect(bridge.consume()).toEqual({
      kind: "typing",
      text: "c",
      inputType: "dictation",
    });
  });

  it("ignores untrusted, prevented, composing, empty, and unsupported input", () => {
    const bridge = new LocalTypingProvenanceBridge();
    bridge.captureBeforeInput(
      beforeInput("@", "insertText", { trusted: false }),
    );
    bridge.captureBeforeInput(
      beforeInput("@", "insertText", { prevented: true }),
    );
    bridge.captureBeforeInput(
      beforeInput("@", "insertText", { composing: true }),
    );
    bridge.captureBeforeInput(beforeInput("", "insertText"));
    bridge.captureBeforeInput(beforeInput("@", "deleteContentBackward"));

    expect(bridge.consume()).toBeNull();
  });

  it("clears pending state on disposal", () => {
    const bridge = new LocalTypingProvenanceBridge();
    bridge.captureBeforeInput(beforeInput("@", "insertText"));
    bridge.dispose();

    expect(bridge.consume()).toBeNull();
  });
});

function beforeInput(
  data: string,
  inputType: string,
  options: {
    readonly trusted?: boolean;
    readonly prevented?: boolean;
    readonly composing?: boolean;
  } = {},
): InputEvent {
  return {
    data,
    inputType,
    isTrusted: options.trusted ?? true,
    defaultPrevented: options.prevented ?? false,
    isComposing: options.composing ?? false,
  } as InputEvent;
}
