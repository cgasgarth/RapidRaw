import { afterEach, expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useEditorActions } from '../../../src/hooks/editor/useEditorActions';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
const sourcePath = '/fixture/orientation-rotate-action.ARW';
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
});

test('useEditorActions routes rotate through one geometry transaction', () => {
  installDom();
  const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), aspectRatio: 4 / 3, exposure: 0.25 };
  const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
  const session = createEditorImageSession({ generation: 51, path: sourcePath, source: 'cache' });
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2,
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: session,
    imageSessionId: session.generation,
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
  let handleRotate: ReturnType<typeof useEditorActions>['handleRotate'] | null = null;
  const Harness = () => {
    handleRotate = useEditorActions().handleRotate;
    return null;
  };
  const container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(createElement(Harness)));

  act(() => handleRotate?.(90));
  const after = useEditorStore.getState();
  expect(after.adjustmentSnapshot.value).toMatchObject({
    aspectRatio: 3 / 4,
    exposure: 0.25,
    orientationSteps: 1,
    rotation: 0,
  });
  expect(after.history).toHaveLength(2);
  expect(after.lastEditApplicationReceipt).toMatchObject({
    adjustmentRevision: 1,
    imageSessionId: session.id,
    persistence: 'commit',
    source: 'geometry-tool',
  });
});

function installDom() {
  const window = new Window({ url: 'http://localhost/orientation-rotate-action' });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: window.document });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: window.navigator });
  Object.defineProperty(globalThis, 'HTMLElement', { configurable: true, value: window.HTMLElement });
}
