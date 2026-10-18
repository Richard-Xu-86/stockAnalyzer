import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM token encryption with a keyring, so keys can rotate:
 * new writes use the current key id; reads use whichever key id was stored with the row.
 * Layout of a sealed value: 12-byte IV | 16-byte auth tag | ciphertext.
 */
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export interface Keyring {
  currentId: string;
  keys: Map<string, Buffer>;
}

/** Parses "k1:base64,k2:base64". Fails loudly on a malformed or wrong-length key. */
export function parseKeyring(spec: string, currentId: string): Keyring {
  const keys = new Map<string, Buffer>();
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const idx = part.indexOf(":");
    if (idx <= 0) throw new Error("TOKEN_KEYS entries must look like id:base64key");
    const id = part.slice(0, idx);
    const key = Buffer.from(part.slice(idx + 1), "base64");
    if (key.length !== KEY_BYTES) throw new Error(`Token key "${id}" must be ${KEY_BYTES} bytes`);
    keys.set(id, key);
  }
  if (!keys.has(currentId)) throw new Error("TOKEN_KEY_ID does not match any key in TOKEN_KEYS");
  return { currentId, keys };
}

export function seal(ring: Keyring, plaintext: string): { keyId: string; sealed: Buffer } {
  const key = ring.keys.get(ring.currentId);
  if (!key) throw new Error("current key missing");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { keyId: ring.currentId, sealed: Buffer.concat([iv, cipher.getAuthTag(), body]) };
}

export function open(ring: Keyring, keyId: string, sealed: Buffer): string {
  const key = ring.keys.get(keyId);
  if (!key) throw new Error(`No key "${keyId}" in keyring; it may have been retired`);
  const iv = sealed.subarray(0, IV_BYTES);
  const tag = sealed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const body = sealed.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

export const newKey = (): string => randomBytes(KEY_BYTES).toString("base64");
