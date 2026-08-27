import type { InlineMarkCommandRange } from "@repo/editor-core/content/marks";
import type { BlockId } from "@repo/editor-core/kernel";
import {
  createEditorBlockDomRegistry,
  type EditorBlockDomRegistryReader,
  type EditorBlockDomRegistryRegistrar,
} from "../blocks/block-dom-registry.ts";
import {
  editorBlockShellSelector,
  editorTextRootSelector,
} from "../dom-markers.ts";
import { resolveEditorSelectionBoundsElement } from "../selection/bounds/selection-bounds.ts";
import {
  createSemanticDomTextLayout,
  readSemanticDomCanonicalLength,
  type SemanticDomAffinity,
  type SemanticDomTextLayout,
  type SemanticDomVerticalMovement,
  type SemanticDomVisualRowMapping,
} from "./semantic-dom-coordinates.ts";

export interface EditorDocumentRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface EditorViewportRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface EditorDocumentGeometryReader {
  getRevision(): number;
  readBlockShellRect(blockId: BlockId): EditorDocumentRect | null;
  readViewportBlockShellRect(blockId: BlockId): EditorViewportRect | null;
  readBlockSelectionRect(
    blockId: BlockId,
    target?: string | null,
  ): EditorDocumentRect | null;
  readViewportBlockSelectionRect(
    blockId: BlockId,
    target?: string | null,
  ): EditorViewportRect | null;
  readTextCaretRect(
    blockId: BlockId,
    offset: number,
    affinity?: SemanticDomAffinity,
  ): EditorDocumentRect | null;
  readTextRootRect(blockId: BlockId): EditorDocumentRect | null;
  readViewportTextCaretRect(
    blockId: BlockId,
    offset: number,
    affinity?: SemanticDomAffinity,
  ): EditorViewportRect | null;
  readTextRangeRects(
    blockId: BlockId,
    range: InlineMarkCommandRange,
  ): readonly EditorDocumentRect[];
  readTextNodeRange(
    blockId: BlockId,
    node: Node,
  ): InlineMarkCommandRange | null;
  readTextCanonicalLength(blockId: BlockId): number | null;
  readTextVisualRowBoundary(
    blockId: BlockId,
    offset: number,
    edge: "start" | "end",
    affinity?: SemanticDomAffinity,
  ): number | null;
  moveTextVertically(
    blockId: BlockId,
    offset: number,
    direction: "up" | "down",
    preferredX: number | null,
    affinity?: SemanticDomAffinity,
  ): SemanticDomVerticalMovement;
  mapTextToVisualRow(
    blockId: BlockId,
    edge: "first" | "last",
    preferredX: number,
  ): SemanticDomVisualRowMapping;
  subscribe(listener: () => void): () => void;
}

export interface EditorDocumentGeometryRegistration {
  readonly blockDomReader: EditorBlockDomRegistryReader;
  readonly blockDomRegistrar: EditorBlockDomRegistryRegistrar;
  attachDocumentHost(element: HTMLElement): () => void;
  registerMountedTextRoot(blockId: BlockId, element: HTMLElement): () => void;
  updateMountedTextRoot(blockId: BlockId, element: HTMLElement): boolean;
}

export interface EditorDocumentGeometryOwner {
  readonly reader: EditorDocumentGeometryReader;
  readonly registration: EditorDocumentGeometryRegistration;
  dispose(): void;
}

interface GeometryRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

interface DocumentProjection {
  readonly viewportLeft: number;
  readonly viewportTop: number;
}

export function createEditorDocumentGeometryOwner(): EditorDocumentGeometryOwner {
  const blockDom = createEditorBlockDomRegistry();
  const textRoots = new Map<
    BlockId,
    {
      element: HTMLElement;
      readonly token: symbol;
      removeScrollSources: () => void;
    }
  >();
  const clippingScrollSources = new Map<HTMLElement, number>();
  const subscribers = new Set<() => void>();
  let documentHost: HTMLElement | null = null;
  let documentHostToken: symbol | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let removeHostListeners: (() => void) | null = null;
  let scheduledFrame: number | null = null;
  let revision = 0;
  let disposed = false;

  const scheduleInvalidation = (): void => {
    if (disposed) return;
    if (scheduledFrame !== null) return;
    const view = documentHost?.ownerDocument.defaultView ?? null;
    if (typeof view?.requestAnimationFrame === "function") {
      scheduledFrame = view.requestAnimationFrame(publishInvalidation);
      return;
    }
    publishInvalidation();
  };

  const cancelInvalidation = (): void => {
    if (scheduledFrame === null) return;
    const view = documentHost?.ownerDocument.defaultView ?? null;
    view?.cancelAnimationFrame(scheduledFrame);
    scheduledFrame = null;
  };

  function publishInvalidation(): void {
    scheduledFrame = null;
    if (disposed) return;
    revision += 1;
    for (const subscriber of [...subscribers]) {
      try {
        subscriber();
      } catch (error) {
        reportSubscriberError(error);
      }
    }
  }

  const unregisterBlockDomListener = blockDom.subscribe((change) => {
    if (change.previous && change.previous !== change.current) {
      resizeObserver?.unobserve(change.previous);
    }
    if (
      change.current &&
      documentHost &&
      (change.current === documentHost || documentHost.contains(change.current))
    ) {
      resizeObserver?.observe(change.current);
    }
    scheduleInvalidation();
  });

  const registerClippingScrollSources = (
    textRoot: HTMLElement,
  ): (() => void) => {
    if (!documentHost) return noop;
    const sources: HTMLElement[] = [];
    for (
      let element = textRoot.parentElement;
      element;
      element = element.parentElement
    ) {
      if (isClippingElement(element)) {
        const count = clippingScrollSources.get(element) ?? 0;
        if (count === 0) {
          element.addEventListener("scroll", scheduleInvalidation, {
            passive: true,
          });
        }
        clippingScrollSources.set(element, count + 1);
        sources.push(element);
      }
      if (element === documentHost) break;
    }
    return () => {
      for (const source of sources) {
        const count = clippingScrollSources.get(source);
        if (count === undefined) continue;
        if (count > 1) {
          clippingScrollSources.set(source, count - 1);
        } else {
          clippingScrollSources.delete(source);
          source.removeEventListener("scroll", scheduleInvalidation);
        }
      }
    };
  };

  const refreshClippingScrollSources = (): void => {
    for (const registration of textRoots.values()) {
      registration.removeScrollSources();
      registration.removeScrollSources = registerClippingScrollSources(
        registration.element,
      );
    }
  };

  const detachDocumentHost = (
    host: HTMLElement,
    token: symbol | null,
    invalidate: boolean,
  ): void => {
    if (documentHost !== host || documentHostToken !== token) return;
    for (const registration of textRoots.values()) {
      registration.removeScrollSources();
      registration.removeScrollSources = noop;
    }
    removeHostListeners?.();
    removeHostListeners = null;
    resizeObserver?.disconnect();
    resizeObserver = null;
    mutationObserver?.disconnect();
    mutationObserver = null;
    cancelInvalidation();
    documentHost = null;
    documentHostToken = null;
    if (invalidate) scheduleInvalidation();
  };

  const reader: EditorDocumentGeometryReader = {
    getRevision() {
      return revision;
    },
    readBlockShellRect(blockId) {
      return readDocumentElementRect(resolveBlockShell(blockId));
    },
    readViewportBlockShellRect(blockId) {
      return readViewportElementRect(resolveBlockShell(blockId));
    },
    readBlockSelectionRect(blockId, target = null) {
      return readDocumentElementRect(resolveSelectionBounds(blockId, target));
    },
    readViewportBlockSelectionRect(blockId, target = null) {
      return readViewportElementRect(resolveSelectionBounds(blockId, target));
    },
    readTextCaretRect(blockId, offset, affinity) {
      const viewportRect = readViewportTextCaretRect(blockId, offset, affinity);
      return viewportRect ? projectViewportRectToDocument(viewportRect) : null;
    },
    readTextRootRect(blockId) {
      return readDocumentElementRect(resolveTextRoot(blockId));
    },
    readViewportTextCaretRect,
    readTextRangeRects(blockId, range) {
      const textRoot = resolveTextRoot(blockId);
      const canonicalLength = readCanonicalLength(textRoot);
      if (
        !textRoot ||
        canonicalLength === null ||
        !validRange(range, canonicalLength) ||
        range.from === range.to
      ) {
        return emptyDocumentRects;
      }
      const measured = readTextLayout(textRoot).rangeRects(
        range.from,
        range.to,
      );
      const projection = readDocumentProjection();
      if (!projection || measured.length === 0) return emptyDocumentRects;
      const clippingRects = readClippingAncestorRects(textRoot, documentHost);
      const projected = measured
        .map((rect) => intersectWithClippingRects(rect, clippingRects))
        .filter((rect): rect is GeometryRect => rect !== null)
        .map((rect) => projectViewportRectToDocument(rect, projection))
        .filter((rect): rect is EditorDocumentRect => rect !== null);
      return projected.length === 0 ? emptyDocumentRects : projected;
    },
    readTextNodeRange(blockId, node) {
      const textRoot = resolveTextRoot(blockId);
      if (
        !textRoot ||
        !node.isConnected ||
        (node !== textRoot && !textRoot.contains(node))
      ) {
        return null;
      }
      const layout = readTextLayout(textRoot);
      const mapped = layout.canonicalRangeForNode(node);
      if (!mapped) return null;
      const range = {
        from: Math.min(mapped.from, mapped.to),
        to: Math.max(mapped.from, mapped.to),
      };
      return validRange(range, layout.length) && range.from !== range.to
        ? Object.freeze(range)
        : null;
    },
    readTextCanonicalLength(blockId) {
      return readCanonicalLength(resolveTextRoot(blockId));
    },
    readTextVisualRowBoundary(blockId, offset, edge, affinity) {
      const root = resolveTextRoot(blockId);
      return root
        ? readTextLayout(root).visualRowBoundary(offset, edge, affinity)
        : null;
    },
    moveTextVertically(blockId, offset, direction, preferredX, affinity) {
      const root = resolveTextRoot(blockId);
      return root
        ? readTextLayout(root).moveVertically(
            offset,
            direction,
            preferredX,
            affinity,
          )
        : { kind: "unavailable", reason: "text-root-unmounted" };
    },
    mapTextToVisualRow(blockId, edge, preferredX) {
      const root = resolveTextRoot(blockId);
      return root
        ? readTextLayout(root).mapToVisualRow(edge, preferredX)
        : { kind: "unavailable", reason: "text-root-unmounted" };
    },
    subscribe(listener) {
      if (disposed) return noop;
      subscribers.add(listener);
      return () => subscribers.delete(listener);
    },
  };

  const registration: EditorDocumentGeometryRegistration = {
    blockDomReader: {
      getBlockShell(blockId) {
        return disposed ? null : blockDom.reader.getBlockShell(blockId);
      },
    },
    blockDomRegistrar: {
      registerBlockShell(blockId, element) {
        return disposed
          ? noop
          : blockDom.registrar.registerBlockShell(blockId, element);
      },
    },
    attachDocumentHost(element) {
      if (disposed) return noop;
      if (documentHost) {
        throw new Error(
          "An editor geometry owner cannot attach a second document host concurrently.",
        );
      }
      const token = Symbol("document-host");
      documentHost = element;
      documentHostToken = token;
      const view = element.ownerDocument.defaultView;
      const ResizeObserverConstructor =
        view?.ResizeObserver ?? globalThis.ResizeObserver;
      resizeObserver =
        typeof ResizeObserverConstructor === "function"
          ? new ResizeObserverConstructor(scheduleInvalidation)
          : null;
      resizeObserver?.observe(element);
      for (const registered of blockDom.registeredElements()) {
        if (registered === element || element.contains(registered)) {
          resizeObserver?.observe(registered);
        }
      }
      const MutationObserverConstructor =
        view?.MutationObserver ?? globalThis.MutationObserver;
      mutationObserver =
        typeof MutationObserverConstructor === "function"
          ? new MutationObserverConstructor((mutations) => {
              if (mutations.some(geometryMutationCanAffectLayout)) {
                scheduleInvalidation();
              }
            })
          : null;
      mutationObserver?.observe(element, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      const ownerDocument = element.ownerDocument;
      const visualViewport = view?.visualViewport ?? null;
      ownerDocument.addEventListener("scroll", scheduleInvalidation, true);
      view?.addEventListener("scroll", scheduleInvalidation, true);
      view?.addEventListener("resize", scheduleInvalidation);
      visualViewport?.addEventListener("scroll", scheduleInvalidation);
      visualViewport?.addEventListener("resize", scheduleInvalidation);
      ownerDocument.fonts?.addEventListener(
        "loadingdone",
        scheduleInvalidation,
      );
      removeHostListeners = () => {
        ownerDocument.removeEventListener("scroll", scheduleInvalidation, true);
        view?.removeEventListener("scroll", scheduleInvalidation, true);
        view?.removeEventListener("resize", scheduleInvalidation);
        visualViewport?.removeEventListener("scroll", scheduleInvalidation);
        visualViewport?.removeEventListener("resize", scheduleInvalidation);
        ownerDocument.fonts?.removeEventListener(
          "loadingdone",
          scheduleInvalidation,
        );
      };
      refreshClippingScrollSources();
      scheduleInvalidation();
      return () => detachDocumentHost(element, token, true);
    },
    registerMountedTextRoot(blockId, element) {
      if (disposed) return noop;
      textRoots.get(blockId)?.removeScrollSources();
      const registration = {
        element,
        token: Symbol("mounted-text-root"),
        removeScrollSources: registerClippingScrollSources(element),
      };
      textRoots.set(blockId, registration);
      scheduleInvalidation();
      return () => {
        if (textRoots.get(blockId)?.token !== registration.token) return;
        registration.removeScrollSources();
        textRoots.delete(blockId);
        scheduleInvalidation();
      };
    },
    updateMountedTextRoot(blockId, element) {
      if (disposed) return false;
      const registered = textRoots.get(blockId);
      if (!registered) return false;
      const previousShell = registered.element.closest(
        editorBlockShellSelector,
      );
      const nextShell = element.closest(editorBlockShellSelector);
      if (!previousShell || previousShell !== nextShell) return false;
      registered.element = element;
      scheduleInvalidation();
      return true;
    },
  };

  function resolveSelectionBounds(
    blockId: BlockId,
    target: string | null,
  ): HTMLElement | null {
    const shell = resolveBlockShell(blockId);
    return shell
      ? ownedMountedElement(
          resolveEditorSelectionBoundsElement(shell, blockId, { target }),
        )
      : null;
  }

  function resolveTextRoot(blockId: BlockId): HTMLElement | null {
    const shell = resolveBlockShell(blockId);
    if (!shell) return null;
    const textRoot = ownedMountedElement(
      textRoots.get(blockId)?.element ?? null,
    );
    return textRoot?.matches(editorTextRootSelector) &&
      textRoot.closest(editorBlockShellSelector) === shell
      ? textRoot
      : null;
  }

  function resolveBlockShell(blockId: BlockId): HTMLElement | null {
    const shell = ownedMountedElement(blockDom.reader.getBlockShell(blockId));
    return shell?.matches(editorBlockShellSelector) &&
      shell.dataset.editorBlockId === blockId
      ? shell
      : null;
  }

  function readViewportTextCaretRect(
    blockId: BlockId,
    offset: number,
    affinity?: SemanticDomAffinity,
  ): EditorViewportRect | null {
    const textRoot = resolveTextRoot(blockId);
    const canonicalLength = readCanonicalLength(textRoot);
    if (
      !textRoot ||
      canonicalLength === null ||
      !validOffset(offset, canonicalLength)
    ) {
      return null;
    }
    return freezeViewportRect(
      normalizeRect(readTextLayout(textRoot).caretRect(offset, affinity)),
    );
  }

  function readTextLayout(textRoot: HTMLElement): SemanticDomTextLayout {
    return createSemanticDomTextLayout(textRoot);
  }

  function readCanonicalLength(textRoot: HTMLElement | null): number | null {
    if (!textRoot) return null;
    return readSemanticDomCanonicalLength(textRoot);
  }

  function readDocumentElementRect(
    element: HTMLElement | null,
  ): EditorDocumentRect | null {
    const viewportRect = readViewportElementRect(element);
    return viewportRect ? projectViewportRectToDocument(viewportRect) : null;
  }

  function readViewportElementRect(
    element: HTMLElement | null,
  ): EditorViewportRect | null {
    const connected = ownedMountedElement(element);
    if (!connected) return null;
    return freezeViewportRect(normalizeRect(connected.getBoundingClientRect()));
  }

  function projectViewportRectToDocument(
    rect: GeometryRect,
    projection: DocumentProjection | null = readDocumentProjection(),
  ): EditorDocumentRect | null {
    if (!projection) return null;
    return freezeDocumentRect(
      normalizeRect({
        left: rect.left - projection.viewportLeft,
        top: rect.top - projection.viewportTop,
        width: rect.width,
        height: rect.height,
      }),
    );
  }

  function readDocumentProjection(): DocumentProjection | null {
    const host = connectedElement(documentHost);
    if (!host) return null;
    const hostRect = normalizeRect(host.getBoundingClientRect());
    if (!hostRect) return null;
    return {
      viewportLeft: hostRect.left + host.clientLeft - host.scrollLeft,
      viewportTop: hostRect.top + host.clientTop - host.scrollTop,
    };
  }

  function ownedMountedElement<T extends HTMLElement>(
    element: T | null,
  ): T | null {
    const host = connectedElement(documentHost);
    const connected = connectedElement(element);
    if (
      !host ||
      !connected ||
      (connected !== host && !host.contains(connected))
    ) {
      return null;
    }
    return connected;
  }

  return {
    reader,
    registration,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelInvalidation();
      if (documentHost) {
        detachDocumentHost(documentHost, documentHostToken, false);
      }
      unregisterBlockDomListener();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      for (const registration of textRoots.values()) {
        registration.removeScrollSources();
      }
      textRoots.clear();
      subscribers.clear();
      blockDom.clear();
    },
  };
}

const emptyDocumentRects = Object.freeze([]) as readonly EditorDocumentRect[];

function validOffset(offset: number, canonicalLength: number): boolean {
  return (
    Number.isSafeInteger(offset) && offset >= 0 && offset <= canonicalLength
  );
}

function validRange(
  range: InlineMarkCommandRange,
  canonicalLength: number,
): boolean {
  return (
    Number.isSafeInteger(range.from) &&
    Number.isSafeInteger(range.to) &&
    range.from >= 0 &&
    range.to >= range.from &&
    range.to <= canonicalLength
  );
}

function connectedElement<T extends HTMLElement>(element: T | null): T | null {
  return element?.isConnected ? element : null;
}

function normalizeRect(
  rect: Pick<GeometryRect, "left" | "top" | "width" | "height"> | null,
): GeometryRect | null {
  if (
    !rect ||
    !Number.isFinite(rect.left) ||
    !Number.isFinite(rect.top) ||
    !Number.isFinite(rect.width) ||
    !Number.isFinite(rect.height) ||
    rect.width < 0 ||
    rect.height < 0
  ) {
    return null;
  }
  return {
    left: rect.left,
    top: rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function freezeDocumentRect(
  rect: GeometryRect | null,
): EditorDocumentRect | null {
  return rect ? { ...rect } : null;
}

function freezeViewportRect(
  rect: GeometryRect | null,
): EditorViewportRect | null {
  return rect ? Object.freeze({ ...rect }) : null;
}

function readClippingAncestorRects(
  textRoot: HTMLElement,
  documentHost: HTMLElement | null,
): readonly GeometryRect[] {
  const rects: GeometryRect[] = [];
  for (
    let element = textRoot.parentElement;
    element;
    element = element.parentElement
  ) {
    if (isClippingElement(element)) {
      const rect = normalizeRect(element.getBoundingClientRect());
      if (rect) rects.push(rect);
    }
    if (element === documentHost) break;
  }
  return rects;
}

function isClippingElement(element: HTMLElement): boolean {
  const computed =
    element.ownerDocument.defaultView?.getComputedStyle(element) ?? null;
  return Boolean(
    computed &&
    [computed.overflow, computed.overflowX, computed.overflowY].some(
      isClippingOverflow,
    ),
  );
}

function isClippingOverflow(value: string): boolean {
  return (
    value === "hidden" ||
    value === "clip" ||
    value === "auto" ||
    value === "scroll"
  );
}

function intersectWithClippingRects(
  rect: GeometryRect,
  clippingRects: readonly GeometryRect[],
): GeometryRect | null {
  let left = rect.left;
  let top = rect.top;
  let right = rect.left + rect.width;
  let bottom = rect.top + rect.height;
  for (const clip of clippingRects) {
    left = Math.max(left, clip.left);
    top = Math.max(top, clip.top);
    right = Math.min(right, clip.left + clip.width);
    bottom = Math.min(bottom, clip.top + clip.height);
    if (right <= left || bottom <= top) return null;
  }
  return { left, top, width: right - left, height: bottom - top };
}

function geometryMutationCanAffectLayout(mutation: MutationRecord): boolean {
  const target =
    mutation.target instanceof Element
      ? mutation.target
      : mutation.target.parentElement;
  if (target?.closest(editorPresentationLayerSelector)) {
    return false;
  }
  return (
    [...mutation.addedNodes, ...mutation.removedNodes].some(
      (node) => !isPresentationOwnedNode(node),
    ) || mutation.type !== "childList"
  );
}

function isPresentationOwnedNode(node: Node): boolean {
  return (
    node instanceof Element &&
    (node.matches(editorPresentationLayerSelector) ||
      Boolean(node.closest(editorPresentationLayerSelector)))
  );
}

const editorPresentationLayerSelector =
  '[data-editor-selection-paint-layer="true"], [data-editor-document-layer-host="true"]';

function noop(): void {}

function reportSubscriberError(error: unknown): void {
  const reportError = globalThis.reportError;
  if (typeof reportError === "function") reportError(error);
}
