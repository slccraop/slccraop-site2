/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { day, useDo, useLoad } from './useLoad';

export function AuditLog() {
  const [before, setBefore] = useState<number | undefined>(undefined);
  const { data, error } = useLoad('list_audit', { before_id: before });
  return (
    <>
      <p className="hint">Every staff action, newest first. Nothing here can be edited or deleted.</p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <table>
        <caption className="sr">Audit log</caption>
        <thead>
          <tr>
            <th>When</th>
            <th>Who</th>
            <th>Action</th>
            <th>Target</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((r: any) => (
            <tr key={r.id}>
              <td data-label="When">{r.occurred_at.replace('T', ' ').slice(0, 19)}</td>
              <td data-label="Who">{String(r.actor ?? '').slice(0, 8)}</td>
              <td data-label="Action">{r.action}</td>
              <td data-label="Target">{r.target ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data && data.length === 100 && (
        <button type="button" className="linklike" onClick={() => setBefore(data[data.length - 1].id)}>
          Older entries
        </button>
      )}
    </>
  );
}

export function StaffTab() {
  const { data, error, reload } = useLoad('list_staff');
  const { run, error: actError, busy } = useDo(reload);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('admin');
  return (
    <>
      <p className="hint">
        Invited people get an email to set a password, then must set up their authenticator app. Inviting or
        removing needs a fresh code.
      </p>
      {(error || actError) && (
        <p className="error" role="alert">
          {error || actError}
        </p>
      )}
      <table>
        <caption className="sr">Staff</caption>
        <thead>
          <tr>
            <th>Email</th>
            <th>Role</th>
            <th>Since</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((s: any) => (
            <tr key={s.user_id}>
              <td data-label="Email">{s.email}</td>
              <td data-label="Role">{s.role}</td>
              <td data-label="Since">{day(s.created_at)}</td>
              <td data-label="Action">
                <button
                  type="button"
                  className="linklike"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Remove ${s.email}?`))
                      void run('remove_staff', { user_id: s.user_id });
                  }}
                >
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run('invite_staff', { email, role })) setEmail('');
        }}
      >
        <h2>Invite someone</h2>
        <div>
          <label htmlFor="ie">Email</label>
          <input
            id="ie"
            type="text"
            value={email}
            maxLength={200}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="ir">Role</label>
          <select id="ir" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
          </select>
        </div>
        <button type="submit" className="btn primary" disabled={busy || !email}>
          Send invitation
        </button>
      </form>
    </>
  );
}

export function SettingsTab() {
  const { data, error, reload } = useLoad('get_settings');
  const { run, error: actError, busy } = useDo(reload);
  const [edit, setEdit] = useState<Record<string, string>>({});
  return (
    <>
      <p className="hint">
        Tunable numbers. Changing one needs a fresh code and is recorded in the audit log. Retention periods
        need legal advice before launch.
      </p>
      {(error || actError) && (
        <p className="error" role="alert">
          {error || actError}
        </p>
      )}
      <table>
        <caption className="sr">Settings</caption>
        <thead>
          <tr>
            <th>Setting</th>
            <th>Value</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((s: any) => {
            const shown = edit[s.key] ?? JSON.stringify(s.value);
            const parse = () => {
              try {
                return JSON.parse(shown) as unknown;
              } catch {
                return undefined;
              }
            };
            return (
              <tr key={s.key}>
                <td data-label="Setting">{s.key.replaceAll('_', ' ')}</td>
                <td data-label="Value">
                  <input
                    type="text"
                    aria-label={s.key}
                    value={shown}
                    onChange={(e) => setEdit((x) => ({ ...x, [s.key]: e.target.value }))}
                  />
                </td>
                <td data-label="Action">
                  <button
                    type="button"
                    className="linklike"
                    disabled={busy || parse() === undefined || shown === JSON.stringify(s.value)}
                    onClick={() => void run('set_setting', { key: s.key, value: parse() })}
                  >
                    Save
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
