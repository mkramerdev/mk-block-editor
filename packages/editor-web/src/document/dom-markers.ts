export const editorBlockListRootSelector =
  '[data-editor-block-list-root="true"]';
export const editorDocumentRootSelector = '[data-editor-web="document"]';
export const editorBlockShellSelector = '[data-editor-block-shell="true"]';
export const editorTextRootSelector = '[data-editor-text-root="true"]';
export const editorEditableTextRootSelector =
  '[data-editor-text-root="true"][contenteditable="true"]';
export const editorInteractionScopeSelector =
  '[data-editor-interaction-scope="true"]';

export function isInSameEditorInteractionScope(
  list: HTMLElement,
  target: Node,
): boolean {
  const listScope = list.closest<HTMLElement>(editorInteractionScopeSelector);
  if (!listScope) return false;
  const targetElement =
    target instanceof Element ? target : target.parentElement;
  return (
    targetElement?.closest<HTMLElement>(editorInteractionScopeSelector) ===
    listScope
  );
}
