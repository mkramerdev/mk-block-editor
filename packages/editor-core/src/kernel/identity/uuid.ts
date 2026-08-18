import type { BlockId } from "./ids.ts";

interface RuntimeCrypto {
  getRandomValues<T extends Uint8Array>(array: T): T;
}

export function isStructuralKey(value: string): boolean {
  return value.trim().length > 0;
}

function assertStructuralKey(value: string, label = "key"): void {
  if (!isStructuralKey(value)) {
    throw new Error(`${label} must be a non-empty structural key`);
  }
}

function createStructuralKey(now = Date.now()): string {
  const bytes = new Uint8Array(16);
  fillRandomBytes(bytes);
  let timestamp = BigInt(now);
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = Number(timestamp & 0xffn);
    timestamp >>= 8n;
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  return [
    bytes.slice(0, 4),
    bytes.slice(4, 6),
    bytes.slice(6, 8),
    bytes.slice(8, 10),
    bytes.slice(10, 16),
  ]
    .map((part) => [...part].map(hexByte).join(""))
    .join("-");
}

export function asBlockId(value: string): BlockId {
  assertStructuralKey(value, "blockId");
  return value as BlockId;
}

export function createBlockId(now?: number): BlockId {
  return createStructuralKey(now) as BlockId;
}

function fillRandomBytes(bytes: Uint8Array): void {
  const cryptoApi = (globalThis as { crypto?: RuntimeCrypto }).crypto;
  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
    return;
  }

  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Math.floor(Math.random() * 256);
  }
}

function hexByte(value: number): string {
  return value.toString(16).padStart(2, "0");
}
