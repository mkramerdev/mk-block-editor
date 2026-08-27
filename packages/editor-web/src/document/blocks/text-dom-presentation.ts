export type TextDomPresentationElement =
  | "p"
  | "h1"
  | "h2"
  | "h3"
  | "blockquote"
  | "pre";

/** Renderer-owned semantic DOM for the canonical text block node. */
export interface TextDomPresentation {
  readonly element: TextDomPresentationElement;
  readonly attributes?: Readonly<Record<string, string>>;
}

export interface ResolvedTextDomPresentation {
  readonly element: TextDomPresentationElement;
  readonly attributes: Readonly<Record<string, string>>;
}

export const defaultTextDomPresentation: ResolvedTextDomPresentation =
  Object.freeze({
    element: "p",
    attributes: Object.freeze({}),
  });

const trustedTextDomPresentationElements: ReadonlySet<string> = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "blockquote",
  "pre",
]);

export function resolveTextDomPresentation(
  presentation: TextDomPresentation | undefined,
): ResolvedTextDomPresentation {
  if (!presentation) return defaultTextDomPresentation;
  if (!trustedTextDomPresentationElements.has(presentation.element)) {
    throw new Error(
      `Unsupported text DOM presentation element: ${String(presentation.element)}`,
    );
  }
  const attributes = Object.freeze({ ...(presentation.attributes ?? {}) });
  return Object.freeze({ element: presentation.element, attributes });
}

export function sameTextDomPresentation(
  left: ResolvedTextDomPresentation,
  right: ResolvedTextDomPresentation,
): boolean {
  if (left.element !== right.element) return false;
  const leftEntries = Object.entries(left.attributes);
  const rightEntries = Object.entries(right.attributes);
  return (
    leftEntries.length === rightEntries.length &&
    leftEntries.every(([name, value]) => right.attributes[name] === value)
  );
}
