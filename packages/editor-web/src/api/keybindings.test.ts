import { describe, expect, it, vi } from "vitest";
import {
  EDITOR_REDO_COMMAND_ID,
  EDITOR_UNDO_COMMAND_ID,
} from "@repo/editor-react/editor";
import { conventionalHistoryKeybindings } from "./keybindings.ts";

describe("conventional history keybinding data", () => {
  it("is immutable declarative data with no installation side effects", () => {
    expect(conventionalHistoryKeybindings).toEqual([
      {
        key: "Mod-z",
        commandId: EDITOR_UNDO_COMMAND_ID,
        scope: "document",
      },
      {
        key: "Shift-Mod-z",
        commandId: EDITOR_REDO_COMMAND_ID,
        scope: "document",
      },
      {
        key: "Mod-y",
        commandId: EDITOR_REDO_COMMAND_ID,
        scope: "document",
      },
    ]);
    expect(Object.isFrozen(conventionalHistoryKeybindings)).toBe(true);
    expect(
      conventionalHistoryKeybindings.every((binding) =>
        Object.isFrozen(binding),
      ),
    ).toBe(true);
    expect(
      conventionalHistoryKeybindings.every(
        (binding) =>
          typeof binding.key === "string" &&
          typeof binding.commandId === "string" &&
          binding.scope === "document" &&
          Object.values(binding).every((value) => typeof value === "string"),
      ),
    ).toBe(true);
  });

  it("does not install listeners when the entrypoint is imported", async () => {
    const documentListeners = vi.spyOn(document, "addEventListener");
    const windowListeners = vi.spyOn(window, "addEventListener");
    const documentCalls = documentListeners.mock.calls.length;
    const windowCalls = windowListeners.mock.calls.length;
    vi.resetModules();

    await import("./keybindings.ts");

    expect(documentListeners).toHaveBeenCalledTimes(documentCalls);
    expect(windowListeners).toHaveBeenCalledTimes(windowCalls);
    documentListeners.mockRestore();
    windowListeners.mockRestore();
  });
});
