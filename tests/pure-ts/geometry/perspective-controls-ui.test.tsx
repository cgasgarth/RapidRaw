import { afterEach, expect, test } from 'bun:test';
import { act, fireEvent, render } from '@testing-library/react';
import i18next from 'i18next';
import { createElement } from 'react';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import TransformLens from '../../../src/components/adjustments/TransformLens.tsx';
import en from '../../../src/i18n/locales/en.json';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore.ts';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments.ts';
import { selectEditDocumentGeometry, selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors.ts';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2.ts';

afterEach(() => {
  Reflect.deleteProperty(window, '__TAURI_INTERNALS__');
});

test('guided perspective controls create source-normalized horizontal and vertical evidence', async () => {
  Object.defineProperty(window, '__TAURI_INTERNALS__', {
    configurable: true,
    value: { invoke: async () => [] },
  });
  const adjustments = {
    ...structuredClone(INITIAL_ADJUSTMENTS),
    perspectiveCorrection: { ...INITIAL_ADJUSTMENTS.perspectiveCorrection, mode: 'guided' as const },
  };
  const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'geometry', {
    perspectiveCorrection: adjustments.perspectiveCorrection,
  });
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2,
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: createEditorImageSession({ generation: 1, path: '/fixture/guided.ARW', source: 'cache' }),
    selectedImage: {
      exif: null,
      height: 3000,
      isRaw: true,
      isReady: true,
      originalUrl: null,
      path: '/fixture/guided.ARW',
      thumbnailUrl: '',
      width: 4000,
    },
    history: [editDocumentV2],
  });
  const i18n = i18next.createInstance();
  await i18n.use(initReactI18next).init({
    interpolation: { escapeValue: false },
    lng: 'en',
    react: { useSuspense: false },
    resources: { en: { translation: en } },
  });
  const { container } = render(createElement(I18nextProvider, { i18n }, createElement(PerspectiveHarness)));
  await act(flushPromises);
  const buttons = Array.from(container.querySelectorAll('button'));
  const horizontal = buttons.find((button) => button.textContent?.includes('Add horizontal guide'));
  const vertical = buttons.find((button) => button.textContent?.includes('Add vertical guide'));
  if (horizontal === undefined || vertical === undefined) throw new Error('Expected guided line controls');
  fireEvent.click(horizontal);
  fireEvent.click(vertical);
  await act(flushPromises);
  const state = container.querySelector('[data-testid="perspective-state"]')?.textContent ?? '';
  expect(state).toContain('"horizontal"');
  expect(state).toContain('"vertical"');
  expect(container.querySelector('[data-testid="perspective-guide-list"]')).not.toBeNull();
});

function PerspectiveHarness() {
  const document = useEditorStore((state) => state.editDocumentV2);
  const adjustments = {
    ...selectEditDocumentGeometry(document),
    ...selectEditDocumentNode(document, 'lens_correction').params,
  };
  const selectedImage = useEditorStore((state) => state.selectedImage);
  return createElement(
    'div',
    null,
    createElement(TransformLens, {
      adjustments,
      selectedImage,
      setAdjustments: () => {},
    }),
    createElement(
      'output',
      { 'data-testid': 'perspective-state' },
      JSON.stringify(document.geometry.perspectiveCorrection.guides),
    ),
  );
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
