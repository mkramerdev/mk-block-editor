import type { BlockId } from "@repo/editor-core/kernel";
import { describe, expect, it } from "vitest";
import { XmlElement } from "yjs";
import { createBlockContentDocContext } from "../block-content/doc/context.ts";
import { EDITOR_YJS_ORIGINS } from "../origins/origins.ts";
import { encodeBlockContentStateVector } from "./state-vector.ts";
import { encodeBlockContentUpdate } from "./encode-update.ts";

const BLOCK_A = "01890f07-1c00-7000-8000-000000001101" as BlockId;
const BLOCK_B = "01890f07-1c00-7000-8000-000000001102" as BlockId;

describe("block content update encoding", () => {
	it("keeps editable blocks isolated in separate block-local Yjs documents", () => {
		const blockA = createBlockContentDocContext({
			blockId: BLOCK_A,
		});
		const blockB = createBlockContentDocContext({
			blockId: BLOCK_B,
		});

		expect(blockA.doc).not.toBe(blockB.doc);
		expect(blockA.fragment).not.toBe(blockB.fragment);

		insertBlock(blockA, "a-only", EDITOR_YJS_ORIGINS.LOCAL_EDIT);
		expect(blockIds(blockA)).toEqual(["a-only"]);
		expect(blockIds(blockB)).toEqual([]);
	});

	it("encodes block-local Yjs updates and state vectors", () => {
		const context = createBlockContentDocContext({
			blockId: BLOCK_A,
		});

		const beforeStateVector = encodeBlockContentStateVector(context);
		insertBlock(context, "local-a", EDITOR_YJS_ORIGINS.LOCAL_EDIT);
		const update = encodeBlockContentUpdate(context);

		expect(update.byteLength).toBeGreaterThan(0);
		const afterStateVector = encodeBlockContentStateVector(context);
		expect(afterStateVector.byteLength).toBeGreaterThan(0);
		expect(bytes(afterStateVector)).not.toEqual(bytes(beforeStateVector));
	});
});

function insertBlock(
	context: ReturnType<typeof createBlockContentDocContext>,
	id: string,
	origin: unknown,
): void {
	context.doc.transact(() => {
		context.fragment.insert(context.fragment.length, [createBlock(id)]);
	}, origin);
}

function createBlock(id: string): XmlElement {
	const block = new XmlElement("block");
	block.setAttribute("id", id);
	return block;
}

function blockIds(context: { fragment: { toArray(): unknown[] } }): string[] {
	return context.fragment
		.toArray()
		.filter((node): node is XmlElement => node instanceof XmlElement)
		.map((node) => node.getAttribute("id") as string);
}

function bytes(value: Uint8Array): number[] {
	return [...value];
}
