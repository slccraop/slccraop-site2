// Behaviour of the service-role functions, constraints and triggers.
import { describe, expect, it } from 'vitest';
import { ADMIN, as, attempt, fixtures, withTx } from './helpers';

const colomboYear = new Date(Date.now() + 5.5 * 3600_000).getUTCFullYear();

describe('service-only functions', () => {
  it.each(['take_intake_slot()', 'allocate_case_ref()', 'refresh_public_stats()', 'reset_intake_day()'])(
    '%s is refused to anon and signed-in users, allowed to the service role',
    (fn) =>
      withTx(async (c) => {
        await fixtures(c);
        for (const [role, claims] of [
          ['anon', null],
          ['authenticated', { sub: ADMIN, aal: 'aal2' }],
        ] as const) {
          await as(c, role, claims);
          const r = await attempt(c, `select public.${fn}`);
          expect(r.ok, `${role} ${fn}`).toBe(false);
          if (!r.ok) expect(r.code).toBe('42501');
        }
        await as(c, 'service_role');
        expect((await attempt(c, `select public.${fn}`)).ok).toBe(true);
      }),
  );
});

describe('case IDs', () => {
  it('are SL-YYYY-NNNN, sequential, based on the Colombo year, and continue after the seed', () =>
    withTx(async (c) => {
      await as(c, 'service_role');
      const a = await attempt(c, 'select public.allocate_case_ref() as ref');
      const b = await attempt(c, 'select public.allocate_case_ref() as ref');
      const ra = a.ok ? String(a.rows[0]?.ref) : '';
      const rb = b.ok ? String(b.rows[0]?.ref) : '';
      expect(ra).toMatch(new RegExp(`^SL-${colomboYear}-\\d{4}$`));
      expect(Number(ra.slice(-4))).toBeGreaterThan(5); // the seed uses 0001 to 0005
      expect(Number(rb.slice(-4))).toBe(Number(ra.slice(-4)) + 1);
    }));
});

describe('intake slots and the daily cap', () => {
  const reset = (c: import('pg').Client, mode: string, cap: number) =>
    c.query(
      `update public.intake_state set mode = $1, daily_cap = $2, today_count = 0, limited_by_cap = false,
             count_date = (now() at time zone 'Asia/Colombo')::date where id = 1`,
      [mode, cap],
    );
  const slot = async (c: import('pg').Client) => {
    const r = await attempt(c, 'select public.take_intake_slot() as s');
    return r.ok ? String(r.rows[0]?.s) : `error:${r.code}`;
  };
  const mode = async (c: import('pg').Client) =>
    String((await c.query('select mode from public.intake_state')).rows[0].mode);

  it('closed refuses', () =>
    withTx(async (c) => {
      await reset(c, 'closed', 5);
      await as(c, 'service_role');
      expect(await slot(c)).toBe('closed');
    }));

  it('moves to Limited at the cap, refuses beyond it, and reopens the next Colombo day', () =>
    withTx(async (c) => {
      await reset(c, 'open', 2);
      await as(c, 'service_role');
      expect(await slot(c)).toBe('ok');
      expect(await mode(c)).toBe('open');
      expect(await slot(c)).toBe('ok');
      expect(await mode(c)).toBe('limited');
      expect(await slot(c)).toBe('capped');
      await as(c, 'postgres');
      await c.query('update public.intake_state set count_date = count_date - 1 where id = 1');
      await as(c, 'service_role');
      expect(await slot(c)).toBe('ok');
      expect(await mode(c)).toBe('open');
    }));

  it('a Limited mode set by staff by hand stays Limited after midnight', () =>
    withTx(async (c) => {
      await reset(c, 'limited', 5);
      await c.query('update public.intake_state set count_date = count_date - 1 where id = 1');
      await as(c, 'service_role');
      expect(await slot(c)).toBe('ok');
      expect(await mode(c)).toBe('limited');
    }));
});

describe('ticker statistics', () => {
  it('are computed from dated events and contain counts only', () =>
    withTx(async (c) => {
      await as(c, 'postgres');
      await c.query('delete from public.cases');
      await c.query('delete from public.revocations');
      await c.query("update public.aggregate_counters set value = 7 where name = 'minors_referred'");
      const ccid = "(select id from public.authorities where public_label = 'CCID')";
      await c.query(`insert into public.cases (case_ref, category, authority_id, status, forwarded_at, closed_at, close_reason) values
        ('SL-2026-8001', 'ncii',       ${ccid}, 'acknowledged',      '2026-10-01 00:00+00', null, null),
        ('SL-2026-8002', 'ncii',       ${ccid}, 'closed_resolved',   '2026-10-01 00:00+00', '2026-10-20 00:00+00', null),
        ('SL-2026-8003', 'sextortion', ${ccid}, 'submitted',         '2026-10-01 00:00+00', null, null),
        ('SL-2026-8004', 'harassment', ${ccid}, 'closed_unresolved', '2026-10-01 00:00+00', '2026-10-09 00:00+00', 'jurisdiction'),
        ('SL-2026-8005', 'ncii',       null,    'submitted',         null, null, null)`);
      await c.query(`insert into public.case_events (case_ref, type, authority_response_category, occurred_at) values
        ('SL-2026-8001', 'authority_reply', 'acknowledgement_received', '2026-10-05 00:00+00'),
        ('SL-2026-8002', 'authority_reply', 'acknowledgement_received', '2026-10-11 00:00+00'),
        ('SL-2026-8003', 'authority_reply', 'no_reply',                 '2026-10-15 00:00+00'),
        ('SL-2026-8004', 'authority_reply', 'acknowledgement_received', '2026-10-03 00:00+00')`);
      await c.query(
        "insert into public.revocations (reason_category) values ('personal_reasons'), ('personal_reasons'), (null)",
      );
      await as(c, 'service_role');
      expect((await attempt(c, 'select public.refresh_public_stats()')).ok).toBe(true);
      await as(c, 'postgres');
      const s = (await c.query('select * from public.public_stats')).rows[0];
      expect(s).toMatchObject({
        total_forwarded: 4,
        awaiting: 1,
        under_investigation: 0,
        closed_resolved: 1,
        closed_unresolved: 1,
        median_days_first_reply: 4,
        withdrawn_total: 3,
        minors_referred_total: 7,
        by_authority: [{ authority: 'CCID', forwarded: 4, median_days_first_reply: 4 }],
        closure_reasons: [{ reason: 'jurisdiction', count: 1 }],
        withdrawal_reasons: [{ reason: 'personal_reasons', count: 2 }],
      });
      expect(JSON.stringify(s)).not.toContain('SL-2026');
    }));
});

describe('public ledger safety net', () => {
  const insert = (description: string, extra = '') =>
    `insert into public.public_ledger (case_id, created_on, category, description, authority ${extra ? ', ' + extra.split('=')[0] : ''})
     values ('SL-2026-7001', '2026-11-01', 'ncii', ${description === '' ? "''" : `'${description.replace(/'/g, "''")}'`}, 'CCID' ${extra ? ', ' + extra.split('=')[1] : ''})`;

  it('accepts a clean, sanitised description', () =>
    withTx(async (c) => {
      await as(c, 'service_role');
      for (const text of [
        'FAKE: Images shared in a closed group without consent.',
        'Content reposted during 2026 across several pages.',
      ]) {
        expect(
          (await attempt(c, insert(text).replace('SL-2026-7001', `SL-2026-70${text.length}`))).ok,
          text,
        ).toBe(true);
      }
    }));

  it.each([
    ['a link', 'FAKE: see http://example.test for the post'],
    ['a bare domain', 'FAKE: shared on example.com yesterday'],
    ['www', 'FAKE: posted at www.example'],
    ['an email', 'FAKE: reach out to someone at mail.test via a@b'],
    ['an @handle', 'FAKE: account @someone posted the images'],
    ['a phone number', 'FAKE: called from 077 123 4567 repeatedly'],
    ['an international number', 'FAKE: called from +94 77 123 4567 often'],
    ['an honorific and a name', 'FAKE: Mr Perera shared the images'],
    ['a doctor title and a name', 'FAKE: Dr. Silva was named in the post'],
    ['too short', 'short'],
    ['too long', 'FAKE: ' + 'x'.repeat(290)],
  ])('rejects %s', (_label, text) =>
    withTx(async (c) => {
      await as(c, 'service_role');
      const r = await attempt(c, insert(text));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('23514');
    }),
  );

  it('rejects inconsistent rows and unsafe authority references', () =>
    withTx(async (c) => {
      await as(c, 'service_role');
      const base = "'SL-2026-7002', '2026-11-01', 'ncii', 'FAKE: Images shared in a closed group.', 'CCID'";
      const cols = 'case_id, created_on, category, description, authority';
      for (const [label, sql] of [
        [
          'unresolved without a reason',
          `insert into public.public_ledger (${cols}, status) values (${base}, 'closed_unresolved')`,
        ],
        [
          'a reason on an open case',
          `insert into public.public_ledger (${cols}, status, closure_reason) values (${base}, 'submitted', 'jurisdiction')`,
        ],
        [
          'an exchange without a date',
          `insert into public.public_ledger (${cols}, latest_exchange) values (${base}, 'action_in_progress')`,
        ],
        [
          'a link as authority id',
          `insert into public.public_ledger (${cols}, authority_case_id) values (${base}, 'http://x.test/1')`,
        ],
        [
          'a malformed case id',
          `insert into public.public_ledger (${cols.replace('case_id', 'case_id')}) values ('SL-26-1', '2026-11-01', 'ncii', 'FAKE: Images shared in a closed group.', 'CCID')`,
        ],
      ] as const) {
        const r = await attempt(c, sql);
        expect(r.ok, label).toBe(false);
        if (!r.ok) expect(r.code, label).toBe('23514');
      }
    }));
});

describe('audit log is append-only', () => {
  it.each(['postgres', 'service_role'] as const)('%s cannot update, delete or truncate', (role) =>
    withTx(async (c) => {
      await as(c, 'service_role');
      expect(
        (await attempt(c, "insert into public.audit_log (action, target) values ('test', 'x')")).ok,
      ).toBe(true);
      await as(c, role);
      for (const sql of [
        "update public.audit_log set action = 'edited'",
        'delete from public.audit_log',
        'truncate public.audit_log',
      ]) {
        const r = await attempt(c, sql);
        expect(r.ok, sql).toBe(false);
        if (!r.ok) expect(r.message, sql).toContain('append-only');
      }
    }),
  );
});

describe('evidence rules', () => {
  const sub = '11111111-1111-4111-8111-111111111111';
  const item = (path: string, sha = 'a'.repeat(64), size = 100, mime = 'image/png') =>
    `insert into public.evidence_items (submission_id, storage_path, sha256, size_bytes, mime) values ('${sub}', '${path}', '${sha}', ${size}, '${mime}')`;

  it('allows 10 images and refuses the 11th', () =>
    withTx(async (c) => {
      await fixtures(c);
      await as(c, 'service_role');
      for (let i = 0; i < 10; i++) expect((await attempt(c, item(`p/${i}.png`))).ok).toBe(true);
      const r = await attempt(c, item('p/10.png'));
      expect(r.ok).toBe(false);
    }));

  it.each([
    ['an SVG', item('p/a.svg', 'a'.repeat(64), 100, 'image/svg+xml')],
    ['a PDF', item('p/a.pdf', 'a'.repeat(64), 100, 'application/pdf')],
    ['a file over 10 MB', item('p/big.png', 'a'.repeat(64), 10485761)],
    ['an empty file', item('p/zero.png', 'a'.repeat(64), 0)],
    ['a malformed hash', item('p/h.png', 'xyz')],
  ])('rejects %s', (_label, sql) =>
    withTx(async (c) => {
      await fixtures(c);
      await as(c, 'service_role');
      const r = await attempt(c, sql);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.code).toBe('23514');
    }),
  );
});

describe('anonymity and defaults', () => {
  it('revocations carry no link to any person or case', () =>
    withTx(async (c) => {
      const r = await c.query(
        "select column_name from information_schema.columns where table_name = 'revocations' and table_schema = 'public' order by 1",
      );
      expect(r.rows.map((x) => x.column_name)).toEqual(['id', 'occurred_at', 'reason_category']);
    }));

  it('intake starts Closed (fail closed) and the single-row tables stay single-row', () =>
    withTx(async (c) => {
      const d = await c.query(
        "select column_default from information_schema.columns where table_name = 'intake_state' and column_name = 'mode'",
      );
      expect(String(d.rows[0].column_default)).toContain("'closed'");
      for (const t of ['intake_state', 'public_stats']) {
        const r = await attempt(c, `insert into public.${t} (id) values (2)`);
        expect(r.ok, t).toBe(false);
      }
    }));

  it('the seed is entirely marked FAKE', () =>
    withTx(async (c) => {
      const r = await c.query(
        "select count(*)::int as n from public.public_ledger where description not like 'FAKE:%'",
      );
      expect(r.rows[0].n).toBe(0);
    }));
});
