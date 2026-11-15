import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Turnstile } from '../components/Turnstile';
import { NotTranslated } from '../components/NotTranslated';
import { ApiError, callFunctionJson } from '../lib/api';
import { fileProblem, uploadAndFinalize } from '../lib/uploads';
import { usePageTitle } from '../lib/usePageTitle';
import { isTrackingCode, normaliseTrackingCode } from '../lib/validation';
import { LIMITS, evidenceResponseSchema, type UploadTicket } from '../../supabase/functions/_shared/contracts.ts';

type Status = 'waiting' | 'uploading' | 'done' | 'failed';

export function EvidencePage() {
  const { t } = useTranslation();
  usePageTitle(t('evidence.title'));
  const [code, setCode] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [token, setToken] = useState('');
  const [botKey, setBotKey] = useState(0);
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<Status[] | null>(null);
  const onToken = useCallback((x: string) => setToken(x), []);
  const bad = files.filter((f) => fileProblem(f));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!isTrackingCode(code)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (files.length === 0 || bad.length > 0 || files.length > LIMITS.maxFiles) return;
    setSending(true);
    const tracking = normaliseTrackingCode(code);
    try {
      const res = await callFunctionJson(
        'add-evidence',
        { tracking_code: tracking, files: files.map((f) => ({ mime: f.type, size: f.size })), turnstile_token: token, website: '' },
        evidenceResponseSchema,
      );
      if (res.uploads.length === 0) {
        setError(t('evidence.noSlots'));
        return;
      }
      setResults(res.uploads.map(() => 'waiting'));
      for (let i = 0; i < res.uploads.length; i++) {
        setResults((r) => (r ?? []).map((x, j) => (j === i ? 'uploading' : x)));
        let ok = true;
        try {
          await uploadAndFinalize(tracking, res.uploads[i] as UploadTicket, files[i] as File);
        } catch {
          ok = false;
        }
        setResults((r) => (r ?? []).map((x, j) => (j === i ? (ok ? 'done' : 'failed') : x)));
      }
    } catch (err) {
      setError(t(`formError.${err instanceof ApiError ? err.code : 'unknown'}`));
    } finally {
      setSending(false);
      setBotKey((k) => k + 1);
    }
  }

  return (
    <>
      <h1>{t('evidence.title')}</h1>
      <NotTranslated keyToCheck="evidence.title" />
      <p className="lede">{t('evidence.intro')}</p>
      {results ? (
        <div className="prose" role="status">
          <ul>
            {files.map((f, i) => (
              <li key={f.name + f.size}>{f.name}: {t(`evidence.status.${results[i] ?? 'waiting'}`)}</li>
            ))}
          </ul>
          {!results.includes('waiting') && !results.includes('uploading') && !results.includes('failed') && <p className="ok">{t('evidence.done')}</p>}
        </div>
      ) : (
        <form className="form" onSubmit={(e) => void submit(e)} noValidate>
          <div>
            <label htmlFor="ec">{t('tracking.label')}</label>
            <input id="ec" type="text" value={code} autoComplete="off" spellCheck={false} maxLength={48} aria-describedby="ech" aria-invalid={invalid} onChange={(e) => setCode(e.target.value)} />
            <span className="hint" id="ech">{t('tracking.hint')}</span>
            {invalid && <p className="error" role="alert">{t('tracking.invalid')}</p>}
          </div>
          <div>
            <label htmlFor="ef">{t('evidence.pick')}</label>
            <input id="ef" type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
            {files.length > LIMITS.maxFiles && <p className="error" role="alert">{t('evidence.tooMany')}</p>}
            {bad.map((f) => (
              <p className="error" role="alert" key={f.name}>{t('evidence.fileBad', { name: f.name })}</p>
            ))}
          </div>
          <div>
            <p><strong>{t('evidence.botLabel')}</strong></p>
            <Turnstile onToken={onToken} resetKey={botKey} />
          </div>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="actions">
            <button type="submit" className="btn primary" disabled={sending || token === '' || files.length === 0}>{sending ? t('evidence.sending') : t('evidence.send')}</button>
          </div>
        </form>
      )}
    </>
  );
}
