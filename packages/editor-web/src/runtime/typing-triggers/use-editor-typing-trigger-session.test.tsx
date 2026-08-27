import { act, renderHook } from "@testing-library/react";
import type { BlockId } from "@repo/editor-core/kernel";
import { describe, expect, it, vi } from "vitest";
import type {
  EditableEditor,
  EditorTypingTriggerSession,
  EditorTypingTriggerSessionId,
} from "../document/contracts.ts";
import { useEditorTypingTriggerSession } from "./use-editor-typing-trigger-session.ts";

describe("useEditorTypingTriggerSession", () => {
  it("is a headless external-store adapter and switches editor subscriptions", () => {
    const first = createSessionStoreEditor();
    const second = createSessionStoreEditor();
    const { result, rerender, unmount } = renderHook(
      ({
        editor,
      }: {
        readonly editor: Pick<
          EditableEditor,
          "getTypingTriggerSession" | "subscribeTypingTriggerSession"
        >;
      }) => useEditorTypingTriggerSession(editor),
      { initialProps: { editor: first.editor } },
    );

    expect(result.current).toBeNull();
    act(() => first.publish(session("first", 1, "")));
    expect(result.current).toMatchObject({
      triggerId: "mention",
      query: "",
      revision: 1,
    });
    act(() => first.publish(session("first", 2, "a")));
    expect(result.current).toMatchObject({ query: "a", revision: 2 });

    rerender({ editor: second.editor });
    expect(first.unsubscribe).toHaveBeenCalledTimes(1);
    expect(result.current).toBeNull();
    act(() => first.publish(null));
    expect(result.current).toBeNull();
    act(() => second.publish(session("second", 1, "")));
    expect(result.current?.id).toBe("second");

    unmount();
    expect(second.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

function createSessionStoreEditor() {
  let current: EditorTypingTriggerSession | null = null;
  const listeners = new Set<() => void>();
  const unsubscribe = vi.fn();
  const editor = {
    getTypingTriggerSession: () => current,
    subscribeTypingTriggerSession(listener: () => void) {
      listeners.add(listener);
      let active = true;
      return () => {
        if (!active) return;
        active = false;
        listeners.delete(listener);
        unsubscribe();
      };
    },
  } satisfies Pick<
    EditableEditor,
    "getTypingTriggerSession" | "subscribeTypingTriggerSession"
  >;
  return {
    editor,
    unsubscribe,
    publish(next: EditorTypingTriggerSession | null) {
      current = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

function session(
  id: string,
  revision: number,
  query: string,
): EditorTypingTriggerSession {
  const blockId = "hook-block" as BlockId;
  return {
    id: id as EditorTypingTriggerSessionId,
    triggerId: "mention",
    trigger: "@",
    blockId,
    blockType: "textBlock",
    range: { from: 0, to: 1 + query.length },
    query,
    revision,
    selection: { blockId, offset: 1 + query.length },
  };
}
