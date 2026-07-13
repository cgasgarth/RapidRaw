import React from 'react';
import { createRoot } from 'react-dom/client';
import { StartupShell } from './product/StartupShell';
import { loadStartupApp } from './product/startupShellHandoff';
import { installFrontendLogBridge } from './utils/frontendLogBridge';
import { frontendStartupReporter } from './utils/startup/startupTraceReporter';
import './product-styles.css';

installFrontendLogBridge();

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('Root element not found');
const root = createRoot(rootElement);

root.render(<StartupShell />);
void frontendStartupReporter.start().catch((error: unknown) => {
  console.error('Failed to report interactive startup shell:', error);
});

void loadStartupApp(() => import('./App.js').then(({ AppWrapper }) => ({ AppWrapper }))).then((result) => {
  if (result.status === 'failed') {
    console.error('Failed to load full application:', result.error);
    root.render(<StartupShell failed />);
    return;
  }
  const App = result.module.AppWrapper;
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
