import { useCallback, useEffect, useState } from 'react';
import { errText, useAdmin } from './AdminApp';

export function useLoad<T = any>(action: string, payload: Record<string, unknown> = {}) {
  const { call } = useAdmin();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const key = JSON.stringify(payload);
  const [n, setN] = useState(0);
  useEffect(() => {
    let live = true;
    setError('');
    call<T>(action, JSON.parse(key) as Record<string, unknown>)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e: unknown) => {
        if (live) setError(errText(e));
      });
    return () => {
      live = false;
    };
  }, [call, action, key, n]);
  return { data, error, reload: useCallback(() => setN((x) => x + 1), []) };
}

export function useDo(reload: () => void) {
  const { call } = useAdmin();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <T>(action: string, payload: Record<string, unknown> = {}): Promise<T | null> => {
      setBusy(true);
      setError('');
      try {
        const r = await call<T>(action, payload);
        reload();
        return r;
      } catch (e) {
        setError(errText(e));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [call, reload],
  );
  return { run, error, busy, setError };
}

export const localToIso = (v: string): string => new Date(v).toISOString();
export const nowLocal = (): string => {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
export const day = (iso: string | null | undefined): string => (iso ? iso.slice(0, 10) : '—');
