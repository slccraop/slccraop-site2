// Everything a handler needs from the outside world is passed in, so handlers run unchanged in Deno (real Supabase)
// and in Node tests (a throwaway Postgres plus fakes). Binary data crosses the database boundary as hex text and
// structured data as plain JS OBJECTS (never JSON strings, never bare arrays: wrap lists as { rows: [...] }). The two
// drivers disagree about strings and arrays, but they agree about objects, and that is covered by deno-driver-check.ts.
export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Runs `fn` in a transaction. Throwing rolls everything back. */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}
export interface SignedUpload {
  token: string;
  path: string;
}
export interface Storage {
  createSignedUploadUrl(bucket: string, path: string): Promise<SignedUpload>;
  download(bucket: string, path: string): Promise<Uint8Array | null>;
  upload(bucket: string, path: string, data: Uint8Array, contentType: string): Promise<void>;
  remove(bucket: string, paths: string[]): Promise<void>;
  createSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string>;
}
export interface AuthAdmin {
  /** Asks the auth server whether this JWT is genuine. Returns the user id, or null. */
  verifyJwt(jwt: string): Promise<string | null>;
  inviteUser(email: string): Promise<string>;
}
export interface Env {
  pepper: Uint8Array; // HMAC key for identifiers, tracking codes, IPs, phones (PEPPER secret)
  phoneKey: Uint8Array; // AES-256 key for phone numbers (PHONE_KEY secret)
  turnstileSecret: string; // TURNSTILE_SECRET
  allowedOrigins: string[]; // ALLOWED_ORIGIN, comma separated
  cronSecret: string; // CRON_SECRET
}
export interface Deps {
  db: Db;
  storage: Storage;
  auth: AuthAdmin;
  env: Env;
  fetch: typeof fetch;
  now: () => Date;
  random: (n: number) => Uint8Array;
}
