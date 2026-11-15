// The admin function: who may call what, and the full staff workflow from report to published ledger row.
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { ADMIN, NOBODY, OWNER, as, fixtures, withTx } from './helpers';
import { handleAdmin } from '../functions/_shared/handlers/admin.ts';
import { handleFinalizeEvidence } from '../functions/_shared/handlers/evidence.ts';
import { handleSubmitReport } from '../functions/_shared/handlers/submit-report.ts';
import { fakeAuth, makeDeps, makePng, post, validReport, type TestDeps } from './support';

const ADMIN2 = '00000000-0000-4000-8000-000000000004';
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const nowSec = () => Math.floor(Date.now() / 1000);
let counter = 0;
/** A token the fake auth server accepts for `sub`. `over` can weaken it (aal1, expired, old sign-in). */
function token(deps: TestDeps, sub: string, over: Record<string, unknown> = {}) {
  const t = `${b64({ alg: 'none' })}.${b64({ sub, aal: 'aal2', exp: nowSec() + 3600, amr: [{ method: 'totp', timestamp: nowSec() - 5 }], jti: ++counter, ...over })}.sig`;
  (deps.auth as unknown as { __users?: Record<string, string> }).__users ??= {};
  return t;
}
function adminDeps(c: pg.Client, users: Record<string, string> = {}) {
  const deps = makeDeps(c);
  const base = fakeAuth(users);
  // An invited person exists in the auth system immediately, as with real Supabase.
  deps.auth = {
    verifyJwt: base.verifyJwt,
    async inviteUser(email) {
      const id = crypto.randomUUID();
      await c.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
      return id;
    },
  };
  return deps;
}
/** Registers a token with the fake auth server and returns it. */
function login(
  users: Record<string, string>,
  deps: TestDeps,
  sub: string,
  over: Record<string, unknown> = {},
) {
  const t = token(deps, sub, over);
  users[t] = sub;
  return t;
}
async function call(deps: TestDeps, jwt: string | null, body: unknown, headers: Record<string, string> = {}) {
  const res = await handleAdmin(
    post('admin', body, { ...(jwt ? { authorization: `Bearer ${jwt}` } : {}), ...headers }),
    deps,
  );
  return {
    status: res.status,
    json: (await res.json()) as { ok: boolean; error?: string; data?: any; problems?: string[] },
  };
}
async function team(c: pg.Client, extra = true) {
  await fixtures(c);
  if (extra) {
    await c.query("insert into auth.users (id, email) values ($1, 'admin2@test.invalid')", [ADMIN2]);
    await c.query("insert into public.staff (user_id, role) values ($1, 'admin')", [ADMIN2]);
  }
  const users: Record<string, string> = {};
  const deps = adminDeps(c, users);
  return {
    deps,
    users,
    owner: login(users, deps, OWNER),
    admin: login(users, deps, ADMIN),
    admin2: extra ? login(users, deps, ADMIN2) : '',
  };
}
const audits = async (c: pg.Client, action: string) =>
  (await c.query('select * from public.audit_log where action = $1', [action])).rows;

describe('admin door', () => {
  it('refuses missing, forged, unverified, non-MFA, expired and non-staff callers', () =>
    withTx(async (c) => {
      const { deps, users, admin } = await team(c);
      const body = { action: 'overview' };
      expect((await call(deps, null, body)).status).toBe(401);
      expect((await call(deps, 'garbage', body)).status).toBe(401);
      const forged = token(deps, OWNER); // well-formed but the auth server has never seen it
      expect((await call(deps, forged, body)).json.error).toBe('unauthorized');
      const mismatch = login(users, deps, ADMIN, { sub: OWNER }); // auth server says ADMIN, claims say OWNER
      expect((await call(deps, mismatch, body)).status).toBe(401);
      const aal1 = login(users, deps, ADMIN, { aal: 'aal1' });
      const r1 = await call(deps, aal1, body);
      expect([r1.status, r1.json.error]).toEqual([403, 'mfa_required']);
      const expired = login(users, deps, ADMIN, { exp: nowSec() - 10 });
      expect((await call(deps, expired, body)).status).toBe(401);
      const nobody = login(users, deps, NOBODY);
      const r2 = await call(deps, nobody, body);
      expect([r2.status, r2.json.error]).toEqual([403, 'forbidden']);
      expect((await call(deps, admin, body)).status).toBe(200);
    }));

  it('refuses unknown actions, bad input, other origins and wrong methods', () =>
    withTx(async (c) => {
      const { deps, admin } = await team(c);
      expect((await call(deps, admin, { action: 'drop_everything' })).json.error).toBe('invalid');
      expect((await call(deps, admin, { action: 'get_case', case_ref: 'nope' })).json.error).toBe('invalid');
      expect((await call(deps, admin, { action: 'overview' }, { origin: 'https://evil.test' })).status).toBe(
        403,
      );
      expect((await handleAdmin(new Request('http://f.test/x', { method: 'GET' }), deps)).status).toBe(405);
    }));

  it('keeps owner-only actions away from admins, and demands a recent sign-in for the dangerous ones', () =>
    withTx(async (c) => {
      const { deps, users, owner, admin } = await team(c);
      for (const action of ['list_audit', 'list_staff', 'get_settings'])
        expect((await call(deps, admin, { action })).json.error).toBe('forbidden');
      for (const action of ['list_audit', 'list_staff', 'get_settings'])
        expect((await call(deps, owner, { action })).status).toBe(200);
      const invite = { action: 'invite_staff', email: 'new@test.invalid', role: 'admin' };
      expect((await call(deps, admin, invite)).json.error).toBe('forbidden');
      const stale = login(users, deps, OWNER, { amr: [{ method: 'totp', timestamp: nowSec() - 3600 }] });
      expect((await call(deps, stale, invite)).json.error).toBe('reauth_required');
      const ok = await call(deps, owner, invite);
      expect(ok.status).toBe(200);
      expect(
        (await c.query('select role from public.staff where user_id = $1', [ok.json.data.user_id])).rows[0]
          .role,
      ).toBe('admin');
      expect(await audits(c, 'invite_staff:admin')).toHaveLength(1);
      expect((await call(deps, stale, { action: 'export_case', case_ref: 'SL-2026-9001' })).json.error).toBe(
        'reauth_required',
      );
    }));

  it('protects the last owner and never lets someone remove themselves', () =>
    withTx(async (c) => {
      const { deps, owner } = await team(c);
      expect((await call(deps, owner, { action: 'remove_staff', user_id: OWNER })).json.error).toBe(
        'cannot_remove_self',
      );
      await c.query("update public.staff set role = 'owner' where user_id = $1", [ADMIN2]);
      expect((await call(deps, owner, { action: 'remove_staff', user_id: ADMIN2 })).status).toBe(200);
      expect(
        (await c.query('select count(*)::int as n from public.staff where user_id = $1', [ADMIN2])).rows[0].n,
      ).toBe(0);
    }));
});

const subIds = async (c: pg.Client) =>
  new Set<string>((await c.query('select id from public.submissions')).rows.map((r) => r.id as string));
/** Submits a report through the real handler and returns the new submission's id. */
async function reportId(c: pg.Client, over: Record<string, unknown>, ip: string) {
  await as(c, 'postgres');
  const before = await subIds(c);
  const res = await handleSubmitReport(
    post('submit-report', validReport(over), { 'cf-connecting-ip': ip }),
    makeDeps(c),
  );
  const id = [...(await subIds(c))].find((x) => !before.has(x));
  return { res, id: id as string };
}

/** A verified, accepted and forwarded case, ready for publishing tests. */
async function forwardedCase(c: pg.Client, t: Awaited<ReturnType<typeof team>>, ip = 110) {
  await as(c, 'postgres');
  await c.query(
    "update public.intake_state set mode = 'open', daily_cap = 50, today_count = 0, limited_by_cap = false where id = 1",
  );
  const { res, id: sub } = await reportId(
    c,
    {
      phone: `+9477${String(ip).padStart(7, '0')}`,
      links: [`https://facebook.com/groups/case-${ip}`],
      usernames: [`user${ip}`],
    },
    `198.51.100.${ip}`,
  );
  expect(res.status).toBe(200);
  await call(t.deps, t.admin, { action: 'log_call', submission_id: sub, outcome: 'reached_verified' });
  const accepted = await call(t.deps, t.admin, { action: 'accept_submission', id: sub });
  const ref = accepted.json.data.case_ref as string;
  const ccid = (await c.query("select id from public.authorities where public_label = 'CCID'")).rows[0].id;
  const when = new Date(Date.now() - 10 * 86400_000).toISOString();
  const fwd = await call(t.deps, t.admin, {
    action: 'forward_case',
    case_ref: ref,
    authority_id: ccid,
    authority_case_id: `CCID/${ip}/2026`,
    occurred_at: when,
  });
  expect(fwd.status).toBe(200);
  return { sub, ref, ccid, when };
}

describe('triage, verification and accepting', () => {
  it('lists reports, hides the phone until revealed, logs every reveal, and accepts only verified reports', () =>
    withTx(async (c) => {
      const t = await team(c);
      await as(c, 'postgres');
      await c.query(
        "update public.intake_state set mode = 'open', daily_cap = 50, today_count = 0 where id = 1",
      );
      const { id } = await reportId(c, { phone: '+94771234567' }, '198.51.100.200');
      const list = await call(t.deps, t.admin, { action: 'list_submissions', state: 'new' });
      expect(list.json.data.map((x: any) => x.id)).toContain(id);
      const detail = await call(t.deps, t.admin, { action: 'get_submission', id });
      expect(JSON.stringify(detail.json)).not.toContain('94771234567');
      expect(detail.json.data.submission.answers.links).toHaveLength(1);

      const reveal = await call(t.deps, t.admin, { action: 'reveal_contact', submission_id: id });
      expect(reveal.json.data.phone).toBe('+94771234567');
      const log = await audits(c, 'reveal_contact');
      expect(log).toHaveLength(1);
      expect(log[0].actor).toBe(ADMIN);
      expect(log[0].target).toBe(id);

      expect((await call(t.deps, t.admin, { action: 'accept_submission', id })).json.error).toBe(
        'not_verified',
      );
      await call(t.deps, t.admin, {
        action: 'log_call',
        submission_id: id,
        outcome: 'no_answer',
        note: 'Rang twice',
      });
      expect((await c.query('select state from public.submissions where id = $1', [id])).rows[0].state).toBe(
        'unverified',
      );
      expect((await call(t.deps, t.admin, { action: 'accept_submission', id })).json.error).toBe(
        'not_verified',
      );
      await call(t.deps, t.admin, { action: 'log_call', submission_id: id, outcome: 'reached_verified' });
      const ok = await call(t.deps, t.admin, { action: 'accept_submission', id });
      expect(ok.json.data.case_ref).toMatch(/^SL-\d{4}-\d{4}$/);
      expect(
        (await c.query('select state, case_ref from public.submissions where id = $1', [id])).rows[0],
      ).toMatchObject({ state: 'accepted', case_ref: ok.json.data.case_ref });
      expect((await call(t.deps, t.admin, { action: 'reject_submission', id })).json.error).toBe('conflict');
      expect(await audits(c, 'accept_submission')).toHaveLength(1);
      // The audit trail never holds the raw network address.
      const raw = JSON.stringify(
        (await c.query("select encode(ip_hash, 'hex') as h from public.audit_log where ip_hash is not null"))
          .rows,
      );
      expect(raw).not.toContain('203.0.113');
    }));

  it('blocks a reporter from submitting again', () =>
    withTx(async (c) => {
      const t = await team(c);
      await as(c, 'postgres');
      await c.query(
        "update public.intake_state set mode = 'open', daily_cap = 50, today_count = 0 where id = 1",
      );
      const { id } = await reportId(c, { phone: '+94772223333' }, '198.51.100.201');
      expect(
        (await call(t.deps, t.admin, { action: 'block_reporter', submission_id: id })).json.data.blocked,
      ).toBe(true);
      const again = await handleSubmitReport(
        post('submit-report', validReport({ phone: '07 72223333' }), { 'cf-connecting-ip': '198.51.100.77' }),
        makeDeps(c),
      );
      expect(again.status).toBe(429);
    }));

  it('handles duplicates: merging needs the earlier report accepted first', () =>
    withTx(async (c) => {
      const t = await team(c);
      await as(c, 'postgres');
      await c.query(
        "update public.intake_state set mode = 'open', daily_cap = 50, today_count = 0 where id = 1",
      );
      const first = (
        await reportId(
          c,
          { phone: '+94770000011', links: ['https://facebook.com/groups/dupe-group'], usernames: [] },
          '198.51.100.11',
        )
      ).id;
      const second = (
        await reportId(
          c,
          {
            phone: '+94770000012',
            links: ['https://m.facebook.com/groups/dupe-group/?ref=x'],
            usernames: [],
          },
          '198.51.100.12',
        )
      ).id;
      expect(
        (await c.query('select state from public.submissions where id = $1', [second])).rows[0].state,
      ).toBe('duplicate_review');
      const flags = (await call(t.deps, t.admin, { action: 'get_submission', id: second })).json.data.flags;
      expect(flags).toHaveLength(1);
      expect(flags[0].matched_id).toBe(first);
      expect(
        (
          await call(t.deps, t.admin, {
            action: 'resolve_duplicate',
            flag_id: flags[0].id,
            resolution: 'merged',
          })
        ).json.error,
      ).toBe('accept_matched_first');
      await call(t.deps, t.admin, { action: 'log_call', submission_id: first, outcome: 'reached_verified' });
      const accepted = (await call(t.deps, t.admin, { action: 'accept_submission', id: first })).json.data
        .case_ref;
      expect(
        (
          await call(t.deps, t.admin, {
            action: 'resolve_duplicate',
            flag_id: flags[0].id,
            resolution: 'merged',
          })
        ).status,
      ).toBe(200);
      expect(
        (await c.query('select case_ref, state from public.submissions where id = $1', [second])).rows[0],
      ).toEqual({ case_ref: accepted, state: 'accepted' });
      expect(
        (
          await c.query('select count(*)::int as n from public.case_submissions where case_ref = $1', [
            accepted,
          ])
        ).rows[0].n,
      ).toBe(2);
      expect(
        (
          await call(t.deps, t.admin, {
            action: 'resolve_duplicate',
            flag_id: flags[0].id,
            resolution: 'separate',
          })
        ).json.error,
      ).toBe('conflict');
    }));
});

describe('authority tracking and publishing', () => {
  it('runs a case from forwarding to a published, closed ledger row, with every rule enforced', () =>
    withTx(async (c) => {
      const t = await team(c);
      const { ref } = await forwardedCase(c, t);
      expect(
        (
          await call(t.deps, t.admin, {
            action: 'forward_case',
            case_ref: ref,
            authority_id: 1,
            occurred_at: new Date().toISOString(),
          })
        ).json.error,
      ).toBe('already_forwarded');

      const reply = (body: Record<string, unknown>) =>
        call(t.deps, t.admin, {
          action: 'record_reply',
          case_ref: ref,
          occurred_at: new Date(Date.now() - 3 * 86400_000).toISOString(),
          ...body,
        });
      expect(
        (
          await reply({
            response: 'acknowledgement_received',
            occurred_at: new Date(Date.now() + 86400_000 * 3).toISOString(),
          })
        ).json.error,
      ).toBe('date_in_future');
      expect(
        (
          await reply({
            response: 'acknowledgement_received',
            occurred_at: new Date(Date.now() - 30 * 86400_000).toISOString(),
          })
        ).json.error,
      ).toBe('before_forwarded');
      expect((await reply({ response: 'acknowledgement_received' })).status).toBe(200);
      expect((await call(t.deps, t.admin, { action: 'get_case', case_ref: ref })).json.data.case.status).toBe(
        'acknowledged',
      );
      expect((await reply({ response: 'action_in_progress' })).status).toBe(200);
      expect((await call(t.deps, t.admin, { action: 'get_case', case_ref: ref })).json.data.case.status).toBe(
        'under_investigation',
      );

      // Publishing: lint, then a different admin must approve, then it goes live.
      const draft = (description: string) =>
        call(t.deps, t.admin, { action: 'draft_ledger', case_ref: ref, description });
      const linted = await draft('FAKE: contact them at 077 123 4567 or www.example.com');
      expect([linted.status, linted.json.error]).toEqual([400, 'lint_failed']);
      expect(linted.json.problems!.length).toBeGreaterThanOrEqual(2);
      expect((await draft('FAKE: Images shared in a closed group without consent.')).status).toBe(200);
      expect((await call(t.deps, t.admin, { action: 'publish_ledger', case_ref: ref })).json.error).toBe(
        'approval_required',
      );
      expect((await call(t.deps, t.admin, { action: 'approve_ledger', case_ref: ref })).json.error).toBe(
        'second_approver_required',
      );
      expect((await call(t.deps, t.admin2, { action: 'approve_ledger', case_ref: ref })).status).toBe(200);
      expect(
        (await call(t.deps, t.admin, { action: 'publish_ledger', case_ref: ref })).json.data.published,
      ).toBe(true);

      await as(c, 'anon');
      const live = (
        await c.query(
          'select case_id, status, authority, latest_exchange, description from public.public_ledger where case_id = $1',
          [ref],
        )
      ).rows[0];
      expect(live).toMatchObject({
        status: 'under_investigation',
        authority: 'CCID',
        latest_exchange: 'action_in_progress',
      });
      expect(live.description).toMatch(/^FAKE:/);
      await as(c, 'postgres');

      // Closing needs an outcome and, for unresolved, a reason. The public row follows automatically.
      expect((await reply({ response: 'closed_by_authority' })).json.error).toBe('outcome_required');
      expect((await reply({ response: 'closed_by_authority', outcome: 'unresolved' })).json.error).toBe(
        'reason_required',
      );
      expect(
        (
          await reply({
            response: 'closed_by_authority',
            outcome: 'unresolved',
            closure_reason: 'suspect_not_identified',
          })
        ).status,
      ).toBe(200);
      const closed = (
        await c.query(
          'select status, closure_reason, latest_exchange from public.public_ledger where case_id = $1',
          [ref],
        )
      ).rows[0];
      expect(closed).toEqual({
        status: 'closed_unresolved',
        closure_reason: 'suspect_not_identified',
        latest_exchange: 'closed_by_authority',
      });
      const stats = (await c.query('select closed_unresolved, total_forwarded from public.public_stats'))
        .rows[0];
      expect(stats.closed_unresolved).toBeGreaterThanOrEqual(1);
      expect((await reply({ response: 'acknowledgement_received' })).json.error).toBe('already_closed');

      expect((await call(t.deps, t.admin, { action: 'unpublish_ledger', case_id: ref })).status).toBe(200);
      expect(
        (await c.query('select count(*)::int as n from public.public_ledger where case_id = $1', [ref]))
          .rows[0].n,
      ).toBe(0);
      for (const a of [
        'forward_case',
        'record_reply',
        'draft_ledger',
        'approve_ledger',
        'publish_ledger',
        'unpublish_ledger',
      ])
        expect((await audits(c, a)).length, a).toBeGreaterThanOrEqual(1);
    }));

  it('lets a sole admin publish alone, but refuses to publish a case that was never forwarded', () =>
    withTx(async (c) => {
      const t = await team(c, false);
      await c.query('delete from public.staff where user_id = $1', [OWNER]); // exactly one staff member remains
      const { ref } = await forwardedCase(c, t, 111);
      expect(
        (
          await call(t.deps, t.admin, {
            action: 'draft_ledger',
            case_ref: ref,
            description: 'FAKE: Threats to release images unless money is paid.',
          })
        ).status,
      ).toBe(200);
      expect((await call(t.deps, t.admin, { action: 'publish_ledger', case_ref: ref })).status).toBe(200);
      await c.query("insert into public.cases (case_ref, category) values ('SL-2026-9300', 'ncii')");
      expect(
        (
          await call(t.deps, t.admin, {
            action: 'draft_ledger',
            case_ref: 'SL-2026-9300',
            description: 'FAKE: Images shared in a closed group.',
          })
        ).json.error,
      ).toBe('not_forwarded');
    }));

  it('tracks silence, follow-ups, resubmissions and corrections', () =>
    withTx(async (c) => {
      const t = await team(c);
      const { ref } = await forwardedCase(c, t, 112);
      const early = await call(t.deps, t.admin, { action: 'list_followups' });
      expect(early.json.data.find((x: any) => x.case_ref === ref)).toBeUndefined(); // 10 days: not yet due
      await c.query("update public.cases set forwarded_at = now() - interval '20 days' where case_ref = $1", [
        ref,
      ]);
      const due = (await call(t.deps, t.admin, { action: 'list_followups' })).json.data.find(
        (x: any) => x.case_ref === ref,
      );
      expect(due.level).toBe(1);
      expect(due.email_draft).toContain(ref);
      expect(due.email_draft).not.toMatch(/\+94|77|facebook|FAKE/i); // no personal or case detail
      await call(t.deps, t.admin, { action: 'log_follow_up', case_ref: ref });
      expect(
        (await call(t.deps, t.admin, { action: 'list_followups' })).json.data.find(
          (x: any) => x.case_ref === ref,
        ),
      ).toBeUndefined();

      expect(
        (await call(t.deps, t.admin, { action: 'set_resubmission', case_ref: ref, requested: true })).status,
      ).toBe(200);
      let k = (await call(t.deps, t.admin, { action: 'get_case', case_ref: ref })).json.data.case;
      expect([k.status, k.resubmission_requested]).toEqual(['resubmission_requested', true]);
      await call(t.deps, t.admin, { action: 'set_resubmission', case_ref: ref, requested: false });
      k = (await call(t.deps, t.admin, { action: 'get_case', case_ref: ref })).json.data.case;
      expect([k.status, k.resubmission_requested]).toEqual(['submitted', false]);

      await c.query(
        "insert into public.correction_requests (case_id, request_type, details) values ($1, 'remove', 'Please remove this row, details here.')",
        [ref],
      );
      const list = await call(t.deps, t.admin, { action: 'list_corrections' });
      expect(list.json.data[0].state).toBe('new');
      expect(
        (await call(t.deps, t.admin, { action: 'handle_correction', id: list.json.data[0].id })).status,
      ).toBe(200);
      expect((await call(t.deps, t.admin, { action: 'overview' })).json.data.corrections_new).toBe(0);
    }));
});

describe('evidence, quarantine and export', () => {
  it('shows only the stripped copy through a short-lived logged link, and quarantine removes an item for good', () =>
    withTx(async (c) => {
      const t = await team(c);
      await as(c, 'postgres');
      await c.query(
        "update public.intake_state set mode = 'open', daily_cap = 50, today_count = 0 where id = 1",
      );
      const sub = makeDeps(c);
      const res = await handleSubmitReport(
        post(
          'submit-report',
          validReport({
            files: [
              { mime: 'image/png', size: 100 },
              { mime: 'image/png', size: 100 },
            ],
          }),
        ),
        sub,
      );
      const body = (await res.json()) as {
        tracking_code: string;
        uploads: { upload_id: string; path: string }[];
      };
      for (const u of body.uploads) {
        sub.storage.put('evidence-incoming', u.path, makePng());
        expect(
          (
            await handleFinalizeEvidence(
              post(
                'finalize-evidence',
                { tracking_code: body.tracking_code, upload_id: u.upload_id },
                { 'cf-connecting-ip': '198.51.100.120' },
              ),
              sub,
            )
          ).status,
        ).toBe(200);
      }
      t.deps.storage = sub.storage;
      const id = (
        await c.query(
          'select submission_id as id from public.evidence_uploads order by incoming_path limit 1',
        )
      ).rows[0].id;
      const items = (await call(t.deps, t.admin, { action: 'get_submission', id })).json.data.evidence;
      expect(items).toHaveLength(2);
      const view = await call(t.deps, t.admin, { action: 'evidence_view', evidence_id: items[0].id });
      expect(view.json.data.url).toContain('evidence-preview');
      expect(view.json.data.url).toContain('exp=60');
      expect(await audits(c, 'evidence_view')).toHaveLength(1);

      const q = await call(t.deps, t.admin, { action: 'quarantine_evidence', evidence_id: items[0].id });
      expect(q.json.data.quarantined).toBe(true);
      expect((await c.query('select kind, reported_by from public.incidents')).rows[0]).toEqual({
        kind: 'child_safety_concern',
        reported_by: ADMIN,
      });
      expect(
        (await call(t.deps, t.admin, { action: 'evidence_view', evidence_id: items[0].id })).status,
      ).toBe(404);
      expect((await call(t.deps, t.admin, { action: 'get_submission', id })).json.data.evidence).toHaveLength(
        1,
      );
      expect(
        (await call(t.deps, t.admin, { action: 'quarantine_evidence', evidence_id: items[0].id })).status,
      ).toBe(404);
    }));

  it('exports a case dossier only after a recent sign-in, logs it, and includes the phone only with consent', () =>
    withTx(async (c) => {
      const t = await team(c);
      const { ref, sub } = await forwardedCase(c, t, 113);
      const stale = login(t.users, t.deps, ADMIN, { amr: [{ method: 'totp', timestamp: nowSec() - 4000 }] });
      expect((await call(t.deps, stale, { action: 'export_case', case_ref: ref })).json.error).toBe(
        'reauth_required',
      );
      const ok = await call(t.deps, t.admin, { action: 'export_case', case_ref: ref });
      expect(ok.status).toBe(200);
      expect(ok.json.data.reporters[0].phone).toBe('+94770000113');
      expect(ok.json.data.case.case_ref).toBe(ref);
      expect(ok.json.data.events.map((e: any) => e.type)).toContain('forwarded');
      expect(await audits(c, 'export_case')).toHaveLength(1);
      await c.query('update public.submissions set contact_consent = false where id = $1', [sub]);
      expect(
        (await call(t.deps, t.admin, { action: 'export_case', case_ref: ref })).json.data.reporters[0].phone,
      ).toBeNull();
    }));
});

describe('intake, counters, archive queue and owner settings', () => {
  it('changes intake mode and the minors counter, and logs both', () =>
    withTx(async (c) => {
      const t = await team(c);
      expect(
        (await call(t.deps, t.admin, { action: 'set_intake', mode: 'limited', daily_cap: 3 })).status,
      ).toBe(200);
      expect((await c.query('select mode, daily_cap from public.intake_state')).rows[0]).toEqual({
        mode: 'limited',
        daily_cap: 3,
      });
      expect(
        (await call(t.deps, t.admin, { action: 'set_intake', mode: 'open', daily_cap: 5000 })).json.error,
      ).toBe('invalid');
      await call(t.deps, t.admin, { action: 'adjust_minors', delta: 2 });
      expect(
        (await c.query('select minors_referred_total from public.public_stats')).rows[0]
          .minors_referred_total,
      ).toBe(6);
      expect((await call(t.deps, t.admin, { action: 'adjust_minors', delta: 50 })).json.error).toBe(
        'invalid',
      );
      expect(await audits(c, 'set_intake:limited:3')).toHaveLength(1);
    }));

  it('runs the Wayback queue with a second check and refuses member lists and private-group style pages', () =>
    withTx(async (c) => {
      const t = await team(c);
      for (const url of [
        'https://facebook.com/groups/x/members',
        'https://facebook.com/groups/x?sk=members',
        'http://facebook.com/groups/x',
        'https://x.test/photos/1',
      ])
        expect((await call(t.deps, t.admin, { action: 'archive_add', url })).status, url).toBe(400);
      const added = await call(t.deps, t.admin, {
        action: 'archive_add',
        url: 'https://facebook.com/groups/public-about',
      });
      const id = added.json.data.id;
      expect((await call(t.deps, t.admin, { action: 'archive_decide', id, approve: true })).json.error).toBe(
        'second_approver_required',
      );
      expect(
        (
          await call(t.deps, t.admin, {
            action: 'archive_record',
            id,
            snapshot_url: 'https://web.archive.org/web/1/x',
          })
        ).json.error,
      ).toBe('conflict');
      expect((await call(t.deps, t.admin2, { action: 'archive_decide', id, approve: true })).status).toBe(
        200,
      );
      expect(
        (
          await call(t.deps, t.admin2, {
            action: 'archive_record',
            id,
            snapshot_url: 'https://web.archive.org/web/20261113/https://facebook.com/groups/public-about',
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await c.query(
            'select status, snapshot_url is not null as has from public.archive_requests where id = $1',
            [id],
          )
        ).rows[0],
      ).toEqual({ status: 'captured', has: true });
    }));

  it('lets the owner change tunable settings (numbers or lists) and read the audit log', () =>
    withTx(async (c) => {
      const t = await team(c);
      expect(
        (await call(t.deps, t.owner, { action: 'set_setting', key: 'retention_withdrawn_days', value: 14 }))
          .status,
      ).toBe(200);
      expect(
        (await call(t.deps, t.owner, { action: 'set_setting', key: 'follow_up_days', value: [7, 21] }))
          .status,
      ).toBe(200);
      expect(
        (await call(t.deps, t.owner, { action: 'set_setting', key: 'follow_up_days', value: 5 })).json.error,
      ).toBe('invalid');
      const vals = Object.fromEntries(
        (await c.query('select key, value from public.app_settings')).rows.map((r) => [r.key, r.value]),
      );
      expect(vals.retention_withdrawn_days).toBe(14);
      expect(vals.follow_up_days).toEqual([7, 21]);
      const log = await call(t.deps, t.owner, { action: 'list_audit' });
      expect(log.json.data.map((r: any) => r.action)).toContain('set_setting:follow_up_days');
    }));
});
