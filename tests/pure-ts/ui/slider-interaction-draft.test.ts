import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, type i18n, initReactI18next } from 'react-i18next';

import Slider, { type SliderChangeEvent } from '../../../src/components/ui/primitives/Slider.tsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let mounted: { container: HTMLDivElement; root: Root } | null = null;

afterEach(() => {
  if (mounted !== null) {
    act(() => mounted?.root.unmount());
    mounted.container.remove();
    mounted = null;
  }
});

test('idle controlled updates render synchronously while an active drag holds only its interaction draft', async () => {
  const changes: number[] = [];
  const dragStates: boolean[] = [];
  const view = await renderSlider(10, changes, dragStates);
  const range = requiredRange(view.container);
  range.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;

  await view.render(20);
  expect(requiredRange(view.container).value).toBe('20');

  await act(async () => {
    range.dispatchEvent(mouseEvent('mousedown', 50));
    await flushPromises();
  });
  expect(changes).toEqual([50]);
  expect(dragStates).toEqual([true]);
  expect(requiredRange(view.container).value).toBe('50');

  await view.render(25);
  expect(requiredRange(view.container).value).toBe('50');

  await act(async () => {
    window.dispatchEvent(mouseEvent('mouseup', 50));
    window.dispatchEvent(mouseEvent('mouseup', 50));
    await flushPromises();
  });
  expect(requiredRange(view.container).value).toBe('25');
  expect(dragStates).toEqual([true, false]);
});

test('a wheel burst keeps its draft through delayed parent renders and falls back without a synthetic change', async () => {
  const changes: number[] = [];
  const dragStates: boolean[] = [];
  const view = await renderSlider(10, changes, dragStates);
  const slider = view.container.querySelector<HTMLElement>('[data-testid="draft-slider"]');
  if (slider === null) throw new Error('Expected slider root.');

  await act(async () => {
    slider.dispatchEvent(wheelEvent(-100));
    await flushPromises();
  });
  expect(changes).toEqual([11]);
  expect(dragStates).toEqual([]);
  expect(requiredRange(view.container).value).toBe('11');

  await view.render(8);
  expect(requiredRange(view.container).value).toBe('11');

  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 180));
  });
  expect(requiredRange(view.container).value).toBe('8');
  expect(changes).toEqual([11]);
});

test('touch promotion and cancellation share the exact once drag boundary', async () => {
  const changes: number[] = [];
  const dragStates: boolean[] = [];
  const view = await renderSlider(10, changes, dragStates);
  const range = requiredRange(view.container);
  range.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;

  await act(async () => {
    range.dispatchEvent(touchEvent('touchstart', 10, 10));
    range.dispatchEvent(touchEvent('touchmove', 30, 10));
    await flushPromises();
  });
  expect(changes).toEqual([30]);
  expect(dragStates).toEqual([true]);

  await act(async () => {
    range.dispatchEvent(touchEvent('touchcancel'));
    await flushPromises();
  });
  expect(dragStates).toEqual([true, false]);
  expect(requiredRange(view.container).value).toBe('10');
});

async function renderSlider(value: number, changes: number[], dragStates: boolean[]) {
  installDom();
  const translations = await createTestI18n();
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const render = async (nextValue: number) => {
    await act(async () => {
      root.render(
        createElement(
          I18nextProvider,
          { i18n: translations },
          createElement(Slider, {
            defaultValue: 0,
            label: 'Exposure',
            max: 100,
            min: 0,
            onChange: (event: SliderChangeEvent) => changes.push(Number(event.target.value)),
            onDragStateChange: (state: boolean) => dragStates.push(state),
            step: 1,
            testId: 'draft-slider',
            value: nextValue,
          }),
        ),
      );
      await flushPromises();
    });
  };
  await render(value);
  mounted = { container, root };
  return { container, render };
}

function requiredRange(container: Element) {
  const range = container.querySelector<HTMLInputElement>('[data-testid="draft-slider-range"]');
  if (range === null) throw new Error('Expected range input.');
  return range;
}

function mouseEvent(type: string, clientX: number) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clientX', { value: clientX });
  return event;
}

function wheelEvent(deltaY: number) {
  const event = new window.Event('wheel', { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    deltaX: { value: 0 },
    deltaY: { value: deltaY },
    shiftKey: { value: true },
  });
  return event;
}

function touchEvent(type: string, clientX?: number, clientY?: number) {
  const event = new window.Event(type, { bubbles: true, cancelable: true });
  const touches = clientX === undefined || clientY === undefined ? [] : [{ clientX, clientY }];
  Object.defineProperty(event, 'touches', { value: touches });
  return event;
}

function installDom() {
  const testWindow = new Window({ url: 'http://localhost/slider-interaction-test' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: testWindow });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: testWindow.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: testWindow.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: testWindow.HTMLElement });
}

async function createTestI18n(): Promise<i18n> {
  const instance = i18next.createInstance();
  await instance.use(initReactI18next).init({
    defaultNS: 'translation',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: { ui: { slider: { clickToEdit: 'Click to edit', reset: 'Reset' } } } } },
  });
  return instance;
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}
