export type BlockDomKeyBehaviorKey =
  | "enter"
  | "backspace"
  | "delete"
  | "tab"
  | "shiftTab";

export interface BlockDomTextSelectionRange {
  readonly from: number;
  readonly to: number;
}

export type BlockDomKeyBehaviorFailureReason =
  | "unhandled"
  | "no-change"
  | "rejected";

export interface BlockDomKeyBehaviorResult {
  ok: boolean;
  handled: boolean;
  reason?: BlockDomKeyBehaviorFailureReason;
}

export interface BlockDomKeyBehaviorEvent {
  readonly key: BlockDomKeyBehaviorKey;
  readonly cursorOffset: number;
  readonly selectionRange?: BlockDomTextSelectionRange;
  readonly isComposing?: boolean;
}
