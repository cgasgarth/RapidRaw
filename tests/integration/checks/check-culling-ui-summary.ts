#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import CullingModal from '../../../src/components/modals/CullingModal.tsx';

const failures: string[] = [];
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));

const imagePaths = [
  '/library/cull-01.ARW',
  '/library/cull-02.ARW',
  '/library/cull-03.jpg',
  '/library/cull-04.nef',
  '/library/cull-05.png',
  '/library/cull-06.cr3',
  '/library/cull-07.webp',
];
const thumbnails = Object.fromEntries(imagePaths.map((path) => [path, `data:image/png;base64,${toBase64(path)}`]));

const cullingMarkup = renderToStaticMarkup(
  createElement(
    I18nextProvider,
    { i18n: await createTestI18n(locale) },
    createElement(CullingModal, {
      error: null,
      imagePaths,
      isOpen: true,
      onApply: () => undefined,
      onClose: () => undefined,
      onError: () => undefined,
      progress: null,
      suggestions: null,
      thumbnails,
    }),
  ),
);

for (const [needle, message] of [
  ['data-testid="culling-setup-summary"', 'culling modal summary section did not render'],
  ['data-image-count="7"', 'culling modal lost image count metric'],
  ['data-raw-source-count="4"', 'culling modal lost raw source count metric'],
  ['data-raster-source-count="3"', 'culling modal lost raster source count metric'],
  ['data-culling-analysis-mode-count="3"', 'culling modal lost active analysis mode count'],
  ['data-focus-ranking-enabled="true"', 'culling modal lost focus ranking state'],
  ['data-testid="culling-setup-batch-preview"', 'culling modal batch preview did not render'],
  ['data-preview-count="6"', 'culling modal lost preview limit metric'],
  ['data-preview-overflow-count="1"', 'culling modal lost preview overflow metric'],
]) {
  if (!cullingMarkup.includes(needle)) failures.push(message);
}

if (cullingMarkup.includes('data-testid="culling-empty-batch-guard"')) {
  failures.push('culling modal should not show empty-batch guard when images are present.');
}

if (failures.length > 0) {
  console.error('culling UI summary failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('culling UI summary ok');

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

function toBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}
