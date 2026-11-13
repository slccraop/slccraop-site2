import pg from 'pg';

// Return dates and timestamps as the plain strings PostgREST would send, so rows can be checked with the site's zod schemas.
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(1184, (v) => v);

export const PUBLIC_TABLES = ['public_ledger', 'public_stats', 'intake_state', 'authorities'] as const;
export type Role = 'postgres' | 'anon' | 'authenticated' | 'service_role';
export interface Claims {
  sub?: string;
  aal?: 'aal1' | 'aal2';
  [k: string]: unknown;
}

export const OWNER = '00000000-0000-4000-8000-000000000001';
export const ADMIN = '00000000-0000-4000-8000-000000000002';
export const NOBODY = '00000000-0000-4000-8000-000000000003';

/** Runs `fn` inside a transaction that is always rolled back, so tests never affect each other or the seed. */
export async function withTx<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL });
  await c.connect();
  try {
    await c.query('begin');
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => undefined);
    await c.end();
  }
}

/** Switch the current transaction to a database role, with the JWT claims PostgREST would set. */
export async function as(c: pg.Client, role: Role, claims: Claims | null = null): Promise<void> {
  await c.query('reset role');
  await c.query("select set_config('request.jwt.claims', $1, true)", [claims ? JSON.stringify(claims) : '']);
  if (role !== 'postgres') await c.query(`set local role ${role}`);
}

export type Attempt =
  { ok: true; rows: Record<string, unknown>[] } | { ok: false; code: string; message: string };

/** Runs one statement and reports success or the Postgres error code, without aborting the surrounding transaction. */
export async function attempt(c: pg.Client, sql: string, params: unknown[] = []): Promise<Attempt> {
  await c.query('savepoint attempt');
  try {
    const r = await c.query(sql, params);
    await c.query('release savepoint attempt');
    return { ok: true, rows: r.rows };
  } catch (e) {
    await c.query('rollback to savepoint attempt');
    const err = e as { code?: string; message?: string };
    return { ok: false, code: err.code ?? '', message: err.message ?? '' };
  }
}

export async function tableNames(c: pg.Client): Promise<string[]> {
  const r = await c.query("select tablename from pg_tables where schemaname = 'public' order by 1");
  return r.rows.map((x) => x.tablename as string);
}

/** Users, staff rows and one case with one submission, created as the database owner. */
export async function fixtures(c: pg.Client): Promise<void> {
  await as(c, 'postgres');
  await c.query('insert into auth.users (id, email) values ($1, $4), ($2, $5), ($3, $6)', [
    OWNER,
    ADMIN,
    NOBODY,
    'owner@test.invalid',
    'admin@test.invalid',
    'nobody@test.invalid',
  ]);
  await c.query("insert into public.staff (user_id, role) values ($1, 'owner'), ($2, 'admin')", [
    OWNER,
    ADMIN,
  ]);
  await c.query(`insert into public.cases (case_ref, category, authority_id, status, forwarded_at)
                 values ('SL-2026-9001', 'ncii', (select id from public.authorities where public_label = 'CCID'), 'submitted', now())`);
  await c.query(`insert into public.submissions (id, case_ref, category, platform, description, reporter_role, contact_consent, language)
                 values ('11111111-1111-4111-8111-111111111111', 'SL-2026-9001', 'ncii', 'FAKE platform', 'FAKE private text', 'self', true, 'en')`);
  await c.query(`insert into public.reporter_contacts (submission_id, phone_enc, phone_hmac, tracking_code_hash)
                 values ('11111111-1111-4111-8111-111111111111', '\\x00', '\\x01', '\\x02')`);
  await c.query("insert into public.audit_log (actor, action, target) values ($1, 'fixture', 'test')", [
    OWNER,
  ]);
}
