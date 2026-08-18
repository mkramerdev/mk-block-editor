"use client";

import {
  memo,
  useCallback,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { SelectionController } from "@repo/editor-react/selection";
import type {
  AnyEditorRuntimePort,
  EditorRuntimePort,
} from "../../runtime/document/render-port.ts";
import { BlockShell } from "../blocks/block-shell.tsx";
import { SelectionProvider } from "../selection/context/selection-context.tsx";
import { SelectionPaintLayer } from "../selection/paint/selection-paint-layer.tsx";
import { useGlobalSelection } from "../selection/controller/use-global-selection.ts";
import type { TransientPointerSelectionPaint } from "../selection/paint/selection-paint-layer.tsx";
import type { EditorBlockDomRegistryRegistrar } from "../blocks/block-dom-registry.ts";
import type { EditorDefinition } from "../../runtime/definition/contracts.ts";
import type { EditorWebContentRuntime } from "../../runtime/content/content-runtime.ts";
import type {
  Editor,
  EditorDocumentLayerRenderContext,
  EditorDocumentProps,
} from "../../runtime/document/contracts.ts";
import { EditorDocumentGeometryRegistrationProvider } from "../geometry/editor-document-geometry-context.tsx";
import { createEditorDocumentLayerInteractionController } from "../../runtime/document/document-layer-interactions.ts";

export interface BlockListProps<TEditor extends Editor = Editor> {
  definition: EditorDefinition;
  contentRuntime: EditorWebContentRuntime;
  editor: EditorRuntimePort<TEditor>;
  renderDocumentLayers: EditorDocumentProps<TEditor>["renderDocumentLayers"];
  invalidateSelectionOnBlockShapeChange?: boolean;
}

function BlockListRuntime<TEditor extends Editor>(
  props: BlockListProps<TEditor>,
) {
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const { definition, contentRuntime, editor, renderDocumentLayers } = props;
  const runtimeEditor = editor as AnyEditorRuntimePort;
  const [documentLayerInteractions] = useState(
    createEditorDocumentLayerInteractionController,
  );
  // This controller is owned by the BlockList render lifetime. Document-layer
  // effects own and unsubscribe their registrations; after a true unmount the
  // controller is unreachable. Do not dispose it from an effect cleanup:
  // Strict Mode replays cleanup/setup while retaining this same state value.
  const selectionController = editor.selectionController;
  const blockDomReader = editor.geometryRegistration.blockDomReader;
  const blockDomRegistrar = editor.geometryRegistration.blockDomRegistrar;
  const [transientPointerPaint, setTransientPointerPaint] =
    useState<TransientPointerSelectionPaint | null>(null);
  useLayoutEffect(
    () =>
      listElement
        ? editor.geometryRegistration.attachDocumentHost(listElement)
        : undefined,
    [editor, listElement],
  );
  const globalSelection = useGlobalSelection({
    definition,
    listElement,
    blockDom: blockDomReader,
    editor: runtimeEditor,
    contentRuntime,
    selectionController,
  });
  const readBlockPlainText = useCallback(
    (blockId: BlockId): string | null => {
      const block = editor.getBlock(blockId);
      return block
        ? contentRuntime.readBlockPlainText(blockId, block.type)
        : null;
    },
    [contentRuntime, editor],
  );
  const context: EditorDocumentLayerRenderContext<TEditor> = {
    editor: editor as TEditor,
    selection: selectionController.canonical,
    readBlockPlainText,
    interactions: documentLayerInteractions.port,
  };
  const DocumentRuntimeMount = editor.DocumentRuntimeMount;
  return (
    <EditorDocumentGeometryRegistrationProvider
      registration={editor.geometryRegistration}
    >
      <SelectionProvider endpoint={selectionController.endpoint}>
        <div
          ref={setListElement}
          className="editor-web-block-list"
          data-editor-block-list-root="true"
          data-testid="block-editor-document"
          role="list"
          aria-label="Document blocks"
        >
          <RootBlockList
            editor={runtimeEditor}
            selectionController={selectionController}
            blockDomRegistrar={blockDomRegistrar}
          />
          <EditorDocumentLayerStack>
            <SelectionPaintLayer
              editor={editor as TEditor}
              transientPointerPaint={transientPointerPaint}
            />
            <EditorDocumentLayerHost
              render={renderDocumentLayers}
              context={context}
            />
          </EditorDocumentLayerStack>
          {DocumentRuntimeMount ? (
            <DocumentRuntimeMount
              listElement={listElement}
              blockDom={blockDomReader}
              textAnchorResolver={globalSelection.textAnchorResolver}
              captureStructuralSelection={
                globalSelection.captureStructuralSelection
              }
              composition={globalSelection.composition}
              documentLayerKeyboard={documentLayerInteractions.keyboard}
              onTransientPointerPaintChange={setTransientPointerPaint}
            />
          ) : null}
        </div>
      </SelectionProvider>
    </EditorDocumentGeometryRegistrationProvider>
  );
}

export const BlockList = BlockListRuntime;

function EditorDocumentLayerStack({
  children,
}: {
  readonly children: ReactNode;
}) {
  return <div data-editor-document-layer-stack="true">{children}</div>;
}

function EditorDocumentLayerHost<TEditor extends Editor>({
  render,
  context,
}: {
  readonly render: EditorDocumentProps<TEditor>["renderDocumentLayers"];
  readonly context: EditorDocumentLayerRenderContext<TEditor>;
}) {
  if (!render) return null;
  return <div data-editor-document-layer-host="true">{render(context)}</div>;
}

interface BlockTraversalProps {
  readonly editor: AnyEditorRuntimePort;
  readonly selectionController: SelectionController;
  readonly blockDomRegistrar: EditorBlockDomRegistryRegistrar;
}

interface BlockEntryProps extends BlockTraversalProps {
  readonly blockId: BlockId;
  readonly expectedParentId: BlockId | null;
  readonly isRootBlock?: boolean;
}

function RootBlockListRuntime({
  editor,
  selectionController,
  blockDomRegistrar,
}: BlockTraversalProps) {
  const childBlockIds = useRootBlockIds(editor);
  const partitions = useSequencePartitions(childBlockIds);
  return partitions.map((partition) => (
    <BlockSequencePartition
      key={partition.id}
      blockIds={partition.blockIds}
      expectedParentId={null}
      editor={editor}
      selectionController={selectionController}
      blockDomRegistrar={blockDomRegistrar}
      isRootBlock={true}
    />
  ));
}

/** Owns only root-sequence membership and cannot be entered by parent state. */
const RootBlockList = memo(RootBlockListRuntime);

const BlockEntry = memo(function BlockEntry({
  blockId,
  expectedParentId,
  editor,
  selectionController,
  blockDomRegistrar,
  isRootBlock = false,
}: BlockEntryProps) {
  const block = useSubscribedBlock(editor, blockId);
  const definition = block ? editor.definition.blocks[block.type] : undefined;
  const isWrapperBlock = definition?.kind === "wrapper";
  if (
    !block ||
    block.tombstone ||
    (block.parentId ?? null) !== expectedParentId
  ) {
    return null;
  }
  return (
    <BlockShell
      block={block}
      editor={editor}
      selectionController={selectionController}
      blockDomRegistrar={blockDomRegistrar}
      rootLayout={isRootBlock ? (definition?.rootLayout ?? "normal") : null}
    >
      {isWrapperBlock ? (
        <ChildBlockSequence
          parentId={block.id}
          editor={editor}
          selectionController={selectionController}
          blockDomRegistrar={blockDomRegistrar}
        />
      ) : undefined}
    </BlockShell>
  );
});

/** Owns exactly one wrapper membership subscription, independently of its shell. */
function ChildBlockSequenceRuntime({
  parentId,
  editor,
  selectionController,
  blockDomRegistrar,
}: BlockTraversalProps & { readonly parentId: BlockId }) {
  const childBlockIds = useChildBlockIds(editor, parentId);
  const partitions = useSequencePartitions(childBlockIds);
  return partitions.map((partition) => (
    <BlockSequencePartition
      key={partition.id}
      blockIds={partition.blockIds}
      expectedParentId={parentId}
      editor={editor}
      selectionController={selectionController}
      blockDomRegistrar={blockDomRegistrar}
    />
  ));
}

/** Owns only one wrapper's child-sequence membership. */
const ChildBlockSequence = memo(ChildBlockSequenceRuntime);

interface SequencePartition {
  readonly id: number;
  readonly blockIds: readonly BlockId[];
}

interface BlockSequencePartitionProps extends BlockTraversalProps {
  readonly blockIds: readonly BlockId[];
  readonly expectedParentId: BlockId | null;
  readonly isRootBlock?: boolean;
}

function BlockSequencePartitionRuntime(props: BlockSequencePartitionProps) {
  const {
    blockIds,
    expectedParentId,
    editor,
    selectionController,
    blockDomRegistrar,
    isRootBlock = false,
  } = props;
  return blockIds.map((blockId) => (
    <BlockEntry
      key={blockId}
      blockId={blockId}
      expectedParentId={expectedParentId}
      editor={editor}
      selectionController={selectionController}
      blockDomRegistrar={blockDomRegistrar}
      isRootBlock={isRootBlock}
    />
  ));
}

const BlockSequencePartition = memo(BlockSequencePartitionRuntime);

const INITIAL_SEQUENCE_PARTITION_SIZE = 8;

function useSequencePartitions(
  blockIds: readonly BlockId[],
): readonly SequencePartition[] {
  const [ownership, setOwnership] = useState<{
    nextId: number;
    blockIds: readonly BlockId[];
    partitions: readonly SequencePartition[];
  }>(() => ({
    nextId: Math.ceil(blockIds.length / INITIAL_SEQUENCE_PARTITION_SIZE),
    blockIds,
    partitions: initialSequencePartitions(blockIds),
  }));
  if (ownership.blockIds === blockIds) return ownership.partitions;
  const nextOwnership = reconcileSequencePartitions(ownership, blockIds);
  setOwnership(nextOwnership);
  return nextOwnership.partitions;
}

function initialSequencePartitions(
  blockIds: readonly BlockId[],
): readonly SequencePartition[] {
  const partitions: SequencePartition[] = [];
  for (
    let offset = 0;
    offset < blockIds.length;
    offset += INITIAL_SEQUENCE_PARTITION_SIZE
  ) {
    partitions.push({
      id: partitions.length,
      blockIds: Object.freeze(
        blockIds.slice(offset, offset + INITIAL_SEQUENCE_PARTITION_SIZE),
      ),
    });
  }
  return Object.freeze(partitions);
}

function reconcileSequencePartitions(
  previous: {
    readonly nextId: number;
    readonly blockIds: readonly BlockId[];
    readonly partitions: readonly SequencePartition[];
  },
  blockIds: readonly BlockId[],
): {
  readonly nextId: number;
  readonly blockIds: readonly BlockId[];
  readonly partitions: readonly SequencePartition[];
} {
  if (sameBlockSequence(previous.blockIds, blockIds)) {
    return { ...previous, blockIds };
  }
  const priorPartitionByBlockId = new Map<BlockId, number>();
  previous.partitions.forEach((partition, partitionIndex) => {
    partition.blockIds.forEach((blockId) =>
      priorPartitionByBlockId.set(blockId, partitionIndex),
    );
  });
  const assigned: BlockId[][] = previous.partitions.map(() => []);
  let partitionIndex = 0;
  for (const blockId of blockIds) {
    const priorIndex = priorPartitionByBlockId.get(blockId);
    if (priorIndex !== undefined && priorIndex > partitionIndex) {
      partitionIndex = priorIndex;
    }
    if (assigned.length === 0) assigned.push([]);
    assigned[Math.min(partitionIndex, assigned.length - 1)]!.push(blockId);
  }
  let nextId = previous.nextId;
  const partitions: SequencePartition[] = [];
  for (let index = 0; index < assigned.length; index += 1) {
    const nextIds = assigned[index]!;
    if (nextIds.length === 0) continue;
    const prior = previous.partitions[index];
    partitions.push(
      prior && sameBlockSequence(prior.blockIds, nextIds)
        ? prior
        : {
            id: prior?.id ?? nextId++,
            blockIds: Object.freeze(nextIds),
          },
    );
  }
  return {
    nextId,
    blockIds,
    partitions: Object.freeze(partitions),
  };
}

function sameBlockSequence(
  left: readonly BlockId[],
  right: readonly BlockId[],
): boolean {
  return (
    left.length === right.length &&
    left.every((blockId, index) => blockId === right[index])
  );
}

function useRootBlockIds(editor: AnyEditorRuntimePort): readonly BlockId[] {
  return useSyncExternalStore(
    (listener) => editor.subscribeRootBlockIds(listener),
    () => editor.getRootBlockIds(),
    () => editor.getRootBlockIds(),
  );
}

function useChildBlockIds(
  editor: AnyEditorRuntimePort,
  parentId: BlockId,
): readonly BlockId[] {
  return useSyncExternalStore(
    (listener) => editor.subscribeChildBlockIds(parentId, listener),
    () => editor.getChildBlockIds(parentId),
    () => editor.getChildBlockIds(parentId),
  );
}

function useSubscribedBlock(
  editor: AnyEditorRuntimePort,
  blockId: BlockId,
): VersionedBlock | null {
  return useSyncExternalStore(
    (listener) => editor.subscribeBlock(blockId, listener),
    () => editor.getBlock(blockId),
    () => editor.getBlock(blockId),
  );
}
