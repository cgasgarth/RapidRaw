import { afterEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const invoke = mock(() => new Promise<unknown>(() => {}));
mock.module('@tauri-apps/api/core', () => ({ invoke }));
const { default: TransformLens } = await import('../../../src/components/adjustments/TransformLens');

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

const sourcePath = '/fixture/transform-lens-component.ARW';
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

test('TransformLens commits a manual lens control through the canonical fallback session', () => {
  installDom();
  const adjustments = {
    ...structuredClone(INITIAL_ADJUSTMENTS),
    lensDistortionParams: {
      k1: 0.1,
      k2: 0,
      k3: 0,
      model: 1,
      tca_vb: 0.99,
      tca_vr: 1.01,
      vig_k1: 0.2,
      vig_k2: 0,
      vig_k3: 0,
    },
  };
  const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2,
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId: 73,
    lastEditApplicationReceipt: null,
    selectedImage,
    history: [editDocumentV2],
  });
  const setAdjustments = mock(() => undefined);
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(TransformLens, { adjustments, selectedImage, setAdjustments }),
      ),
    ),
  );

  const inspector = container.querySelector('[data-testid="transform-lens-inspector"]');
  expect(inspector?.getAttribute('data-commit-image-session')).toBe('editor-image-session:73');
  const vignetteSwitch = container.querySelector('#switch-lens-vignette');
  expect(vignetteSwitch).toBeInstanceOf(window.HTMLInputElement);
  act(() => {
    if (!(vignetteSwitch instanceof window.HTMLInputElement)) throw new Error('missing lens vignette switch');
    vignetteSwitch.click();
  });

  expect(useEditorStore.getState().adjustmentSnapshot.value.lensVignetteEnabled).toBeFalse();
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    imageSessionId: 'editor-image-session:73',
    source: 'manual-control',
  });
  expect(useEditorStore.getState().history).toHaveLength(2);
  expect(setAdjustments).not.toHaveBeenCalled();
});

function installDom() {
  const window = new Window({ url: 'http://localhost/transform-lens-fallback' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
}
