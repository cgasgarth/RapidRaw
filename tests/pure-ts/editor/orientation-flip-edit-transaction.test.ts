import { beforeEach, describe, expect, test } from 'bun:test';

import { editDocumentGeometryV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import {
  buildOrientationFlipEditTransaction,
  type OrientationFlipCommitIdentity,
} from '../../../src/utils/orientationFlipEditTransaction';

const sourcePath = '/fixture/orientation-flip.ARW';
const session = createEditorImageSession({ generation: 9, path: sourcePath, source: 'cache' });
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
const identity = (overrides: Partial<OrientationFlipCommitIdentity> = {}): OrientationFlipCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});

describe('orientation flip edit transaction', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.35 };
    const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
      exposure: adjustments.exposure,
    });
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2,
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage,
      history: [editDocumentV2],
    });
  });

  test('commits a node-owned horizontal flip with one receipt and Undo', () => {
    const state = useEditorStore.getState();
    const request = buildOrientationFlipEditTransaction(state, identity(), 'horizontal', true, 'flip-horizontal');
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      { nodeType: 'geometry', patch: { flipHorizontal: true }, type: 'patch-edit-document-node' },
    ]);
    expect(result).toMatchObject({
      changedKeys: ['nodes.geometry.params.flipHorizontal'],
      nextAdjustmentRevision: 1,
      noOp: false,
      source: 'geometry-tool',
    });
    expect(editDocumentGeometryV2Schema.parse(result.after.nodes['geometry']?.params).flipHorizontal).toBe(true);
    expect(result.after.nodes['scene_global_color_tone']).toEqual(result.before.nodes['scene_global_color_tone']);
    expect(result.invalidatedStages).toContain('geometry');
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'geometry-tool',
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.geometry.flipHorizontal).toBe(false);
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0.35);
  });

  test('supports vertical flips, exact no-ops, and stale source/session/revision rejection', () => {
    const state = useEditorStore.getState();
    expect(
      buildOrientationFlipEditTransaction(state, identity(), 'vertical', true, 'flip-vertical').operations,
    ).toEqual([{ nodeType: 'geometry', patch: { flipVertical: true }, type: 'patch-edit-document-node' }]);

    const noOp = state.applyEditTransaction(
      buildOrientationFlipEditTransaction(state, identity(), 'horizontal', false, 'flip-no-op'),
    );
    expect(noOp.noOp).toBe(true);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();

    expect(() =>
      buildOrientationFlipEditTransaction(
        state,
        identity({ sourceIdentity: '/fixture/stale.ARW' }),
        'horizontal',
        true,
        'stale-source',
      ),
    ).toThrow('orientation_flip_transaction.stale_source');
    expect(() =>
      buildOrientationFlipEditTransaction(
        state,
        identity({ imageSessionId: 'editor-image-session:stale' }),
        'horizontal',
        true,
        'stale-session',
      ),
    ).toThrow('orientation_flip_transaction.stale_session');
    expect(() =>
      buildOrientationFlipEditTransaction(
        state,
        identity({ adjustmentRevision: 1 }),
        'horizontal',
        true,
        'stale-revision',
      ),
    ).toThrow('orientation_flip_transaction.stale_revision');
  });
});
