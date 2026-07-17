import { expect, mock, test } from 'bun:test';
import { act, render as testingRender } from '@testing-library/react';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import CalibrationPanel from '../../../src/components/adjustments/color/CalibrationPanel';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

mock.module('@tauri-apps/api/core', () => ({ invoke: mock(() => Promise.resolve(null)) }));

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

const sourcePath = '/fixture/calibration.ARW';

test('Develop Calibration panel exposes typed primary controls and commits one current-document edit', () => {
  const document = createDefaultEditDocumentV2();
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2: document,
    history: [document],
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId: 6150,
    lastEditApplicationReceipt: null,
    selectedImage: {
      exif: null,
      height: 100,
      isRaw: true,
      isReady: true,
      metadata: null,
      originalUrl: null,
      path: sourcePath,
      rawDevelopmentReport: null,
      thumbnailUrl: '',
      width: 100,
    },
  });

  const container = testingRender(createElement(I18nextProvider, { i18n }, createElement(CalibrationPanel))).container;
  const tint = container.querySelector('[data-testid="calibration-shadows-tint-range"] input[type="range"]');
  if (!(tint instanceof window.HTMLInputElement)) throw new Error('missing Calibration tint control');
  act(() => {
    tint.value = '18';
    tint.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'color_calibration').params['colorCalibration'],
  ).toMatchObject({ shadowsTint: 18 });
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    imageSessionId: 'editor-image-session:6150',
    source: 'manual-control',
  });

  const blue = container.querySelector('button[aria-label="Select Blue color"]');
  if (!(blue instanceof window.HTMLButtonElement)) throw new Error('missing Blue primary selector');
  act(() => blue.click());
  const hue = container.querySelector('[data-testid="calibration-primary-hue-range"] input[type="range"]');
  if (!(hue instanceof window.HTMLInputElement)) throw new Error('missing Calibration hue control');
  act(() => {
    hue.value = '-22';
    hue.dispatchEvent(new window.Event('input', { bubbles: true }));
  });
  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'color_calibration').params['colorCalibration'],
  ).toMatchObject({ blueHue: -22, shadowsTint: 18 });
  expect(useEditorStore.getState().history).toHaveLength(3);
});
