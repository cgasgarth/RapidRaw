#!/usr/bin/env bun

import { mock } from 'bun:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { Gauge } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

mock.module('framer-motion', () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: {
    div: ({
      animate: _animate,
      exit: _exit,
      initial: _initial,
      transition: _transition,
      ...props
    }: HTMLAttributes<HTMLDivElement> & {
      animate?: unknown;
      exit?: unknown;
      initial?: unknown;
      transition?: unknown;
    }) => createElement('div', props),
  },
}));

const locale = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
const i18n = await createTestI18n(locale);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();

const { ContextMenuProvider, useContextMenu } = await import('../../../../src/context/ContextMenuContext.tsx');
const { useAppContextMenus } = await import('../../../../src/hooks/app/useAppContextMenus.ts');
const { useEditorStore } = await import('../../../../src/store/useEditorStore.ts');
const { useLibraryStore } = await import('../../../../src/store/useLibraryStore.ts');
const { useSettingsStore } = await import('../../../../src/store/useSettingsStore.ts');
const { useUIStore } = await import('../../../../src/store/useUIStore.ts');

const openedTargets: string[][] = [];
const rendered = await renderContextMenuHarness(() => {
  openedTargets.push(['/library/negative-lab/context-menu-negative.dng']);
});

const surface = rendered.container.querySelector<HTMLButtonElement>(
  '[data-testid="negative-lab-context-menu-surface"]',
);
assert(surface, 'Context menu surface should render.');

await act(async () => {
  surface.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 24,
      clientY: 24,
    }),
  );
  await flushTimers();
});
await waitForCondition(
  'Context menu did not focus its first item.',
  () => document.activeElement?.getAttribute('role') === 'menuitem',
);

const productivityLabel = locale.contextMenus.editor.productivity;
const convertNegativeLabel = locale.contextMenus.editor.convertNegative;

await pressKey('End');

const productivityItem = document.activeElement as HTMLButtonElement | null;
assert.equal(productivityItem?.textContent?.includes(productivityLabel), true, 'End should focus Productivity.');
assert.equal(productivityItem?.getAttribute('aria-haspopup'), 'menu', 'Productivity should expose a menu submenu.');
assert.equal(productivityItem?.getAttribute('aria-expanded'), 'false', 'Productivity submenu should start collapsed.');

await pressKey('ArrowRight');

assert.equal(
  productivityItem?.getAttribute('aria-expanded'),
  'true',
  'ArrowRight should open the Productivity submenu.',
);
assert.equal(
  document.activeElement?.textContent?.includes(locale.contextMenus.editor.autoAdjust),
  true,
  'ArrowRight should move focus into the submenu.',
);

await pressKey('ArrowDown');
await pressKey('ArrowDown');

assert.equal(
  document.activeElement?.textContent?.includes(convertNegativeLabel),
  true,
  'ArrowDown should reach Convert Negative inside Productivity.',
);

await pressKey('ArrowLeft');

assert.equal(
  document.activeElement?.textContent?.includes(productivityLabel),
  true,
  'ArrowLeft should close the submenu and return focus to Productivity.',
);
assert.equal(
  productivityItem?.getAttribute('aria-expanded'),
  'false',
  'ArrowLeft should update submenu expanded state.',
);

await pressKey('ArrowRight');
await pressKey('Home');

assert.equal(
  document.activeElement?.textContent?.includes(locale.contextMenus.editor.autoAdjust),
  true,
  'Home should focus the first submenu item.',
);

await pressKey('ArrowDown');
await pressKey('ArrowDown');
await pressKey(' ');

assert.deepEqual(
  openedTargets,
  [['/library/negative-lab/context-menu-negative.dng']],
  'Space should activate Convert Negative from the keyboard context-menu path.',
);
assert.equal(
  document.querySelector('[role="menu"]'),
  null,
  'Activating Convert Negative should close the context menu.',
);

rendered.unmount();

await assertAppThumbnailContextMenuOpensSupportedSelection();
await assertAppThumbnailContextMenuDisablesUnsupportedSelection();

console.log('negative lab context menu keyboard ok');

function ContextMenuHarness({ onOpenNegativeLab }: { onOpenNegativeLab: () => void }) {
  const { showContextMenu } = useContextMenu();

  return createElement(
    'button',
    {
      'data-testid': 'negative-lab-context-menu-surface',
      onContextMenu: (event: MouseEvent) => {
        event.preventDefault();
        showContextMenu(event.clientX, event.clientY, [
          {
            label: locale.contextMenus.editor.exportImage,
            onClick: () => undefined,
          },
          {
            icon: Gauge,
            label: locale.contextMenus.editor.productivity,
            submenu: [
              {
                label: locale.contextMenus.editor.autoAdjust,
                onClick: () => undefined,
              },
              {
                label: locale.contextMenus.editor.denoise,
                onClick: () => undefined,
              },
              {
                label: locale.contextMenus.editor.convertNegative,
                onClick: onOpenNegativeLab,
              },
            ],
          },
        ]);
      },
      type: 'button',
    },
    'Open editor context menu',
  );
}

async function renderContextMenuHarness(onOpenNegativeLab: () => void): Promise<{
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
        createElement(ContextMenuProvider, null, createElement(ContextMenuHarness, { onOpenNegativeLab })),
      ),
    );
    await flushTimers();
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

function AppThumbnailContextMenuHarness({ path }: { path: string }) {
  const menus = useAppContextMenus({
    executeDelete: async () => undefined,
    handleBackToLibrary: () => undefined,
    handleImageSelect: () => undefined,
    handleImportClick: () => undefined,
    handleLibraryRefresh: async () => undefined,
    handleRenameFiles: () => undefined,
    handleTogglePinFolder: async () => undefined,
    refreshAllFolderTrees: async () => undefined,
    refreshImageList: async () => undefined,
  });

  return createElement(
    'button',
    {
      'data-testid': 'negative-lab-app-thumbnail-context-menu-surface',
      onContextMenu: (event: MouseEvent) => {
        menus.handleThumbnailContextMenu(event, path);
      },
      type: 'button',
    },
    'Open thumbnail context menu',
  );
}

async function assertAppThumbnailContextMenuOpensSupportedSelection() {
  const supportedPath = '/library/negative-lab/context-menu-negative.dng';
  prepareAppStores({
    imagePaths: [supportedPath],
    multiSelectedPaths: [supportedPath],
    supportedTypes: { nonRaw: ['jpg', 'jpeg', 'tif', 'tiff'], raw: ['arw', 'dng'] },
  });

  const renderedAppMenu = await renderAppThumbnailContextMenuHarness(supportedPath);
  await openContextMenu(renderedAppMenu.container);
  await openProductivitySubmenu();

  const convertButton = findMenuButton(locale.contextMenus.editor.convertNegative);
  assert(convertButton, 'Actual thumbnail context menu should render Convert Negative for supported sources.');
  assert.equal(convertButton.disabled, false, 'Supported thumbnail selection should enable Convert Negative.');

  await act(async () => {
    convertButton.click();
    await flushTimers();
  });

  assert.deepEqual(
    useUIStore.getState().negativeModalState,
    { isOpen: true, targetPaths: [supportedPath] },
    'Supported thumbnail context menu should open Negative Lab with selected paths.',
  );

  renderedAppMenu.unmount();
}

async function assertAppThumbnailContextMenuDisablesUnsupportedSelection() {
  const unsupportedPath = '/library/negative-lab/readme.txt';
  prepareAppStores({
    imagePaths: [unsupportedPath],
    multiSelectedPaths: [unsupportedPath],
    supportedTypes: { nonRaw: ['jpg', 'jpeg', 'tif', 'tiff'], raw: ['arw', 'dng'] },
  });

  const renderedAppMenu = await renderAppThumbnailContextMenuHarness(unsupportedPath);
  await openContextMenu(renderedAppMenu.container);
  await openProductivitySubmenu();

  const disabledLabel = `${locale.contextMenus.thumbnail.convertNegative_one} - ${locale.negativeLabEntryPoints.disabled.unsupported}`;
  const convertButton = findMenuButton(disabledLabel);
  assert(convertButton, 'Actual thumbnail context menu should render unsupported disabled reason.');
  assert.equal(convertButton.disabled, true, 'Unsupported thumbnail selection should disable Convert Negative.');
  assert.deepEqual(
    useUIStore.getState().negativeModalState,
    { isOpen: false, targetPaths: [] },
    'Unsupported thumbnail context menu should not open Negative Lab.',
  );

  renderedAppMenu.unmount();
}

async function renderAppThumbnailContextMenuHarness(path: string): Promise<{
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
        createElement(ContextMenuProvider, null, createElement(AppThumbnailContextMenuHarness, { path })),
      ),
    );
    await flushTimers();
  });

  return {
    container,
    root,
    unmount: () => {
      act(() => {
        root.unmount();
      });
      container.remove();
      document.querySelectorAll('[role="menu"]').forEach((menu) => menu.remove());
    },
  };
}

function prepareAppStores({
  imagePaths,
  multiSelectedPaths,
  supportedTypes,
}: {
  imagePaths: string[];
  multiSelectedPaths: string[];
  supportedTypes: { nonRaw: string[]; raw: string[] };
}) {
  useEditorStore.setState({ copiedAdjustments: null, selectedImage: null });
  useLibraryStore.setState({
    activeAlbumId: null,
    albumTree: [],
    imageList: imagePaths.map((path) => ({
      exif: null,
      is_edited: false,
      is_virtual_copy: false,
      modified: 0,
      path,
      rating: 0,
      tags: null,
    })),
    libraryActivePath: multiSelectedPaths[0] ?? null,
    multiSelectedPaths,
  });
  useSettingsStore.setState({ appSettings: null, supportedTypes });
  useUIStore.setState({ negativeModalState: { isOpen: false, targetPaths: [] } });
}

async function openContextMenu(container: HTMLElement) {
  const surface = container.querySelector<HTMLButtonElement>(
    '[data-testid="negative-lab-app-thumbnail-context-menu-surface"]',
  );
  assert(surface, 'App thumbnail context menu surface should render.');
  await act(async () => {
    surface.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: 48,
        clientY: 48,
      }),
    );
    await flushTimers();
  });
}

async function openProductivitySubmenu() {
  const productivityButton = findMenuButton(locale.contextMenus.editor.productivity);
  assert(productivityButton, 'Productivity submenu should render in actual thumbnail context menu.');
  await act(async () => {
    productivityButton.focus();
    productivityButton.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }),
    );
    await flushTimers();
  });
  assert.equal(productivityButton.getAttribute('aria-expanded'), 'true', 'Productivity submenu should open.');
}

function findMenuButton(label: string): HTMLButtonElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find((button) =>
      button.textContent?.includes(label),
    ) ?? null
  );
}

async function pressKey(key: string) {
  await act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }));
    await flushTimers();
  });
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
  const window = new Window({ pretendToBeVisual: true, url: 'http://localhost/' });
  Object.assign(globalThis, {
    document: window.document,
    HTMLElement: window.HTMLElement,
    HTMLButtonElement: window.HTMLButtonElement,
    KeyboardEvent: window.KeyboardEvent,
    MouseEvent: window.MouseEvent,
    navigator: window.navigator,
    Node: window.Node,
    requestAnimationFrame: window.requestAnimationFrame.bind(window),
    window,
  });
}

async function flushTimers() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function waitForCondition(message: string, check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    if (check()) return;
    await act(async () => {
      await flushTimers();
    });
  }

  throw new Error(message);
}
