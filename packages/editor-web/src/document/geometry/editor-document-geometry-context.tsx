"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { EditorDocumentGeometryRegistration } from "./editor-document-geometry.ts";

const EditorDocumentGeometryRegistrationContext =
  createContext<EditorDocumentGeometryRegistration | null>(null);

export function EditorDocumentGeometryRegistrationProvider({
  registration,
  children,
}: {
  readonly registration: EditorDocumentGeometryRegistration;
  readonly children: ReactNode;
}) {
  return (
    <EditorDocumentGeometryRegistrationContext.Provider value={registration}>
      {children}
    </EditorDocumentGeometryRegistrationContext.Provider>
  );
}

export function useEditorDocumentGeometryRegistration(): EditorDocumentGeometryRegistration {
  const registration = useContext(EditorDocumentGeometryRegistrationContext);
  if (!registration) {
    throw new Error(
      "Mounted text geometry requires an editor document geometry owner",
    );
  }
  return registration;
}

export function useOptionalEditorDocumentGeometryRegistration(): EditorDocumentGeometryRegistration | null {
  return useContext(EditorDocumentGeometryRegistrationContext);
}
