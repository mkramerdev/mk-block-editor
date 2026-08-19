import type {
  EditorInstanceSnapshot,
  ValidatedEditorInstanceSnapshot,
} from "@repo/editor-core/codecs";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorContentRuntime } from "@repo/editor-core/content";
import type { TextPlaceholder } from "@repo/editor-dom/block-editor";
import {
  EditorImplementation,
  createInitialEditorManifestState,
  type EditorCommandState,
} from "@repo/editor-react/editor";
import {
  createEditorExternalStore,
  createInitialEditorSessionState,
} from "@repo/editor-react/store";
import type { EditorSelectionTextAnchorResolver } from "@repo/editor-react/selection";
import {
  createEditorLogicalSelectionPoint,
  createEditorSelectionTextAnchor,
} from "@repo/editor-react/selection";
import { createEditorContentRuntime } from "../content/content-runtime.ts";
import { createEditorContentRuntimeResources } from "../content/runtime-resources.ts";
import type { EditableEditorDefinition } from "../definition/contracts.ts";
import type { CompiledCanonicalEditorDefinition } from "../definition/compiled-editor-definition.ts";
import { createEditorBlockSliceFromEditor } from "../snapshot/snapshot-materialization.ts";
import type { EditableEditor, EditorChangeCallback } from "./contracts.ts";
import type { EditableEditorRuntimePort } from "./render-port.ts";
import { createEditorTypingTriggerApi } from "../typing-triggers/editor-typing-trigger-api.ts";
import { EditorTypingTriggerSessionController } from "../typing-triggers/session-controller.ts";
import {
  assertValidEditorSnapshotForStartupOrRecovery,
  createEditorContentStartup,
  materializeVersionedEditorBlocks,
} from "./snapshot-initialization.ts";
import type { EditorBlockDomRegistryReader } from "../../document/blocks/block-dom-registry.ts";
import type { EditorBlockCommandRequest } from "@repo/editor-react/editor";
import { DocumentTextEditingRuntime } from "./document-text-editing-runtime.ts";
import { createEditorDocumentGeometryOwner } from "../../document/geometry/editor-document-geometry.ts";
import { createEditableDocumentRuntimeMount } from "./editable-document-runtime-mount.tsx";
import { registerEditorRuntimePort } from "./runtime-port-registry.ts";
import { AdditionalSelectionManager } from "../collaboration/additional-selection-manager.ts";
import {
  createRemoteTransactionCoordinator,
  type RemoteCanonicalState,
  type RemoteTransactionCanonicalHost,
} from "../collaboration/remote-transaction-coordinator.ts";
import { finalizeCanonicalEditorCommit } from "./canonical-commit-finalizer.ts";
import { NativeFocusCoordinator } from "./native-focus-coordinator.ts";
import { InlineAtomPortalRegistry } from "../content/inline-atom-portal-registry.tsx";

export interface InitializeEditableEditorOptions {
  readonly compiledDefinition: CompiledCanonicalEditorDefinition<EditableEditorDefinition>;
  readonly snapshot: EditorInstanceSnapshot;
  readonly validatedSnapshot?: ValidatedEditorInstanceSnapshot;
  readonly onChange?: EditorChangeCallback | null;
  readonly onChangeError?: ((error: Error) => void) | null;
  readonly createTransactionId?: () => string;
}

interface ConcreteEditor extends EditableEditorRuntimePort {
  registerCleanup(cleanup: () => void): void;
}

interface EditableEditorCapability {
  readonly editor: ConcreteEditor;
  readonly contentRuntime: EditorContentRuntime;
  readonly contentResources: ReturnType<
    typeof createEditorContentRuntimeResources
  >;
  readonly typingTriggerController: EditorTypingTriggerSessionController | null;
  readonly text: DocumentTextEditingRuntime;
  readonly nativeFocus: NativeFocusCoordinator;
  blockShellRegistry: EditorBlockDomRegistryReader | null;
  blockShellRegistryToken: symbol | null;
}

const editableEditorCapabilities = new WeakMap<
  EditableEditor,
  EditableEditorCapability
>();

export function initializeEditableEditor({
  compiledDefinition,
  snapshot,
  validatedSnapshot,
  onChange,
  onChangeError,
  createTransactionId,
}: InitializeEditableEditorOptions): EditableEditor {
  const definition = compiledDefinition.definition;
  const commands = compiledDefinition.commands;
  const keybindings = compiledDefinition.keybindings;
  if (validatedSnapshot) {
    snapshot = validatedSnapshot.snapshot;
  } else {
    assertValidEditorSnapshotForStartupOrRecovery(snapshot, compiledDefinition);
  }

  const sessionStartedAt = Date.now();
  const store = createEditorExternalStore(
    createInitialEditorSessionState({
      blockGraphVersion: snapshot.blockGraphVersion,
      createdAt: sessionStartedAt,
      updatedAt: sessionStartedAt,
    }),
  );
  const inlineAtomPortals = new InlineAtomPortalRegistry();
  const contentResources = createEditorContentRuntimeResources({
    compiledDefinition,
    inlineAtomPortals,
  });
  const contentStartup = createEditorContentStartup(
    snapshot,
    definition,
    validatedSnapshot,
  );
  const contentRuntime = definition.content?.createRuntime
    ? definition.content.createRuntime(contentStartup)
    : createEditorContentRuntime(contentStartup);
  const geometryOwner = createEditorDocumentGeometryOwner();
  let rollbackConstruction = () => {
    inlineAtomPortals.dispose();
    geometryOwner.dispose();
    contentRuntime.destroy();
  };
  try {
    // The semantic bridge closes over the editor but cannot run until the
    // controller has finished constructing.
    // eslint-disable-next-line prefer-const
    let editor: ConcreteEditor;
    let editableCapability: EditableEditorCapability | null = null;
    let typingTriggerController: EditorTypingTriggerSessionController | null =
      null;
    const createdEditor = new EditorImplementation({
      store,
      manifest: createInitialEditorManifestState({
        blockGraphVersion: snapshot.blockGraphVersion,
        blocks: materializeVersionedEditorBlocks(
          snapshot.blocks,
          snapshot.blockGraphVersion,
          definition.blocks,
        ),
        rootBlockIds: snapshot.rootBlockIds,
        childIdsByParentId: snapshot.childIdsByParentId,
        createdAt: sessionStartedAt,
        updatedAt: sessionStartedAt,
      }),
      blockDefinitions: definition.blocks,
      defaultRootBlockType: definition.defaultRoot,
      documentValidators: definition.documentValidators,
      inlineMarks: definition.inlineMarks,
      inlineAtomRichTextTypes: [...contentResources.inlineAtomTypes],
      inlineAtoms: definition.inlineAtoms.map(({ type, metadata }) => ({
        type,
        metadata,
      })),
      contentCommit: contentRuntime,
      readBlockPlainText: contentRuntime.readBlockPlainText,
      readBlockContent: contentRuntime.readBlockProjection,
      resolveSelectionTextAnchor:
        createSelectionTextAnchorResolver(contentRuntime),
      createSelectionTextAnchor: (input) => {
        const created = contentRuntime.tryCreateTextAnchorInLiveContext(input);
        if (!created.ok) return { ok: false };
        const anchor = createEditorSelectionTextAnchor({
          codec: created.codec,
          payload: created.payload,
        });
        return anchor.ok
          ? {
              ok: true,
              textAnchor: anchor.textAnchor,
              textOffset: created.textOffset,
            }
          : { ok: false };
      },
      acquireTextContentAccess: (blockId) => {
        const block = editor.getBlock(blockId);
        if (
          !block ||
          block.tombstone ||
          definition.blocks[block.type]?.kind !== "text"
        ) {
          return null;
        }
        const lease = contentRuntime.acquireBlockContent(
          block.id,
          block.type,
          "canonical-transaction",
        );
        return () => lease.release();
      },
      onCanonicalCommit: (commit) => {
        if (editor.isDisposed()) return;
        finalizeCanonicalEditorCommit(commit, {
          editor,
          contentRuntime,
          blockDefinitions: definition.blocks,
          typingTriggerController,
          onChange,
          onChangeError,
        });
      },
      createTransactionId,
      requestNativeFocus: (request) => {
        const result = editableCapability?.nativeFocus.request(request) ?? {
          status: "rejected",
          reason: "disposed" as const,
        };
        if (result.status === "focused" && request.targetKind === "atomic") {
          editableCapability?.text.clear();
        }
        return result;
      },
      requestNativePresentation: (request) => {
        if (request.targetKind === "text") {
          const canonical = editor.selectionController.getCanonicalSnapshot();
          const focus =
            canonical.kind === "document"
              ? canonical.snapshot.documentSelection.focus
              : null;
          if (
            !focus?.textAnchor ||
            focus.blockId !== request.blockId ||
            !editableCapability
          ) {
            return { status: "rejected" as const, reason: "stale-selection" };
          }
          return editableCapability.text.present(request.blockId, {
            offset: focus.textOffset,
            affinity: focus.affinity,
            preventScroll: request.preventScroll,
            canonicalSelectionRevision: canonical.revision,
          });
        }
        const result = editableCapability?.nativeFocus.requestPresentation(
          request,
        ) ?? { status: "rejected" as const, reason: "disposed" as const };
        if (result.status === "focused" && request.targetKind === "atomic") {
          editableCapability?.text.clear();
        }
        return result;
      },
      releaseNativeFocus: (blockId, targetKind) => {
        editableCapability?.nativeFocus.release(blockId, targetKind);
        if (targetKind === "text") editableCapability?.text.clear();
      },
      presentTextProjection: (blockId, focusOptions) => {
        return (
          editableCapability?.text.present(blockId, {
            offset: focusOptions.offset ?? 0,
            canonicalSelectionRevision: focusOptions.canonicalSelectionRevision,
            affinity: focusOptions.affinity ?? null,
            preventScroll: focusOptions.preventScroll,
          }) ?? { status: "rejected" as const, reason: "stale-selection" }
        );
      },
      canPresentTextProjection: (blockId) =>
        editableCapability?.text.canPresent(blockId) ?? false,
      hasActiveTextProjection: (blockId) =>
        editableCapability?.text.isActive(blockId) ?? false,
      blurEditor: () => {
        editableCapability?.nativeFocus.blurEditor();
        editableCapability?.text.clear();
      },
      executeTextCommand: (blockId, request) =>
        editableCapability?.text.executeCommand(blockId, request) ?? false,
      readTextPlainText: (blockId) =>
        editableCapability?.text.readPlainText(blockId) ?? null,
    });
    editor = createdEditor as ConcreteEditor;
    const nativeFocus = new NativeFocusCoordinator({
      validateTarget(blockId, kind) {
        const block = editor.getBlock(blockId);
        const definition = block
          ? editor.definition.blocks[block.type]
          : undefined;
        const model = editor.readBlockSelectionModel(blockId);
        return Boolean(
          block &&
          !block.tombstone &&
          model?.projection.selectable &&
          (kind === "text"
            ? definition?.kind === "text" &&
              model.projection.endpoint.kind === "content"
            : definition?.kind === "atomic" &&
              model.projection.endpoint.kind === "block"),
        );
      },
      consumePending(request) {
        editor.completePendingNativeFocus(request);
      },
      consumePresentation(request) {
        if (request.targetKind === "text") {
          const canonical = editor.selectionController.getCanonicalSnapshot();
          const focus =
            canonical.kind === "document"
              ? canonical.snapshot.documentSelection.focus
              : null;
          if (focus?.blockId === request.blockId && focus.textAnchor) {
            editableCapability?.text.present(request.blockId, {
              offset: focus.textOffset,
              affinity: focus.affinity,
              preventScroll: request.preventScroll,
              canonicalSelectionRevision: canonical.revision,
            });
          }
        } else {
          editableCapability?.text.clear();
        }
      },
    });
    const compiledTypingTriggers = compiledDefinition.typingTriggers;
    typingTriggerController =
      compiledTypingTriggers.definitions.length === 0
        ? null
        : new EditorTypingTriggerSessionController(compiledTypingTriggers, {
            getBlock: (blockId) => editor.getBlock(blockId),
            readBlockContent: (blockId, blockType) =>
              contentRuntime.readBlockProjection(blockId, blockType),
            readCollapsedDocumentSelection: () => {
              const canonical =
                editor.selectionController.canonical.getSnapshot();
              if (canonical.kind !== "document") return null;
              const selection = canonical.snapshot;
              const anchor = selection.endpoints.anchor;
              const head = selection.endpoints.head;
              if (
                !anchor ||
                !head ||
                anchor.blockId !== head.blockId ||
                anchor.blockType !== head.blockType ||
                anchor.textOffset !== head.textOffset
              ) {
                return null;
              }
              return {
                blockId: head.blockId,
                blockType: head.blockType,
                offset: head.textOffset,
                selectionRevision: selection.revision,
              };
            },
          });
    editor.registerCleanup(() => contentRuntime.destroy());
    if (typingTriggerController) {
      editor.registerCleanup(() => typingTriggerController.dispose());
    }
    rollbackConstruction = () => editor.dispose();
    const text = new DocumentTextEditingRuntime({
      editor,
      ownsRegisteredTarget: (blockId, target) =>
        nativeFocus.hasRegisteredTarget(blockId, "text", target),
    });
    editableCapability = {
      editor,
      contentRuntime,
      contentResources,
      typingTriggerController,
      text,
      nativeFocus,
      blockShellRegistry: null,
      blockShellRegistryToken: null,
    };

    const additionalSelections = new AdditionalSelectionManager({
      compiledDefinition,
      graph: editor,
      contentRuntime,
    });
    const remoteHost: RemoteTransactionCanonicalHost = {
      definition,
      contentRuntime,
      selectionController: editor.selectionController,
      isDisposed: () => editor.isDisposed(),
      getBlock: (blockId) => editor.getBlock(blockId),
      getParentId: (blockId) => editor.getParentId(blockId),
      getRootBlockIds: () => editor.getRootBlockIds(),
      getChildBlockIds: (blockId) => editor.getChildBlockIds(blockId),
      readBlockSelectionModel: (blockId) =>
        editor.readBlockSelectionModel(blockId),
      getSelectionGraphRevision: () => editor.getSelectionGraphRevision(),
      readRemoteCanonicalState(): RemoteCanonicalState {
        const state = editor.getCommandState();
        return {
          blockGraphVersion: state.blockGraphVersion,
          blocks: state.blocks,
          rootBlockIds: state.rootBlockIds,
          childIdsByParentId: state.childIdsByParentId,
        };
      },
      commitValidatedRemoteTransaction(input) {
        const current = editor.getCommandState();
        const nextState = createRemoteEditorCommandState(
          current,
          input.nextState,
        );
        editor.commitValidatedRemoteTransaction({
          nextState,
          validatedContent: input.validatedContent,
          candidateBlockIds: input.changedBlockIds,
          contentChangedBlockIds: input.contentChangedBlockIds,
          afterCanonicalStateInstalled: input.afterCanonicalStateInstalled,
        });
        reconcileTypingTriggersAfterRemoteChange(
          typingTriggerController,
          input.changedBlockIds,
        );
        return editor.getSelectionGraphRevision();
      },
    };
    const remoteTransactions = createRemoteTransactionCoordinator({
      host: remoteHost,
      additionalSelections,
    });
    Object.defineProperty(editor, "editable", {
      value: true,
      writable: false,
      configurable: false,
      enumerable: true,
    });
    Object.assign(editor, {
      definition,
      commands,
      keybindings,
      geometry: geometryOwner.reader,
      geometryRegistration: geometryOwner.registration,
      DocumentRuntimeMount: createEditableDocumentRuntimeMount(editor),
      contentResources,
      compiledDefinition,
      contentRuntime,
      additionalSelections,
      createSelectionTextPoint(
        blockId: BlockId,
        textOffset: number,
        affinity:
          | import("@repo/editor-react/selection").EditorSelectionTextAffinity
          | null = null,
      ) {
        const block = editor.getBlock(blockId);
        if (!block || block.tombstone) return null;
        const created = contentRuntime.tryCreateTextAnchorInLiveContext({
          blockId,
          blockType: block.type,
          textOffset,
          affinity,
        });
        if (!created.ok) return null;
        const stable = createEditorSelectionTextAnchor({
          codec: created.codec,
          payload: created.payload,
        });
        return stable.ok
          ? createEditorLogicalSelectionPoint({
              blockId,
              textOffset: created.textOffset,
              textAnchor: stable.textAnchor,
              affinity,
              graph: editor,
            })
          : null;
      },
      applyRemoteTransaction: remoteTransactions.applyRemoteTransaction,
      readSnapshot() {
        const manifest = editor.getManifestData();
        const blockIds = Object.values(manifest.blocks)
          .filter((block) => !block.tombstone)
          .map((block) => block.id);
        const slice = createEditorBlockSliceFromEditor(
          editor,
          contentRuntime,
          definition.blocks,
          { affectedBlockIds: blockIds },
        );
        const opaqueContentCheckpoints = Object.fromEntries(
          blockIds.flatMap((blockId) => {
            const checkpoint = contentRuntime.readOpaqueBlockState(blockId);
            return checkpoint ? [[blockId, checkpoint] as const] : [];
          }),
        );
        return {
          blockGraphVersion: slice.blockGraphVersion,
          blocks: slice.blocks,
          rootBlockIds: slice.rootBlockIds,
          childIdsByParentId: slice.childIdsByParentId,
          content: slice.content,
          opaqueContentCheckpoints,
        };
      },
      setSelections(snapshot) {
        additionalSelections.replace(snapshot);
      },
      ...createEditorTypingTriggerApi(editor, typingTriggerController),
      isTextProjectionActive(blockId: BlockId) {
        return editableCapability?.text.isActive(blockId) ?? false;
      },
      acquireTextEditingDocument() {
        return (
          editableCapability?.text.acquireDocumentMount() ?? (() => undefined)
        );
      },
      subscribeToTextBlockActivity(blockId: BlockId, listener: () => void) {
        return (
          editableCapability?.text.subscribeToBlockActivity(
            blockId,
            listener,
          ) ?? (() => undefined)
        );
      },
      registerTextEditingHost(input: {
        readonly blockId: BlockId;
        readonly shell: HTMLElement;
        readonly projection: HTMLElement;
        readonly slot: HTMLElement;
        readonly className: string;
        readonly placeholder?: TextPlaceholder;
      }) {
        if (!editableCapability || editor.isDisposed()) {
          return { update: () => undefined, dispose: () => undefined };
        }
        const unregisterTarget =
          editableCapability.nativeFocus.registerTextTarget(
            input.blockId,
            input.shell,
          );
        let unregisterGeometry =
          editor.geometryRegistration.registerMountedTextRoot(
            input.blockId,
            input.projection,
          );
        let disposed = false;
        const reconcileMountedTextRoot = () => {
          if (disposed || editor.isDisposed()) return;
          const activeView = editableCapability?.text.readActiveView();
          const geometryRoot =
            editableCapability?.text.isActive(input.blockId) && activeView
              ? activeView.dom
              : input.projection;
          if (
            editor.geometryRegistration.updateMountedTextRoot(
              input.blockId,
              geometryRoot,
            )
          ) {
            return;
          }
          unregisterGeometry();
          if (disposed || editor.isDisposed()) return;
          unregisterGeometry =
            editor.geometryRegistration.registerMountedTextRoot(
              input.blockId,
              geometryRoot,
            );
        };
        const unsubscribeActivity =
          editableCapability.text.subscribeToBlockActivity(
            input.blockId,
            reconcileMountedTextRoot,
          );
        const unregisterProjection =
          editableCapability.text.registerHost(input);
        reconcileMountedTextRoot();
        return {
          update(options: { readonly placeholder?: TextPlaceholder }) {
            if (!disposed) {
              editableCapability?.text.updateHostOptions(
                input.blockId,
                input.shell,
                options,
              );
            }
          },
          dispose() {
            if (disposed) return;
            disposed = true;
            unsubscribeActivity();
            unregisterProjection();
            unregisterTarget();
            unregisterGeometry();
          },
        };
      },
      acknowledgeTextActivation(
        blockId: BlockId,
        root: HTMLElement,
        canonicalOffset: number,
        nativeNode: Node,
        nativeOffset: number,
      ) {
        return (
          editableCapability?.text.acknowledgeNativeSelection(
            blockId,
            root,
            canonicalOffset,
            nativeNode,
            nativeOffset,
          ) ?? false
        );
      },
      nativeSelectionSynchronization: {
        reconcileTextSelection(
          blockId: BlockId,
          anchorOffset: number,
          focusOffset: number,
        ) {
          return (
            editableCapability?.text.reconcileNativeSelection(
              blockId,
              anchorOffset,
              focusOffset,
            ) ?? false
          );
        },
      },
      projectActiveTextSelection(
        blockId: BlockId,
        anchorOffset: number,
        focusOffset: number,
      ) {
        return (
          editableCapability?.text.projectSelection(
            blockId,
            anchorOffset,
            focusOffset,
          ) ?? false
        );
      },
      registerAtomicFocusTarget(blockId: BlockId, target: HTMLElement) {
        if (!editableCapability || editor.isDisposed()) return () => undefined;
        return editableCapability.nativeFocus.registerAtomicTarget(
          blockId,
          target,
        );
      },
      ownsNativeFocusTarget(target: EventTarget | null) {
        return editableCapability?.nativeFocus.ownsTarget(target) ?? false;
      },
      ownsActiveElement(document: Document) {
        return (
          editableCapability?.nativeFocus.ownsActiveElement(document) ?? false
        );
      },
      ownsActiveTextTarget(blockId: BlockId) {
        return (
          editableCapability?.nativeFocus.ownsRegisteredTarget(
            blockId,
            "text",
          ) ?? false
        );
      },
      requestTextPresentation(
        blockId: BlockId,
        options: {
          readonly offset: number;
          readonly canonicalSelectionRevision: number;
          readonly preventScroll?: boolean;
          readonly affinity?:
            | import("@repo/editor-react/selection").EditorSelectionTextAffinity
            | null;
        },
      ) {
        if (!editableCapability || editor.isDisposed()) return false;
        return (
          editableCapability.text.present(blockId, {
            offset: options.offset,
            canonicalSelectionRevision: options.canonicalSelectionRevision,
            affinity: options.affinity ?? null,
            preventScroll: options.preventScroll ?? true,
          }).status !== "rejected"
        );
      },
      attachBlockShellRegistry(reader: EditorBlockDomRegistryReader) {
        if (!editableCapability || editor.isDisposed()) return () => undefined;
        const token = Symbol("block-shell-registry");
        editableCapability.blockShellRegistry = reader;
        editableCapability.blockShellRegistryToken = token;
        return () => {
          if (editableCapability?.blockShellRegistryToken !== token) return;
          editableCapability.blockShellRegistry = null;
          editableCapability.blockShellRegistryToken = null;
        };
      },
      bindNativeFocusOwnerDocument(document: Document) {
        editableCapability?.nativeFocus.bindOwnerDocument(document);
      },
      readTextSelectionOffset(blockId: BlockId) {
        return editableCapability?.text.readSelectionOffset(blockId) ?? null;
      },
      executeTextCommand(blockId: BlockId, request: EditorBlockCommandRequest) {
        return (
          editableCapability?.text.executeCommand(blockId, request) ?? false
        );
      },
      setTextCompositionPinned(blockId: BlockId, pinned: boolean) {
        return (
          editableCapability?.text.setCompositionPinned(blockId, pinned) ??
          false
        );
      },
      restoreCommittedTextProjectionAfterComposition(blockId: BlockId) {
        editableCapability?.text.restoreCommittedProjectionAfterComposition(
          blockId,
        );
      },
      projectFinalizedTextContent(blockId: BlockId) {
        editableCapability?.text.projectFinalizedContent(blockId);
      },
      readActiveTextView() {
        return editableCapability?.text.readActiveView() ?? null;
      },
      getDiagnostics() {
        return {
          blockGraphVersion: editor.getEditorInfo().blockGraphVersion,
          cleanupFailureCount: editor.getCleanupFailureCount(),
        };
      },
    } satisfies Partial<ConcreteEditor>);

    editableEditorCapabilities.set(editor, editableCapability);
    const unregisterRuntimePort = registerEditorRuntimePort(editor, editor);
    if (typingTriggerController) {
      const unsubscribeTypingTriggerSelection =
        editor.selectionController.canonical.subscribe(() =>
          typingTriggerController.scheduleSelectionReconciliation(),
        );
      editor.registerCleanup(unsubscribeTypingTriggerSelection);
    }
    editor.registerCleanup(unregisterRuntimePort);
    editor.registerCleanup(
      editor.subscribeManifest(() =>
        editableCapability?.nativeFocus.cancelPending(),
      ),
    );
    editor.registerCleanup(() => additionalSelections.dispose());
    editor.registerCleanup(() => inlineAtomPortals.dispose());
    editor.registerCleanup(() => geometryOwner.dispose());
    editor.registerCleanup(() => {
      editableCapability?.text.dispose();
      editableCapability?.nativeFocus.dispose();
      if (editableCapability) {
        editableCapability.blockShellRegistry = null;
        editableCapability.blockShellRegistryToken = null;
      }
      editableEditorCapabilities.delete(editor);
    });
    return editor as EditableEditor;
  } catch (error) {
    try {
      rollbackConstruction();
    } catch {
      // Preserve the construction failure. Editor disposal drains and reports
      // individual cleanup failures without throwing.
    }
    throw error;
  }
}

function createSelectionTextAnchorResolver(
  contentRuntime: EditorContentRuntime,
): EditorSelectionTextAnchorResolver["resolveTextAnchor"] {
  const resolveTextAnchor = contentRuntime.tryResolveTextAnchorInLiveContext;
  return (point) => {
    if (!point.textAnchor) {
      return { ok: false, reason: "invalid", blockId: point.blockId };
    }
    const resolved = resolveTextAnchor({
      blockId: point.blockId,
      blockType: point.blockType,
      codec: point.textAnchor.codec,
      payload: point.textAnchor.payload,
    });
    return resolved.ok
      ? {
          ok: true,
          blockId: point.blockId,
          textAnchor: point.textAnchor,
          textOffset: resolved.textOffset,
          affinity: point.affinity,
        }
      : {
          ok: false,
          reason:
            resolved.reason === "not-live" ? "missing-text" : resolved.reason,
          blockId: point.blockId,
          ...(("message" in resolved ? resolved.message : undefined) ===
          undefined
            ? {}
            : {
                message: "message" in resolved ? resolved.message : undefined,
              }),
        };
  };
}

function createRemoteEditorCommandState(
  current: EditorCommandState,
  canonical: RemoteCanonicalState,
): EditorCommandState {
  return {
    ...current,
    blockGraphVersion: canonical.blockGraphVersion,
    blocks: { ...canonical.blocks },
    rootBlockIds: [...canonical.rootBlockIds],
    childIdsByParentId: canonical.childIdsByParentId,
    updatedAt: Date.now(),
  };
}

function reconcileTypingTriggersAfterRemoteChange(
  controller: EditorTypingTriggerSessionController | null,
  blockIds: readonly BlockId[],
): void {
  try {
    controller?.reconcileRemoteMutation(blockIds);
  } catch {
    // Editable projection state cannot invalidate committed canonical state.
  }
}
