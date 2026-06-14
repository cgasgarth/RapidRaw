import React from 'react';
import { createRoot } from 'react-dom/client';

import VisualSmokeApp from './VisualSmokeApp';
import '../../i18n';
import '../../styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

const mode = new URLSearchParams(window.location.search).get('scenario') ?? 'empty-library';

createRoot(rootElement).render(
  <React.StrictMode>
    <VisualSmokeApp mode={mode} />
  </React.StrictMode>,
);
