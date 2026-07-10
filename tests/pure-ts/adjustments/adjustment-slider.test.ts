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
  const changes: number[] = [];
  const { container } = await renderAdjustmentSlider({ changes });

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
});

test('adjustment slider numeric edits commit, cancel, and increment predictably', async () => {
  const changes: number[] = [];
  const { container } = await renderAdjustmentSlider({ changes, max: 20, min: -20, step: 0.5, value: 10 });

  const valueButton = getRequiredElement<HTMLButtonElement>(container, '[data-testid="precision-slider-value"]');
  await act(async () => {
    valueButton.click();
    await flushPromises();
  });

  const input = getRequiredElement<HTMLInputElement>(container, '[data-testid="precision-slider-input"]');
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(input, '12,5');
  await act(async () => {
    input.dispatchEvent(createInputEvent());
    input.dispatchEvent(new window.Event('change', { bubbles: true }));
    await flushPromises();
  });
  expect(changes).toEqual([]);

  await act(async () => {
    input.blur();
    await flushPromises();
  });
  expect(changes).toEqual([12.5]);
  expect(container.querySelector('[data-testid="current-value"]')?.textContent).toBe('12.5');

  await act(async () => {
    getRequiredElement<HTMLButtonElement>(container, '[data-testid="precision-slider-value"]').click();
    await flushPromises();
  });
  const enterInput = getRequiredElement<HTMLInputElement>(container, '[data-testid="precision-slider-input"]');
  valueSetter?.call(enterInput, '13.5');
  await act(async () => {
    enterInput.dispatchEvent(createInputEvent());
    enterInput.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
    await flushPromises();
  });
  expect(changes).toEqual([12.5, 13.5]);
  expect(document.activeElement).toBe(
    getRequiredElement<HTMLButtonElement>(container, '[data-testid="precision-slider-value"]'),
  );

  await act(async () => {
    getRequiredElement<HTMLButtonElement>(container, '[data-testid="precision-slider-value"]').click();
    await flushPromises();
  });
  const reopenedInput = getRequiredElement<HTMLInputElement>(container, '[data-testid="precision-slider-input"]');
  await act(async () => {
    reopenedInput.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowUp' }));
    await flushPromises();
  });
  expect(changes).toEqual([12.5, 13.5, 14]);

  valueSetter?.call(reopenedInput, '19');
  await act(async () => {
    reopenedInput.dispatchEvent(createInputEvent());
    reopenedInput.dispatchEvent(new window.Event('change', { bubbles: true }));
    reopenedInput.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    await flushPromises();
  });
  expect(changes).toEqual([12.5, 13.5, 14, 13.5]);
  expect(container.querySelector('[data-testid="current-value"]')?.textContent).toBe('13.5');
  expect(document.activeElement).toBe(
    getRequiredElement<HTMLButtonElement>(container, '[data-testid="precision-slider-value"]'),
  );
});

test('compact adjustment slider supports shift wheel edits and label reset hooks', async () => {
  const changes: number[] = [];
  const { container } = await renderAdjustmentSlider({
    changes,
    defaultValue: 0,
    density: 'compact',
    max: 5,
    min: -5,
    step: 0.1,
    value: 1,
  });

  const root = getRequiredElement<HTMLDivElement>(container, '[data-testid="precision-slider"]');
  expect(root.dataset.density).toBe('compact');
  expect(root.dataset.modified).toBe('true');
  expect(root.querySelector('[data-slider-track="true"]')).not.toBeNull();
  expect(root.querySelector('[data-slider-value-slot="true"]')?.className).toContain('w-[3.5rem]');
  const wheelEvent = createWheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100, shiftKey: true });
  await act(async () => {
    root.dispatchEvent(wheelEvent);
    await flushPromises();
  });
  expect(changes).toEqual([1.1]);

  const label = getRequiredElement<HTMLButtonElement>(container, '[data-testid="precision-slider-label"]');
  await act(async () => {
    label.click();
    await flushPromises();
  });
  expect(changes).toEqual([1.1, 0]);
  expect(root.dataset.modified).toBe('false');
});

function AdjustmentSliderHarness({
  changes,
  defaultValue = 0,
  density,
  max = 100,
  min = 0,
  step = 1,
  value: initialValue = 10,
}: {
  changes: number[];
  defaultValue?: number;
  density?: 'default' | 'compact';
  max?: number;
  min?: number;
  step?: number;
  value?: number;
}) {
  const [value, setValue] = useState(initialValue);

  return createElement(
    'div',
    null,
    createElement(AdjustmentSlider, {
      label: 'Exposure',
      defaultValue,
      density,
      max,
      min,
      onValueChange: (nextValue) => {
        changes.push(nextValue);
        setValue(nextValue);
      },
      step,
      testId: 'precision-slider',
      value,
    }),
    createElement('output', { 'data-testid': 'current-value' }, String(value)),
  );
}

async function renderAdjustmentSlider(
  props: Omit<Parameters<typeof AdjustmentSliderHarness>[0], 'changes'> & { changes: number[] },
) {
  installDom();
  const i18n = await createTestI18n();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(createElement(I18nextProvider, { i18n }, createElement(AdjustmentSliderHarness, props)));
    await flushPromises();
  });

  renderedRoot = { container, root };
  return { container, root };
}

function getRequiredElement<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Expected ${selector} to render.`);
  }
  return element;
}

function createWheelEvent(type: string, init: WheelEventInit): Event {
  const event = new window.Event(type, init);
  Object.defineProperties(event, {
    deltaX: { value: init.deltaX ?? 0 },
    deltaY: { value: init.deltaY ?? 0 },
    shiftKey: { value: init.shiftKey ?? false },
  });
  return event;
}

function createInputEvent(): Event {
  if ('InputEvent' in window) {
    return new window.InputEvent('input', { bubbles: true });
  }
  return new window.Event('input', { bubbles: true });
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
