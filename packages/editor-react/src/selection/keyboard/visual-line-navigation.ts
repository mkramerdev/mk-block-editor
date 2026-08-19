import type { EditorLogicalSelectionPoint } from "../model/types.ts";
import type { EditorBlockSelectionTarget } from "../graph/reader.ts";
import type { EditorKeyboardSelectionDirection } from "./keyboard.ts";

export interface MoveEditorKeyboardSelectionVisualLineOptions {
  point: EditorLogicalSelectionPoint;
  target: EditorBlockSelectionTarget;
  direction:
    | Extract<EditorKeyboardSelectionDirection, "up" | "down">
    | "start"
    | "end";
  text: string;
  preferredX: number | null;
}

export type MoveEditorKeyboardSelectionVisualLineResult =
  | {
      readonly kind: "moved";
      readonly textOffset: number;
      readonly preferredX: number;
    }
  | {
      readonly kind: "boundary";
      readonly preferredX: number;
    }
  | {
      readonly kind: "unavailable";
      readonly reason: string;
    };

export type MapEditorKeyboardSelectionVisualLineResult =
  | { readonly kind: "mapped"; readonly textOffset: number }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface MapEditorKeyboardSelectionVisualLineOptions {
  readonly target: EditorBlockSelectionTarget;
  readonly line: "first" | "last";
  readonly preferredX: number;
}
