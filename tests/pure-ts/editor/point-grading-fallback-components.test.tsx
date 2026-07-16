import { expect, mock, test } from 'bun:test';
import { act, render as testingRender } from '@testing-library/react';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { ColorGradingControls } from '../../../src/components/adjustments/color/ColorGradingControls';
import { PointColorControls } from '../../../src/components/adjustments/color/PointColorControls';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

const sourcePath = '/fixture/point-grading-components.ARW';
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
test('PointColorControls toggle commits through fallback authority without the mask-local setter', () => {
  const adjustments = initializeFallbackStore(111);
  const genericSetter = mock(() => undefined);
  const container = render(
    createElement(PointColorControls, { adjustments, appSettings: null, setAdjustments: genericSetter }),
  );

  expect(
    container.querySelector('[data-testid="point-color-controls"]')?.getAttribute('data-commit-image-session'),
  ).toBe('editor-image-session:111');
  const enable = container.querySelector('[data-testid="point-color-enable"]');
  if (!(enable instanceof window.HTMLButtonElement)) throw new Error('missing point color enable control');
  act(() => enable.click());

  expect(useEditorStore.getState().adjustmentSnapshot.value.pointColor.enabled).toBeTrue();
  expect(useEditorStore.getState().history).toHaveLength(2);
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    imageSessionId: 'editor-image-session:111',
    source: 'manual-control',
  });
  expect(genericSetter).not.toHaveBeenCalled();
});

test('ColorGradingControls slider commits perceptual grading through fallback authority', () => {
  const adjustments = initializeFallbackStore(112);
  const genericSetter = mock(() => undefined);
  const container = render(
    createElement(ColorGradingControls, { adjustments, appSettings: null, setAdjustments: genericSetter }),
  );

  expect(
    container.querySelector('[data-testid="color-grading-controls"]')?.getAttribute('data-commit-image-session'),
  ).toBe('editor-image-session:112');
  const balance = container.querySelector('[data-testid="color-grading-balance-range"]');
  if (!(balance instanceof window.HTMLInputElement)) throw new Error('missing color grading balance slider');
  const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    valueSetter?.call(balance, '28');
    balance.dispatchEvent(new window.Event('input', { bubbles: true }));
  });

  expect(useEditorStore.getState().adjustmentSnapshot.value.colorGrading.balance).toBe(28);
  expect(useEditorStore.getState().adjustmentSnapshot.value.perceptualGradingV1?.balance).toBeCloseTo(0.28);
  expect(useEditorStore.getState().history).toHaveLength(2);
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    imageSessionId: 'editor-image-session:112',
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

function render(element: React.ReactElement): HTMLDivElement {
  return testingRender(createElement(I18nextProvider, { i18n }, element)).container;
}
