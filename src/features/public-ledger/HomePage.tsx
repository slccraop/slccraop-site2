import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../lib/usePageTitle';
import { LedgerSection } from './LedgerSection';
import { Ticker } from './Ticker';

export function HomePage() {
  const { t } = useTranslation();
  usePageTitle(t('ledger.title'));
  return (
    <>
      <h1 className="home-title">{t('home.title')}</h1>
      <p className="lede home-lede">{t('home.lede')}</p>
      <div className="cta">
        <Link className="btn primary" to="/report">
          {t('home.report')}
        </Link>
        <Link className="btn secondary" to="/add-evidence">
          {t('home.evidence')}
        </Link>
      </div>
      <Ticker />
      <LedgerSection />
    </>
  );
}
