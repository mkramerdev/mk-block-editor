import type { BlockType } from "@repo/editor-core/document";
import type { BlockId } from "@repo/editor-core/kernel";
import type { Plugin } from "../../prosemirror/index.ts";
import type {
  BlockDomKeyBehaviorEvent,
  BlockDomKeyBehaviorResult,
} from "./key-behavior.ts";

export interface BlockPluginIdentityOptions {
  blockId: BlockId;
  blockType: BlockType;
}

export interface TextPlaceholder {
  readonly text: string;
  readonly visibility: "active" | "always";
}

export interface BlockPluginEditorOptions {
  placeholder?: TextPlaceholder;
  editable?: boolean;
  accessibilityLabel?: string;
  headingLevel?: number;
}

export interface BlockPluginExtensionOptions {
  additionalPlugins?: readonly Plugin[];
}

export interface BlockPluginKeyBehaviorOptions {
  emitBlockKeyBehavior?: (
    event: BlockDomKeyBehaviorEvent,
  ) => BlockDomKeyBehaviorResult;
}

export interface BlockPluginCompositionOptions {
  onCompositionChange?: (composing: boolean, blockId: BlockId) => void;
}

export interface BlockLocalDomPrimitiveOptions
  extends BlockPluginIdentityOptions,
    BlockPluginEditorOptions,
    BlockPluginExtensionOptions {}

export interface BlockLocalDomHostPolicyOptions
  extends BlockPluginKeyBehaviorOptions,
    BlockPluginCompositionOptions {}

export interface BlockLocalDomPluginOptions
  extends BlockLocalDomPrimitiveOptions,
    BlockLocalDomHostPolicyOptions {}
