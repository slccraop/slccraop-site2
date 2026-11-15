// The staff area talks to ONE Edge Function, `admin`, using the signed-in user's token. The browser holds no staff powers
// of its own: even if this file were altered, the server re-checks the token, the second factor and the staff table.
import { FunctionsHttpError, createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../../config/env';

let client: SupabaseClient | null = null;
/** Created on first use. persistSession is off on purpose: closing or reloading the tab signs staff out. */
export function adminClient(): SupabaseClient {
  client ??= createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}

export class AdminCallError extends Error {
  constructor(
    public readonly code: string,
    public readonly detail: Record<string, unknown> = {},
  ) {
    super(code);
  }
}

export async function callAdmin<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await adminClient().functions.invoke('admin', { body: { action, ...payload } });
  if (error) {
    let detail: Record<string, unknown> = {};
    if (error instanceof FunctionsHttpError) {
      try {
        detail = (await error.context.json()) as Record<string, unknown>;
      } catch {
        detail = {};
      }
    }
    throw new AdminCallError(String(detail.error ?? 'server'), detail);
  }
  const body = data as { ok?: boolean; data?: T; error?: string } | null;
  if (!body?.ok) throw new AdminCallError(body?.error ?? 'server');
  return body.data as T;
}

/** Proves the second factor with a fresh code. Used at sign-in and again before dangerous actions. */
export async function verifyTotp(code: string): Promise<void> {
  const c = adminClient();
  const { data: factors, error } = await c.auth.mfa.listFactors();
  const factor = factors?.totp?.[0];
  if (error || !factor) throw new AdminCallError('no_factor');
  const ch = await c.auth.mfa.challenge({ factorId: factor.id });
  if (ch.error) throw new AdminCallError('challenge_failed');
  const v = await c.auth.mfa.verify({ factorId: factor.id, challengeId: ch.data.id, code: code.trim() });
  if (v.error) throw new AdminCallError('bad_code');
}

export async function nextStep(): Promise<'ready' | 'verify' | 'enroll'> {
  const { data } = await adminClient().auth.mfa.getAuthenticatorAssuranceLevel();
  if (data?.currentLevel === 'aal2') return 'ready';
  return data?.nextLevel === 'aal2' ? 'verify' : 'enroll';
}

export async function startEnrollment(): Promise<{ factorId: string; secret: string }> {
  const c = adminClient();
  const { data: all } = await c.auth.mfa.listFactors();
  for (const f of all?.all ?? [])
    if (f.status === 'unverified') await c.auth.mfa.unenroll({ factorId: f.id }); // clear an abandoned attempt
  const { data, error } = await c.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'SLCCRAOP staff' });
  if (error || !data) throw new AdminCallError('enroll_failed');
  return { factorId: data.id, secret: data.totp.secret };
}
export async function finishEnrollment(factorId: string, code: string): Promise<void> {
  const c = adminClient();
  const ch = await c.auth.mfa.challenge({ factorId });
  if (ch.error) throw new AdminCallError('challenge_failed');
  const v = await c.auth.mfa.verify({ factorId, challengeId: ch.data.id, code: code.trim() });
  if (v.error) throw new AdminCallError('bad_code');
}
