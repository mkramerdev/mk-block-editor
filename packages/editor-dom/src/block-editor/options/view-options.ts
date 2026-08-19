import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  DirectEditorProps,
  EditorState,
  NodeViewConstructor,
  Schema,
} from "../../prosemirror/index.ts";
import type { BlockLocalDocumentMappingOptions } from "../../schema/block-local/document-mapping.ts";
import type { BlockLocalDomPluginOptions } from "./plugin-options.ts";
import type { ProseMirrorProposalAdapter } from "../transactions/proposal.ts";

export interface CreateBlockLocalProseMirrorViewOptions extends Omit<
  DirectEditorProps,
  "state" | "dispatchTransaction" | "nodeViews" | "attributes"
> {
  mount: HTMLElement;
  blockId: BlockId;
  blockType: BlockType;
  state?: EditorState;
  doc?: string | Record<string, unknown> | null;
  schema?: Schema;
  documentMapping?: BlockLocalDocumentMappingOptions;
  pluginOptions?: Partial<BlockLocalDomPluginOptions>;
  attributes?: Record<string, string>;
  nodeViews?: Record<string, NodeViewConstructor>;
  proposalAdapter: ProseMirrorProposalAdapter;
}
