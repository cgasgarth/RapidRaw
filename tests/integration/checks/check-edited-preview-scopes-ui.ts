#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import Waveform from '../../../src/components/panel/editor/Waveform.tsx';
import { DisplayMode } from '../../../src/utils/adjustments.ts';

import type { PreviewScopeStatus } from '../../../src/store/useEditorStore.ts';

const failures: string[] = [];
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const i18n = await createTestI18n(locale);

const pendingMarkup = renderWaveform(null);
assertIncludes(pendingMarkup, 'data-testid="preview-scope-status"', 'pending scope status did not render');
assertIncludes(pendingMarkup, 'data-preview-scope-ready="false"', 'pending scope should not be ready');
assertIncludes(pendingMarkup, 'Scopes pending', 'pending scope label did not render');

const updatingMarkup = renderWaveform({
  displayTransformLabel: 'Display transform',
  exportProfileLabel: null,
  exportRenderingIntentLabel: null,
  histogramReady: true,
  path: '/library/sample.NEF',
  renderBasis: 'editor_preview',
  softProofTransformApplied: false,
  sourceLabel: 'Edited preview',
  updatedAt: '2026-06-29T16:05:00.000Z',
  waveformReady: false,
  workingTransformLabel: 'Working RGB',
  warningCodes: ['histogram-ready'],
});
assertIncludes(updatingMarkup, 'data-preview-scope-ready="false"', 'partial analytics should be marked updating');
assertIncludes(updatingMarkup, 'data-preview-scope-source="Edited preview"', 'preview source label was not exposed');
assertIncludes(updatingMarkup, 'data-working-transform-label="Working RGB"', 'working transform label was not exposed');
assertIncludes(
  updatingMarkup,
  'data-display-transform-label="Display transform"',
  'display transform label was not exposed',
);
assertIncludes(
  updatingMarkup,
  'data-preview-scope-warning-codes="histogram-ready"',
  'scope warning codes were not exposed',
);
assertIncludes(updatingMarkup, 'Scopes updating', 'updating scope label did not render');
assertIncludes(updatingMarkup, 'Working RGB to Display transform', 'transform path label did not render');

const readyMarkup = renderWaveform({
  displayTransformLabel: 'Display transform',
  exportProfileLabel: 'sRGB',
  exportRenderingIntentLabel: 'relativeColorimetric',
  histogramReady: true,
  path: '/library/sample.NEF',
  renderBasis: 'display_referred',
  softProofTransformApplied: true,
  sourceLabel: 'Edited preview',
  updatedAt: '2026-06-29T16:10:00.000Z',
  waveformReady: true,
  workingTransformLabel: 'Working RGB',
  warningCodes: [],
});
assertIncludes(readyMarkup, 'data-preview-scope-ready="true"', 'ready analytics should expose ready state');
assertIncludes(readyMarkup, 'data-preview-scope-render-basis="display_referred"', 'render basis was not exposed');
assertIncludes(
  readyMarkup,
  'data-preview-scope-soft-proof-transform-applied="true"',
  'soft-proof state was not exposed',
);
assertIncludes(readyMarkup, 'data-export-profile-label="sRGB"', 'export profile label was not exposed');
assertIncludes(
  readyMarkup,
  'data-export-rendering-intent-label="relativeColorimetric"',
  'export intent label was not exposed',
);
assertIncludes(readyMarkup, 'Scopes ready', 'ready scope label did not render');

for (const key of ['pending', 'ready', 'transformPath', 'updating']) {
  if (typeof locale.ui?.waveform?.scopeStatus?.[key] !== 'string') {
    failures.push(`missing locale key: ui.waveform.scopeStatus.${key}`);
  }
}

if (failures.length > 0) {
  console.error('edited preview scopes UI failed');
  console.error(failures.slice(0, 12).join('\n'));
  process.exit(1);
}

console.log('edited preview scopes UI ok');

function renderWaveform(previewScopeStatus: PreviewScopeStatus | null): string {
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(Waveform, {
        displayMode: DisplayMode.Luma,
        histogram: null,
        previewScopeStatus,
        setDisplayMode: () => undefined,
        waveformData: null,
      }),
    ),
  );
}

function assertIncludes(markup: string, needle: string, message: string): void {
  if (!markup.includes(needle)) failures.push(message);
}

async function createTestI18n(resources: typeof locale) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: resources } },
  });
  return instance;
}
