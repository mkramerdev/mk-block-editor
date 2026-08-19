import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import {
  testEditableEditorDefinition,
  testReadEditorDefinition,
} from "./test-editor-definition.ts";
import {
  initializeTestEditableEditor,
  initializeTestReadEditor,
} from "./test-editor-initializers.ts";

const probes = vi.hoisted(() => ({
  editableResources: vi.fn(),
  editorRuntime: vi.fn(),
  externalStore: vi.fn(),
  initialSessionState: vi.fn(),
  typingTriggerController: vi.fn(),
  editableCommands: vi.fn(),
}));

vi.mock("@repo/editor-react/editor", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@repo/editor-react/editor")>();
  return {
    ...actual,
    EditorImplementation: class extends actual.EditorImplementation {
      constructor(
        ...args: ConstructorParameters<typeof actual.EditorImplementation>
      ) {
        probes.editorRuntime();
        super(...args);
      }
    },
  };
});

vi.mock("@repo/editor-react/store", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@repo/editor-react/store")>();
  return {
    ...actual,
    createEditorExternalStore: (
      ...args: Parameters<typeof actual.createEditorExternalStore>
    ) => {
      probes.externalStore();
      return actual.createEditorExternalStore(...args);
    },
    createInitialEditorSessionState: (
      ...args: Parameters<typeof actual.createInitialEditorSessionState>
    ) => {
      probes.initialSessionState();
      return actual.createInitialEditorSessionState(...args);
    },
  };
});

vi.mock("../runtime/content/runtime-resources", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../runtime/content/runtime-resources.ts")
    >();
  return {
    ...actual,
    createEditorContentRuntimeResources: (
      ...args: Parameters<typeof actual.createEditorContentRuntimeResources>
    ) => {
      probes.editableResources();
      return actual.createEditorContentRuntimeResources(...args);
    },
  };
});

vi.mock("../runtime/definition/commands", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../runtime/definition/commands.ts")>();
  return {
    ...actual,
    compileRegisteredEditorCommands: (
      ...args: Parameters<typeof actual.compileRegisteredEditorCommands>
    ) => {
      probes.editableCommands();
      return actual.compileRegisteredEditorCommands(...args);
    },
  };
});

vi.mock(
  "../runtime/typing-triggers/session-controller",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../runtime/typing-triggers/session-controller.ts")
      >();
    return {
      ...actual,
      EditorTypingTriggerSessionController: class
        extends actual.EditorTypingTriggerSessionController
      {
        constructor(
          ...args: ConstructorParameters<
            typeof actual.EditorTypingTriggerSessionController
          >
        ) {
          probes.typingTriggerController();
          super(...args);
        }
      },
    };
  },
);

afterEach(() => {
  for (const probe of Object.values(probes)) probe.mockClear();
});

describe("read resource construction exclusion", () => {
  it("does not construct any editable runtime resources", () => {
    const editor = initializeTestReadEditor({
      definition: testReadEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { type: "paragraph", text: "read only" },
      ]),
    });

    expect(probes.editableResources).not.toHaveBeenCalled();
    expect(probes.editorRuntime).not.toHaveBeenCalled();
    expect(probes.externalStore).not.toHaveBeenCalled();
    expect(probes.initialSessionState).not.toHaveBeenCalled();
    expect(probes.typingTriggerController).not.toHaveBeenCalled();
    expect(probes.editableCommands).not.toHaveBeenCalled();
    expect("proseMirrorSchema" in (editor as object)).toBe(false);
    editor.dispose();
  });

  it("constructs editable resources without a trigger controller for a trigger-free editor", () => {
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { type: "paragraph", text: "editable" },
      ]),
    });

    expect(probes.editableResources).toHaveBeenCalledTimes(1);
    expect(probes.editorRuntime).toHaveBeenCalledTimes(1);
    expect(probes.externalStore).toHaveBeenCalledTimes(1);
    expect(probes.initialSessionState).toHaveBeenCalledTimes(1);
    expect(probes.typingTriggerController).not.toHaveBeenCalled();
    expect(probes.editableCommands).toHaveBeenCalledTimes(1);
    editor.dispose();
  });

  it("constructs one trigger controller for a trigger-enabled editor", () => {
    const editor = initializeTestEditableEditor({
      definition: {
        ...testEditableEditorDefinition,
        typingTriggers: [{ id: "mention", trigger: "@" }],
      },
      snapshot: createTestEditorSnapshot([
        { type: "paragraph", text: "editable" },
      ]),
    });

    expect(probes.typingTriggerController).toHaveBeenCalledTimes(1);
    editor.dispose();
  });
});
