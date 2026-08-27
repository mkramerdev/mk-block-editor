import { useState } from "react";
import { act, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi, type Mock } from "vitest";
import { moveBlocks, removeBlocks } from "@repo/editor-core/editing";
import type { BlockId } from "@repo/editor-core/kernel";
import { createBlockRecord } from "@repo/editor-core/metadata";
import type { EditorImplementation } from "@repo/editor-react/editor";
import type { BlockRendererProps } from "../api/block-renderer.ts";
import type { EditableEditorDefinition } from "../runtime/definition/contracts.ts";
import { EditorDocument } from "../runtime/document/editor-document-component.tsx";
import type { EditorChildOrderProjection } from "../runtime/document/contracts.ts";
import { useTestEditor } from "./test-editor-initializers.ts";
import { createTestEditorSnapshot } from "./editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "./test-editor-definition.ts";

const outerId = "neutral-outer" as BlockId;
const nestedId = "neutral-nested" as BlockId;
const childIds = ["neutral-a", "neutral-b", "neutral-c", "neutral-d"] as BlockId[];
const [aId, bId, cId, dId] = childIds as [BlockId, BlockId, BlockId, BlockId];
let instance = 0;
const leafRuns = new Map<BlockId, Mock<() => void>>();
const wrapperRuns = new Map<BlockId, Mock<() => void>>();

function run(map: Map<BlockId, Mock<() => void>>, id: BlockId) {
  const spy = map.get(id) ?? vi.fn();
  map.set(id, spy);
  spy();
}

function Leaf({ block, children }: BlockRendererProps) {
  run(leafRuns, block.id);
  const [identity] = useState(() => ++instance);
  return <div data-testid={`leaf-${block.id}`} data-instance={identity} data-children={String(children !== undefined)} />;
}

function Wrapper({ block, children }: BlockRendererProps) {
  run(wrapperRuns, block.id);
  return <section data-testid={`wrapper-${block.id}`}>{children}</section>;
}

const definition: EditableEditorDefinition = {
  ...testEditableEditorDefinition,
  blocks: {
    textBlock: { kind: "text", type: "textBlock", rootLayout: "normal", renderer: Leaf },
    wrapperBlock: { kind: "wrapper", type: "wrapperBlock", rootLayout: "normal", contentBoundary: false, content: { required: [], additional: "block" }, renderer: Wrapper },
    nestedWrapper: { kind: "wrapper", type: "nestedWrapper", rootLayout: "normal", contentBoundary: false, content: { required: [], additional: "block" }, renderer: Wrapper },
    atomicBlock: { kind: "atomic", type: "atomicBlock", rootLayout: "normal", renderer: Leaf },
    alternateAtomicBlock: { kind: "atomic", type: "alternateAtomicBlock", rootLayout: "normal", renderer: Leaf },
  },
  defaultRoot: "textBlock",
};

const records = [
  { id: outerId, type: "wrapperBlock", parentId: null },
  { id: aId, type: "atomicBlock", parentId: outerId },
  { id: bId, type: "alternateAtomicBlock", parentId: outerId },
  { id: nestedId, type: "nestedWrapper", parentId: outerId },
  { id: cId, type: "atomicBlock", parentId: nestedId },
  { id: dId, type: "alternateAtomicBlock", parentId: nestedId },
] as const;

function snapshot() {
  return {
    ...createTestEditorSnapshot(records.map(({ id, type }) => ({ id, type }))),
    blocks: Object.fromEntries(records.map((block) => [block.id, createBlockRecord(block)])),
    rootBlockIds: [outerId],
    childIdsByParentId: { [outerId]: [aId, bId, nestedId], [nestedId]: [cId, dId] },
  };
}

function Document({ capture, projection, children }: { readonly capture: (editor: EditorImplementation) => void; readonly projection?: EditorChildOrderProjection; readonly children?: React.ReactNode }) {
  const editor = useTestEditor({ definition, snapshot: snapshot() });
  capture(editor as EditorImplementation);
  return <EditorDocument editor={editor} childOrderProjection={projection}>{children}</EditorDocument>;
}

describe("subscribed block shell traversal", () => {
  it("renders opaque leading content, exact direct sequences, and one shell per block", () => {
    const view = render(<Document capture={() => undefined}><aside data-testid="leading" /></Document>);
    const list = view.container.querySelector(".editor-web-block-list")!;
    expect(list.firstElementChild).toBe(view.getByTestId("leading"));
    expect(list.querySelectorAll("[data-editor-block-shell='true']")).toHaveLength(records.length);
    expect(view.getByTestId(`wrapper-${outerId}`).querySelectorAll(":scope > [data-editor-block-shell='true']")).toHaveLength(3);
    expect(view.getByTestId(`wrapper-${nestedId}`).querySelectorAll(":scope > [data-editor-block-shell='true']")).toHaveLength(2);
    for (const id of childIds) expect(view.getByTestId(`leaf-${id}`)).toHaveAttribute("data-children", "false");
  });

  it("moves projected keyed shells without executing renderers", () => {
    leafRuns.clear(); wrapperRuns.clear();
    const listeners = new Set<() => void>();
    let projected: readonly BlockId[] | null = null;
    const projection: EditorChildOrderProjection = {
      subscribe(parentId, listener) { if (parentId === nestedId) listeners.add(listener); return () => listeners.delete(listener); },
      getProjectedChildIds(parentId, canonical) { return parentId === nestedId && projected ? projected : canonical; },
    };
    const view = render(<Document capture={() => undefined} projection={projection} />);
    const shell = view.container.querySelector(`[data-editor-block-id="${cId}"]`);
    const leafCount = leafRuns.get(cId)!.mock.calls.length;
    const wrapperCount = wrapperRuns.get(nestedId)!.mock.calls.length;
    act(() => { projected = [dId, cId]; for (const listener of listeners) listener(); });
    expect(Array.from(view.getByTestId(`wrapper-${nestedId}`).querySelectorAll<HTMLElement>(":scope > [data-editor-block-id]")).map((node) => node.dataset.editorBlockId)).toEqual([dId, cId]);
    expect(view.container.querySelector(`[data-editor-block-id="${cId}"]`)).toBe(shell);
    expect(leafRuns.get(cId)!.mock.calls.length).toBe(leafCount);
    expect(wrapperRuns.get(nestedId)!.mock.calls.length).toBe(wrapperCount);
  });

  it("isolates child records, wrapper membership, siblings, and surviving shells", () => {
    leafRuns.clear(); wrapperRuns.clear();
    let editor: EditorImplementation | null = null;
    const view = render(<Document capture={(value) => (editor = value)} />);
    const runtime = required(editor);
    const outerCount = wrapperRuns.get(outerId)!.mock.calls.length;
    const nestedCount = wrapperRuns.get(nestedId)!.mock.calls.length;
    const siblingCount = leafRuns.get(bId)!.mock.calls.length;
    const siblingShell = view.container.querySelector(`[data-editor-block-id="${bId}"]`);
    act(() => { expect(runtime.updateBlockMetadata([{ blockId: cId, values: { changed: true } }])).toBe(true); });
    expect(leafRuns.get(cId)!.mock.calls.length).toBe(2);
    expect(leafRuns.get(bId)!.mock.calls.length).toBe(siblingCount);
    expect(wrapperRuns.get(outerId)!.mock.calls.length).toBe(outerCount);
    expect(wrapperRuns.get(nestedId)!.mock.calls.length).toBe(nestedCount);
    act(() => {
      const result = runtime.executeStructuralTransaction({ origin: "neutral-reorder", operations: [moveBlocks({ blockIds: [cId], sourcePlacement: { parentId: nestedId, childIndex: 0 }, destinationPlacement: { parentId: nestedId, childIndex: 1 } })] });
      if (!result.ok) throw new Error(JSON.stringify(result));
    });
    act(() => {
      const result = runtime.executeStructuralTransaction({ origin: "neutral-add-child", operations: [moveBlocks({ blockIds: [aId], sourcePlacement: { parentId: outerId, childIndex: 0 }, destinationPlacement: { parentId: nestedId, childIndex: 2 } })] });
      if (!result.ok) throw new Error(JSON.stringify(result));
    });
    act(() => {
      const result = runtime.executeStructuralTransaction({ origin: "neutral-remove", operations: [removeBlocks({ blockIds: [dId], includeDescendants: true, expectedParents: { [dId]: nestedId } })] });
      if (!result.ok) throw new Error(JSON.stringify(result));
    });
    expect(wrapperRuns.get(outerId)!.mock.calls.length).toBe(outerCount);
    expect(wrapperRuns.get(nestedId)!.mock.calls.length).toBe(nestedCount);
    expect(view.container.querySelector(`[data-editor-block-id="${bId}"]`)).toBe(siblingShell);
  });

  it("keeps editor instances isolated", () => {
    leafRuns.clear();
    let first: EditorImplementation | null = null;
    let second: EditorImplementation | null = null;
    render(<Document capture={(value) => (first = value)} />);
    render(<Document capture={(value) => (second = value)} />);
    const before = leafRuns.get(cId)!.mock.calls.length;
    act(() => { expect(required(first).updateBlockMetadata([{ blockId: cId, values: { instance: 1 } }])).toBe(true); });
    expect(leafRuns.get(cId)!.mock.calls.length).toBe(before + 1);
    expect(required(second).getBlock(cId)?.metadata).toBeUndefined();
  });
});

function required(editor: EditorImplementation | null) {
  expect(editor).not.toBeNull();
  if (!editor) throw new Error("missing editor");
  return editor;
}
