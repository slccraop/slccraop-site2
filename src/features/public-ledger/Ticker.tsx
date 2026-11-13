import { useTranslation } from 'react-i18next';
import { isFakeData } from '../../config/env';
import { fetchStats } from '../../lib/api';
import { formatDateTime } from '../../lib/dates';
import { asLang } from '../../lib/lang';
import { useAsync } from '../../lib/useAsync';

/** The strip of six headline figures. Markup and classes match the design's `.ticker`. */
export function Ticker() {
  const { t, i18n } = useTranslation();
  const lang = asLang(i18n.language);
  const [res] = useAsync(fetchStats);
  const s = res.state === 'ready' ? res.data : null;
  const num = (n: number | undefined) => (n === undefined ? '–' : new Intl.NumberFormat(lang).format(n));
  const median = !s
    ? '–'
    : s.median_days_first_reply === null
      ? '—'
      : t('ticker.days', { count: s.median_days_first_reply });
  const tiles: [string, string][] = [
    [num(s?.total_forwarded), 'ticker.sent'],
    [num(s?.awaiting), 'ticker.awaiting'],
    [num(s?.under_investigation), 'ticker.investigating'],
    [num(s?.closed_resolved), 'ticker.resolved'],
    [num(s?.closed_unresolved), 'ticker.unresolved'],
    [median, 'ticker.median'],
  ];
  const asof =
    res.state === 'loading'
      ? t('ticker.loading')
      : s
        ? `${t('ticker.updated', { when: formatDateTime(s.updated_at, lang) })}${isFakeData ? ` ${t('ticker.sample')}` : ''}`
        : t('ticker.error');
  return (
    <section className="ticker" aria-label={t('ticker.label')} aria-busy={res.state === 'loading'}>
      {tiles.map(([value, key]) => (
        <div key={key}>
          <b>{value}</b>
          <span>{t(key)}</span>
        </div>
      ))}
      <div className="asof" role="status">
        {asof}
      </div>
    </section>
  );
}
