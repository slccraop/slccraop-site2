import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import i18n from '../lib/i18n';
import { App } from './App';
import { ROUTE_PATHS } from './routes';

// Server-render smoke test: every route, in every language, renders a heading and no broken text or inline styles.
describe.each(['en', 'si', 'ta'])('routes in %s', (lang) => {
  for (const path of ROUTE_PATHS) {
    it(`renders ${path}`, async () => {
      await i18n.changeLanguage(lang);
      const html = renderToString(
        <MemoryRouter initialEntries={[path]}>
          <App />
        </MemoryRouter>,
      );
      expect(html).toContain('<h1');
      expect(html).not.toContain('{{');
      expect(html).not.toContain('[object Object]');
      expect(html).not.toContain('undefined');
      expect(html).not.toMatch(/ style=/);
      expect(html).toContain('<footer');
    });
  }
});
