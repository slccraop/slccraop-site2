import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Marked } from '../../components/Marked';
import { NotTranslated } from '../../components/NotTranslated';
import { callFunction } from '../../lib/api';
import { useSubmit } from '../../lib/useSubmit';
import { usePageTitle } from '../../lib/usePageTitle';
import { CORRECTION_TYPES, correctionSchema } from '../../lib/validation';

export function CorrectionPage() {
  const { t } = useTranslation();
  usePageTitle(t('correction.title'));
  const [caseId, setCaseId] = useState('');
  const [type, setType] = useState<(typeof CORRECTION_TYPES)[number]>('correct');
  const [details, setDetails] = useState('');
  const [contact, setContact] = useState('');
  const [trap, setTrap] = useState('');
  const [invalid, setInvalid] = useState(false);
  const { status, run, finish } = useSubmit();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = correctionSchema.safeParse({
      case_id: caseId,
      request_type: type,
      details,
      contact: contact.trim() || null,
    });
    if (!parsed.success) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (trap) {
      finish();
      return;
    } // Bot trap: pretend success, send nothing.
    void run(() => callFunction('submit-correction', { ...parsed.data, website: '' }));
  };

  return (
    <>
      <h1>{t('correction.title')}</h1>
      <NotTranslated keyToCheck="correction.title" />
      <p className="lede">
        {t('correction.intro')
          .split(/(\[[^\]]*\])/)
          .map((part, i) => (i % 2 ? <Marked key={i} text={part} /> : part))}
      </p>
      {status.state === 'done' ? (
        <p className="ok" role="status">
          {t('correction.done')}
        </p>
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          <div>
            <label htmlFor="cc">{t('correction.caseId')}</label>
            <input
              id="cc"
              type="text"
              value={caseId}
              autoComplete="off"
              maxLength={20}
              aria-describedby="cch"
              onChange={(e) => setCaseId(e.target.value.toUpperCase())}
            />
            <span className="hint" id="cch">
              {t('correction.caseIdHint')}
            </span>
          </div>
          <div>
            <label htmlFor="ct">{t('correction.type')}</label>
            <select id="ct" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
              {CORRECTION_TYPES.map((c) => (
                <option key={c} value={c}>
                  {t(`correction.${c}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="cd">{t('correction.details')}</label>
            <textarea
              id="cd"
              value={details}
              maxLength={1000}
              aria-describedby="cdh"
              onChange={(e) => setDetails(e.target.value)}
            />
            <span className="hint" id="cdh">
              {t('correction.detailsHint')}
            </span>
          </div>
          <div>
            <label htmlFor="cn">{t('correction.contact')}</label>
            <input
              id="cn"
              type="text"
              value={contact}
              maxLength={200}
              autoComplete="off"
              aria-describedby="cnh"
              onChange={(e) => setContact(e.target.value)}
            />
            <span className="hint" id="cnh">
              {t('correction.contactHint')}
            </span>
          </div>
          <div className="hp" aria-hidden="true">
            <label htmlFor="ch">Website</label>
            <input
              id="ch"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={trap}
              onChange={(e) => setTrap(e.target.value)}
            />
          </div>
          <p className="hint">
            <Marked text={t('correction.bot')} />
          </p>
          {invalid && (
            <p className="error" role="alert">
              {t('correction.invalid')}
            </p>
          )}
          {status.state === 'error' && (
            <p className="error" role="alert">
              <Marked text={t(`formError.${status.code}`)} />
            </p>
          )}
          <div className="actions">
            <button type="submit" className="btn primary" disabled={status.state === 'sending'}>
              {status.state === 'sending' ? t('correction.sending') : t('correction.submit')}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
