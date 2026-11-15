import { z } from 'zod';
import type { Db, Deps } from '../deps.ts';
import { decryptText, fromHex, hmacHex } from '../crypto.ts';
import { corsHeaders, gate, readJson } from '../http.ts';
import { logError } from '../guards.ts';
import { lintPublicText } from '../lint.ts';

/**
 * POST admin. One door for every staff action (manual 6.6). Order of checks, each failing closed:
 *   1 the browser's origin  2 the JWT is genuine (asked of the auth server)  3 the second factor was used (aal2)
 *   4 the user has a row in `staff`  5 owner-only and recent-login rules per action  6 the action runs in ONE transaction
 *   together with its audit_log row, so no change can happen without a record.
 */

const uuid = z.string().uuid();
const caseRef = z.string().regex(/^SL-\d{4}-\d{4,}$/);
const when = z.iso.datetime({ offset: true });
const page = {
  limit: z.number().int().min(1).max(100).default(50),
  offset: z.number().int().min(0).default(0),
};
const STATES = [
  'new',
  'unverified',
  'verified',
  'duplicate_review',
  'accepted',
  'rejected',
  'withdrawn',
] as const;
const STATUSES = [
  'submitted',
  'acknowledged',
  'under_investigation',
  'info_requested',
  'resubmission_requested',
  'no_response',
  'closed_resolved',
  'closed_unresolved',
] as const;
const REASONS = [
  'insufficient_evidence',
  'suspect_not_identified',
  'outside_mandate',
  'jurisdiction',
  'complainant_withdrew',
  'duplicate_merged',
  'other_documented',
] as const;
const EXCHANGES = [
  'acknowledgement_received',
  'information_requested',
  'referred_to_other_unit',
  'action_in_progress',
  'closed_by_authority',
] as const;
const authorityCaseId = z.string().regex(/^[A-Za-z0-9/._ -]{1,60}$/);
const ISO = (col: string) => `to_char(${col} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

interface Ctx {
  deps: Deps;
  db: Db;
  user: string;
  role: 'owner' | 'admin';
  ipHash: string;
  now: Date;
}
export class AdminError extends Error {
  constructor(
    public readonly code: string,
    public readonly status = 400,
    public readonly extra: Record<string, unknown> = {},
  ) {
    super(code);
  }
}
const bad = (code: string, status = 400, extra: Record<string, unknown> = {}) =>
  new AdminError(code, status, extra);

interface Action {
  schema: z.ZodType;
  owner?: boolean;
  reauth?: boolean;
  run: (ctx: Ctx, input: never) => Promise<unknown>;
}
const actions: Record<string, Action> = {};
function act<S extends z.ZodType>(
  name: string,
  schema: S,
  opts: { owner?: boolean; reauth?: boolean },
  run: (ctx: Ctx, input: z.infer<S>) => Promise<unknown>,
) {
  actions[name] = { schema, owner: opts.owner, reauth: opts.reauth, run: run as Action['run'] };
}
const audit = (c: Ctx, action: string, target: string | null) =>
  c.db.query(
    "insert into public.audit_log (actor, action, target, ip_hash) values ($1::uuid, $2, $3, decode($4, 'hex'))",
    [c.user, action, target, c.ipHash],
  );
const staffCount = async (db: Db) =>
  Number((await db.query<{ n: number }>('select count(*)::int as n from public.staff'))[0]?.n ?? 0);
const one = async <T>(db: Db, sql: string, p: unknown[], missing = 'not_found'): Promise<T> => {
  const r = (await db.query<T>(sql, p))[0];
  if (!r) throw bad(missing, 404);
  return r;
};

// ------------------------------------------------------------------------------------------ ledger helpers
const LATEST = `left join lateral (select ev.authority_response_category as cat, ev.occurred_at as at from public.case_events ev
                  where ev.case_ref = c.case_ref and ev.type = 'authority_reply' and ev.authority_response_category is not null
                  order by ev.occurred_at desc, ev.id desc limit 1) e on true`;
/** Keeps a published row's status and dates in step with the private case. The approved description never changes here. */
async function syncLedger(db: Db, ref: string): Promise<void> {
  await db.query(
    `update public.public_ledger l set
        status = c.status, closure_reason = c.close_reason, resubmission_requested = c.resubmission_requested,
        authority = a.public_label, authority_case_id = c.authority_case_id,
        submitted_on = (c.forwarded_at at time zone 'Asia/Colombo')::date,
        latest_exchange = e.cat, latest_exchange_on = (e.at at time zone 'Asia/Colombo')::date
       from public.cases c join public.authorities a on a.id = c.authority_id ${LATEST}
      where l.case_id = c.case_ref and c.case_ref = $1`,
    [ref],
  );
  await db.query('select public.refresh_public_stats()');
}

async function loadCase(db: Db, ref: string) {
  return one<{
    case_ref: string;
    status: (typeof STATUSES)[number];
    forwarded_at: string | null;
    fwd: string | null;
  }>(
    db,
    `select case_ref, status, forwarded_at::text, ${ISO('forwarded_at')} as fwd from public.cases where case_ref = $1 for update`,
    [ref],
  );
}
const isClosed = (s: string) => s === 'closed_resolved' || s === 'closed_unresolved';
function checkWhen(ctx: Ctx, at: string, forwardedIso?: string | null) {
  const t = Date.parse(at);
  if (t > ctx.now.getTime() + 60_000) throw bad('date_in_future');
  if (forwardedIso && t < Date.parse(forwardedIso) - 60_000) throw bad('before_forwarded');
}
async function setStatus(
  db: Db,
  ref: string,
  status: string,
  at: string,
  reason: string | null,
  note: string,
) {
  await db.query(
    `update public.cases set status = $2::public.case_status, close_reason = $3::public.closure_reason,
            closed_at = case when $2 in ('closed_resolved', 'closed_unresolved') then $4::timestamptz else null end where case_ref = $1`,
    [ref, status, reason, at],
  );
  await db.query(
    "insert into public.case_events (case_ref, type, note, occurred_at, actor) values ($1, 'status_change', $2, $3::timestamptz, null)",
    [ref, note, at],
  );
}

// ------------------------------------------------------------------------------------------ reads
act('overview', z.object({}), {}, async ({ db, role, user }) => ({
  role,
  user,
  ...(await one<Record<string, unknown>>(
    db,
    `select (select jsonb_object_agg(state, n) from (select state, count(*)::int n from public.submissions group by state) x) as submissions,
                  (select jsonb_object_agg(status, n) from (select status, count(*)::int n from public.cases group by status) y) as cases,
                  (select to_jsonb(i) from (select mode, daily_cap, today_count, limited_by_cap from public.intake_state) i) as intake,
                  (select count(*)::int from public.staff) as staff_count,
                  (select count(*)::int from public.correction_requests where state = 'new') as corrections_new,
                  (select count(*)::int from public.archive_requests where status = 'pending') as archive_pending,
                  (select count(*)::int from public.public_ledger_drafts where approved_by is null) as drafts_waiting`,
    [],
  )),
}));

act('list_submissions', z.object({ state: z.enum(STATES).optional(), ...page }), {}, async ({ db }, i) =>
  db.query(
    `select s.id, ${ISO('s.created_at')} as created_at, s.category, s.platform, s.state, s.language, s.verified_at is not null as verified, s.case_ref,
            (select count(*)::int from public.evidence_items e where e.submission_id = s.id and not e.quarantined) as evidence,
            (select count(*)::int from public.duplicate_flags f where f.submission_id = s.id and f.resolution is null) as open_flags
       from public.submissions s where ($1::text is null or s.state::text = $1) order by s.created_at desc limit $2 offset $3`,
    [i.state ?? null, i.limit, i.offset],
  ),
);

act('get_submission', z.object({ id: uuid }), {}, async ({ db }, i) => {
  const s = await one<Record<string, unknown>>(
    db,
    `select id, ${ISO('created_at')} as created_at, category, platform, answers, description, reporter_role, language, state, case_ref, ${ISO('verified_at')} as verified_at from public.submissions where id = $1`,
    [i.id],
  );
  return {
    submission: s,
    evidence: await db.query(
      `select id, mime, size_bytes, sha256, ${ISO('uploaded_at')} as uploaded_at from public.evidence_items where submission_id = $1 and not quarantined order by uploaded_at`,
      [i.id],
    ),
    calls: await db.query(
      `select id::int as id, staff_id, outcome, note, ${ISO('occurred_at')} as occurred_at from public.verification_calls where submission_id = $1 order by occurred_at`,
      [i.id],
    ),
    flags: await db.query(
      `select f.id::int as id, f.resolution, m.id as matched_id, m.state as matched_state, m.case_ref as matched_case_ref, m.category as matched_category, ${ISO('m.created_at')} as matched_created_at
         from public.duplicate_flags f join public.submissions m on m.id = f.matched_submission_id where f.submission_id = $1 order by f.id`,
      [i.id],
    ),
  };
});

act('list_cases', z.object({ status: z.enum(STATUSES).optional(), ...page }), {}, async ({ db }, i) =>
  db.query(
    `select c.case_ref, c.category, c.status, a.public_label as authority, ${ISO('c.forwarded_at')} as forwarded_at, c.resubmission_requested,
            exists (select 1 from public.public_ledger l where l.case_id = c.case_ref) as published
       from public.cases c left join public.authorities a on a.id = c.authority_id
      where ($1::text is null or c.status::text = $1) order by c.created_at desc limit $2 offset $3`,
    [i.status ?? null, i.limit, i.offset],
  ),
);

act('get_case', z.object({ case_ref: caseRef }), {}, async ({ db }, i) => ({
  case: await one(
    db,
    `select c.case_ref, c.category, c.status, c.authority_id, a.public_label as authority, c.authority_case_id, c.close_reason, c.resubmission_requested, ${ISO('c.forwarded_at')} as forwarded_at, ${ISO('c.closed_at')} as closed_at, ${ISO('c.created_at')} as created_at from public.cases c left join public.authorities a on a.id = c.authority_id where c.case_ref = $1`,
    [i.case_ref],
  ),
  events: await db.query(
    `select id::int as id, type, authority_response_category, note, ${ISO('occurred_at')} as occurred_at from public.case_events where case_ref = $1 order by occurred_at, id`,
    [i.case_ref],
  ),
  submissions: await db.query(`select submission_id from public.case_submissions where case_ref = $1`, [
    i.case_ref,
  ]),
  ledger:
    (
      await db.query(
        `select description, status, ${ISO('updated_at')} as updated_at from public.public_ledger where case_id = $1`,
        [i.case_ref],
      )
    )[0] ?? null,
  draft:
    (
      await db.query(
        `select description, requested_by, approved_by from public.public_ledger_drafts where case_ref = $1`,
        [i.case_ref],
      )
    )[0] ?? null,
}));

act('list_authorities', z.object({}), {}, async ({ db }) =>
  db.query('select id, public_label, name, active from public.authorities order by id', []),
);

act('list_followups', z.object({}), {}, async ({ db }) => {
  const days = JSON.parse(
    (
      await db.query<{ v: string }>(
        "select value::text as v from public.app_settings where key = 'follow_up_days'",
      )
    )[0]?.v ?? '[14,30,60]',
  ) as number[];
  const rows = await db.query<{
    case_ref: string;
    status: string;
    authority: string;
    authority_case_id: string | null;
    forwarded_on: string;
    days_since: number;
  }>(
    `with last as (
       select c.case_ref, c.status, a.public_label as authority, c.authority_case_id, c.forwarded_at,
              greatest(c.forwarded_at, coalesce((select max(e.occurred_at) from public.case_events e where e.case_ref = c.case_ref and e.type in ('authority_reply', 'follow_up')), c.forwarded_at)) as last_contact
         from public.cases c left join public.authorities a on a.id = c.authority_id
        where c.forwarded_at is not null and c.status not in ('closed_resolved', 'closed_unresolved'))
     select case_ref, status, authority, authority_case_id, to_char(forwarded_at at time zone 'Asia/Colombo', 'YYYY-MM-DD') as forwarded_on,
            floor(extract(epoch from (now() - last_contact)) / 86400)::int as days_since from last order by days_since desc`,
    [],
  );
  return rows
    .map((r) => ({ ...r, level: days.filter((d) => r.days_since >= d).length }))
    .filter((r) => r.level > 0)
    .map((r) => ({
      ...r,
      // No personal data: only the case ID, the authority's own reference and dates.
      email_draft: `Subject: Follow-up on case ${r.authority_case_id ?? r.case_ref}\n\nDear colleagues,\n\nWe referred case ${r.case_ref}${r.authority_case_id ? ` (your reference ${r.authority_case_id})` : ''} to ${r.authority} on ${r.forwarded_on}. We have not had an update for ${r.days_since} days. Could you please tell us its current status?\n\nThank you,\n[VERIFY: sender name, role and contact details]`,
    }));
});

act('list_corrections', z.object({ ...page }), {}, async ({ db }, i) =>
  db.query(
    `select id::int as id, case_id, request_type, details, contact, state, ${ISO('created_at')} as created_at from public.correction_requests order by (state = 'new') desc, created_at desc limit $1 offset $2`,
    [i.limit, i.offset],
  ),
);
act('list_archive', z.object({}), {}, async ({ db }) =>
  db.query(
    `select id::int as id, url, status, requested_by, approved_by, snapshot_url, failure_reason, ${ISO('created_at')} as created_at from public.archive_requests order by created_at desc limit 100`,
    [],
  ),
);
act(
  'list_audit',
  z.object({ before_id: z.number().int().optional(), limit: z.number().int().min(1).max(200).default(100) }),
  { owner: true },
  async ({ db }, i) =>
    db.query(
      `select id::int as id, actor, action, target, ${ISO('occurred_at')} as occurred_at from public.audit_log where ($1::bigint is null or id < $1) order by id desc limit $2`,
      [i.before_id ?? null, i.limit],
    ),
);
act('list_staff', z.object({}), { owner: true }, async ({ db }) =>
  db.query(
    `select s.user_id, s.role, u.email, ${ISO('s.created_at')} as created_at from public.staff s left join auth.users u on u.id = s.user_id order by s.created_at`,
    [],
  ),
);
act('get_settings', z.object({}), { owner: true }, async ({ db }) =>
  db.query('select key, value from public.app_settings order by key', []),
);

// ------------------------------------------------------------------------------------------ triage and verification
act('reveal_contact', z.object({ submission_id: uuid }), {}, async (c, i) => {
  const r = await one<{ enc: string; consent: boolean }>(
    c.db,
    `select encode(rc.phone_enc, 'hex') as enc, s.contact_consent as consent from public.reporter_contacts rc join public.submissions s on s.id = rc.submission_id where rc.submission_id = $1`,
    [i.submission_id],
  );
  await audit(c, 'reveal_contact', i.submission_id);
  return { phone: await decryptText(c.deps.env.phoneKey, fromHex(r.enc)) };
});

act(
  'log_call',
  z.object({
    submission_id: uuid,
    outcome: z.enum(['reached_verified', 'no_answer', 'wrong_number', 'declined']),
    note: z.string().max(500).optional(),
  }),
  {},
  async (c, i) => {
    const s = await one<{ state: string }>(
      c.db,
      'select state from public.submissions where id = $1 for update',
      [i.submission_id],
    );
    if (['accepted', 'rejected', 'withdrawn'].includes(s.state)) throw bad('conflict', 409);
    await c.db.query(
      'insert into public.verification_calls (submission_id, staff_id, outcome, note) values ($1, $2, $3, $4)',
      [i.submission_id, c.user, i.outcome, i.note ?? null],
    );
    if (i.outcome === 'reached_verified') {
      await c.db.query(
        "update public.submissions set verified_at = now(), state = case when state = 'duplicate_review' then state else 'verified' end where id = $1",
        [i.submission_id],
      );
    } else if (s.state === 'new') {
      await c.db.query("update public.submissions set state = 'unverified' where id = $1", [i.submission_id]);
    }
    await audit(c, 'log_call', i.submission_id);
    return { ok: true };
  },
);

act('accept_submission', z.object({ id: uuid }), {}, async (c, i) => {
  const s = await one<{ state: string; category: string; verified: boolean }>(
    c.db,
    'select state, category, verified_at is not null as verified from public.submissions where id = $1 for update',
    [i.id],
  );
  if (s.state !== 'verified' || !s.verified) throw bad('not_verified', 409);
  const ref = (await c.db.query<{ r: string }>('select public.allocate_case_ref() as r'))[0]?.r as string;
  await c.db.query('insert into public.cases (case_ref, category) values ($1, $2::public.case_category)', [
    ref,
    s.category,
  ]);
  await c.db.query('insert into public.case_submissions (case_ref, submission_id) values ($1, $2)', [
    ref,
    i.id,
  ]);
  await c.db.query("update public.submissions set state = 'accepted', case_ref = $1 where id = $2", [
    ref,
    i.id,
  ]);
  await audit(c, 'accept_submission', ref);
  return { case_ref: ref };
});

act('reject_submission', z.object({ id: uuid }), {}, async (c, i) => {
  const s = await one<{ state: string }>(
    c.db,
    'select state from public.submissions where id = $1 for update',
    [i.id],
  );
  if (['accepted', 'withdrawn'].includes(s.state)) throw bad('conflict', 409);
  await c.db.query("update public.submissions set state = 'rejected' where id = $1", [i.id]);
  await audit(c, 'reject_submission', i.id);
  return { ok: true };
});

act(
  'resolve_duplicate',
  z.object({ flag_id: z.number().int(), resolution: z.enum(['merged', 'separate']) }),
  {},
  async (c, i) => {
    const f = await one<{
      submission_id: string;
      matched: string;
      resolution: string | null;
      matched_case: string | null;
    }>(
      c.db,
      `select f.submission_id, f.matched_submission_id as matched, f.resolution, m.case_ref as matched_case from public.duplicate_flags f join public.submissions m on m.id = f.matched_submission_id where f.id = $1 for update of f`,
      [i.flag_id],
    );
    if (f.resolution) throw bad('conflict', 409);
    if (i.resolution === 'merged') {
      if (!f.matched_case) throw bad('accept_matched_first', 409);
      await c.db.query(
        'insert into public.case_submissions (case_ref, submission_id) values ($1, $2) on conflict do nothing',
        [f.matched_case, f.submission_id],
      );
      await c.db.query("update public.submissions set state = 'accepted', case_ref = $1 where id = $2", [
        f.matched_case,
        f.submission_id,
      ]);
      await c.db.query(
        "insert into public.case_events (case_ref, type, note, occurred_at, actor) values ($1, 'merge', 'A duplicate report was merged into this case.', now(), $2)",
        [f.matched_case, c.user],
      );
    }
    await c.db.query('update public.duplicate_flags set resolution = $2 where id = $1', [
      i.flag_id,
      i.resolution,
    ]);
    if (i.resolution === 'separate') {
      await c.db.query(
        `update public.submissions set state = case when verified_at is not null then 'verified'::public.submission_state else 'new'::public.submission_state end
        where id = $1 and state = 'duplicate_review' and not exists (select 1 from public.duplicate_flags where submission_id = $1 and resolution is null)`,
        [f.submission_id],
      );
    }
    await audit(c, 'resolve_duplicate:' + i.resolution, String(i.flag_id));
    return { ok: true };
  },
);

act(
  'block_reporter',
  z.object({ submission_id: uuid, reason: z.string().max(200).optional() }),
  {},
  async (c, i) => {
    const r = await c.db.query(
      "insert into public.block_list (kind, value_hmac, reason, created_by) select 'phone', phone_hmac, $2, $3::uuid from public.reporter_contacts where submission_id = $1 and phone_hmac is not null on conflict do nothing returning id",
      [i.submission_id, i.reason ?? null, c.user],
    );
    await audit(c, 'block_reporter', i.submission_id);
    return { blocked: r.length > 0 };
  },
);

// ------------------------------------------------------------------------------------------ evidence
act('evidence_view', z.object({ evidence_id: uuid }), {}, async (c, i) => {
  const e = await one<{ derived_path: string | null; storage_path: string }>(
    c.db,
    'select derived_path, storage_path from public.evidence_items where id = $1 and not quarantined',
    [i.evidence_id],
  );
  await audit(c, 'evidence_view', i.evidence_id); // viewing is logged BEFORE the link exists
  return {
    url: await c.deps.storage.createSignedUrl('evidence-preview', e.derived_path ?? e.storage_path, 60),
  };
});

act('quarantine_evidence', z.object({ evidence_id: uuid }), {}, async (c, i) => {
  const e = await one<{ submission_id: string }>(
    c.db,
    'select submission_id from public.evidence_items where id = $1 and not quarantined for update',
    [i.evidence_id],
  );
  await c.db.query(
    'update public.evidence_items set quarantined = true, quarantined_at = now() where id = $1',
    [i.evidence_id],
  );
  await c.db.query(
    "insert into public.incidents (kind, evidence_id, submission_id, reported_by) values ('child_safety_concern', $1, $2, $3)",
    [i.evidence_id, e.submission_id, c.user],
  );
  await audit(c, 'quarantine_evidence', i.evidence_id);
  return {
    quarantined: true,
    next: 'Do not open this item again. Follow docs/RUNBOOK.md and contact the owner now.',
  };
});

// ------------------------------------------------------------------------------------------ cases and authority tracking
act(
  'forward_case',
  z.object({
    case_ref: caseRef,
    authority_id: z.number().int(),
    authority_case_id: authorityCaseId.optional(),
    occurred_at: when,
  }),
  {},
  async (c, i) => {
    const k = await loadCase(c.db, i.case_ref);
    if (k.forwarded_at) throw bad('already_forwarded', 409);
    checkWhen(c, i.occurred_at);
    const a = await one<{ public_label: string }>(
      c.db,
      'select public_label from public.authorities where id = $1 and active',
      [i.authority_id],
    );
    await c.db.query(
      "update public.cases set authority_id = $2, authority_case_id = $3, forwarded_at = $4::timestamptz, status = 'submitted' where case_ref = $1",
      [i.case_ref, i.authority_id, i.authority_case_id ?? null, i.occurred_at],
    );
    await c.db.query(
      "insert into public.case_events (case_ref, type, note, occurred_at, actor) values ($1, 'forwarded', $2, $3::timestamptz, $4)",
      [i.case_ref, `Sent to ${a.public_label}.`, i.occurred_at, c.user],
    );
    await audit(c, 'forward_case', i.case_ref);
    await c.db.query('select public.refresh_public_stats()');
    return { ok: true };
  },
);

const STATUS_FOR_REPLY: Record<string, (typeof STATUSES)[number] | null> = {
  acknowledgement_received: 'acknowledged',
  information_requested: 'info_requested',
  action_in_progress: 'under_investigation',
  referred_to_other_unit: null,
};
act(
  'record_reply',
  z.object({
    case_ref: caseRef,
    response: z.enum(EXCHANGES),
    occurred_at: when,
    note: z.string().max(500).optional(),
    outcome: z.enum(['resolved', 'unresolved']).optional(),
    closure_reason: z.enum(REASONS).optional(),
    authority_case_id: authorityCaseId.optional(),
  }),
  {},
  async (c, i) => {
    const k = await loadCase(c.db, i.case_ref);
    if (!k.forwarded_at) throw bad('not_forwarded', 409);
    if (isClosed(k.status)) throw bad('already_closed', 409);
    checkWhen(c, i.occurred_at, k.fwd);
    await c.db.query(
      "insert into public.case_events (case_ref, type, authority_response_category, note, occurred_at, actor) values ($1, 'authority_reply', $2::public.exchange_category, $3, $4::timestamptz, $5)",
      [i.case_ref, i.response, i.note ?? null, i.occurred_at, c.user],
    );
    if (i.authority_case_id)
      await c.db.query('update public.cases set authority_case_id = $2 where case_ref = $1', [
        i.case_ref,
        i.authority_case_id,
      ]);
    if (i.response === 'closed_by_authority') {
      if (!i.outcome) throw bad('outcome_required');
      if (i.outcome === 'unresolved' && !i.closure_reason) throw bad('reason_required');
      await setStatus(
        c.db,
        i.case_ref,
        i.outcome === 'resolved' ? 'closed_resolved' : 'closed_unresolved',
        i.occurred_at,
        i.outcome === 'unresolved' ? (i.closure_reason as string) : null,
        `Closed by the authority: ${i.outcome}.`,
      );
    } else {
      const next = STATUS_FOR_REPLY[i.response];
      if (next && next !== k.status)
        await setStatus(
          c.db,
          i.case_ref,
          next,
          i.occurred_at,
          null,
          `Status changed to ${next.replaceAll('_', ' ')}.`,
        );
    }
    await audit(c, 'record_reply', i.case_ref);
    await syncLedger(c.db, i.case_ref);
    return { ok: true };
  },
);

act(
  'close_case',
  z.object({
    case_ref: caseRef,
    outcome: z.enum(['resolved', 'unresolved']),
    closure_reason: z.enum(REASONS).optional(),
    occurred_at: when,
  }),
  {},
  async (c, i) => {
    const k = await loadCase(c.db, i.case_ref);
    if (isClosed(k.status)) throw bad('already_closed', 409);
    checkWhen(c, i.occurred_at, k.fwd);
    if (i.outcome === 'unresolved' && !i.closure_reason) throw bad('reason_required');
    await setStatus(
      c.db,
      i.case_ref,
      i.outcome === 'resolved' ? 'closed_resolved' : 'closed_unresolved',
      i.occurred_at,
      i.outcome === 'unresolved' ? (i.closure_reason as string) : null,
      `Closed by our team: ${i.outcome}.`,
    );
    await audit(c, 'close_case', i.case_ref);
    await syncLedger(c.db, i.case_ref);
    return { ok: true };
  },
);

act(
  'log_follow_up',
  z.object({ case_ref: caseRef, note: z.string().max(500).optional() }),
  {},
  async (c, i) => {
    const k = await loadCase(c.db, i.case_ref);
    if (!k.forwarded_at || isClosed(k.status)) throw bad('conflict', 409);
    await c.db.query(
      "insert into public.case_events (case_ref, type, note, occurred_at, actor) values ($1, 'follow_up', $2, now(), $3)",
      [i.case_ref, i.note ?? 'Follow-up sent to the authority.', c.user],
    );
    await audit(c, 'log_follow_up', i.case_ref);
    return { ok: true };
  },
);

act('set_resubmission', z.object({ case_ref: caseRef, requested: z.boolean() }), {}, async (c, i) => {
  const k = await loadCase(c.db, i.case_ref);
  if (!k.forwarded_at || isClosed(k.status)) throw bad('conflict', 409);
  await c.db.query('update public.cases set resubmission_requested = $2 where case_ref = $1', [
    i.case_ref,
    i.requested,
  ]);
  await c.db.query(
    `insert into public.case_events (case_ref, type, note, occurred_at, actor) values ($1, 'resubmission', $2, now(), $3)`,
    [
      i.case_ref,
      i.requested ? 'The authority asked for the case to be resubmitted.' : 'The case was resubmitted.',
      c.user,
    ],
  );
  await setStatus(
    c.db,
    i.case_ref,
    i.requested ? 'resubmission_requested' : 'submitted',
    c.now.toISOString(),
    null,
    i.requested ? 'Status changed to resubmission requested.' : 'Status changed to submitted.',
  );
  await audit(c, 'set_resubmission', i.case_ref);
  await syncLedger(c.db, i.case_ref);
  return { ok: true };
});

act('add_note', z.object({ case_ref: caseRef, note: z.string().min(1).max(2000) }), {}, async (c, i) => {
  await loadCase(c.db, i.case_ref);
  await c.db.query(
    "insert into public.case_events (case_ref, type, note, occurred_at, actor) values ($1, 'note', $2, now(), $3)",
    [i.case_ref, i.note, c.user],
  );
  await audit(c, 'add_note', i.case_ref);
  return { ok: true };
});

// ------------------------------------------------------------------------------------------ publishing (manual 6.7)
act('draft_ledger', z.object({ case_ref: caseRef, description: z.string().trim() }), {}, async (c, i) => {
  const k = await loadCase(c.db, i.case_ref);
  if (!k.forwarded_at) throw bad('not_forwarded', 409);
  const problems = lintPublicText(i.description);
  if (problems.length) throw bad('lint_failed', 400, { problems });
  await c.db.query(
    `insert into public.public_ledger_drafts (case_ref, description, requested_by) values ($1, $2, $3)
     on conflict (case_ref) do update set description = excluded.description, requested_by = excluded.requested_by, approved_by = null, approved_at = null`,
    [i.case_ref, i.description, c.user],
  );
  await audit(c, 'draft_ledger', i.case_ref);
  return { ok: true };
});

act('approve_ledger', z.object({ case_ref: caseRef }), {}, async (c, i) => {
  const d = await one<{ requested_by: string }>(
    c.db,
    'select requested_by from public.public_ledger_drafts where case_ref = $1 for update',
    [i.case_ref],
  );
  if ((await staffCount(c.db)) >= 2 && d.requested_by === c.user) throw bad('second_approver_required', 403);
  await c.db.query(
    'update public.public_ledger_drafts set approved_by = $2, approved_at = now() where case_ref = $1',
    [i.case_ref, c.user],
  );
  await audit(c, 'approve_ledger', i.case_ref);
  return { ok: true };
});

act('publish_ledger', z.object({ case_ref: caseRef }), {}, async (c, i) => {
  const d = await one<{ requested_by: string; approved_by: string | null }>(
    c.db,
    'select requested_by, approved_by from public.public_ledger_drafts where case_ref = $1',
    [i.case_ref],
    'no_draft',
  );
  const two = (await staffCount(c.db)) >= 2;
  if (two && (!d.approved_by || d.approved_by === d.requested_by)) throw bad('approval_required', 403);
  const r = await c.db.query(
    `insert into public.public_ledger (case_id, created_on, category, description, authority, submitted_on, authority_case_id, latest_exchange, latest_exchange_on, status, closure_reason, resubmission_requested)
     select c.case_ref, (c.created_at at time zone 'Asia/Colombo')::date, c.category, d.description, a.public_label,
            (c.forwarded_at at time zone 'Asia/Colombo')::date, c.authority_case_id, e.cat, (e.at at time zone 'Asia/Colombo')::date, c.status, c.close_reason, c.resubmission_requested
       from public.cases c join public.authorities a on a.id = c.authority_id join public.public_ledger_drafts d on d.case_ref = c.case_ref ${LATEST}
      where c.case_ref = $1 and c.forwarded_at is not null
     on conflict (case_id) do update set description = excluded.description, authority = excluded.authority, authority_case_id = excluded.authority_case_id,
            submitted_on = excluded.submitted_on, latest_exchange = excluded.latest_exchange, latest_exchange_on = excluded.latest_exchange_on,
            status = excluded.status, closure_reason = excluded.closure_reason, resubmission_requested = excluded.resubmission_requested
     returning case_id`,
    [i.case_ref],
  );
  if (r.length === 0) throw bad('not_forwarded', 409);
  await audit(c, 'publish_ledger', i.case_ref);
  await c.db.query('select public.refresh_public_stats()');
  return { published: true };
});

act('unpublish_ledger', z.object({ case_id: caseRef }), {}, async (c, i) => {
  await c.db.query('delete from public.public_ledger where case_id = $1', [i.case_id]);
  await c.db.query('delete from public.public_ledger_drafts where case_ref = $1', [i.case_id]);
  await audit(c, 'unpublish_ledger', i.case_id);
  await c.db.query('select public.refresh_public_stats()');
  return { ok: true };
});

act('handle_correction', z.object({ id: z.number().int() }), {}, async (c, i) => {
  await one(
    c.db,
    "update public.correction_requests set state = 'handled' where id = $1 returning id::int as id",
    [i.id],
  );
  await audit(c, 'handle_correction', String(i.id));
  return { ok: true };
});

// ------------------------------------------------------------------------------------------ intake, counters, Wayback queue
act(
  'set_intake',
  z.object({ mode: z.enum(['open', 'limited', 'closed']), daily_cap: z.number().int().min(0).max(1000) }),
  {},
  async (c, i) => {
    await c.db.query(
      'update public.intake_state set mode = $1::public.intake_mode, daily_cap = $2, limited_by_cap = false where id = 1',
      [i.mode, i.daily_cap],
    );
    await audit(c, `set_intake:${i.mode}:${i.daily_cap}`, null);
    return { ok: true };
  },
);
act('adjust_minors', z.object({ delta: z.number().int().min(-10).max(10) }), {}, async (c, i) => {
  await c.db.query(
    "update public.aggregate_counters set value = greatest(0, value + $1) where name = 'minors_referred'",
    [i.delta],
  );
  await audit(c, `adjust_minors:${i.delta}`, null);
  await c.db.query('select public.refresh_public_stats()');
  return { ok: true };
});
act('refresh_stats', z.object({}), {}, async (c) => {
  await c.db.query('select public.refresh_public_stats()');
  await audit(c, 'refresh_stats', null);
  return { ok: true };
});

const BLOCKED_URL = /(\/members\b|[?&]sk=members|\/friends\b|\/followers\b|\/photos?\b|\/videos?\b|\/reel)/i;
act('archive_add', z.object({ url: z.string().url().max(2000) }), {}, async (c, i) => {
  if (!i.url.startsWith('https://')) throw bad('https_only');
  if (BLOCKED_URL.test(i.url))
    throw bad('blocked_page_type', 400, {
      hint: 'Member lists, friends, photos and videos are never archived (manual 6.10).',
    });
  const r = await c.db.query<{ id: number }>(
    'insert into public.archive_requests (url, requested_by) values ($1, $2) returning id::int as id',
    [i.url, c.user],
  );
  await audit(c, 'archive_add', String(r[0]?.id));
  return { id: r[0]?.id };
});
act('archive_decide', z.object({ id: z.number().int(), approve: z.boolean() }), {}, async (c, i) => {
  const a = await one<{ requested_by: string; status: string }>(
    c.db,
    'select requested_by, status from public.archive_requests where id = $1 for update',
    [i.id],
  );
  if (a.status !== 'pending') throw bad('conflict', 409);
  if (i.approve && (await staffCount(c.db)) >= 2 && a.requested_by === c.user)
    throw bad('second_approver_required', 403);
  await c.db.query(
    'update public.archive_requests set status = $2::public.archive_status, approved_by = $3, approved_at = now() where id = $1',
    [i.id, i.approve ? 'approved' : 'rejected', c.user],
  );
  await audit(c, i.approve ? 'archive_approve' : 'archive_reject', String(i.id));
  return { ok: true };
});
act(
  'archive_record',
  z.object({
    id: z.number().int(),
    snapshot_url: z.string().url().max(2000).optional(),
    failure_reason: z.string().max(500).optional(),
  }),
  {},
  async (c, i) => {
    const a = await one<{ status: string }>(
      c.db,
      'select status from public.archive_requests where id = $1 for update',
      [i.id],
    );
    if (a.status !== 'approved') throw bad('conflict', 409);
    if (!i.snapshot_url && !i.failure_reason) throw bad('invalid');
    await c.db.query(
      'update public.archive_requests set status = $2::public.archive_status, snapshot_url = $3, failure_reason = $4 where id = $1',
      [i.id, i.snapshot_url ? 'captured' : 'failed', i.snapshot_url ?? null, i.failure_reason ?? null],
    );
    await audit(c, 'archive_record', String(i.id));
    return { ok: true };
  },
);

// ------------------------------------------------------------------------------------------ owner-only
act(
  'invite_staff',
  z.object({ email: z.string().email().max(200), role: z.enum(['owner', 'admin']) }),
  { owner: true, reauth: true },
  async (c, i) => {
    const id = await c.deps.auth.inviteUser(i.email);
    await c.db.query(
      'insert into public.staff (user_id, role, invited_by) values ($1, $2::public.staff_role, $3) on conflict (user_id) do update set role = excluded.role',
      [id, i.role, c.user],
    );
    await audit(c, `invite_staff:${i.role}`, id);
    return { user_id: id };
  },
);
act('remove_staff', z.object({ user_id: uuid }), { owner: true, reauth: true }, async (c, i) => {
  if (i.user_id === c.user) throw bad('cannot_remove_self', 409);
  const t = await one<{ role: string }>(c.db, 'select role from public.staff where user_id = $1 for update', [
    i.user_id,
  ]);
  if (
    t.role === 'owner' &&
    Number(
      (await c.db.query<{ n: number }>("select count(*)::int as n from public.staff where role = 'owner'"))[0]
        ?.n,
    ) < 2
  )
    throw bad('last_owner', 409);
  await c.db.query('delete from public.staff where user_id = $1', [i.user_id]);
  await audit(c, 'remove_staff', i.user_id);
  return { ok: true };
});
const NUMERIC_SETTINGS = [
  'retention_withdrawn_days',
  'no_response_days',
  'upload_ttl_minutes',
  'rate_ip_submit_per_hour',
  'rate_phone_submit_per_day',
  'rate_ip_other_per_hour',
  'rate_code_per_day',
] as const;
act(
  'set_setting',
  z.object({
    key: z.enum([...NUMERIC_SETTINGS, 'follow_up_days']),
    value: z.union([
      z.number().int().min(0).max(100000),
      z.array(z.number().int().min(1).max(3650)).min(1).max(6),
    ]),
  }),
  { owner: true, reauth: true },
  async (c, i) => {
    if ((i.key === 'follow_up_days') !== Array.isArray(i.value)) throw bad('invalid');
    // ::text::jsonb keeps the parameter a plain string in both database drivers (a bare string sent as jsonb is double-encoded).
    await c.db.query(
      'update public.app_settings set value = $2::text::jsonb, updated_at = now() where key = $1',
      [i.key, JSON.stringify(i.value)],
    );
    await audit(c, `set_setting:${i.key}`, null);
    return { ok: true };
  },
);
act('export_case', z.object({ case_ref: caseRef }), { reauth: true }, async (c, i) => {
  const k = await one<Record<string, unknown>>(
    c.db,
    `select case_ref, category, status, authority_case_id, ${ISO('forwarded_at')} as forwarded_at, ${ISO('created_at')} as created_at from public.cases where case_ref = $1`,
    [i.case_ref],
  );
  const subs = await c.db.query<{
    id: string;
    category: string;
    platform: string;
    answers: unknown;
    description: string;
    language: string;
    contact_consent: boolean;
    enc: string | null;
    created_at: string;
  }>(
    `select s.id, s.category, s.platform, s.answers, s.description, s.language, s.contact_consent, encode(rc.phone_enc, 'hex') as enc, ${ISO('s.created_at')} as created_at
       from public.case_submissions cs join public.submissions s on s.id = cs.submission_id left join public.reporter_contacts rc on rc.submission_id = s.id where cs.case_ref = $1 order by s.created_at`,
    [i.case_ref],
  );
  const evidence = await c.db.query<{
    id: string;
    submission_id: string;
    storage_path: string;
    mime: string;
    size_bytes: number;
    sha256: string;
    uploaded_at: string;
  }>(
    `select e.id, e.submission_id, e.storage_path, e.mime, e.size_bytes, e.sha256, ${ISO('e.uploaded_at')} as uploaded_at from public.evidence_items e join public.case_submissions cs on cs.submission_id = e.submission_id where cs.case_ref = $1 and not e.quarantined order by e.uploaded_at`,
    [i.case_ref],
  );
  const events = await c.db.query(
    `select type, authority_response_category, note, ${ISO('occurred_at')} as occurred_at from public.case_events where case_ref = $1 order by occurred_at, id`,
    [i.case_ref],
  );
  await audit(c, 'export_case', i.case_ref); // logged before any link is created
  const reporters = [];
  for (const s of subs) {
    reporters.push({
      submission_id: s.id,
      created_at: s.created_at,
      category: s.category,
      platform: s.platform,
      language: s.language,
      answers: s.answers,
      description: s.description,
      phone: s.contact_consent && s.enc ? await decryptText(c.deps.env.phoneKey, fromHex(s.enc)) : null,
    });
  }
  const files = [];
  for (const e of evidence)
    files.push({
      ...e,
      original_url_valid_15_minutes: await c.deps.storage.createSignedUrl(
        'evidence-original',
        e.storage_path,
        900,
      ),
    });
  return { generated_at: c.now.toISOString(), case: k, events, reporters, evidence: files };
});

// ------------------------------------------------------------------------------------------ the door
function claimsOf(jwt: string): Record<string, unknown> | null {
  const part = jwt.split('.')[1];
  if (!part) return null;
  try {
    return JSON.parse(
      atob(
        part
          .replace(/-/g, '+')
          .replace(/_/g, '/')
          .padEnd(Math.ceil(part.length / 4) * 4, '='),
      ),
    );
  } catch {
    return null;
  }
}
/** A second-factor or password sign-in within the last N seconds (the `amr` claim lists them with timestamps). */
function recentSignIn(claims: Record<string, unknown>, now: Date, seconds: number): boolean {
  const amr = Array.isArray(claims.amr) ? (claims.amr as { timestamp?: number }[]) : [];
  const latest = Math.max(0, ...amr.map((a) => Number(a.timestamp ?? 0)));
  return latest > 0 && now.getTime() / 1000 - latest <= seconds;
}
const send = (req: Request, deps: Deps, status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(req, deps) },
  });

export const ADMIN_ACTIONS = Object.keys(actions);

export async function handleAdmin(req: Request, deps: Deps): Promise<Response> {
  const early = gate(req, deps);
  if (early) return early;
  try {
    const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
    const claims = jwt ? claimsOf(jwt) : null;
    if (!claims || typeof claims.sub !== 'string')
      return send(req, deps, 401, { ok: false, error: 'unauthorized' });
    if ((await deps.auth.verifyJwt(jwt)) !== claims.sub)
      return send(req, deps, 401, { ok: false, error: 'unauthorized' });
    if (claims.aal !== 'aal2') return send(req, deps, 403, { ok: false, error: 'mfa_required' });
    if (typeof claims.exp === 'number' && claims.exp * 1000 < deps.now().getTime())
      return send(req, deps, 401, { ok: false, error: 'unauthorized' });

    const staff = (
      await deps.db.query<{ role: 'owner' | 'admin' }>(
        'select role from public.staff where user_id = $1::uuid',
        [claims.sub],
      )
    )[0];
    if (!staff) return send(req, deps, 403, { ok: false, error: 'forbidden' });

    const body = (await readJson(req)) as { action?: string } | undefined;
    const action = body && typeof body.action === 'string' ? actions[body.action] : undefined;
    if (!body || !action) return send(req, deps, 400, { ok: false, error: 'invalid' });
    const rest: Record<string, unknown> = { ...(body as Record<string, unknown>) };
    delete rest.action;
    const input = action.schema.safeParse(rest);
    if (!input.success) return send(req, deps, 400, { ok: false, error: 'invalid' });
    if (action.owner && staff.role !== 'owner')
      return send(req, deps, 403, { ok: false, error: 'forbidden' });
    const now = deps.now();
    if (action.reauth && !recentSignIn(claims, now, 600))
      return send(req, deps, 403, { ok: false, error: 'reauth_required' });

    const ipHash = await hmacHex(
      deps.env.pepper,
      'ip:' +
        (req.headers.get('cf-connecting-ip') ??
          req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
          'unknown'),
    );
    const data = await deps.db.tx((tx) =>
      action.run(
        { deps, db: tx, user: claims.sub as string, role: staff.role, ipHash, now },
        input.data as never,
      ),
    );
    return send(req, deps, 200, { ok: true, data });
  } catch (e) {
    if (e instanceof AdminError) return send(req, deps, e.status, { ok: false, error: e.code, ...e.extra });
    logError('admin', e);
    return send(req, deps, 500, { ok: false, error: 'server' });
  }
}
