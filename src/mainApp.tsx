import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppWrapper } from './App.js';
import './product-styles.css';
import { installFrontendLogBridge } from './utils/frontendLogBridge';

export const mountApplication = (): void => {
  installFrontendLogBridge();
  const rootElement = document.getElementById('root');
  if (!rootElement) throw new Error('Root element not found');
  createRoot(rootElement).render(
    <React.StrictMode>
      <AppWrapper />
    </React.StrictMode>,
  );
};
