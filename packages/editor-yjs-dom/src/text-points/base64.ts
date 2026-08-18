export function bytesToBase64(bytes: Uint8Array): string {
	const btoa = (globalThis as { btoa?: (value: string) => string }).btoa;
	if (typeof btoa === "function") {
		let binary = "";
		for (const byte of bytes) binary += String.fromCharCode(byte);
		return btoa(binary);
	}
	const buffer = (globalThis as { Buffer?: { from(value: Uint8Array): { toString(encoding: "base64"): string } } }).Buffer;
	if (!buffer) throw new Error("No base64 encoder available for Yjs relative text anchors");
	return buffer.from(bytes).toString("base64");
}

export function base64ToBytes(encoded: string): Uint8Array {
	const atob = (globalThis as { atob?: (value: string) => string }).atob;
	if (typeof atob === "function") {
		const binary = atob(encoded);
		return Uint8Array.from(binary, (char) => char.charCodeAt(0));
	}
	const buffer = (globalThis as { Buffer?: { from(value: string, encoding: "base64"): Uint8Array } }).Buffer;
	if (!buffer) throw new Error("No base64 decoder available for Yjs relative text anchors");
	return buffer.from(encoded, "base64");
}
