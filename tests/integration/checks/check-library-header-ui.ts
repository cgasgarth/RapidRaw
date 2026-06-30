#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

const failures: string[] = [];

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();

const [
  { default: LibraryHeaderStatusStrip },
  { buildLibraryHeaderStatusItems },
  { EditedStatus, LibraryViewMode, RawStatus, SortDirection },
] = await Promise.all([
  import('../../../src/components/panel/library/LibraryHeaderStatusStrip.tsx'),
  import('../../../src/components/panel/library/libraryHeaderStatus.ts'),
  import('../../../src/components/ui/AppProperties.tsx'),
]);
const localeJson = JSON.parse(await readFile('src/i18n/locales/en.json', 'utf8')) as {
  library?: { header?: { status?: Record<string, string> } };
};
const i18n = await createTestI18n(localeJson);
const t = i18n.t.bind(i18n);
const translatedSortOptions = [
  { key: 'name', label: t('library.sort.fileName') },
  { key: 'edited', label: t('library.sort.editedStatus') },
];

const readyItems = buildLibraryHeaderStatusItems({
  filterCriteria: { colors: [], rating: 0, rawStatus: RawStatus.All },
  libraryViewMode: LibraryViewMode.Flat,
  searchCriteria: { mode: 'OR', tags: [], text: '' },
  sortCriteria: { key: 'name', order: SortDirection.Ascending },
  t,
  translatedSortOptions,
});
assertStatusValue(readyItems, 'Search', 'Ready');
assertStatusValue(readyItems, 'Filters', 'All');
assertStatusValue(readyItems, 'Sort', 'File Name · Ascending');
assertStatusValue(readyItems, 'View', 'Current Folder');

const activeItems = buildLibraryHeaderStatusItems({
  filterCriteria: {
    colors: ['red'],
    editedStatus: EditedStatus.EditedOnly,
    rating: 0,
    rawStatus: RawStatus.All,
  },
  libraryViewMode: LibraryViewMode.Recursive,
  searchCriteria: { mode: 'AND', tags: ['portfolio'], text: 'sunset' },
  sortCriteria: { key: 'edited', order: SortDirection.Descending },
  t,
  translatedSortOptions,
});
const rendered = await renderHeaderStatus(activeItems);
const statusStrip = getByTestId(
  rendered.container,
  'library-header-workflow-status',
  'library header status strip did not render.',
);
assertVisibleText(statusStrip, 'Search', 'rendered search label was not visible.');
assertVisibleText(statusStrip, '2 terms', 'rendered active search token count was not visible.');
assertVisibleText(statusStrip, 'Filters', 'rendered filters label was not visible.');
assertVisibleText(statusStrip, '2 active', 'rendered edited/color filter count was not visible.');
assertVisibleText(statusStrip, 'Sort', 'rendered sort label was not visible.');
assertVisibleText(statusStrip, 'Edited Status · Descending', 'rendered sort value/order was not visible.');
assertVisibleText(statusStrip, 'View', 'rendered view label was not visible.');
assertVisibleText(statusStrip, 'Recursive', 'rendered recursive view status was not visible.');
rendered.unmount();

const requiredStatusKeys = [
  'ascending',
  'descending',
  'filterActive_one',
  'filterActive_other',
  'filterLabel',
  'filterReady',
  'searchActive_one',
  'searchActive_other',
  'searchLabel',
  'searchReady',
  'sortLabel',
  'sortValue',
  'viewLabel',
];
const statusKeys = localeJson.library?.header?.status ?? {};
for (const key of requiredStatusKeys) {
  if (typeof statusKeys[key] !== 'string') {
    failures.push(`missing locale key: library.header.status.${key}`);
  }
}

if (failures.length > 0) {
  console.error('library header UI check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('library header UI ok');

function assertStatusValue(items: Array<{ label: string; value: string }>, label: string, expected: string) {
  const item = items.find((candidate) => candidate.label === label);
  if (item === undefined) {
    failures.push(`missing status item: ${label}`);
    return;
  }
  if (item.value !== expected) failures.push(`${label} status expected "${expected}", got "${item.value}".`);
}

async function renderHeaderStatus(items: Array<{ label: string; value: string }>): Promise<{
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
}> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(LibraryHeaderStatusStrip, { items })));
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

async function createTestI18n(resources: object) {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    resources: { en: { translation: resources } },
  });
  return instance;
}

function getByTestId(container: Element, testId: string, message: string): HTMLElement {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  if (element === null) {
    failures.push(message);
    throw new Error(message);
  }
  return element as HTMLElement;
}

function assertVisibleText(container: Element, text: string, message: string) {
  if (!normalizeText(container.textContent).includes(text)) failures.push(message);
}

function normalizeText(value: string | null | undefined) {
  return (value ?? '').replace(/\s+/gu, ' ').trim();
}

function installDom() {
  const window = new Window({ url: 'http://localhost/library-header-ui' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: window.Node });
}
