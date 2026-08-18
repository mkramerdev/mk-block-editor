import type { EditorState } from "../../prosemirror/index.ts";
import type {
  ProseMirrorProposalDisposition,
  ProseMirrorStateProposal,
} from "../transactions/proposal.ts";

export type BlockProposalDispatchResult =
  | {
      readonly status: "destroyed" | "filtered";
      readonly proposal: null;
      readonly state: EditorState;
    }
  | {
      readonly status: "projected";
      readonly proposal: null;
      readonly state: EditorState;
    }
  | {
      readonly status: "installed";
      readonly proposal: ProseMirrorStateProposal;
      readonly disposition: ProseMirrorProposalDisposition;
      readonly state: EditorState;
    };
