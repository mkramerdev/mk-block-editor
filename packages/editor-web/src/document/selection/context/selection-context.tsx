"use client";

import {
  createContext,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createIdleSelectionSnapshot,
  type EditorSelectionSnapshot,
  type EditorSelectionSnapshotEndpoint,
} from "@repo/editor-react/selection";
interface SelectionContextValue {
  readonly endpoint: EditorSelectionSnapshotEndpoint;
}

interface SelectionProviderProps {
  readonly endpoint: EditorSelectionSnapshotEndpoint;
  readonly children: ReactNode;
}

const idleSelectionSnapshot = createIdleSelectionSnapshot();
const SelectionContext = createContext<SelectionContextValue | null>(null);

export function SelectionProvider({
  endpoint,
  children,
}: SelectionProviderProps) {
  const value = useMemo(() => ({ endpoint }), [endpoint]);

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
}

export function useEditorSelectionEndpoint(): EditorSelectionSnapshotEndpoint | null {
  return useContext(SelectionContext)?.endpoint ?? null;
}

export function useEditorSelectionSnapshot(): EditorSelectionSnapshot {
  const endpoint = useEditorSelectionEndpoint();
  return useSyncExternalStore(
    endpoint ? (listener) => endpoint.subscribe(listener) : subscribeNoop,
    endpoint ? () => endpoint.getSnapshot() : getIdleSelectionSnapshot,
    getIdleSelectionSnapshot,
  );
}

function subscribeNoop(): () => void {
  return () => undefined;
}

function getIdleSelectionSnapshot(): EditorSelectionSnapshot {
  return idleSelectionSnapshot;
}
