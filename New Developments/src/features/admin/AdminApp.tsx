import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { env } from '../../config/env';
import {
  AdminCallError,
  adminClient,
  callAdmin,
  finishEnrollment,
  nextStep,
  startEnrollment,
  verifyTotp,
} from './adminClient';
import { Cases } from './Cases';
import { Corrections, FollowUps, Intake, Archive } from './Ops';
import { AuditLog, SettingsTab, StaffTab } from './Owner';
import { Triage } from './Triage';

/* eslint-disable @typescript-eslint/no-explicit-any -- staff screens render our own server's JSON; the server validates every request. */
export interface AdminApi {
  call: <T = any>(action: string, payload?: Record<string, unknown>) => Promise<T>;
  role: 'owner' | 'admin';
  user: string;
}
const Ctx = createContext<AdminApi | null>(null);
export const useAdmin = (): AdminApi => {
  const v = useContext(Ctx);
  if (!v) throw new Error('outside AdminApp');
  return v;
};
export const errText = (e: unknown): string => {
  const code = e instanceof AdminCallError ? e.code : 'server';
  const extra =
    e instanceof AdminCallError && Array.isArray(e.detail.problems)
      ? `: ${(e.detail.problems as string[]).join('; ')}`
      : '';
  return `${code.replaceAll('_', ' ')}${extra}`;
};

const IDLE_MS = 15 * 60 * 1000;
type Phase = 'unconfigured' | 'signin' | 'verify' | 'enroll' | 'ready';

function CodeForm({
  label,
  onSubmit,
  busy,
  error,
}: {
  label: string;
  onSubmit: (code: string) => void;
  busy: boolean;
  error: string;
}) {
  const [code, setCode] = useState('');
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(code);
        setCode('');
      }}
    >
      <div>
        <label htmlFor="totp">{label}</label>
        <input
          id="totp"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          value={code}
          maxLength={8}
          onChange={(e) => setCode(e.target.value)}
        />
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="btn primary" disabled={busy || code.trim().length < 6}>
        Confirm
      </button>
    </form>
  );
}

const TABS = ['Reports', 'Cases', 'Follow-ups', 'Corrections', 'Archive', 'Intake'] as const;
const OWNER_TABS = ['Audit log', 'Staff', 'Settings'] as const;

export function AdminApp() {
  const [phase, setPhase] = useState<Phase>(env.supabaseUrl ? 'signin' : 'unconfigured');
  const [info, setInfo] = useState<{ role: 'owner' | 'admin'; user: string } | null>(null);
  const [tab, setTab] = useState<string>('Reports');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [enroll, setEnroll] = useState<{ factorId: string; secret: string } | null>(null);
  const [reauth, setReauth] = useState<{ resolve: () => void; reject: () => void } | null>(null);

  useEffect(() => {
    document.title = 'SLCCRAOP staff';
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);

  const signOut = useCallback(async () => {
    await adminClient().auth.signOut();
    setInfo(null);
    setPhase('signin');
    setError('');
  }, []);

  // Idle sign-out after 15 minutes without a click or key press.
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (phase !== 'ready') return;
    const bump = () => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void signOut(), IDLE_MS);
    };
    bump();
    const events = ['click', 'keydown', 'pointerdown'] as const;
    events.forEach((e) => window.addEventListener(e, bump));
    return () => {
      window.clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, bump));
    };
  }, [phase, signOut]);

  const enter = useCallback(async () => {
    const step = await nextStep();
    if (step === 'ready') {
      try {
        setInfo(await callAdmin<{ role: 'owner' | 'admin'; user: string }>('overview'));
        setPhase('ready');
      } catch (e) {
        setError(
          e instanceof AdminCallError && e.code === 'forbidden'
            ? 'This account is not on the staff list.'
            : errText(e),
        );
        await adminClient().auth.signOut();
        setPhase('signin');
      }
    } else if (step === 'verify') setPhase('verify');
    else {
      setEnroll(await startEnrollment());
      setPhase('enroll');
    }
  }, []);

  async function signIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    const { error: err } = await adminClient().auth.signInWithPassword({
      email: String(f.get('email')),
      password: String(f.get('password')),
    });
    if (err) setError('Sign-in failed. Check your email and password.');
    else await enter();
    setBusy(false);
  }
  const verify = async (code: string) => {
    setBusy(true);
    setError('');
    try {
      await verifyTotp(code);
      await enter();
    } catch {
      setError('That code did not work. Try the next one from your app.');
    }
    setBusy(false);
  };
  const finish = async (code: string) => {
    if (!enroll) return;
    setBusy(true);
    setError('');
    try {
      await finishEnrollment(enroll.factorId, code);
      await enter();
    } catch {
      setError('That code did not work.');
    }
    setBusy(false);
  };

  // Calls the server; if it asks for a recent sign-in, shows the code box and retries once.
  const call = useCallback(
    async <T,>(action: string, payload: Record<string, unknown> = {}): Promise<T> => {
      try {
        return await callAdmin<T>(action, payload);
      } catch (e) {
        if (e instanceof AdminCallError && e.code === 'reauth_required') {
          await new Promise<void>((resolve, reject) => setReauth({ resolve, reject }));
          return callAdmin<T>(action, payload);
        }
        if (e instanceof AdminCallError && (e.code === 'unauthorized' || e.code === 'mfa_required'))
          void signOut();
        throw e;
      }
    },
    [signOut],
  );
  const api = useMemo<AdminApi | null>(
    () => (info ? { call, role: info.role, user: info.user } : null),
    [call, info],
  );

  if (phase === 'unconfigured')
    return (
      <main className="wrap">
        <h1>Staff area</h1>
        <p className="callout">
          The staff area needs the site to be connected to Supabase (VITE_SUPABASE_URL and
          VITE_SUPABASE_ANON_KEY).
        </p>
      </main>
    );
  if (phase === 'signin') {
    return (
      <main className="wrap">
        <h1>Staff sign-in</h1>
        <form className="form" onSubmit={(e) => void signIn(e)}>
          <div>
            <label htmlFor="em">Email</label>
            <input id="em" name="email" type="text" autoComplete="username" />
          </div>
          <div>
            <label htmlFor="pw">Password</label>
            <input id="pw" name="password" type="password" autoComplete="current-password" />
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" className="btn primary" disabled={busy}>
            Sign in
          </button>
        </form>
      </main>
    );
  }
  if (phase === 'verify')
    return (
      <main className="wrap">
        <h1>Enter your code</h1>
        <CodeForm
          label="6-digit code from your authenticator app"
          onSubmit={(c) => void verify(c)}
          busy={busy}
          error={error}
        />
      </main>
    );
  if (phase === 'enroll' && enroll) {
    return (
      <main className="wrap">
        <h1>Set up your second step</h1>
        <p>
          Staff must use an authenticator app. In the app choose &ldquo;enter a setup key&rdquo; and type this
          key (spaces do not matter), then enter the 6-digit code it shows.
        </p>
        <p className="tracking" aria-label="setup key">
          {enroll.secret}
        </p>
        <CodeForm label="6-digit code" onSubmit={(c) => void finish(c)} busy={busy} error={error} />
      </main>
    );
  }
  if (!api) return null;
  const tabs = api.role === 'owner' ? [...TABS, ...OWNER_TABS] : [...TABS];
  return (
    <Ctx.Provider value={api}>
      <header>
        <div className="wrap">
          <span className="brand">
            SLCCRAOP<small>Staff area, signed in as {api.role}</small>
          </span>
          <nav aria-label="Staff sections">
            {tabs.map((t) => (
              <button
                key={t}
                type="button"
                className="linklike"
                aria-current={tab === t ? 'page' : undefined}
                onClick={() => setTab(t)}
              >
                {t}
              </button>
            ))}
            <button type="button" className="linklike" onClick={() => void signOut()}>
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <main className="wrap">
        <h1>{tab}</h1>
        {tab === 'Reports' && <Triage />}
        {tab === 'Cases' && <Cases />}
        {tab === 'Follow-ups' && <FollowUps />}
        {tab === 'Corrections' && <Corrections />}
        {tab === 'Archive' && <Archive />}
        {tab === 'Intake' && <Intake />}
        {tab === 'Audit log' && <AuditLog />}
        {tab === 'Staff' && <StaffTab />}
        {tab === 'Settings' && <SettingsTab />}
      </main>
      {reauth && (
        <div className="callout" role="alertdialog" aria-label="Confirm it is you">
          <p>
            <strong>Please enter a fresh code to continue.</strong> This action needs a recent sign-in.
          </p>
          <CodeForm
            label="6-digit code"
            busy={busy}
            error={error}
            onSubmit={(c) => {
              setBusy(true);
              verifyTotp(c)
                .then(() => {
                  reauth.resolve();
                  setReauth(null);
                  setError('');
                })
                .catch(() => setError('That code did not work.'))
                .finally(() => setBusy(false));
            }}
          />
          <button
            type="button"
            className="linklike"
            onClick={() => {
              reauth.reject();
              setReauth(null);
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </Ctx.Provider>
  );
}
