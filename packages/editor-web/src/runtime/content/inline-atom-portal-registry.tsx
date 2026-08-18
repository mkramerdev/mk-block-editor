"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

interface InlineAtomPortalEntry {
  readonly id: number;
  readonly target: HTMLElement;
  readonly content: ReactNode;
}

export interface InlineAtomPortalRegistration {
  update(content: ReactNode): void;
  remove(): void;
}

/** Document-owned React portal state for every inline atom in its mounted views. */
export class InlineAtomPortalRegistry {
  private readonly entries = new Map<number, InlineAtomPortalEntry>();
  private readonly listeners = new Set<() => void>();
  private snapshot: readonly InlineAtomPortalEntry[] = [];
  private nextId = 1;
  private disposed = false;

  register(target: HTMLElement, content: ReactNode): InlineAtomPortalRegistration {
    if (this.disposed) return { update: () => undefined, remove: () => undefined };
    const id = this.nextId++;
    this.entries.set(id, { id, target, content });
    this.publish();
    let removed = false;
    return {
      update: (nextContent) => {
        if (removed || this.disposed || !this.entries.has(id)) return;
        this.entries.set(id, { id, target, content: nextContent });
        this.publish();
      },
      remove: () => {
        if (removed) return;
        removed = true;
        if (this.entries.delete(id)) this.publish();
      },
    };
  }

  subscribe = (listener: () => void): (() => void) => {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): readonly InlineAtomPortalEntry[] => this.snapshot;

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const hadEntries = this.entries.size > 0;
    this.entries.clear();
    this.snapshot = [];
    if (hadEntries) this.emit();
    this.listeners.clear();
  }

  private publish(): void {
    this.snapshot = [...this.entries.values()];
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

export function InlineAtomPortalHost({
  registry,
}: {
  readonly registry: InlineAtomPortalRegistry;
}) {
  const entries = useSyncExternalStore(
    registry.subscribe,
    registry.getSnapshot,
    registry.getSnapshot,
  );
  return entries.map((entry) =>
    createPortal(entry.content, entry.target, entry.id),
  );
}
