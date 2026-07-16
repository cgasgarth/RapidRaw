import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import i18next from 'i18next';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import TypedCurveEditor from '../../../src/components/adjustments/TypedCurveEditor';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
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

const sourcePath = '/fixture/typed-curve-component.ARW';
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
});

test('TypedCurveEditor exposes and commits through the canonical fallback session', () => {
  installDom();
  const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
  const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2,
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId: 57,
    lastEditApplicationReceipt: null,
    selectedImage: {
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
    },
    history: [editDocumentV2],
  });
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      createElement(I18nextProvider, { i18n }, createElement(TypedCurveEditor, { adjustments, domain: 'scene' })),
    ),
  );

  const editor = container.querySelector('[data-testid="typed-curve-editor"]');
  expect(editor?.getAttribute('data-commit-image-session')).toBe('editor-image-session:57');
  const channelMode = container.querySelector('select[aria-label="Scene curve channel mode"]');
  expect(channelMode).toBeInstanceOf(window.HTMLSelectElement);
  act(() => {
    if (!(channelMode instanceof window.HTMLSelectElement)) throw new Error('missing channel mode selector');
    channelMode.value = 'linked_rgb';
    channelMode.dispatchEvent(new window.Event('change', { bubbles: true }));
  });

  expect(useEditorStore.getState().adjustmentSnapshot.value.sceneCurveV1?.channelMode).toBe('linked_rgb');
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    imageSessionId: 'editor-image-session:57',
    source: 'manual-control',
  });
  expect(useEditorStore.getState().history).toHaveLength(2);
});

function installDom() {
  const window = new Window({ url: 'http://localhost/typed-curve-fallback' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
}
