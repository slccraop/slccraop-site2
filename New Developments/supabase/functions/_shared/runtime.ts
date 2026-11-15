// The ONLY file that touches Deno and Supabase libraries. It builds the real dependencies the handlers receive.
// Not imported by tests (they pass fakes), so it is checked with `deno check` instead (see docs/STAGE3_4_DEPLOY.md).
import postgres from 'postgres';
import { createClient } from '@supabase/supabase-js';
import { b64decode } from './crypto.ts';
import type { AuthAdmin, Db, Deps, Storage } from './deps.ts';

export function postgresDb(runner: postgres.Sql | postgres.TransactionSql, nested: boolean): Db {
  return {
    async query<T>(text: string, params: unknown[] = []): Promise<T[]> {
      const rows = await runner.unsafe(text, params as postgres.ParameterOrJSON<never>[]);
      return [...rows] as unknown as T[];
    },
    async tx<R>(fn: (db: Db) => Promise<R>): Promise<R> {
      if (nested)
        return (await (runner as postgres.TransactionSql).savepoint((s) => fn(postgresDb(s, true)))) as R;
      return (await (runner as postgres.Sql).begin((t) => fn(postgresDb(t, true)))) as R;
    },
  };
}

function need(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret ${name}`);
  return v;
}
function key32(name: string): Uint8Array {
  const k = b64decode(need(name));
  if (k.length !== 32) throw new Error(`${name} must be 32 bytes, base64 encoded`);
  return k;
}

let cached: Deps | null = null;
export function runtimeDeps(): Deps {
  if (cached) return cached;
  const sql = postgres(need('SUPABASE_DB_URL'), {
    prepare: false,
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  const sb = createClient(need('SUPABASE_URL'), need('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const storage: Storage = {
    async createSignedUploadUrl(bucket, path) {
      const { data, error } = await sb.storage.from(bucket).createSignedUploadUrl(path);
      if (error || !data) throw new Error('storage');
      return { token: data.token, path: data.path };
    },
    async download(bucket, path) {
      const { data, error } = await sb.storage.from(bucket).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async upload(bucket, path, data, contentType) {
      const { error } = await sb.storage.from(bucket).upload(path, data, { contentType, upsert: false });
      if (error) throw new Error('storage');
    },
    async remove(bucket, paths) {
      if (paths.length === 0) return;
      const { error } = await sb.storage.from(bucket).remove(paths);
      if (error) throw new Error('storage');
    },
    async createSignedUrl(bucket, path, seconds) {
      const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, seconds);
      if (error || !data) throw new Error('storage');
      return data.signedUrl;
    },
  };
  const auth: AuthAdmin = {
    async verifyJwt(jwt) {
      const { data, error } = await sb.auth.getUser(jwt);
      return error || !data.user ? null : data.user.id;
    },
    async inviteUser(email) {
      const { data, error } = await sb.auth.admin.inviteUserByEmail(email);
      if (error || !data.user) throw new Error('invite');
      return data.user.id;
    },
  };

  cached = {
    db: postgresDb(sql, false),
    storage,
    auth,
    env: {
      pepper: key32('PEPPER'),
      phoneKey: key32('PHONE_KEY'),
      turnstileSecret: Deno.env.get('TURNSTILE_SECRET') ?? '',
      allowedOrigins: (Deno.env.get('ALLOWED_ORIGIN') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      cronSecret: Deno.env.get('CRON_SECRET') ?? '',
    },
    fetch: globalThis.fetch.bind(globalThis),
    now: () => new Date(),
    random: (n) => crypto.getRandomValues(new Uint8Array(n)),
  };
  return cached;
}

export function serve(handler: (req: Request, deps: Deps) => Promise<Response>): void {
  Deno.serve(async (req) => {
    try {
      return await handler(req, runtimeDeps());
    } catch (e) {
      console.error('function failed to start', e instanceof Error ? e.name : 'error'); // a missing or malformed secret ends up here
      return new Response(JSON.stringify({ ok: false, error: 'server' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  });
}
