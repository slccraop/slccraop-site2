import { useTranslation } from 'react-i18next';
import { Marked } from '../../components/Marked';
import { NotTranslated } from '../../components/NotTranslated';
import { fetchStats } from '../../lib/api';
import { useAsync } from '../../lib/useAsync';
import { usePageTitle } from '../../lib/usePageTitle';

interface Body {
  name: string;
  what: string;
  contact: string;
}
interface Tool {
  name: string;
  for: string;
  url: string;
  note: string;
}

export function ReferralPage() {
  const { t } = useTranslation();
  usePageTitle(t('referral.title'));
  const [stats] = useAsync(fetchStats);
  const bodies = t('referral.bodies', { returnObjects: true }) as Body[];
  const preserve = t('referral.preserve', { returnObjects: true }) as string[];
  const tools = t('referral.tools', { returnObjects: true }) as Tool[];
  return (
    <>
      <h1>{t('referral.title')}</h1>
      <NotTranslated keyToCheck="referral.title" />
      <p className="lede">{t('referral.intro')}</p>
      <div className="prose">
        <h2>{t('referral.bodiesHeading')}</h2>
      </div>
      <ul className="bodies">
        {bodies.map((b) => (
          <li key={b.name}>
            <h3>{b.name}</h3>
            <p>
              <Marked text={b.what} />
            </p>
            <p>
              <Marked text={b.contact} />
            </p>
          </li>
        ))}
      </ul>
      <div className="prose">
        <h2>{t('referral.preserveHeading')}</h2>
        <ul>
          {preserve.map((p, i) => (
            <li key={i}>
              <Marked text={p} />
            </li>
          ))}
        </ul>
        <h2>{t('referral.toolsHeading')}</h2>
        <p>{t('referral.toolsNote')}</p>
        <ul>
          {tools.map((tool) => (
            <li key={tool.name}>
              <a href={tool.url} target="_blank" rel="noopener noreferrer">
                {tool.name}
              </a>
              . {tool.for} <Marked text={tool.note} />
            </li>
          ))}
        </ul>
        {stats.state === 'ready' && stats.data && (
          <p>{t('referral.minorsCount', { count: stats.data.minors_referred_total })}</p>
        )}
      </div>
    </>
  );
}
