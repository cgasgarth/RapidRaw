#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import {
  LibraryRawOnlyEmptyState,
  shouldShowRawOnlyEmptyState,
} from '../../../../src/components/panel/library/libraryEmptyState.tsx';
import { EditedStatus, RawStatus } from '../../../../src/components/ui/AppProperties.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();

const localeJson = JSON.parse(await readFile('src/i18n/locales/en.json', 'utf8')) as {
  library?: { empty?: Record<string, string> };
};
const failures: string[] = [];

assertShouldShowRawOnlyEmptyState();
assertLocaleContract(localeJson);
await assertRenderedEmptyState();

if (failures.length > 0) {
  console.error('library RAW-only empty state check failed');
  console.error(failures.join('\n'));
  process.exit(1);
}

console.log('library RAW-only empty state ok');

function assertShouldShowRawOnlyEmptyState() {
  const visible = shouldShowRawOnlyEmptyState({
    filterCriteria: { colors: [], rating: 0, rawStatus: RawStatus.RawOnly },
    searchCriteria: { mode: 'OR', tags: [], text: '' },
    sourceImageCount: 4,
    visibleImageCount: 0,
  });
  const hiddenBySearch = shouldShowRawOnlyEmptyState({
    filterCriteria: { colors: [], editedStatus: EditedStatus.All, rating: 0, rawStatus: RawStatus.RawOnly },
    searchCriteria: { mode: 'OR', tags: ['sunset'], text: '' },
    sourceImageCount: 4,
    visibleImageCount: 0,
  });

  if (!visible) failures.push('RAW-only empty state should be enabled when non-RAW files are hidden.');
  if (hiddenBySearch) failures.push('RAW-only empty state should stay hidden when search filters are active.');
}

function assertLocaleContract(resources: typeof localeJson) {
  const keys = ['rawOnlyDescription', 'rawOnlyReset', 'rawOnlyTitle'];
  for (const key of keys) {
    if (typeof resources.library?.empty?.[key] !== 'string') {
      failures.push(`missing locale key: library.empty.${key}`);
    }
  }
}

async function assertRenderedEmptyState() {
  let resetClicks = 0;
  const rendered = await renderEmptyState(() => {
    resetClicks += 1;
  });

  assertVisibleText(rendered.container, 'No RAW files here', 'empty-state title was not rendered.');
  assertVisibleText(
    rendered.container,
    'RAW-only is hiding the JPEGs and other files in this folder.',
    'empty-state description was not rendered.',
  );
  assertVisibleText(rendered.container, 'Show all files', 'reset action was not rendered.');

  const resetButton = getByTestId(rendered.container, 'library-raw-only-empty-state-reset');
  await act(async () => {
    resetButton.click();
  });

  if (resetClicks !== 1) {
    failures.push('reset action did not clear the RAW-only filter.');
  }

  rendered.unmount();
}

async function renderEmptyState(
  onResetRawFilter: () => void,
): Promise<{ container: HTMLDivElement; root: Root; unmount: () => void }> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const i18n = await createTestI18n();

  await act(async () => {
    root.render(
      createElement(I18nextProvider, { i18n }, createElement(LibraryRawOnlyEmptyState, { onResetRawFilter })),
    );
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

async function createTestI18n() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    resources: { en: { translation: localeJson } },
  });
  return instance;
}

function installDom() {
  const window = new Window({ url: 'http://localhost/library-raw-empty-state' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: window.Node });
}

function getByTestId(container: Element, testId: string): HTMLElement {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  if (element === null) {
    throw new Error(`missing test id: ${testId}`);
  }
  return element as HTMLElement;
}

function assertVisibleText(container: Element, text: string, message: string) {
  if (!normalizeText(container.textContent).includes(text)) failures.push(message);
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}
