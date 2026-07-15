import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useCameraInputEditCommit } from '../../../src/hooks/editor/useCameraInputEditCommit';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const sourcePath = '/fixture/camera-input-fallback-action.ARW';
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
});

test('camera input hook dispatches from a selected-image fallback session', () => {
  installDom();
  const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.35 };
  const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
    adjustments,
    editDocumentV2,
    history: [adjustments],
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId: 71,
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
  });
  let commitCameraInput: ReturnType<typeof useCameraInputEditCommit>['commitCameraInput'] | null = null;
  const Harness = () => {
    commitCameraInput = useCameraInputEditCommit().commitCameraInput;
    return null;
  };
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(Harness)));

  act(() => commitCameraInput?.({ cameraProfile: 'camera_neutral', cameraProfileAmount: 74 }));
  expect(useEditorStore.getState().adjustments).toMatchObject({
    cameraProfile: 'camera_neutral',
    cameraProfileAmount: 74,
    exposure: 0.35,
  });
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    imageSessionId: 'editor-image-session:71',
    source: 'manual-control',
  });
});

function installDom() {
  const window = new Window({ url: 'http://localhost/camera-input-fallback-action' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
}
