// Cryptography helpers. Web Crypto only, so they run in Deno (Edge Functions) and Node (tests) unchanged.
import { TRACKING_ALPHABET, TRACKING_LENGTH } from './contracts.ts';

const enc = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;
const own = (b: Uint8Array): Bytes => new Uint8Array(b) as Bytes; // copy into a plain ArrayBuffer for Web Crypto

export function b64decode(s: string): Bytes {
  const bin = atob(s.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function b64encode(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
export function toHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
export function fromHex(h: string): Bytes {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Keyed hash (HMAC-SHA-256) as lowercase hex. Used for identifiers, tracking codes, IPs and phones. The key is a secret pepper. */
export async function hmacHex(key: Uint8Array, message: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', own(key), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return toHex(new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message))));
}
export async function sha256Hex(data: Uint8Array): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', own(data))));
}

export function normaliseTrackingCode(raw: string): string {
  return raw.replace(/[\s-]/g, '').toUpperCase();
}
export function formatTrackingCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}
/** 32 symbols divide 256 exactly, so masking a random byte is perfectly uniform (no modulo bias). */
export function newTrackingCode(random: (n: number) => Uint8Array): string {
  const bytes = random(TRACKING_LENGTH);
  let out = '';
  for (let i = 0; i < TRACKING_LENGTH; i++) out += TRACKING_ALPHABET[(bytes[i] as number) & 31];
  return out;
}

/** AES-256-GCM. Output = 12-byte random IV followed by ciphertext and tag. */
export async function encryptText(
  key: Uint8Array,
  plain: string,
  random: (n: number) => Uint8Array,
): Promise<Uint8Array> {
  const iv = own(random(12));
  const k = await crypto.subtle.importKey('raw', own(key), 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(plain)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return out;
}
export async function decryptText(key: Uint8Array, blob: Uint8Array): Promise<string> {
  const k = await crypto.subtle.importKey('raw', own(key), 'AES-GCM', false, ['decrypt']);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: own(blob.slice(0, 12)) },
    k,
    own(blob.slice(12)),
  );
  return new TextDecoder().decode(plain);
}

/** Compares two strings without leaking where they differ. */
export function constantTimeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}
