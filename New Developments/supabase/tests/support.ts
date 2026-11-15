// Test support for Edge Function handlers: the real handler code runs against the real schema in Postgres,
// with in-memory storage and a fake Turnstile. Only the network edges are fake.
import type pg from 'pg';
import type { AuthAdmin, Db, Deps, Storage } from '../functions/_shared/deps.ts';
import { b64decode } from '../functions/_shared/crypto.ts';

export const SITE = 'https://site.test';
export const PEPPER = new Uint8Array(32).fill(7);
export const PHONE_KEY = new Uint8Array(32).fill(9);

/** Db over one pg client. tx() uses a savepoint so each test's outer transaction can roll everything back. */
export function pgDb(c: pg.Client, counter?: { n: number }): Db {
  const db: Db = {
    async query(sql, params) {
      if (counter) counter.n++;
      try {
        return (await c.query(sql, params as unknown[])).rows as never;
      } catch (e) {
        // Set DEBUG_SQL=1 to see the database's own message (handlers deliberately log only the error class).
        if (process.env.DEBUG_SQL)
          console.error('SQL FAILED:', sql.trim().split('\n')[0], '->', (e as Error).message);
        throw e;
      }
    },
    async tx(fn) {
      await c.query('savepoint handler_tx');
      try {
        const r = await fn(db);
        await c.query('release savepoint handler_tx');
        return r;
      } catch (e) {
        await c.query('rollback to savepoint handler_tx');
        throw e;
      }
    },
  };
  return db;
}

export class MemoryStorage implements Storage {
  files = new Map<string, Uint8Array>();
  types = new Map<string, string>();
  key = (bucket: string, path: string) => `${bucket}/${path}`;
  async createSignedUploadUrl(_bucket: string, path: string) {
    return { token: `tok-${path}`, path };
  }
  async download(bucket: string, path: string) {
    return this.files.get(this.key(bucket, path)) ?? null;
  }
  async upload(bucket: string, path: string, data: Uint8Array, contentType: string) {
    this.files.set(this.key(bucket, path), data);
    this.types.set(this.key(bucket, path), contentType);
  }
  async remove(bucket: string, paths: string[]) {
    for (const p of paths) this.files.delete(this.key(bucket, p));
  }
  async createSignedUrl(bucket: string, path: string, seconds: number) {
    return `https://storage.test/${bucket}/${path}?exp=${seconds}`;
  }
  put(bucket: string, path: string, data: Uint8Array) {
    this.files.set(this.key(bucket, path), data);
  }
  has(bucket: string, path: string) {
    return this.files.has(this.key(bucket, path));
  }
}

export function fakeAuth(users: Record<string, string> = {}): AuthAdmin {
  return {
    async verifyJwt(jwt) {
      return users[jwt] ?? null;
    },
    async inviteUser(email) {
      return users[`invite:${email}`] ?? '00000000-0000-4000-8000-0000000000f1';
    },
  };
}

export interface TestDeps extends Deps {
  storage: MemoryStorage;
}
export function makeDeps(
  c: pg.Client,
  over: Partial<Deps> & { counter?: { n: number }; turnstileOk?: boolean } = {},
): TestDeps {
  const turnstileOk = over.turnstileOk ?? true;
  return {
    db: pgDb(c, over.counter),
    storage: new MemoryStorage(),
    auth: fakeAuth(),
    env: {
      pepper: PEPPER,
      phoneKey: PHONE_KEY,
      turnstileSecret: 'test-secret',
      allowedOrigins: [SITE],
      cronSecret: 'cron-secret-value-for-tests',
    },
    fetch: (async (_url: unknown, init?: RequestInit) => {
      const token = new URLSearchParams(String(init?.body)).get('response');
      return new Response(JSON.stringify({ success: turnstileOk && token === 'good-token' }), {
        status: 200,
      });
    }) as typeof fetch,
    now: () => new Date(),
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
    ...over,
  } as TestDeps;
}

export function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`http://functions.test/${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: SITE,
      'cf-connecting-ip': '203.0.113.5',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

export const validReport = (over: Record<string, unknown> = {}) => ({
  language: 'en',
  contact_language: 'en',
  minor: false,
  reporter_role: 'self',
  behalf_consent: false,
  category: 'ncii',
  platform: 'Facebook',
  description: 'FAKE private description of what happened, long enough to pass validation.',
  links: ['https://www.facebook.com/groups/Example-Group-1'],
  usernames: ['@some.user'],
  date_from: '2026-10-01',
  date_to: '2026-10-05',
  reported_to_platform: true,
  platform_reference: 'REF-1',
  reported_to_police: false,
  police_reference: '',
  evidence_summary: 'Screenshots of the group.',
  external_media_links: [],
  phone: '+94 77 123 4567',
  contact_consent: true,
  files: [],
  turnstile_token: 'good-token',
  website: '',
  ...over,
});

export const trackingFrom = (code: string) => code.replace(/-/g, '');
export { b64decode };

// Minimal but structurally valid files for the image tests.
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
const ascii = (s: string) => [...s].map((x) => x.charCodeAt(0));
export function makePng(): Uint8Array {
  const chunk = (t: string, d: number[]) => [...be32(d.length), ...ascii(t), ...d, 0, 0, 0, 0];
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    ...chunk('tEXt', ascii('Comment\0GPS-SECRET-LOCATION')),
    ...chunk('tIME', [7, 234, 11, 1, 2, 3, 4]),
    ...chunk('IDAT', [1, 2, 3, 4, 5]),
    ...chunk('IEND', []),
  ]);
}
export function makeJpeg(): Uint8Array {
  const seg = (m: number, d: number[]) => [0xff, m, ...[(d.length + 2) >> 8, (d.length + 2) & 255], ...d];
  return new Uint8Array([
    0xff,
    0xd8,
    ...seg(0xe0, ascii('JFIF\0\x01\x01\0\0\x01\0\x01\0\0')),
    ...seg(0xe1, ascii('Exif\0\0GPS-SECRET-LOCATION')),
    ...seg(0xfe, ascii('camera comment')),
    ...seg(0xdb, [0, 1, 2, 3]),
    0xff,
    0xda,
    0x00,
    0x02,
    0x12,
    0x34,
    0x56,
    0xff,
    0xd9,
  ]);
}
export function makeWebp(): Uint8Array {
  const chunk = (t: string, d: number[]) => [
    ...ascii(t),
    ...le32(d.length),
    ...d,
    ...(d.length % 2 ? [0] : []),
  ];
  const body = [
    ...ascii('WEBP'),
    ...chunk('VP8X', [0x0c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...chunk('EXIF', ascii('GPS-SECRET-LOCATION')),
    ...chunk('VP8 ', [1, 2, 3, 4]),
  ];
  return new Uint8Array([...ascii('RIFF'), ...le32(body.length), ...body]);
}
export const contains = (bytes: Uint8Array, text: string) => Buffer.from(bytes).includes(text);
