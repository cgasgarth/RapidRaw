import { beforeEach, expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement, useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { ColorGradingControls } from '../../../src/components/adjustments/color/ColorGradingControls';
import type { ColorPanelAdjustmentView } from '../../../src/components/adjustments/color/types';
import { selectColorPanelAdjustmentView } from '../../../src/components/panel/right/color/ColorWorkspacePanel';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { COLOR_GRADING_PRESETS } from '../../../src/utils/colorGradingPresets';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const defaultColorView = (): ColorPanelAdjustmentView => selectColorPanelAdjustmentView(createDefaultEditDocumentV2());

beforeEach(() => useEditorStore.getState().setEditor({ selectedImage: null }));

test('three-way navigation exposes three compact wheels and does not mutate adjustment history', async () => {
  const rendered = await renderColorGrading();

  expect(rendered.container.querySelectorAll('[data-testid^="color-grading-wheel-"]')).toHaveLength(3);
  expect(rendered.container.querySelectorAll('input[type="range"][aria-label="Luminance"]')).toHaveLength(3);
  expect(rendered.container.querySelectorAll('[data-testid^="color-grading-summary-"]')).toHaveLength(3);

  await click(rendered.container, '[data-testid="color-grading-summary-shadows"] button');
  expect(
    rendered.container
      .querySelector<HTMLButtonElement>('[data-testid="color-grading-summary-shadows"] button')
      ?.getAttribute('aria-pressed'),
  ).toBe('true');

  await click(rendered.container, '[data-testid="color-grading-view-global"]');
  expect(rendered.container.querySelector('[data-active-range]')?.getAttribute('data-active-range')).toBe('global');
  expect(rendered.container.querySelector('[data-testid="color-grading-three-way-summary"]')).toBeNull();

  await click(rendered.container, '[data-testid="color-grading-view-3way"]');
  expect(rendered.container.querySelector('[data-active-range]')).toBeNull();
  expect(rendered.getChangeCount()).toBe(0);
});

test('active numeric sliders update the selected range and its three-way summary', async () => {
  const rendered = await renderColorGrading();
  await click(rendered.container, '[data-testid="color-grading-view-midtones"]');
  const hueInput = getRequiredElement<HTMLInputElement>(rendered.container, 'input[type="range"][aria-label="Hue"]');
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(hueInput, '125');

  await act(async () => {
    hueInput.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flushPromises();
  });

  expect(rendered.getAdjustments().colorGrading.midtones).toEqual({ hue: 125, luminance: 0, saturation: 0 });
  await click(rendered.container, '[data-testid="color-grading-view-3way"]');
  expect(rendered.container.querySelector('[data-testid="color-grading-values-midtones"]')?.textContent).toContain(
    'H125 S0 L0',
  );
  expect(
    rendered.container.querySelector<HTMLElement>('[data-testid="color-grading-view-midtones"]')?.dataset['modified'],
  ).toBe('true');
  expect(rendered.getChangeCount()).toBe(1);
});

test('preset apply is one adjustment operation and exposes exact active matching', async () => {
  const rendered = await renderColorGrading();
  await click(rendered.container, '[aria-haspopup="listbox"]');

  const options = rendered.container.querySelectorAll<HTMLButtonElement>('[data-testid="color-grading-preset-card"]');
  expect(options).toHaveLength(COLOR_GRADING_PRESETS.length);

  await act(async () => {
    options[0]?.click();
    await flushPromises();
  });

  const preset = COLOR_GRADING_PRESETS[0];
  if (preset === undefined) throw new Error('Expected at least one color grading preset.');
  expect(rendered.getAdjustments().colorGrading).toEqual({
    balance: preset.balance,
    blending: preset.blending,
    global: preset.global,
    highlights: preset.highlights,
    midtones: preset.midtones,
    shadows: preset.shadows,
  });
  expect(rendered.container.querySelector('[aria-haspopup="listbox"]')?.textContent).toContain(preset.name);
  expect(rendered.container.querySelector('[role="listbox"]')).toBeNull();
  expect(rendered.getChangeCount()).toBe(1);

  await click(rendered.container, '[aria-haspopup="listbox"]');
  expect(
    rendered.container.querySelector('[data-testid="color-grading-preset-card"][data-active="true"]'),
  ).not.toBeNull();
});

test('preset menu supports deterministic keyboard navigation and focus restoration', async () => {
  const rendered = await renderColorGrading();
  const trigger = getRequiredElement<HTMLButtonElement>(rendered.container, '[aria-haspopup="listbox"]');
  await click(rendered.container, '[aria-haspopup="listbox"]');

  const options = rendered.container.querySelectorAll<HTMLButtonElement>('[role="option"]');
  const firstOption = options[0];
  const secondOption = options[1];
  if (firstOption === undefined || secondOption === undefined) throw new Error('Expected keyboard preset options.');
  expect(document.activeElement).toBe(firstOption);

  await act(async () => {
    firstOption.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    await flushPromises();
  });
  expect(document.activeElement).toBe(secondOption);

  await act(async () => {
    secondOption.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    await flushPromises();
  });
  expect(rendered.container.querySelector('[role="listbox"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  expect(rendered.getChangeCount()).toBe(0);
});

test('whole-tool reset restores all canonical defaults in one operation', async () => {
  const initialAdjustments: ColorPanelAdjustmentView = {
    ...defaultColorView(),
    colorGrading: {
      balance: 18,
      blending: 62,
      global: { hue: 35, saturation: 2, luminance: 0 },
      highlights: { hue: 45, saturation: 5, luminance: 1 },
      midtones: { hue: 32, saturation: 7, luminance: 1 },
      shadows: { hue: 225, saturation: 2, luminance: 0 },
    },
  };
  const rendered = await renderColorGrading({ initialAdjustments });

  await click(rendered.container, 'button[aria-label="Reset Color Grading"]');

  expect(rendered.getAdjustments().colorGrading).toEqual(INITIAL_ADJUSTMENTS.colorGrading);
  expect(rendered.getChangeCount()).toBe(1);
  expect(
    getRequiredElement<HTMLButtonElement>(rendered.container, 'button[aria-label="Reset Color Grading"]').disabled,
  ).toBe(true);
});

function ColorGradingHarness({
  initialAdjustments,
  onAdjustmentsChange,
}: {
  initialAdjustments: ColorPanelAdjustmentView;
  onAdjustmentsChange: (adjustments: ColorPanelAdjustmentView) => void;
}) {
  const [adjustments, setAdjustmentsState] = useState(initialAdjustments);

  return createElement(ColorGradingControls, {
    adjustments,
    appSettings: null,
    setAdjustments: (update) => {
      setAdjustmentsState((previous) => {
        const next = typeof update === 'function' ? update(previous) : { ...previous, ...update };
        onAdjustmentsChange(next);
        return next;
      });
    },
  });
}

async function renderColorGrading({
  initialAdjustments = defaultColorView(),
}: {
  initialAdjustments?: ColorPanelAdjustmentView;
} = {}) {
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  let currentAdjustments = initialAdjustments;
  let changeCount = 0;
  const view = render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(ColorGradingHarness, {
        initialAdjustments,
        onAdjustmentsChange: (adjustments) => {
          currentAdjustments = adjustments;
          changeCount += 1;
        },
      }),
    ),
  );
  await act(flushPromises);
  return {
    ...view,
    getAdjustments: () => currentAdjustments,
    getChangeCount: () => changeCount,
  };
}

async function click(container: Element, selector: string) {
  await act(async () => {
    getRequiredElement<HTMLButtonElement>(container, selector).click();
    await flushPromises();
  });
}

function getRequiredElement<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
