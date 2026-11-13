import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Marked } from '../../components/Marked';
import { NotTranslated } from '../../components/NotTranslated';
import { usePageTitle } from '../../lib/usePageTitle';

interface Section {
  h?: string;
  p?: string[];
  ul?: string[];
  ol?: string[];
  link?: { to: string; label: string };
}

/** Renders any page whose text lives in en.json under pages.<k>. Structure: title, intro, sections[]. */
export function ContentPage({ k, children }: { k: string; children?: React.ReactNode }) {
  const { t } = useTranslation();
  const title = t(`pages.${k}.title`);
  usePageTitle(title);
  const sections = t(`pages.${k}.sections`, { returnObjects: true }) as Section[];
  return (
    <>
      <h1>{title}</h1>
      <NotTranslated keyToCheck={`pages.${k}.title`} />
      <p className="lede">
        <Marked text={t(`pages.${k}.intro`)} />
      </p>
      <div className="prose">
        {sections.map((s, i) => (
          <section key={i}>
            {s.h && <h2>{s.h}</h2>}
            {s.p?.map((text, j) => (
              <p key={j}>
                <Marked text={text} />
              </p>
            ))}
            {s.ul && (
              <ul>
                {s.ul.map((text, j) => (
                  <li key={j}>
                    <Marked text={text} />
                  </li>
                ))}
              </ul>
            )}
            {s.ol && (
              <ol>
                {s.ol.map((text, j) => (
                  <li key={j}>
                    <Marked text={text} />
                  </li>
                ))}
              </ol>
            )}
            {s.link && (
              <p>
                <Link to={s.link.to}>{s.link.label}</Link>
              </p>
            )}
          </section>
        ))}
        {children}
      </div>
    </>
  );
}
