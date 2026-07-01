#!/usr/bin/env bun

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import EditorToolbar from '../../../../src/components/panel/editor/EditorToolbar.tsx';
import type { SelectedImage } from '../../../../src/components/ui/AppProperties.tsx';
import { INITIAL_ADJUSTMENTS } from '../../../../src/utils/adjustments.ts';

type RenderedToolbar = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
};

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const i18n = await createTestI18n(locale);
const targetPath = '/library/negative-lab/110-format-negative-ericht.jpg';
const failures: string[] = [];

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();

const openedPaths: string[][] = [];
const rendered = await renderToolbar(() => {
  openedPaths.push([targetPath]);
});

const button = rendered.container.querySelector<HTMLButtonElement>('[data-testid="editor-toolbar-negative-lab"]');
assert(button, 'Negative Lab toolbar entry should render when an editor image is selected');
assert.equal(button.getAttribute('aria-label'), locale.contextMenus.editor.convertNegative);
assert.equal(button.getAttribute('data-tooltip'), locale.contextMenus.editor.convertNegative);

await act(async () => {
  button.click();
  await flushPromises();
});

assert.deepEqual(openedPaths, [[targetPath]], 'Negative Lab toolbar entry should open for the selected image path');

rendered.unmount();

const disabledRendered = await renderToolbar(() => {
  openedPaths.push(['/library/negative-lab/unsupported.txt']);
}, locale.negativeLabEntryPoints.disabled.unsupported);
const disabledButton = disabledRendered.container.querySelector<HTMLButtonElement>(
  '[data-testid="editor-toolbar-negative-lab"]',
);
assert(disabledButton, 'Negative Lab toolbar entry should still render when disabled');
assert.equal(disabledButton.disabled, true, 'Unsupported source should disable the toolbar entry');
assert.equal(disabledButton.getAttribute('data-tooltip'), locale.negativeLabEntryPoints.disabled.unsupported);
assert.equal(
  disabledButton.getAttribute('aria-label'),
  `${locale.contextMenus.editor.convertNegative}: ${locale.negativeLabEntryPoints.disabled.unsupported}`,
);

await act(async () => {
  disabledButton.click();
  await flushPromises();
});

assert.deepEqual(openedPaths, [[targetPath]], 'Disabled Negative Lab toolbar entry should not open');

disabledRendered.unmount();

if (failures.length > 0) {
  console.error('negative lab toolbar entry failed');
  console.error(failures.slice(0, 10).join('\n'));
  process.exit(1);
}

console.log('negative lab toolbar entry ok');

async function renderToolbar(
  onOpenNegativeLab: () => void,
  negativeLabDisabledReason: string | null = null,
): Promise<RenderedToolbar> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
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
          negativeLabDisabledReason,
          onBackToLibrary: () => undefined,
          onOpenNegativeLab,
          onRedo: () => undefined,
          onToggleDateView: () => undefined,
          onToggleFullScreen: () => undefined,
          onToggleShowOriginal: () => undefined,
          onUndo: () => undefined,
          osPlatform: 'linux',
          selectedImage: createSelectedImage(),
          showDateView: false,
          showOriginal: false,
        }),
      ),
    );
    await flushPromises();
  });

  return {
    container,
    root,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

function createSelectedImage(): SelectedImage {
  return {
    exif: null,
    height: 3024,
    isRaw: false,
    isReady: true,
    originalUrl: null,
    path: targetPath,
    thumbnailUrl: 'data:image/png;base64,',
    width: 4032,
  };
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

function installDom() {
  const window = new Window({ pretendToBeVisual: true });
  Object.assign(globalThis, {
    document: window.document,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    MouseEvent: window.MouseEvent,
    navigator: window.navigator,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    window,
  });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
