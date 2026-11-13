// The only file that talks to Supabase. Reads use the public anon key and the four public tables only (manual 5.4).
// Writes go to Edge Functions (manual 5.5). No response is trusted until it passes its zod schema.
import { z } from 'zod';
import { env } from '../config/env';
import { buildLedgerParams, type LedgerQuery } from './ledgerQuery';
import {
  CASE_ID_RE,
  LEDGER_COLUMNS,
  STATS_COLUMNS,
  authoritySchema,
  intakeSchema,
  ledgerRowSchema,
  statsSchema,
  type IntakeMode,
  type LedgerRow,
  type PublicStats,
} from './schemas';

export type ApiErrorCode = 'not_configured' | 'network' | 'bad_response' | 'rate_limited' | 'rejected';
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  constructor(code: ApiErrorCode) {
    super(code);
    this.code = code;
  }
}

const TIMEOUT_MS = 10_000;

/** Sample data exists only in the dev server and the sample preview. In production this returns null and the import is removed from the bundle. */
async function devSource() {
  if ((import.meta.env.DEV || import.meta.env.MODE === 'sample') && !env.supabaseUrl)
    return import('../dev/fakeData');
  return null;
}

async function request(
  path: string,
  method: 'GET' | 'POST',
  extra: Record<string, string>,
  body: string | undefined,
  signal?: AbortSignal,
): Promise<Response> {
  if (!env.supabaseUrl || !env.anonKey) throw new ApiError('not_configured');
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(env.supabaseUrl + path, {
      method,
      body,
      signal: ctrl.signal,
      headers: { apikey: env.anonKey, Authorization: `Bearer ${env.anonKey}`, ...extra },
    });
  } catch {
    throw new ApiError('network');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function restGet<S extends z.ZodTypeAny>(
  table: string,
  params: URLSearchParams,
  schema: S,
  signal?: AbortSignal,
  wantCount = false,
): Promise<{ rows: z.output<S>[]; total: number }> {
  const res = await request(
    `/rest/v1/${table}?${params.toString()}`,
    'GET',
    wantCount ? { Prefer: 'count=exact' } : {},
    undefined,
    signal,
  );
  if (!res.ok) throw new ApiError('network');
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError('bad_response');
  }
  const parsed = z.array(schema).safeParse(json);
  if (!parsed.success) throw new ApiError('bad_response');
  const range = res.headers.get('content-range');
  const total = range ? Number(range.split('/')[1]) : parsed.data.length;
  return { rows: parsed.data, total: Number.isFinite(total) ? total : parsed.data.length };
}

export async function fetchLedger(
  q: LedgerQuery,
  signal?: AbortSignal,
): Promise<{ rows: LedgerRow[]; total: number }> {
  const dev = await devSource();
  if (dev) return dev.fakeLedger(q);
  return restGet('public_ledger', buildLedgerParams(q), ledgerRowSchema, signal, true);
}

export async function fetchCase(caseId: string, signal?: AbortSignal): Promise<LedgerRow | null> {
  if (!CASE_ID_RE.test(caseId)) return null;
  const dev = await devSource();
  if (dev) return dev.fakeCase(caseId);
  const p = new URLSearchParams({ select: LEDGER_COLUMNS, case_id: `eq.${caseId}`, limit: '1' });
  return (await restGet('public_ledger', p, ledgerRowSchema, signal)).rows[0] ?? null;
}

export async function fetchStats(signal?: AbortSignal): Promise<PublicStats | null> {
  const dev = await devSource();
  if (dev) return dev.fakeStats();
  const p = new URLSearchParams({ select: STATS_COLUMNS, limit: '1' });
  return (await restGet('public_stats', p, statsSchema, signal)).rows[0] ?? null;
}

export async function fetchIntake(signal?: AbortSignal): Promise<IntakeMode | null> {
  const dev = await devSource();
  if (dev) return dev.fakeIntake();
  const p = new URLSearchParams({ select: 'mode', limit: '1' });
  return (await restGet('intake_state', p, intakeSchema, signal)).rows[0]?.mode ?? null;
}

export async function fetchAuthorities(signal?: AbortSignal): Promise<string[]> {
  const dev = await devSource();
  if (dev) return dev.fakeAuthorities();
  const p = new URLSearchParams({ select: 'public_label', order: 'public_label.asc' });
  return (await restGet('authorities', p, authoritySchema, signal)).rows.map((r) => r.public_label);
}

export type FunctionName = 'withdraw-report' | 'submit-correction';

/** Calls a public Edge Function. The reply body is never read: the site must not learn anything beyond accepted or refused. */
export async function callFunction(
  name: FunctionName,
  body: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<void> {
  const res = await request(
    `/functions/v1/${name}`,
    'POST',
    { 'Content-Type': 'application/json' },
    JSON.stringify(body),
    signal,
  );
  if (res.status === 429) throw new ApiError('rate_limited');
  if (!res.ok) throw new ApiError('rejected');
}
