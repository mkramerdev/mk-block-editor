import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import { EditorDocumentGeometryRegistrationProvider } from "../document/geometry/editor-document-geometry-context.tsx";
import { InactiveTextBlockPrimitive } from "../document/blocks/inactive-text-block-primitive.tsx";
import { EditorDocument } from "../runtime/document/editor-document-component.tsx";
import { resolveEditorRuntimePort } from "../runtime/document/runtime-port-registry.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";
import { initializeTestEditableEditor } from "./test-editor-initializers.ts";

const firstId = "inactive-text-first" as BlockId;
const secondId = "inactive-text-second" as BlockId;

describe("InactiveTextBlockPrimitive", () => {
  it("subscribes to canonical content and owns only inactive geometry", () => {
    const onChange = vi.fn();
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: firstId, type: "textBlock", text: "canonical" },
      ]),
      onChange,
    });
    const runtime = resolveEditorRuntimePort(editor);
    const block = editor.getBlock(firstId);
    if (!block) throw new Error("Expected the inactive text block");
    const projectionCleanup = vi.fn();
    const originalSubscribe = runtime.contentRuntime.subscribeBlockProjection;
    const subscribeProjection = vi
      .spyOn(runtime.contentRuntime, "subscribeBlockProjection")
      .mockImplementation((blockId, listener) => {
        const unsubscribe = originalSubscribe(blockId, listener);
        return () => {
          unsubscribe();
          projectionCleanup();
        };
      });
    const geometryCleanup = vi.fn();
    const originalRegister =
      runtime.geometryRegistration.registerMountedTextRoot;
    const registerGeometry = vi
      .spyOn(runtime.geometryRegistration, "registerMountedTextRoot")
      .mockImplementation((blockId, root) => {
        const unregister = originalRegister(blockId, root);
        return () => {
          unregister();
          geometryCleanup();
        };
      });
    const registerHost = vi.spyOn(runtime, "registerTextEditingHost");
    const acquireDocument = vi.spyOn(runtime, "acquireTextEditingDocument");
    const readActiveView = vi.spyOn(runtime, "readActiveTextView");
    const standaloneSelection = vi.fn();
    const unsubscribeSelection =
      editor.subscribeStandaloneSelectionSettlements(standaloneSelection);

    const rendered = render(
      <EditorDocumentGeometryRegistrationProvider
        registration={runtime.geometryRegistration}
      >
        <InactiveTextBlockPrimitive block={block} editor={editor} />
      </EditorDocumentGeometryRegistrationProvider>,
    );

    const root = rendered.container.querySelector(
      '[data-editor-inactive-text-root="true"]',
    );
    expect(root?.textContent).toBe("canonical");
    expect(root?.querySelector("[contenteditable]")).toBeNull();
    expect(registerGeometry).toHaveBeenCalledOnce();
    expect(registerGeometry).toHaveBeenCalledWith(firstId, root);
    expect(registerHost).not.toHaveBeenCalled();
    expect(acquireDocument).not.toHaveBeenCalled();
    expect(readActiveView()).toBeNull();
    expect(editor.canUndo).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    expect(standaloneSelection).not.toHaveBeenCalled();

    act(() => {
      expect(
        editor.insertText({ blockId: firstId, offset: 9, text: " update" }),
      ).toBe(true);
    });
    expect(root?.textContent).toBe("canonical update");

    rendered.unmount();
    expect(projectionCleanup).toHaveBeenCalledTimes(
      subscribeProjection.mock.calls.length,
    );
    expect(geometryCleanup).toHaveBeenCalledOnce();
    unsubscribeSelection();
    editor.dispose();
  });

  it("does not move or dispatch through the shared view owned by another block", () => {
    const onChange = vi.fn();
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { id: firstId, type: "textBlock", text: "active" },
        { id: secondId, type: "textBlock", text: "inactive" },
      ]),
      onChange,
    });
    const runtime = resolveEditorRuntimePort(editor);
    const documentView = render(<EditorDocument editor={editor} />);

    act(() => {
      expect(editor.focusText(firstId, { offset: 2 }).status).toBe("focused");
    });
    const activeView = runtime.readActiveTextView();
    if (!activeView) throw new Error("Expected the shared active text view");
    const activeParent = activeView.dom.parentElement;
    const dispatch = vi.spyOn(activeView, "dispatch");
    onChange.mockClear();
    const secondBlock = editor.getBlock(secondId);
    if (!secondBlock) throw new Error("Expected the inactive text block");

    const inactiveView = render(
      <InactiveTextBlockPrimitive block={secondBlock} editor={editor} />,
    );

    expect(runtime.readActiveTextView()).toBe(activeView);
    expect(activeView.dom.parentElement).toBe(activeParent);
    expect(inactiveView.container.textContent).toBe("inactive");
    expect(inactiveView.container.querySelector("[contenteditable]")).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
    expect(editor.canUndo).toBe(false);
    expect(onChange).not.toHaveBeenCalled();

    inactiveView.unmount();
    documentView.unmount();
    editor.dispose();
  });
});
