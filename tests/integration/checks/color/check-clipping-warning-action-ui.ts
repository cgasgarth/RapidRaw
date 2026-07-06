#!/usr/bin/env bun

import { mock } from 'bun:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

mock.module('@tauri-apps/api/core', () => ({
  invoke: async (command: string) => {
    if (command === 'get_lensfun_makers' || command === 'get_lensfun_lenses_for_maker') return [];
    return null;
  },
}));
mock.module('@tauri-apps/plugin-os', () => ({ platform: () => 'macos' }));

type RenderedPanel = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
};

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
installDom();

const [
  { default: ControlsPanel },
  { ContextMenuProvider },
  { Theme },
  { useEditorStore },
  { useSettingsStore },
  { useUIStore },
  { INITIAL_ADJUSTMENTS },
] = await Promise.all([
  import('../../../../src/components/panel/right/color/ControlsPanel.tsx'),
  import('../../../../src/context/ContextMenuContext.tsx'),
  import('../../../../src/components/ui/AppProperties.tsx'),
  import('../../../../src/store/useEditorStore.ts'),
  import('../../../../src/store/useSettingsStore.ts'),
  import('../../../../src/store/useUIStore.ts'),
  import('../../../../src/utils/adjustments.ts'),
]);

const failures: string[] = [];
const i18n = await createTestI18n();

await validateClippingWarningAction();

if (failures.length > 0) {
  console.error('clipping warning action check failed');
  console.error(failures.slice(0, 12).join('\n'));
  process.exit(1);
}

console.log('clipping warning action ok');

async function validateClippingWarningAction() {
  useSettingsStore.getState().setAppSettings({
    lastRootPath: null,
    theme: Theme.Dark,
  });
  useUIStore.getState().setUI({
    collapsibleSectionsState: {
      basic: true,
      color: false,
      curves: false,
      details: false,
      effects: false,
      transformLens: false,
    },
  });
  useEditorStore.getState().setEditor({
    adjustments: {
      ...INITIAL_ADJUSTMENTS,
      levels: {
        ...INITIAL_ADJUSTMENTS.levels,
        inputBlack: 0.08,
        inputWhite: 0.9,
      },
    },
    copiedSectionAdjustments: null,
    histogram: null,
    isWaveformVisible: false,
    selectedImage: null,
  });

  const rendered = await renderPanel();
  const warning = getByTestId(rendered.container, 'adjustments-clipping-warning');
  assert.equal(warning.getAttribute('data-clipping-state'), 'shadow-clipping highlight-clipping');

  const resetButton = getByTestId<HTMLButtonElement>(rendered.container, 'adjustments-clipping-reset-endpoints');
  await click(resetButton);

  const levels = useEditorStore.getState().adjustments.levels;
  assert.equal(levels.inputBlack, INITIAL_ADJUSTMENTS.levels.inputBlack);
  assert.equal(levels.inputWhite, INITIAL_ADJUSTMENTS.levels.inputWhite);
  assert.equal(rendered.container.querySelector('[data-testid="adjustments-clipping-warning"]'), null);

  rendered.unmount();
}

async function renderPanel(): Promise<RenderedPanel> {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      createElement(I18nextProvider, { i18n }, createElement(ContextMenuProvider, null, createElement(ControlsPanel))),
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

function installDom() {
  const window = new Window({ url: 'http://localhost/clipping-warning-action' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
  Object.defineProperty(globalThis, 'HTMLButtonElement', { configurable: true, value: window.HTMLButtonElement });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: window.Event });
  Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: window.MouseEvent });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: window.Node });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: window.MutationObserver });
  Object.defineProperty(globalThis, 'PointerEvent', { configurable: true, value: window.PointerEvent ?? window.Event });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class ResizeObserver {
      observe() {}
      disconnect() {}
    },
  });
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: () => undefined,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0),
  });
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 0),
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: (id: number) => window.clearTimeout(id),
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: (id: number) => window.clearTimeout(id),
  });
}

async function createTestI18n() {
  const resources = JSON.parse(readFileSync('src/i18n/locales/en.json', 'utf8'));
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: resources } },
  });
  return instance;
}

function getByTestId<T extends Element>(container: Element, testId: string): T {
  const element = container.querySelector(`[data-testid="${testId}"]`);
  assert.ok(element, `missing test id: ${testId}`);
  return element as T;
}

async function click(element: HTMLElement) {
  await act(async () => {
    element.click();
    await flushPromises();
    await flushPromises();
  });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
