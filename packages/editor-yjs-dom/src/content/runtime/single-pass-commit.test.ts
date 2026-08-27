import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockDefinition } from "@repo/editor-core/definitions";
import type { BlockType } from "@repo/editor-core/document";
import { asBlockId, type BlockId } from "@repo/editor-core/kernel";
import {
  boldMarkDefinition,
  createBlockRichTextContentFromPlainText,
  extractPlainTextFromRichTextDocument,
  type RichTextDocumentNodeJson,
} from "@repo/editor-core/content";
import type { EditorOpaqueContentCheckpoint } from "@repo/editor-core/content/rich-text";
import type { EditorLogicalContentOperation } from "@repo/editor-core/operations";

const plannerProbe = vi.hoisted(() => ({
  events: [] as string[],
  failBlockId: null as string | null,
  onPlan: null as ((blockId: string) => void) | null,
  onApply: null as ((blockId: string) => void) | null,
}));

vi.mock("@repo/editor-yjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/editor-yjs")>();
  const planOwners = new WeakMap<object, string>();
  return {
    ...actual,
    planCanonicalYjsContentMutation(
      input: Parameters<typeof actual.planCanonicalYjsContentMutation>[0],
    ) {
      const blockId = String(input.operation.blockId);
      plannerProbe.events.push(`plan:${blockId}`);
      plannerProbe.onPlan?.(blockId);
      if (plannerProbe.failBlockId === blockId) return null;
      const plan = actual.planCanonicalYjsContentMutation(input);
      if (plan) planOwners.set(plan, blockId);
      return plan;
    },
    applyPlannedCanonicalYjsContentMutation(
      plan: Parameters<
        typeof actual.applyPlannedCanonicalYjsContentMutation
      >[0],
    ) {
      const blockId = planOwners.get(plan) ?? "unknown";
      plannerProbe.events.push(`apply:${blockId}`);
      plannerProbe.onApply?.(blockId);
      return actual.applyPlannedCanonicalYjsContentMutation(plan);
    },
  };
});

import { createYjsBlockContentCheckpoint } from "@repo/editor-yjs";
import { createYjsBlockContentRuntime } from "../../api/index.ts";

const definitions = {
  textBlock: { kind: "text", type: "textBlock" },
} satisfies Readonly<Record<BlockType, BlockDefinition>>;

const id = (suffix: number) =>
  asBlockId(`01890f07-1c00-7000-8000-${String(suffix).padStart(12, "0")}`);

beforeEach(() => {
  plannerProbe.events = [];
  plannerProbe.failBlockId = null;
  plannerProbe.onPlan = null;
  plannerProbe.onApply = null;
});

describe("single-pass Yjs commit planning", () => {
  it.each([
    {
      name: "character insertion",
      before: "AB",
      operations: [insertOperation(id(1), 1, "x")],
      after: "AxB",
      plans: 1,
    },
    {
      name: "repeated character insertion",
      before: "",
      operations: [
        insertOperation(id(1), 0, "a"),
        insertOperation(id(1), 1, "b"),
      ],
      after: "ab",
      plans: 2,
    },
    {
      name: "Backspace",
      before: "ABC",
      operations: [deleteOperation(id(1), 1, 2, "B")],
      after: "AC",
      plans: 1,
    },
    {
      name: "Forward Delete",
      before: "ABC",
      operations: [deleteOperation(id(1), 1, 2, "B")],
      after: "AC",
      plans: 1,
    },
    {
      name: "selected-range deletion",
      before: "ABCDE",
      operations: [deleteOperation(id(1), 1, 4, "BCD")],
      after: "AE",
      plans: 1,
    },
    {
      name: "selected-range replacement",
      before: "ABCDE",
      operations: [replaceOperation(id(1), 1, 4, "xy", "BCD")],
      after: "AxyE",
      plans: 1,
    },
    {
      name: "formatting",
      before: "ABC",
      operations: [markOperation(id(1), 0, 3)],
      after: "ABC",
      plans: 1,
    },
  ])(
    "plans $name only during commit",
    ({ before, operations, after, plans }) => {
      const runtime = createYjsBlockContentRuntime(
        sourceFor({ [id(1)]: before }),
      );
      let publications = 0;
      runtime.subscribeContentCommits(() => publications++);
      const validated = requireValidated(
        runtime.validateContentCommit({
          graphRevision: 1,
          changes: [
            {
              baseToken: runtime.readContentBaseToken(id(1), "textBlock", 1),
              operations,
            },
          ],
        }),
      );

      expect(plannerProbe.events).toEqual([]);
      const applied = runtime.commitContent(validated, "inverse");
      expect(plannerProbe.events).toEqual([
        ...Array.from({ length: plans }, () => `plan:${id(1)}`),
        ...Array.from({ length: plans }, () => `apply:${id(1)}`),
      ]);
      expect(applied.blocks).toHaveLength(1);
      expect(applied.replayCapture.kind).toBe("inverse");
      expect(
        extractPlainTextFromRichTextDocument(
          runtime.readBlockProjection(id(1), "textBlock"),
        ),
      ).toBe(after);
      expect(publications).toBe(0);
      runtime.publishContentCommit(applied);
      expect(publications).toBe(1);
      runtime.destroy();
    },
  );

  it("returns a semantic no-op without invoking the physical planner", () => {
    const runtime = createYjsBlockContentRuntime(sourceFor({ [id(1)]: "A" }));
    const validated = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken: runtime.readContentBaseToken(id(1), "textBlock", 1),
            operations: [removeMarkOperation(id(1), 0, 1)],
          },
        ],
      }),
    );

    expect(validated.affectedBlockIds).toEqual([]);
    expect(plannerProbe.events).toEqual([]);
    const applied = runtime.commitContent(validated, "none");
    expect(applied.blocks).toEqual([]);
    expect(plannerProbe.events).toEqual([]);
    runtime.destroy();
  });

  it.each([10, 10_000, 100_000])(
    "plans one insertion once for a %,i-character block",
    (length) => {
      const before = "a".repeat(length);
      const runtime = createYjsBlockContentRuntime(
        sourceFor({ [id(1)]: before }),
      );
      const validated = requireValidated(
        runtime.validateContentCommit({
          graphRevision: 1,
          changes: [
            {
              baseToken: runtime.readContentBaseToken(id(1), "textBlock", 1),
              operations: [insertOperation(id(1), length, "x")],
            },
          ],
        }),
      );

      expect(plannerProbe.events).toEqual([]);
      runtime.commitContent(validated, "none");
      expect(plannerProbe.events).toEqual([`plan:${id(1)}`, `apply:${id(1)}`]);
      expect(
        extractPlainTextFromRichTextDocument(
          runtime.readBlockProjection(id(1), "textBlock"),
        ),
      ).toHaveLength(length + 1);
      runtime.destroy();
    },
    60_000,
  );

  it("prepares every existing block before applying the first plan", () => {
    const runtime = createYjsBlockContentRuntime(
      sourceFor({ [id(1)]: "A", [id(2)]: "B", [id(3)]: "C" }),
    );
    const validated = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [1, 2, 3].map((suffix) => ({
          baseToken: runtime.readContentBaseToken(id(suffix), "textBlock", 1),
          operations: [insertOperation(id(suffix), 1, String(suffix))],
        })),
      }),
    );

    runtime.commitContent(validated, "none");
    expect(plannerProbe.events).toEqual([
      `plan:${id(1)}`,
      `plan:${id(2)}`,
      `plan:${id(3)}`,
      `apply:${id(1)}`,
      `apply:${id(2)}`,
      `apply:${id(3)}`,
    ]);
    runtime.destroy();
  });

  it.each([1, 2, 3])(
    "applies nothing when physical planning fails at block %i",
    (failureIndex) => {
      const runtime = createYjsBlockContentRuntime(
        sourceFor({ [id(1)]: "A", [id(2)]: "B", [id(3)]: "C" }),
      );
      let publications = 0;
      runtime.subscribeContentCommits(() => publications++);
      const validated = requireValidated(
        runtime.validateContentCommit({
          graphRevision: 1,
          changes: [1, 2, 3].map((suffix) => ({
            baseToken: runtime.readContentBaseToken(id(suffix), "textBlock", 1),
            operations: [insertOperation(id(suffix), 1, String(suffix))],
          })),
        }),
      );
      plannerProbe.failBlockId = id(failureIndex);

      expect(() => runtime.commitContent(validated, "none")).toThrow(
        /cannot apply the canonical operation sequence/u,
      );
      expect(
        plannerProbe.events.filter((event) => event.startsWith("apply:")),
      ).toEqual([]);
      expect(runtime.getLiveBlockContentCount()).toBe(0);
      expect(publications).toBe(0);
      expect(
        [1, 2, 3].map((suffix) =>
          runtime.readBlockPlainText(id(suffix), "textBlock"),
        ),
      ).toEqual(["A", "B", "C"]);
      expect(runtime.getConsistencyState()).toBe("healthy");
      runtime.destroy();
    },
  );

  it("keeps introduced blocks detached and cleans them after later preflight failure", () => {
    const introducedId = id(1);
    const existingId = id(2);
    const runtime = createYjsBlockContentRuntime(
      sourceFor({ [existingId]: "existing" }),
    );
    let observedDetached = false;
    plannerProbe.onPlan = (blockId) => {
      if (blockId !== introducedId) return;
      expect(runtime.getLiveBlockContentCount()).toBe(0);
      expect(() =>
        runtime.readBlockProjection(introducedId, "textBlock"),
      ).toThrow(/does not exist/u);
      observedDetached = true;
    };
    const validated = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        introducedBlocks: { [introducedId]: "textBlock" },
        changes: [
          {
            baseToken: {
              graphRevision: 1,
              blockId: introducedId,
              blockType: "textBlock",
              contentRevision: 0,
            },
            operations: [insertOperation(introducedId, 0, "introduced")],
          },
          {
            baseToken: runtime.readContentBaseToken(existingId, "textBlock", 1),
            operations: [insertOperation(existingId, 8, "!")],
          },
        ],
      }),
    );
    plannerProbe.failBlockId = existingId;

    expect(() => runtime.commitContent(validated, "none")).toThrow(
      /cannot apply the canonical operation sequence/u,
    );
    expect(observedDetached).toBe(true);
    expect(plannerProbe.events).toEqual([
      `plan:${introducedId}`,
      `plan:${existingId}`,
    ]);
    expect(runtime.getLiveBlockContentCount()).toBe(0);
    expect(() =>
      runtime.readBlockProjection(introducedId, "textBlock"),
    ).toThrow(/does not exist/u);
    expect(runtime.readBlockPlainText(existingId, "textBlock")).toBe(
      "existing",
    );
    runtime.destroy();
  });

  it("installs a locally introduced block only after its one physical plan succeeds", () => {
    const introducedId = id(1);
    const runtime = createYjsBlockContentRuntime(sourceFor({}));
    plannerProbe.onPlan = (blockId) => {
      expect(blockId).toBe(introducedId);
      expect(runtime.getLiveBlockContentCount()).toBe(0);
      expect(() =>
        runtime.readBlockProjection(introducedId, "textBlock"),
      ).toThrow(/does not exist/u);
    };
    const validated = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        resultingGraphRevision: 2,
        introducedBlocks: { [introducedId]: "textBlock" },
        changes: [
          {
            baseToken: introducedBase(introducedId),
            operations: [insertOperation(introducedId, 0, "introduced")],
          },
        ],
      }),
    );

    expect(plannerProbe.events).toEqual([]);
    const applied = runtime.commitContent(validated, "inverse");
    expect(plannerProbe.events).toEqual([
      `plan:${introducedId}`,
      `apply:${introducedId}`,
    ]);
    expect(runtime.readBlockPlainText(introducedId, "textBlock")).toBe(
      "introduced",
    );
    expect(applied.blocks).toHaveLength(1);
    runtime.publishContentCommit(applied);
    runtime.destroy();
  });

  it("installs an introduced default block without invoking the local planner", () => {
    const introducedId = id(1);
    const runtime = createYjsBlockContentRuntime(sourceFor({}));
    const validated = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        resultingGraphRevision: 2,
        introducedBlocks: { [introducedId]: "textBlock" },
        changes: [],
      }),
    );

    expect(plannerProbe.events).toEqual([]);
    const applied = runtime.commitContent(validated, "none");
    expect(plannerProbe.events).toEqual([]);
    expect(runtime.readBlockPlainText(introducedId, "textBlock")).toBe("");
    expect(applied.blocks).toHaveLength(1);
    runtime.publishContentCommit(applied);
    runtime.destroy();
  });

  it("keeps remote existing and introduced blocks off the local planner path", () => {
    const existingId = id(1);
    const introducedId = id(2);
    const source = sourceFor({ [existingId]: "A" });
    const producer = createYjsBlockContentRuntime(source);
    let producerPublications = 0;
    producer.subscribeContentCommits(() => producerPublications++);
    const produced = requireValidated(
      producer.validateContentCommit({
        graphRevision: 1,
        resultingGraphRevision: 2,
        introducedBlocks: { [introducedId]: "textBlock" },
        changes: [
          {
            baseToken: producer.readContentBaseToken(
              existingId,
              "textBlock",
              1,
            ),
            operations: [insertOperation(existingId, 1, "!")],
          },
          {
            baseToken: introducedBase(introducedId),
            operations: [insertOperation(introducedId, 0, "remote")],
          },
        ],
      }),
    );
    const producedApplied = producer.commitContent(produced, "none");
    const existingUpdate = producedApplied.blocks.find(
      (block) => block.blockId === existingId,
    )!;
    const introducedUpdate = producedApplied.blocks.find(
      (block) => block.blockId === introducedId,
    )!;
    expect(plannerProbe.events).toEqual([
      `plan:${existingId}`,
      `plan:${introducedId}`,
      `apply:${existingId}`,
      `apply:${introducedId}`,
    ]);
    producer.publishContentCommit(producedApplied);
    expect(producerPublications).toBe(1);
    plannerProbe.events = [];

    const consumer = createYjsBlockContentRuntime(source);
    let consumerPublications = 0;
    consumer.subscribeContentCommits(() => consumerPublications++);
    const remote = requireValidated(
      consumer.validateRemoteContentCommit({
        graphRevision: 1,
        resultingGraphRevision: 2,
        introducedBlocks: { [introducedId]: "textBlock" },
        updates: [
          {
            base: consumer.readContentBaseToken(existingId, "textBlock", 1),
            update: existingUpdate.operationUpdate,
            readProjection: richText("A!"),
          },
          {
            base: introducedBase(introducedId),
            update: introducedUpdate.operationUpdate,
            readProjection: richText("remote"),
          },
        ],
      }),
    );

    expect(plannerProbe.events).toEqual([]);
    const applied = consumer.commitContent(remote, "none");
    expect(plannerProbe.events).toEqual([]);
    expect(consumer.readBlockPlainText(existingId, "textBlock")).toBe("A!");
    expect(consumer.readBlockPlainText(introducedId, "textBlock")).toBe(
      "remote",
    );
    consumer.publishContentCommit(applied);
    expect(consumerPublications).toBe(1);
    expect(plannerProbe.events).toEqual([]);
    consumer.destroy();
    producer.destroy();
  });

  it("projects a remote update over unaccepted local bytes after the live context was released", () => {
    const blockId = id(1);
    const source = sourceFor({ [blockId]: "A" });
    const local = createYjsBlockContentRuntime(source);
    const peer = createYjsBlockContentRuntime(source);
    const localValidated = requireValidated(
      local.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken: local.readContentBaseToken(blockId, "textBlock", 1),
            operations: [insertOperation(blockId, 0, "L")],
          },
        ],
      }),
    );
    local.commitContent(localValidated, "none");
    expect(local.readBlockPlainText(blockId, "textBlock")).toBe("LA");
    expect(local.getLiveBlockContentCount()).toBe(0);

    const peerValidated = requireValidated(
      peer.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken: peer.readContentBaseToken(blockId, "textBlock", 1),
            operations: [insertOperation(blockId, 1, "R")],
          },
        ],
      }),
    );
    const peerUpdate = peer.commitContent(peerValidated, "none").blocks[0]!;
    const remote = requireValidated(
      local.validateRemoteContentCommit({
        graphRevision: 1,
        resultingGraphRevision: 2,
        updates: [
          {
            base: local.readContentBaseToken(blockId, "textBlock", 1),
            update: peerUpdate.operationUpdate,
            readProjection: richText("AR"),
          },
        ],
      }),
    );
    local.commitContent(remote, "none");

    expect(local.readBlockPlainText(blockId, "textBlock")).toBe("LAR");
    expect(local.getLiveBlockContentCount()).toBe(0);
    local.destroy();
    peer.destroy();
  });

  it("defers removals until a combined edit passes preflight", () => {
    const editedId = id(1);
    const removedId = id(2);
    const runtime = createYjsBlockContentRuntime(
      sourceFor({ [editedId]: "edit", [removedId]: "remove" }),
    );
    const validated = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken: runtime.readContentBaseToken(editedId, "textBlock", 1),
            operations: [insertOperation(editedId, 4, "!")],
          },
        ],
        removedBlockIds: [removedId],
      }),
    );
    plannerProbe.failBlockId = editedId;

    expect(() => runtime.commitContent(validated, "inverse")).toThrow(
      /cannot apply the canonical operation sequence/u,
    );
    expect(runtime.readBlockPlainText(editedId, "textBlock")).toBe("edit");
    expect(runtime.readBlockPlainText(removedId, "textBlock")).toBe("remove");
    expect(runtime.getLiveBlockContentCount()).toBe(0);
    runtime.destroy();
  });

  it("publishes a successful removal only after commit application", () => {
    const removedId = id(1);
    const runtime = createYjsBlockContentRuntime(
      sourceFor({ [removedId]: "remove" }),
    );
    const validated = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        resultingGraphRevision: 2,
        changes: [],
        removedBlockIds: [removedId],
      }),
    );

    const applied = runtime.commitContent(validated, "inverse");
    expect(plannerProbe.events).toEqual([]);
    expect(applied.replayCapture).toMatchObject({
      kind: "inverse",
      steps: [{ kind: "content", blockId: removedId }],
    });
    expect(() => runtime.readBlockProjection(removedId, "textBlock")).toThrow(
      /does not exist/u,
    );
    runtime.publishContentCommit(applied);
    expect(() => runtime.readBlockProjection(removedId, "textBlock")).toThrow(
      /does not exist/u,
    );
    runtime.destroy();
  });

  it("rejects a reused validated state without another plan or mutation", () => {
    const runtime = createYjsBlockContentRuntime(sourceFor({ [id(1)]: "A" }));
    const validated = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken: runtime.readContentBaseToken(id(1), "textBlock", 1),
            operations: [insertOperation(id(1), 1, "!")],
          },
        ],
      }),
    );
    runtime.commitContent(validated, "none");
    const firstEvents = [...plannerProbe.events];

    expect(() => runtime.commitContent(validated, "none")).toThrow(
      /already been used/u,
    );
    expect(plannerProbe.events).toEqual(firstEvents);
    expect(runtime.readBlockPlainText(id(1), "textBlock")).toBe("A!");
    runtime.destroy();
  });

  it("rejects a reentrant commit while the prepared batch is applying", () => {
    const runtime = createYjsBlockContentRuntime(sourceFor({ [id(1)]: "A" }));
    const baseToken = runtime.readContentBaseToken(id(1), "textBlock", 1);
    const first = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken,
            operations: [insertOperation(id(1), 1, "1")],
          },
        ],
      }),
    );
    const reentrant = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken,
            operations: [insertOperation(id(1), 1, "2")],
          },
        ],
      }),
    );
    let rejected = false;
    plannerProbe.onApply = () => {
      expect(() => runtime.commitContent(reentrant, "none")).toThrow(
        /already active/u,
      );
      rejected = true;
    };

    runtime.commitContent(first, "none");
    expect(rejected).toBe(true);
    expect(runtime.readBlockPlainText(id(1), "textBlock")).toBe("A1");
    expect(runtime.getConsistencyState()).toBe("healthy");
    runtime.destroy();
  });

  it("rejects an interleaved stale local commit before another physical plan", () => {
    const runtime = createYjsBlockContentRuntime(sourceFor({ [id(1)]: "A" }));
    const baseToken = runtime.readContentBaseToken(id(1), "textBlock", 1);
    const stale = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken,
            operations: [insertOperation(id(1), 1, "stale")],
          },
        ],
      }),
    );
    const interleaving = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken,
            operations: [insertOperation(id(1), 1, "current")],
          },
        ],
      }),
    );
    const applied = runtime.commitContent(interleaving, "none");
    runtime.publishContentCommit(applied);
    plannerProbe.events = [];

    expect(() => runtime.commitContent(stale, "none")).toThrow(
      /revision 0 does not match 1/u,
    );
    expect(plannerProbe.events).toEqual([]);
    expect(runtime.readBlockPlainText(id(1), "textBlock")).toBe("Acurrent");
    runtime.destroy();
  });

  it("rejects a graph revision change after validation before planning", () => {
    const source = sourceFor({ [id(1)]: "A" });
    const runtime = createYjsBlockContentRuntime(source);
    let publications = 0;
    runtime.subscribeContentCommits(() => publications++);
    const validated = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken: runtime.readContentBaseToken(id(1), "textBlock", 1),
            operations: [insertOperation(id(1), 1, "stale")],
          },
        ],
      }),
    );
    runtime.reconcileContentData({
      blockGraphVersion: 2,
      blockIds: [id(1)],
      blockTypesById: source.blockTypesById,
      contentById: source.contentById,
      opaqueContentCheckpoints: source.opaqueContentCheckpoints,
      loadedAt: 2,
    });

    expect(() => runtime.commitContent(validated, "none")).toThrow(
      /graph revision 1 does not match 2/u,
    );
    expect(plannerProbe.events).toEqual([]);
    expect(runtime.readBlockPlainText(id(1), "textBlock")).toBe("A");
    expect(runtime.getLiveBlockContentCount()).toBe(0);
    expect(publications).toBe(0);
    expect(runtime.getConsistencyState()).toBe("healthy");
    runtime.destroy();
  });

  it("rejects a local validation after an intervening supported remote update", () => {
    const blockId = id(1);
    const source = sourceFor({ [blockId]: "A" });
    const producer = createYjsBlockContentRuntime(source);
    const produced = requireValidated(
      producer.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken: producer.readContentBaseToken(
              blockId,
              "textBlock",
              1,
            ),
            operations: [insertOperation(blockId, 1, "remote")],
          },
        ],
      }),
    );
    const remoteUpdate = producer.commitContent(produced, "none").blocks[0]!;
    const runtime = createYjsBlockContentRuntime(source);
    const stale = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken: runtime.readContentBaseToken(blockId, "textBlock", 1),
            operations: [insertOperation(blockId, 1, "local")],
          },
        ],
      }),
    );
    plannerProbe.events = [];
    runtime.applyExternalContentUpdate({
      blockGraphVersion: 1,
      blockId,
      blockType: "textBlock",
      update: remoteUpdate.operationUpdate,
      readProjection: richText("Aremote"),
      revision: 1,
    });

    expect(() => runtime.commitContent(stale, "none")).toThrow(
      /revision 0 does not match 1/u,
    );
    expect(plannerProbe.events).toEqual([]);
    expect(runtime.readBlockPlainText(blockId, "textBlock")).toBe("Aremote");
    expect(runtime.getLiveBlockContentCount()).toBe(0);
    expect(runtime.getConsistencyState()).toBe("healthy");
    runtime.destroy();
    producer.destroy();
  });

  it("rejects when an existing block disappears after validation", () => {
    const blockId = id(1);
    const runtime = createYjsBlockContentRuntime(
      sourceFor({ [blockId]: "present" }),
    );
    const validated = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken: runtime.readContentBaseToken(blockId, "textBlock", 1),
            operations: [insertOperation(blockId, 7, "!")],
          },
        ],
      }),
    );
    runtime.reconcileContentData({
      blockGraphVersion: 1,
      blockIds: [],
      blockTypesById: {},
      contentById: {},
      opaqueContentCheckpoints: {},
      loadedAt: 2,
    });

    expect(() => runtime.commitContent(validated, "none")).toThrow(
      /does not exist/u,
    );
    expect(plannerProbe.events).toEqual([]);
    expect(runtime.getLiveBlockContentCount()).toBe(0);
    expect(runtime.getConsistencyState()).toBe("healthy");
    runtime.destroy();
  });

  it("rejects an introduced ID collision before detached preparation", () => {
    const introducedId = id(1);
    const runtime = createYjsBlockContentRuntime(sourceFor({}));
    const validated = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        introducedBlocks: { [introducedId]: "textBlock" },
        changes: [
          {
            baseToken: introducedBase(introducedId),
            operations: [insertOperation(introducedId, 0, "new")],
          },
        ],
      }),
    );
    const occupied = sourceFor({ [introducedId]: "occupied" });
    runtime.reconcileContentData({
      blockGraphVersion: 1,
      blockIds: [introducedId],
      blockTypesById: occupied.blockTypesById,
      contentById: occupied.contentById,
      opaqueContentCheckpoints: occupied.opaqueContentCheckpoints,
      loadedAt: 2,
    });

    expect(() => runtime.commitContent(validated, "none")).toThrow(
      /now exists/u,
    );
    expect(plannerProbe.events).toEqual([]);
    expect(runtime.readBlockPlainText(introducedId, "textBlock")).toBe(
      "occupied",
    );
    expect(runtime.getLiveBlockContentCount()).toBe(0);
    expect(runtime.getConsistencyState()).toBe("healthy");
    runtime.destroy();
  });

  it("rejects a removal changed by a supported remote update", () => {
    const removedId = id(1);
    const source = sourceFor({ [removedId]: "remove" });
    const producer = createYjsBlockContentRuntime(source);
    const produced = requireValidated(
      producer.validateContentCommit({
        graphRevision: 1,
        changes: [
          {
            baseToken: producer.readContentBaseToken(
              removedId,
              "textBlock",
              1,
            ),
            operations: [insertOperation(removedId, 6, "d")],
          },
        ],
      }),
    );
    const update = producer.commitContent(produced, "none").blocks[0]!;
    const runtime = createYjsBlockContentRuntime(source);
    const removal = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        changes: [],
        removedBlockIds: [removedId],
      }),
    );
    plannerProbe.events = [];
    runtime.applyExternalContentUpdate({
      blockGraphVersion: 1,
      blockId: removedId,
      blockType: "textBlock",
      update: update.operationUpdate,
      readProjection: richText("removed"),
      revision: 1,
    });

    expect(() => runtime.commitContent(removal, "inverse")).toThrow(
      /removal is stale/u,
    );
    expect(plannerProbe.events).toEqual([]);
    expect(runtime.readBlockPlainText(removedId, "textBlock")).toBe(
      "removed",
    );
    expect(runtime.getLiveBlockContentCount()).toBe(0);
    expect(runtime.getConsistencyState()).toBe("healthy");
    runtime.destroy();
    producer.destroy();
  });

  it("destroys every detached introduction when the final introduction fails", () => {
    const introducedIds = [id(1), id(2), id(3)];
    const runtime = createYjsBlockContentRuntime(sourceFor({}));
    const validated = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        introducedBlocks: Object.fromEntries(
          introducedIds.map((blockId) => [blockId, "textBlock"]),
        ),
        changes: introducedIds.map((blockId, index) => ({
          baseToken: introducedBase(blockId),
          operations: [insertOperation(blockId, 0, String(index + 1))],
        })),
      }),
    );
    plannerProbe.failBlockId = introducedIds[2]!;

    expect(() => runtime.commitContent(validated, "none")).toThrow(
      /cannot apply its canonical transitions/u,
    );
    expect(plannerProbe.events).toEqual(
      introducedIds.map((blockId) => `plan:${blockId}`),
    );
    for (const blockId of introducedIds) {
      expect(() => runtime.readBlockProjection(blockId, "textBlock")).toThrow(
        /does not exist/u,
      );
    }
    expect(runtime.getLiveBlockContentCount()).toBe(0);
    expect(runtime.getConsistencyState()).toBe("healthy");
    runtime.destroy();
  });

  it("keeps a mixed existing, introduced, and removed batch atomic when its final plan fails", () => {
    const editedId = id(1);
    const removedId = id(2);
    const finalEditedId = id(3);
    const introducedId = id(4);
    const runtime = createYjsBlockContentRuntime(
      sourceFor({
        [editedId]: "A",
        [removedId]: "B",
        [finalEditedId]: "C",
      }),
    );
    let publications = 0;
    runtime.subscribeContentCommits(() => publications++);
    const validated = requireValidated(
      runtime.validateContentCommit({
        graphRevision: 1,
        introducedBlocks: { [introducedId]: "textBlock" },
        removedBlockIds: [removedId],
        changes: [
          {
            baseToken: runtime.readContentBaseToken(
              editedId,
              "textBlock",
              1,
            ),
            operations: [insertOperation(editedId, 1, "1")],
          },
          {
            baseToken: introducedBase(introducedId),
            operations: [insertOperation(introducedId, 0, "new")],
          },
          {
            baseToken: runtime.readContentBaseToken(
              finalEditedId,
              "textBlock",
              1,
            ),
            operations: [insertOperation(finalEditedId, 1, "3")],
          },
        ],
      }),
    );
    plannerProbe.failBlockId = finalEditedId;
    plannerProbe.onPlan = () => {
      expect(runtime.readBlockPlainText(removedId, "textBlock")).toBe("B");
      expect(() =>
        runtime.readBlockProjection(introducedId, "textBlock"),
      ).toThrow(/does not exist/u);
    };

    expect(() => runtime.commitContent(validated, "inverse")).toThrow(
      /cannot apply the canonical operation sequence/u,
    );
    expect(
      plannerProbe.events.filter((event) => event.startsWith("apply:")),
    ).toEqual([]);
    expect(runtime.readBlockPlainText(editedId, "textBlock")).toBe("A");
    expect(runtime.readBlockPlainText(removedId, "textBlock")).toBe("B");
    expect(runtime.readBlockPlainText(finalEditedId, "textBlock")).toBe("C");
    expect(() =>
      runtime.readBlockProjection(introducedId, "textBlock"),
    ).toThrow(/does not exist/u);
    expect(runtime.getLiveBlockContentCount()).toBe(0);
    expect(publications).toBe(0);
    expect(runtime.getConsistencyState()).toBe("healthy");

    const eventsAfterFailure = [...plannerProbe.events];
    expect(() => runtime.commitContent(validated, "none")).toThrow(
      /already been used/u,
    );
    expect(plannerProbe.events).toEqual(eventsAfterFailure);
    runtime.destroy();
  });
});

function sourceFor(content: Readonly<Record<BlockId, string>>) {
  const blockTypesById = {} as Record<BlockId, BlockType>;
  const contentById = {} as Record<BlockId, RichTextDocumentNodeJson>;
  const opaqueContentCheckpoints = {} as Record<
    BlockId,
    EditorOpaqueContentCheckpoint
  >;
  for (const [blockId, text] of Object.entries(content) as [
    BlockId,
    string,
  ][]) {
    blockTypesById[blockId] = "textBlock";
    contentById[blockId] = richText(text);
    const checkpoint = createYjsBlockContentCheckpoint(
      blockId,
      contentById[blockId],
    );
    opaqueContentCheckpoints[blockId] = {
      kind: "checkpoint",
      format: checkpoint.format,
      version: checkpoint.version,
      payloadBase64: Buffer.from(checkpoint.payload.copy()).toString("base64"),
    };
  }
  return {
    blockDefinitions: definitions,
    inlineMarks: [boldMarkDefinition],
    inlineAtoms: [],
    blockGraphVersion: 1,
    blockTypesById,
    contentById,
    opaqueContentCheckpoints,
  };
}

function richText(text: string): RichTextDocumentNodeJson {
  return createBlockRichTextContentFromPlainText("textBlock", text);
}

function introducedBase(blockId: BlockId) {
  return {
    graphRevision: 1,
    blockId,
    blockType: "textBlock" as const,
    contentRevision: 0,
  };
}

function insertOperation(
  blockId: BlockId,
  offset: number,
  text: string,
): EditorLogicalContentOperation {
  return {
    kind: "insertInlineContent",
    blockId,
    blockType: "textBlock",
    target: { kind: "text" },
    position: { blockId, offset },
    content: [{ type: "text", text }],
  };
}

function deleteOperation(
  blockId: BlockId,
  from: number,
  to: number,
  deletedText: string,
): EditorLogicalContentOperation {
  return {
    kind: "deleteInlineRange",
    blockId,
    blockType: "textBlock",
    target: { kind: "text" },
    range: {
      from: { blockId, offset: from },
      to: { blockId, offset: to },
    },
    deletedContent: [{ type: "text", text: deletedText }],
  };
}

function replaceOperation(
  blockId: BlockId,
  from: number,
  to: number,
  text: string,
  deletedText: string,
): EditorLogicalContentOperation {
  return {
    kind: "replaceInlineRange",
    blockId,
    blockType: "textBlock",
    target: { kind: "text" },
    range: {
      from: { blockId, offset: from },
      to: { blockId, offset: to },
    },
    content: [{ type: "text", text }],
    deletedContent: [{ type: "text", text: deletedText }],
  };
}

function markOperation(
  blockId: BlockId,
  from: number,
  to: number,
): EditorLogicalContentOperation {
  return {
    kind: "addInlineMark",
    blockId,
    blockType: "textBlock",
    target: { kind: "text" },
    range: {
      from: { blockId, offset: from },
      to: { blockId, offset: to },
    },
    markName: "strong",
  };
}

function removeMarkOperation(
  blockId: BlockId,
  from: number,
  to: number,
): EditorLogicalContentOperation {
  return {
    kind: "removeInlineMark",
    blockId,
    blockType: "textBlock",
    target: { kind: "text" },
    range: {
      from: { blockId, offset: from },
      to: { blockId, offset: to },
    },
    markName: "strong",
  };
}

function requireValidated(
  value: ReturnType<
    ReturnType<typeof createYjsBlockContentRuntime>["validateContentCommit"]
  >,
) {
  if (!("kind" in value)) throw new Error(value.message);
  return value;
}
