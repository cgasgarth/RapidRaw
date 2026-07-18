import { expect, test } from 'bun:test';
import { act, fireEvent, render as testingRender } from '@testing-library/react';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { PointColorControls } from '../../../src/components/adjustments/color/PointColorControls';
import type { ColorPanelAdjustmentView } from '../../../src/components/adjustments/color/types';
import { selectColorPanelAdjustmentView } from '../../../src/components/panel/right/color/ColorWorkspacePanel';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { useUIStore } from '../../../src/store/useUIStore';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

const sourcePath = '/fixture/lightroom-point-color.ARW';
const selectedImage = {
  exif: null,
  height: 1200,
  isRaw: true,
  isReady: true,
  metadata: null,
  originalUrl: null,
  path: sourcePath,
  rawDevelopmentReport: null,
  thumbnailUrl: '',
  width: 1800,
};

const sampledPoint = {
  chromaRadius: 0.08,
  chromaShift: 0,
  enabled: true,
  feather: 0.4,
  hueRadiusDegrees: 25,
  hueShiftDegrees: 0,
  id: 'sampled-point',
  lightnessRadius: 0.2,
  lightnessShift: 0,
  name: 'Sky blue',
  opacity: 1,
  samples: [
    {
      confidence: 0.96,
      graphRevision: 'graph:current',
      id: 'sampled-color',
      sampleRadiusPx: 2,
      sourceColor: { chroma: 0.2, hueDegrees: 210, lightness: 0.55 },
      sourceSceneRevision: 'scene:current',
    },
  ],
  saturationShift: 0,
  variance: 1,
};

const initialize = (withPoint = false): ColorPanelAdjustmentView => {
  const baseDocument = createDefaultEditDocumentV2();
  const document = withPoint
    ? patchEditDocumentV2Node(baseDocument, 'point_color', {
        pointColor: {
          ...selectEditDocumentNode(baseDocument, 'point_color').params.pointColor,
          enabled: true,
          points: [sampledPoint],
          selectedPointId: sampledPoint.id,
        },
      })
    : baseDocument;
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2: document,
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId: 88,
    lastEditApplicationReceipt: null,
    selectedImage,
    history: [document],
  });
  useUIStore.getState().setUI({ pointColorPickerActive: false, pointColorPickerReceipt: null });
  return selectColorPanelAdjustmentView(document);
};

const render = (adjustments: ColorPanelAdjustmentView, isForMask = false) =>
  testingRender(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(PointColorControls, {
        adjustments,
        appSettings: null,
        isForMask,
        setAdjustments: () => undefined,
      }),
    ),
  );

test('Point Color only creates a point from the active picker, never a pending placeholder', () => {
  const view = render(initialize());
  const add = view.container.querySelector('[data-testid="point-color-add-point"]');
  if (!(add instanceof window.HTMLButtonElement)) throw new Error('missing add point button');
  act(() => add.click());

  expect(useUIStore.getState().pointColorPickerActive).toBeTrue();
  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'point_color').params.pointColor.points,
  ).toEqual([]);
  expect(view.container.textContent).not.toContain('manual_pending_picker');
  view.unmount();
});

test('sampled Point Color exposes independent H/S/L ranges, shifts, rename, and one reset boundary', () => {
  const view = render(initialize(true));
  const root = view.container;
  expect(root.querySelector('[data-testid="point-color-hue-range"]')).not.toBeNull();
  expect(root.querySelector('[data-testid="point-color-saturation-range"]')).not.toBeNull();
  expect(root.querySelector('[data-testid="point-color-luminance-range"]')).not.toBeNull();
  expect(root.querySelector('[data-testid="point-color-hue-shift"]')).not.toBeNull();
  expect(root.querySelector('[data-testid="point-color-saturation-shift"]')).not.toBeNull();
  expect(root.querySelector('[data-testid="point-color-luminance-shift"]')).not.toBeNull();

  const name = root.querySelector('[data-testid="point-color-name"]');
  if (!(name instanceof window.HTMLInputElement)) throw new Error('missing point name input');
  act(() => {
    fireEvent.change(name, { target: { value: 'Clouds' } });
    fireEvent.blur(name);
  });
  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'point_color').params.pointColor.points[0]?.name,
  ).toBe('Clouds');

  const reset = root.querySelector('[data-testid="point-color-reset"]');
  if (!(reset instanceof window.HTMLButtonElement)) throw new Error('missing point reset');
  act(() => reset.click());
  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'point_color').params.pointColor,
  ).toMatchObject({
    enabled: false,
    points: [],
    selectedPointId: null,
    visualizeMode: 'image',
  });
  expect(useEditorStore.getState().history).toHaveLength(3);
  view.unmount();
});

test('Point Color coalesces a multi-step slider drag into one history entry', () => {
  const view = render(initialize(true));
  const range = view.container.querySelector('[data-testid="point-color-hue-range-range"]');
  if (!(range instanceof window.HTMLInputElement)) throw new Error('missing point color hue range');
  range.getBoundingClientRect = () => ({
    bottom: 0,
    height: 0,
    left: 0,
    right: 100,
    toJSON: () => ({}),
    top: 0,
    width: 100,
    x: 0,
    y: 0,
  });

  act(() => {
    fireEvent.mouseDown(range, { clientX: 20 });
    fireEvent.mouseMove(window, { clientX: 45 });
    fireEvent.mouseMove(window, { clientX: 80 });
    fireEvent.mouseUp(window, { clientX: 80 });
  });

  expect(useEditorStore.getState().history).toHaveLength(2);
  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'point_color').params.pointColor.points[0]
      ?.hueRadiusDegrees,
  ).toBe(144);
  view.unmount();
});

test('Point Color cancels its picker on unmount and never enables sampling for mask-local controls', () => {
  const view = render(initialize());
  const picker = view.container.querySelector('[data-testid="point-color-picker"]');
  if (!(picker instanceof window.HTMLButtonElement)) throw new Error('missing point color picker');
  act(() => picker.click());
  expect(useUIStore.getState().pointColorPickerActive).toBeTrue();
  view.unmount();
  expect(useUIStore.getState().pointColorPickerActive).toBeFalse();
  expect(useUIStore.getState().pointColorPickerReceipt).toBeNull();

  const maskView = render(initialize(), true);
  const maskPicker = maskView.container.querySelector('[data-testid="point-color-picker"]');
  if (!(maskPicker instanceof window.HTMLButtonElement)) throw new Error('missing mask point color picker');
  expect(maskPicker.disabled).toBeTrue();
  maskView.unmount();
});

test('Point Color hides a picker receipt from another image identity', () => {
  const adjustments = initialize(true);
  useUIStore.getState().setUI({
    pointColorPickerReceipt: {
      confidence: 1,
      graphRevision: 'graph:other',
      sourceFingerprint: 'fingerprint:other',
      sourceIdentity: '/fixture/other.ARW',
    },
  });
  const view = render(adjustments);
  expect(view.container.querySelector('[data-testid="point-color-picker-receipt"]')).toBeNull();
  view.unmount();
});
