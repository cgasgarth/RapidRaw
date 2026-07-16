import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { BasicAdjustment, INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import type { BasicToneCommitIdentity } from '../../../src/utils/basicToneEditTransaction';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixture/basic-slider.ARW';
const session = createEditorImageSession({ generation: 24, path: sourcePath, source: 'cache' });
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

const identity = (imageSessionId = session.id): BasicToneCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId,
  sourceIdentity: sourcePath,
});

describe('basic tone slider interaction authority', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = createDefaultEditDocumentV2();
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      basicToneSliderInteraction: null,
      editDocumentV2,
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      imageSessionId: 24,
      isSliderDragging: false,
      lastEditApplicationReceipt: null,
      selectedImage,
      history: [editDocumentV2],
    });
  });

  test('many previews change only the ephemeral render snapshot, then commit one undoable revision', () => {
    const store = useEditorStore.getState();
    const canonicalAdjustments = store.editDocumentV2;
    const canonicalSnapshot = store.adjustmentSnapshot;
    const canonicalHistory = store.history;

    store.beginBasicToneSliderInteraction(identity(), BasicAdjustment.Exposure, 'drag-exposure');
    for (const value of [0.1, 0.25, 0.4, 0.65]) {
      useEditorStore.getState().updateBasicToneSliderInteraction('drag-exposure', value);
      const previewState = useEditorStore.getState();
      expect(previewState.editDocumentV2).toBe(canonicalAdjustments);
      expect(previewState.adjustmentSnapshot).toBe(canonicalSnapshot);
      expect(previewState.adjustmentRevision).toBe(0);
      expect(previewState.history).toBe(canonicalHistory);
      expect(previewState.lastEditApplicationReceipt).toBeNull();
      const previewDocument = previewState.basicToneSliderInteraction?.previewSnapshot?.editDocumentV2;
      if (previewDocument === undefined) throw new Error('Expected slider preview document.');
      expect(selectEditDocumentNode(previewDocument, 'scene_global_color_tone').params['exposure']).toBe(value);
    }

    const result = useEditorStore.getState().commitBasicToneSliderInteraction('drag-exposure');
    expect(result).toMatchObject({
      changedKeys: ['nodes.scene_global_color_tone.params.exposure'],
      nextAdjustmentRevision: 1,
      noOp: false,
    });
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 1,
      basicToneSliderInteraction: null,
      historyIndex: 1,
      isSliderDragging: false,
      lastEditApplicationReceipt: {
        persistence: 'commit',
        transactionId: 'drag-exposure',
      },
    });
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0.65);
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0.65);
  });

  test('cancel and exact no-op drop preview authority without a late commit', async () => {
    const store = useEditorStore.getState();
    store.beginBasicToneSliderInteraction(identity(), BasicAdjustment.Contrast, 'cancel-contrast');
    useEditorStore.getState().updateBasicToneSliderInteraction('cancel-contrast', 45);
    const previewDocument = useEditorStore.getState().basicToneSliderInteraction?.previewSnapshot?.editDocumentV2;
    if (previewDocument === undefined) throw new Error('Expected slider preview document.');
    expect(selectEditDocumentNode(previewDocument, 'scene_global_color_tone').params['contrast']).toBe(45);
    useEditorStore.getState().cancelBasicToneSliderInteraction('cancel-contrast');
    await Bun.sleep(180);

    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 0,
      basicToneSliderInteraction: null,
      historyIndex: 0,
      isSliderDragging: false,
      lastEditApplicationReceipt: null,
    });
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['contrast']).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);

    useEditorStore.getState().beginBasicToneSliderInteraction(identity(), BasicAdjustment.Exposure, 'no-op-exposure');
    useEditorStore.getState().updateBasicToneSliderInteraction('no-op-exposure', 0);
    expect(useEditorStore.getState().commitBasicToneSliderInteraction('no-op-exposure')?.noOp).toBeTrue();
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 0,
      historyIndex: 0,
      isSliderDragging: false,
      lastEditApplicationReceipt: null,
    });
  });

  test('stale source, session, or revision cannot publish or commit a preview', () => {
    useEditorStore
      .getState()
      .beginBasicToneSliderInteraction(identity(), BasicAdjustment.Highlights, 'stale-highlights');
    useEditorStore.getState().updateBasicToneSliderInteraction('stale-highlights', -30);
    useEditorStore.setState({ selectedImage: { ...selectedImage, path: '/fixture/replacement.ARW' } });
    useEditorStore.getState().updateBasicToneSliderInteraction('stale-highlights', -40);
    expect(useEditorStore.getState().basicToneSliderInteraction).toBeNull();
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['highlights']).toBe(0);

    useEditorStore.setState({ selectedImage });
    useEditorStore.getState().beginBasicToneSliderInteraction(identity(), BasicAdjustment.Shadows, 'stale-revision');
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 1,
      editDocumentV2: useEditorStore.getState().editDocumentV2,
      history: [useEditorStore.getState().editDocumentV2],
      historyIndex: 0,
    });
    expect(useEditorStore.getState().commitBasicToneSliderInteraction('stale-revision')).toBeNull();
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['shadows']).toBe(0);

    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      imageSession: null,
      imageSessionId: 91,
      editDocumentV2: useEditorStore.getState().editDocumentV2,
      history: [useEditorStore.getState().editDocumentV2],
      historyIndex: 0,
    });
    const fallbackIdentity = identity('editor-image-session:91');
    useEditorStore
      .getState()
      .beginBasicToneSliderInteraction(fallbackIdentity, BasicAdjustment.Whites, 'fallback-whites');
    useEditorStore.getState().updateBasicToneSliderInteraction('fallback-whites', 20);
    useEditorStore.setState({ imageSessionId: 92 });
    expect(useEditorStore.getState().commitBasicToneSliderInteraction('fallback-whites')).toBeNull();
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['whites']).toBe(0);
  });

  test('rapid independent sliders retain separate transaction and history boundaries', () => {
    useEditorStore
      .getState()
      .beginBasicToneSliderInteraction(identity(), BasicAdjustment.Exposure, 'superseded-exposure');
    useEditorStore.getState().updateBasicToneSliderInteraction('superseded-exposure', 0.2);
    useEditorStore.getState().beginBasicToneSliderInteraction(identity(), BasicAdjustment.Blacks, 'superseding-blacks');
    useEditorStore.getState().updateBasicToneSliderInteraction('superseding-blacks', -5);
    expect(useEditorStore.getState().commitBasicToneSliderInteraction('superseded-exposure')).toBeNull();
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 0,
      basicToneSliderInteraction: { interactionId: 'superseding-blacks' },
      isSliderDragging: true,
    });
    useEditorStore.getState().cancelBasicToneSliderInteraction('superseding-blacks');

    useEditorStore.getState().beginBasicToneSliderInteraction(identity(), BasicAdjustment.Exposure, 'rapid-exposure');
    useEditorStore.getState().updateBasicToneSliderInteraction('rapid-exposure', 0.4);
    useEditorStore.getState().commitBasicToneSliderInteraction('rapid-exposure');

    const secondIdentity = { ...identity(), adjustmentRevision: 1 };
    useEditorStore.getState().beginBasicToneSliderInteraction(secondIdentity, BasicAdjustment.Blacks, 'rapid-blacks');
    useEditorStore.getState().updateBasicToneSliderInteraction('rapid-blacks', -15);
    useEditorStore.getState().commitBasicToneSliderInteraction('rapid-blacks');

    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 2,
      historyIndex: 2,
      lastEditApplicationReceipt: { transactionId: 'rapid-blacks' },
    });
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']?.params).toMatchObject({
      blacks: -15,
      exposure: 0.4,
    });
    expect(useEditorStore.getState().history).toHaveLength(3);
  });
});
