import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import DetailsPanel from '../../../src/components/adjustments/Details.tsx';
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

test('Detail inspector exposes and commits independent professional denoise controls', async () => {
  installDom();
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  rendered = { container, root };

  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(DenoiseControlsHarness)));
    await flushPromises();
  });

  for (const label of ['Luminance', 'Color', 'Detail', 'Natural grain', 'Contrast protection', 'Shadow bias']) {
    if (findSliderByLabel(container, label) === null)
      throw new Error(`Expected ${label} slider in ${container.textContent?.slice(0, 500) ?? ''}`);
  }

  const naturalGrain = findSliderByLabel(container, 'Natural grain');
  if (naturalGrain === null) throw new Error('Expected Natural grain slider');
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(naturalGrain, '42');
  await act(async () => {
    naturalGrain.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flushPromises();
  });

  expect(container.querySelector('[data-testid="denoise-control-state"]')?.textContent).toContain(
    '"denoiseNaturalGrain":42',
  );
});

function DenoiseControlsHarness() {
  const [adjustments, setAdjustments] = useState<Adjustments>(INITIAL_ADJUSTMENTS);
  return createElement(
    'div',
    null,
    createElement(DetailsPanel, {
      adjustments,
      appSettings: null,
      setAdjustments: (update) => {
        setAdjustments((current) => (typeof update === 'function' ? update(current) : { ...current, ...update }));
      },
    }),
    createElement(
      'output',
      { 'data-testid': 'denoise-control-state' },
      JSON.stringify({
        denoiseContrastProtection: adjustments.denoiseContrastProtection,
        denoiseDetail: adjustments.denoiseDetail,
        denoiseNaturalGrain: adjustments.denoiseNaturalGrain,
        denoiseShadowBias: adjustments.denoiseShadowBias,
      }),
    ),
  );
}

function findSliderByLabel(container: Element, label: string): HTMLInputElement | null {
  const labelElement = Array.from(container.querySelectorAll('*')).find(
    (element) => element.textContent?.trim() === label,
  );
  let candidate = labelElement;
  while (candidate !== undefined && candidate !== null && candidate !== container) {
    const slider = candidate.querySelector<HTMLInputElement>('input[type="range"]');
    if (slider !== null) return slider;
    candidate = candidate.parentElement ?? undefined;
  }
  return null;
}

function installDom() {
  const window = new Window({ url: 'http://localhost/denoise-controls-test' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
