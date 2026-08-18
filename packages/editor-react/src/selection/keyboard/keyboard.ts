export type EditorKeyboardSelectionKey =
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight"
  | "Home"
  | "End";

export type EditorKeyboardSelectionDirection = "up" | "down" | "left" | "right";

export function keyboardSelectionDirectionFromKey(
  key: EditorKeyboardSelectionKey,
): EditorKeyboardSelectionDirection {
  switch (key) {
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "ArrowLeft":
    case "Home":
      return "left";
    case "ArrowRight":
    case "End":
      return "right";
  }
}
