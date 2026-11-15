import type { Deps } from './deps.ts';
import { LIMITS } from './contracts.ts';

export type ErrorCode =
  'invalid' | 'bot_check' | 'closed' | 'capped' | 'rate_limited' | 'rejected' | 'server';
const STATUS: Record<ErrorCode, number> = {
  invalid: 400,
  bot_check: 400,
  closed: 503,
  capped: 503,
  rate_limited: 429,
  rejected: 400,
  server: 500,
};

export function corsHeaders(req: Request, deps: Deps): Record<string, string> {
  const origin = req.headers.get('origin');
  const h: Record<string, string> = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-cron-secret',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
  if (origin && deps.env.allowedOrigins.includes(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

export function reply(req: Request, deps: Deps, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...corsHeaders(req, deps) },
  });
}
export const fail = (req: Request, deps: Deps, code: ErrorCode): Response =>
  reply(req, deps, STATUS[code], { ok: false, error: code });

/** Handles preflight and rejects other origins. Returns a Response to send, or null to carry on. */
export function gate(req: Request, deps: Deps): Response | null {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req, deps) });
  if (req.method !== 'POST') return reply(req, deps, 405, { ok: false, error: 'invalid' });
  const origin = req.headers.get('origin');
  if (origin && !deps.env.allowedOrigins.includes(origin))
    return reply(req, deps, 403, { ok: false, error: 'rejected' });
  return null;
}

export function clientIp(req: Request): string {
  const cf = req.headers.get('cf-connecting-ip');
  const xff = req.headers.get('x-forwarded-for');
  return (cf ?? xff?.split(',')[0] ?? 'unknown').trim() || 'unknown';
}

/** Reads a JSON body of at most `max` bytes. Returns undefined when it is missing, too big or not JSON. */
export async function readJson(req: Request, max: number = LIMITS.maxBodyBytes): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > max) return undefined;
  const text = await req.text();
  if (text.length > max) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}
