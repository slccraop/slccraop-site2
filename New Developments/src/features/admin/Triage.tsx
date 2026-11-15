/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { day, useDo, useLoad } from './useLoad';

const STATES = ['', 'new', 'unverified', 'verified', 'duplicate_review', 'accepted', 'rejected', 'withdrawn'];

function Submission({ id, onBack }: { id: string; onBack: () => void }) {
  const { data, error, reload } = useLoad('get_submission', { id });
  const { run, error: actError, busy } = useDo(reload);
  const [phone, setPhone] = useState('');
  const [outcome, setOutcome] = useState('reached_verified');
  const [note, setNote] = useState('');
  const [views, setViews] = useState<Record<string, { url: string; clear: boolean }>>({});
  const [msg, setMsg] = useState('');
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!data) return <p role="status">Loading…</p>;
  const s = data.submission;
  const a = s.answers ?? {};

  async function reveal(evidenceId: string) {
    const r = await run<{ url: string }>('evidence_view', { evidence_id: evidenceId });
    if (r) setViews((v) => ({ ...v, [evidenceId]: { url: r.url, clear: false } }));
  }
  async function quarantine(evidenceId: string) {
    if (
      !window.confirm(
        'Quarantine this item as a child-safety concern? Nobody can open it again. Then follow the runbook and tell the owner now.',
      )
    )
      return;
    const r = await run<{ next: string }>('quarantine_evidence', { evidence_id: evidenceId });
    if (r) setMsg(r.next);
  }
  return (
    <div className="prose">
      <button type="button" className="linklike" onClick={onBack}>
        ← All reports
      </button>
      <h2>Report {String(s.id).slice(0, 8)}</h2>
      {msg && (
        <p className="callout" role="alert">
          {msg}
        </p>
      )}
      <dl className="facts">
        <dt>Received</dt>
        <dd>{day(s.created_at)}</dd>
        <dt>State</dt>
        <dd>
          {s.state}
          {s.case_ref ? ` (case ${s.case_ref})` : ''}
        </dd>
        <dt>Kind</dt>
        <dd>{s.category}</dd>
        <dt>Platform</dt>
        <dd>{s.platform}</dd>
        <dt>Reporter</dt>
        <dd>
          {s.reporter_role}, language {s.language}
        </dd>
        <dt>Dates</dt>
        <dd>{[a.date_from, a.date_to].filter(Boolean).join(' to ') || '—'}</dd>
        <dt>Links</dt>
        <dd>{(a.links ?? []).join(', ') || '—'}</dd>
        <dt>Accounts</dt>
        <dd>{(a.usernames ?? []).join(', ') || '—'}</dd>
        <dt>Reported to platform</dt>
        <dd>{a.reported_to_platform ? `Yes ${a.platform_reference ?? ''}` : 'No'}</dd>
        <dt>Reported to police</dt>
        <dd>{a.reported_to_police ? `Yes ${a.police_reference ?? ''}` : 'No'}</dd>
        <dt>Evidence notes</dt>
        <dd>{a.evidence_summary || '—'}</dd>
        <dt>Media links</dt>
        <dd>{(a.external_media_links ?? []).join(', ') || '—'}</dd>
        <dt>What happened</dt>
        <dd>{s.description}</dd>
      </dl>

      <h3>Contact</h3>
      {phone ? (
        <p>
          <strong>{phone}</strong> (viewing is recorded in the audit log)
        </p>
      ) : (
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={async () => {
            const r = await run<{ phone: string }>('reveal_contact', { submission_id: id });
            if (r) setPhone(r.phone);
          }}
        >
          Show phone number
        </button>
      )}

      <h3>Call-back log</h3>
      <ul>
        {data.calls.map((c: any) => (
          <li key={c.id}>
            {day(c.occurred_at)}: {c.outcome.replaceAll('_', ' ')}
            {c.note ? `, ${c.note}` : ''}
          </li>
        ))}
      </ul>
      {!['accepted', 'rejected', 'withdrawn'].includes(s.state) && (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run('log_call', { submission_id: id, outcome, note: note || undefined })) setNote('');
          }}
        >
          <div>
            <label htmlFor="co">Outcome of the call</label>
            <select id="co" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
              <option value="reached_verified">Reached and confirmed</option>
              <option value="no_answer">No answer</option>
              <option value="wrong_number">Wrong number</option>
              <option value="declined">Declined to continue</option>
            </select>
          </div>
          <div>
            <label htmlFor="cn">Note (optional, no personal details)</label>
            <input
              id="cn"
              type="text"
              value={note}
              maxLength={500}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <button type="submit" className="btn primary" disabled={busy}>
            Log call
          </button>
        </form>
      )}

      {data.flags.length > 0 && <h3>Possible duplicates</h3>}
      {data.flags.map((f: any) => (
        <p key={f.id} className="callout">
          Matches report {String(f.matched_id).slice(0, 8)} ({f.matched_state}
          {f.matched_case_ref ? `, case ${f.matched_case_ref}` : ''}).{' '}
          {f.resolution ? (
            `Resolved: ${f.resolution}.`
          ) : (
            <>
              <button
                type="button"
                className="linklike"
                disabled={busy}
                onClick={() => void run('resolve_duplicate', { flag_id: f.id, resolution: 'merged' })}
              >
                Merge into that case
              </button>
              {' · '}
              <button
                type="button"
                className="linklike"
                disabled={busy}
                onClick={() => void run('resolve_duplicate', { flag_id: f.id, resolution: 'separate' })}
              >
                Keep separate
              </button>
            </>
          )}
        </p>
      ))}

      <h3>Screenshots ({data.evidence.length})</h3>
      <p className="hint">Shown blurred, with metadata removed. Each time you open one, it is recorded.</p>
      <ul>
        {data.evidence.map((e: any) => (
          <li key={e.id}>
            {e.mime}, {Math.round(e.size_bytes / 1024)} KB{' '}
            {!views[e.id] ? (
              <button type="button" className="linklike" disabled={busy} onClick={() => void reveal(e.id)}>
                Open (blurred)
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="linklike"
                  onClick={() =>
                    setViews((v) => ({
                      ...v,
                      [e.id]: {
                        ...(v[e.id] as { url: string; clear: boolean }),
                        clear: !(v[e.id] as { clear: boolean }).clear,
                      },
                    }))
                  }
                >
                  {views[e.id]?.clear ? 'Blur again' : 'Unblur'}
                </button>
                {' · '}
                <button type="button" className="linklike" onClick={() => void quarantine(e.id)}>
                  Quarantine (child-safety concern)
                </button>
                <br />
                <img
                  className={views[e.id]?.clear ? 'evidence' : 'evidence blurred'}
                  src={views[e.id]?.url}
                  alt="Evidence preview"
                  width={320}
                />
              </>
            )}
          </li>
        ))}
      </ul>

      <h3>Decision</h3>
      <div className="actions">
        {s.state === 'verified' && (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void run('accept_submission', { id })}
          >
            Accept and create case
          </button>
        )}
        {!['accepted', 'withdrawn', 'rejected'].includes(s.state) && (
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => {
              if (window.confirm('Reject this report?')) void run('reject_submission', { id });
            }}
          >
            Reject
          </button>
        )}
        <button
          type="button"
          className="btn secondary"
          disabled={busy}
          onClick={() => {
            if (window.confirm("Block this reporter's phone number from submitting again?"))
              void run('block_reporter', { submission_id: id });
          }}
        >
          Block phone number
        </button>
      </div>
      {actError && (
        <p className="error" role="alert">
          {actError}
        </p>
      )}
    </div>
  );
}

export function Triage() {
  const [state, setState] = useState('new');
  const [open, setOpen] = useState<string | null>(null);
  const { data, error } = useLoad('list_submissions', { state: state || undefined });
  if (open) return <Submission id={open} onBack={() => setOpen(null)} />;
  return (
    <>
      <div className="form">
        <div>
          <label htmlFor="st">Show</label>
          <select id="st" value={state} onChange={(e) => setState(e.target.value)}>
            {STATES.map((x) => (
              <option key={x} value={x}>
                {x || 'all'}
              </option>
            ))}
          </select>
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <table>
        <caption className="sr">Reports</caption>
        <thead>
          <tr>
            <th>Report</th>
            <th>Received</th>
            <th>Kind</th>
            <th>State</th>
            <th>Evidence</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((r: any) => (
            <tr key={r.id}>
              <td data-label="Report">
                <button type="button" className="linklike" onClick={() => setOpen(r.id)}>
                  {String(r.id).slice(0, 8)}
                </button>
              </td>
              <td data-label="Received">{day(r.created_at)}</td>
              <td data-label="Kind">
                {r.category}, {r.platform}
              </td>
              <td data-label="State">
                {r.state}
                {r.open_flags > 0 ? ' (possible duplicate)' : ''}
              </td>
              <td data-label="Evidence">{r.evidence}</td>
            </tr>
          ))}
          {data && data.length === 0 && (
            <tr className="status-row">
              <td colSpan={5}>Nothing here.</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
