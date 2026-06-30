#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import EditorToolbar from '../../../src/components/panel/editor/EditorToolbar.tsx';
import type { SelectedImage } from '../../../src/components/ui/AppProperties.tsx';

import type { Adjustments } from '../../../src/utils/adjustments.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

const failures: string[] = [];
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const i18n = await createTestI18n(locale);

const zeroDepthMarkup = renderToolbar({
  adjustmentsHistory: [],
  adjustmentsHistoryIndex: 0,
});
const zeroDepthControl = getHistoryDepthControlMarkup(zeroDepthMarkup);
assertIncludes(zeroDepthMarkup, 'data-testid="editor-history-depth-control"', 'history depth control did not render');
assertIncludes(zeroDepthControl, 'disabled=""', 'zero-depth history control should be disabled');
assertIncludes(zeroDepthMarkup, '1/1', 'zero-depth history should fall back to a stable 1/1 label');
assertExcludes(zeroDepthMarkup, 'Initial State', 'zero-depth history should not render a history stack menu');

const nonZeroDepthMarkup = renderToolbar({
  adjustmentsHistory: [
    INITIAL_ADJUSTMENTS,
    { ...INITIAL_ADJUSTMENTS, exposure: 0.5 },
    { ...INITIAL_ADJUSTMENTS, exposure: 0.5, contrast: 12 },
  ],
  adjustmentsHistoryIndex: 1,
});
const nonZeroDepthControl = getHistoryDepthControlMarkup(nonZeroDepthMarkup);
assertIncludes(
  nonZeroDepthMarkup,
  'data-testid="editor-history-depth-control"',
  'non-zero history control did not render',
);
assertIncludes(nonZeroDepthMarkup, '2/3', 'non-zero history label should show the active index and total depth');
assertIncludes(
  nonZeroDepthControl,
  'data-tooltip="Show History Stack"',
  'history control should keep its localized toggle tooltip',
);
assertExcludes(nonZeroDepthControl, 'disabled=""', 'non-zero history control should be enabled');
assertExcludes(
  nonZeroDepthMarkup,
  'Initial State',
  'history stack menu should remain collapsed before the toggle is used',
);

const toolbar = locale.editor?.toolbar;
if (typeof toolbar?.historyDepth !== 'string') failures.push('missing locale key: editor.toolbar.historyDepth');
if (typeof toolbar?.tooltips?.history !== 'string')
  failures.push('missing locale key: editor.toolbar.tooltips.history');

if (failures.length > 0) {
  console.error('editor history toolbar UI failed');
  console.error(failures.slice(0, 10).join('\n'));
  process.exit(1);
}

console.log('editor history toolbar UI ok');

function renderToolbar({
  adjustmentsHistory,
  adjustmentsHistoryIndex,
}: {
  adjustmentsHistory: Array<Adjustments>;
  adjustmentsHistoryIndex: number;
}): string {
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(EditorToolbar, {
        adjustmentsHistory,
        adjustmentsHistoryIndex,
        canRedo: adjustmentsHistoryIndex < adjustmentsHistory.length - 1,
        canUndo: adjustmentsHistoryIndex > 0,
        goToAdjustmentsHistoryIndex: () => undefined,
        isAndroid: false,
        isLoading: false,
        onBackToLibrary: () => undefined,
        onRedo: () => undefined,
        onToggleDateView: () => undefined,
        onToggleFullScreen: () => undefined,
        onToggleShowOriginal: () => undefined,
        onUndo: () => undefined,
        selectedImage: createSelectedImage(),
        showDateView: false,
        showOriginal: false,
      }),
    ),
  );
}

function createSelectedImage(): SelectedImage {
  return {
    exif: null,
    height: 3024,
    isRaw: true,
    isReady: true,
    originalUrl: null,
    path: '/library/history-test.NEF',
    thumbnailUrl: 'data:image/png;base64,',
    width: 4032,
  };
}

function assertIncludes(markup: string, needle: string, message: string): void {
  if (!markup.includes(needle)) failures.push(message);
}

function assertExcludes(markup: string, needle: string, message: string): void {
  if (markup.includes(needle)) failures.push(message);
}

function getHistoryDepthControlMarkup(markup: string): string {
  const match = /<button\b(?=[^>]*data-testid="editor-history-depth-control")[^>]*>/u.exec(markup);
  if (!match) failures.push('history depth control opening tag did not render');
  return match?.[0] ?? '';
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
