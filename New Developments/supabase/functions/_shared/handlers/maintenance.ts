import type { Deps } from '../deps.ts';
import { constantTimeEqual } from '../crypto.ts';
import { reply } from '../http.ts';
import { logError, setting } from '../guards.ts';

/**
 * POST scheduled-maintenance, called once a day by the scheduler with the shared secret (never by browsers).
 * Returns counts only. Each task is independent, so one failure does not stop the rest.
 */
export async function handleMaintenance(req: Request, deps: Deps): Promise<Response> {
  const secret = req.headers.get('x-cron-secret') ?? '';
  if (req.method !== 'POST' || !deps.env.cronSecret || !constantTimeEqual(secret, deps.env.cronSecret)) {
    return new Response(JSON.stringify({ ok: false, error: 'rejected' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const { db, storage } = deps;
  const out: Record<string, number | string> = {};
  const run = async (name: string, task: () => Promise<number>) => {
    try {
      out[name] = await task();
    } catch (e) {
      logError('maintenance:' + name, e);
      out[name] = 'failed';
    }
  };

  await run('intake_day_reset', async () => {
    await db.query('select public.reset_intake_day()');
    return 1;
  });

  // Cases with no authority reply for the configured number of days become "No response", with a dated event.
  await run('no_response_marked', async () => {
    const days = await setting(db, 'no_response_days');
    return db.tx(async (tx) => {
      const rows = await tx.query<{ case_ref: string }>(
        `update public.cases c set status = 'no_response'
          where c.status = 'submitted' and c.forwarded_at is not null and c.forwarded_at < now() - make_interval(days => $1::int)
            and not exists (select 1 from public.case_events e where e.case_ref = c.case_ref and e.type = 'authority_reply')
      returning c.case_ref`,
        [days],
      );
      for (const r of rows) {
        await tx.query(
          `insert into public.case_events (case_ref, type, note, occurred_at) values ($1, 'status_change', 'No response from the authority after the configured number of days.', now())`,
          [r.case_ref],
        );
        await tx.query(
          "update public.public_ledger set status = 'no_response' where case_id = $1 and status = 'submitted'",
          [r.case_ref],
        );
      }
      return rows.length;
    });
  });

  // Withdrawn reports past their retention date: delete files first, then every database row.
  await run('withdrawn_purged', async () => {
    const due = await db.query<{ id: string }>(
      "select id from public.submissions where state = 'withdrawn' and purge_after is not null and purge_after < now()",
    );
    let n = 0;
    for (const s of due) {
      const files = await db.query<{ storage_path: string; derived_path: string | null }>(
        'select storage_path, derived_path from public.evidence_items where submission_id = $1::uuid',
        [s.id],
      );
      const pending = await db.query<{ incoming_path: string }>(
        "select incoming_path from public.evidence_uploads where submission_id = $1::uuid and status = 'issued'",
        [s.id],
      );
      await storage.remove(
        'evidence-original',
        files.map((f) => f.storage_path),
      );
      await storage.remove(
        'evidence-preview',
        files.map((f) => f.derived_path ?? f.storage_path),
      );
      await storage.remove(
        'evidence-incoming',
        pending.map((p) => p.incoming_path),
      );
      await db.query('delete from public.submissions where id = $1::uuid', [s.id]);
      n++;
    }
    return n;
  });

  // Upload slots that were never used: delete whatever was uploaded and close the slot.
  await run('stale_uploads_cleared', async () => {
    const stale = await db.query<{ id: string; incoming_path: string }>(
      "select id, incoming_path from public.evidence_uploads where status = 'issued' and expires_at < now()",
    );
    if (stale.length)
      await storage.remove(
        'evidence-incoming',
        stale.map((s) => s.incoming_path),
      );
    for (const s of stale)
      await db.query("update public.evidence_uploads set status = 'rejected' where id = $1::uuid", [s.id]);
    return stale.length;
  });

  await run(
    'rate_limits_pruned',
    async () =>
      (
        await db.query<{ n: number }>(
          "with d as (delete from public.rate_limits where occurred_at < now() - interval '2 days' returning 1) select count(*)::int as n from d",
        )
      )[0]?.n ?? 0,
  );
  await run('stats_refreshed', async () => {
    await db.query('select public.refresh_public_stats()');
    return 1;
  });

  return reply(req, deps, 200, { ok: true, ...out });
}
