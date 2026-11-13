import { useEffect, useState } from 'react';
import { ApiError } from './api';

export type Async<T> = { state: 'loading' } | { state: 'ready'; data: T } | { state: 'error'; code: string };

/** Runs `load` whenever its identity changes (wrap it in useCallback). Aborts the request on change or unmount. */
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>) {
  const [result, setResult] = useState<Async<T>>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    setResult({ state: 'loading' });
    load(ctrl.signal)
      .then((data) => {
        if (!ctrl.signal.aborted) setResult({ state: 'ready', data });
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return;
        setResult({ state: 'error', code: e instanceof ApiError ? e.code : 'unknown' });
      });
    return () => ctrl.abort();
  }, [load, attempt]);

  return [result, () => setAttempt((n) => n + 1)] as const;
}
