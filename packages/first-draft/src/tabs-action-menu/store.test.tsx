import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  createFirstDraftTabsActionUiStore,
  FirstDraftTabsActionUiProvider,
  useFirstDraftTabsActionUiSnapshot,
} from "./store.tsx";

const id = (value: string) => value as BlockId;

afterEach(cleanup);

describe("First Draft tabs action UI store", () => {
  it("publishes isolated open, rename, and closed transitions", () => {
    const first = createFirstDraftTabsActionUiStore();
    const second = createFirstDraftTabsActionUiStore();
    const trigger = document.body.appendChild(document.createElement("button"));
    const renders: string[] = [];
    function Observer() {
      const snapshot = useFirstDraftTabsActionUiSnapshot();
      renders.push(snapshot.kind);
      return <span>{snapshot.kind}</span>;
    }
    render(
      <FirstDraftTabsActionUiProvider store={first}>
        <Observer />
      </FirstDraftTabsActionUiProvider>,
    );

    act(() => {
      expect(
        first.openMenu({
          kind: "open",
          tabsId: id("tabs"),
          paneId: id("pane"),
          triggerElement: trigger,
        }),
      ).toBe(true);
    });
    expect(screen.getByText("open")).toBeDefined();
    expect(second.getSnapshot().kind).toBe("closed");
    expect(first.menuId).not.toBe(second.menuId);
    act(() => {
      expect(
        first.beginRename({
          kind: "rename",
          tabsId: id("tabs"),
          paneId: id("pane"),
          initialCanonicalTitle: "Current",
          initialDisplayedTitle: "Current",
        }),
      ).toBe(true);
    });
    expect(screen.getByText("rename")).toBeDefined();
    act(() => expect(first.finishRename()).toBe(true));
    expect(screen.getByText("closed")).toBeDefined();
    expect(renders).toEqual(
      expect.arrayContaining(["closed", "open", "rename"]),
    );
    trigger.remove();
  });

  it("invalidates disconnected open sessions but lets rename survive pill replacement", () => {
    const store = createFirstDraftTabsActionUiStore();
    const trigger = document.body.appendChild(document.createElement("button"));
    store.openMenu({
      kind: "open",
      tabsId: id("tabs"),
      paneId: id("pane"),
      triggerElement: trigger,
    });
    store.beginRename({
      kind: "rename",
      tabsId: id("tabs"),
      paneId: id("pane"),
      initialCanonicalTitle: null,
      initialDisplayedTitle: "Tab 1",
    });
    trigger.remove();
    expect(store.reconcile(() => true)).toBe(true);
    expect(store.getSnapshot().kind).toBe("rename");
    expect(store.reconcile(() => false)).toBe(false);
    expect(store.getSnapshot().kind).toBe("closed");

    const detached = document.createElement("button");
    expect(
      store.openMenu({
        kind: "open",
        tabsId: id("tabs"),
        paneId: id("pane"),
        triggerElement: detached,
      }),
    ).toBe(false);
  });

  it("registers roots by stable tabs identity and cleans up by registration token", () => {
    const store = createFirstDraftTabsActionUiStore();
    const first = document.body.appendChild(document.createElement("div"));
    const second = document.body.appendChild(document.createElement("div"));
    const unregisterFirst = store.registerTabsRoot(id("tabs"), first);
    const unregisterSecond = store.registerTabsRoot(id("tabs"), second);
    unregisterFirst();
    expect(store.getTabsRoot(id("tabs"))).toBe(second);
    unregisterSecond();
    expect(store.getTabsRoot(id("tabs"))).toBeNull();
    first.remove();
    second.remove();
  });
});
