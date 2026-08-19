import type { EditorContentRuntime } from "@repo/editor-core/content";
import { asBlockId } from "@repo/editor-core/kernel";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localBlockContentStore } from "../content/local/runtime.ts";
import { createEditorContentRuntime } from "../runtime/content/content-runtime.ts";
import type {
  EditableEditorDefinition,
  ReadEditorDefinition,
} from "../runtime/definition/contracts.ts";
import { createEditorContentStartup } from "../runtime/document/snapshot-initialization.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import {
  testEditableEditorDefinition,
  testReadEditorDefinition,
} from "./test-editor-definition.ts";
import {
  initializeTestEditableEditor,
  initializeTestReadEditor,
} from "./test-editor-initializers.ts";

const blockId = asBlockId("01890f07-1c00-7000-8000-000000009901");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("editor content runtime selection", () => {
  it("creates and destroys exactly one default runtime", () => {
    const originalCreate = localBlockContentStore.createRuntime.bind(
      localBlockContentStore,
    );
    let runtime: EditorContentRuntime | null = null;
    const createDefault = vi
      .spyOn(localBlockContentStore, "createRuntime")
      .mockImplementation((options) => {
        runtime = originalCreate(options);
        return runtime;
      });
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: snapshot("default"),
    });
    if (!runtime) throw new Error("default content runtime was not created");
    const destroy = vi.spyOn(runtime, "destroy");

    expect(createDefault).toHaveBeenCalledOnce();
    expect(editor.readBlockPlainText(blockId, "paragraph")).toBe("default");

    editor.dispose();
    editor.dispose();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("uses one definition-provided runtime without constructing the fallback", () => {
    const sourceSnapshot = snapshot("custom");
    const selected = createEditorContentRuntime(
      createEditorContentStartup(sourceSnapshot, testEditableEditorDefinition),
    );
    const destroy = vi.spyOn(selected, "destroy");
    const createDefault = vi.spyOn(localBlockContentStore, "createRuntime");
    const createRuntime = vi.fn(() => selected);
    const definition = {
      ...testEditableEditorDefinition,
      content: { createRuntime },
    } satisfies EditableEditorDefinition;
    const editor = initializeTestEditableEditor({
      definition,
      snapshot: sourceSnapshot,
    });

    expect(createRuntime).toHaveBeenCalledOnce();
    expect(createDefault).not.toHaveBeenCalled();
    expect(editor.readBlockPlainText(blockId, "paragraph")).toBe("custom");
    expect(editor.insertText({ blockId, offset: 6, text: " runtime" })).toBe(
      true,
    );
    expect(selected.readBlockPlainText(blockId, "paragraph")).toBe(
      "custom runtime",
    );
    const lease = selected.acquireBlockContent(
      blockId,
      "paragraph",
      "active-editing",
    );
    expect(
      selected.createTextAnchorInContext(lease, {
        textOffset: 6,
        affinity: "forward",
      }),
    ).toMatchObject({ ok: true, textOffset: 6 });
    lease.release();

    editor.dispose();
    editor.dispose();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("uses and destroys one definition-provided runtime for a read editor", () => {
    const sourceSnapshot = snapshot("read runtime");
    const selected = createEditorContentRuntime(
      createEditorContentStartup(sourceSnapshot, testReadEditorDefinition),
    );
    const destroy = vi.spyOn(selected, "destroy");
    const createDefault = vi.spyOn(localBlockContentStore, "createRuntime");
    const createRuntime = vi.fn(() => selected);
    const definition = {
      ...testReadEditorDefinition,
      content: { createRuntime },
    } satisfies ReadEditorDefinition;
    const editor = initializeTestReadEditor({
      definition,
      snapshot: sourceSnapshot,
    });

    expect(createRuntime).toHaveBeenCalledOnce();
    expect(createDefault).not.toHaveBeenCalled();
    expect(editor.readBlockContent(blockId, "paragraph")).toMatchObject({
      content: [{ content: [{ text: "read runtime" }] }],
    });

    editor.dispose();
    editor.dispose();
    expect(destroy).toHaveBeenCalledOnce();
  });
});

function snapshot(text: string) {
  return createTestEditorSnapshot([{ id: blockId, type: "paragraph", text }]);
}
