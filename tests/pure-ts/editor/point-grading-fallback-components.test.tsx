import { afterEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import { ColorGradingControls } from '../../../src/components/adjustments/color/ColorGradingControls';
import { PointColorControls } from '../../../src/components/adjustments/color/PointColorControls';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
});

test('PointColorControls toggle commits through fallback authority without the mask-local setter', () => {
  installDom();
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

  expect(useEditorStore.getState().adjustments.pointColor.enabled).toBeTrue();
  expect(useEditorStore.getState().history).toHaveLength(2);
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    imageSessionId: 'editor-image-session:111',
    source: 'manual-control',
  });
  expect(genericSetter).not.toHaveBeenCalled();
});

test('ColorGradingControls slider commits perceptual grading through fallback authority', () => {
  installDom();
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

  expect(useEditorStore.getState().adjustments.colorGrading.balance).toBe(28);
  expect(useEditorStore.getState().adjustments.perceptualGradingV1?.balance).toBeCloseTo(0.28);
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
  useEditorStore.setState({
    adjustmentRevision: 0,
    adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
    adjustments,
    editDocumentV2,
    history: [adjustments],
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId,
    lastEditApplicationReceipt: null,
    selectedImage,
  });
  return adjustments;
}

function render(element: React.ReactElement): HTMLDivElement {
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(I18nextProvider, { i18n }, element)));
  return container;
}

function installDom() {
  const window = new Window({ url: 'http://localhost/point-grading-fallback' });
  class TestResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
  Object.defineProperty(globalThis, 'HTMLButtonElement', { configurable: true, value: window.HTMLButtonElement });
  Object.defineProperty(globalThis, 'HTMLInputElement', { configurable: true, value: window.HTMLInputElement });
  Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: TestResizeObserver });
}
