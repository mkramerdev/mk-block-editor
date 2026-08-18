import type {
  StructuralTransactionOperation,
  TransactionSelectionTarget,
} from "../types.ts";

export function setSelection(
  target: TransactionSelectionTarget,
): StructuralTransactionOperation {
  return Object.freeze({
    kind: "setSelection",
    target: Object.freeze({ ...target }),
  });
}
