import type { BlockId } from "../../../kernel/identity/ids.ts";
import type { ContentVersion } from "../../../kernel/versioning/versions.ts";
import type { StructuralTransactionOperation } from "../types.ts";

export function splitText(input: {
  readonly blockId: BlockId;
  readonly offset: number;
  readonly selectionRange?: { readonly from: number; readonly to: number };
  readonly expectedContentVersion: ContentVersion | string | null;
  readonly outputId: string;
}): StructuralTransactionOperation {
  return Object.freeze({ kind: "splitText", ...input });
}
