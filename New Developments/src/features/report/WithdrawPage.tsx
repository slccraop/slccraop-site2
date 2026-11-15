import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Turnstile } from '../../components/Turnstile';
import { NotTranslated } from '../../components/NotTranslated';
import { callFunction } from '../../lib/api';
import { WITHDRAWAL_REASONS } from '../../lib/schemas';
import { useSubmit } from '../../lib/useSubmit';
import { usePageTitle } from '../../lib/usePageTitle';
import { isTrackingCode, normaliseTrackingCode } from '../../lib/validation';

export function WithdrawPage() {
  const { t } = useTranslation();
  usePageTitle(t('withdraw.title'));
  const [code, setCode] = useState('');
  const [reason, setReason] = useState('');
  const [sure, setSure] = useState(false);
  const [trap, setTrap] = useState('');
  const [invalid, setInvalid] = useState(false);
  const [token, setToken] = useState('');
  const [botKey, setBotKey] = useState(0);
  const onToken = useCallback((x: string) => setToken(x), []);
  const { status, run, finish } = useSubmit();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isTrackingCode(code)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (trap) {
      finish();
      return;
    } // Hidden field was filled: a bot. Pretend success and send nothing.
    void run(() =>
      callFunction('withdraw-report', {
        tracking_code: normaliseTrackingCode(code),
        reason: reason || null,
        turnstile_token: token,
        website: '',
      }).finally(() => setBotKey((k) => k + 1)),
    );
  };

  return (
    <>
      <h1>{t('withdraw.title')}</h1>
      <NotTranslated keyToCheck="withdraw.title" />
      <p className="lede">{t('withdraw.intro')}</p>
      {status.state === 'done' ? (
        <p className="ok" role="status">
          {t('withdraw.done')}
        </p>
      ) : (
        <form className="form" onSubmit={submit} noValidate>
          <div>
            <label htmlFor="wc">{t('tracking.label')}</label>
            <input
              id="wc"
              type="text"
              value={code}
              autoComplete="off"
              spellCheck={false}
              maxLength={48}
              aria-describedby="wch"
              aria-invalid={invalid}
              onChange={(e) => setCode(e.target.value)}
            />
            <span className="hint" id="wch">
              {t('tracking.hint')}
            </span>
            {invalid && (
              <p className="error" role="alert">
                {t('tracking.invalid')}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="wr">{t('withdraw.reason')}</label>
            <select id="wr" value={reason} onChange={(e) => setReason(e.target.value)}>
              <option value="">{t('withdraw.reasonNone')}</option>
              {WITHDRAWAL_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`withdrawalReason.${r}`)}
                </option>
              ))}
            </select>
          </div>
          <label className="check">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
            {t('withdraw.confirm')}
          </label>
          <div className="hp" aria-hidden="true">
            <label htmlFor="wh">Website</label>
            <input
              id="wh"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={trap}
              onChange={(e) => setTrap(e.target.value)}
            />
          </div>
          <div>
            <p>
              <strong>{t('withdraw.botLabel')}</strong>
            </p>
            <Turnstile onToken={onToken} resetKey={botKey} />
          </div>
          {status.state === 'error' && (
            <p className="error" role="alert">
              {t(`formError.${status.code}`)}
            </p>
          )}
          <div className="actions">
            <button
              type="submit"
              className="btn primary"
              disabled={!sure || token === '' || status.state === 'sending'}
            >
              {status.state === 'sending' ? t('withdraw.sending') : t('withdraw.submit')}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
