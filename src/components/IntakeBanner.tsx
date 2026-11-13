import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { fetchIntake } from '../lib/api';
import { useAsync } from '../lib/useAsync';

/** The amber strip under the header. Markup matches the design's `.notice`. Fails closed: if the state cannot be read, it says so. */
export function IntakeBanner() {
  const { t } = useTranslation();
  const [res] = useAsync(fetchIntake);
  const mode = res.state === 'ready' ? (res.data ?? 'unknown') : res.state === 'error' ? 'unknown' : null;
  return (
    <div className="notice" role="note">
      <div className="wrap">
        {mode && (
          <>
            <strong>{t(`intake.${mode}.title`)}</strong> {t(`intake.${mode}.body`)}{' '}
            {mode === 'closed' && (
              <>
                <Link to="/referral">{t('intake.closed.link')}</Link>{' '}
              </>
            )}
          </>
        )}
        {t('intake.danger')}
      </div>
    </div>
  );
}
