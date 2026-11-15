// Optional check, run under Deno: proves the PRODUCTION database driver (postgres.js, the one Edge Functions use) behaves
// exactly like the driver the Node tests use. It runs the real handlers against a real schema.
//   deno run --allow-net --allow-env --config supabase/functions/submit-report/deno.json supabase/tests/deno-driver-check.ts <database-url>
import postgres from 'postgres';
import { postgresDb } from '../functions/_shared/runtime.ts';
import type { Deps, Storage } from '../functions/_shared/deps.ts';
import { handleSubmitReport } from '../functions/_shared/handlers/submit-report.ts';
import { handleAddEvidence, handleFinalizeEvidence } from '../functions/_shared/handlers/evidence.ts';
import { handleCorrection, handleWithdraw } from '../functions/_shared/handlers/withdraw-and-corrections.ts';
import { handleMaintenance } from '../functions/_shared/handlers/maintenance.ts';
import { handleAdmin } from '../functions/_shared/handlers/admin.ts';

const url = Deno.args[0];
if (!url) throw new Error('database url required');
const sql = postgres(url, { prepare: false, max: 2 });
const files = new Map<string, Uint8Array>();
const storage: Storage = {
  async createSignedUploadUrl(_b, path) {
    return { token: 't-' + path, path };
  },
  async download(b, p) {
    return files.get(`${b}/${p}`) ?? null;
  },
  async upload(b, p, d) {
    files.set(`${b}/${p}`, d);
  },
  async remove(b, ps) {
    for (const p of ps) files.delete(`${b}/${p}`);
  },
  async createSignedUrl(b, p) {
    return `https://s.test/${b}/${p}`;
  },
};
// In this check only, show the database's own error text (handlers deliberately log just the error class).
const real = postgresDb(sql, false);
const loud = (db: typeof real): typeof real => ({
  async query(text, params) {
    try {
      return await db.query(text, params);
    } catch (e) {
      console.error('SQL FAILED:', text.trim().split('\n')[0], '->', (e as Error).message);
      throw e;
    }
  },
  tx: (fn) => db.tx((inner) => fn(loud(inner))),
});
const deps: Deps = {
  db: loud(real),
  storage,
  auth: { verifyJwt: async () => null, inviteUser: async () => '' },
  env: {
    pepper: new Uint8Array(32).fill(7),
    phoneKey: new Uint8Array(32).fill(9),
    turnstileSecret: 's',
    allowedOrigins: ['https://site.test'],
    cronSecret: 'cron',
  },
  fetch: (async (_u: unknown, init?: RequestInit) =>
    new Response(
      JSON.stringify({ success: new URLSearchParams(String(init?.body)).get('response') === 'ok' }),
    )) as typeof fetch,
  now: () => new Date(),
  random: (n) => crypto.getRandomValues(new Uint8Array(n)),
};
const post = (body: unknown, ip: string) =>
  new Request('http://f.test/x', {
    method: 'POST',
    headers: { origin: 'https://site.test', 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: JSON.stringify(body),
  });
const must = (cond: unknown, what: string) => {
  if (!cond) throw new Error('FAILED: ' + what);
  console.log('ok  ', what);
};

await sql`update public.intake_state set mode = 'open', daily_cap = 50, today_count = 0 where id = 1`;
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0, 0, 0, 0,
]);
const report = {
  language: 'en',
  contact_language: 'en',
  minor: false,
  reporter_role: 'self',
  behalf_consent: false,
  category: 'ncii',
  platform: 'Facebook',
  description: 'FAKE private description of what happened, long enough to pass validation.',
  links: ['https://www.facebook.com/groups/Driver-Check'],
  usernames: ['@driver.check'],
  date_from: '2026-10-01',
  date_to: '2026-10-05',
  reported_to_platform: false,
  platform_reference: '',
  reported_to_police: false,
  police_reference: '',
  evidence_summary: '',
  external_media_links: [],
  phone: '+94 77 123 4567',
  contact_consent: true,
  files: [{ mime: 'image/png', size: 20 }],
  turnstile_token: 'ok',
  website: '',
};

const r1 = await handleSubmitReport(post(report, '198.51.100.1'), deps);
const b1 = await r1.json();
must(
  r1.status === 200 && b1.ok && b1.uploads.length === 1,
  'submit-report stores a report with the production driver',
);
const [row] =
  await sql`select state, answers->'links' as links, (select count(*)::int from public.identifiers) as ids, (select count(*)::int from public.evidence_uploads) as ups from public.submissions order by created_at desc limit 1`;
must(
  row.state === 'new' && row.ids >= 2 && row.ups === 1 && row.links[0].includes('facebook'),
  'jsonb, hex and recordset parameters round-trip',
);

const r2 = await handleSubmitReport(
  post(
    { ...report, phone: '+94 77 123 4568', links: ['https://m.facebook.com/groups/driver-check/?ref=x'] },
    '198.51.100.2',
  ),
  deps,
);
must(r2.status === 200, 'second report accepted');
const [dup] = await sql`select count(*)::int as n from public.submissions where state = 'duplicate_review'`;
must(dup.n === 1, 'duplicate flagged by the production driver');

const up = b1.uploads[0];
files.set(`evidence-incoming/${up.path}`, png);
const f = await handleFinalizeEvidence(
  post({ tracking_code: b1.tracking_code, upload_id: up.upload_id }, '198.51.100.3'),
  deps,
);
must(f.status === 200, 'finalize-evidence stores evidence');
const ev = await handleAddEvidence(
  post(
    {
      tracking_code: b1.tracking_code,
      files: [{ mime: 'image/png', size: 5 }],
      turnstile_token: 'ok',
      website: '',
    },
    '198.51.100.4',
  ),
  deps,
);
must((await ev.json()).uploads.length === 1, 'add-evidence issues a slot');
const w = await handleWithdraw(
  post(
    { tracking_code: b1.tracking_code, reason: 'personal_reasons', turnstile_token: 'ok', website: '' },
    '198.51.100.5',
  ),
  deps,
);
must(w.status === 200, 'withdraw-report answers');
const [wd] = await sql`select count(*)::int as n from public.submissions where state = 'withdrawn'`;
must(wd.n === 1, 'withdrawal recorded');
const c = await handleCorrection(
  post(
    {
      case_id: 'SL-2026-0001',
      request_type: 'remove',
      details: 'A correction request for the check.',
      contact: null,
      turnstile_token: 'ok',
      website: '',
    },
    '198.51.100.6',
  ),
  deps,
);
must(c.status === 200, 'submit-correction answers');
const m = await handleMaintenance(
  new Request('http://f.test/x', { method: 'POST', headers: { 'x-cron-secret': 'cron' } }),
  deps,
);
const mb = await m.json();
must(
  m.status === 200 && mb.stats_refreshed === 1 && mb.intake_day_reset === 1,
  'scheduled-maintenance runs every task',
);
// ---- the staff workflow under the production driver --------------------------------------------------------------
const OWNER = '00000000-0000-4000-8000-0000000000a1';
await sql`insert into auth.users (id, email) values (${OWNER}, 'owner@check.invalid') on conflict do nothing`;
await sql`delete from public.staff`;
await sql`insert into public.staff (user_id, role) values (${OWNER}, 'owner')`;
const b64 = (o: unknown) =>
  btoa(JSON.stringify(o)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const nowSec = Math.floor(Date.now() / 1000);
const jwt = `${b64({ alg: 'none' })}.${b64({ sub: OWNER, aal: 'aal2', exp: nowSec + 600, amr: [{ method: 'totp', timestamp: nowSec - 3 }] })}.sig`;
deps.auth = { verifyJwt: async (t) => (t === jwt ? OWNER : null), inviteUser: async () => OWNER };
const admin = async (body: Record<string, unknown>) => {
  const res = await handleAdmin(
    new Request('http://f.test/x', {
      method: 'POST',
      headers: {
        origin: 'https://site.test',
        'content-type': 'application/json',
        authorization: `Bearer ${jwt}`,
        'cf-connecting-ip': '198.51.100.9',
      },
      body: JSON.stringify(body),
    }),
    deps,
  );
  return { status: res.status, json: await res.json() };
};
const ov = await admin({ action: 'overview' });
must(ov.status === 200 && ov.json.data.staff_count === 1, 'admin overview');
const r3 = await handleSubmitReport(
  post(
    {
      ...report,
      files: [],
      phone: '+94 77 123 4569',
      links: ['https://facebook.com/groups/staff-flow'],
      usernames: ['staff.flow'],
    },
    '198.51.100.7',
  ),
  deps,
);
must(r3.status === 200, 'a fresh report for the staff workflow');
const list = await admin({ action: 'list_submissions', state: 'new' });
const sid = list.json.data[0].id;
must(list.status === 200 && typeof sid === 'string', 'admin list_submissions (timestamps and counts)');
must(
  (await admin({ action: 'get_submission', id: sid })).json.data.submission.answers.links.length >= 1,
  'admin get_submission (jsonb comes back as an object)',
);
must(
  (await admin({ action: 'reveal_contact', submission_id: sid })).json.data.phone.startsWith('+94'),
  'admin reveal_contact decrypts the phone',
);
must(
  (await admin({ action: 'log_call', submission_id: sid, outcome: 'reached_verified' })).status === 200,
  'admin log_call',
);
const acc = await admin({ action: 'accept_submission', id: sid });
must(acc.status === 200, 'admin accept_submission');
const ref = acc.json.data.case_ref;
const fwd = await admin({
  action: 'forward_case',
  case_ref: ref,
  authority_id: 1,
  authority_case_id: 'CCID/1/2026',
  occurred_at: new Date(Date.now() - 5 * 86400000).toISOString(),
});
must(fwd.status === 200, 'admin forward_case (timestamptz parameters)');
must(
  (
    await admin({
      action: 'record_reply',
      case_ref: ref,
      response: 'acknowledgement_received',
      occurred_at: new Date(Date.now() - 86400000).toISOString(),
    })
  ).status === 200,
  'admin record_reply',
);
must(
  (
    await admin({
      action: 'draft_ledger',
      case_ref: ref,
      description: 'FAKE: Images shared in a closed group without consent.',
    })
  ).status === 200,
  'admin draft_ledger',
);
must((await admin({ action: 'publish_ledger', case_ref: ref })).status === 200, 'admin publish_ledger');
const [pub] = await sql`select status, latest_exchange from public.public_ledger where case_id = ${ref}`;
must(
  pub.status === 'acknowledged' && pub.latest_exchange === 'acknowledgement_received',
  'the public row was written and follows the case',
);
const gc = await admin({ action: 'get_case', case_ref: ref });
must(
  gc.json.data.events.length >= 2 && typeof gc.json.data.events[0].id === 'number',
  'admin get_case (ids are numbers)',
);
must((await admin({ action: 'list_followups' })).status === 200, 'admin list_followups');
must((await admin({ action: 'export_case', case_ref: ref })).status === 200, 'admin export_case');
must(
  (await admin({ action: 'set_setting', key: 'follow_up_days', value: [7, 21] })).status === 200,
  'admin set_setting stores a list as real jsonb',
);
const [setting] = await sql`select value from public.app_settings where key = 'follow_up_days'`;
must(
  Array.isArray(setting.value) && setting.value[0] === 7,
  'the stored setting is a JSON list, not a JSON string',
);
must((await admin({ action: 'set_intake', mode: 'open', daily_cap: 7 })).status === 200, 'admin set_intake');
const arc = await admin({ action: 'archive_add', url: 'https://example.test/public-page' });
must(arc.status === 200 && typeof arc.json.data.id === 'number', 'admin archive_add (ids are numbers)');
const audit = await admin({ action: 'list_audit' });
must(
  audit.status === 200 && audit.json.data.length >= 8 && typeof audit.json.data[0].id === 'number',
  'admin list_audit shows what we just did',
);
await sql.end();
console.log('ALL DRIVER CHECKS PASSED');
