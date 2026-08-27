import type { EditorView } from "@repo/editor-dom/prosemirror";
import type { TextPlaceholder } from "@repo/editor-dom/block-editor";
import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorBlockCommandRequest } from "@repo/editor-react/editor";
import type { EditableEditorRuntimePort } from "./render-port.ts";
import {
  OwnedTextActivationObligation,
  type TextActivationFocusMode,
  type TextActivationObligation,
  type TextActivationRequest,
} from "./text-activation.ts";
import type { NativeCaretProjectionResult } from "../../document/selection/native-caret-projection.ts";
import {
  SharedTextEditor,
  type SharedTextEditorHost,
} from "./shared-text-editor.ts";
import { textOffsetFromDomPoint } from "../../document/selection/hit-testing/text-hit-testing.ts";
import {
  sameTextDomPresentation,
  type ResolvedTextDomPresentation,
} from "../../document/blocks/text-dom-presentation.ts";

interface TextHostRegistration extends SharedTextEditorHost {
  readonly token: symbol;
  registrations: number;
}

export interface RegisterTextEditingHostInput {
  readonly blockId: BlockId;
  readonly shell: HTMLElement;
  readonly projection: HTMLElement;
  readonly slot: HTMLElement;
  readonly className: string;
  readonly placeholder?: TextPlaceholder;
  readonly textDomPresentation: ResolvedTextDomPresentation;
}

interface NativeSelectionAcknowledgement {
  readonly blockId: BlockId;
  readonly canonicalSelectionRevision: number;
  readonly canonicalTextOffset: number;
  readonly projectionIdentity: symbol;
  readonly activationIdentity: symbol;
  root: HTMLElement;
  expectedNativePoint: { readonly node: Node; readonly offset: number } | null;
  acknowledged: boolean;
}

export type TextPresentationResult =
  | { readonly status: "focused" }
  | { readonly status: "pending" }
  | {
      readonly status: "rejected";
      readonly reason: "stale-selection" | "composition-pinned";
    };

function samePlaceholder(
  left: TextPlaceholder | undefined,
  right: TextPlaceholder | undefined,
): boolean {
  return left?.text === right?.text && left?.visibility === right?.visibility;
}

class ActiveTextSession {
  readonly blockId: BlockId;
  private request: TextActivationRequest | null;
  private obligation: OwnedTextActivationObligation | null = null;
  private compositionPinned = false;
  acknowledgement: NativeSelectionAcknowledgement | null = null;

  constructor(request: TextActivationRequest) {
    this.blockId = request.blockId;
    this.request = request;
  }

  readRequest(): TextActivationRequest | null {
    return this.request;
  }

  replaceRequest(request: TextActivationRequest): void {
    this.obligation?.supersede();
    this.obligation = null;
    this.request = request;
    this.acknowledgement = null;
  }

  beginActivation(
    host: TextHostRegistration,
    obligation: OwnedTextActivationObligation,
  ): TextActivationObligation {
    this.obligation?.supersede();
    const activation = obligation.consume();
    this.obligation = obligation;
    this.request = null;
    this.acknowledgement = {
      blockId: activation.blockId,
      canonicalSelectionRevision: activation.canonicalSelectionRevision,
      canonicalTextOffset: activation.canonicalTextOffset,
      projectionIdentity: host.projectionIdentity,
      activationIdentity: activation.identity,
      root: host.slot,
      expectedNativePoint: null,
      acknowledged: false,
    };
    return activation;
  }

  installViewRoot(view: EditorView): void {
    if (this.acknowledgement) this.acknowledgement.root = view.dom;
  }

  ownsActivation(identity: symbol): boolean {
    return this.obligation?.value.identity === identity;
  }

  expectNativePoint(result: NativeCaretProjectionResult): boolean {
    if (!this.acknowledgement || result.status !== "projected") return false;
    this.acknowledgement.expectedNativePoint = result.nativePoint;
    return true;
  }

  isInputReady(view: EditorView | null): boolean {
    return Boolean(
      view &&
      view.dom.getAttribute("contenteditable") === "true" &&
      view.dom.ownerDocument.activeElement === view.dom,
    );
  }

  hasAcknowledgedPresentation(
    request: TextActivationRequest,
    host: TextHostRegistration,
    view: EditorView | null,
  ): boolean {
    const acknowledgement = this.acknowledgement;
    const activation = this.obligation?.value;
    const native = view?.dom.ownerDocument.getSelection();
    const expected = acknowledgement?.expectedNativePoint;
    return Boolean(
      acknowledgement?.acknowledged &&
      activation &&
      view &&
      acknowledgement.root === view.dom &&
      acknowledgement.blockId === request.blockId &&
      acknowledgement.canonicalSelectionRevision ===
        request.canonicalSelectionRevision &&
      acknowledgement.canonicalTextOffset === request.canonicalTextOffset &&
      acknowledgement.projectionIdentity === host.projectionIdentity &&
      activation.affinity === request.affinity &&
      expected &&
      native?.isCollapsed &&
      native.focusNode === expected.node &&
      native.focusOffset === expected.offset &&
      this.isInputReady(view),
    );
  }

  isCompositionPinned(): boolean {
    return this.compositionPinned;
  }

  prepareHostReattachment(request: TextActivationRequest): void {
    this.obligation?.cancel();
    this.obligation = null;
    this.acknowledgement = null;
    this.request = request;
  }

  setCompositionPinned(pinned: boolean): void {
    this.compositionPinned = pinned;
  }

  cancel(): void {
    this.obligation?.cancel();
    this.obligation = null;
    this.request = null;
    this.acknowledgement = null;
    this.compositionPinned = false;
  }
}

/** Stable external store for one document's single movable text editing view. */
export class DocumentTextEditingRuntime {
  private readonly hosts = new Map<BlockId, TextHostRegistration>();
  private readonly activitySubscribers = new Map<BlockId, Set<() => void>>();
  private readonly sharedEditor: SharedTextEditor;
  private session: ActiveTextSession | null = null;
  private awaitingHostReattachmentFor: BlockId | null = null;
  private documentMounted = false;
  private disposed = false;

  constructor(
    private readonly options: {
      readonly editor: EditableEditorRuntimePort;
      readonly ownsRegisteredTarget: (
        blockId: BlockId,
        target: HTMLElement,
      ) => boolean;
    },
  ) {
    this.sharedEditor = new SharedTextEditor(options.editor);
  }

  canPresent(blockId: BlockId): boolean {
    return !(
      this.session?.isCompositionPinned() && this.session.blockId !== blockId
    );
  }

  acquireDocumentMount(): () => void {
    if (this.disposed) return () => undefined;
    this.documentMounted = true;
    if (this.session) this.activateSession(this.session);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.documentMounted = false;
      const session = this.session;
      if (session) {
        const canonical =
          this.options.editor.selectionController.getCanonicalSnapshot();
        const focus = this.readCanonicalFocus(session.blockId);
        if (canonical.kind === "document" && focus) {
          session.replaceRequest({
            blockId: session.blockId,
            canonicalSelectionRevision: canonical.revision,
            canonicalTextOffset: focus.offset,
            affinity: focus.affinity,
            preventScroll: true,
          });
        } else {
          session.cancel();
          this.session = null;
        }
      }
      this.sharedEditor.releaseView();
    };
  }

  present(
    blockId: BlockId,
    options: {
      readonly offset: number;
      readonly canonicalSelectionRevision: number;
      readonly affinity?: TextActivationRequest["affinity"];
      readonly preventScroll?: boolean;
    },
  ): TextPresentationResult {
    if (this.disposed) return { status: "rejected", reason: "stale-selection" };
    const request: TextActivationRequest = {
      blockId,
      canonicalSelectionRevision: options.canonicalSelectionRevision,
      canonicalTextOffset: Math.max(0, Math.trunc(options.offset)),
      affinity: options.affinity ?? null,
      preventScroll: options.preventScroll ?? true,
    };
    const requestedHost = this.hosts.get(blockId);
    if (
      !this.isValidRequest(request) ||
      (requestedHost !== undefined && !isTextHostPresentable(requestedHost.shell))
    ) {
      return { status: "rejected", reason: "stale-selection" };
    }
    const current = this.session;
    if (current?.isCompositionPinned() && current.blockId !== blockId) {
      return { status: "rejected", reason: "composition-pinned" };
    }
    if (current?.blockId === blockId) {
      if (
        requestedHost &&
        current.hasAcknowledgedPresentation(
          request,
          requestedHost,
          this.sharedEditor.readView(),
        )
      ) {
        return { status: "focused" };
      }
      this.awaitingHostReattachmentFor = null;
      current.replaceRequest(request);
      this.activateSession(current);
      return current.isInputReady(this.sharedEditor.readView())
        ? { status: "focused" }
        : { status: "pending" };
    }

    this.options.editor.selectionController.resetKeyboardNavigation();
    const previousBlockId = current?.blockId ?? null;
    if (current) current.cancel();
    this.awaitingHostReattachmentFor = null;
    this.sharedEditor.deactivate();
    const next = new ActiveTextSession(request);
    this.session = next;
    this.activateSession(next);
    if (previousBlockId !== this.session?.blockId) {
      if (previousBlockId) this.publishActivity(previousBlockId);
      if (this.session) this.publishActivity(this.session.blockId);
    }
    return next.isInputReady(this.sharedEditor.readView())
      ? { status: "focused" }
      : { status: "pending" };
  }

  clear(): boolean {
    const session = this.session;
    if (!session) return true;
    if (
      this.awaitingHostReattachmentFor === session.blockId &&
      !this.hosts.has(session.blockId)
    ) {
      return true;
    }
    if (session.isCompositionPinned()) return false;
    this.options.editor.selectionController.resetKeyboardNavigation();
    this.session = null;
    this.awaitingHostReattachmentFor = null;
    this.sharedEditor.clearNativeSelection();
    this.sharedEditor.deactivate();
    session.cancel();
    this.publishActivity(session.blockId);
    return true;
  }

  isActive(blockId: BlockId): boolean {
    if (this.session?.blockId !== blockId) return false;
    const block = this.options.editor.getBlock(blockId);
    if (block && !block.tombstone) return true;
    const session = this.session;
    this.session = null;
    this.awaitingHostReattachmentFor = null;
    this.sharedEditor.deactivate();
    session.cancel();
    this.publishActivity(blockId);
    return false;
  }

  subscribeToBlockActivity(blockId: BlockId, listener: () => void): () => void {
    let listeners = this.activitySubscribers.get(blockId);
    if (!listeners) {
      listeners = new Set();
      this.activitySubscribers.set(blockId, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) this.activitySubscribers.delete(blockId);
    };
  }

  registerHost(input: RegisterTextEditingHostInput): () => void {
    if (this.disposed || !input.shell.isConnected) return () => undefined;
    const liveBlock = this.options.editor.getBlock(input.blockId);
    const definition = liveBlock
      ? this.options.editor.definition.blocks[liveBlock.type]
      : null;
    if (!liveBlock || liveBlock.tombstone || definition?.kind !== "text") {
      throw new Error(`Text host ${input.blockId} is not a live text block.`);
    }
    const current = this.hosts.get(input.blockId);
    if (
      current?.shell === input.shell &&
      current.projection === input.projection &&
      current.slot === input.slot
    ) {
      current.registrations += 1;
      return () => this.unregisterHost(current);
    }
    if (current) this.unregisterHost(current, true);
    const registration: TextHostRegistration = {
      ...input,
      token: Symbol(`text-host:${input.blockId}`),
      projectionIdentity: Symbol(`text-projection:${input.blockId}`),
      registrations: 1,
    };
    this.hosts.set(input.blockId, registration);
    if (this.session?.blockId === input.blockId) {
      this.awaitingHostReattachmentFor = null;
      this.activateSession(this.session);
    }
    return () => this.unregisterHost(registration);
  }

  updateHostOptions(
    blockId: BlockId,
    shell: HTMLElement,
    options: {
      readonly className: string;
      readonly placeholder?: TextPlaceholder;
      readonly textDomPresentation: ResolvedTextDomPresentation;
    },
  ): void {
    const host = this.hosts.get(blockId);
    if (!host || host.shell !== shell) return;
    if (
      host.className === options.className &&
      samePlaceholder(host.placeholder, options.placeholder) &&
      sameTextDomPresentation(
        host.textDomPresentation,
        options.textDomPresentation,
      )
    ) {
      return;
    }
    const next = {
      ...host,
      className: options.className,
      placeholder: options.placeholder,
      textDomPresentation: options.textDomPresentation,
    };
    this.hosts.set(blockId, next);
    this.sharedEditor.updateHostOptions(next);
  }

  acknowledgeNativeSelection(
    blockId: BlockId,
    root: HTMLElement,
    canonicalOffset: number,
    nativeNode: Node,
    nativeOffset: number,
  ): boolean {
    const session = this.session;
    const acknowledgement = session?.acknowledgement ?? null;
    const host = this.hosts.get(blockId);
    const view = this.sharedEditor.readView();
    const native = root.ownerDocument.getSelection();
    if (
      !session ||
      !host ||
      !acknowledgement ||
      !view ||
      view.dom !== root ||
      !session.isInputReady(view) ||
      !isTextHostPresentable(host.shell) ||
      acknowledgement.blockId !== blockId ||
      acknowledgement.root !== root ||
      acknowledgement.projectionIdentity !== host.projectionIdentity ||
      !session.ownsActivation(acknowledgement.activationIdentity) ||
      acknowledgement.canonicalTextOffset !== canonicalOffset ||
      !native?.isCollapsed ||
      native.anchorNode !== nativeNode ||
      native.focusNode !== nativeNode ||
      native.anchorOffset !== nativeOffset ||
      native.focusOffset !== nativeOffset ||
      (nativeNode !== root && !root.contains(nativeNode)) ||
      textOffsetFromDomPoint(root, nativeNode, nativeOffset) !==
        canonicalOffset ||
      !this.canonicalMatches(
        blockId,
        acknowledgement.canonicalSelectionRevision,
        canonicalOffset,
      )
    ) {
      return false;
    }
    const expected = acknowledgement.expectedNativePoint;
    if (expected?.node !== nativeNode || expected.offset !== nativeOffset) {
      if (!acknowledgement.acknowledged) return false;
      acknowledgement.expectedNativePoint = {
        node: nativeNode,
        offset: nativeOffset,
      };
    }
    acknowledgement.acknowledged = true;
    return true;
  }

  reconcileNativeSelection(
    blockId: BlockId,
    anchorOffset: number,
    focusOffset: number,
  ): boolean {
    if (!this.isActive(blockId)) return false;
    return this.sharedEditor.reconcileNativeSelectionRange(
      anchorOffset,
      focusOffset,
    );
  }

  projectSelection(
    blockId: BlockId,
    anchorOffset: number,
    focusOffset: number,
  ): boolean {
    if (!this.isActive(blockId)) return false;
    this.sharedEditor.projectSelection(anchorOffset, focusOffset);
    return true;
  }

  readSelectionOffset(blockId: BlockId): number | null {
    return this.isActive(blockId)
      ? this.sharedEditor.readSelectionOffset()
      : null;
  }

  executeCommand(
    blockId: BlockId,
    request: EditorBlockCommandRequest,
  ): boolean {
    return this.isActive(blockId)
      ? this.sharedEditor.executeCommand(request)
      : false;
  }

  readPlainText(blockId: BlockId): string | null {
    return this.isActive(blockId) ? this.sharedEditor.readPlainText() : null;
  }

  setCompositionPinned(blockId: BlockId, pinned: boolean): boolean {
    const session = this.session;
    if (!session || !this.isActive(blockId)) return false;
    session.setCompositionPinned(pinned);
    this.sharedEditor.setCompositionPinned(pinned);
    return true;
  }

  restoreCommittedProjectionAfterComposition(blockId: BlockId): void {
    if (this.isActive(blockId)) {
      this.sharedEditor.restoreCommittedProjectionAfterComposition();
    }
  }

  projectFinalizedContent(blockId: BlockId): void {
    if (this.isActive(blockId)) this.sharedEditor.projectFinalizedContent();
  }

  readActiveView(): EditorView | null {
    return this.session ? this.sharedEditor.readView() : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.session?.cancel();
    this.session = null;
    this.awaitingHostReattachmentFor = null;
    this.hosts.clear();
    this.activitySubscribers.clear();
    this.sharedEditor.destroy();
  }

  private activateSession(session: ActiveTextSession): void {
    if (!this.documentMounted) return;
    const request = session.readRequest();
    const host = this.hosts.get(session.blockId);
    if (!request || !host) return;
    if (
      !isTextHostPresentable(host.shell) ||
      !this.options.ownsRegisteredTarget(session.blockId, host.shell) ||
      !this.isValidRequest(request)
    ) {
      if (this.session === session) {
        this.sharedEditor.deactivate();
        session.cancel();
        this.session = null;
      }
      return;
    }
    const obligation = this.createObligation(request, host);
    const block = this.options.editor.getBlock(session.blockId);
    if (!block || block.tombstone) return;

    const activation = session.beginActivation(host, obligation);
    const projection = this.sharedEditor.activate(block, host, activation);
    const view = this.sharedEditor.readView();
    if (!view) return;
    session.installViewRoot(view);
    if (session.expectNativePoint(projection)) {
      this.acknowledgeInstalledActivation(session, view, activation);
    }
  }

  private acknowledgeInstalledActivation(
    session: ActiveTextSession,
    view: EditorView,
    activation: TextActivationObligation,
  ): void {
    if (
      this.session !== session ||
      view.dom.ownerDocument.activeElement !== view.dom
    ) {
      return;
    }
    const native = view.dom.ownerDocument.getSelection();
    if (
      !native?.isCollapsed ||
      !native.focusNode ||
      (native.focusNode !== view.dom && !view.dom.contains(native.focusNode)) ||
      textOffsetFromDomPoint(
        view.dom,
        native.focusNode,
        native.focusOffset,
      ) !==
        activation.canonicalTextOffset
    ) {
      return;
    }
    // Focusing an installed contenteditable may normalize an equivalent DOM
    // point (for example, from the root boundary to its first text node).
    // Record that final browser-owned node as the current activation's exact
    // projection before acknowledging it.
    session.expectNativePoint({
      status: "projected",
      nativePoint: { node: native.focusNode, offset: native.focusOffset },
    });
    this.acknowledgeNativeSelection(
      activation.blockId,
      view.dom,
      activation.canonicalTextOffset,
      native.focusNode,
      native.focusOffset,
    );
  }

  private createObligation(
    request: TextActivationRequest,
    host: TextHostRegistration,
  ): OwnedTextActivationObligation {
    const active = host.shell.ownerDocument.activeElement;
    const focusMode: TextActivationFocusMode =
      active === host.shell ||
      (active instanceof HTMLElement && host.shell.contains(active))
        ? "adopt"
        : "acquire";
    return new OwnedTextActivationObligation({
      ...request,
      identity: Symbol(`text-activation:${request.blockId}`),
      projectionIdentity: host.projectionIdentity,
      focusMode,
    });
  }

  private unregisterHost(
    registration: TextHostRegistration,
    force = false,
  ): void {
    if (this.hosts.get(registration.blockId)?.token !== registration.token)
      return;
    if (!force) registration.registrations -= 1;
    if (!force && registration.registrations > 0) return;
    this.hosts.delete(registration.blockId);
    const session = this.session;
    if (session?.blockId === registration.blockId) {
      const canonical =
        this.options.editor.selectionController.getCanonicalSnapshot();
      const focus = this.readCanonicalFocus(registration.blockId);
      if (canonical.kind === "document" && focus) {
        this.awaitingHostReattachmentFor = registration.blockId;
        session.prepareHostReattachment({
          blockId: registration.blockId,
          canonicalSelectionRevision: canonical.revision,
          canonicalTextOffset: focus.offset,
          affinity: focus.affinity,
          preventScroll: true,
        });
      } else {
        this.awaitingHostReattachmentFor = null;
        session.cancel();
        if (this.session === session) this.session = null;
        this.publishActivity(registration.blockId);
      }
      if (this.session === session) {
        this.sharedEditor.prepareHostReattachment(registration.blockId);
      } else {
        this.sharedEditor.deactivate();
      }
    }
  }

  private publishActivity(blockId: BlockId): void {
    for (const listener of [...(this.activitySubscribers.get(blockId) ?? [])]) {
      listener();
    }
  }

  private isValidRequest(request: TextActivationRequest): boolean {
    const block = this.options.editor.getBlock(request.blockId);
    return Boolean(
      block &&
      !block.tombstone &&
      this.options.editor.definition.blocks[block.type]?.kind === "text" &&
      this.canonicalMatches(
        request.blockId,
        request.canonicalSelectionRevision,
        request.canonicalTextOffset,
        request.affinity,
      ),
    );
  }

  private canonicalMatches(
    blockId: BlockId,
    revision: number,
    offset: number,
    affinity?: TextActivationRequest["affinity"],
  ): boolean {
    const canonical =
      this.options.editor.selectionController.getCanonicalSnapshot();
    if (canonical.kind !== "document" || canonical.revision !== revision)
      return false;
    const focus = canonical.snapshot.documentSelection.focus;
    return Boolean(
      focus &&
      focus.blockId === blockId &&
      focus.textAnchor !== null &&
      focus.textOffset === offset &&
      (affinity === undefined || focus.affinity === affinity),
    );
  }

  private readCanonicalFocus(blockId: BlockId): {
    readonly offset: number;
    readonly affinity: TextActivationRequest["affinity"];
  } | null {
    const canonical =
      this.options.editor.selectionController.getCanonicalSnapshot();
    if (canonical.kind !== "document") return null;
    const selection = canonical.snapshot.documentSelection;
    const focus = selection.focus;
    const anchor = selection.anchor;
    return focus?.blockId === blockId && focus.textAnchor !== null
      ? {
          offset: focus.textOffset,
          affinity:
            anchor?.blockId === focus.blockId &&
            anchor.textOffset === focus.textOffset
              ? focus.affinity
              : null,
        }
      : null;
  }
}

function isTextHostPresentable(shell: HTMLElement): boolean {
  if (!shell.isConnected) return false;
  const view = shell.ownerDocument.defaultView;
  for (let current: HTMLElement | null = shell; current; current = current.parentElement) {
    if (
      current.hidden ||
      current.getAttribute("aria-hidden") === "true" ||
      view?.getComputedStyle(current).display === "none"
    ) {
      return false;
    }
  }
  return true;
}
