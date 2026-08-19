import { act, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { StrictMode, useLayoutEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { EditorDocument } from "../runtime/document/editor-document-component.tsx";
import { useTestEditor as useEditor } from "./test-editor-initializers.ts";
import type { EditorDocumentLayerRenderContext } from "../runtime/document/contracts.ts";
import type { EditableEditor, Editor } from "../runtime/document/contracts.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";
import { resolveEditorRuntimePort } from "../runtime/document/runtime-port-registry.ts";

const blockId = "document-layer-paragraph" as BlockId;

function LayerProbe({
  context,
  name,
  onContext,
}: {
  readonly context: EditorDocumentLayerRenderContext;
  readonly name: string;
  readonly onContext: (context: EditorDocumentLayerRenderContext) => void;
}) {
  onContext(context);
  return <span data-testid={`layer-${name}`}>{name}</span>;
}

function MountedEditor({
  name,
  onContext,
  onEditor = () => undefined,
}: {
  readonly name: string;
  readonly onContext: (context: EditorDocumentLayerRenderContext) => void;
  readonly onEditor?: (editor: Editor) => void;
}) {
  const editor = useEditor({
    definition: testEditableEditorDefinition,
    snapshot: createTestEditorSnapshot([
      { id: blockId, type: "paragraph", text: name },
    ]),
  });
  onEditor(editor);
  return (
    <div data-testid={`owner-${name}`}>
      <EditorDocument
        editor={editor}
        renderDocumentLayers={(context) => (
          <LayerProbe context={context} name={name} onContext={onContext} />
        )}
      />
    </div>
  );
}

function KeyboardClaimLayer({
  context,
  onKeydown,
  onCleanup,
}: {
  readonly context: EditorDocumentLayerRenderContext;
  readonly onKeydown: () => void;
  readonly onCleanup: () => void;
}) {
  useLayoutEffect(() => {
    const unregister = context.interactions.registerKeydownHandler((event) => {
      if (event.key !== "ArrowDown") return "unhandled";
      onKeydown();
      return "handled";
    });
    return () => {
      unregister();
      onCleanup();
    };
  }, [context.interactions, onCleanup, onKeydown]);
  return null;
}

function StrictKeyboardEditor({
  name,
  onEditor,
  onKeydown,
  onCleanup,
}: {
  readonly name: string;
  readonly onEditor: (editor: EditableEditor) => void;
  readonly onKeydown: () => void;
  readonly onCleanup: () => void;
}) {
  const editor = useEditor({
    definition: testEditableEditorDefinition,
    snapshot: createTestEditorSnapshot([
      { id: blockId, type: "paragraph", text: name },
    ]),
  }) as EditableEditor;
  onEditor(editor);
  return (
    <div data-testid={`strict-owner-${name}`}>
      <EditorDocument
        editor={editor}
        renderDocumentLayers={(context) => (
          <KeyboardClaimLayer
            context={context}
            onKeydown={onKeydown}
            onCleanup={onCleanup}
          />
        )}
      />
    </div>
  );
}

describe("direct editor document layers", () => {
  it("renders ordinary product UI in-tree inside the document host", () => {
    const onContext = vi.fn();
    const onEditor = vi.fn();
    render(
      <MountedEditor name="one" onContext={onContext} onEditor={onEditor} />,
    );

    const layer = screen.getByTestId("layer-one");
    const host = layer.closest("[data-editor-document-layer-host='true']");
    const documentHost = screen.getByTestId("block-editor-document");
    expect(host).not.toBeNull();
    expect(documentHost.contains(layer)).toBe(true);
    expect(document.body.contains(layer)).toBe(true);
    expect(onContext).toHaveBeenCalled();
    const context = onContext.mock.calls.at(-1)?.[0] as
      | EditorDocumentLayerRenderContext
      | undefined;
    expect(context?.editor.geometry).toBeDefined();
    expect(context?.editor).toBe(onEditor.mock.calls[0]?.[0]);
    expect(context?.editor.getBlock(blockId)?.type).toBe("paragraph");
    expect(Object.keys(context ?? {}).sort()).toStrictEqual([
      "editor",
      "interactions",
      "readBlockPlainText",
      "selection",
    ]);
    expect(context?.interactions.registerKeydownHandler).toEqual(
      expect.any(Function),
    );
  });

  it("keeps two editors' renderers and geometry owners independent", () => {
    const firstContexts: EditorDocumentLayerRenderContext[] = [];
    const secondContexts: EditorDocumentLayerRenderContext[] = [];
    render(
      <>
        <MountedEditor
          name="first"
          onContext={(context) => firstContexts.push(context)}
        />
        <MountedEditor
          name="second"
          onContext={(context) => secondContexts.push(context)}
        />
      </>,
    );

    const firstOwner = screen.getByTestId("owner-first");
    const secondOwner = screen.getByTestId("owner-second");
    expect(within(firstOwner).getByTestId("layer-first")).toBeInTheDocument();
    expect(within(firstOwner).queryByTestId("layer-second")).toBeNull();
    expect(within(secondOwner).getByTestId("layer-second")).toBeInTheDocument();
    expect(firstContexts.at(-1)?.editor).not.toBe(
      secondContexts.at(-1)?.editor,
    );
    expect(firstContexts.at(-1)?.editor.geometry).not.toBe(
      secondContexts.at(-1)?.editor.geometry,
    );
    expect(firstContexts.at(-1)?.interactions).not.toBe(
      secondContexts.at(-1)?.interactions,
    );
  });

  it("does not rerender document layers for a native caret-only selection update", () => {
    const onContext = vi.fn();
    let editor: EditableEditor | null = null;
    render(
      <MountedEditor
        name="caret"
        onContext={onContext}
        onEditor={(nextEditor) => {
          editor = nextEditor as EditableEditor;
        }}
      />,
    );
    const renderCount = onContext.mock.calls.length;

    act(() => {
      editor?.focusText(blockId, { offset: 2 });
    });

    expect(onContext).toHaveBeenCalledTimes(renderCount);
  });

  it("keeps real layer keyboard ownership alive through Strict Mode replay", async () => {
    const firstKeydown = vi.fn();
    const secondKeydown = vi.fn();
    const firstCleanup = vi.fn();
    const secondCleanup = vi.fn();
    let firstEditor: EditableEditor | null = null;
    let secondEditor: EditableEditor | null = null;
    const rendered = render(
      <StrictMode>
        <StrictKeyboardEditor
          name="first"
          onEditor={(editor) => {
            firstEditor = editor;
          }}
          onKeydown={firstKeydown}
          onCleanup={firstCleanup}
        />
        <StrictKeyboardEditor
          name="second"
          onEditor={(editor) => {
            secondEditor = editor;
          }}
          onKeydown={secondKeydown}
          onCleanup={secondCleanup}
        />
      </StrictMode>,
    );
    expect(firstCleanup).toHaveBeenCalledOnce();
    expect(secondCleanup).toHaveBeenCalledOnce();

    act(() => {
      firstEditor?.focusText(blockId, { offset: 2, preventScroll: true });
    });
    const firstOwner = screen.getByTestId("strict-owner-first");
    const textRoot = firstOwner.querySelector<HTMLElement>(
      '[data-editor-text-root="true"][contenteditable="true"]',
    );
    await waitFor(() => expect(textRoot).toBe(document.activeElement));
    if (!firstEditor || !secondEditor || !textRoot) {
      throw new Error("Strict Mode editor fixture did not mount.");
    }
    const runtime = resolveEditorRuntimePort(firstEditor);
    const ordinaryOrCanonicalRouting = vi.spyOn(
      runtime,
      "ownsNativeFocusTarget",
    );
    const selectionBefore = runtime.selectionController.getCanonicalSnapshot();
    const activeElementBefore = document.activeElement;
    const nativeSelectionBefore = document.getSelection();
    const anchorNodeBefore = nativeSelectionBefore?.anchorNode ?? null;
    const anchorOffsetBefore = nativeSelectionBefore?.anchorOffset ?? null;
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowDown",
      code: "ArrowDown",
    });
    const stopPropagation = vi.spyOn(event, "stopPropagation");

    act(() => textRoot.dispatchEvent(event));

    expect(firstKeydown).toHaveBeenCalledOnce();
    expect(secondKeydown).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(stopPropagation).toHaveBeenCalledOnce();
    expect(ordinaryOrCanonicalRouting).not.toHaveBeenCalled();
    expect(runtime.selectionController.getCanonicalSnapshot()).toBe(
      selectionBefore,
    );
    expect(document.activeElement).toBe(activeElementBefore);
    expect(document.getSelection()?.anchorNode ?? null).toBe(anchorNodeBefore);
    expect(document.getSelection()?.anchorOffset ?? null).toBe(
      anchorOffsetBefore,
    );

    rendered.unmount();
    expect(firstCleanup).toHaveBeenCalledTimes(2);
    expect(secondCleanup).toHaveBeenCalledTimes(2);
    const detachedEvent = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowDown",
    });
    act(() => textRoot.dispatchEvent(detachedEvent));
    expect(firstKeydown).toHaveBeenCalledOnce();
  });
});
