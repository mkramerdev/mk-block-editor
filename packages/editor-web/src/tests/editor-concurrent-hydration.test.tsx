import { StrictMode, Suspense, useEffect, useLayoutEffect } from "react";
import { act } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import type { BlockId } from "@repo/editor-core/kernel";
import { describe, expect, it, vi } from "vitest";
import { EditorDocument } from "../runtime/document/editor-document-component.tsx";
import {
  type TestEditableEditor,
  useTestEditor as useEditor,
} from "./test-editor-initializers.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";
import { resolveEditorRuntimePort } from "../runtime/document/runtime-port-registry.ts";

const blockId = "concurrent-hydration-textbox" as BlockId;

describe("concurrent editor hydration", () => {
  it("keeps a suspended hydration editor valid until its generation commits", async () => {
    const serverEditors: TestEditableEditor[] = [];
    const clientEditors: TestEditableEditor[] = [];
    let committedEditor: TestEditableEditor | null = null;
    let autofocusCount = 0;
    const serverGate = createHydrationGate(true);
    const clientGate = createHydrationGate(false);
    const snapshot = createTestEditorSnapshot([
      { id: blockId, type: "textBlock", text: "hydration" },
    ]);
    const consoleErrors: unknown[][] = [];
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation((...arguments_) => {
        consoleErrors.push(arguments_);
      });
    let root: Root | null = null;

    try {
      const serverHtml = renderToString(
        <StrictMode>
          <HydrationEditor
            gate={serverGate}
            snapshot={snapshot}
            onConstructed={(editor) => serverEditors.push(editor)}
          />
        </StrictMode>,
      );
      expect(serverEditors).not.toHaveLength(0);

      const container = document.createElement("div");
      container.innerHTML = serverHtml;
      document.body.append(container);
      const serverDocumentRoot = container.querySelector(
        "div.editor-web-document",
      );
      expect(serverDocumentRoot).not.toBeNull();
      expect(serverDocumentRoot?.getAttribute("aria-label")).toBe(
        "Document editor",
      );
      expect(
        serverDocumentRoot?.querySelector(":scope > .editor-web-block-list"),
      ).not.toBeNull();

      await act(async () => {
        root = hydrateRoot(
          container,
          <StrictMode>
            <HydrationEditor
              gate={clientGate}
              snapshot={{
                ...snapshot,
                blocks: { ...snapshot.blocks },
                rootBlockIds: [...snapshot.rootBlockIds],
                childIdsByParentId: { ...snapshot.childIdsByParentId },
                content: { ...snapshot.content },
              }}
              onConstructed={(editor) => clientEditors.push(editor)}
              onCommitted={(editor) => {
                committedEditor = editor;
              }}
              onAutofocus={() => {
                autofocusCount += 1;
              }}
            />
          </StrictMode>,
        );
        await Promise.resolve();
      });

      expect(committedEditor).toBeNull();
      expect(autofocusCount).toBe(0);
      expect(
        container.querySelector("[data-testid='editor-document']"),
      ).not.toBeNull();

      expect(committedEditor).toBeNull();
      expect(autofocusCount).toBe(0);
      for (const editor of distinctEditors(clientEditors)) {
        expect(editor.getBlock(blockId)?.type).toBe("textBlock");
        expect("selectionController" in editor).toBe(true);
      }

      await act(async () => {
        clientGate.resolve();
        await Promise.resolve();
        await Promise.resolve();
      });

      const committed = requireCommittedEditor(committedEditor);
      expect(committed).not.toBeNull();
      expect(committed.getBlock(blockId)?.type).toBe("textBlock");
      expect("selectionController" in committed).toBe(true);
      const activeRoot = container.querySelector<HTMLElement>(
        '.editor-web-text[contenteditable="true"][data-editor-input-owner="true"]',
      );
      expect(activeRoot).not.toBeNull();
      expect(document.activeElement).toBe(activeRoot);
      expect(
        committed.selectionController.canonical.getSnapshot(),
      ).toMatchObject({
        kind: "document",
        snapshot: {
          endpoints: {
            anchor: { blockId },
            head: { blockId },
          },
        },
      });
      expect(
        resolveEditorRuntimePort(committed).readActiveTextView()?.dom,
      ).toBe(activeRoot);
      expect(autofocusCount).toBeGreaterThan(0);
      // The explicit compound focus action settled the canonical caret once;
      // hydration itself did not add another semantic selection transition.
      expect(committed.selection.getSnapshot().revision).toBe(1);

      expect(
        distinctEditors([...serverEditors, ...clientEditors]).every(
          (editor) => "selectionController" in editor,
        ),
      ).toBe(true);
      expect(
        consoleErrors.filter((arguments_) =>
          /hydration|did not match|server rendered/iu.test(
            arguments_.map(String).join(" "),
          ),
        ),
      ).toEqual([]);

      await act(async () => {
        root?.unmount();
      });
      root = null;
      expect(committed.getBlock(blockId)?.type).toBe("textBlock");
      container.remove();
    } finally {
      if (root !== null) {
        try {
          await act(async () => {
            root?.unmount();
          });
        } catch {
          // The assertion failure that interrupted hydration remains primary.
        }
      }
      consoleError.mockRestore();
    }
  });
});

function HydrationEditor({
  gate,
  snapshot,
  onConstructed,
  onCommitted,
  onAutofocus,
}: {
  readonly gate: HydrationGate;
  readonly snapshot: Parameters<typeof useEditor>[0]["snapshot"];
  readonly onConstructed: (editor: TestEditableEditor) => void;
  readonly onCommitted?: (editor: TestEditableEditor) => void;
  readonly onAutofocus?: () => void;
}) {
  const editor = useEditor({
    definition: testEditableEditorDefinition,
    snapshot,
  });
  onConstructed(editor);
  return (
    <Suspense fallback={null}>
      <CommittedEditor
        editor={editor}
        gate={gate}
        onCommitted={onCommitted}
        onAutofocus={onAutofocus}
      />
    </Suspense>
  );
}

function CommittedEditor({
  editor,
  gate,
  onCommitted,
  onAutofocus,
}: {
  readonly editor: TestEditableEditor;
  readonly gate: HydrationGate;
  readonly onCommitted?: (editor: TestEditableEditor) => void;
  readonly onAutofocus?: () => void;
}) {
  gate.read();
  useLayoutEffect(() => {
    onCommitted?.(editor);
  }, [editor, onCommitted]);
  useEffect(() => {
    onAutofocus?.();
    editor.focusText(blockId, { offset: 0, preventScroll: true });
  }, [editor, onAutofocus]);
  return <EditorDocument editor={editor} />;
}

interface HydrationGate {
  read(): void;
  resolve(): void;
}

function createHydrationGate(initiallyResolved: boolean): HydrationGate {
  let resolved = initiallyResolved;
  let resolvePromise: (() => void) | null = null;
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    read() {
      if (!resolved) throw promise;
    },
    resolve() {
      if (resolved) return;
      resolved = true;
      resolvePromise?.();
    },
  };
}

function distinctEditors(
  editors: readonly TestEditableEditor[],
): readonly TestEditableEditor[] {
  return [...new Set(editors)];
}

function requireCommittedEditor(
  editor: TestEditableEditor | null,
): TestEditableEditor {
  if (!editor) throw new Error("hydration did not commit");
  return editor;
}
