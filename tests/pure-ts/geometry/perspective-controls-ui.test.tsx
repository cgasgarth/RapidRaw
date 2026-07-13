import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import TransformLens from '../../../src/components/adjustments/TransformLens.tsx';
import en from '../../../src/i18n/locales/en.json';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let rendered: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (rendered !== null) {
    act(() => rendered?.root.unmount());
    rendered.container.remove();
    rendered = null;
  }
});

test('guided perspective controls create source-normalized horizontal and vertical evidence', async () => {
  installDom();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  rendered = { container, root };
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(PerspectiveHarness)));
    await flushPromises();
  });
  const buttons = Array.from(container.querySelectorAll('button'));
  const horizontal = buttons.find((button) => button.textContent?.includes('Add horizontal guide'));
  const vertical = buttons.find((button) => button.textContent?.includes('Add vertical guide'));
  if (horizontal === undefined || vertical === undefined) throw new Error('Expected guided line controls');
  await act(async () => {
    horizontal.click();
    vertical.click();
    await flushPromises();
  });
  const state = container.querySelector('[data-testid="perspective-state"]')?.textContent ?? '';
  expect(state).toContain('"horizontal"');
  expect(state).toContain('"vertical"');
  expect(container.querySelector('[data-testid="perspective-guide-list"]')).not.toBeNull();
});

function PerspectiveHarness() {
  const [adjustments, setAdjustments] = useState<Adjustments>({
    ...INITIAL_ADJUSTMENTS,
    perspectiveCorrection: { ...INITIAL_ADJUSTMENTS.perspectiveCorrection, mode: 'guided' },
  });
  return createElement(
    'div',
    null,
    createElement(TransformLens, {
      adjustments,
      selectedImage: null,
      setAdjustments: (update) => {
        setAdjustments((current) => (typeof update === 'function' ? update(current) : { ...current, ...update }));
      },
    }),
    createElement(
      'output',
      { 'data-testid': 'perspective-state' },
      JSON.stringify(adjustments.perspectiveCorrection.guides),
    ),
  );
}

function installDom() {
  const window = new Window({ url: 'http://localhost/perspective-controls-test' });
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: { invoke: async () => [] },
  });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
