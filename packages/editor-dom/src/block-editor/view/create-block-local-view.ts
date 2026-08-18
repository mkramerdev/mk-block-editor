import { EditorView } from "../../prosemirror/index.ts";
import { getBlockEditorAttributes } from "../accessibility/attributes.ts";
import { createBlockLocalProseMirrorState } from "../state/create-block-local-state.ts";
import { createBlockDispatch } from "../transactions/dispatch.ts";
import type { BlockLocalDomPluginOptions } from "../options/plugin-options.ts";
import type { CreateBlockLocalProseMirrorViewOptions } from "../options/view-options.ts";
import { createBlockLocalNodeViews } from "./node-view-registry.ts";

export function createBlockLocalProseMirrorView(
  options: CreateBlockLocalProseMirrorViewOptions,
): EditorView {
  return new EditorView(
    { mount: options.mount },
    createBlockLocalProseMirrorViewProps(options),
  );
}

export function createBlockLocalProseMirrorViewProps(
  options: CreateBlockLocalProseMirrorViewOptions,
) {
  const {
    blockId,
    blockType,
    state: providedState,
    doc,
    schema,
    documentMapping,
    pluginOptions: providedPluginOptions,
    attributes,
    nodeViews: providedNodeViews,
    proposalAdapter,
  } = options;
  const editorProps = { ...options } as Record<string, unknown>;
  for (const key of [
    "mount",
    "blockId",
    "blockType",
    "state",
    "doc",
    "schema",
    "documentMapping",
    "pluginOptions",
    "attributes",
    "nodeViews",
    "proposalAdapter",
  ]) {
    delete editorProps[key];
  }
  const state =
    providedState ??
    createBlockLocalProseMirrorState({
      blockId,
      blockType,
      doc,
      schema,
      documentMapping,
      pluginOptions: providedPluginOptions,
    });
  const pluginOptions: BlockLocalDomPluginOptions = {
    blockId,
    blockType,
    ...providedPluginOptions,
  };
  const nodeViews = createBlockLocalNodeViews(
    blockType,
    pluginOptions,
    providedNodeViews,
  );
  const viewAttributes = {
    ...getBlockEditorAttributes({
      blockId,
      blockType,
      label: pluginOptions.accessibilityLabel,
    }),
    ...attributes,
  };
  return {
    ...editorProps,
    state,
    nodeViews,
    // Browser input has already established the native selection in this
    // block-local view. Scrolling it from updateState forces synchronous
    // layout on every accepted character; explicit editor navigation owns
    // scrolling at its presentation boundary instead.
    handleScrollToSelection: () => true,
    editable: () => pluginOptions.editable !== false,
    attributes: viewAttributes,
    dispatchTransaction: createBlockDispatch({
      blockId,
      blockType,
      proposalAdapter,
    }),
  };
}
