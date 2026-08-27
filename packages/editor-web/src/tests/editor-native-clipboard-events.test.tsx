import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useState, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditableEditorDefinition } from "../runtime/definition/contracts.ts";
import { EditorDocument } from "../runtime/document/editor-document-component.tsx";
import { resolveEditorRuntimePort } from "../runtime/document/runtime-port-registry.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";
import {
  type TestEditableEditor,
  useTestEditor,
} from "./test-editor-initializers.ts";

const clipboardDefinition: EditableEditorDefinition = {
  ...testEditableEditorDefinition,
  contentImport: { plainTextBlockType: "textBlock" },
};

class ControlledClipboardData {
  readonly getDataCalls: string[] = [];
  readonly setDataCalls: Array<readonly [string, string]> = [];
  private readonly data = new Map<string, string>();

  getData(type: string): string {
    this.getDataCalls.push(type);
    return this.data.get(type) ?? "";
  }

  setData(type: string, value: string): void {
    this.setDataCalls.push([type, value]);
    this.data.set(type, value);
  }

  seed(type: string, value: string): void {
    this.data.set(type, value);
  }
}

function MountedClipboardEditor({
  name,
  text,
  interactionEnabled = true,
  onEditor,
  children,
}: {
  readonly name: string;
  readonly text: string;
  readonly interactionEnabled?: boolean;
  readonly onEditor: (editor: TestEditableEditor) => void;
  readonly children?: ReactNode;
}) {
  const blockId = `${name}-text` as BlockId;
  const editor = useTestEditor({
    definition: clipboardDefinition,
    snapshot: createTestEditorSnapshot([
      { id: blockId, type: "textBlock", text },
    ]),
  });
  onEditor(editor);
  return (
    <div data-testid={`clipboard-owner-${name}`}>
      <EditorDocument
        editor={editor}
        interactionEnabled={interactionEnabled}
      >
        {children}
      </EditorDocument>
    </div>
  );
}

describe("mounted native clipboard runtime", () => {
  it("routes native copy, cut, and paste once while clipboard keydown does no work", () => {
    let editor: TestEditableEditor | null = null;
    render(
      <MountedClipboardEditor
        name="editable"
        text="alpha"
        onEditor={(next) => {
          editor = next;
        }}
      />,
    );
    const mounted = requireEditor(editor);
    const blockId = "editable-text" as BlockId;
    const textRoot = textRootFor("editable");
    const runtime = resolveEditorRuntimePort(mounted);
    const projection = vi.spyOn(runtime.contentRuntime, "readBlockProjection");
    const transaction = vi.spyOn(mounted, "transaction");
    const deletion = vi.spyOn(mounted, "executeStructuralRangeDeletion");

    commitTextSelection(mounted, blockId, 0, 5);
    projection.mockClear();
    for (const key of ["c", "x", "v"]) {
      const keydown = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        ctrlKey: true,
        key,
      });
      act(() => textRoot.dispatchEvent(keydown));
      expect(keydown.defaultPrevented).toBe(false);
    }
    expect(projection).not.toHaveBeenCalled();
    expect(deletion).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
    expect(mounted.readBlockPlainText(blockId, "textBlock")).toBe("alpha");

    const copied = new ControlledClipboardData();
    const copy = clipboardEvent("copy", copied);
    act(() => textRoot.dispatchEvent(copy));
    expect(copy.defaultPrevented).toBe(true);
    expect(copied.setDataCalls.map(([type]) => type).sort()).toStrictEqual([
      "text/html",
      "text/plain",
    ]);
    expect(copied.setDataCalls.find(([type]) => type === "text/plain")?.[1]).toBe(
      "alpha",
    );

    const cutData = new ControlledClipboardData();
    const cut = clipboardEvent("cut", cutData);
    act(() => textRoot.dispatchEvent(cut));
    expect(cut.defaultPrevented).toBe(true);
    expect(cutData.setDataCalls).toHaveLength(2);
    expect(deletion).toHaveBeenCalledOnce();
    expect(mounted.readBlockPlainText(blockId, "textBlock")).toBe("");

    mounted.focusText(blockId, { offset: 0, preventScroll: true });
    transaction.mockClear();
    const pasteData = new ControlledClipboardData();
    for (const [type, value] of copied.setDataCalls) pasteData.seed(type, value);
    const paste = clipboardEvent("paste", pasteData);
    act(() => textRoot.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(true);
    expect(pasteData.getDataCalls).toStrictEqual(["text/html"]);
    expect(transaction).toHaveBeenCalledOnce();
    expect(mounted.readBlockPlainText(blockId, "textBlock")).toBe("alpha");
  });

  it("keeps canonical copy mounted in inert interaction mode without cut or paste effects", () => {
    let editor: TestEditableEditor | null = null;
    render(
      <MountedClipboardEditor
        name="inert"
        text="readonly"
        interactionEnabled={false}
        onEditor={(next) => {
          editor = next;
        }}
      />,
    );
    const mounted = requireEditor(editor);
    const blockId = "inert-text" as BlockId;
    const textRoot = textRootFor("inert");
    commitTextSelection(mounted, blockId, 0, 8);

    const copyData = new ControlledClipboardData();
    const copy = clipboardEvent("copy", copyData);
    act(() => textRoot.dispatchEvent(copy));
    expect(copy.defaultPrevented).toBe(true);
    expect(copyData.setDataCalls.find(([type]) => type === "text/plain")?.[1]).toBe(
      "readonly",
    );

    const cut = clipboardEvent("cut", new ControlledClipboardData());
    act(() => textRoot.dispatchEvent(cut));
    expect(cut.defaultPrevented).toBe(false);
    expect(mounted.readBlockPlainText(blockId, "textBlock")).toBe("readonly");

    const pasteData = new ControlledClipboardData();
    pasteData.seed("text/plain", "changed");
    const paste = clipboardEvent("paste", pasteData);
    act(() => textRoot.dispatchEvent(paste));
    expect(paste.defaultPrevented).toBe(false);
    expect(pasteData.getDataCalls).toHaveLength(0);
    expect(mounted.readBlockPlainText(blockId, "textBlock")).toBe("readonly");
  });

  it("isolates sibling editors and unregisters document listeners on unmount", () => {
    let first: TestEditableEditor | null = null;
    let second: TestEditableEditor | null = null;
    function Pair() {
      const [showFirst, setShowFirst] = useState(true);
      return (
        <>
          <button onClick={() => setShowFirst(false)}>remove first</button>
          {showFirst ? (
            <MountedClipboardEditor
              name="first"
              text="one"
              onEditor={(next) => {
                first = next;
              }}
            />
          ) : null}
          <MountedClipboardEditor
            name="second"
            text="two"
            onEditor={(next) => {
              second = next;
            }}
          />
        </>
      );
    }
    render(<Pair />);
    const firstEditor = requireEditor(first);
    const secondEditor = requireEditor(second);
    commitTextSelection(firstEditor, "first-text" as BlockId, 0, 3);
    commitTextSelection(secondEditor, "second-text" as BlockId, 0, 3);
    const firstReads = vi.spyOn(
      resolveEditorRuntimePort(firstEditor).contentRuntime,
      "readBlockProjection",
    );
    const secondReads = vi.spyOn(
      resolveEditorRuntimePort(secondEditor).contentRuntime,
      "readBlockProjection",
    );
    firstReads.mockClear();
    secondReads.mockClear();

    const copyData = new ControlledClipboardData();
    const copy = clipboardEvent("copy", copyData);
    act(() => textRootFor("first").dispatchEvent(copy));
    expect(copy.defaultPrevented).toBe(true);
    expect(firstReads).toHaveBeenCalled();
    expect(secondReads).not.toHaveBeenCalled();
    expect(copyData.setDataCalls.find(([type]) => type === "text/plain")?.[1]).toBe(
      "one",
    );

    const detachedRoot = textRootFor("first");
    act(() => screen.getByRole("button", { name: "remove first" }).click());
    firstReads.mockClear();
    const detachedCopy = clipboardEvent("copy", new ControlledClipboardData());
    act(() => detachedRoot.dispatchEvent(detachedCopy));
    expect(detachedCopy.defaultPrevented).toBe(false);
    expect(firstReads).not.toHaveBeenCalled();
  });

  it("isolates a genuinely nested editor from its outer document", () => {
    let outer: TestEditableEditor | null = null;
    let inner: TestEditableEditor | null = null;
    render(
      <MountedClipboardEditor
        name="outer"
        text="outside"
        onEditor={(next) => {
          outer = next;
        }}
      >
        <MountedClipboardEditor
          name="inner"
          text="inside"
          onEditor={(next) => {
            inner = next;
          }}
        />
      </MountedClipboardEditor>,
    );
    const outerEditor = requireEditor(outer);
    const innerEditor = requireEditor(inner);
    commitTextSelection(outerEditor, "outer-text" as BlockId, 0, 7);
    commitTextSelection(innerEditor, "inner-text" as BlockId, 0, 6);
    const outerReads = vi.spyOn(
      resolveEditorRuntimePort(outerEditor).contentRuntime,
      "readBlockProjection",
    );
    const innerReads = vi.spyOn(
      resolveEditorRuntimePort(innerEditor).contentRuntime,
      "readBlockProjection",
    );
    outerReads.mockClear();
    innerReads.mockClear();

    const data = new ControlledClipboardData();
    const copy = clipboardEvent("copy", data);
    act(() => textRootFor("inner").dispatchEvent(copy));
    expect(copy.defaultPrevented).toBe(true);
    expect(innerReads).toHaveBeenCalled();
    expect(outerReads).not.toHaveBeenCalled();
    expect(data.setDataCalls.find(([type]) => type === "text/plain")?.[1]).toBe(
      "inside",
    );
  });
});

function requireEditor(
  editor: TestEditableEditor | null,
): TestEditableEditor {
  if (!editor) throw new Error("Mounted clipboard editor was not captured.");
  return editor;
}

function textRootFor(name: string): HTMLElement {
  const root = screen
    .getByTestId(`clipboard-owner-${name}`)
    .querySelector<HTMLElement>('[data-editor-text-root="true"]');
  if (!root) throw new Error(`Missing text root for ${name}.`);
  return root;
}

function clipboardEvent(
  type: "copy" | "cut" | "paste",
  clipboardData: ControlledClipboardData,
): ClipboardEvent {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  Object.defineProperty(event, "clipboardData", {
    configurable: false,
    enumerable: true,
    value: clipboardData,
  });
  return event as ClipboardEvent;
}

function commitTextSelection(
  editor: TestEditableEditor,
  blockId: BlockId,
  anchorOffset: number,
  focusOffset: number,
): void {
  const capture = (offset: number) => {
    editor.focusText(blockId, { offset, preventScroll: true });
    const selection = editor.selectionController.getCanonicalSnapshot();
    if (selection.kind !== "document")
      throw new Error("Text focus did not create a document selection.");
    const point = selection.snapshot.documentSelection.focus;
    if (!point?.textAnchor)
      throw new Error("Text focus did not create an anchored point.");
    return point;
  };
  let rejected = false;
  act(() => {
    const anchor = capture(anchorOffset);
    const focus = capture(focusOffset);
    const result = editor.selectionController.commitCanonicalSelection(
      { direction: "forward", anchor, focus },
      editor,
      editor.getSelectionGraphRevision(),
      {
        publication: { kind: "standalone-local" },
        cause: "programmatic-edit",
      },
      {
        resolveTextAnchor: (point) => editor.resolveSelectionTextAnchor(point),
      },
    );
    rejected = result.kind === "rejected";
  });
  if (rejected) throw new Error("Text selection was rejected.");
}
