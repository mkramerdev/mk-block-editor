import type { ReactNode } from "react";
import type { InlineMetadataFieldDefinition } from "@repo/editor-core/content/inline-atoms";
import type { InlineMarkDefinition } from "@repo/editor-core/content/marks";
import type { BlockType, VersionedBlock } from "@repo/editor-core/document";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockId } from "@repo/editor-core/kernel";
import type {
  CanonicalBlockFragment,
  StructuralDocumentValidator,
  StructuralTransactionPlan,
} from "@repo/editor-core/editing";
import type { EditorView } from "@repo/editor-dom/prosemirror";
import type { JsonObject } from "@repo/editor-core/kernel";
import type { JsonValue } from "@repo/editor-core/kernel";
import type { BlockSelectionCoverageResult } from "@repo/editor-core/selection";
import type { EditorBlockCommandRequest } from "@repo/editor-react/editor";
import type { ResolvedSelectionFocusTarget } from "../collaboration/contracts.ts";
import type {
  EditableEditor,
  EditorReadRuntime,
  ReadEditor,
} from "../document/contracts.ts";
import type { EditorWebBlockRenderer } from "../../document/blocks/block-renderer-contracts.ts";
import type { EditorExternalStore } from "@repo/editor-react/store";
import type {
  EditorContentRuntimeSource,
  EditorWebContentRuntime,
} from "../content/content-runtime.ts";
import type {
  EditorHtmlExportHandler,
  EditorHtmlImportHandler,
  EditorPlainTextExportHandler,
  EditorPlainTextImportHandler,
} from "../../clipboard/codec-contracts.ts";

export type WebBlockDefinition<TEditor extends EditorReadRuntime> = Omit<
  BlockDefinition,
  "renderer"
> & {
  readonly renderer: EditorWebBlockRenderer<TEditor>;
  /** Web-only semantic element used by the registered structural BlockShell. */
  readonly shellElement?: "div" | "ol" | "ul" | "li";
};

export type ReadonlyBlockDefinitions<TEditor extends EditorReadRuntime> =
  Readonly<Record<BlockType, WebBlockDefinition<TEditor>>>;

interface EditorDefinitionBase<TEditor extends EditorReadRuntime> {
  readonly blocks: ReadonlyBlockDefinitions<TEditor>;
  /** Definition-owned text block created when a structural edit removes every root. */
  readonly defaultRoot: BlockType;
  readonly inlineMarks: readonly InlineMarkDefinition[];
  readonly inlineAtoms: readonly InlineAtomDefinition[];
  readonly contentCodecs?: EditorContentCodecs;
  readonly typingTriggers?: readonly EditorTypingTriggerDefinition[];
  readonly contentImport?: EditorContentImportDefinition;
  readonly content?: EditorContentRuntimeDefinition;
  readonly documentValidators?: readonly StructuralDocumentValidator[];
  readonly blockInternalSelectionSubsystems?: readonly EditorBlockInternalSelectionSubsystemDefinition[];
  /** Product view-state projection used only while shaping document clipboard fragments. */
  readonly selectionFragment?: EditorSelectionFragmentDefinition;
}

export type ReadEditorDefinition = EditorDefinitionBase<ReadEditor>;

export interface EditableEditorDefinition
  extends EditorDefinitionBase<EditableEditor> {
  readonly commands?: readonly EditorCommandDefinition[];
  readonly keybindings?: readonly EditorKeyBinding[];
}

export type EditorDefinition = ReadEditorDefinition | EditableEditorDefinition;

export interface EditorSelectionFragmentDefinition {
  readonly resolveVisibleChildBlockIds: (input: {
    readonly blockId: BlockId;
    readonly blockType: BlockType;
    readonly childBlockIds: readonly BlockId[];
  }) => readonly BlockId[];
}

export interface EditorBlockInternalSelectionGraph {
  getBlock(blockId: BlockId): VersionedBlock | null;
  getParentId(blockId: BlockId): BlockId | null;
  getChildBlockIds(parentId: BlockId): readonly BlockId[];
}

export interface EditorBlockInternalSelectionValidationInput {
  readonly blockId: BlockId;
  readonly block: VersionedBlock;
  readonly payload: JsonValue;
  readonly mode: "remote" | "local-rebase";
  readonly graph: EditorBlockInternalSelectionGraph;
}

export type EditorBlockInternalSelectionValidationResult =
  | {
      readonly ok: true;
      readonly payload: JsonValue;
      readonly resolution: "resolved" | "unresolved";
      /** Required only when a local canonical selection is being rebased. */
      readonly localCoverage?: BlockSelectionCoverageResult;
    }
  | { readonly ok: false };

export interface EditorBlockInternalSelectionSubsystemDefinition {
  readonly id: string;
  readonly validate: (
    input: EditorBlockInternalSelectionValidationInput,
  ) => EditorBlockInternalSelectionValidationResult;
  readonly resolveFocusTarget?: (input: {
    readonly blockId: BlockId;
    readonly block: VersionedBlock;
    readonly payload: JsonValue;
    readonly graph: EditorBlockInternalSelectionGraph;
  }) => ResolvedSelectionFocusTarget | null;
  /** Presentation-only geometry anchor; never changes canonical editor focus. */
  readonly resolveDecorationTarget?: (input: {
    readonly blockId: BlockId;
    readonly block: VersionedBlock;
    readonly payload: JsonValue;
    readonly graph: EditorBlockInternalSelectionGraph;
  }) => ResolvedSelectionFocusTarget | null;
}

export interface EditorContentImportDefinition {
  readonly plainTextBlockType: BlockType;
}

export interface EditorContentRuntimeDefinition {
  readonly createRuntime: (
    source: EditorContentRuntimeSource,
  ) => EditorWebContentRuntime;
}

export interface EditorTypingTriggerDefinition {
  readonly id: string;
  readonly trigger: string;
  readonly isAllowed?: (
    context: EditorTypingTriggerActivationContext,
  ) => boolean;
}

export interface EditorTypingTriggerActivationContext {
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly trigger: string;
  readonly triggerRange: {
    readonly from: number;
    readonly to: number;
  };
  readonly textBeforeTrigger: string;
}

export interface EditorBlockCommandExecutionContext<
  TEditor extends EditableEditor = EditableEditor,
> {
  readonly definition: EditorDefinition;
  readonly store: EditorExternalStore;
  readonly editor: TEditor;
  readonly blockId: BlockId;
  readonly blockType: BlockType;
  readonly view: EditorView;
  /** Current block-local selection expressed in canonical rich-text offsets. */
  readonly textSelection: {
    readonly from: number;
    readonly to: number;
  };
  readonly executeStructuralTransaction: (plan: StructuralTransactionPlan) => {
    readonly ok: boolean;
  };
  readonly dispatchProseMirrorTransaction: EditorView["dispatch"];
  readonly request: EditorBlockCommandRequest;
}

export type EditorCommandId = string;
export type EditorCommandScope = "document" | "block";
export type EditorKeyChord = string;

export interface EditorKeyBinding {
  readonly key: EditorKeyChord;
  readonly commandId: EditorCommandId;
  readonly scope: EditorCommandScope;
}

export interface EditorDocumentCommandExecutionContext<TPayload = unknown> {
  readonly commandId: EditorCommandId;
  readonly payload: TPayload | undefined;
  readonly definition: EditorDefinition;
  readonly store: EditorExternalStore;
  readonly editor: EditableEditor;
}

export interface EditorCommandExecutionResult {
  readonly ok: boolean;
  readonly handled: boolean;
  readonly commandId: EditorCommandId;
  readonly reason?: string;
  readonly message?: string;
}

export type EditorDocumentCommandExecutor<TPayload = unknown> = (
  context: EditorDocumentCommandExecutionContext<TPayload>,
) => boolean | void | EditorCommandExecutionResult;

export type EditorDocumentCommandEnablement<TPayload = unknown> = (
  context: EditorDocumentCommandExecutionContext<TPayload>,
) => boolean;

export interface EditorDocumentCommandDefinition<TPayload = unknown> {
  readonly id: EditorCommandId;
  readonly scope: "document";
  readonly execute: EditorDocumentCommandExecutor<TPayload>;
  readonly isEnabled?: EditorDocumentCommandEnablement<TPayload>;
}

export interface EditorBlockCommandDefinition<
  TEditor extends EditableEditor = EditableEditor,
> {
  readonly id: EditorCommandId;
  readonly scope: "block";
  execute(context: EditorBlockCommandExecutionContext<TEditor>): boolean;
  isEnabled?(context: EditorBlockCommandExecutionContext<TEditor>): boolean;
}

export type EditorCommandDefinition<TPayload = unknown> =
  | EditorDocumentCommandDefinition<TPayload>
  | EditorBlockCommandDefinition;

export interface InlineAtomDefinition {
  readonly type: string;
  readonly metadata: Readonly<Record<string, InlineMetadataFieldDefinition>>;
  readonly render: (metadata: JsonObject) => ReactNode;
}

export interface EditorContentCodecs {
  readonly htmlImportHandlers?: readonly EditorHtmlImportHandler[];
  readonly htmlExportHandlers?: readonly EditorHtmlExportHandler[];
  readonly plainTextImportHandlers?: readonly EditorPlainTextImportHandler[];
  readonly plainTextExportHandlers?: readonly EditorPlainTextExportHandler[];
  readonly internalSelectionFragmentMaterializers?: readonly EditorInternalSelectionFragmentMaterializer[];
  readonly internalSelectionCutHandlers?: readonly EditorInternalSelectionCutHandler[];
}

export interface EditorInternalSelectionFragmentMaterializer {
  readonly id: string;
  readonly subsystemId: string;
  readonly materialize: (input: {
    readonly hostBlockId: BlockId;
    readonly selection: unknown;
    readonly getBlock: (blockId: BlockId) => VersionedBlock | null;
    readonly getChildBlockIds: (parentId: BlockId) => readonly BlockId[];
    readonly getParentId: (blockId: BlockId) => BlockId | null;
    readonly readBlockContent: (
      blockId: BlockId,
      blockType: BlockType,
    ) => JsonObject | null;
    readonly blockDefinitions: Readonly<Record<BlockType, BlockDefinition>>;
  }) => CanonicalBlockFragment | null;
}

export interface EditorInternalSelectionCutHandler {
  readonly id: string;
  readonly subsystemId: string;
  readonly cut: (input: {
    readonly hostBlockId: BlockId;
    readonly selection: unknown;
    readonly editor: EditableEditor;
  }) => { readonly ok: boolean; readonly changed?: boolean };
}
