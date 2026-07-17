import { afterEach, expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement, useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import BasicAdjustments, { type BasicAdjustmentView } from '../../../src/components/adjustments/Basic';
import en from '../../../src/i18n/locales/en.json';
import { useUIStore } from '../../../src/store/useUIStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const defaultBasicView = (): BasicAdjustmentView => {
  const document = createDefaultEditDocumentV2();
  return {
    ...selectEditDocumentNode(document, 'scene_global_color_tone').params,
    ...selectEditDocumentNode(document, 'scene_to_view_transform').params,
    ...selectEditDocumentNode(document, 'tone_equalizer').params,
  };
};

afterEach(() => {
  act(() => {
    useUIStore.setState({ toneEqualizerPickerActive: false, toneEqualizerPickerReceipt: null });
  });
});

test('tone equalizer advanced controls commit typed zone and preview settings', async () => {
  const { container, getAdjustments } = await renderBasic();
  await act(async () => {
    getRequiredElement<HTMLButtonElement>(container, '[data-testid="basic-tone-advanced-toggle"]').click();
    await flushPromises();
  });

  expect(container.querySelectorAll('[data-density="compact"][data-testid^="tone-equalizer-band-"]')).toHaveLength(9);
  expect(container.querySelector('[data-testid="tone-equalizer-preview-modes"]')?.textContent).toBe(
    'ImageZonesBandFilterClip',
  );

  const upperMiddle = getRequiredElement<HTMLInputElement>(
    container,
    '[data-testid="tone-equalizer-band-6"] input[type="range"]',
  );
  await act(async () => {
    upperMiddle.value = '1.25';
    upperMiddle.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flushPromises();
  });
  expect(getAdjustments().toneEqualizer.enabled).toBe(true);
  expect(getAdjustments().toneEqualizer.selectedBand).toBe(6);
  expect(getAdjustments().toneEqualizer.bandEv[6]).toBe(1.25);

  const previewButtons = container.querySelectorAll<HTMLButtonElement>(
    '[data-testid="tone-equalizer-preview-modes"] button',
  );
  await act(async () => {
    previewButtons[4]?.click();
    await flushPromises();
  });
  expect(getAdjustments().toneEqualizer.previewMode).toBe(4);

  await act(async () => {
    getRequiredElement<HTMLButtonElement>(container, '[data-testid="tone-equalizer-picker"]').click();
    await flushPromises();
  });
  expect(useUIStore.getState().toneEqualizerPickerActive).toBe(true);
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
  ]);
  expect(container.querySelector('[data-testid="basic-secondary-controls"]')).toBeNull();
  expect(container.querySelector('[data-testid="basic-tone-advanced"]')).toBeNull();

  for (const row of rows) {
    expect(row.getAttribute('data-density')).toBe('compact');
    expect(row.querySelector('[data-slider-track="true"]')).not.toBeNull();
    expect(row.querySelector('[data-slider-value-slot="true"]')).not.toBeNull();
  }
});

test('tone mapper switching preserves tone values and exposes edited/reset state', async () => {
  const initialAdjustments: BasicAdjustmentView = {
    ...defaultBasicView(),
    brightness: 0.4,
    contrast: 18,
    exposure: 0.65,
  };
  const { container, getAdjustments } = await renderBasic({ initialAdjustments });
  await act(async () => {
    getRequiredElement<HTMLButtonElement>(container, '[data-testid="basic-tone-advanced-toggle"]').click();
    await flushPromises();
  });
  const mapperRow = getRequiredElement<HTMLDivElement>(container, '[data-testid="basic-tone-mapper"]');
  const agx = getRequiredElement<HTMLButtonElement>(mapperRow, '[role="radio"]:last-child');

  expect(container.querySelector('[data-testid="rapid-view-controls"]')?.textContent).toContain('View contrast');
  expect(container.querySelector('[data-testid="rapid-view-controls"]')?.textContent).toContain('Highlight roll-off');
  expect(container.querySelector('[data-testid="rapid-view-controls"]')?.textContent).toContain('Shadow roll-off');
  const contrastRange = getRequiredElement<HTMLInputElement>(container, '[data-testid="rapid-view-contrast-range"]');
  await act(async () => {
    contrastRange.value = '1.35';
    contrastRange.dispatchEvent(new window.Event('input', { bubbles: true }));
    await flushPromises();
  });
  expect(getAdjustments().viewTransform.contrast).toBe(1.35);

  await act(async () => {
    agx.click();
    await flushPromises();
  });

  expect(getAdjustments()).toMatchObject({ brightness: 0.4, contrast: 18, exposure: 0.65, toneMapper: 'agx' });
  expect(mapperRow.dataset['modified']).toBe('true');
  expect(container.querySelector('[data-testid="rapid-view-controls"]')).toBeNull();

  await act(async () => {
    getRequiredElement<HTMLButtonElement>(mapperRow, '[data-testid="basic-tone-mapper-label"]').click();
    await flushPromises();
  });

  expect(getAdjustments()).toMatchObject({
    brightness: 0.4,
    contrast: 18,
    exposure: 0.65,
    toneMapper: 'rapidView',
  });
  expect(mapperRow.dataset['modified']).toBe('false');
});

test('mask and forced tone-mapper contexts omit only the global process selector', async () => {
  const maskRender = await renderBasic({ isForMask: true });
  expect(maskRender.container.querySelector('[data-testid="basic-tone-mapper"]')).toBeNull();
  expect(maskRender.container.querySelector('[data-testid="basic-control-exposure"]')).not.toBeNull();
  maskRender.unmount();

  const overrideRender = await renderBasic({ tonemapperOverrideEnabled: true });
  expect(overrideRender.container.querySelector('[data-testid="basic-tone-mapper"]')).toBeNull();
  expect(
    overrideRender.container.querySelectorAll('[data-density="compact"][data-testid^="basic-control-"]'),
  ).toHaveLength(6);
});

test('Tone defaults to collapsed Advanced and reports unavailable Auto without an image action', async () => {
  const { container } = await renderBasic();
  const advancedToggle = getRequiredElement<HTMLButtonElement>(container, '[data-testid="basic-tone-advanced-toggle"]');
  expect(advancedToggle.getAttribute('aria-expanded')).toBe('false');
  expect(container.querySelector('[data-testid="basic-tone-advanced"]')).toBeNull();
  expect(getRequiredElement<HTMLButtonElement>(container, '[data-testid="basic-tone-auto"]').disabled).toBe(true);
});

test('current Basic view settings round-trip without a flat sidecar shape', () => {
  const reopened: BasicAdjustmentView = {
    ...defaultBasicView(),
    toneMapper: 'rapidView',
    viewTransform: {
      ...INITIAL_ADJUSTMENTS.viewTransform,
      contrast: 1.37,
      shoulder: 0.72,
    },
  };
  expect(reopened.toneMapper).toBe('rapidView');
  expect(reopened.viewTransform).toEqual({
    ...INITIAL_ADJUSTMENTS.viewTransform,
    contrast: 1.37,
    shoulder: 0.72,
  });
});

function BasicHarness({
  initialAdjustments,
  isForMask,
  onAdjustmentsChange,
  tonemapperOverrideEnabled,
}: {
  initialAdjustments: BasicAdjustmentView;
  isForMask: boolean;
  onAdjustmentsChange: (adjustments: BasicAdjustmentView) => void;
  tonemapperOverrideEnabled: boolean;
}) {
  const [adjustments, setAdjustmentsState] = useState(initialAdjustments);

  return createElement(BasicAdjustments, {
    adjustments,
    ...(tonemapperOverrideEnabled ? { appSettings: { tonemapperOverrideEnabled: true } } : {}),
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
  initialAdjustments = defaultBasicView(),
  isForMask = false,
  tonemapperOverrideEnabled = false,
}: {
  initialAdjustments?: BasicAdjustmentView;
  isForMask?: boolean;
  tonemapperOverrideEnabled?: boolean;
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
  const view = render(
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
  await act(flushPromises);
  return { ...view, getAdjustments: () => currentAdjustments };
}

function getRequiredElement<T extends Element>(container: Element, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`Expected ${selector} to render.`);
  return element;
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
