import { describe, expect, it } from "vitest";
import { createEditorExternalStore } from "./external-store.ts";
import { createInitialEditorSessionState } from "./session-state.ts";

describe("editor store ownership split", () => {
  it("keeps the session store free of manifest block ownership", () => {
    const store = createEditorExternalStore(
      createInitialEditorSessionState({
        blockGraphVersion: 4,
      }),
    );

    expect(store.getSnapshot()).not.toHaveProperty("blocks");
    expect(store.getSnapshot()).not.toHaveProperty("blockOrder");
    expect(store.getSnapshot()).not.toHaveProperty("drag");
    expect(store.getSnapshot().blockGraphVersion).toBe(4);
  });

  it("contains no native-focus or semantic-selection state", () => {
    const store = createEditorExternalStore(
      createInitialEditorSessionState({}),
    );
    const snapshot = store.getSnapshot();

    expect(snapshot).not.toHaveProperty(["native", "Focus"].join(""));
    expect(snapshot).not.toHaveProperty(["canonical", "Selection"].join(""));
    expect(Object.keys(snapshot)).toEqual([
      "blockGraphVersion",
      "createdAt",
      "updatedAt",
    ]);
  });

  it("does not create editor-level selection fields", () => {
    const store = createEditorExternalStore(
      createInitialEditorSessionState({}),
    );

    expect(store.getSnapshot()).not.toHaveProperty("selection");
    expect(store.getSnapshot()).not.toHaveProperty(
      ["selection", "Runtime"].join(""),
    );
  });

  it("does not store derived projected row state", () => {
    const store = createEditorExternalStore(
      createInitialEditorSessionState({}),
    );

    expect(store.getSnapshot()).not.toHaveProperty("projectedRows");
    expect(store.getSnapshot()).not.toHaveProperty("visibleBlockIds");
    expect(store.getSnapshot()).not.toHaveProperty("liveBlockIds");
  });
});
