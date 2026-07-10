import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import BasicAdjustments from '../../../src/components/adjustments/Basic';
import en from '../../../src/i18n/locales/en.json';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';

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

test('Light controls use the canonical tonal order and stable aligned rows', async () => {
  const { container } = await renderBasic();
  const rows = container.querySelectorAll('[data-density="compact"][data-testid^="basic-control-"]');
  const ids = Array.from(rows).map((element) => element.getAttribute('data-testid'));

  expect(ids).toEqual([
    'basic-control-exposure',
    'basic-control-contrast',
    'basic-control-highlights',
    'basic-control-shadows',
    'basic-control-whites',
    'basic-control-blacks',
    'basic-control-brightness',
  ]);
  expect(container.querySelector('[data-testid="basic-secondary-controls"]')?.textContent).toContain('Brightness');

  for (const row of rows) {
    expect(row.getAttribute('data-density')).toBe('compact');
    expect(row.querySelector('[data-slider-track="true"]')).not.toBeNull();
    expect(row.querySelector('[data-slider-value-slot="true"]')).not.toBeNull();
  }
});

test('tone mapper switching preserves tone values and exposes edited/reset state', async () => {
  const initialAdjustments: Adjustments = {
    ...INITIAL_ADJUSTMENTS,
    brightness: 0.4,
    contrast: 18,
    exposure: 0.65,
  };
  const { container, getAdjustments } = await renderBasic({ initialAdjustments });
  const mapperRow = getRequiredElement<HTMLDivElement>(container, '[data-testid="basic-tone-mapper"]');
  const agx = getRequiredElement<HTMLButtonElement>(mapperRow, '[role="radio"]:last-child');

  await act(async () => {
    agx.click();
    await flushPromises();
  });

  expect(getAdjustments()).toMatchObject({ brightness: 0.4, contrast: 18, exposure: 0.65, toneMapper: 'agx' });
  expect(mapperRow.dataset.modified).toBe('true');

  await act(async () => {
    getRequiredElement<HTMLButtonElement>(mapperRow, '[data-testid="basic-tone-mapper-label"]').click();
    await flushPromises();
  });

  expect(getAdjustments()).toMatchObject({ brightness: 0.4, contrast: 18, exposure: 0, toneMapper: 'basic' });
  expect(mapperRow.dataset.modified).toBe('false');
});

test('mask and forced tone-mapper contexts omit only the global process selector', async () => {
  const maskRender = await renderBasic({ isForMask: true });
  expect(maskRender.container.querySelector('[data-testid="basic-tone-mapper"]')).toBeNull();
  expect(maskRender.container.querySelector('[data-testid="basic-control-exposure"]')).not.toBeNull();
  unmountRenderedRoot();

  const overrideRender = await renderBasic({ tonemapperOverrideEnabled: true });
  expect(overrideRender.container.querySelector('[data-testid="basic-tone-mapper"]')).toBeNull();
  expect(
    overrideRender.container.querySelectorAll('[data-density="compact"][data-testid^="basic-control-"]'),
  ).toHaveLength(7);
});

function BasicHarness({
  initialAdjustments,
  isForMask,
  onAdjustmentsChange,
  tonemapperOverrideEnabled,
}: {
  initialAdjustments: Adjustments;
  isForMask: boolean;
  onAdjustmentsChange: (adjustments: Adjustments) => void;
  tonemapperOverrideEnabled: boolean;
}) {
  const [adjustments, setAdjustmentsState] = useState(initialAdjustments);

  return createElement(BasicAdjustments, {
    adjustments,
    appSettings: tonemapperOverrideEnabled ? { tonemapperOverrideEnabled: true } : undefined,
    isForMask,
    setAdjustments: (update) => {
      setAdjustmentsState((previous) => {
        const next = typeof update === 'function' ? update(previous) : { ...previous, ...update };
        onAdjustmentsChange(next);
        return next;
      });
    },
  });
}

async function renderBasic({
  initialAdjustments = INITIAL_ADJUSTMENTS,
  isForMask = false,
  tonemapperOverrideEnabled = false,
}: {
  initialAdjustments?: Adjustments;
  isForMask?: boolean;
  tonemapperOverrideEnabled?: boolean;
} = {}) {
  installDom();
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  let currentAdjustments = initialAdjustments;

  await act(async () => {
    root.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(BasicHarness, {
          initialAdjustments,
          isForMask,
          onAdjustmentsChange: (adjustments) => {
            currentAdjustments = adjustments;
          },
          tonemapperOverrideEnabled,
        }),
      ),
    );
    await flushPromises();
  });

  renderedRoot = { container, root };
  return { container, getAdjustments: () => currentAdjustments };
}

function unmountRenderedRoot() {
  if (renderedRoot === null) return;
  act(() => {
    renderedRoot?.root.unmount();
  });
  renderedRoot.container.remove();
  renderedRoot = null;
}

function getRequiredElement<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

function installDom() {
  const window = new Window({ url: 'http://localhost/basic-light-controls-test' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
