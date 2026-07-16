import { expect, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import { createElement } from 'react';
import { useCameraInputEditCommit } from '../../../src/hooks/editor/useCameraInputEditCommit';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixture/camera-input-fallback-action.ARW';

test('camera input hook dispatches from a selected-image fallback session', () => {
  const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.35 };
  const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
    exposure: adjustments.exposure,
  });
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2,
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
    history: [editDocumentV2],
  });
  let commitCameraInput: ReturnType<typeof useCameraInputEditCommit>['commitCameraInput'] | null = null;
  const Harness = () => {
    commitCameraInput = useCameraInputEditCommit().commitCameraInput;
    return null;
  };
  render(createElement(Harness));

  act(() => commitCameraInput?.({ cameraProfile: 'camera_neutral', cameraProfileAmount: 74 }));
  expect(useEditorStore.getState().editDocumentV2.nodes['camera_input']?.params).toMatchObject({
    cameraProfile: 'camera_neutral',
    cameraProfileAmount: 74,
  });
  expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']?.params['exposure']).toBe(0.35);
  expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
    imageSessionId: 'editor-image-session:71',
    source: 'manual-control',
  });
});
