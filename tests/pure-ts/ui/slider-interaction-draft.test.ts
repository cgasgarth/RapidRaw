import { expect, test } from 'bun:test';
import { act, fireEvent, render as testingRender } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, type i18n, initReactI18next } from 'react-i18next';

import Slider, { type SliderChangeEvent } from '../../../src/components/ui/primitives/Slider.tsx';

test('idle controlled updates render synchronously while an active drag holds only its interaction draft', async () => {
  const changes: number[] = [];
  const dragStates: boolean[] = [];
  const view = await renderSlider(10, changes, dragStates);
  const range = requiredRange(view.container);
  range.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;

  await view.render(20);
  expect(requiredRange(view.container).value).toBe('20');

  fireEvent.mouseDown(range, { clientX: 50 });
  expect(changes).toEqual([50]);
  expect(dragStates).toEqual([true]);
  expect(requiredRange(view.container).value).toBe('50');

  await view.render(25);
  expect(requiredRange(view.container).value).toBe('50');

  fireEvent.mouseUp(window, { clientX: 50 });
  fireEvent.mouseUp(window, { clientX: 50 });
  expect(requiredRange(view.container).value).toBe('25');
  expect(dragStates).toEqual([true, false]);
});

test('a wheel burst keeps its draft through delayed parent renders and falls back without a synthetic change', async () => {
  const changes: number[] = [];
  const dragStates: boolean[] = [];
  const view = await renderSlider(10, changes, dragStates);
  const slider = view.container.querySelector<HTMLElement>('[data-testid="draft-slider"]');
  if (slider === null) throw new Error('Expected slider root.');

  const wheel = new Event('wheel', { bubbles: true, cancelable: true });
  Object.defineProperties(wheel, {
    deltaX: { value: 0 },
    deltaY: { value: -100 },
    shiftKey: { value: true },
  });
  await act(async () => {
    slider.dispatchEvent(wheel);
    await Promise.resolve();
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

  fireEvent.touchStart(range, { touches: [{ clientX: 10, clientY: 10 }] });
  fireEvent.touchMove(range, { touches: [{ clientX: 30, clientY: 10 }] });
  expect(changes).toEqual([30]);
  expect(dragStates).toEqual([true]);

  fireEvent.touchCancel(range, { touches: [] });
  expect(dragStates).toEqual([true, false]);
  expect(requiredRange(view.container).value).toBe('10');
});

test('explicit lifecycle previews many pointer values but commits or cancels exactly once', async () => {
  const changes: number[] = [];
  const dragStates: boolean[] = [];
  const lifecycle: string[] = [];
  const view = await renderSlider(10, changes, dragStates, lifecycle);
  const range = requiredRange(view.container);
  range.getBoundingClientRect = () => ({ left: 0, width: 100 }) as DOMRect;

  fireEvent.mouseDown(range, { clientX: 20 });
  fireEvent.mouseMove(window, { clientX: 35 });
  fireEvent.mouseMove(window, { clientX: 60 });
  fireEvent.mouseUp(window, { clientX: 60 });
  expect(changes.length).toBeGreaterThanOrEqual(3);
  expect(lifecycle).toEqual(['start', 'commit']);

  lifecycle.length = 0;
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 310));
    fireEvent.mouseDown(range, { clientX: 40 });
    fireEvent.mouseMove(window, { clientX: 50 });
    fireEvent(window, new Event('blur'));
    fireEvent.mouseUp(window, { clientX: 50 });
  });
  expect(lifecycle).toEqual(['start', 'cancel']);
});

test('typed numeric text commits once without creating a transient preview interaction', async () => {
  const changes: number[] = [];
  const dragStates: boolean[] = [];
  const lifecycle: string[] = [];
  const view = await renderSlider(10, changes, dragStates, lifecycle);
  const user = userEvent.setup();
  const valueButton = view.container.querySelector<HTMLElement>('[data-testid="draft-slider-value"]');
  if (valueButton === null) throw new Error('Expected numeric value button.');

  await user.click(valueButton);
  const input = view.container.querySelector<HTMLInputElement>('[data-testid="draft-slider-input"]');
  if (input === null) throw new Error('Expected numeric value input.');
  await user.clear(input);
  await user.type(input, '42{Enter}');

  expect(changes).toEqual([42]);
  expect(lifecycle).toEqual([]);
});

async function renderSlider(value: number, changes: number[], dragStates: boolean[], lifecycle?: string[]) {
  const translations = await createTestI18n();
  const element = (nextValue: number) =>
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
        onInteractionCancel: lifecycle ? () => lifecycle.push('cancel') : undefined,
        onInteractionCommit: lifecycle ? () => lifecycle.push('commit') : undefined,
        onInteractionStart: lifecycle ? () => lifecycle.push('start') : undefined,
        step: 1,
        testId: 'draft-slider',
        value: nextValue,
      }),
    );
  const rendered = testingRender(element(value));
  const render = async (nextValue: number) => {
    rendered.rerender(element(nextValue));
  };
  return { container: rendered.container, render };
}

function requiredRange(container: Element) {
  const range = container.querySelector<HTMLInputElement>('[data-testid="draft-slider-range"]');
  if (range === null) throw new Error('Expected range input.');
  return range;
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
