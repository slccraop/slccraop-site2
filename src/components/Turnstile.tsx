import { useEffect, useRef } from 'react';
import { env, isFakeData } from '../config/env';
import { Marked } from './Marked';

interface TurnstileApi {
  render(el: HTMLElement, options: Record<string, unknown>): string;
  remove(id: string): void;
}
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('turnstile'));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export function Turnstile({ onToken, resetKey = 0 }: { onToken: (token: string) => void; resetKey?: number; }) {
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef(onToken);
  latest.current = onToken;

  useEffect(() => {
    if (isFakeData) {
      latest.current('sample-token');
      return;
    }
    if (!env.turnstileSiteKey) {
      latest.current('');
      return;
    }
    let id: string | undefined;
    let cancelled = false;
    loadScript()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return;
        id = window.turnstile.render(box.current, {
          sitekey: env.turnstileSiteKey,
          theme: 'auto',
          callback: (t: string) => latest.current(t),
          'expired-callback': () => latest.current(''),
          'error-callback': () => latest.current(''),
        });
      })
      .catch(() => latest.current(''));
    return () => {
      cancelled = true;
      if (id && window.turnstile) window.turnstile.remove(id);
      latest.current('');
    };
  }, [resetKey]);

  if (isFakeData) return <p className="hint">Sample preview: the bot check is skipped.</p>;
  if (!env.turnstileSiteKey) return <p className="error" role="alert"><Marked text="[VERIFY: set VITE_TURNSTILE_SITE_KEY so the bot check can load]" /></p>;
  return <div ref={box} />;
}
