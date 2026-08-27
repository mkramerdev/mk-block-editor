import type { BlockId } from "@repo/editor-core/kernel";
import type { EditorSelectionTextAffinity } from "@repo/editor-react/selection";

export type NativeFocusTargetKind = "text" | "atomic";

export type ResolvedNativeFocusTarget =
  | {
      readonly kind: NativeFocusTargetKind;
      readonly blockId: BlockId;
      readonly registeredTarget: HTMLElement;
    }
  | null;

export interface PendingNativeFocusRequest {
  readonly token: symbol;
  readonly blockId: BlockId;
  readonly targetKind: NativeFocusTargetKind;
  readonly graphRevision: number;
  readonly preventScroll: boolean;
  readonly offset?: number;
  readonly placement?: "start" | "end";
  readonly affinity?: EditorSelectionTextAffinity | null;
}

export type NativeFocusRequestResult =
  | { readonly status: "focused" }
  | { readonly status: "pending" }
  | {
      readonly status: "rejected";
      readonly reason:
        | "disposed"
        | "wrong-kind"
        | "wrong-document"
        | "disconnected"
        | "native-focus-failed";
    };

interface NativeTargetRegistration {
  readonly token: symbol;
  readonly blockId: BlockId;
  readonly kind: NativeFocusTargetKind;
  readonly target: HTMLElement;
}

export interface NativeFocusCoordinatorOptions {
  readonly validateTarget: (
    blockId: BlockId,
    kind: NativeFocusTargetKind,
  ) => boolean;
  readonly consumePending: (request: PendingNativeFocusRequest) => void;
  readonly consumePresentation: (request: PendingNativeFocusRequest) => void;
  readonly ownerDocument?: Document | null;
}

/** Browser-owned focus boundary with exact, tokenized native registrations. */
export class NativeFocusCoordinator {
  private readonly registrations = {
    text: new Map<BlockId, NativeTargetRegistration>(),
    atomic: new Map<BlockId, NativeTargetRegistration>(),
  };
  private ownerDocument: Document | null;
  private readonly atomicRegistrationsByTarget = new WeakMap<
    HTMLElement,
    NativeTargetRegistration
  >();
  private pending: {
    readonly kind: "public" | "presentation";
    readonly request: PendingNativeFocusRequest;
  } | null = null;
  private disposed = false;

  constructor(private readonly options: NativeFocusCoordinatorOptions) {
    this.ownerDocument = options.ownerDocument ?? null;
  }

  registerTextTarget(blockId: BlockId, target: HTMLElement): () => void {
    return this.register(blockId, "text", target);
  }

  registerAtomicTarget(blockId: BlockId, target: HTMLElement): () => void {
    return this.register(blockId, "atomic", target);
  }

  bindOwnerDocument(ownerDocument: Document): void {
    if (this.disposed) return;
    if (this.ownerDocument && this.ownerDocument !== ownerDocument) {
      throw new Error(
        "Native focus coordinator is already bound to another document",
      );
    }
    this.ownerDocument = ownerDocument;
    for (const kind of ["text", "atomic"] as const) {
      for (const [blockId, registration] of this.registrations[kind]) {
        if (registration.target.ownerDocument !== ownerDocument) {
          if (
            registration.kind === "atomic" &&
            this.atomicRegistrationsByTarget.get(registration.target) ===
              registration
          ) {
            this.atomicRegistrationsByTarget.delete(registration.target);
          }
          this.registrations[kind].delete(blockId);
        }
      }
    }
    this.consumePendingRegistration();
  }

  request(request: PendingNativeFocusRequest): NativeFocusRequestResult {
    if (this.disposed) return { status: "rejected", reason: "disposed" };
    if (!this.options.validateTarget(request.blockId, request.targetKind)) {
      this.pending = null;
      return { status: "rejected", reason: "wrong-kind" };
    }
    const oppositeKind = request.targetKind === "text" ? "atomic" : "text";
    if (this.registrations[oppositeKind].has(request.blockId)) {
      this.pending = null;
      return { status: "rejected", reason: "wrong-kind" };
    }
    const registration = this.registrations[request.targetKind].get(
      request.blockId,
    );
    if (!registration || !this.ownerDocument) {
      this.pending = { kind: "public", request };
      return { status: "pending" };
    }
    this.pending = null;
    return this.focusRegistration(registration, request.preventScroll);
  }

  requestPresentation(
    request: PendingNativeFocusRequest,
  ): NativeFocusRequestResult {
    if (this.disposed) return { status: "rejected", reason: "disposed" };
    if (!this.options.validateTarget(request.blockId, request.targetKind)) {
      this.pending = null;
      return { status: "rejected", reason: "wrong-kind" };
    }
    const registration = this.registrations[request.targetKind].get(
      request.blockId,
    );
    if (!registration || !this.ownerDocument) {
      this.pending = { kind: "presentation", request };
      return { status: "pending" };
    }
    this.pending = null;
    return this.focusRegistration(registration, request.preventScroll);
  }

  cancelPending(): void {
    this.pending = null;
  }

  readPendingRequest(): PendingNativeFocusRequest | null {
    return this.pending?.request ?? null;
  }

  resolveTarget(target: EventTarget | null): ResolvedNativeFocusTarget {
    if (!isHTMLElement(target) || !target.isConnected) return null;
    if (this.ownerDocument && target.ownerDocument !== this.ownerDocument) {
      return null;
    }

    const atomic = this.atomicRegistrationsByTarget.get(target);
    if (atomic && this.isCurrentRegistration(atomic, target)) {
      return resolvedRegistration(atomic);
    }

    const textShell = resolveTextShell(target);
    if (!textShell || !textShell.isConnected) return null;
    if (
      target.closest("[data-editor-block-list-root='true']") !==
        textShell.closest("[data-editor-block-list-root='true']") ||
      target.closest("[data-editor-interaction-scope='true']") !==
        textShell.closest("[data-editor-interaction-scope='true']")
    ) {
      return null;
    }
    const blockShell = textShell.closest<HTMLElement>(
      "[data-editor-block-shell='true'][data-editor-block-id]",
    );
    const blockId = blockShell?.dataset.editorBlockId as BlockId | undefined;
    if (!blockId || this.registrations.atomic.has(blockId)) return null;
    const registration = this.registrations.text.get(blockId);
    if (
      !registration ||
      registration.target !== textShell ||
      !this.isCurrentRegistration(registration, textShell)
    ) {
      return null;
    }
    return resolvedRegistration(registration);
  }

  hasRegisteredTarget(
    blockId: BlockId,
    kind: NativeFocusTargetKind,
    target?: HTMLElement,
  ): boolean {
    const registration = this.registrations[kind].get(blockId);
    return Boolean(
      registration &&
      registration.target.isConnected &&
      (!target || registration.target === target),
    );
  }

  release(blockId: BlockId, kind: NativeFocusTargetKind): void {
    const target = this.registrations[kind].get(blockId)?.target;
    const active = target?.ownerDocument.activeElement ?? null;
    if (target && ownsElement(target, active) && isHTMLElement(active))
      active.blur();
  }

  blurEditor(): boolean {
    this.pending = null;
    const active = this.ownerDocument?.activeElement ?? null;
    if (!isHTMLElement(active) || !this.resolveTarget(active)) return false;
    active.blur();
    return active.ownerDocument.activeElement !== active;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.pending = null;
    for (const kind of ["text", "atomic"] as const) {
      for (const registration of this.registrations[kind].values()) {
        if (
          registration.kind === "atomic" &&
          this.atomicRegistrationsByTarget.get(registration.target) ===
            registration
        ) {
          this.atomicRegistrationsByTarget.delete(registration.target);
        }
      }
    }
    this.registrations.text.clear();
    this.registrations.atomic.clear();
    this.ownerDocument = null;
  }

  private register(
    blockId: BlockId,
    kind: NativeFocusTargetKind,
    target: HTMLElement,
  ): () => void {
    if (
      this.disposed ||
      !target.isConnected ||
      !this.options.validateTarget(blockId, kind)
    ) {
      return () => undefined;
    }
    if (this.ownerDocument && target.ownerDocument !== this.ownerDocument) {
      return () => undefined;
    }
    const registration: NativeTargetRegistration = {
      token: Symbol(`${kind}-target:${blockId}`),
      blockId,
      kind,
      target,
    };
    const previous = this.registrations[kind].get(blockId);
    if (
      previous?.kind === "atomic" &&
      this.atomicRegistrationsByTarget.get(previous.target) === previous
    ) {
      this.atomicRegistrationsByTarget.delete(previous.target);
    }
    if (kind === "atomic") {
      const previousForTarget = this.atomicRegistrationsByTarget.get(target);
      if (
        previousForTarget &&
        this.registrations.atomic.get(previousForTarget.blockId) ===
          previousForTarget
      ) {
        this.registrations.atomic.delete(previousForTarget.blockId);
      }
    }
    this.registrations[kind].set(blockId, registration);
    if (kind === "atomic") {
      this.atomicRegistrationsByTarget.set(target, registration);
    }
    this.consumePendingRegistration();
    return () => {
      if (this.registrations[kind].get(blockId)?.token !== registration.token) {
        return;
      }
      if (
        registration.kind === "atomic" &&
        this.atomicRegistrationsByTarget.get(registration.target) ===
          registration
      ) {
        this.atomicRegistrationsByTarget.delete(registration.target);
      }
      this.registrations[kind].delete(blockId);
    };
  }

  private focusRegistration(
    registration: NativeTargetRegistration,
    preventScroll: boolean,
  ): NativeFocusRequestResult {
    const { target } = registration;
    if (!target.isConnected) {
      this.registrations[registration.kind].delete(registration.blockId);
      if (
        registration.kind === "atomic" &&
        this.atomicRegistrationsByTarget.get(target) === registration
      ) {
        this.atomicRegistrationsByTarget.delete(target);
      }
      return { status: "rejected", reason: "disconnected" };
    }
    if (this.ownerDocument && target.ownerDocument !== this.ownerDocument) {
      return { status: "rejected", reason: "wrong-document" };
    }
    target.focus({ preventScroll });
    return target.ownerDocument.activeElement === target
      ? { status: "focused" }
      : { status: "rejected", reason: "native-focus-failed" };
  }

  private consumePendingRegistration(): void {
    const pending = this.pending;
    if (!pending || !this.ownerDocument) return;
    const registration = this.registrations[pending.request.targetKind].get(
      pending.request.blockId,
    );
    if (
      !registration ||
      registration.target.ownerDocument !== this.ownerDocument ||
      this.pending?.request.token !== pending.request.token
    ) {
      return;
    }
    this.pending = null;
    if (pending.kind === "public") {
      this.options.consumePending(pending.request);
      return;
    }
    const result = this.focusRegistration(
      registration,
      pending.request.preventScroll,
    );
    if (result.status === "focused") {
      this.options.consumePresentation(pending.request);
    }
  }

  private isCurrentRegistration(
    registration: NativeTargetRegistration,
    registeredTarget: HTMLElement,
  ): boolean {
    return Boolean(
      registration.target === registeredTarget &&
        registration.target.isConnected &&
        (!this.ownerDocument ||
          registration.target.ownerDocument === this.ownerDocument) &&
        this.registrations[registration.kind].get(registration.blockId) ===
          registration &&
        !this.registrations[
          registration.kind === "text" ? "atomic" : "text"
        ].has(registration.blockId),
    );
  }
}

function resolveTextShell(target: HTMLElement): HTMLElement | null {
  if (target.matches("[data-editor-text-shell='true']")) return target;
  const sharedView = target.closest<HTMLElement>(
    "[data-editor-shared-text-view='true']",
  );
  return sharedView?.closest<HTMLElement>(
    "[data-editor-text-shell='true']",
  ) ?? null;
}

function resolvedRegistration(
  registration: NativeTargetRegistration,
): Exclude<ResolvedNativeFocusTarget, null> {
  return {
    kind: registration.kind,
    blockId: registration.blockId,
    registeredTarget: registration.target,
  };
}

function ownsElement(owner: HTMLElement, candidate: Element | null): boolean {
  return (
    candidate === owner ||
    (candidate !== null &&
      owner.contains(candidate) &&
      candidate.closest("[data-editor-shared-text-view='true']") !== null)
  );
}

function isHTMLElement(target: EventTarget | null): target is HTMLElement {
  if (!target || typeof target !== "object" || !("ownerDocument" in target))
    return false;
  const candidate = target as HTMLElement;
  const HTMLElementConstructor =
    candidate.ownerDocument?.defaultView?.HTMLElement;
  return Boolean(
    HTMLElementConstructor && candidate instanceof HTMLElementConstructor,
  );
}
