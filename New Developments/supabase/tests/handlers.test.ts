// The real Edge Function handlers, run against the real schema in Postgres. Only the network edges are fake.
import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { decryptText, fromHex, hmacHex, sha256Hex } from '../functions/_shared/crypto.ts';
import { handleAddEvidence, handleFinalizeEvidence } from '../functions/_shared/handlers/evidence.ts';
import { handleMaintenance } from '../functions/_shared/handlers/maintenance.ts';
import { handleSubmitReport } from '../functions/_shared/handlers/submit-report.ts';
import { handleCorrection, handleWithdraw } from '../functions/_shared/handlers/withdraw-and-corrections.ts';
import {
  PEPPER,
  PHONE_KEY,
  SITE,
  contains,
  makeDeps,
  makeJpeg,
  makePng,
  makeWebp,
  post,
  trackingFrom,
  validReport,
  type TestDeps,
} from './support';
import { withTx } from './helpers';

const open = (c: pg.Client, cap = 50) =>
  c.query(
    "update public.intake_state set mode = 'open', daily_cap = $1, today_count = 0, limited_by_cap = false, count_date = (now() at time zone 'Asia/Colombo')::date where id = 1",
    [cap],
  );
const count = async (c: pg.Client, table: string) =>
  Number((await c.query(`select count(*)::int as n from public.${table}`)).rows[0].n);
const json = async (r: Response) => (await r.json()) as Record<string, unknown>;
const ipHeader = (n: number) => ({ 'cf-connecting-ip': `198.51.100.${n}` });

async function submit(
  _c: pg.Client,
  deps: TestDeps,
  over: Record<string, unknown> = {},
  headers: Record<string, string> = {},
) {
  const res = await handleSubmitReport(post('submit-report', validReport(over), headers), deps);
  return { res, body: await json(res) };
}

describe('submit-report', () => {
  it('stores the report privately and returns a tracking code once', () =>
    withTx(async (c) => {
      await open(c);
      const deps = makeDeps(c);
      const { res, body } = await submit(c, deps, {
        files: [
          { mime: 'image/png', size: 1000 },
          { mime: 'image/jpeg', size: 2000 },
        ],
      });
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(String(body.tracking_code)).toMatch(/^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){4}$/);
      expect(body.uploads).toHaveLength(2);

      const sub = (await c.query('select * from public.submissions')).rows.at(-1);
      expect(sub.state).toBe('new');
      expect(sub.platform).toBe('Facebook');
      expect(sub.answers.links).toEqual(['https://www.facebook.com/groups/Example-Group-1']);

      const contact = (
        await c.query(
          "select encode(phone_enc, 'hex') as enc, encode(phone_hmac, 'hex') as h, encode(tracking_code_hash, 'hex') as t from public.reporter_contacts where submission_id = $1",
          [sub.id],
        )
      ).rows[0];
      expect(await decryptText(PHONE_KEY, fromHex(contact.enc))).toBe('+94771234567');
      expect(contact.h).toBe(await hmacHex(PEPPER, 'phone:+94771234567'));
      expect(contact.t).toBe(await hmacHex(PEPPER, 'tc:' + trackingFrom(String(body.tracking_code))));
      // Nothing readable is stored: no plaintext phone, no plaintext tracking code anywhere.
      const dump =
        JSON.stringify((await c.query('select * from public.reporter_contacts')).rows) +
        JSON.stringify((await c.query('select * from public.rate_limits')).rows);
      expect(dump).not.toContain('94771234567');
      expect(dump).not.toContain(trackingFrom(String(body.tracking_code)));

      expect(await count(c, 'identifiers')).toBeGreaterThanOrEqual(2);
      const ups = (
        await c.query(
          'select status, declared_mime from public.evidence_uploads where submission_id = $1 order by declared_mime',
          [sub.id],
        )
      ).rows;
      expect(ups).toEqual([
        { status: 'issued', declared_mime: 'image/jpeg' },
        { status: 'issued', declared_mime: 'image/png' },
      ]);
      expect((await c.query('select today_count from public.intake_state')).rows[0].today_count).toBe(1);
    }));

  it('accepts a local Sri Lankan number and stores it in international form', () =>
    withTx(async (c) => {
      await open(c);
      const { res } = await submit(c, makeDeps(c), { phone: '077 123 4567' });
      expect(res.status).toBe(200);
      const h = (await c.query("select encode(phone_hmac, 'hex') as h from public.reporter_contacts")).rows[0]
        .h;
      expect(h).toBe(await hmacHex(PEPPER, 'phone:+94771234567'));
    }));

  it.each([
    ['an unknown extra field', { extra: 1 }],
    ['a report about a minor', { minor: true }],
    ['behalf without consent', { reporter_role: 'behalf', behalf_consent: false }],
    ['no call-back consent', { contact_consent: false }],
    ['a too-short description', { description: 'short' }],
    ['an oversize description', { description: 'x'.repeat(5001) }],
    ['a future date', { date_to: '2999-01-01' }],
    ['dates out of order', { date_from: '2026-10-09', date_to: '2026-10-01' }],
    ['eleven files', { files: Array.from({ length: 11 }, () => ({ mime: 'image/png', size: 10 })) }],
    ['an SVG', { files: [{ mime: 'image/svg+xml', size: 10 }] }],
    ['a file over 10 MB', { files: [{ mime: 'image/png', size: 10485761 }] }],
    ['an unknown category', { category: 'other' }],
    ['a bad phone', { phone: 'not-a-number' }],
  ])('rejects %s and stores nothing', (_label, over) =>
    withTx(async (c) => {
      await open(c);
      const before = await count(c, 'submissions');
      const { res, body } = await submit(c, makeDeps(c), over);
      expect(res.status).toBe(400);
      expect(body).toEqual({ ok: false, error: 'invalid' });
      expect(await count(c, 'submissions')).toBe(before);
    }),
  );

  it('rejects broken JSON, oversize bodies and wrong methods', () =>
    withTx(async (c) => {
      await open(c);
      const deps = makeDeps(c);
      expect((await handleSubmitReport(post('x', '{not json'), deps)).status).toBe(400);
      expect((await handleSubmitReport(post('x', 'x'.repeat(70000)), deps)).status).toBe(400);
      expect((await handleSubmitReport(new Request('http://f.test/x', { method: 'GET' }), deps)).status).toBe(
        405,
      );
    }));

  it('looks successful to a bot that fills the hidden field, and stores nothing', () =>
    withTx(async (c) => {
      await open(c);
      const before = await count(c, 'submissions');
      const { res, body } = await submit(c, makeDeps(c), { website: 'http://spam.test' });
      expect(res.status).toBe(200);
      expect(body.ok).toBe(true);
      expect(await count(c, 'submissions')).toBe(before);
    }));

  it('refuses a failed bot check, and fails closed when no Turnstile secret is configured', () =>
    withTx(async (c) => {
      await open(c);
      const before = await count(c, 'submissions');
      const bad = await submit(c, makeDeps(c), { turnstile_token: 'bad-token' });
      expect(bad.body).toEqual({ ok: false, error: 'bot_check' });
      const deps = makeDeps(c);
      deps.env = { ...deps.env, turnstileSecret: '' };
      expect((await submit(c, deps, {}, ipHeader(9))).body).toEqual({ ok: false, error: 'bot_check' });
      expect(await count(c, 'submissions')).toBe(before);
    }));

  it('respects intake: closed refuses, the daily cap refuses, and refusals store nothing', () =>
    withTx(async (c) => {
      const before = await count(c, 'submissions');
      await c.query("update public.intake_state set mode = 'closed' where id = 1");
      expect((await submit(c, makeDeps(c))).body).toEqual({ ok: false, error: 'closed' });
      await open(c, 1);
      expect((await submit(c, makeDeps(c), { phone: '+94771110001' }, ipHeader(1))).res.status).toBe(200);
      const capped = await submit(c, makeDeps(c), { phone: '+94771110002' }, ipHeader(2));
      expect(capped.res.status).toBe(503);
      expect(capped.body).toEqual({ ok: false, error: 'capped' });
      expect(await count(c, 'submissions')).toBe(before + 1);
    }));

  it('rate-limits by network address and by phone number', () =>
    withTx(async (c) => {
      await open(c);
      const deps = makeDeps(c);
      for (let i = 0; i < 5; i++)
        expect((await submit(c, deps, { phone: `+9477000000${i}` })).res.status).toBe(200);
      const sixth = await submit(c, deps, { phone: '+94770000009' });
      expect(sixth.res.status).toBe(429);
      expect(sixth.body).toEqual({ ok: false, error: 'rate_limited' });
      for (let i = 0; i < 3; i++)
        expect((await submit(c, deps, { phone: '+94779990000' }, ipHeader(20 + i))).res.status).toBe(200);
      expect((await submit(c, deps, { phone: '+94779990000' }, ipHeader(30))).res.status).toBe(429);
    }));

  it('refuses addresses and phone numbers on the block list', () =>
    withTx(async (c) => {
      await open(c);
      await c.query("insert into public.block_list (kind, value_hmac) values ('phone', decode($1, 'hex'))", [
        await hmacHex(PEPPER, 'phone:+94775550000'),
      ]);
      expect((await submit(c, makeDeps(c), { phone: '+94775550000' })).res.status).toBe(429);
    }));

  it('only answers browsers on the allowed origin, and answers preflight', () =>
    withTx(async (c) => {
      await open(c);
      const deps = makeDeps(c);
      const wrong = await handleSubmitReport(post('x', validReport(), { origin: 'https://evil.test' }), deps);
      expect(wrong.status).toBe(403);
      expect(wrong.headers.get('access-control-allow-origin')).toBeNull();
      const pre = await handleSubmitReport(
        new Request('http://f.test/x', { method: 'OPTIONS', headers: { origin: SITE } }),
        deps,
      );
      expect(pre.status).toBe(204);
      expect(pre.headers.get('access-control-allow-origin')).toBe(SITE);
      expect((await submit(c, deps, {}, ipHeader(40))).res.headers.get('cache-control')).toBe('no-store');
    }));

  it('flags duplicates for admins only, and a reporter cannot tell the difference', () =>
    withTx(async (c) => {
      await open(c);
      const a = await submit(c, makeDeps(c), { phone: '+94771000001' }, ipHeader(50));
      const dupCount = { n: 0 };
      const plainCount = { n: 0 };
      const dup = await submit(
        c,
        makeDeps(c, { counter: dupCount }),
        { phone: '+94771000002', links: ['https://m.facebook.com/groups/example-group-1/?ref=share'] },
        ipHeader(51),
      );
      const plain = await submit(
        c,
        makeDeps(c, { counter: plainCount }),
        {
          phone: '+94771000003',
          links: ['https://facebook.com/groups/totally-different'],
          usernames: ['someone.else'],
        },
        ipHeader(52),
      );
      expect(a.res.status).toBe(200);

      const states = (
        await c.query(
          'select s.state, s.platform, rc.phone_hmac is not null as has_contact from public.submissions s join public.reporter_contacts rc on rc.submission_id = s.id order by s.created_at, s.id',
        )
      ).rows;
      expect(states.filter((s) => s.state === 'duplicate_review')).toHaveLength(1);
      expect(
        (await c.query('select count(*)::int as n from public.duplicate_flags')).rows[0].n,
      ).toBeGreaterThanOrEqual(1);

      // Same shape, same status, same number of database statements: nothing for a reporter (or a timer) to learn.
      expect(dup.res.status).toBe(plain.res.status);
      expect(Object.keys(dup.body).sort()).toEqual(Object.keys(plain.body).sort());
      expect(JSON.stringify(dup.body)).not.toMatch(/duplicate|match|flag/i);
      expect(dupCount.n).toBe(plainCount.n);
    }));
});

async function reportAndCode(c: pg.Client, over: Record<string, unknown> = {}, ip = 60) {
  await open(c);
  const { body } = await submit(
    c,
    makeDeps(c),
    { phone: `+9477${String(ip).padStart(7, '0')}`, ...over },
    ipHeader(ip),
  );
  return { code: String(body.tracking_code), uploads: body.uploads as { upload_id: string; path: string }[] };
}
const finalize = (deps: TestDeps, code: string, id: string, ip = 99) =>
  handleFinalizeEvidence(
    post('finalize-evidence', { tracking_code: code, upload_id: id }, ipHeader(ip)),
    deps,
  );

describe('add-evidence and finalize-evidence', () => {
  it('accepts a real PNG, keeps the untouched original, and shows admins only a stripped copy', () =>
    withTx(async (c) => {
      const { code, uploads } = await reportAndCode(c, { files: [{ mime: 'image/png', size: 100 }] });
      const deps = makeDeps(c);
      const png = makePng();
      deps.storage.put('evidence-incoming', uploads[0]!.path, png);
      const res = await finalize(deps, code, uploads[0]!.upload_id);
      expect(res.status).toBe(200);
      const item = (await c.query('select * from public.evidence_items')).rows[0];
      expect(item.sha256).toBe(await sha256Hex(png));
      expect(item.mime).toBe('image/png');
      expect(item.size_bytes).toBe(png.length);
      expect(
        contains(deps.storage.files.get(`evidence-original/${item.storage_path}`)!, 'GPS-SECRET-LOCATION'),
      ).toBe(true);
      expect(
        contains(deps.storage.files.get(`evidence-preview/${item.derived_path}`)!, 'GPS-SECRET-LOCATION'),
      ).toBe(false);
      expect(deps.storage.has('evidence-incoming', uploads[0]!.path)).toBe(false);
      expect((await c.query('select status from public.evidence_uploads')).rows[0].status).toBe('finalized');
      // A second attempt with the same slot is refused.
      expect((await finalize(deps, code, uploads[0]!.upload_id)).status).toBe(400);
    }));

  it.each([
    ['image/jpeg', makeJpeg],
    ['image/webp', makeWebp],
  ] as const)('accepts a real %s', (mime, make) =>
    withTx(async (c) => {
      const { code, uploads } = await reportAndCode(c, { files: [{ mime, size: 100 }] }, 61);
      const deps = makeDeps(c);
      deps.storage.put('evidence-incoming', uploads[0]!.path, make());
      expect((await finalize(deps, code, uploads[0]!.upload_id)).status).toBe(200);
      expect((await c.query('select mime from public.evidence_items')).rows[0].mime).toBe(mime);
    }),
  );

  it.each([
    ['a PNG declared as JPEG', 'image/jpeg', () => makePng()],
    ['a script renamed to .png', 'image/png', () => new TextEncoder().encode('<script>alert(1)</script>')],
    [
      'an SVG declared as PNG',
      'image/png',
      () => new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'),
    ],
    ['an empty upload', 'image/png', () => new Uint8Array(0)],
    ['a truncated PNG', 'image/png', () => makePng().slice(0, 30)],
    [
      'a file over 10 MB',
      'image/png',
      () => {
        const b = new Uint8Array(10485761);
        b.set(makePng());
        return b;
      },
    ],
  ])('rejects %s and leaves nothing behind', (_label, mime, make) =>
    withTx(async (c) => {
      const { code, uploads } = await reportAndCode(c, { files: [{ mime, size: 100 }] }, 62);
      const deps = makeDeps(c);
      deps.storage.put('evidence-incoming', uploads[0]!.path, make());
      const res = await finalize(deps, code, uploads[0]!.upload_id);
      expect(res.status).toBe(400);
      expect(await json(res)).toEqual({ ok: false, error: 'rejected' });
      expect(await count(c, 'evidence_items')).toBe(0);
      expect(deps.storage.files.size).toBe(0);
      expect((await c.query('select status from public.evidence_uploads')).rows[0].status).toBe('rejected');
    }),
  );

  it('rejects a wrong tracking code, an unknown slot, an expired slot and a withdrawn report', () =>
    withTx(async (c) => {
      const { code, uploads } = await reportAndCode(c, { files: [{ mime: 'image/png', size: 100 }] }, 63);
      const deps = makeDeps(c);
      deps.storage.put('evidence-incoming', uploads[0]!.path, makePng());
      expect((await finalize(deps, 'AAAA-AAAA-AAAA-AAAA-AAAA', uploads[0]!.upload_id)).status).toBe(400);
      expect((await finalize(deps, code, '00000000-0000-4000-8000-000000000000')).status).toBe(400);
      await c.query("update public.evidence_uploads set expires_at = now() - interval '1 minute'");
      expect((await finalize(deps, code, uploads[0]!.upload_id)).status).toBe(400);
      await c.query("update public.evidence_uploads set expires_at = now() + interval '1 hour'");
      await c.query("update public.submissions set state = 'withdrawn'");
      expect((await finalize(deps, code, uploads[0]!.upload_id)).status).toBe(400);
      expect(await count(c, 'evidence_items')).toBe(0);
    }));

  it('add-evidence issues slots, never reveals whether a code is valid, and caps a report at 10 images', () =>
    withTx(async (c) => {
      const { code } = await reportAndCode(c, {}, 64);
      const deps = makeDeps(c);
      const ask = (tracking_code: string, n: number, ip = 70) =>
        handleAddEvidence(
          post(
            'add-evidence',
            {
              tracking_code,
              files: Array.from({ length: n }, () => ({ mime: 'image/png', size: 50 })),
              turnstile_token: 'good-token',
              website: '',
            },
            ipHeader(ip),
          ),
          deps,
        );
      const good = await json(await ask(code, 3));
      expect(good.ok).toBe(true);
      expect(good.uploads).toHaveLength(3);
      const wrong = await ask('AAAA-AAAA-AAAA-AAAA-AAAA', 3, 71);
      expect(wrong.status).toBe(200);
      expect(await json(wrong)).toEqual({ ok: true, uploads: [] });
      expect((await json(await ask(code, 7, 72))).uploads as unknown[]).toHaveLength(7);
      expect((await json(await ask(code, 1, 73))).uploads as unknown[]).toHaveLength(0); // 3 + 7 slots already issued
      const bot = await handleAddEvidence(
        post(
          'x',
          {
            tracking_code: code,
            files: [{ mime: 'image/png', size: 1 }],
            turnstile_token: 'bad',
            website: '',
          },
          ipHeader(74),
        ),
        deps,
      );
      expect(await json(bot)).toEqual({ ok: false, error: 'bot_check' });
    }));
});

describe('withdraw-report', () => {
  const withdraw = (
    deps: TestDeps,
    tracking_code: string,
    reason: string | null = 'personal_reasons',
    ip = 80,
  ) =>
    handleWithdraw(
      post(
        'withdraw-report',
        { tracking_code, reason, turnstile_token: 'good-token', website: '' },
        ipHeader(ip),
      ),
      deps,
    );

  it('withdraws, records an anonymous reason, and answers identically for unknown codes', () =>
    withTx(async (c) => {
      await c.query('delete from public.revocations'); // start from empty, ignoring the FAKE seed
      const { code } = await reportAndCode(c, {}, 65);
      const deps = makeDeps(c);
      const real = await withdraw(deps, code, 'fear_of_retaliation');
      const fake = await withdraw(deps, 'ZZZZ-ZZZZ-ZZZZ-ZZZZ-ZZZZ', 'fear_of_retaliation', 81);
      expect(real.status).toBe(200);
      expect(await json(real)).toEqual(await json(fake));
      const s = (
        await c.query(
          "select state, purge_after > now() + interval '29 days' as later from public.submissions",
        )
      ).rows.at(-1);
      expect(s).toEqual({ state: 'withdrawn', later: true });
      const rev = (await c.query('select * from public.revocations')).rows;
      expect(rev).toHaveLength(1);
      expect(Object.keys(rev[0]).sort()).toEqual(['id', 'occurred_at', 'reason_category']);
      await withdraw(deps, code, 'fear_of_retaliation', 82); // again: nothing new recorded
      expect(await count(c, 'revocations')).toBe(1);
    }));

  it('tells the team when a forwarded case loses its reporter', () =>
    withTx(async (c) => {
      await c.query('delete from public.revocations');
      const { code } = await reportAndCode(c, {}, 66);
      await c.query("insert into public.cases (case_ref, category) values ('SL-2026-9100', 'ncii')");
      await c.query("update public.submissions set case_ref = 'SL-2026-9100'");
      await withdraw(makeDeps(c), code, null);
      const e = (await c.query("select type, note from public.case_events where case_ref = 'SL-2026-9100'"))
        .rows;
      expect(e).toHaveLength(1);
      expect(e[0].type).toBe('note');
      expect(
        (await c.query('select reason_category from public.revocations')).rows[0].reason_category,
      ).toBeNull();
    }));

  it('needs the bot check', () =>
    withTx(async (c) => {
      const res = await handleWithdraw(
        post('x', {
          tracking_code: 'AAAA-AAAA-AAAA-AAAA-AAAA',
          reason: null,
          turnstile_token: 'bad',
          website: '',
        }),
        makeDeps(c),
      );
      expect(await json(res)).toEqual({ ok: false, error: 'bot_check' });
    }));
});

describe('submit-correction', () => {
  const body = (over: Record<string, unknown> = {}) => ({
    case_id: 'SL-2026-0042',
    request_type: 'remove',
    details: 'This row names the wrong authority.',
    contact: null,
    turnstile_token: 'good-token',
    website: '',
    ...over,
  });
  it('queues a request and answers "received" even for a case that does not exist', () =>
    withTx(async (c) => {
      const deps = makeDeps(c);
      expect((await handleCorrection(post('x', body()), deps)).status).toBe(200);
      expect(
        (await handleCorrection(post('x', body({ case_id: 'SL-2026-9999' }), ipHeader(90)), deps)).status,
      ).toBe(200);
      expect(await count(c, 'correction_requests')).toBe(2);
    }));
  it('refuses bad input, bots and honeypot fills without storing', () =>
    withTx(async (c) => {
      const deps = makeDeps(c);
      expect((await handleCorrection(post('x', body({ details: 'short' })), deps)).status).toBe(400);
      expect((await handleCorrection(post('x', body({ case_id: 'x' })), deps)).status).toBe(400);
      expect((await handleCorrection(post('x', body({ turnstile_token: 'bad' })), deps)).status).toBe(400);
      expect((await handleCorrection(post('x', body({ website: 'spam' })), deps)).status).toBe(200);
      expect(await count(c, 'correction_requests')).toBe(0);
    }));
});

describe('scheduled-maintenance', () => {
  const call = (deps: TestDeps, secret?: string) =>
    handleMaintenance(
      new Request('http://f.test/x', { method: 'POST', headers: secret ? { 'x-cron-secret': secret } : {} }),
      deps,
    );

  it('refuses callers without the shared secret', () =>
    withTx(async (c) => {
      const deps = makeDeps(c);
      expect((await call(deps)).status).toBe(403);
      expect((await call(deps, 'wrong')).status).toBe(403);
      deps.env = { ...deps.env, cronSecret: '' };
      expect((await call(deps, '')).status).toBe(403);
    }));

  it('purges withdrawn reports after retention, with their files, and keeps the rest', () =>
    withTx(async (c) => {
      const old = await reportAndCode(c, { files: [{ mime: 'image/png', size: 100 }] }, 67);
      const deps = makeDeps(c);
      deps.storage.put('evidence-incoming', old.uploads[0]!.path, makePng());
      await finalize(deps, old.code, old.uploads[0]!.upload_id);
      const keep = await reportAndCode(c, {}, 68);
      await withdraw2(deps, old.code);
      await withdraw2(deps, keep.code, 69);
      await c.query(
        "update public.submissions set purge_after = now() - interval '1 day' where id = (select submission_id from public.evidence_items limit 1)",
      );
      expect(deps.storage.files.size).toBe(2);
      const res = await call(deps, 'cron-secret-value-for-tests');
      expect(res.status).toBe(200);
      const out = await json(res);
      expect(out.withdrawn_purged).toBe(1);
      expect(deps.storage.files.size).toBe(0);
      expect(await count(c, 'evidence_items')).toBe(0);
      expect(
        (await c.query("select count(*)::int as n from public.submissions where state = 'withdrawn'")).rows[0]
          .n,
      ).toBe(1);
    }));

  it('marks silent cases "No response", clears unused upload slots and refreshes the ticker', () =>
    withTx(async (c) => {
      await c.query(
        "insert into public.cases (case_ref, category, status, forwarded_at) values ('SL-2026-9201', 'ncii', 'submitted', now() - interval '60 days'), ('SL-2026-9202', 'ncii', 'submitted', now() - interval '5 days')",
      );
      const { uploads } = await reportAndCode(c, { files: [{ mime: 'image/png', size: 100 }] }, 70);
      await c.query("update public.evidence_uploads set expires_at = now() - interval '1 minute'");
      const deps = makeDeps(c);
      deps.storage.put('evidence-incoming', uploads[0]!.path, makePng());
      const out = await json(await call(deps, 'cron-secret-value-for-tests'));
      expect(out.no_response_marked).toBe(1);
      expect(out.stale_uploads_cleared).toBe(1);
      expect(out.stats_refreshed).toBe(1);
      expect(deps.storage.files.size).toBe(0);
      const st = (
        await c.query(
          "select case_ref, status from public.cases where case_ref like 'SL-2026-92%' order by 1",
        )
      ).rows;
      expect(st.map((r) => r.status)).toEqual(['no_response', 'submitted']);
    }));

  async function withdraw2(deps: TestDeps, code: string, ip = 95) {
    await handleWithdraw(
      post(
        'x',
        { tracking_code: code, reason: null, turnstile_token: 'good-token', website: '' },
        ipHeader(ip),
      ),
      deps,
    );
  }
});
