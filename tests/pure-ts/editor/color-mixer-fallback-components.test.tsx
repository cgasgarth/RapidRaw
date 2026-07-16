import { afterEach, expect, mock, test } from 'bun:test';
import { act, render as testingRender } from '@testing-library/react';
import i18next from 'i18next';
import { createElement, useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { COLOR_WORKSPACE_TAB_SESSION_KEY } from '../../../src/utils/colorWorkspaceNavigation';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const invoke = mock(() => new Promise<unknown>(() => {}));
mock.module('@tauri-apps/api/core', () => ({ invoke }));
const { default: ColorPanel } = await import('../../../src/components/adjustments/Color');
const { ColorAdvancedControls } = await import('../../../src/components/adjustments/color/ColorAdvancedControls');

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

const sourcePath = '/fixture/color-fallback-components.ARW';
const selectedImage = {
  exif: null,
  height: 3000,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: sourcePath,
  rawDevelopmentReport: null,
  thumbnailUrl: '',
  width: 4000,
};
afterEach(() => {
  window.sessionStorage.clear();
});

test('ColorPanel mixer toggles commit through fallback authority without its generic setter', () => {
  window.sessionStorage.setItem(COLOR_WORKSPACE_TAB_SESSION_KEY, 'mixer');
  const adjustments = initializeFallbackStore(91);
  const genericSetter = mock(() => undefined);
  const Harness = () => {
    const [current, setCurrent] = useState(adjustments);
    return createElement(ColorPanel, {
      adjustments: current,
      appSettings: null,
      setAdjustments: (update) => {
        genericSetter();
        setCurrent((previous) => (typeof update === 'function' ? update(previous) : { ...previous, ...update }));
      },
    });
  };
  const container = render(createElement(Harness));

  expect(
    container.querySelector('[data-testid="black-white-mixer-controls"]')?.getAttribute('data-commit-image-session'),
  ).toBe('editor-image-session:91');
  act(() => getButton(container, 'black-white-mixer-toggle').click());
  expect(useEditorStore.getState().adjustmentSnapshot.value.blackWhiteMixer.enabled).toBeTrue();
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    imageSessionId: 'editor-image-session:91',
    source: 'manual-control',
  });

  act(() => getButton(container, 'color-balance-toggle').click());
  expect(useEditorStore.getState().adjustmentSnapshot.value.colorBalanceRgb).toMatchObject({
    enabled: true,
    midtones: { red: 10 },
  });
  expect(requireEditNode('color_balance_rgb').params['colorBalanceRgb']).toEqual(
    useEditorStore.getState().adjustmentSnapshot.value.colorBalanceRgb,
  );
  expect(requireEditNode('channel_mixer').params).not.toHaveProperty('colorBalanceRgb');

  act(() => getButton(container, 'channel-mixer-toggle').click());
  expect(useEditorStore.getState().adjustmentSnapshot.value.channelMixer.enabled).toBeTrue();
  const hslHue = container.querySelector('[data-testid="selective-color-range-controls"] input[type="range"]');
  if (!(hslHue instanceof window.HTMLInputElement)) throw new Error('missing selective-color HSL slider');
  act(() => {
    hslHue.value = '21';
    hslHue.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  expect(useEditorStore.getState().adjustmentSnapshot.value.hsl.reds.hue).toBe(21);
  expect(requireEditNode('selective_color_mixer').params).toMatchObject({ hsl: { reds: { hue: 21 } } });
  expect(useEditorStore.getState().editDocumentV2.extensions['legacyAdjustments']).not.toHaveProperty('hsl');
  expect(useEditorStore.getState().history).toHaveLength(5);
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    adjustmentRevision: 4,
    imageSessionId: 'editor-image-session:91',
  });
  expect(genericSetter).not.toHaveBeenCalled();
});

test('ColorAdvancedControls slider commits calibration through fallback authority', () => {
  const adjustments = initializeFallbackStore(92);
  const genericSetter = mock(() => undefined);
  const container = render(
    createElement(ColorAdvancedControls, {
      adjustmentVisibility: {},
      adjustments,
      appSettings: null,
      isColorCalibrationVisible: true,
      levelsClippingWarnings: [],
      mode: 'calibration',
      setAdjustments: genericSetter,
    }),
  );

  expect(
    container.querySelector('[data-testid="color-calibration-controls"]')?.getAttribute('data-commit-image-session'),
  ).toBe('editor-image-session:92');
  const tint = container.querySelector('[data-testid="color-calibration-controls"] input[type="range"]');
  if (!(tint instanceof window.HTMLInputElement)) throw new Error('missing calibration tint slider');
  act(() => {
    tint.value = '24';
    tint.dispatchEvent(new window.Event('input', { bubbles: true }));
  });

  expect(useEditorStore.getState().adjustmentSnapshot.value.colorCalibration.shadowsTint).toBe(24);
  expect(useEditorStore.getState().history).toHaveLength(2);
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    imageSessionId: 'editor-image-session:92',
    source: 'manual-control',
  });
  expect(genericSetter).not.toHaveBeenCalled();
});

test('ColorAdvancedControls Levels actions commit through the luma Levels node', () => {
  const adjustments = initializeFallbackStore(93);
  const genericSetter = mock(() => undefined);
  const container = render(
    createElement(ColorAdvancedControls, {
      adjustmentVisibility: {},
      adjustments,
      appSettings: null,
      isColorCalibrationVisible: false,
      levelsClippingWarnings: [],
      mode: 'levels',
      setAdjustments: genericSetter,
    }),
  );

  act(() => getButton(container, 'color-levels-toggle').click());
  expect(useEditorStore.getState().adjustmentSnapshot.value.levels.enabled).toBeTrue();
  expect(requireEditNode('luma_levels').params).toMatchObject({ levels: { enabled: true } });
  expect(useEditorStore.getState().editDocumentV2.extensions['legacyAdjustments']).not.toHaveProperty('levels');

  const inputBlack = container.querySelector('[data-testid="color-levels-controls"] input[type="range"]');
  if (!(inputBlack instanceof window.HTMLInputElement)) throw new Error('missing Levels input-black slider');
  act(() => {
    inputBlack.value = '8';
    inputBlack.dispatchEvent(new window.Event('input', { bubbles: true }));
  });

  expect(useEditorStore.getState().adjustmentSnapshot.value.levels.inputBlack).toBe(0.08);
  expect(requireEditNode('luma_levels').params).toMatchObject({ levels: { enabled: true, inputBlack: 0.08 } });
  expect(useEditorStore.getState().history).toHaveLength(3);
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    adjustmentRevision: 2,
    imageSessionId: 'editor-image-session:93',
    source: 'manual-control',
  });
  expect(genericSetter).not.toHaveBeenCalled();
});

function initializeFallbackStore(imageSessionId: number): Adjustments {
  const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
  const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2,
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId,
    lastEditApplicationReceipt: null,
    selectedImage,
    history: [editDocumentV2],
  });
  return adjustments;
}

function requireEditNode(nodeType: string) {
  const node = useEditorStore.getState().editDocumentV2.nodes[nodeType];
  if (node === undefined) throw new Error(`Expected ${nodeType} edit node.`);
  return node;
}

function render(element: React.ReactElement): HTMLElement {
  return testingRender(createElement(I18nextProvider, { i18n }, element)).container;
}

function getButton(container: Element, testId: string): HTMLButtonElement {
  const button = container.querySelector(`[data-testid="${testId}"]`);
  if (!(button instanceof window.HTMLButtonElement)) throw new Error(`missing button: ${testId}`);
  return button;
}
