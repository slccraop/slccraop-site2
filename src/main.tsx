import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, HashRouter } from 'react-router-dom';
import '@fontsource/noto-sans/latin-400.css';
import '@fontsource/noto-sans/latin-600.css';
import '@fontsource/noto-sans/latin-700.css';
import '@fontsource/noto-sans-sinhala/sinhala-400.css';
import '@fontsource/noto-sans-sinhala/sinhala-600.css';
import '@fontsource/noto-sans-sinhala/sinhala-700.css';
import '@fontsource/noto-sans-tamil/tamil-400.css';
import '@fontsource/noto-sans-tamil/tamil-600.css';
import '@fontsource/noto-sans-tamil/tamil-700.css';
import './styles/design.css';
import './styles/extras.css';
import './lib/i18n';
import { App } from './app/App';

// The sample preview is opened straight from a file, where only hash routes work.
// GitHub Pages hosts this project under /slccraop-site2/, so the production router
// must use Vite's base path as its basename for the index route and links to work.
const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element in index.html');
createRoot(root).render(
  <StrictMode>
    {import.meta.env.MODE === 'sample' ? (
      <HashRouter>
        <App />
      </HashRouter>
    ) : (
      <BrowserRouter basename={import.meta.env.BASE_URL}>
        <App />
      </BrowserRouter>
    )}
  </StrictMode>,
);
