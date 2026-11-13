import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { usePageTitle } from '../../lib/usePageTitle';

export function NotFoundPage() {
  const { t } = useTranslation();
  usePageTitle(t('notFound.title'));
  return (
    <>
      <h1>{t('notFound.title')}</h1>
      <p className="lede">{t('notFound.body')}</p>
      <p>
        <Link className="btn primary" to="/">
          {t('notFound.link')}
        </Link>
      </p>
    </>
  );
}
