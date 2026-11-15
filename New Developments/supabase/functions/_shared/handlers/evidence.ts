import type { Deps } from '../deps.ts';
import { addEvidenceSchema, finalizeSchema, LIMITS, type UploadTicket } from '../contracts.ts';
import { hmacHex, normaliseTrackingCode, sha256Hex } from '../crypto.ts';
import { fail, gate, readJson, reply } from '../http.ts';
import { hit, ipKey, isBlocked, logError, setting, turnstileOk } from '../guards.ts';
import { EXTENSION, sniffMime, stripMetadata } from '../image.ts';

const lookup = (deps: Deps, code: string) => hmacHex(deps.env.pepper, 'tc:' + normaliseTrackingCode(code));

/**
 * POST add-evidence: a reporter with a tracking code asks for upload slots for more screenshots. Nothing about the report
 * is ever returned. A wrong code, a withdrawn report and a full report all look the same: an empty list of slots.
 */
export async function handleAddEvidence(req: Request, deps: Deps): Promise<Response> {
  const early = gate(req, deps);
  if (early) return early;
  try {
    const parsed = addEvidenceSchema.safeParse(await readJson(req));
    if (!parsed.success) return fail(req, deps, 'invalid');
    const d = parsed.data;
    const { db } = deps;
    if (d.website !== '') return reply(req, deps, 200, { ok: true, uploads: [] });

    const ip = await ipKey(req, deps);
    if (await isBlocked(db, 'ip', ip)) return fail(req, deps, 'rate_limited');
    if (!(await hit(db, 'other:ip', ip, await setting(db, 'rate_ip_other_per_hour'), 3600)))
      return fail(req, deps, 'rate_limited');
    const codeHash = await lookup(deps, d.tracking_code);
    if (!(await hit(db, 'code:evidence', codeHash, await setting(db, 'rate_code_per_day'), 86400)))
      return fail(req, deps, 'rate_limited');
    if (!(await turnstileOk(deps, d.turnstile_token, req))) return fail(req, deps, 'bot_check');

    const ttl = await setting(db, 'upload_ttl_minutes');
    const tickets = await db.tx(async (tx): Promise<UploadTicket[]> => {
      const sub = await tx.query<{ id: string; n: number }>(
        `select s.id,
                (select count(*)::int from public.evidence_items e where e.submission_id = s.id)
              + (select count(*)::int from public.evidence_uploads u where u.submission_id = s.id and u.status = 'issued' and u.expires_at > now()) as n
           from public.submissions s join public.reporter_contacts rc on rc.submission_id = s.id
          where rc.tracking_code_hash = decode($1, 'hex') and s.state not in ('withdrawn', 'rejected')`,
        [codeHash],
      );
      const s = sub[0];
      if (!s || s.n + d.files.length > LIMITS.maxFiles) return [];
      const uploads = d.files.map((f) => ({ id: crypto.randomUUID(), mime: f.mime, size: f.size }));
      const out: UploadTicket[] = [];
      for (const u of uploads) {
        const signed = await deps.storage.createSignedUploadUrl('evidence-incoming', `${s.id}/${u.id}`);
        out.push({ upload_id: u.id, path: signed.path, token: signed.token, mime: u.mime });
      }
      await tx.query(
        `insert into public.evidence_uploads (id, submission_id, incoming_path, declared_mime, declared_size, expires_at)
         select (x.id)::uuid, $1::uuid, $1::text || '/' || x.id, x.mime, x.size, now() + make_interval(mins => $3::int)
           from jsonb_to_recordset($2::jsonb -> 'rows') as x(id text, mime text, size int)`,
        [s.id, { rows: uploads }, ttl],
      );
      return out;
    });
    return reply(req, deps, 200, { ok: true, uploads: tickets });
  } catch (e) {
    logError('add-evidence', e);
    return fail(req, deps, 'server');
  }
}

/**
 * POST finalize-evidence: after the browser has uploaded to a signed URL, re-read the file here and decide. We never trust
 * the filename, the declared type or the browser. Magic bytes decide the type; the original is stored untouched with its
 * SHA-256; a metadata-stripped copy is what admins view (manual 5.6).
 */
export async function handleFinalizeEvidence(req: Request, deps: Deps): Promise<Response> {
  const early = gate(req, deps);
  if (early) return early;
  const { db, storage } = deps;
  let incomingPath: string | null = null;
  let uploadId: string | null = null;
  const written: string[] = [];
  try {
    const parsed = finalizeSchema.safeParse(await readJson(req));
    if (!parsed.success) return fail(req, deps, 'invalid');
    const d = parsed.data;
    const ip = await ipKey(req, deps);
    if (!(await hit(db, 'other:ip', ip, (await setting(db, 'rate_ip_other_per_hour')) * 4, 3600)))
      return fail(req, deps, 'rate_limited');
    const codeHash = await lookup(deps, d.tracking_code);

    const rows = await db.query<{
      id: string;
      submission_id: string;
      incoming_path: string;
      declared_mime: string;
    }>(
      `select u.id, u.submission_id, u.incoming_path, u.declared_mime
         from public.evidence_uploads u
         join public.submissions s on s.id = u.submission_id
         join public.reporter_contacts rc on rc.submission_id = s.id
        where rc.tracking_code_hash = decode($1, 'hex') and u.id = $2::uuid and u.status = 'issued'
          and u.expires_at > now() and s.state not in ('withdrawn', 'rejected')`,
      [codeHash, d.upload_id],
    );
    const u = rows[0];
    if (!u) return fail(req, deps, 'rejected');
    incomingPath = u.incoming_path;
    uploadId = u.id;

    const bytes = await storage.download('evidence-incoming', u.incoming_path);
    if (!bytes || bytes.length === 0 || bytes.length > LIMITS.maxFileBytes) throw new Error('size');
    const mime = sniffMime(bytes);
    if (!mime || mime !== u.declared_mime) throw new Error('type');

    const preview = stripMetadata(bytes, mime);
    const sha = await sha256Hex(bytes);
    const name = `${u.submission_id}/${u.id}.${EXTENSION[mime]}`;
    await storage.upload('evidence-original', name, bytes, mime);
    written.push('evidence-original');
    await storage.upload('evidence-preview', name, preview, mime);
    written.push('evidence-preview');

    await db.tx(async (tx) => {
      await tx.query(
        `insert into public.evidence_items (submission_id, storage_path, sha256, size_bytes, mime, derived_path)
         values ($1::uuid, $2, $3, $4, $5, $2)`,
        [u.submission_id, name, sha, bytes.length, mime],
      );
      await tx.query("update public.evidence_uploads set status = 'finalized' where id = $1::uuid", [u.id]);
    });
    await storage.remove('evidence-incoming', [u.incoming_path]);
    return reply(req, deps, 200, { ok: true });
  } catch (e) {
    logError('finalize-evidence', e);
    // Leave nothing behind: a rejected upload is deleted, wherever it got to.
    try {
      if (incomingPath) await storage.remove('evidence-incoming', [incomingPath]);
      if (uploadId) {
        await db.query(
          "update public.evidence_uploads set status = 'rejected' where id = $1::uuid and status = 'issued'",
          [uploadId],
        );
        const name = incomingPath?.split('/')[0];
        for (const bucket of written)
          await storage.remove(bucket, [
            `${name}/${uploadId}.png`,
            `${name}/${uploadId}.jpg`,
            `${name}/${uploadId}.webp`,
          ]);
      }
    } catch (cleanup) {
      logError('finalize-evidence-cleanup', cleanup);
    }
    return fail(req, deps, 'rejected');
  }
}
