import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import AdjustmentSlider from '../../../src/components/adjustments/AdjustmentSlider.tsx';
import { getSliderEventNumber } from '../../../src/components/adjustments/adjustmentSliderValue.ts';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let renderedRoot: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (renderedRoot !== null) {
    act(() => {
      renderedRoot?.root.unmount();
    });
    renderedRoot.container.remove();
    renderedRoot = null;
  }
});

test('getSliderEventNumber accepts string and numeric slider event values', () => {
  expect(getSliderEventNumber({ target: { value: '12.5' } })).toBe(12.5);
  expect(getSliderEventNumber({ target: { value: -3 } })).toBe(-3);
});

test('adjustment sliders update from native input events', async () => {
  installDom();
  const i18n = await createTestI18n();
  const changes: number[] = [];
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(AdjustmentSliderHarness, { changes })));
  });

  const slider = container.querySelector('input[type="range"]');
  if (!slider) throw new Error('Expected adjustment slider input to render.');

  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(slider, '42');
  await act(async () => {
    slider.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flushPromises();
  });

  expect(changes).toEqual([42]);
  expect(container.querySelector('[data-testid="current-value"]')?.textContent).toBe('42');

  renderedRoot = { container, root };
});

function AdjustmentSliderHarness({ changes }: { changes: number[] }) {
  const [value, setValue] = useState(10);

  return createElement(
    'div',
    null,
    createElement(AdjustmentSlider, {
      label: 'Exposure',
      max: 100,
      min: 0,
      onValueChange: (nextValue) => {
        changes.push(nextValue);
        setValue(nextValue);
      },
      step: 1,
      value,
    }),
    createElement('output', { 'data-testid': 'current-value' }, String(value)),
  );
}

function installDom() {
  const window = new Window({ url: 'http://localhost/adjustment-slider-test' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
}

async function createTestI18n() {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: {
      en: {
        translation: {
          ui: {
            slider: {
              clickToEdit: 'Click to edit',
              reset: 'Reset',
            },
          },
        },
      },
    },
  });
  return instance;
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
