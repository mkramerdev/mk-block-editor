import type { BlockId } from "@repo/editor-core/kernel";

export interface EditorBlockDomRegistryReader {
  getBlockShell(blockId: BlockId): HTMLElement | null;
}

export interface EditorBlockDomRegistryRegistrar {
  registerBlockShell(blockId: BlockId, element: HTMLElement): () => void;
}

export interface EditorBlockDomRegistryChange {
  readonly blockId: BlockId;
  readonly previous: HTMLElement | null;
  readonly current: HTMLElement | null;
}

export interface EditorBlockDomRegistry {
  readonly reader: EditorBlockDomRegistryReader;
  readonly registrar: EditorBlockDomRegistryRegistrar;
  subscribe(
    listener: (change: EditorBlockDomRegistryChange) => void,
  ): () => void;
  registeredElements(): readonly HTMLElement[];
  clear(): void;
}

export function createEditorBlockDomRegistry(): EditorBlockDomRegistry {
  interface Registration {
    readonly element: HTMLElement;
    readonly token: symbol;
  }

  const shells = new Map<BlockId, Registration>();
  const changeListeners = new Set<
    (change: EditorBlockDomRegistryChange) => void
  >();

  const notifyChange = (change: EditorBlockDomRegistryChange): void => {
    for (const listener of [...changeListeners]) listener(change);
  };
  const unregisterBlockShell = (
    blockId: BlockId,
    registration: Registration,
  ): void => {
    if (shells.get(blockId)?.token !== registration.token) return;
    shells.delete(blockId);
    notifyChange({
      blockId,
      previous: registration.element,
      current: null,
    });
  };

  const reader: EditorBlockDomRegistryReader = {
    getBlockShell(blockId) {
      return shells.get(blockId)?.element ?? null;
    },
  };
  const registrar: EditorBlockDomRegistryRegistrar = {
    registerBlockShell(blockId, element) {
      const previous = shells.get(blockId)?.element ?? null;
      const registration = { element, token: Symbol("block-shell") };
      shells.set(blockId, registration);
      notifyChange({
        blockId,
        previous,
        current: element,
      });
      return () => unregisterBlockShell(blockId, registration);
    },
  };

  return {
    reader,
    registrar,
    subscribe(listener) {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    registeredElements() {
      return [...shells.values()].map((registration) => registration.element);
    },
    clear() {
      shells.clear();
      changeListeners.clear();
    },
  };
}
