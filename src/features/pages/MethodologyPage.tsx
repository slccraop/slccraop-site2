import { useTranslation } from 'react-i18next';
import { fetchStats } from '../../lib/api';
import { asLang } from '../../lib/lang';
import { useAsync } from '../../lib/useAsync';
import { ContentPage } from './ContentPage';

function DetailedStats() {
  const { t, i18n } = useTranslation();
  const lang = asLang(i18n.language);
  const [res] = useAsync(fetchStats);
  const days = (n: number | null) => (n === null ? '—' : t('ticker.days', { count: n }));
  return (
    <section aria-labelledby="ds">
      <h2 id="ds">{t('stats.heading')}</h2>
      {res.state === 'loading' && <p role="status">{t('stats.loading')}</p>}
      {(res.state === 'error' || (res.state === 'ready' && !res.data)) && (
        <p role="alert">{t('stats.error')}</p>
      )}
      {res.state === 'ready' && res.data && (
        <>
          <h3>{t('stats.byAuthority')}</h3>
          <ul>
            {res.data.by_authority.map((a) => (
              <li key={a.authority}>
                {t('stats.authorityLine', {
                  authority: a.authority,
                  forwarded: new Intl.NumberFormat(lang).format(a.forwarded),
                  median: days(a.median_days_first_reply),
                })}
              </li>
            ))}
          </ul>
          <h3>{t('stats.reasons')}</h3>
          {res.data.closure_reasons.length === 0 ? (
            <p>{t('stats.none')}</p>
          ) : (
            <ul>
              {res.data.closure_reasons.map((r) => (
                <li key={r.reason}>
                  {t(`reason.${r.reason}`)}: {r.count}
                </li>
              ))}
            </ul>
          )}
          <h3>{t('stats.withdrawals')}</h3>
          <p>{t('stats.withdrawnTotal', { count: res.data.withdrawn_total })}</p>
          {res.data.withdrawal_reasons.length === 0 ? (
            <p>{t('stats.none')}</p>
          ) : (
            <ul>
              {res.data.withdrawal_reasons.map((r) => (
                <li key={r.reason}>
                  {t(`withdrawalReason.${r.reason}`)}: {r.count}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

export function MethodologyPage() {
  return (
    <ContentPage k="methodology">
      <DetailedStats />
    </ContentPage>
  );
}
