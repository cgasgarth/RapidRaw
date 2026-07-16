import { expect, mock, test } from 'bun:test';
import { act, render } from '@testing-library/react';
import { createElement } from 'react';

import { useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  createDefaultEditDocumentV2,
  patchEditDocumentV2Node,
  setEditDocumentV2NodeEnabled,
} from '../../../src/utils/editDocumentV2';

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
        editDocumentV2: createDefaultEditDocumentV2(),
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

test('useEditorActions routes Auto Adjust and native Reset through fallback authority', async () => {
  const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), effectsEnabled: false, exposure: 0.6 };
  const editDocumentV2 = setEditDocumentV2NodeEnabled(
    patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
      exposure: adjustments.exposure,
    }),
    'display_creative',
    adjustments.effectsEnabled,
  );
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    editDocumentV2,
    finalPreviewUrl: 'blob:fallback-actions-before',
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
    history: [editDocumentV2],
  });
  let actions: ReturnType<typeof useEditorActions> | null = null;
  const Harness = () => {
    actions = useEditorActions();
    return null;
  };
  render(createElement(Harness));

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
  expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0.35);
  expect(useEditorStore.getState().editDocumentV2.nodes['display_creative']!.enabled).toBeFalse();

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
  expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0);
  expect(useEditorStore.getState().editDocumentV2.nodes['display_creative']!.enabled).toBeTrue();
  expect(invoke).toHaveBeenCalledTimes(2);
});
