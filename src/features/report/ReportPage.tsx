import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Marked } from '../../components/Marked';
import { NotTranslated } from '../../components/NotTranslated';
import { fetchIntake } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { usePageTitle } from '../../lib/usePageTitle';

type Screen = 'language' | 'eligibility' | 'danger' | 'consent' | 'form' | 'minor';

/**
 * Stage 1 covers the gate screens of manual 6.2: language, eligibility, danger notice, consent.
 * Answers live in React state only. Nothing is written to storage or sent anywhere (manual 5.11).
 * The questionnaire, screenshot upload, phone step and bot check are Stage 3 and are shown as an explicit [STAGE 3] marker.
 */
export function ReportPage() {
  const { t } = useTranslation();
  usePageTitle(t('report.title'));
  const [intake] = useAsync(fetchIntake);
  const [screen, setScreen] = useState<Screen>('language');
  const [minor, setMinor] = useState<'' | 'yes' | 'no'>('');
  const [role, setRole] = useState<'' | 'self' | 'behalf'>('');
  const [behalfOk, setBehalfOk] = useState(false);
  const [dangerOk, setDangerOk] = useState(false);
  const [consentOk, setConsentOk] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (screen !== 'language') heading.current?.focus();
  }, [screen]);
  useEffect(() => {
    if (screen === 'language') return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [screen]);

  const mode =
    intake.state === 'ready' ? (intake.data ?? 'unknown') : intake.state === 'error' ? 'unknown' : null;

  if (mode === null)
    return (
      <>
        <h1>{t('report.title')}</h1>
        <p role="status">{t('report.loading')}</p>
      </>
    );
  if (mode === 'closed' || mode === 'unknown') {
    return (
      <>
        <h1>{t('report.title')}</h1>
        <div className="callout" role="note">
          <p>
            <strong>{mode === 'closed' ? t('report.closedTitle') : t('intake.unknown.title')}</strong>
          </p>
          <p>{mode === 'closed' ? t('report.closedBody') : t('report.unknownBody')}</p>
          <p>
            <Link to="/referral">{t('report.referralLink')}</Link>
          </p>
        </div>
      </>
    );
  }

  const eligible = minor !== '' && role !== '' && (role !== 'behalf' || behalfOk);
  const goEligibility = () => {
    if (minor === 'yes') {
      setRole('');
      setBehalfOk(false);
      setDangerOk(false);
      setConsentOk(false);
      setScreen('minor');
    } else setScreen('danger');
  };

  return (
    <>
      <h1>{t('report.title')}</h1>
      <NotTranslated keyToCheck="report.title" />
      {mode === 'limited' && (
        <div className="callout" role="note">
          <strong>{t('intake.limited.title')}</strong> {t('intake.limited.body')}
        </div>
      )}
      {screen !== 'language' && <p className="hint">{t('report.leaveWarning')}</p>}

      {screen === 'language' && (
        <div className="prose">
          <h2 ref={heading} tabIndex={-1}>
            {t('report.language.heading')}
          </h2>
          <p>{t('report.language.body')}</p>
          <button type="button" className="btn primary" onClick={() => setScreen('eligibility')}>
            {t('report.continue')}
          </button>
        </div>
      )}

      {screen === 'eligibility' && (
        <div className="form">
          <h2 ref={heading} tabIndex={-1}>
            {t('report.eligibility.heading')}
          </h2>
          <fieldset>
            <legend>{t('report.eligibility.minorQ')}</legend>
            <label className="check">
              <input type="radio" name="minor" checked={minor === 'yes'} onChange={() => setMinor('yes')} />
              {t('report.eligibility.minorYes')}
            </label>
            <label className="check">
              <input type="radio" name="minor" checked={minor === 'no'} onChange={() => setMinor('no')} />
              {t('report.eligibility.minorNo')}
            </label>
          </fieldset>
          <fieldset>
            <legend>{t('report.eligibility.roleQ')}</legend>
            <label className="check">
              <input type="radio" name="role" checked={role === 'self'} onChange={() => setRole('self')} />
              {t('report.eligibility.self')}
            </label>
            <label className="check">
              <input
                type="radio"
                name="role"
                checked={role === 'behalf'}
                onChange={() => setRole('behalf')}
              />
              {t('report.eligibility.behalf')}
            </label>
          </fieldset>
          {role === 'behalf' && (
            <label className="check">
              <input type="checkbox" checked={behalfOk} onChange={(e) => setBehalfOk(e.target.checked)} />
              {t('report.eligibility.behalfConsent')}
            </label>
          )}
          <div className="actions">
            <button type="button" className="btn primary" disabled={!eligible} onClick={goEligibility}>
              {t('report.continue')}
            </button>
          </div>
        </div>
      )}

      {screen === 'minor' && (
        <div className="prose">
          <h2 ref={heading} tabIndex={-1}>
            {t('report.minor.heading')}
          </h2>
          <p>{t('report.minor.body')}</p>
          <Link className="btn primary" to="/referral">
            {t('report.referralLink')}
          </Link>
        </div>
      )}

      {screen === 'danger' && (
        <div className="form">
          <h2 ref={heading} tabIndex={-1}>
            {t('report.danger.heading')}
          </h2>
          <p>{t('report.danger.body')}</p>
          <label className="check">
            <input type="checkbox" checked={dangerOk} onChange={(e) => setDangerOk(e.target.checked)} />
            {t('report.danger.ack')}
          </label>
          <div className="actions">
            <button
              type="button"
              className="btn primary"
              disabled={!dangerOk}
              onClick={() => setScreen('consent')}
            >
              {t('report.continue')}
            </button>
          </div>
        </div>
      )}

      {screen === 'consent' && (
        <div className="form">
          <h2 ref={heading} tabIndex={-1}>
            {t('report.consent.heading')}
          </h2>
          <ul>
            <li>{t('report.consent.voluntary')}</li>
            <li>{t('report.consent.withdraw')}</li>
            <li>{t('report.consent.who')}</li>
            <li>{t('report.consent.never')}</li>
          </ul>
          <p>
            <Marked text={t('report.consent.legal')} />
          </p>
          <label className="check">
            <input type="checkbox" checked={consentOk} onChange={(e) => setConsentOk(e.target.checked)} />
            {t('report.consent.agree')}
          </label>
          <div className="actions">
            <button
              type="button"
              className="btn primary"
              disabled={!consentOk}
              onClick={() => setScreen('form')}
            >
              {t('report.continue')}
            </button>
          </div>
        </div>
      )}

      {screen === 'form' && (
        <div className="prose">
          <h2 ref={heading} tabIndex={-1}>
            {t('report.form.heading')}
          </h2>
          <p>
            <Marked text={t('report.form.pending')} />
          </p>
        </div>
      )}
    </>
  );
}
