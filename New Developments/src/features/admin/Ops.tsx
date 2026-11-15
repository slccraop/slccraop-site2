/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { day, useDo, useLoad } from './useLoad';

export function FollowUps() {
  const { data, error, reload } = useLoad('list_followups');
  const { run, error: actError, busy } = useDo(reload);
  const [copied, setCopied] = useState('');
  return (
    <>
      <p className="hint">
        Cases where an authority has been silent past a follow-up date (14, 30 and 60 days by default). The
        drafts contain no personal details.
      </p>
      {(error || actError) && (
        <p className="error" role="alert">
          {error || actError}
        </p>
      )}
      {data && data.length === 0 && <p>Nothing is overdue.</p>}
      {(data ?? []).map((f: any) => (
        <div className="callout" key={f.case_ref}>
          <p>
            <strong>{f.case_ref}</strong>, {f.authority}: {f.days_since} days without news (reminder level{' '}
            {f.level})
          </p>
          <textarea readOnly value={f.email_draft} rows={9} aria-label={`Draft for ${f.case_ref}`} />
          <div className="actions">
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(f.email_draft).then(() => setCopied(f.case_ref));
              }}
            >
              {copied === f.case_ref ? 'Copied' : 'Copy draft'}
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void run('log_follow_up', { case_ref: f.case_ref })}
            >
              I sent it
            </button>
          </div>
        </div>
      ))}
    </>
  );
}

export function Corrections() {
  const { data, error, reload } = useLoad('list_corrections');
  const { run, error: actError, busy } = useDo(reload);
  return (
    <>
      {(error || actError) && (
        <p className="error" role="alert">
          {error || actError}
        </p>
      )}
      <table>
        <caption className="sr">Correction and removal requests</caption>
        <thead>
          <tr>
            <th>Case</th>
            <th>Request</th>
            <th>Details</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((c: any) => (
            <tr key={c.id}>
              <td data-label="Case" className="id">
                {c.case_id}
              </td>
              <td data-label="Request">
                {c.request_type}, {day(c.created_at)}
              </td>
              <td data-label="Details">
                {c.details}
                {c.contact ? ` (contact: ${c.contact})` : ''}
              </td>
              <td data-label="State">
                {c.state === 'new' ? (
                  <button
                    type="button"
                    className="linklike"
                    disabled={busy}
                    onClick={() => void run('handle_correction', { id: c.id })}
                  >
                    Mark handled
                  </button>
                ) : (
                  'handled'
                )}
              </td>
            </tr>
          ))}
          {data && data.length === 0 && (
            <tr className="status-row">
              <td colSpan={4}>No requests.</td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="hint">To remove a row, open the case and use Unpublish.</p>
    </>
  );
}

export function Archive() {
  const { data, error, reload } = useLoad('list_archive');
  const { run, error: actError, busy } = useDo(reload);
  const [url, setUrl] = useState('');
  const [snap, setSnap] = useState<Record<number, string>>({});
  return (
    <>
      <p className="hint">
        Public pages only. Member lists, friends, photos and videos are refused. A second staff member
        approves each request; the snapshot link is recorded here after you capture it.
      </p>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run('archive_add', { url })) setUrl('');
        }}
      >
        <div>
          <label htmlFor="au">Page address (https)</label>
          <input id="au" type="text" value={url} maxLength={2000} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <button type="submit" className="btn primary" disabled={busy || !url}>
          Add to queue
        </button>
      </form>
      {(error || actError) && (
        <p className="error" role="alert">
          {error || actError}
        </p>
      )}
      <table>
        <caption className="sr">Archive queue</caption>
        <thead>
          <tr>
            <th>Address</th>
            <th>Status</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((a: any) => (
            <tr key={a.id}>
              <td data-label="Address">{a.url}</td>
              <td data-label="Status">
                {a.status}
                {a.snapshot_url ? `: ${a.snapshot_url}` : ''}
              </td>
              <td data-label="Action">
                {a.status === 'pending' && (
                  <>
                    <button
                      type="button"
                      className="linklike"
                      disabled={busy}
                      onClick={() => void run('archive_decide', { id: a.id, approve: true })}
                    >
                      Approve
                    </button>
                    {' · '}
                    <button
                      type="button"
                      className="linklike"
                      disabled={busy}
                      onClick={() => void run('archive_decide', { id: a.id, approve: false })}
                    >
                      Reject
                    </button>
                  </>
                )}
                {a.status === 'approved' && (
                  <span className="row">
                    <input
                      type="text"
                      aria-label="Snapshot link"
                      placeholder="Snapshot link"
                      value={snap[a.id] ?? ''}
                      onChange={(e) => setSnap((s) => ({ ...s, [a.id]: e.target.value }))}
                    />
                    <button
                      type="button"
                      className="linklike"
                      disabled={busy || !snap[a.id]}
                      onClick={() => void run('archive_record', { id: a.id, snapshot_url: snap[a.id] })}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="linklike"
                      disabled={busy}
                      onClick={() =>
                        void run('archive_record', { id: a.id, failure_reason: 'Capture failed' })
                      }
                    >
                      Failed
                    </button>
                  </span>
                )}
              </td>
            </tr>
          ))}
          {data && data.length === 0 && (
            <tr className="status-row">
              <td colSpan={3}>The queue is empty.</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}

export function Intake() {
  const { data, error, reload } = useLoad('overview');
  const { run, error: actError, busy } = useDo(reload);
  const [mode, setMode] = useState<string | null>(null);
  const [cap, setCap] = useState<string | null>(null);
  if (!data)
    return error ? (
      <p className="error" role="alert">
        {error}
      </p>
    ) : (
      <p role="status">Loading…</p>
    );
  const i = data.intake;
  return (
    <>
      <dl className="facts">
        <dt>Intake now</dt>
        <dd>
          {i.mode}, {i.today_count} of {i.daily_cap} used today
          {i.limited_by_cap ? ' (limited automatically at the cap)' : ''}
        </dd>
        <dt>Reports by state</dt>
        <dd>
          {Object.entries(data.submissions ?? {})
            .map(([k, v]) => `${k} ${v}`)
            .join(', ') || '—'}
        </dd>
        <dt>Cases by status</dt>
        <dd>
          {Object.entries(data.cases ?? {})
            .map(([k, v]) => `${k.replaceAll('_', ' ')} ${v}`)
            .join(', ') || '—'}
        </dd>
        <dt>Waiting for you</dt>
        <dd>
          {data.corrections_new} corrections, {data.archive_pending} archive requests, {data.drafts_waiting}{' '}
          unapproved ledger drafts
        </dd>
      </dl>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          await run('set_intake', { mode: mode ?? i.mode, daily_cap: Number(cap ?? i.daily_cap) });
          setMode(null);
          setCap(null);
        }}
      >
        <h2>Intake controls</h2>
        <div>
          <label htmlFor="im">Mode</label>
          <select id="im" value={mode ?? i.mode} onChange={(e) => setMode(e.target.value)}>
            <option value="open">Open</option>
            <option value="limited">Limited</option>
            <option value="closed">Closed</option>
          </select>
        </div>
        <div>
          <label htmlFor="ic">Daily cap</label>
          <input
            id="ic"
            type="text"
            inputMode="numeric"
            value={cap ?? String(i.daily_cap)}
            onChange={(e) => setCap(e.target.value)}
          />
        </div>
        <button type="submit" className="btn primary" disabled={busy}>
          Save
        </button>
      </form>
      <h2>Aggregate counters</h2>
      <p className="hint">
        &ldquo;Referred under-18 cases&rdquo; is only a number. No record about any person is ever created.
      </p>
      <div className="actions">
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => void run('adjust_minors', { delta: 1 })}
        >
          Add 1 referral
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => void run('adjust_minors', { delta: -1 })}
        >
          Remove 1
        </button>
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => void run('refresh_stats')}
        >
          Recalculate public ticker
        </button>
      </div>
      {(error || actError) && (
        <p className="error" role="alert">
          {error || actError}
        </p>
      )}
    </>
  );
}
