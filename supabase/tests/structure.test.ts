// Structural guarantees that must hold no matter what migrations are added later.
import { describe, expect, it } from 'vitest';
import { PUBLIC_TABLES, as, attempt, withTx } from './helpers';

describe('database structure', () => {
  it('every public table has row level security enabled', () =>
    withTx(async (c) => {
      const r = await c.query(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
      expect(r.rows.map((x) => x.relname)).toEqual([]);
    }));

  it('no policy is `using (true)` on a private table', () =>
    withTx(async (c) => {
      const r = await c.query(
        "select tablename from pg_policies where schemaname = 'public' and (qual = 'true' or with_check = 'true')",
      );
      const offenders = r.rows
        .map((x) => x.tablename)
        .filter((t) => !(PUBLIC_TABLES as readonly string[]).includes(t));
      expect(offenders).toEqual([]);
    }));

  it('no policy allows INSERT, UPDATE, DELETE or ALL', () =>
    withTx(async (c) => {
      const r = await c.query(
        "select tablename, cmd from pg_policies where schemaname = 'public' and cmd <> 'SELECT'",
      );
      expect(r.rows).toEqual([]);
    }));

  it('anon and authenticated hold only SELECT, on exactly the intended tables and columns', () =>
    withTx(async (c) => {
      const writes =
        await c.query(`select grantee, table_name, privilege_type from information_schema.role_table_grants
        where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'`);
      expect(writes.rows).toEqual([]);
      const colWrites =
        await c.query(`select grantee, table_name, column_name from information_schema.column_privileges
        where table_schema = 'public' and grantee in ('anon', 'authenticated') and privilege_type <> 'SELECT'`);
      expect(colWrites.rows).toEqual([]);
      const anonTables = await c.query(`select table_name from information_schema.role_table_grants
        where table_schema = 'public' and grantee = 'anon' and privilege_type = 'SELECT' order by 1`);
      expect(anonTables.rows.map((x) => x.table_name)).toEqual(['public_ledger', 'public_stats']);
      const anonCols = await c.query(`select table_name, column_name from information_schema.column_privileges
        where table_schema = 'public' and grantee = 'anon' and table_name in ('intake_state', 'authorities') order by 1, 2`);
      expect(anonCols.rows).toEqual([
        { table_name: 'authorities', column_name: 'public_label' },
        { table_name: 'intake_state', column_name: 'mode' },
      ]);
    }));

  it('every SECURITY DEFINER function pins an empty search_path', () =>
    withTx(async (c) => {
      const r = await c.query(`select n.nspname || '.' || p.proname as fn, p.proconfig from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname in ('public', 'private') and p.prosecdef`);
      expect(r.rows.length).toBeGreaterThan(3);
      for (const row of r.rows) expect(row.proconfig, row.fn).toContain('search_path=""');
    }));

  it('no function in the public schema is executable by anon or authenticated', () =>
    withTx(async (c) => {
      const r = await c.query(`select p.proname,
          has_function_privilege('anon', p.oid, 'execute') as anon_ok,
          has_function_privilege('authenticated', p.oid, 'execute') as auth_ok
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`);
      expect(r.rows.length).toBeGreaterThanOrEqual(4);
      for (const row of r.rows) {
        expect(row.anon_ok, row.proname).toBe(false);
        expect(row.auth_ok, row.proname).toBe(false);
      }
    }));

  it('the audit log is protected by blocking triggers', () =>
    withTx(async (c) => {
      const r = await c.query(
        "select tgname from pg_trigger where tgrelid = 'public.audit_log'::regclass and not tgisinternal order by 1",
      );
      expect(r.rows.map((x) => x.tgname)).toEqual(['audit_log_no_truncate', 'audit_log_no_update_delete']);
    }));
});

describe('storage', () => {
  it('has three private buckets with a 10 MB limit and image-only types', () =>
    withTx(async (c) => {
      const r = await c.query(
        "select id, public, file_size_limit, allowed_mime_types from storage.buckets where id like 'evidence-%' order by id",
      );
      expect(r.rows.map((x) => x.id)).toEqual(['evidence-incoming', 'evidence-original', 'evidence-preview']);
      for (const b of r.rows) {
        expect(b.public, b.id).toBe(false);
        expect(Number(b.file_size_limit), b.id).toBe(10485760);
        expect([...b.allowed_mime_types].sort(), b.id).toEqual(['image/jpeg', 'image/png', 'image/webp']);
      }
    }));

  it('has no storage policy that could open evidence objects', () =>
    withTx(async (c) => {
      const r =
        await c.query(`select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
        and (coalesce(qual, '') like '%evidence%' or coalesce(with_check, '') like '%evidence%')`);
      expect(r.rows).toEqual([]);
    }));

  it('anon and staff cannot list evidence objects', () =>
    withTx(async (c) => {
      await as(c, 'postgres');
      await c.query(
        "insert into storage.objects (bucket_id, name) values ('evidence-original', 'x/secret.png')",
      );
      await c.query('insert into auth.users (id, email) values ($1, $2)', [
        '00000000-0000-4000-8000-0000000000aa',
        's@test.invalid',
      ]);
      await c.query(
        "insert into public.staff (user_id, role) values ('00000000-0000-4000-8000-0000000000aa', 'owner')",
      );
      for (const [role, claims] of [
        ['anon', null],
        ['authenticated', { sub: '00000000-0000-4000-8000-0000000000aa', aal: 'aal2' }],
      ] as const) {
        await as(c, role, claims);
        const r = await attempt(c, 'select name from storage.objects');
        expect(r.ok ? r.rows : [], role).toHaveLength(0);
      }
    }));
});
