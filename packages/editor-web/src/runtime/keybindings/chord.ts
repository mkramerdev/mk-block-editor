export type NormalizedEditorKeyChord = string & {
  readonly __normalizedEditorKeyChord: unique symbol;
};

export type EditorKeybindingPlatform = "apple" | "other";

type CanonicalModifier = "Shift" | "Mod" | "Control" | "Meta" | "Alt";

const modifierNames = new Map<string, CanonicalModifier>([
  ["shift", "Shift"],
  ["mod", "Mod"],
  ["control", "Control"],
  ["meta", "Meta"],
  ["alt", "Alt"],
]);
const modifierOrder: readonly CanonicalModifier[] = [
  "Shift",
  "Mod",
  "Control",
  "Meta",
  "Alt",
];
const namedBaseKeys = new Map<string, string>([
  ["enter", "Enter"],
  ["escape", "Escape"],
  ["esc", "Escape"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["del", "Delete"],
  ["tab", "Tab"],
  ["space", "Space"],
  ["spacebar", "Space"],
  ["arrowleft", "ArrowLeft"],
  ["left", "ArrowLeft"],
  ["arrowright", "ArrowRight"],
  ["right", "ArrowRight"],
  ["arrowup", "ArrowUp"],
  ["up", "ArrowUp"],
  ["arrowdown", "ArrowDown"],
  ["down", "ArrowDown"],
  ["home", "Home"],
  ["end", "End"],
  ["pageup", "PageUp"],
  ["pagedown", "PageDown"],
  ["insert", "Insert"],
]);

export function normalizeEditorKeyChord(
  chord: string,
): NormalizedEditorKeyChord {
  if (
    typeof chord !== "string" ||
    chord.length === 0 ||
    chord.trim() !== chord
  ) {
    throw new Error("Editor key chord must be a non-empty trimmed string.");
  }
  const parts = chord.split("-");
  if (parts.some((part) => part.length === 0)) {
    throw new Error(`Editor key chord ${JSON.stringify(chord)} is malformed.`);
  }
  const basePart = parts.at(-1);
  if (!basePart || modifierNames.has(basePart.toLowerCase())) {
    throw new Error(
      `Editor key chord ${JSON.stringify(chord)} is missing a base key.`,
    );
  }
  const modifiers = new Set<CanonicalModifier>();
  for (const part of parts.slice(0, -1)) {
    const modifier = modifierNames.get(part.toLowerCase());
    if (!modifier) {
      throw new Error(
        `Editor key chord ${JSON.stringify(chord)} includes unsupported modifier ${part}.`,
      );
    }
    if (modifiers.has(modifier)) {
      throw new Error(
        `Editor key chord ${JSON.stringify(chord)} repeats modifier ${modifier}.`,
      );
    }
    modifiers.add(modifier);
  }
  if (
    modifiers.has("Mod") &&
    (modifiers.has("Control") || modifiers.has("Meta"))
  ) {
    throw new Error(
      `Editor key chord ${JSON.stringify(chord)} combines Mod with a platform-specific conventional modifier.`,
    );
  }
  const baseKey = normalizeBaseKey(basePart, chord);
  return [
    ...modifierOrder.filter((modifier) => modifiers.has(modifier)),
    baseKey,
  ].join("-") as NormalizedEditorKeyChord;
}

export function normalizeKeyboardEventChord(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "altKey"
    | "ctrlKey"
    | "metaKey"
    | "shiftKey"
    | "isComposing"
    | "getModifierState"
  >,
  platform: EditorKeybindingPlatform,
  modifierMode: "conventional" | "explicit" = "conventional",
): NormalizedEditorKeyChord | null {
  if (event.isComposing || event.getModifierState("AltGraph")) return null;
  let baseKey: string;
  try {
    baseKey = normalizeBrowserBaseKey(event.key);
  } catch {
    return null;
  }
  const modifiers: CanonicalModifier[] = [];
  if (event.shiftKey) modifiers.push("Shift");
  if (modifierMode === "conventional") {
    const conventionalModifier =
      platform === "apple" ? event.metaKey : event.ctrlKey;
    if (conventionalModifier) modifiers.push("Mod");
    if (event.ctrlKey && platform === "apple") modifiers.push("Control");
    if (event.metaKey && platform === "other") modifiers.push("Meta");
  } else {
    if (event.ctrlKey) modifiers.push("Control");
    if (event.metaKey) modifiers.push("Meta");
  }
  if (event.altKey) modifiers.push("Alt");
  return [...modifiers, baseKey].join("-") as NormalizedEditorKeyChord;
}

export function physicalEditorKeyChordSignature(
  chord: NormalizedEditorKeyChord,
  platform: EditorKeybindingPlatform,
): string {
  const parts = chord.split("-");
  const baseKey = parts.pop()!;
  const modifiers = new Set(
    parts.map((part) =>
      part === "Mod" ? (platform === "apple" ? "Meta" : "Control") : part,
    ),
  );
  return [
    ...["Shift", "Control", "Meta", "Alt"].filter((modifier) =>
      modifiers.has(modifier),
    ),
    baseKey,
  ].join("-");
}

export function readEditorKeybindingPlatform(
  ownerWindow: Window | null,
): EditorKeybindingPlatform {
  const navigator = ownerWindow?.navigator;
  const platform =
    navigator && "userAgentData" in navigator
      ? String(
          (
            navigator as Navigator & {
              userAgentData?: { platform?: string };
            }
          ).userAgentData?.platform ?? "",
        )
      : (navigator?.platform ?? "");
  return /mac|iphone|ipad|ipod/iu.test(platform) ? "apple" : "other";
}

function normalizeBrowserBaseKey(key: string): string {
  if (key === " ") return "Space";
  return normalizeBaseKey(key, key);
}

function normalizeBaseKey(key: string, chord: string): string {
  const named = namedBaseKeys.get(key.toLowerCase());
  if (named) return named;
  if (/^f(?:[1-9]|1[0-9]|2[0-4])$/iu.test(key)) return key.toUpperCase();
  if (
    key.length === 1 &&
    key !== "-" &&
    !/\s/u.test(key) &&
    !/[\p{Cc}\p{Cs}]/u.test(key)
  ) {
    return /^[A-Z]$/u.test(key) ? key.toLowerCase() : key;
  }
  throw new Error(
    `Editor key chord ${JSON.stringify(chord)} has unsupported or ambiguous base key ${JSON.stringify(key)}.`,
  );
}
