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
    if (command === 'get_lensfun_makers' || command === 'get_lensfun_lenses_for_maker') {
      return [];
    }
    return null;
  },
}));
mock.module('@tauri-apps/plugin-os', () => ({ platform: () => 'macos' }));

type RenderedPanel = {
  container: HTMLDivElement;
  root: Root;
  unmount: () => void;
};
type ReactInputProps = {
  onChange?: (event: { currentTarget: HTMLInputElement }) => void;
};

const failures: string[] = [];

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
  import('../../../../../src/components/panel/right/color/ControlsPanel.tsx'),
  import('../../../../../src/context/ContextMenuContext.tsx'),
  import('../../../../../src/components/ui/AppProperties.tsx'),
  import('../../../../../src/store/useEditorStore.ts'),
  import('../../../../../src/store/useSettingsStore.ts'),
  import('../../../../../src/store/useUIStore.ts'),
  import('../../../../../src/utils/adjustments.ts'),
]);

const i18n = await createTestI18n();

await validateDevelopPanelSearchKeyboard();

if (failures.length > 0) {
  console.error('develop panel search keyboard check failed');
  console.error(failures.slice(0, 12).join('\n'));
  process.exit(1);
}

console.log('develop panel search keyboard ok');

async function validateDevelopPanelSearchKeyboard() {
  useSettingsStore.getState().setAppSettings({
    lastRootPath: null,
    theme: Theme.Dark,
  });
  useUIStore.getState().setDevelopPanelPinnedControlIds([]);
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
    adjustments: { ...INITIAL_ADJUSTMENTS },
    copiedSectionAdjustments: null,
    histogram: null,
    isWaveformVisible: false,
    selectedImage: null,
  });

  const rendered = await renderPanel();
  const searchInput = getByLabel<HTMLInputElement>(rendered.container, 'Search adjustment controls');
  await input(searchInput, 'dehaze');
  await flushPromises();

  const result = getByTestId<HTMLButtonElement>(rendered.container, 'develop-panel-search-result-dehaze');
  await keyDown(result, 'Enter');

  assert.deepEqual(useUIStore.getState().developPanelPinnedControlIds, ['dehaze']);
  assert.equal(
    document.activeElement?.getAttribute('data-testid'),
    'develop-pinned-control-dehaze-range',
    'Enter activation should focus the newly pinned control range.',
  );

  await keyDown(result, ' ');

  assert.deepEqual(useUIStore.getState().developPanelPinnedControlIds, []);
  assert.equal(
    getByTestId(rendered.container, 'adjustments-section-details')
      .querySelector('[role="button"][aria-expanded]')
      ?.getAttribute('aria-expanded'),
    'true',
    'Space activation on a pinned result should reveal the canonical section.',
  );
  assert.equal(
    document.activeElement?.getAttribute('aria-label'),
    'Dehaze',
    'Space activation on a pinned result should focus the canonical Dehaze control.',
  );
  assert.equal(
    rendered.container.querySelector('[data-testid="develop-panel-pinned-control-row-dehaze"]'),
    null,
    'Space activation should unpin the active search result.',
  );

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
  const window = new Window({ url: 'http://localhost/develop-panel-search-keyboard' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
  Object.defineProperty(globalThis, 'HTMLButtonElement', { configurable: true, value: window.HTMLButtonElement });
  Object.defineProperty(globalThis, 'HTMLInputElement', { configurable: true, value: window.HTMLInputElement });
  Object.defineProperty(globalThis, 'KeyboardEvent', { configurable: true, value: window.KeyboardEvent });
  Object.defineProperty(globalThis, 'MouseEvent', { configurable: true, value: window.MouseEvent });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: window.Event });
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

function getByLabel<T extends Element>(container: Element, label: string): T {
  const element = container.querySelector(`[aria-label="${label}"]`);
  assert.ok(element, `missing aria label: ${label}`);
  return element as T;
}

async function input(element: HTMLInputElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
    valueSetter?.call(element, value);
    const reactPropKey = Object.keys(element).find((key) => key.startsWith('__reactProps$'));
    if (!reactPropKey) {
      throw new Error('search input did not expose React props for controlled update.');
    }
    const reactProps = (element as HTMLInputElement & Record<string, ReactInputProps | undefined>)[reactPropKey];
    reactProps?.onChange?.({ currentTarget: element });
    await flushPromises();
  });
}

async function keyDown(element: HTMLElement, key: string) {
  await act(async () => {
    element.focus();
    element.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key }));
    await flushPromises();
    await flushPromises();
  });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
