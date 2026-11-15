import type { Deps } from '../deps.ts';
import { correctionSchema, withdrawSchema } from '../contracts.ts';
import { hmacHex, normaliseTrackingCode } from '../crypto.ts';
import { fail, gate, readJson, reply } from '../http.ts';
import { hit, ipKey, isBlocked, logError, setting, turnstileOk } from '../guards.ts';

/**
 * POST withdraw-report. One step, no reason required. The answer is always "received", whether or not the code matched,
 * so the form can never be used to test codes. A withdrawal is recorded anonymously (no link to the report) and the report's
 * data is purged after the retention period by scheduled-maintenance.
 */
export async function handleWithdraw(req: Request, deps: Deps): Promise<Response> {
  const early = gate(req, deps);
  if (early) return early;
  try {
    const parsed = withdrawSchema.safeParse(await readJson(req));
    if (!parsed.success) return fail(req, deps, 'invalid');
    const d = parsed.data;
    const { db } = deps;
    if (d.website !== '') return reply(req, deps, 200, { ok: true });

    const ip = await ipKey(req, deps);
    if (await isBlocked(db, 'ip', ip)) return fail(req, deps, 'rate_limited');
    if (!(await hit(db, 'other:ip', ip, await setting(db, 'rate_ip_other_per_hour'), 3600)))
      return fail(req, deps, 'rate_limited');
    const codeHash = await hmacHex(deps.env.pepper, 'tc:' + normaliseTrackingCode(d.tracking_code));
    if (!(await hit(db, 'code:withdraw', codeHash, await setting(db, 'rate_code_per_day'), 86400)))
      return fail(req, deps, 'rate_limited');
    if (!(await turnstileOk(deps, d.turnstile_token, req))) return fail(req, deps, 'bot_check');

    const days = await setting(db, 'retention_withdrawn_days');
    await db.tx(async (tx) => {
      const hit1 = await tx.query<{ id: string; case_ref: string | null }>(
        `update public.submissions s
            set state = 'withdrawn', purge_after = now() + make_interval(days => $2::int)
           from public.reporter_contacts rc
          where rc.submission_id = s.id and rc.tracking_code_hash = decode($1, 'hex') and s.state <> 'withdrawn'
      returning s.id, s.case_ref`,
        [codeHash, days],
      );
      const row = hit1[0];
      if (!row) return;
      await tx.query(
        'insert into public.revocations (reason_category) values ($1::public.withdrawal_reason)',
        [d.reason],
      );
      if (row.case_ref) {
        await tx.query(
          `insert into public.case_events (case_ref, type, note, occurred_at)
           values ($1, 'note', 'Reporter withdrew. Review and close the case with the reason "complainant withdrew".', now())`,
          [row.case_ref],
        );
      }
    });
    return reply(req, deps, 200, { ok: true });
  } catch (e) {
    logError('withdraw-report', e);
    return fail(req, deps, 'server');
  }
}

/** POST submit-correction: the public correction or removal form. Always answers "received". */
export async function handleCorrection(req: Request, deps: Deps): Promise<Response> {
  const early = gate(req, deps);
  if (early) return early;
  try {
    const parsed = correctionSchema.safeParse(await readJson(req));
    if (!parsed.success) return fail(req, deps, 'invalid');
    const d = parsed.data;
    const { db } = deps;
    if (d.website !== '') return reply(req, deps, 200, { ok: true });

    const ip = await ipKey(req, deps);
    if (await isBlocked(db, 'ip', ip)) return fail(req, deps, 'rate_limited');
    if (!(await hit(db, 'other:ip', ip, await setting(db, 'rate_ip_other_per_hour'), 3600)))
      return fail(req, deps, 'rate_limited');
    if (!(await turnstileOk(deps, d.turnstile_token, req))) return fail(req, deps, 'bot_check');

    await db.query(
      `insert into public.correction_requests (case_id, request_type, details, contact)
       values ($1, $2::public.correction_type, $3, $4)`,
      [d.case_id, d.request_type, d.details, d.contact],
    );
    return reply(req, deps, 200, { ok: true });
  } catch (e) {
    logError('submit-correction', e);
    return fail(req, deps, 'server');
  }
}
