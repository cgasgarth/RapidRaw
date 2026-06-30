#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import FocusStackModal from '../../../src/components/modals/FocusStackModal.tsx';
import { DEFAULT_FOCUS_STACK_UI_SETTINGS } from '../../../src/schemas/focus-stack/focusStackUiSchemas.ts';
import { buildFocusStackSourcePreflight } from '../../../src/utils/focusStackSourcePreflight.ts';

const failures: string[] = [];
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));

const sourcePaths = ['/raw/focus-1.ARW', '/raw/focus-2.ARW', '/raw/focus-3.ARW'];
const imageRecords = sourcePaths.map((path, index) => ({
  exif: {
    ExifImageHeight: '6336',
    ExifImageWidth: '9504',
    FocusDistance: `${0.25 + index * 0.1}`,
    ISO: '100',
    LensModel: 'FE 90mm F2.8 Macro G OSS',
    Make: 'Sony',
    Model: 'ILCE-7RM5',
    WhiteBalance: 'Manual',
  },
  path,
}));
const sourcePreflightMetadata = buildFocusStackSourcePreflightMetadata(sourcePaths, imageRecords);
const sourcePreflight = buildFocusStackSourcePreflight({ sources: sourcePreflightMetadata });

if (sourcePreflight.status !== 'warning') {
  failures.push(`expected source preflight warning status, got ${sourcePreflight.status}.`);
}
if (sourcePreflight.validation?.focusSpanMm !== 200) {
  failures.push(`expected 200mm focus span, got ${sourcePreflight.validation?.focusSpanMm}.`);
}
if (sourcePreflight.validation?.warningCodes.includes('raw_geometry_unverified') !== true) {
  failures.push('expected raw_geometry_unverified warning.');
}

const focusMarkup = renderToStaticMarkup(
  createElement(
    I18nextProvider,
    { i18n: await createTestI18n(locale) },
    createElement(FocusStackModal, {
      isOpen: true,
      loadingImageUrl: null,
      onApplyPlan: () => undefined,
      onClose: () => undefined,
      onPreviewPlan: () => undefined,
      onSettingsChange: () => undefined,
      settings: DEFAULT_FOCUS_STACK_UI_SETTINGS,
      sourceCount: sourcePaths.length,
      sourcePaths,
      sourcePreflightMetadata,
    }),
  ),
);

for (const [needle, message] of [
  ['data-preview-source-count="3"', 'focus modal lost preview source count metric'],
  ['data-estimated-preview-megapixels="17"', 'focus modal lost estimated preview megapixels metric'],
  ['data-estimated-preview-memory-mb="69"', 'focus modal lost estimated preview memory metric'],
  ['data-source-preflight-status="warning"', 'focus modal lost source preflight status metric'],
  ['data-focus-span-mm="200"', 'focus modal lost focus span metric'],
  ['data-warning-count="1"', 'focus modal lost warning count metric'],
  ['data-stack-ready="true"', 'focus modal lost stack readiness metric'],
  ['data-halo-risk-cell-ratio="0.14"', 'focus modal lost halo risk metric'],
  ['data-halo-suppression-strength-percent="0"', 'focus modal lost halo suppression metric'],
]) {
  if (!focusMarkup.includes(needle)) failures.push(message);
}

if (!focusMarkup.includes(locale.modals.focusStack.preflight.ready)) {
  failures.push('focus modal did not render the ready preflight label for warning-only metadata.');
}

if (failures.length > 0) {
  console.error('focus UI preflight failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('focus UI preflight ok');

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

function buildFocusStackSourcePreflightMetadata(
  sourcePaths: string[],
  imageRecords: Array<{
    exif?: Record<string, string> | null;
    path: string;
  }>,
) {
  return sourcePaths.map((imagePath, sourceIndex) => {
    const image = imageRecords.find((record) => record.path === imagePath);
    return {
      exif: image?.exif ?? null,
      height: 6336,
      imagePath,
      sourceIndex,
      width: 9504,
    };
  });
}
