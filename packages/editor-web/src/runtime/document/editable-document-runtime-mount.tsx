"use client";

import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type { FocusEvent as ReactFocusEvent } from "react";
import { useWebFocusAdapters } from "../../document/focus/use-web-focus-adapters.ts";
import { useCommittedSelectionTextInput } from "../../document/selection/controller/committed-selection-text-input.ts";
import { useEditableClipboardEvents } from "../../document/selection/controller/editor-clipboard-events.ts";
import { useGlobalSelectionGestures } from "../../document/selection/controller/global-selection-gestures.ts";
import type { EditorDocumentRuntimeMountProps } from "./document-runtime-mount.ts";
import type { EditableEditorRuntimePort } from "./render-port.ts";
import { InlineAtomPortalHost } from "../content/inline-atom-portal-registry.tsx";

export function createEditableDocumentRuntimeMount(
  editor: EditableEditorRuntimePort,
) {
  return function EditableDocumentRuntimeMount({
    listElement,
    blockDom,
    textAnchorResolver,
    captureStructuralSelection,
    composition,
    documentLayerKeyboard,
    textGestureArbitration,
    onTransientPointerPaintChange,
    onSelectionDragStart,
    onSelectionDragUpdate,
    onSelectionDragEnd,
  }: EditorDocumentRuntimeMountProps) {
    const selectionDragCallbacksRef = useRef({
      onSelectionDragStart,
      onSelectionDragUpdate,
      onSelectionDragEnd,
    });
    useLayoutEffect(() => {
      selectionDragCallbacksRef.current = {
        onSelectionDragStart,
        onSelectionDragUpdate,
        onSelectionDragEnd,
      };
    }, [onSelectionDragEnd, onSelectionDragStart, onSelectionDragUpdate]);
    const handleSelectionDragStart = useCallback<
      NonNullable<EditorDocumentRuntimeMountProps["onSelectionDragStart"]>
    >((snapshot) => {
      selectionDragCallbacksRef.current.onSelectionDragStart?.(snapshot);
    }, []);
    const handleSelectionDragUpdate = useCallback<
      NonNullable<EditorDocumentRuntimeMountProps["onSelectionDragUpdate"]>
    >((snapshot) => {
      selectionDragCallbacksRef.current.onSelectionDragUpdate?.(snapshot);
    }, []);
    const handleSelectionDragEnd = useCallback<
      NonNullable<EditorDocumentRuntimeMountProps["onSelectionDragEnd"]>
    >((snapshot) => {
      selectionDragCallbacksRef.current.onSelectionDragEnd?.(snapshot);
    }, []);
    const shouldPublishSelectionDrag = useCallback(
      () =>
        Boolean(
          selectionDragCallbacksRef.current.onSelectionDragStart ||
          selectionDragCallbacksRef.current.onSelectionDragUpdate ||
          selectionDragCallbacksRef.current.onSelectionDragEnd,
        ),
      [],
    );
    useLayoutEffect(
      () => editor.attachBlockShellRegistry(blockDom),
      [blockDom],
    );
    useLayoutEffect(() => {
      if (listElement) {
        editor.bindNativeFocusOwnerDocument(listElement.ownerDocument);
      }
    }, [listElement]);
    useLayoutEffect(() => {
      const releaseEditorDocument = editor.acquireEditableDocument();
      const releaseTextEditingDocument = editor.acquireTextEditingDocument();
      return () => {
        releaseTextEditingDocument();
        releaseEditorDocument();
      };
    }, []);
    const releaseComposition = useCommittedSelectionTextInput({
      enabled: true,
      listElement,
      editor,
      selectionController: editor.selectionController,
      composition,
    });
    const focus = useWebFocusAdapters({
      editor,
      listElement,
      releaseComposition,
    });
    useEffect(() => {
      if (!listElement) return;
      const handleFocusOut = (event: FocusEvent) =>
        focus.handleListBlur(
          event as unknown as ReactFocusEvent<HTMLDivElement>,
        );
      listElement.addEventListener("focusout", handleFocusOut);
      return () => {
        listElement.removeEventListener("focusout", handleFocusOut);
      };
    }, [focus, listElement]);
    useEditableClipboardEvents({
      listElement,
      definition: editor.definition,
      contentResources: editor.contentResources,
      editor,
      contentRuntime: editor.contentRuntime,
      selectionController: editor.selectionController,
      textAnchorResolver,
      captureStructuralSelection,
    });
    useGlobalSelectionGestures({
      listElement,
      blockDom,
      editor,
      contentRuntime: editor.contentRuntime,
      selectionController: editor.selectionController,
      captureStructuralSelection,
      documentLayerKeyboard,
      textGestureArbitration,
      onTransientPointerPaintChange,
      onSelectionDragStart: handleSelectionDragStart,
      onSelectionDragUpdate: handleSelectionDragUpdate,
      onSelectionDragEnd: handleSelectionDragEnd,
      shouldPublishSelectionDrag,
    });
    return (
      <InlineAtomPortalHost
        registry={editor.contentResources.inlineAtomPortals}
      />
    );
  };
}
