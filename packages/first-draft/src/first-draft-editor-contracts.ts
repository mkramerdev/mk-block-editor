import type { EditorWithBlockOperations } from "@repo/editor-web/block-operations";
import type { BlockRendererProps } from "@repo/editor-web/block-renderer";

export type FirstDraftEditor = EditorWithBlockOperations;

export type FirstDraftResetEditor = Pick<
  FirstDraftEditor,
  | "readSnapshot"
  | "getRootBlockIds"
  | "getBlock"
  | "transaction"
  | "insertBlocks"
  | "deleteBlocks"
  | "setTransactionSelection"
>;

export type FirstDraftBlockRendererProps = BlockRendererProps<FirstDraftEditor>;
