import type {
  StructuralTransactionOperation,
  TransactionSelectionTarget,
} from "../types.ts";

export function setSelection(
  target: TransactionSelectionTarget,
): StructuralTransactionOperation {
  return {
    kind: "setSelection",
    target: { ...target },
  };
}
