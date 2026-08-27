"use client";

import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { VersionedBlock } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { SelectionController } from "@repo/editor-react/selection";
import type { EditorContentRuntime } from "@repo/editor-core/content";
import type { EditableEditorDefinition } from "../../runtime/definition/contracts.ts";
import type {
  EditableEditor,
  EditorDocumentLayerRenderContext,
  EditorDocumentProps,
} from "../../runtime/document/contracts.ts";
import type { EditableEditorRuntimePort } from "../../runtime/document/render-port.ts";
import { BlockShell } from "../blocks/block-shell.tsx";
import type { EditorBlockDomRegistryRegistrar } from "../blocks/block-dom-registry.ts";
import { EditorDocumentGeometryRegistrationProvider } from "../geometry/editor-document-geometry-context.tsx";
import { SelectionProvider } from "../selection/context/selection-context.tsx";
import { useGlobalSelection } from "../selection/controller/use-global-selection.ts";
import {
  createEditorTextGestureArbitration,
  EditorTextGestureArbitrationProvider,
} from "../selection/controller/text-gesture-arbitration.tsx";
import {
  SelectionPaintLayer,
  type TransientPointerSelectionPaint,
} from "../selection/paint/selection-paint-layer.tsx";
import { createEditorDocumentLayerInteractionController } from "../../runtime/document/document-layer-interactions.ts";
import { createEditorCaretVisibilityController } from "../selection/controller/caret-visibility.ts";

export interface BlockListProps<
  TEditor extends EditableEditor = EditableEditor,
> {
  definition: EditableEditorDefinition;
  contentRuntime: EditorContentRuntime;
  editor: EditableEditorRuntimePort<TEditor>;
  interactionEnabled?: boolean;
  childOrderProjection?: EditorDocumentProps<TEditor>["childOrderProjection"];
  rootLeadingContent?: ReactNode;
  renderDocumentLayers: EditorDocumentProps<TEditor>["renderDocumentLayers"];
  onSelectionDragStart: EditorDocumentProps<TEditor>["onSelectionDragStart"];
  onSelectionDragUpdate: EditorDocumentProps<TEditor>["onSelectionDragUpdate"];
  onSelectionDragEnd: EditorDocumentProps<TEditor>["onSelectionDragEnd"];
  invalidateSelectionOnBlockShapeChange?: boolean;
}

export function BlockList<TEditor extends EditableEditor>({
  definition,
  contentRuntime,
  editor,
  interactionEnabled = true,
  childOrderProjection,
  rootLeadingContent,
  renderDocumentLayers,
  onSelectionDragStart,
  onSelectionDragUpdate,
  onSelectionDragEnd,
}: BlockListProps<TEditor>) {
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const [documentLayerInteractions] = useState(
    createEditorDocumentLayerInteractionController,
  );
  const [textGestureArbitration] = useState(createEditorTextGestureArbitration);
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
  useLayoutEffect(() => {
    if (!interactionEnabled || !listElement) return;
    const controller = createEditorCaretVisibilityController({
      editor,
      list: listElement,
    });
    return () => controller.dispose();
  }, [editor, interactionEnabled, listElement]);
  const globalSelection = useGlobalSelection({
    definition,
    listElement,
    blockDom: blockDomReader,
    editor,
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
    editor,
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
        <EditorTextGestureArbitrationProvider value={textGestureArbitration}>
          <div
            ref={setListElement}
            className="editor-web-block-list"
            data-editor-block-list-root="true"
            data-testid="block-editor-document"
            role="list"
            aria-label="Document blocks"
          >
            {rootLeadingContent}
            <RootChildSequence
              editor={editor}
              childOrderProjection={childOrderProjection}
              selectionController={selectionController}
              blockDomRegistrar={blockDomRegistrar}
            />
            <div data-editor-document-layer-stack="true">
              <SelectionPaintLayer
                editor={editor}
                transientPointerPaint={transientPointerPaint}
              />
              {renderDocumentLayers ? (
                <div data-editor-document-layer-host="true">
                  {renderDocumentLayers(context)}
                </div>
              ) : null}
            </div>
            {interactionEnabled ? (
              <DocumentRuntimeMount
                listElement={listElement}
                blockDom={blockDomReader}
                textAnchorResolver={globalSelection.textAnchorResolver}
                captureStructuralSelection={
                  globalSelection.captureStructuralSelection
                }
                composition={globalSelection.composition}
                documentLayerKeyboard={documentLayerInteractions.keyboard}
                textGestureArbitration={textGestureArbitration}
                onTransientPointerPaintChange={setTransientPointerPaint}
                onSelectionDragStart={onSelectionDragStart}
                onSelectionDragUpdate={onSelectionDragUpdate}
                onSelectionDragEnd={onSelectionDragEnd}
              />
            ) : null}
          </div>
        </EditorTextGestureArbitrationProvider>
      </SelectionProvider>
    </EditorDocumentGeometryRegistrationProvider>
  );
}

interface SequenceProps {
  readonly editor: EditableEditorRuntimePort;
  readonly selectionController: SelectionController;
  readonly blockDomRegistrar: EditorBlockDomRegistryRegistrar;
  readonly childOrderProjection?: EditorDocumentProps["childOrderProjection"];
}

function RootChildSequenceRuntime(props: SequenceProps) {
  const blockIds = useRootBlockIds(props.editor);
  return blockIds.map((blockId) => (
    <SubscribedBlockShell
      key={blockId}
      {...props}
      blockId={blockId}
      expectedParentId={null}
      isRootBlock={true}
    />
  ));
}

/** Owns only the root child-ID sequence subscription. */
const RootChildSequence = memo(RootChildSequenceRuntime);

function ChildSequenceRuntime({
  parentId,
  ...props
}: SequenceProps & { readonly parentId: BlockId }) {
  const blockIds = useProjectedChildBlockIds(
    props.editor,
    parentId,
    props.childOrderProjection,
  );
  return blockIds.map((blockId) => (
    <SubscribedBlockShell
      key={blockId}
      {...props}
      blockId={blockId}
      expectedParentId={parentId}
    />
  ));
}

/** Owns one wrapper's child-ID order and creates no DOM or fragment. */
const ChildSequence = memo(ChildSequenceRuntime);

interface SubscribedBlockShellProps extends SequenceProps {
  readonly blockId: BlockId;
  readonly expectedParentId: BlockId | null;
  readonly isRootBlock?: boolean;
}

const SubscribedBlockShell = memo(function SubscribedBlockShell({
  blockId,
  expectedParentId,
  isRootBlock = false,
  editor,
  selectionController,
  blockDomRegistrar,
  childOrderProjection,
}: SubscribedBlockShellProps) {
  const block = useSubscribedBlock(editor, blockId);
  const descendantSequence = useMemo(
    () => (
      <ChildSequence
        parentId={blockId}
        editor={editor}
        childOrderProjection={childOrderProjection}
        selectionController={selectionController}
        blockDomRegistrar={blockDomRegistrar}
      />
    ),
    [
      blockId,
      editor,
      childOrderProjection,
      selectionController,
      blockDomRegistrar,
    ],
  );
  if (!isCurrentCanonicalChild(block, expectedParentId)) return null;
  const definition = editor.definition.blocks[block.type];
  return (
    <BlockShell
      block={block}
      editor={editor}
      selectionController={selectionController}
      blockDomRegistrar={blockDomRegistrar}
      rootLayout={isRootBlock ? (definition?.rootLayout ?? "normal") : null}
    >
      {definition?.kind === "wrapper" ? descendantSequence : undefined}
    </BlockShell>
  );
});

function isCurrentCanonicalChild(
  block: VersionedBlock | null,
  expectedParentId: BlockId | null,
): block is VersionedBlock {
  return Boolean(
    block && !block.tombstone && (block.parentId ?? null) === expectedParentId,
  );
}

function useRootBlockIds(editor: EditableEditorRuntimePort): readonly BlockId[] {
  return useSyncExternalStore(
    (listener) => editor.subscribeRootBlockIds(listener),
    () => editor.getRootBlockIds(),
    () => editor.getRootBlockIds(),
  );
}

function useProjectedChildBlockIds(
  editor: EditableEditorRuntimePort,
  parentId: BlockId,
  projection: EditorDocumentProps["childOrderProjection"],
): readonly BlockId[] {
  const cached = useRef<readonly BlockId[]>([]);
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribeCanonical = editor.subscribeChildBlockIds(
        parentId,
        listener,
      );
      const unsubscribeProjection = projection?.subscribe(parentId, listener);
      return () => {
        unsubscribeProjection?.();
        unsubscribeCanonical();
      };
    },
    [editor, parentId, projection],
  );
  const getSnapshot = useCallback(() => {
    const canonical = editor.getChildBlockIds(parentId);
    const requested = projection?.getProjectedChildIds(parentId, canonical);
    const accepted =
      requested && isExactBlockIdPermutation(canonical, requested)
        ? requested
        : canonical;
    if (sameBlockSequence(cached.current, accepted)) return cached.current;
    cached.current = accepted;
    return accepted;
  }, [editor, parentId, projection]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function isExactBlockIdPermutation(
  canonical: readonly BlockId[],
  projected: readonly BlockId[],
): boolean {
  if (canonical.length !== projected.length) return false;
  const canonicalIds = new Set(canonical);
  if (canonicalIds.size !== canonical.length) return false;
  const projectedIds = new Set(projected);
  return (
    projectedIds.size === projected.length &&
    projected.every((blockId) => canonicalIds.has(blockId))
  );
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

function useSubscribedBlock(
  editor: EditableEditorRuntimePort,
  blockId: BlockId,
): VersionedBlock | null {
  return useSyncExternalStore(
    (listener) => editor.subscribeBlock(blockId, listener),
    () => editor.getBlock(blockId),
    () => editor.getBlock(blockId),
  );
}
