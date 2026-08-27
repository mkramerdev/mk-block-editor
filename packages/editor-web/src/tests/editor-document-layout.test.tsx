import { StrictMode, type ReactNode } from "react";
import { act, render, screen } from "@testing-library/react";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import { wholeSelection } from "@repo/editor-core/selection";
import type {
  EditorSelectionGraphReader,
  SelectionController,
} from "@repo/editor-react/selection";
import { createEditorLogicalSelectionPoint } from "@repo/editor-react/selection";
import { EditorDocument } from "../runtime/document/editor-document-component.tsx";
import type {
  EditableEditor,
  EditorDocumentProps,
  EditorLayoutConfig,
} from "../runtime/document/contracts.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";
import { initializeTestEditableEditor } from "./test-editor-initializers.ts";

const blockListProbe = vi.hoisted(() => ({
  controllers: [] as SelectionController[],
  interactionEnabled: [] as boolean[],
}));

vi.mock("../document/editor/block-list", () => ({
  BlockList: ({
    editor,
    interactionEnabled,
    rootLeadingContent,
  }: {
    editor: {
      readonly probeKey?: string;
      readonly selectionController: SelectionController;
    };
    interactionEnabled: boolean;
    rootLeadingContent?: ReactNode;
  }) => {
    blockListProbe.controllers.push(editor.selectionController);
    blockListProbe.interactionEnabled.push(interactionEnabled);
    return (
      <div
        key={editor.probeKey}
        data-testid="block-list"
        role="list"
        aria-label="Document blocks"
      >
        {rootLeadingContent}
        <div data-testid="canonical-root" />
      </div>
    );
  },
}));

const editor = createTestEditor("first");
const alternateEditor = createTestEditor("second");

describe("EditorDocument layout contract", () => {
  it("keeps the public document and layout types exact", () => {
    expectTypeOf<EditorLayoutConfig>().toEqualTypeOf<{
      readonly sideLeftWidth: string;
      readonly sideRightWidth: string;
    }>();
    expectTypeOf<EditorDocumentProps>().toEqualTypeOf<{
      readonly editor: EditableEditor;
      readonly interactionEnabled?: boolean;
      readonly layout?: EditorLayoutConfig;
      readonly childOrderProjection?: EditorDocumentProps["childOrderProjection"];
      readonly children?: EditorDocumentProps["children"];
      readonly trailingContent?: EditorDocumentProps["trailingContent"];
      readonly renderDocumentLayers?: EditorDocumentProps["renderDocumentLayers"];
      readonly onSelectionDragStart?: EditorDocumentProps["onSelectionDragStart"];
      readonly onSelectionDragUpdate?: EditorDocumentProps["onSelectionDragUpdate"];
      readonly onSelectionDragEnd?: EditorDocumentProps["onSelectionDragEnd"];
    }>();
    expectTypeOf<{
      readonly sideLeftWidth: string;
    }>().not.toMatchTypeOf<EditorLayoutConfig>();
  });

  it("keeps leading content before roots and trailing content after the list", () => {
    render(
      <EditorDocument
        editor={editor}
        trailingContent={<button data-testid="trailing-content" />}
      >
        <div data-testid="leading-content" />
      </EditorDocument>,
    );

    const shell = screen.getByTestId("editor-document");
    const blockList = screen.getByRole("list", { name: "Document blocks" });
    const leading = screen.getByTestId("leading-content");
    const canonicalRoot = screen.getByTestId("canonical-root");
    const trailing = screen.getByTestId("trailing-content");

    expect(blockList.contains(leading)).toBe(true);
    expect(leading.compareDocumentPosition(canonicalRoot)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(trailing.parentElement).toBe(shell);
    expect(blockList.contains(trailing)).toBe(false);
    expect(blockList.nextElementSibling).toBe(trailing);
  });

  it("owns the document root and projects every supplied layout value", () => {
    const { rerender } = render(
      <EditorDocument
        editor={editor}
        layout={{
          sideLeftWidth: "2fr",
          sideRightWidth: "3fr",
        }}
      />,
    );

    const shell = screen.getByTestId("editor-document");
    expect(shell.style.getPropertyValue("--editor-side-left-width")).toBe(
      "2fr",
    );
    expect(shell.style.getPropertyValue("--editor-side-right-width")).toBe(
      "3fr",
    );
    expect(shell.className).toBe("editor-web-document");
    expect(shell.tagName).toBe("DIV");
    expect(shell.getAttribute("role")).toBe("region");
    expect(shell.getAttribute("data-editor-web")).toBe("document");
    expect(
      screen.getAllByRole("region", { name: "Document editor" }),
    ).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Document editor" })).toBe(shell);
    const blockList = screen.getByRole("list", { name: "Document blocks" });
    expect(blockList.parentElement).toBe(shell);
    expect(blockList.getAttribute("style")).toBeNull();

    rerender(
      <EditorDocument
        editor={editor}
        layout={{
          sideLeftWidth: "12px",
          sideRightWidth: "24px",
        }}
      />,
    );

    expect(shell.style.getPropertyValue("--editor-side-left-width")).toBe(
      "12px",
    );
    expect(shell.style.getPropertyValue("--editor-side-right-width")).toBe(
      "24px",
    );
  });

  it("defaults client effects on and forwards an explicit inert state", () => {
    const view = render(<EditorDocument editor={editor} />);
    expect(blockListProbe.interactionEnabled.at(-1)).toBe(true);
    view.rerender(
      <EditorDocument editor={editor} interactionEnabled={false} />,
    );
    expect(blockListProbe.interactionEnabled.at(-1)).toBe(false);
  });

  it("projects the private neutral layout when layout is omitted", () => {
    render(<EditorDocument editor={editor} />);

    const shell = screen.getByTestId("editor-document");
    expect(shell.style.getPropertyValue("--editor-content-max-width")).toBe("");
    expect(shell.style.getPropertyValue("--editor-side-left-width")).toBe(
      "0px",
    );
    expect(shell.style.getPropertyValue("--editor-side-right-width")).toBe(
      "0px",
    );
  });

  it("retains each editor controller and both reader facades across remounts", () => {
    blockListProbe.controllers.length = 0;
    const { rerender, unmount } = render(<EditorDocument editor={editor} />);
    const firstController = lastController();
    const endpoint = firstController.endpoint;
    const canonical = firstController.canonical;

    rerender(
      <EditorDocument
        editor={editor}
        layout={{
          sideLeftWidth: "1fr",
          sideRightWidth: "2fr",
        }}
      />,
    );
    expect(lastController()).toBe(firstController);

    rerender(
      <EditorDocument
        editor={alternateEditor}
        layout={{
          sideLeftWidth: "0px",
          sideRightWidth: "0px",
        }}
      />,
    );

    const alternateController = lastController();
    expect(alternateController).toBe(
      (
        alternateEditor as unknown as {
          selectionController: SelectionController;
        }
      ).selectionController,
    );
    expect(alternateController).not.toBe(firstController);
    expect(firstController.endpoint).toBe(endpoint);
    expect(firstController.canonical).toBe(canonical);
    unmount();

    render(<EditorDocument editor={editor} />);
    const remountedController = lastController();
    expect(remountedController).toBe(firstController);
    expect(remountedController.endpoint).toBe(endpoint);
    expect(remountedController.canonical).toBe(canonical);
    expect(remountedController.canonical.getSnapshot()).toEqual({
      kind: "none",
      revision: 0,
    });
    expect(remountedController.endpoint.getSnapshot().phase).toBe("idle");
  });

  it("isolates controllers and selection state between mounted documents", () => {
    blockListProbe.controllers.length = 0;
    render(
      <>
        <EditorDocument editor={editor} />
        <EditorDocument editor={alternateEditor} />
      </>,
    );
    const [firstController, secondController] =
      blockListProbe.controllers.slice(-2);
    if (!firstController || !secondController)
      throw new Error("Expected both document controllers");

    expect(firstController).not.toBe(secondController);
    expect(firstController.endpoint).not.toBe(secondController.endpoint);
    expect(firstController.canonical).not.toBe(secondController.canonical);

    const graph = createSelectionGraph();
    const point = createEditorLogicalSelectionPoint({
      blockId: "document-selection" as BlockId,
      textOffset: 0,
      graph,
    });
    if (!point) throw new Error("Expected a selection point");
    act(() => {
      firstController.extendSelection(point, point, graph, 1, {
        publication: { kind: "silent" },
        cause: "programmatic-edit",
      });
    });

    expect(firstController.canonical.getSnapshot().kind).toBe("document");
    expect(firstController.endpoint.getSnapshot().phase).toBe("committed");
    expect(secondController.canonical.getSnapshot()).toEqual({
      kind: "none",
      revision: 0,
    });
    expect(secondController.endpoint.getSnapshot().phase).toBe("idle");
  });

  it("retains canonical selection while EditorDocument rerenders", () => {
    blockListProbe.controllers.length = 0;
    const view = render(<EditorDocument editor={editor} />);
    const controller = lastController();
    const graph = createSelectionGraph();
    const point = createEditorLogicalSelectionPoint({
      blockId: "document-selection" as BlockId,
      textOffset: 0,
      graph,
    });
    if (!point) throw new Error("Expected a selection point");
    act(() => {
      controller.extendSelection(point, point, graph, 1, {
        publication: { kind: "silent" },
        cause: "programmatic-edit",
      });
    });
    const canonical = controller.canonical.getSnapshot();
    const endpoint = controller.endpoint.getSnapshot();
    const firstSubtree = screen.getByTestId("block-list");

    view.rerender(
      <EditorDocument
        editor={editor}
        layout={{
          sideLeftWidth: "0px",
          sideRightWidth: "0px",
        }}
      />,
    );

    expect(screen.getByTestId("block-list")).toBe(firstSubtree);
    expect(lastController()).toBe(controller);
    expect(controller.canonical.getSnapshot()).toBe(canonical);
    expect(controller.endpoint.getSnapshot()).toBe(endpoint);
  });

  it("retains the document runtime subtree when drag callback identities change", () => {
    const firstStart = vi.fn();
    const view = render(
      <EditorDocument editor={editor} onSelectionDragStart={firstStart} />,
    );
    const documentRoot = screen.getByTestId("editor-document");
    const blockList = screen.getByTestId("block-list");

    view.rerender(
      <EditorDocument
        editor={editor}
        onSelectionDragStart={vi.fn()}
        onSelectionDragUpdate={vi.fn()}
        onSelectionDragEnd={vi.fn()}
      />,
    );

    expect(screen.getByTestId("editor-document")).toBe(documentRoot);
    expect(screen.getByTestId("block-list")).toBe(blockList);
  });

  it("keeps the committed controller usable through Strict Mode replay", () => {
    blockListProbe.controllers.length = 0;
    const view = render(
      <StrictMode>
        <EditorDocument editor={editor} />
      </StrictMode>,
    );
    const controller = lastController();
    const graph = createSelectionGraph();
    const point = createEditorLogicalSelectionPoint({
      blockId: "document-selection" as BlockId,
      textOffset: 0,
      graph,
    });
    if (!point) throw new Error("Expected a selection point");

    act(() => {
      controller.extendSelection(point, point, graph, 1, {
        publication: { kind: "silent" },
        cause: "programmatic-edit",
      });
    });
    view.rerender(
      <StrictMode>
        <EditorDocument
          editor={editor}
          layout={{
            sideLeftWidth: "0px",
            sideRightWidth: "0px",
          }}
        />
      </StrictMode>,
    );

    expect(lastController()).toBe(controller);
    expect(controller.canonical.getSnapshot().kind).toBe("document");
    expect(controller.endpoint.getSnapshot().phase).toBe("committed");
  });
});

function lastController(): SelectionController {
  const controller = blockListProbe.controllers.at(-1);
  if (!controller) throw new Error("Expected a document selection controller");
  return controller;
}

function createTestEditor(probeKey: string): EditableEditor {
  return Object.assign(
    initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createTestEditorSnapshot([
        { type: "textBlock", text: probeKey },
      ]),
    }),
    { probeKey },
  );
}

function createSelectionGraph(): EditorSelectionGraphReader {
  const blockId = "document-selection" as BlockId;
  const block: VersionedBlock = {
    id: blockId,
    type: "containerWrapper",
    parentId: null,
    tombstone: null,
    metadataVersion: "1",
    contentVersion: null,
  };
  return {
    getBlock: (candidate) => (candidate === blockId ? block : null),
    getParentId: () => null,
    getRootBlockIds: () => [blockId],
    getChildBlockIds: () => [],
    readBlockSelectionModel: () => wholeSelection(),
  };
}
