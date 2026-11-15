import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Turnstile } from '../../components/Turnstile';
import { callFunctionJson, ApiError } from '../../lib/api';
import { asLang, type Lang } from '../../lib/lang';
import { fileProblem, uploadAndFinalize } from '../../lib/uploads';
import {
  CATEGORIES,
  LANGUAGES,
  LIMITS,
  reportSchema,
  submitResponseSchema,
  type UploadTicket,
} from '../../../supabase/functions/_shared/contracts.ts';
import { normalisePhone } from '../../../supabase/functions/_shared/normalise.ts';

interface State {
  category: string;
  platform: string;
  description: string;
  links: string[];
  usernames: string[];
  dateFrom: string;
  dateTo: string;
  reportedPlatform: '' | 'yes' | 'no';
  platformRef: string;
  reportedPolice: '' | 'yes' | 'no';
  policeRef: string;
  summary: string;
  external: string[];
  files: File[];
  phone: string;
  contactLang: Lang;
  callOk: boolean;
}
const EMPTY: State = {
  category: '',
  platform: '',
  description: '',
  links: [''],
  usernames: [''],
  dateFrom: '',
  dateTo: '',
  reportedPlatform: '',
  platformRef: '',
  reportedPolice: '',
  policeRef: '',
  summary: '',
  external: [''],
  files: [],
  phone: '',
  contactLang: 'en',
  callOk: false,
};
type Upload = 'waiting' | 'uploading' | 'done' | 'failed';
const clean = (list: string[]) => list.map((x) => x.trim()).filter(Boolean);
const todayColombo = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

function ListInput({ id, label, hint, values, onChange, max, addLabel, removeLabel }: {
  id: string;
  label: string;
  hint?: string;
  values: string[];
  onChange: (v: string[]) => void;
  max: number;
  addLabel: string;
  removeLabel: string;
}) {
  return (
    <fieldset>
      <legend>{label}</legend>
      {hint && <span className="hint">{hint}</span>}
      {values.map((v, i) => (
        <div className="row" key={i}>
          <input
            id={`${id}-${i}`}
            type="text"
            aria-label={`${label} ${i + 1}`}
            value={v}
            maxLength={LIMITS.link}
            autoComplete="off"
            onChange={(e) => onChange(values.map((x, j) => (j === i ? e.target.value : x)))}
          />
          {values.length > 1 && (
            <button type="button" className="linklike" onClick={() => onChange(values.filter((_, j) => j !== i))}>
              {removeLabel}
            </button>
          )}
        </div>
      ))}
      {values.length < max && (
        <button type="button" className="linklike" onClick={() => onChange([...values, ''])}>
          {addLabel}
        </button>
      )}
    </fieldset>
  );
}

export function ReportForm({
  role,
  behalfConsent,
  onDone,
}: {
  role: 'self' | 'behalf';
  behalfConsent: boolean;
  onDone?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = asLang(i18n.language);
  const [s, setS] = useState<State>({ ...EMPTY, contactLang: lang });
  const [step, setStep] = useState(0);
  const [showErrors, setShowErrors] = useState(false);
  const [token, setToken] = useState('');
  const [botKey, setBotKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ code: string; tickets: UploadTicket[] } | null>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [copied, setCopied] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const set = <K extends keyof State>(k: K, v: State[K]) => setS((p) => ({ ...p, [k]: v }));
  const onToken = useCallback((x: string) => setToken(x), []);
  useEffect(() => {
    heading.current?.focus();
  }, [step, done]);

  const phone = normalisePhone(s.phone);
  const fileErrors = useMemo(
    () => s.files.map((f) => ({ name: f.name, problem: fileProblem(f) })).filter((x) => x.problem),
    [s.files],
  );
  const dateProblem = (() => {
    const today = todayColombo();
    if ((s.dateFrom && s.dateFrom > today) || (s.dateTo && s.dateTo > today)) return t('report.f.where.dateFuture');
    if (s.dateFrom && s.dateTo && s.dateFrom > s.dateTo) return t('report.f.where.dateOrder');
    return '';
  })();
  const valid = [
    s.category !== '' && s.platform.trim() !== '',
    dateProblem === '',
    s.description.trim().length >= 20 && s.reportedPlatform !== '' && s.reportedPolice !== '',
    s.files.length <= LIMITS.maxFiles && fileErrors.length === 0,
    phone !== null && s.callOk,
    true,
  ];
  const go = (to: number) => {
    setShowErrors(false);
    setError('');
    setStep(to);
  };
  const next = () => (valid[step] ? go(step + 1) : setShowErrors(true));
  const total = 6;

  async function send() {
    setError('');
    const payload = {
      language: lang,
      contact_language: s.contactLang,
      minor: false as const,
      reporter_role: role,
      behalf_consent: behalfConsent,
      category: s.category,
      platform: s.platform.trim(),
      description: s.description.trim(),
      links: clean(s.links),
      usernames: clean(s.usernames),
      date_from: s.dateFrom || null,
      date_to: s.dateTo || null,
      reported_to_platform: s.reportedPlatform === 'yes',
      platform_reference: s.platformRef.trim(),
      reported_to_police: s.reportedPolice === 'yes',
      police_reference: s.policeRef.trim(),
      evidence_summary: s.summary.trim(),
      external_media_links: clean(s.external),
      phone: phone ?? s.phone,
      contact_consent: true as const,
      files: s.files.map((f) => ({ mime: f.type, size: f.size })),
      turnstile_token: token,
      website: '',
    };
    const check = reportSchema.safeParse(payload);
    if (!check.success) {
      setError(t('formError.invalid'));
      return;
    }
    setSending(true);
    try {
      const res = await callFunctionJson('submit-report', check.data, submitResponseSchema);
      setDone({ code: res.tracking_code, tickets: res.uploads });
      onDone?.();
      setUploads(res.uploads.map(() => 'waiting'));
      const code = res.tracking_code.replace(/-/g, '');
      for (let i = 0; i < res.uploads.length; i++) {
        setUploads((u) => u.map((x, j) => (j === i ? 'uploading' : x)));
        let ok = true;
        try {
          await uploadAndFinalize(code, res.uploads[i] as UploadTicket, s.files[i] as File);
        } catch {
          ok = false;
        }
        setUploads((u) => u.map((x, j) => (j === i ? (ok ? 'done' : 'failed') : x)));
      }
    } catch (e) {
      setError(t(`formError.${e instanceof ApiError ? e.code : 'unknown'}`));
      setBotKey((k) => k + 1);
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div className="prose">
        <h2 ref={heading} tabIndex={-1}>{t('report.f.done.heading')}</h2>
        <p className="print-only">SLCCRAOP</p>
        <div className="callout">
          <p>
            <strong>{t('report.f.done.codeLabel')}</strong>
          </p>
          <p className="tracking" aria-label={t('report.f.done.codeLabel')}>{done.code}</p>
          <p>{t('report.f.done.warn')}</p>
          <div className="actions no-print">
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(done.code).then(() => setCopied(true));
              }}
            >
              {copied ? t('report.f.done.copied') : t('report.f.done.copy')}
            </button>
            <button type="button" className="btn secondary" onClick={() => window.print()}>
              {t('report.f.done.print')}
            </button>
          </div>
        </div>
        <p>{t('report.f.done.next')}</p>
        {done.tickets.length > 0 && (
          <>
            <h3>{t('report.f.done.uploads')}</h3>
            <ul>
              {done.tickets.map((tk, i) => (
                <li key={tk.upload_id}>
                  {s.files[i]?.name}: {t(`evidence.status.${uploads[i] ?? 'waiting'}`)}
                </li>
              ))}
            </ul>
            {uploads.includes('failed') && (
              <p className="callout">
                {t('report.f.done.failedNote')} <Link to="/add-evidence">{t('report.f.done.addLater')}</Link>
              </p>
            )}
          </>
        )}
        <p className="no-print">
          <Link to="/">{t('report.f.done.home')}</Link>
        </p>
      </div>
    );
  }

  const bad = (cond: boolean) => (showErrors && cond ? true : undefined);
  return (
    <form
      className="form"
      onSubmit={(e) => {
        e.preventDefault();
        if (step === 5) void send();
        else next();
      }}
      noValidate
    >
      <p className="hint" role="status">{t('report.f.stepOf', { n: step + 1, total })}</p>
      <h2 ref={heading} tabIndex={-1}>{(t('report.f.steps', { returnObjects: true }) as string[])[step]}</h2>

      {step === 0 && (
        <>
          <div>
            <label htmlFor="rf-cat">{t('report.f.about.category')}</label>
            <select id="rf-cat" value={s.category} aria-invalid={bad(s.category === '')} onChange={(e) => set('category', e.target.value)}>
              <option value="" />
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`category.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="rf-platform">{t('report.f.about.platform')}</label>
            <input
              id="rf-platform"
              type="text"
              value={s.platform}
              maxLength={LIMITS.platform}
              aria-describedby="rf-ph"
              aria-invalid={bad(s.platform.trim() === '')}
              onChange={(e) => set('platform', e.target.value)}
            />
            <span className="hint" id="rf-ph">{t('report.f.about.platformHint')}</span>
          </div>
        </>
      )}

      {step === 1 && (
        <>
          <ListInput id="rf-links" label={t('report.f.where.links')} hint={t('report.f.where.linksHint')} values={s.links} onChange={(v) => set('links', v)} max={LIMITS.listMax} addLabel={t('report.f.where.addLink')} removeLabel={t('report.f.where.remove')} />
          <ListInput id="rf-users" label={t('report.f.where.usernames')} hint={t('report.f.where.usernamesHint')} values={s.usernames} onChange={(v) => set('usernames', v)} max={LIMITS.listMax} addLabel={t('report.f.where.addUsername')} removeLabel={t('report.f.where.remove')} />
          <div>
            <label htmlFor="rf-from">{t('report.f.where.from')}</label>
            <input id="rf-from" type="date" value={s.dateFrom} max={todayColombo()} onChange={(e) => set('dateFrom', e.target.value)} />
          </div>
          <div>
            <label htmlFor="rf-to">{t('report.f.where.to')}</label>
            <input id="rf-to" type="date" value={s.dateTo} max={todayColombo()} onChange={(e) => set('dateTo', e.target.value)} />
          </div>
          {dateProblem && <p className="error" role="alert">{dateProblem}</p>}
        </>
      )}

      {step === 2 && (
        <>
          <div>
            <label htmlFor="rf-desc">{t('report.f.story.desc')}</label>
            <textarea id="rf-desc" value={s.description} maxLength={LIMITS.description} aria-describedby="rf-dh" aria-invalid={bad(s.description.trim().length < 20)} onChange={(e) => set('description', e.target.value)} />
            <span className="hint" id="rf-dh">{t('report.f.story.descHint')} {s.description.length} / {LIMITS.description}</span>
            {bad(s.description.trim().length < 20) && <p className="error" role="alert">{t('report.f.story.descShort')}</p>}
          </div>
          {(['Platform', 'Police'] as const).map((k) => {
            const flag = k === 'Platform' ? 'reportedPlatform' : 'reportedPolice';
            const ref = k === 'Platform' ? 'platformRef' : 'policeRef';
            return (
              <fieldset key={k}>
                <legend>{t(`report.f.story.reported${k}`)}</legend>
                <label className="check">
                  <input type="radio" name={flag} checked={s[flag] === 'yes'} onChange={() => set(flag, 'yes')} />
                  {t('report.f.story.yes')}
                </label>
                <label className="check">
                  <input type="radio" name={flag} checked={s[flag] === 'no'} onChange={() => set(flag, 'no')} />
                  {t('report.f.story.no')}
                </label>
                {bad(s[flag] === '') && <p className="error" role="alert">{t('report.f.required')}</p>}
                {s[flag] === 'yes' && (
                  <div>
                    <label htmlFor={`rf-${ref}`}>{t('report.f.story.reference')}</label>
                    <input id={`rf-${ref}`} type="text" value={s[ref]} maxLength={LIMITS.reference} onChange={(e) => set(ref, e.target.value)} />
                  </div>
                )}
              </fieldset>
            );
          })}
        </>
      )}

      {step === 3 && (
        <>
          <p>{t('report.f.shots.intro')}</p>
          <p className="callout" role="note">{t('report.f.shots.warn')} <Link to="/referral">{t('report.f.shots.referral')}</Link></p>
          <div>
            <label htmlFor="rf-files">{t('report.f.shots.pick')}</label>
            <input id="rf-files" type="file" multiple accept="image/png,image/jpeg,image/webp" onChange={(e) => set('files', Array.from(e.target.files ?? []))} />
            {s.files.length > LIMITS.maxFiles && <p className="error" role="alert">{t('report.f.shots.tooMany')}</p>}
            {fileErrors.map((f) => (
              <p className="error" role="alert" key={f.name}>{t('report.f.shots.fileBad', { name: f.name })}</p>
            ))}
            {s.files.length > 0 && fileErrors.length === 0 && (
              <ul>
                {s.files.map((f) => (
                  <li key={f.name + f.size}>{f.name}</li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label htmlFor="rf-sum">{t('report.f.shots.summary')}</label>
            <textarea id="rf-sum" value={s.summary} maxLength={LIMITS.evidenceSummary} onChange={(e) => set('summary', e.target.value)} />
          </div>
          <ListInput id="rf-ext" label={t('report.f.shots.external')} hint={t('report.f.shots.externalHint')} values={s.external} onChange={(v) => set('external', v)} max={LIMITS.externalLinksMax} addLabel={t('report.f.shots.addExternal')} removeLabel={t('report.f.shots.remove')} />
        </>
      )}

      {step === 4 && (
        <>
          <p>{t('report.f.contact.intro')}</p>
          <div>
            <label htmlFor="rf-phone">{t('report.f.contact.phone')}</label>
            <input id="rf-phone" type="text" inputMode="tel" autoComplete="tel" value={s.phone} maxLength={25} aria-describedby="rf-pho" aria-invalid={bad(phone === null)} onChange={(e) => set('phone', e.target.value)} />
            <span className="hint" id="rf-pho">{t('report.f.contact.phoneHint')}</span>
            {bad(phone === null) && <p className="error" role="alert">{t('report.f.contact.phoneBad')}</p>}
          </div>
          <div>
            <label htmlFor="rf-clang">{t('report.f.contact.lang')}</label>
            <select id="rf-clang" value={s.contactLang} onChange={(e) => set('contactLang', e.target.value as Lang)}>
              {LANGUAGES.map((l) => (
                <option key={l} value={l}> {{ en: 'English', si: 'සිංහල', ta: 'தமிழ்' }[l]} </option>
              ))}
            </select>
          </div>
          <label className="check">
            <input type="checkbox" checked={s.callOk} onChange={(e) => set('callOk', e.target.checked)} />
            {t('report.f.contact.consent')}
          </label>
          {bad(!s.callOk) && <p className="error" role="alert">{t('report.f.contact.consentNeeded')}</p>}
        </>
      )}

      {step === 5 && (
        <>
          <p>{t('report.f.review.intro')}</p>
          <dl className="facts">
            <dt>{t('report.f.review.category')}</dt>
            <dd>{s.category ? t(`category.${s.category}`) : ''}</dd>
            <dt>{t('report.f.review.platform')}</dt>
            <dd>{s.platform}</dd>
            <dt>{t('report.f.review.links')}</dt>
            <dd>{clean(s.links).join(', ') || t('report.f.review.noneShort')}</dd>
            <dt>{t('report.f.review.usernames')}</dt>
            <dd>{clean(s.usernames).join(', ') || t('report.f.review.noneShort')}</dd>
            <dt>{t('report.f.review.dates')}</dt>
            <dd>{[s.dateFrom, s.dateTo].filter(Boolean).join(' to ') || t('report.f.review.noneShort')}</dd>
            <dt>{t('report.f.review.description')}</dt>
            <dd>{s.description}</dd>
            <dt>{t('report.f.review.files')}</dt>
            <dd>{s.files.length || t('report.f.review.none')}</dd>
            <dt>{t('report.f.review.phone')}</dt>
            <dd>{phone}</dd>
          </dl>
          <div>
            <p>
              <strong>{t('report.f.review.bot')}</strong>
            </p>
            <Turnstile onToken={onToken} resetKey={botKey} />
          </div>
        </>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      <div className="actions">
        {step > 0 && (
          <button type="button" className="btn secondary" onClick={() => go(step - 1)} disabled={sending}>
            {t('report.f.back')}
          </button>
        )}
        {step < 5 && (
          <button type="submit" className="btn primary">
            {t('report.f.next')}
          </button>
        )}
        {step === 5 && (
          <button type="submit" className="btn primary" disabled={sending || token === ''}>
            {sending ? t('report.f.sending') : t('report.f.send')}
          </button>
        )}
      </div>
    </form>
  );
}
