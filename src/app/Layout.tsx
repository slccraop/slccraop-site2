import { useEffect, useRef } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { IntakeBanner } from '../components/IntakeBanner';
import { LanguageSwitcher } from '../components/LanguageSwitcher';
import { site } from '../config/site';

const FOOTER_LINKS = [
  ['/about', 'about'],
  ['/privacy', 'privacy'],
  ['/terms', 'terms'],
  ['/consent', 'consent'],
  ['/correction', 'correction'],
  ['/contact', 'contact'],
] as const;

export function Layout() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  // After a page change, move keyboard and screen-reader focus to the new page and scroll to the top.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [pathname]);

  const home = pathname === '/';
  return (
    <>
      <a className="skip" href={home ? '#ledger' : '#main'}>
        {t(home ? 'common.skipLedger' : 'common.skip')}
      </a>
      <header>
        <div className="wrap">
          <Link className="brand" to="/">
            {site.name}
            <small>{site.fullName}</small>
          </Link>
          <nav aria-label={t('nav.label')}>
            <NavLink to="/how-it-works">{t('nav.how')}</NavLink>
            <NavLink to="/methodology">{t('nav.method')}</NavLink>
            <NavLink to="/referral">{t('nav.help')}</NavLink>
            <LanguageSwitcher />
          </nav>
        </div>
      </header>
      <IntakeBanner />
      <main className="wrap" id="main" ref={mainRef} tabIndex={-1}>
        <Outlet />
      </main>
      <footer>
        <div className="wrap">
          {t('footer.independence')}
          <ul>
            {FOOTER_LINKS.map(([to, key]) => (
              <li key={to}>
                <Link to={to}>{t(`footer.${key}`)}</Link>
              </li>
            ))}
          </ul>
        </div>
      </footer>
    </>
  );
}
