import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Marked } from '../../components/Marked';
import { NotTranslated } from '../../components/NotTranslated';
import { usePageTitle } from '../../lib/usePageTitle';
import { isTrackingCode } from '../../lib/validation';

/** Stage 1: tracking code entry and validation. The upload step is Stage 3 and is shown as an explicit marker. */
export function EvidencePage() {
  const { t } = useTranslation();
  usePageTitle(t('evidence.title'));
  const [code, setCode] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [accepted, setAccepted] = useState(false);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const ok = isTrackingCode(code);
    setInvalid(!ok);
    setAccepted(ok);
  };

  return (
    <>
      <h1>{t('evidence.title')}</h1>
      <NotTranslated keyToCheck="evidence.title" />
      <p className="lede">{t('evidence.intro')}</p>
      <form className="form" onSubmit={submit} noValidate>
        <div>
          <label htmlFor="ec">{t('tracking.label')}</label>
          <input
            id="ec"
            type="text"
            value={code}
            autoComplete="off"
            spellCheck={false}
            maxLength={48}
            aria-describedby="ech"
            aria-invalid={invalid}
            onChange={(e) => {
              setCode(e.target.value);
              setAccepted(false);
            }}
          />
          <span className="hint" id="ech">
            {t('tracking.hint')}
          </span>
          {invalid && (
            <p className="error" role="alert">
              {t('tracking.invalid')}
            </p>
          )}
        </div>
        <div className="actions">
          <button type="submit" className="btn primary">
            {t('evidence.check')}
          </button>
        </div>
      </form>
      {accepted && (
        <p className="callout" role="status">
          <Marked text={t('evidence.pending')} />
        </p>
      )}
    </>
  );
}
