import { useTranslation } from 'react-i18next';
import { isTranslated } from '../lib/translated';

/** Shown above any page whose text has not been translated yet, so a reader knows why it is in English. */
export function NotTranslated({ keyToCheck }: { keyToCheck: string }) {
  const { t, i18n } = useTranslation();
  if (isTranslated(i18n, keyToCheck)) return null;
  return (
    <p className="callout" role="note">
      {t('common.notTranslated')}
    </p>
  );
}
