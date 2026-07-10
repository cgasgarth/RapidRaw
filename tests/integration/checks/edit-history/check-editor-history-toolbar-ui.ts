#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import EditorToolbar from '../../../../src/components/panel/editor/EditorToolbar.tsx';
import type { SelectedImage } from '../../../../src/components/ui/AppProperties.tsx';

const failures: string[] = [];
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const i18n = await createTestI18n(locale);

const markup = renderToolbar('macos');
assertIncludes(markup, 'data-command-id="undo"', 'undo command did not render');
assertIncludes(markup, 'data-command-id="redo"', 'redo command did not render');
assertIncludes(markup, 'data-tooltip="Undo (⌘Z) or History (Right-click)"', 'macOS undo shortcut did not render');
assertIncludes(markup, 'data-tooltip="Redo (⌘Y) or History (Right-click)"', 'macOS redo shortcut did not render');
assertExcludes(markup, 'editor-history-depth-control', 'toolbar must not duplicate the sidebar history control');
assertExcludes(markup, 'editor-history-popover', 'toolbar must not render the removed history popover');

if (failures.length > 0) {
  console.error('editor history toolbar UI failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('editor history toolbar UI ok');

function renderToolbar(osPlatform: string): string {
  return renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(EditorToolbar, {
        canRedo: true,
        canUndo: true,
        isAndroid: false,
        isLoading: false,
        onBackToLibrary: () => undefined,
        onOpenNegativeLab: () => undefined,
        onRedo: () => undefined,
        onToggleFullScreen: () => undefined,
        onToggleShowOriginal: () => undefined,
        onUndo: () => undefined,
        osPlatform,
        selectedImage: createSelectedImage(),
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
