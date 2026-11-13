// The most important tests in the project (manual section 8): who can read and write what.
import { describe, expect, it } from 'vitest';
import { ADMIN, NOBODY, OWNER, PUBLIC_TABLES, as, attempt, fixtures, tableNames, withTx } from './helpers';

const PRIVATE_ONLY = [
  'reporter_contacts',
  'identifiers',
  'rate_limits',
  'case_ref_counters',
  'aggregate_counters',
  'revocations',
];

describe('anonymous visitor', () => {
  it('is refused on every private table', () =>
    withTx(async (c) => {
      const all = await tableNames(c);
      const priv = all.filter((t) => !(PUBLIC_TABLES as readonly string[]).includes(t));
      expect(priv.length).toBeGreaterThan(10);
      await as(c, 'anon');
      for (const t of priv) {
        const r = await attempt(c, `select * from public.${t} limit 1`);
        expect(r.ok, t).toBe(false);
        if (!r.ok) expect(r.code, t).toBe('42501');
      }
    }));

  it('can read the four public tables', () =>
    withTx(async (c) => {
      await as(c, 'anon');
      for (const [sql, min] of [
        ['select case_id from public.public_ledger', 1],
        ['select total_forwarded from public.public_stats', 1],
        ['select mode from public.intake_state', 1],
        ['select public_label from public.authorities', 5],
      ] as const) {
        const r = await attempt(c, sql);
        expect(r.ok, sql).toBe(true);
        if (r.ok) expect(r.rows.length, sql).toBeGreaterThanOrEqual(min);
      }
    }));

  it('cannot read hidden columns of the public tables', () =>
    withTx(async (c) => {
      await as(c, 'anon');
      for (const sql of [
        'select daily_cap from public.intake_state',
        'select today_count from public.intake_state',
        'select * from public.intake_state',
        'select name from public.authorities',
        'select * from public.authorities',
      ]) {
        const r = await attempt(c, sql);
        expect(r.ok, sql).toBe(false);
        if (!r.ok) expect(r.code, sql).toBe('42501');
      }
    }));
});

describe('nobody in a browser can write anything', () => {
  it.each([
    ['anon', null],
    ['authenticated', { sub: ADMIN, aal: 'aal2' }],
    ['authenticated', { sub: OWNER, aal: 'aal2' }],
  ] as const)('%s %j is refused INSERT, DELETE and TRUNCATE on every table', (role, claims) =>
    withTx(async (c) => {
      await fixtures(c);
      const all = await tableNames(c);
      await as(c, role, claims);
      for (const t of all) {
        for (const sql of [
          `insert into public.${t} default values`,
          `delete from public.${t}`,
          `truncate public.${t}`,
        ]) {
          const r = await attempt(c, sql);
          expect(r.ok, `${role} ${sql}`).toBe(false);
          if (!r.ok) expect(r.code, `${role} ${sql}`).toBe('42501');
        }
      }
      const upd = await attempt(
        c,
        "update public.public_ledger set description = 'FAKE: tampered text here'",
      );
      expect(upd.ok).toBe(false);
    }),
  );
});

describe('staff access needs membership AND a second factor', () => {
  it('a staff member without MFA (aal1) sees nothing', () =>
    withTx(async (c) => {
      await fixtures(c);
      await as(c, 'authenticated', { sub: ADMIN, aal: 'aal1' });
      for (const t of ['cases', 'submissions', 'case_events', 'evidence_items', 'staff', 'audit_log']) {
        const r = await attempt(c, `select * from public.${t}`);
        expect(r.ok, t).toBe(true);
        if (r.ok) expect(r.rows, t).toHaveLength(0);
      }
    }));

  it('a signed-in user who is not staff sees nothing, even with aal2 and admin claims in their metadata', () =>
    withTx(async (c) => {
      await fixtures(c);
      await as(c, 'authenticated', {
        sub: NOBODY,
        aal: 'aal2',
        role: 'admin',
        user_metadata: { role: 'owner' },
        app_metadata: { role: 'owner', staff: true },
      });
      for (const t of ['cases', 'submissions', 'staff', 'audit_log']) {
        const r = await attempt(c, `select * from public.${t}`);
        expect(r.ok, t).toBe(true);
        if (r.ok) expect(r.rows, t).toHaveLength(0);
      }
    }));

  it('staff with aal2 can read case data', () =>
    withTx(async (c) => {
      await fixtures(c);
      await as(c, 'authenticated', { sub: ADMIN, aal: 'aal2' });
      for (const t of ['cases', 'submissions']) {
        const r = await attempt(c, `select * from public.${t}`);
        expect(r.ok && r.rows.length, t).toBeGreaterThanOrEqual(1);
      }
    }));

  it('an anon connection cannot borrow a staff identity', () =>
    withTx(async (c) => {
      await fixtures(c);
      await as(c, 'anon', { sub: OWNER, aal: 'aal2' });
      const r = await attempt(c, 'select * from public.cases');
      expect(r.ok).toBe(false);
    }));

  it('audit log and the staff list are owner-only; an admin sees only their own staff row', () =>
    withTx(async (c) => {
      await fixtures(c);
      await as(c, 'authenticated', { sub: ADMIN, aal: 'aal2' });
      const audit = await attempt(c, 'select * from public.audit_log');
      expect(audit.ok && audit.rows.length).toBe(0);
      const staff = await attempt(c, 'select user_id from public.staff');
      expect(staff.ok && staff.rows.map((r) => r.user_id)).toEqual([ADMIN]);
      await as(c, 'authenticated', { sub: OWNER, aal: 'aal2' });
      const audit2 = await attempt(c, 'select * from public.audit_log');
      expect(audit2.ok && audit2.rows.length).toBeGreaterThanOrEqual(1);
      const staff2 = await attempt(c, 'select user_id from public.staff');
      expect(staff2.ok && staff2.rows).toHaveLength(2);
    }));

  it('even aal2 staff cannot read contact data, identifiers or counters directly', () =>
    withTx(async (c) => {
      await fixtures(c);
      await as(c, 'authenticated', { sub: OWNER, aal: 'aal2' });
      for (const t of PRIVATE_ONLY) {
        const r = await attempt(c, `select * from public.${t}`);
        expect(r.ok, t).toBe(false);
        if (!r.ok) expect(r.code, t).toBe('42501');
      }
    }));

  it('quarantined evidence is invisible to staff', () =>
    withTx(async (c) => {
      await fixtures(c);
      await as(c, 'postgres');
      await c.query(`insert into public.evidence_items (submission_id, storage_path, sha256, size_bytes, mime, quarantined, quarantined_at) values
        ('11111111-1111-4111-8111-111111111111', 'a/ok.png', repeat('a', 64), 100, 'image/png', false, null),
        ('11111111-1111-4111-8111-111111111111', 'a/bad.png', repeat('b', 64), 100, 'image/png', true, now())`);
      await as(c, 'authenticated', { sub: OWNER, aal: 'aal2' });
      const r = await attempt(c, 'select storage_path from public.evidence_items');
      expect(r.ok && r.rows.map((x) => x.storage_path)).toEqual(['a/ok.png']);
    }));
});

describe('service role (Edge Functions)', () => {
  it('can write private tables', () =>
    withTx(async (c) => {
      await as(c, 'service_role');
      const r = await attempt(
        c,
        "insert into public.revocations (reason_category) values ('personal_reasons') returning id",
      );
      expect(r.ok).toBe(true);
    }));
});
