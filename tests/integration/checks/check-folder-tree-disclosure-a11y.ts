#!/usr/bin/env bun

import { readFileSync } from 'node:fs';
import { mock } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

mock.module('@tauri-apps/api/core', () => ({
  invoke: async (command: string) => (command === 'get_albums' ? [] : null),
}));
mock.module('@tauri-apps/plugin-os', () => ({ platform: () => 'macos' }));

const failures: string[] = [];
const selectedFolders: string[] = [];
const toggledFolders: string[] = [];

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();

const [{ default: FolderTree }, { SortDirection, Theme }, { useLibraryStore }, { useSettingsStore }] =
  await Promise.all([
    import('../../../src/components/panel/FolderTree.tsx'),
    import('../../../src/components/ui/AppProperties.tsx'),
    import('../../../src/store/useLibraryStore.ts'),
    import('../../../src/store/useSettingsStore.ts'),
  ]);
const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8')) as {
  library?: { items?: Record<string, string> };
};
const i18n = await createTestI18n(locale);

const requiredLocaleKeys = ['collapseFolderNamed', 'expandFolderNamed', 'selectFolderNamed'];
const folderItems = locale.library?.items;
for (const key of requiredLocaleKeys) {
  if (typeof folderItems?.[key] !== 'string') {
    failures.push(`missing locale key: library.items.${key}`);
  }
}

useSettingsStore.getState().setAppSettings({
  folderTreeSort: { key: 'name', order: SortDirection.Ascending },
  lastRootPath: '/library',
  openTreeSections: ['current'],
  pinnedFolders: [],
  theme: Theme.Dark,
});
useLibraryStore.getState().setLibrary({
  activeAlbumId: null,
  albumTree: [],
  currentFolderPath: '/library',
  expandedAlbumGroups: new Set<string>(),
  expandedFolders: new Set<string>(['/library']),
  folderTrees: [
    {
      children: [
        {
          children: [{ children: [], imageCount: 4, isDir: true, name: 'Photos', path: '/library/trips/photos' }],
          hasSubdirs: true,
          imageCount: 2,
          isDir: true,
          name: 'Trips',
          path: '/library/trips',
        },
        { children: [], imageCount: 1, isDir: true, name: 'Exports', path: '/library/exports' },
      ],
      hasSubdirs: true,
      imageCount: 3,
      isDir: true,
      name: 'Library Root',
      path: '/library',
    },
  ],
  isTreeLoading: false,
  pinnedFolderTrees: [],
});

const rendered = await renderFolderTree();

const rootSelect = getRoleButtonByLabel(rendered.container, 'Select folder Library Root');
const tripsSelect = getRoleButtonByLabel(rendered.container, 'Select folder Trips');
assertAria(rootSelect, 'aria-label', 'Select folder Library Root', 'root folder select control name was wrong.');
assertAria(tripsSelect, 'aria-label', 'Select folder Trips', 'child folder select control name was wrong.');

const rootDisclosures = getButtonsByLabel(rendered.container, 'Collapse folder Library Root');
if (rootDisclosures.length !== 2) {
  failures.push(`expected two root disclosure controls, got ${rootDisclosures.length}.`);
}
for (const disclosure of rootDisclosures) {
  assertAria(disclosure, 'aria-expanded', 'true', 'root disclosure did not expose expanded state.');
}

const tripDisclosures = getButtonsByLabel(rendered.container, 'Expand folder Trips');
if (tripDisclosures.length !== 2) {
  failures.push(`expected two collapsed Trips disclosure controls, got ${tripDisclosures.length}.`);
}
for (const disclosure of tripDisclosures) {
  assertAria(disclosure, 'aria-expanded', 'false', 'Trips disclosure did not expose collapsed state.');
}

await act(async () => {
  tripsSelect.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
});
if (selectedFolders.at(-1) !== '/library/trips') {
  failures.push(`keyboard selection expected /library/trips, got ${selectedFolders.at(-1) ?? '<none>'}.`);
}

await act(async () => {
  tripDisclosures[0]?.click();
});
await flushPromises();
if (toggledFolders.at(-1) !== '/library/trips') {
  failures.push(`expand click expected /library/trips, got ${toggledFolders.at(-1) ?? '<none>'}.`);
}
const expandedTrips = getButtonsByLabel(rendered.container, 'Collapse folder Trips');
if (expandedTrips.length !== 2) {
  failures.push(`expected two expanded Trips disclosure controls, got ${expandedTrips.length}.`);
}
for (const disclosure of expandedTrips) {
  assertAria(disclosure, 'aria-expanded', 'true', 'Trips disclosure did not expose expanded state after click.');
}
getRoleButtonByLabel(rendered.container, 'Select folder Photos');

await act(async () => {
  expandedTrips[0]?.click();
});
await flushPromises();
if (toggledFolders.at(-1) !== '/library/trips') {
  failures.push(`collapse click expected /library/trips, got ${toggledFolders.at(-1) ?? '<none>'}.`);
}
const collapsedTrips = getButtonsByLabel(rendered.container, 'Expand folder Trips');
if (collapsedTrips.length !== 2) {
  failures.push(`expected two re-collapsed Trips disclosure controls, got ${collapsedTrips.length}.`);
}
for (const disclosure of collapsedTrips) {
  assertAria(disclosure, 'aria-expanded', 'false', 'Trips disclosure did not expose collapsed state after click.');
}

rendered.unmount();

if (failures.length > 0) {
  console.error('folder tree disclosure a11y check failed');
  for (const failure of failures.slice(0, 12)) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('folder tree disclosure a11y ok');

async function renderFolderTree(): Promise<{
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
}> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(FolderTree, {
          isInstantTransition: true,
          isResizing: false,
          isVisible: true,
          onAlbumContextMenu: () => undefined,
          onContextMenu: () => undefined,
          onFolderSelect: (folder: string) => {
            selectedFolders.push(folder);
          },
          onOpenFolder: () => undefined,
          onSelectAlbum: () => undefined,
          onToggleFolder: (folder: string) => {
            toggledFolders.push(folder);
            useLibraryStore.getState().setLibrary((state) => {
              const expandedFolders = new Set(state.expandedFolders);
              if (expandedFolders.has(folder)) {
                expandedFolders.delete(folder);
              } else {
                expandedFolders.add(folder);
              }
              return { expandedFolders };
            });
          },
          setIsVisible: () => undefined,
          style: { height: '640px', width: '320px' },
        }),
      ),
    );
  });
  await flushPromises();

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

function getRoleButtonByLabel(container: Element, label: string): HTMLElement {
  const element = container.querySelector(`[role="button"][aria-label="${cssEscape(label)}"]`);
  if (element === null) {
    failures.push(`missing role=button control named "${label}".`);
    throw new Error(`missing role=button control named "${label}".`);
  }
  return element as HTMLElement;
}

function getButtonsByLabel(container: Element, label: string): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll(`button[aria-label="${cssEscape(label)}"]`));
}

function assertAria(element: Element, attribute: string, expected: string, message: string) {
  const actual = element.getAttribute(attribute);
  if (actual !== expected) failures.push(`${message} Expected ${expected}, got ${actual ?? '<missing>'}.`);
}

function cssEscape(value: string) {
  return value.replace(/"/gu, '\\"');
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function installDom() {
  const window = new Window({ url: 'http://localhost/folder-tree-disclosure-a11y' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
  Object.defineProperty(globalThis, 'HTMLButtonElement', { configurable: true, value: window.HTMLButtonElement });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: window.Event });
  Object.defineProperty(globalThis, 'KeyboardEvent', { configurable: true, value: window.KeyboardEvent });
  Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: window.MouseEvent });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: window.MutationObserver });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: window.Node });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: window.requestAnimationFrame.bind(window),
  });
}
