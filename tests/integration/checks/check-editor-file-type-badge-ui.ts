#!/usr/bin/env bun

import { mock } from 'bun:test';
import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { createElement, createRef } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import EditorToolbar from '../../../src/components/panel/editor/EditorToolbar.tsx';
import type { SelectedImage } from '../../../src/components/ui/AppProperties.tsx';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

const failures: string[] = [];
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const i18n = await createTestI18n(locale);

mock.module('@clerk/react', () => ({
  useAuth: () => ({ getToken: async () => null }),
}));

for (const testCase of [
  { expected: 'NEF', path: '/library/raw/portrait.nef' },
  { expected: 'CR3', path: '/library/raw/WEDDING_001.CR3' },
  { expected: 'ARW', path: '/library/raw/MixedCase.ArW' },
  { expected: 'DNG', path: '/library/raw/archive.scan.dng' },
  { expected: 'JPG', path: '/library/images/export.JPG' },
  { expected: 'TIFF', path: '/library/images/final.tiff' },
  { expected: 'UNKNOWNEXT', path: '/library/imports/sample.unknownext' },
  { expected: 'FILE', path: '/library/imports/README' },
]) {
  const markup = renderToolbar(testCase.path);
  const badgeMarkup = getBadgeMarkup(markup);
  assertIncludes(markup, `>${getFileName(testCase.path)}<`, `${testCase.path} filename did not render`);
  assertIncludes(
    badgeMarkup,
    `>${testCase.expected}<`,
    `${testCase.path} badge did not render as ${testCase.expected}`,
  );
  assertIncludes(
    badgeMarkup,
    'data-tooltip="File Type"',
    `${testCase.path} badge did not expose the localized file type tooltip`,
  );
}

const { default: Editor } = await import('../../../src/components/panel/Editor.tsx');
const emptyEditorMarkup = renderToStaticMarkup(
  createElement(
    I18nextProvider,
    { i18n },
    createElement(Editor, {
      onBackToLibrary: () => undefined,
      onContextMenu: () => undefined,
      transformWrapperRef: createRef(),
    }),
  ),
);
assertExcludes(
  emptyEditorMarkup,
  'data-testid="editor-file-type-badge"',
  'editor should not render a file type badge when no image is selected',
);

if (typeof locale.editor?.toolbar?.tooltips?.fileType !== 'string') {
  failures.push('missing locale key: editor.toolbar.tooltips.fileType');
}

if (failures.length > 0) {
  console.error('editor file type badge UI check failed');
  console.error(failures.slice(0, 12).join('\n'));
  process.exit(1);
}

console.log('editor file type badge UI ok');

function renderToolbar(path: string): string {
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(EditorToolbar, {
        adjustmentsHistory: [INITIAL_ADJUSTMENTS],
        adjustmentsHistoryIndex: 0,
        canRedo: false,
        canUndo: false,
        goToAdjustmentsHistoryIndex: () => undefined,
        isAndroid: false,
        isLoading: false,
        onBackToLibrary: () => undefined,
        onRedo: () => undefined,
        onToggleDateView: () => undefined,
        onToggleFullScreen: () => undefined,
        onToggleShowOriginal: () => undefined,
        onUndo: () => undefined,
        selectedImage: createSelectedImage(path),
        showDateView: false,
        showOriginal: false,
        osPlatform: 'linux',
      }),
    ),
  );
}

function createSelectedImage(path: string): SelectedImage {
  return {
    exif: null,
    height: 3024,
    isRaw: true,
    isReady: true,
    originalUrl: null,
    path,
    thumbnailUrl: 'data:image/png;base64,',
    width: 4032,
  };
}

function getBadgeMarkup(markup: string): string {
  const match = /<span\b(?=[^>]*data-testid="editor-file-type-badge")[^>]*>[^<]*<\/span>/u.exec(markup);
  if (!match) failures.push('file type badge did not render');
  return match?.[0] ?? '';
}

function getFileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? '';
}

function assertIncludes(markup: string, needle: string, message: string): void {
  if (!markup.includes(needle)) failures.push(message);
}

function assertExcludes(markup: string, needle: string, message: string): void {
  if (markup.includes(needle)) failures.push(message);
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
