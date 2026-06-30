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
