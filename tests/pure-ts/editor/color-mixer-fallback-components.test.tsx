import { afterEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { COLOR_WORKSPACE_TAB_SESSION_KEY } from '../../../src/utils/colorWorkspaceNavigation';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const invoke = mock(() => new Promise<unknown>(() => {}));
mock.module('@tauri-apps/api/core', () => ({ invoke }));
const { default: ColorPanel } = await import('../../../src/components/adjustments/Color');
const { ColorAdvancedControls } = await import('../../../src/components/adjustments/color/ColorAdvancedControls');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
});

test('ColorPanel mixer toggles commit through fallback authority without its generic setter', () => {
  installDom();
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
  expect(useEditorStore.getState().adjustments.blackWhiteMixer.enabled).toBeTrue();
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    imageSessionId: 'editor-image-session:91',
    source: 'manual-control',
  });

  act(() => getButton(container, 'channel-mixer-toggle').click());
  expect(useEditorStore.getState().adjustments.channelMixer.enabled).toBeTrue();
  expect(useEditorStore.getState().history).toHaveLength(3);
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    adjustmentRevision: 2,
    imageSessionId: 'editor-image-session:91',
  });
  expect(genericSetter).not.toHaveBeenCalled();
});

test('ColorAdvancedControls slider commits calibration through fallback authority', () => {
  installDom();
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

  expect(useEditorStore.getState().adjustments.colorCalibration.shadowsTint).toBe(24);
  expect(useEditorStore.getState().history).toHaveLength(2);
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    imageSessionId: 'editor-image-session:92',
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

function getButton(container: Element, testId: string): HTMLButtonElement {
  const button = container.querySelector(`[data-testid="${testId}"]`);
  if (!(button instanceof window.HTMLButtonElement)) throw new Error(`missing button: ${testId}`);
  return button;
}

function installDom() {
  const window = new Window({ url: 'http://localhost/color-fallback-components' });
  window.sessionStorage.clear();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
  Object.defineProperty(globalThis, 'HTMLButtonElement', { configurable: true, value: window.HTMLButtonElement });
  Object.defineProperty(globalThis, 'HTMLInputElement', { configurable: true, value: window.HTMLInputElement });
  Object.defineProperty(globalThis, 'Event', { configurable: true, value: window.Event });
  Object.defineProperty(globalThis, 'Node', { configurable: true, value: window.Node });
  Object.defineProperty(globalThis, 'MutationObserver', { configurable: true, value: window.MutationObserver });
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class ResizeObserver {
      disconnect() {}
      observe() {}
      unobserve() {}
    },
  });
}
