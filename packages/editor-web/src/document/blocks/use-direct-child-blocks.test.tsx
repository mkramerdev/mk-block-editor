import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import { createBlockRecord } from "@repo/editor-core/metadata";
import { moveBlocks } from "@repo/editor-core/editing";
import type { EditorRenderPort } from "../../runtime/document/render-port.ts";
import { initializeTestEditableEditor } from "../../tests/test-editor-initializers.ts";
import { createTestEditorSnapshot } from "../../tests/editor-snapshot-fixtures.ts";
import { testEditableEditorDefinition } from "../../tests/test-editor-definition.ts";
import { useDirectChildBlocks } from "./use-direct-child-blocks.ts";

const parentAId = "hook-direct-parent-a" as BlockId;
const parentBId = "hook-direct-parent-b" as BlockId;
const childOneId = "hook-direct-child-one" as BlockId;
const childTwoId = "hook-direct-child-two" as BlockId;
const childBId = "hook-direct-child-b" as BlockId;
const unrelatedId = "hook-direct-unrelated" as BlockId;

describe("useDirectChildBlocks", () => {
  it("adapts one parent-scoped runtime projection without child subscriptions", () => {
    const editor = createHookEditor();
    const runtime = editor as unknown as EditorRenderPort;
    const originalSubscribe = runtime.subscribeDirectChildBlocks.bind(runtime);
    const releases: Array<{
      readonly parentId: BlockId;
      release: ReturnType<typeof vi.fn>;
    }> = [];
    const parentSubscribe = vi
      .spyOn(runtime, "subscribeDirectChildBlocks")
      .mockImplementation((parentId, listener) => {
        const release = vi.fn(originalSubscribe(parentId, listener));
        releases.push({ parentId, release });
        return release;
      });
    const childSubscribe = vi.spyOn(runtime, "subscribeBlock");
    const renderCounts = new Map<string, number>();
    const snapshots = new Map<string, readonly VersionedBlock[]>();

    function Probe({
      label,
      parentId,
    }: {
      readonly label: string;
      readonly parentId: BlockId;
    }) {
      const children = useDirectChildBlocks(runtime, parentId);
      renderCounts.set(label, (renderCounts.get(label) ?? 0) + 1);
      snapshots.set(label, children);
      return (
        <div data-testid={label}>
          {children.map((block) => block.id).join(",")}
        </div>
      );
    }

    const view = render(
      <>
        <Probe label="first" parentId={parentAId} />
        <Probe label="second" parentId={parentAId} />
      </>,
    );

    expect(view.getByTestId("first").textContent).toBe(
      `${childOneId},${childTwoId}`,
    );
    expect(snapshots.get("first")).toBe(snapshots.get("second"));
    expect(childSubscribe).not.toHaveBeenCalled();
    expect(parentSubscribe).toHaveBeenCalledTimes(2);
    expect(renderCounts.get("first")).toBe(1);
    expect(renderCounts.get("second")).toBe(1);

    act(() => {
      expect(
        editor.updateBlockMetadata([
          { blockId: unrelatedId, values: { unrelated: true } },
        ]),
      ).toBe(true);
    });
    expect(renderCounts.get("first")).toBe(1);
    expect(renderCounts.get("second")).toBe(1);

    act(() => {
      expect(
        editor.updateBlockMetadata([
          { blockId: childOneId, values: { direct: true } },
        ]),
      ).toBe(true);
    });
    expect(renderCounts.get("first")).toBe(2);
    expect(renderCounts.get("second")).toBe(2);
    expect(snapshots.get("first")).toBe(snapshots.get("second"));

    act(() => {
      const moved = editor.executeStructuralTransaction({
        origin: "direct-child-hook/sequence-change",
        operations: [
          moveBlocks({
            blockIds: [childTwoId],
            sourcePlacement: { parentId: parentAId, childIndex: 1 },
            destinationPlacement: { parentId: parentBId, childIndex: 1 },
          }),
        ],
      });
      if (!moved.ok) throw new Error(JSON.stringify(moved));
    });
    expect(renderCounts.get("first")).toBe(3);
    expect(renderCounts.get("second")).toBe(3);
    expect(view.getByTestId("first").textContent).toBe(childOneId);

    view.rerender(<Probe label="first" parentId={parentBId} />);
    expect(view.getByTestId("first").textContent).toBe(
      `${childBId},${childTwoId}`,
    );
    expect(
      releases
        .filter(({ parentId }) => parentId === parentAId)
        .every(({ release }) => release.mock.calls.length === 1),
    ).toBe(true);
    expect(childSubscribe).not.toHaveBeenCalled();

    const activeRelease = releases.at(-1)?.release;
    view.unmount();
    expect(activeRelease).toHaveBeenCalledOnce();
    editor.dispose();
  });

  it("updates the projection contract after remote transactions", () => {
    const editor = initializeTestEditableEditor({
      definition: testEditableEditorDefinition,
      snapshot: createHookSnapshot(),
    });
    const first = editor.getDirectChildBlocks(parentAId);
    const listener = vi.fn();
    editor.subscribeDirectChildBlocks(parentAId, listener);

    expect(first).toBe(editor.getDirectChildBlocks(parentAId));
    expect(first[0]).toBe(editor.getBlock(childOneId));
    expect(
      editor.applyRemoteTransaction({
        authorSelection: { kind: "no-author-selection" },
        transaction: {
          transactionId: "read-direct-child-metadata",
          historyAction: "command",
          graph: null,
          metadata: {
            kind: "updateBlockMetadata",
            updates: [{ blockId: childOneId, values: { remote: true } }],
          },
          content: [],
        },
      }),
    ).toMatchObject({ status: "applied" });
    expect(listener).toHaveBeenCalledOnce();
    expect(editor.getDirectChildBlocks(parentAId)).not.toBe(first);
    expect(editor.getDirectChildBlocks(parentAId)[0]).toBe(
      editor.getBlock(childOneId),
    );

    editor.dispose();
  });
});

function createHookEditor() {
  return initializeTestEditableEditor({
    definition: {
      ...testEditableEditorDefinition,
      blocks: {
        ...testEditableEditorDefinition.blocks,
        fixedWrapper: {
          ...testEditableEditorDefinition.blocks.fixedWrapper!,
          content: { required: ["textBlock"], additional: "block" },
        },
      },
    },
    snapshot: createHookSnapshot(),
  });
}

function createHookSnapshot() {
  const snapshot = createTestEditorSnapshot([
    { id: parentAId, type: "containerWrapper" },
    { id: childOneId, type: "textBlock", text: "one" },
    { id: childTwoId, type: "textBlock", text: "two" },
    { id: parentBId, type: "fixedWrapper" },
    { id: childBId, type: "textBlock", text: "b" },
    { id: unrelatedId, type: "textBlock", text: "unrelated" },
  ]);
  return {
    ...snapshot,
    blocks: {
      ...snapshot.blocks,
      [parentAId]: createBlockRecord({
        id: parentAId,
        type: "containerWrapper",
        parentId: null,
      }),
      [childOneId]: createBlockRecord({
        id: childOneId,
        type: "textBlock",
        parentId: parentAId,
      }),
      [childTwoId]: createBlockRecord({
        id: childTwoId,
        type: "textBlock",
        parentId: parentAId,
      }),
      [parentBId]: createBlockRecord({
        id: parentBId,
          type: "fixedWrapper",
        parentId: null,
      }),
      [childBId]: createBlockRecord({
        id: childBId,
        type: "textBlock",
        parentId: parentBId,
      }),
      [unrelatedId]: createBlockRecord({
        id: unrelatedId,
        type: "textBlock",
        parentId: null,
      }),
    },
    rootBlockIds: [parentAId, parentBId, unrelatedId],
    childIdsByParentId: {
      [parentAId]: [childOneId, childTwoId],
      [parentBId]: [childBId],
    },
  };
}
