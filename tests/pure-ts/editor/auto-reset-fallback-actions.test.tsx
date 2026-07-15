import { afterEach, expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixture/auto-reset-fallback-actions.ARW';
const autoPatch = {
  blacks: -4,
  brightness: 0.2,
  centré: 0,
  clarity: 8,
  contrast: 18,
  dehaze: 5,
  exposure: 0.35,
  highlights: -10,
  shadows: 12,
  vibrance: 16,
  vignetteAmount: -3,
  whiteBalanceMigration: 'native_v1',
  whiteBalanceTechnical: {
    ...structuredClone(INITIAL_ADJUSTMENTS.whiteBalanceTechnical),
    confidence: 0.8,
    mode: 'auto',
    sampleCount: 256,
    source: 'auto',
  },
  whites: 6,
};
const invoke = mock(async (command: string) => {
  if (command === 'calculate_auto_adjustments') return autoPatch;
  if (command === 'reset_adjustments_for_paths') {
    return [
      {
        adjustments: {},
        path: sourcePath,
        renderGeneration: 12,
        revision: `sha256:${'b'.repeat(64)}`,
      },
    ];
  }
  throw new Error(`Unexpected invoke: ${command}`);
});
mock.module('@tauri-apps/api/core', () => ({ invoke }));
const { useEditorActions } = await import('../../../src/hooks/editor/useEditorActions');

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
});

test('useEditorActions routes Auto Adjust and native Reset through fallback authority', async () => {
  installDom();
  const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), effectsEnabled: false, exposure: 0.6 };
  const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
  useEditorStore.setState({
    adjustmentRevision: 0,
    adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
    adjustments,
    editDocumentV2,
    finalPreviewUrl: 'blob:fallback-actions-before',
    history: [adjustments],
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId: 131,
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
      width: 4500,
    },
  });
  let actions: ReturnType<typeof useEditorActions> | null = null;
  const Harness = () => {
    actions = useEditorActions();
    return null;
  };
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(Harness)));

  await act(async () => actions?.handleAutoAdjustments());
  expect(useEditorStore.getState()).toMatchObject({
    adjustmentRevision: 1,
    finalPreviewUrl: null,
    historyIndex: 1,
    lastEditApplicationReceipt: {
      imageSessionId: 'editor-image-session:131',
      source: 'auto-edit',
    },
  });
  expect(useEditorStore.getState().adjustments.exposure).toBe(0.35);
  expect(useEditorStore.getState().adjustments.effectsEnabled).toBeFalse();

  useEditorStore.setState({ finalPreviewUrl: 'blob:fallback-reset-action-before' });
  await act(async () => actions?.handleResetAdjustments([sourcePath]));
  expect(useEditorStore.getState()).toMatchObject({
    adjustmentRevision: 2,
    finalPreviewUrl: null,
    historyIndex: 0,
    lastEditApplicationReceipt: {
      imageSessionId: 'editor-image-session:131',
      persistence: 'native-committed',
      source: 'reset',
    },
  });
  expect(useEditorStore.getState().adjustments.exposure).toBe(0);
  expect(useEditorStore.getState().adjustments.effectsEnabled).toBeFalse();
  expect(invoke).toHaveBeenCalledTimes(2);
});

function installDom() {
  const window = new Window({ url: 'http://localhost/auto-reset-fallback-actions' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
}
