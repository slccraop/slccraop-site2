import type { Deps } from '../deps.ts';
import { reportSchema, type UploadTicket } from '../contracts.ts';
import { encryptText, formatTrackingCode, hmacHex, newTrackingCode, toHex } from '../crypto.ts';
import { fail, gate, readJson, reply } from '../http.ts';
import { hit, ipKey, isBlocked, logError, setting, turnstileOk } from '../guards.ts';
import { buildIdentifiers, normalisePhone } from '../normalise.ts';

/**
 * POST submit-report. Order matters: cheap checks first, Turnstile before any database write, the daily slot inside the
 * same transaction as the inserts (so a failed insert does not use up a slot). The response is identical whether or not the
 * report matched an earlier one: duplicates are only ever flagged for admins (manual 6.3 and 5.7).
 */
export async function handleSubmitReport(req: Request, deps: Deps): Promise<Response> {
  const early = gate(req, deps);
  if (early) return early;
  try {
    const raw = await readJson(req);
    const parsed = reportSchema.safeParse(raw);
    if (!parsed.success) return fail(req, deps, 'invalid');
    const d = parsed.data;
    const { db, env } = deps;

    if (d.website !== '') {
      // A bot filled the hidden field. Look successful, store nothing.
      return reply(req, deps, 200, {
        ok: true,
        tracking_code: formatTrackingCode(newTrackingCode(deps.random)),
        uploads: [],
      });
    }

    const ip = await ipKey(req, deps);
    if (await isBlocked(db, 'ip', ip)) return fail(req, deps, 'rate_limited');
    if (!(await hit(db, 'submit:ip', ip, await setting(db, 'rate_ip_submit_per_hour'), 3600)))
      return fail(req, deps, 'rate_limited');
    if (!(await turnstileOk(deps, d.turnstile_token, req))) return fail(req, deps, 'bot_check');

    const phone = normalisePhone(d.phone);
    if (!phone) return fail(req, deps, 'invalid');
    const phoneKey = await hmacHex(env.pepper, 'phone:' + phone);
    if (await isBlocked(db, 'phone', phoneKey)) return fail(req, deps, 'rate_limited');
    if (!(await hit(db, 'submit:phone', phoneKey, await setting(db, 'rate_phone_submit_per_day'), 86400)))
      return fail(req, deps, 'rate_limited');

    // Today's date in Sri Lanka, for the "not in the future" check on the incident dates.
    const today = new Date(deps.now().getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
    if ((d.date_from && d.date_from > today) || (d.date_to && d.date_to > today))
      return fail(req, deps, 'invalid');

    // Everything that can be computed without the database, before the transaction opens.
    const trackingCode = newTrackingCode(deps.random);
    const codeHash = await hmacHex(env.pepper, 'tc:' + trackingCode);
    const phoneEnc = toHex(await encryptText(env.phoneKey, phone, deps.random));
    const submissionId = crypto.randomUUID();
    const identifiers = await Promise.all(
      buildIdentifiers(d.links, d.usernames).map(async (i) => ({
        t: i.type,
        h: await hmacHex(env.pepper, `${i.type}:${i.canonical}`),
      })),
    );
    const ttl = await setting(db, 'upload_ttl_minutes');
    const uploads = d.files.map((f) => ({ id: crypto.randomUUID(), mime: f.mime, size: f.size }));
    const answers = {
      links: d.links,
      usernames: d.usernames,
      date_from: d.date_from,
      date_to: d.date_to,
      reported_to_platform: d.reported_to_platform,
      platform_reference: d.platform_reference,
      reported_to_police: d.reported_to_police,
      police_reference: d.police_reference,
      evidence_summary: d.evidence_summary,
      external_media_links: d.external_media_links,
      contact_language: d.contact_language,
      behalf_consent: d.behalf_consent,
    };

    const tickets = await db.tx(async (tx): Promise<UploadTicket[] | 'closed' | 'capped'> => {
      const slot = (await tx.query<{ s: string }>('select public.take_intake_slot() as s'))[0]?.s;
      if (slot !== 'ok') return slot === 'capped' ? 'capped' : 'closed';

      await tx.query(
        `insert into public.submissions (id, category, platform, answers, description, reporter_role, contact_consent, language)
         values ($1, $2, $3, $4::jsonb, $5, $6, true, $7)`,
        [submissionId, d.category, d.platform, answers, d.description, d.reporter_role, d.language],
      );
      await tx.query(
        `insert into public.reporter_contacts (submission_id, phone_enc, phone_hmac, tracking_code_hash)
         values ($1, decode($2, 'hex'), decode($3, 'hex'), decode($4, 'hex'))`,
        [submissionId, phoneEnc, phoneKey, codeHash],
      );
      await tx.query(
        `insert into public.identifiers (submission_id, type, value_hmac)
         select $1::uuid, x.t::public.identifier_type, decode(x.h, 'hex')
           from jsonb_to_recordset($2::jsonb -> 'rows') as x(t text, h text) on conflict do nothing`,
        [submissionId, { rows: identifiers }],
      );
      // Always both statements, whether or not anything matches, so duplicates cannot be detected by timing or by effort.
      await tx.query(
        `insert into public.duplicate_flags (submission_id, matched_submission_id)
         select distinct $1::uuid, other.submission_id
           from public.identifiers mine
           join public.identifiers other on other.type = mine.type and other.value_hmac = mine.value_hmac and other.submission_id <> mine.submission_id
          where mine.submission_id = $1::uuid`,
        [submissionId],
      );
      await tx.query(
        `update public.submissions set state = 'duplicate_review'
          where id = $1::uuid and exists (select 1 from public.duplicate_flags f where f.submission_id = $1::uuid and f.resolution is null)`,
        [submissionId],
      );

      const out: UploadTicket[] = [];
      for (const u of uploads) {
        const path = `${submissionId}/${u.id}`;
        const signed = await deps.storage.createSignedUploadUrl('evidence-incoming', path);
        out.push({ upload_id: u.id, path: signed.path, token: signed.token, mime: u.mime });
      }
      await tx.query(
        `insert into public.evidence_uploads (id, submission_id, incoming_path, declared_mime, declared_size, expires_at)
         select (x.id)::uuid, $1::uuid, $1::text || '/' || x.id, x.mime, x.size, now() + make_interval(mins => $3::int)
           from jsonb_to_recordset($2::jsonb -> 'rows') as x(id text, mime text, size int)`,
        [submissionId, { rows: uploads }, ttl],
      );
      return out;
    });

    if (tickets === 'closed' || tickets === 'capped') return fail(req, deps, tickets);
    return reply(req, deps, 200, {
      ok: true,
      tracking_code: formatTrackingCode(trackingCode),
      uploads: tickets,
    });
  } catch (e) {
    logError('submit-report', e);
    return fail(req, deps, 'server');
  }
}
