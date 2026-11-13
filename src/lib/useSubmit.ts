import { useState } from 'react';
import { ApiError } from './api';

export type SubmitState =
  { state: 'idle' } | { state: 'sending' } | { state: 'done' } | { state: 'error'; code: string };

/** Wraps a form submission: idle, sending, done or error. Error codes map to the `formError.*` strings. */
export function useSubmit() {
  const [status, setStatus] = useState<SubmitState>({ state: 'idle' });
  async function run(action: () => Promise<void>): Promise<void> {
    setStatus({ state: 'sending' });
    try {
      await action();
      setStatus({ state: 'done' });
    } catch (e) {
      setStatus({ state: 'error', code: e instanceof ApiError ? e.code : 'unknown' });
    }
  }
  return {
    status,
    run,
    finish: () => setStatus({ state: 'done' }),
    fail: (code: string) => setStatus({ state: 'error', code }),
    reset: () => setStatus({ state: 'idle' }),
  };
}
