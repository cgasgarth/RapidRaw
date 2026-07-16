import { expect, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';

import TypedCurveEditor from '../../../src/components/adjustments/TypedCurveEditor';
import en from '../../../src/i18n/locales/en.json';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const i18n = i18next.createInstance();
await i18n.use(initReactI18next).init({
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  lng: 'en',
  react: { useSuspense: false },
  resources: { en: { translation: en } },
});

const sourcePath = '/fixture/typed-curve-component.ARW';
test('TypedCurveEditor exposes and commits through the canonical fallback session', () => {
  const editDocumentV2 = createDefaultEditDocumentV2();
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
  const { container } = render(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(TypedCurveEditor, {
        adjustments: selectEditDocumentNode(editDocumentV2, 'scene_curve').params,
        domain: 'scene',
      }),
    ),
  );

  const editor = container.querySelector('[data-testid="typed-curve-editor"]');
  expect(editor?.getAttribute('data-commit-image-session')).toBe('editor-image-session:57');
  const channelMode = container.querySelector('select[aria-label="Scene curve channel mode"]');
  expect(channelMode).toBeInstanceOf(window.HTMLSelectElement);
  if (!(channelMode instanceof window.HTMLSelectElement)) throw new Error('missing channel mode selector');
  fireEvent.change(channelMode, { target: { value: 'linked_rgb' } });

  expect(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'scene_curve').params['sceneCurveV1']?.channelMode,
  ).toBe('linked_rgb');
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    imageSessionId: 'editor-image-session:57',
    source: 'manual-control',
  });
  expect(useEditorStore.getState().history).toHaveLength(2);
});
