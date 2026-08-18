import type { EditorWithBlockOperations } from "@repo/editor-web/block-operations";
import type {
  BlockRendererProps,
  EditorRenderPort,
} from "@repo/editor-web/block-renderer";

export type FirstDraftEditor = EditorWithBlockOperations;

export type FirstDraftEditorRenderPort = EditorRenderPort<FirstDraftEditor>;

export type FirstDraftBlockRendererProps = BlockRendererProps<FirstDraftEditor>;
