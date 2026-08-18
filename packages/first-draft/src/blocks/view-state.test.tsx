import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  createFirstDraftViewStateStore,
  FirstDraftViewStateProvider,
  useCollapsed,
  useSelectedTab,
} from "./view-state.tsx";

describe("First Draft view state provider", () => {
  it("fails fast when a view-state hook is used without its provider", () => {
    expect(() => renderHook(() => useSelectedTab("tabs" as BlockId))).toThrow(
      "First Draft view-state provider is missing",
    );
  });

  it("reads required provider state without fallback snapshots", () => {
    const store = createFirstDraftViewStateStore({
      selectedTabs: { ["tabs" as BlockId]: "selected" as BlockId },
      collapsedBlockIds: ["toggle" as BlockId],
    });
    const wrapper = ({ children }: { readonly children: React.ReactNode }) => (
      <FirstDraftViewStateProvider store={store}>
        {children}
      </FirstDraftViewStateProvider>
    );

    expect(
      renderHook(() => useSelectedTab("tabs" as BlockId), { wrapper }).result
        .current,
    ).toBe("selected");
    expect(
      renderHook(() => useCollapsed("toggle" as BlockId), { wrapper }).result
        .current[0],
    ).toBe(true);
  });
});
