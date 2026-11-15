import type { Db, Deps } from './deps.ts';
import { hmacHex } from './crypto.ts';
import { clientIp } from './http.ts';

const NUMBER_DEFAULTS: Record<string, number> = {
  rate_ip_submit_per_hour: 5,
  rate_phone_submit_per_day: 3,
  rate_ip_other_per_hour: 30,
  rate_code_per_day: 30,
  upload_ttl_minutes: 60,
  retention_withdrawn_days: 30,
  no_response_days: 45,
};
export async function setting(db: Db, key: string): Promise<number> {
  const rows = await db.query<{ v: string }>(
    'select value::text as v from public.app_settings where key = $1',
    [key],
  );
  const n = Number(rows[0]?.v);
  return Number.isFinite(n) ? n : (NUMBER_DEFAULTS[key] as number);
}

/** Hashed network identity of the caller. The raw address is never stored. */
export async function ipKey(req: Request, deps: Deps): Promise<string> {
  return hmacHex(deps.env.pepper, 'ip:' + clientIp(req));
}

export async function isBlocked(db: Db, kind: 'ip' | 'phone', keyHex: string): Promise<boolean> {
  const r = await db.query(
    "select 1 from public.block_list where kind = $1 and value_hmac = decode($2, 'hex')",
    [kind, keyHex],
  );
  return r.length > 0;
}

/** Counts earlier hits in the window, then records this one (even when refused, so hammering keeps you blocked). */
export async function hit(
  db: Db,
  bucket: string,
  keyHex: string,
  max: number,
  windowSeconds: number,
): Promise<boolean> {
  const r = await db.query<{ n: number }>(
    "select count(*)::int as n from public.rate_limits where bucket = $1 and key_hmac = decode($2, 'hex') and occurred_at > now() - make_interval(secs => $3::double precision)",
    [bucket, keyHex, windowSeconds],
  );
  await db.query("insert into public.rate_limits (bucket, key_hmac) values ($1, decode($2, 'hex'))", [
    bucket,
    keyHex,
  ]);
  return (r[0]?.n ?? 0) < max;
}

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
/** Cloudflare Turnstile. Fails closed: no secret, a network error or a bad token all mean "not verified". */
export async function turnstileOk(deps: Deps, token: string, req: Request): Promise<boolean> {
  if (!deps.env.turnstileSecret) return false;
  const body = new URLSearchParams({ secret: deps.env.turnstileSecret, response: token });
  const ip = clientIp(req);
  if (ip !== 'unknown') body.set('remoteip', ip);
  try {
    const res = await deps.fetch(SITEVERIFY, { method: 'POST', body });
    const json = (await res.json()) as { success?: boolean };
    return json.success === true;
  } catch {
    return false;
  }
}

/** Logs an error class only. Never the request, the message text or anything personal (manual 5.11). */
export function logError(where: string, e: unknown): void {
  console.error(where, e instanceof Error ? e.name : 'error');
}
