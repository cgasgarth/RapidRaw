import { afterEach, expect, mock, test } from 'bun:test';
import { act, render as testingRender } from '@testing-library/react';
import i18next from 'i18next';
import { createElement, useState } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import type { EditDocumentNodeTypeV2 } from '../../../packages/rawengine-schema/src/editDocumentV2';
import type { ColorPanelAdjustmentView } from '../../../src/components/adjustments/color/types';
import { selectColorPanelAdjustmentView } from '../../../src/components/panel/right/color/ColorWorkspacePanel';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { COLOR_WORKSPACE_TAB_SESSION_KEY } from '../../../src/utils/colorWorkspaceNavigation';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

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
  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'black_white_mixer').params['blackWhiteMixer']
      .enabled,
  ).toBeTrue();
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    imageSessionId: 'editor-image-session:91',
    source: 'manual-control',
  });

  act(() => getButton(container, 'color-balance-toggle').click());
  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'color_balance_rgb').params['colorBalanceRgb'],
  ).toMatchObject({
    enabled: true,
    midtones: { red: 10 },
  });
  expect(requireEditNode('color_balance_rgb').params['colorBalanceRgb']).toEqual(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'color_balance_rgb').params['colorBalanceRgb'],
  );
  expect(requireEditNode('channel_mixer').params).not.toHaveProperty('colorBalanceRgb');

  act(() => getButton(container, 'channel-mixer-toggle').click());
  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'channel_mixer').params['channelMixer'].enabled,
  ).toBeTrue();
  const hslHue = container.querySelector('[data-testid="selective-color-range-controls"] input[type="range"]');
  if (!(hslHue instanceof window.HTMLInputElement)) throw new Error('missing selective-color HSL slider');
  act(() => {
    hslHue.value = '21';
    hslHue.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'selective_color_mixer').params['hsl'].reds.hue,
  ).toBe(21);
  expect(requireEditNode('selective_color_mixer').params).toMatchObject({ hsl: { reds: { hue: 21 } } });
  expect(useEditorStore.getState().history).toHaveLength(5);
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    adjustmentRevision: 4,
    imageSessionId: 'editor-image-session:91',
  });
  expect(genericSetter).not.toHaveBeenCalled();
});

test('Color Mixer exposes HSL and Color views without targeted-adjustment controls', () => {
  window.sessionStorage.setItem(COLOR_WORKSPACE_TAB_SESSION_KEY, 'mixer');
  const adjustments = initializeFallbackStore(94);
  const Harness = () => {
    const [current, setCurrent] = useState(adjustments);
    return createElement(ColorPanel, {
      adjustments: current,
      appSettings: null,
      setAdjustments: (update) =>
        setCurrent((previous) => (typeof update === 'function' ? update(previous) : { ...previous, ...update })),
    });
  };
  const container = render(createElement(Harness));
  expect(getButton(container, 'color-mixer-view-hsl').getAttribute('aria-checked')).toBe('true');
  expect(getButton(container, 'color-mixer-mode-hue').getAttribute('aria-checked')).toBe('true');
  expect(container.querySelector('[data-testid="color-mixer-targeted-adjustment"]')).toBeNull();
  expect(container.querySelector('[data-testid="point-color-controls"]')).toBeNull();
  act(() => getButton(container, 'color-mixer-mode-saturation').click());
  expect(getButton(container, 'color-mixer-mode-saturation').getAttribute('aria-checked')).toBe('true');
  act(() => getButton(container, 'color-mixer-view-color').click());
  expect(getButton(container, 'color-mixer-view-color').getAttribute('aria-checked')).toBe('true');
  expect(container.querySelectorAll('[data-testid^="color-mixer-row-"]')).toHaveLength(8);
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

  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'color_calibration').params['colorCalibration']
      .shadowsTint,
  ).toBe(24);
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
  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'luma_levels').params['levels'].enabled,
  ).toBeTrue();
  expect(requireEditNode('luma_levels').params).toMatchObject({ levels: { enabled: true } });

  const inputBlack = container.querySelector('[data-testid="color-levels-controls"] input[type="range"]');
  if (!(inputBlack instanceof window.HTMLInputElement)) throw new Error('missing Levels input-black slider');
  act(() => {
    inputBlack.value = '8';
    inputBlack.dispatchEvent(new window.Event('input', { bubbles: true }));
  });

  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'luma_levels').params['levels'].inputBlack,
  ).toBe(0.08);
  expect(requireEditNode('luma_levels').params).toMatchObject({ levels: { enabled: true, inputBlack: 0.08 } });
  expect(useEditorStore.getState().history).toHaveLength(3);
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    adjustmentRevision: 2,
    imageSessionId: 'editor-image-session:93',
    source: 'manual-control',
  });
  expect(genericSetter).not.toHaveBeenCalled();
});

function initializeFallbackStore(imageSessionId: number): ColorPanelAdjustmentView {
  const editDocumentV2 = createDefaultEditDocumentV2();
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
  return selectColorPanelAdjustmentView(editDocumentV2);
}

function requireEditNode<NodeType extends EditDocumentNodeTypeV2>(nodeType: NodeType) {
  return selectEditDocumentNode(useEditorStore.getState().editDocumentV2, nodeType);
}

function render(element: React.ReactElement): HTMLElement {
  return testingRender(createElement(I18nextProvider, { i18n }, element)).container;
}

function getButton(container: Element, testId: string): HTMLButtonElement {
  const button = container.querySelector(`[data-testid="${testId}"]`);
  if (!(button instanceof window.HTMLButtonElement)) throw new Error(`missing button: ${testId}`);
  return button;
}
