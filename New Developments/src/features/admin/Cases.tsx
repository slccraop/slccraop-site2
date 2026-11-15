/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import { lintPublicText } from '../../../supabase/functions/_shared/lint.ts';
import { day, localToIso, nowLocal, useDo, useLoad } from './useLoad';

const STATUSES = [
  '',
  'submitted',
  'acknowledged',
  'under_investigation',
  'info_requested',
  'resubmission_requested',
  'no_response',
  'closed_resolved',
  'closed_unresolved',
];
const REPLIES = [
  'acknowledgement_received',
  'information_requested',
  'referred_to_other_unit',
  'action_in_progress',
  'closed_by_authority',
];
const REASONS = [
  'insufficient_evidence',
  'suspect_not_identified',
  'outside_mandate',
  'jurisdiction',
  'complainant_withdrew',
  'duplicate_merged',
  'other_documented',
];
const words = (s: string) => s.replaceAll('_', ' ');

function CaseView({ caseRef, onBack }: { caseRef: string; onBack: () => void }) {
  const { data, error, reload } = useLoad('get_case', { case_ref: caseRef });
  const auths = useLoad('list_authorities');
  const { run, error: actError, busy } = useDo(reload);
  const [authority, setAuthority] = useState('');
  const [authorityRef, setAuthorityRef] = useState('');
  const [when, setWhen] = useState(nowLocal());
  const [reply, setReply] = useState('acknowledgement_received');
  const [outcome, setOutcome] = useState('resolved');
  const [reason, setReason] = useState('suspect_not_identified');
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState<string | null>(null);
  if (error)
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  if (!data) return <p role="status">Loading…</p>;
  const k = data.case;
  const closed = k.status.startsWith('closed');
  const forwarded = Boolean(k.forwarded_at);
  const text = draft ?? data.draft?.description ?? data.ledger?.description ?? '';
  const problems = text ? lintPublicText(text) : [];

  async function exportDossier() {
    const r = await run<any>('export_case', { case_ref: caseRef });
    if (!r) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `${caseRef}-dossier.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="prose">
      <button type="button" className="linklike" onClick={onBack}>
        ← All cases
      </button>
      <h2>{k.case_ref}</h2>
      <dl className="facts">
        <dt>Status</dt>
        <dd>
          {words(k.status)}
          {k.close_reason ? `: ${words(k.close_reason)}` : ''}
        </dd>
        <dt>Kind</dt>
        <dd>{k.category}</dd>
        <dt>Authority</dt>
        <dd>
          {k.authority ?? 'not sent yet'}
          {k.authority_case_id ? ` (${k.authority_case_id})` : ''}
        </dd>
        <dt>Sent</dt>
        <dd>{day(k.forwarded_at)}</dd>
        <dt>Resubmission asked</dt>
        <dd>{k.resubmission_requested ? 'Yes' : 'No'}</dd>
        <dt>Public row</dt>
        <dd>{data.ledger ? 'Published' : 'Not published'}</dd>
        <dt>Reports in this case</dt>
        <dd>{data.submissions.length}</dd>
      </dl>

      <h3>Timeline</h3>
      <ol>
        {data.events.map((e: any) => (
          <li key={e.id}>
            {day(e.occurred_at)}: {words(e.type)}
            {e.authority_response_category ? ` (${words(e.authority_response_category)})` : ''}
            {e.note ? `. ${e.note}` : ''}
          </li>
        ))}
      </ol>

      {!forwarded && (
        <form
          className="form"
          onSubmit={async (e) => {
            e.preventDefault();
            await run('forward_case', {
              case_ref: caseRef,
              authority_id: Number(authority),
              authority_case_id: authorityRef || undefined,
              occurred_at: localToIso(when),
            });
          }}
        >
          <h3>Send to an authority</h3>
          <div>
            <label htmlFor="fa">Authority</label>
            <select id="fa" value={authority} onChange={(e) => setAuthority(e.target.value)}>
              <option value="" />
              {(auths.data ?? []).map((a: any) => (
                <option key={a.id} value={a.id}>
                  {a.public_label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="fr">Their reference (optional)</label>
            <input
              id="fr"
              type="text"
              value={authorityRef}
              maxLength={60}
              onChange={(e) => setAuthorityRef(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="fw">Sent on</label>
            <input id="fw" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <button type="submit" className="btn primary" disabled={busy || !authority}>
            Record as sent
          </button>
        </form>
      )}

      {forwarded && !closed && (
        <>
          <form
            className="form"
            onSubmit={async (e) => {
              e.preventDefault();
              await run('record_reply', {
                case_ref: caseRef,
                response: reply,
                occurred_at: localToIso(when),
                note: note || undefined,
                outcome: reply === 'closed_by_authority' ? outcome : undefined,
                closure_reason:
                  reply === 'closed_by_authority' && outcome === 'unresolved' ? reason : undefined,
              });
              setNote('');
            }}
          >
            <h3>Record a reply from the authority</h3>
            <div>
              <label htmlFor="rr">Reply</label>
              <select id="rr" value={reply} onChange={(e) => setReply(e.target.value)}>
                {REPLIES.map((r) => (
                  <option key={r} value={r}>
                    {words(r)}
                  </option>
                ))}
              </select>
            </div>
            {reply === 'closed_by_authority' && (
              <>
                <div>
                  <label htmlFor="ro">Outcome</label>
                  <select id="ro" value={outcome} onChange={(e) => setOutcome(e.target.value)}>
                    <option value="resolved">Resolved</option>
                    <option value="unresolved">Unresolved</option>
                  </select>
                </div>
                {outcome === 'unresolved' && (
                  <div>
                    <label htmlFor="rn">Reason</label>
                    <select id="rn" value={reason} onChange={(e) => setReason(e.target.value)}>
                      {REASONS.map((r) => (
                        <option key={r} value={r}>
                          {words(r)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )}
            <div>
              <label htmlFor="rw">Date of the reply</label>
              <input id="rw" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            </div>
            <div>
              <label htmlFor="rt">Note (optional, no personal details)</label>
              <input
                id="rt"
                type="text"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>
            <button type="submit" className="btn primary" disabled={busy}>
              Save reply
            </button>
          </form>
          <div className="actions">
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() => void run('log_follow_up', { case_ref: caseRef })}
            >
              Log a follow-up we sent
            </button>
            <button
              type="button"
              className="btn secondary"
              disabled={busy}
              onClick={() =>
                void run('set_resubmission', { case_ref: caseRef, requested: !k.resubmission_requested })
              }
            >
              {k.resubmission_requested ? 'Mark as resubmitted' : 'Authority asked for a resubmission'}
            </button>
          </div>
        </>
      )}

      {forwarded && (
        <>
          <h3>Public ledger row</h3>
          <p className="hint">
            Write a short neutral summary (10 to 280 characters). No names, links, handles, phone numbers or
            other identifying detail. A person checking this text matters: the checker below cannot catch
            every name.
          </p>
          <div className="form">
            <div>
              <label htmlFor="ld">Public summary</label>
              <textarea id="ld" value={text} maxLength={280} onChange={(e) => setDraft(e.target.value)} />
            </div>
            {problems.length > 0 && (
              <p className="error" role="alert">
                {problems.join('; ')}
              </p>
            )}
            <div className="actions">
              <button
                type="button"
                className="btn secondary"
                disabled={busy || problems.length > 0 || !text}
                onClick={async () => {
                  if (await run('draft_ledger', { case_ref: caseRef, description: text })) setDraft(null);
                }}
              >
                Save draft
              </button>
              {data.draft && !data.draft.approved_by && (
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => void run('approve_ledger', { case_ref: caseRef })}
                >
                  Approve draft (a second person is needed when there are two or more staff)
                </button>
              )}
              {data.draft && (
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void run('publish_ledger', { case_ref: caseRef })}
                >
                  Publish
                </button>
              )}
              {data.ledger && (
                <button
                  type="button"
                  className="btn secondary"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('Take this row off the public ledger?'))
                      void run('unpublish_ledger', { case_id: caseRef });
                  }}
                >
                  Unpublish
                </button>
              )}
            </div>
          </div>
        </>
      )}

      <h3>Notes and export</h3>
      <form
        className="form"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await run('add_note', { case_ref: caseRef, note })) setNote('');
        }}
      >
        <div>
          <label htmlFor="nn">Internal note (no personal details)</label>
          <input
            id="nn"
            type="text"
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        <div className="actions">
          <button type="submit" className="btn secondary" disabled={busy || !note}>
            Add note
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={busy}
            onClick={() => void exportDossier()}
          >
            Download dossier (needs a recent sign-in)
          </button>
        </div>
      </form>
      {actError && (
        <p className="error" role="alert">
          {actError}
        </p>
      )}
    </div>
  );
}

export function Cases() {
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const { data, error } = useLoad('list_cases', { status: status || undefined });
  if (open) return <CaseView caseRef={open} onBack={() => setOpen(null)} />;
  return (
    <>
      <div className="form">
        <div>
          <label htmlFor="cs">Status</label>
          <select id="cs" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s ? words(s) : 'all'}
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
        <caption className="sr">Cases</caption>
        <thead>
          <tr>
            <th>Case</th>
            <th>Kind</th>
            <th>Authority</th>
            <th>Status</th>
            <th>Public</th>
          </tr>
        </thead>
        <tbody>
          {(data ?? []).map((c: any) => (
            <tr key={c.case_ref}>
              <td data-label="Case" className="id">
                <button type="button" className="linklike" onClick={() => setOpen(c.case_ref)}>
                  {c.case_ref}
                </button>
              </td>
              <td data-label="Kind">{c.category}</td>
              <td data-label="Authority">{c.authority ?? '—'}</td>
              <td data-label="Status">{words(c.status)}</td>
              <td data-label="Public">{c.published ? 'Yes' : 'No'}</td>
            </tr>
          ))}
          {data && data.length === 0 && (
            <tr className="status-row">
              <td colSpan={5}>No cases yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </>
  );
}
