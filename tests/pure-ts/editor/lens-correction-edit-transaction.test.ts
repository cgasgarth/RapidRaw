import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  buildLensCorrectionEditTransaction,
  isManualLensCorrectionAdjustment,
  type LensCorrectionCommitIdentity,
  MANUAL_LENS_CORRECTION_ADJUSTMENTS,
} from '../../../src/utils/lensCorrectionEditTransaction';

const sourcePath = '/fixture/manual-lens-controls.ARW';
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
const identity = (overrides: Partial<LensCorrectionCommitIdentity> = {}): LensCorrectionCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});

describe('lens correction edit transaction', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.4, flipHorizontal: true };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.setState({
      adjustmentRevision: 0,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
      adjustments,
      editDocumentV2,
      history: [adjustments],
      historyCheckpoints: [],
      historyIndex: 0,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage,
    });
  });

  test('commits one source-bound lens node revision while preserving tone, geometry, and Undo', () => {
    const state = useEditorStore.getState();
    const request = buildLensCorrectionEditTransaction(
      state,
      identity(),
      'lensVignetteAmount',
      135,
      'lens-vignette-135',
    );
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      { nodeType: 'lens_correction', patch: { lensVignetteAmount: 135 }, type: 'patch-edit-document-node' },
    ]);
    expect(result).toMatchObject({
      changedKeys: ['lensVignetteAmount'],
      invalidatedStages: ['preview', 'navigator', 'thumbnail', 'geometry'],
      nextAdjustmentRevision: 1,
      noOp: false,
    });
    expect(result.afterEditDocumentV2.nodes.lens_correction?.params.lensVignetteAmount).toBe(135);
    expect(result.afterEditDocumentV2.nodes.geometry).toEqual(result.beforeEditDocumentV2.nodes.geometry);
    expect(result.afterEditDocumentV2.nodes.scene_global_color_tone).toEqual(
      result.beforeEditDocumentV2.nodes.scene_global_color_tone,
    );
    expect(result.afterEditDocumentV2.extensions.legacyAdjustments).not.toHaveProperty('lensVignetteAmount');
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'manual-control',
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.lensVignetteAmount).toBe(100);
    expect(useEditorStore.getState().adjustments.exposure).toBe(0.4);
    expect(useEditorStore.getState().adjustments.flipHorizontal).toBe(true);
  });

  test('owns all six manual controls, exact no-ops, and stale source/session/revision rejection', () => {
    const state = useEditorStore.getState();
    for (const field of MANUAL_LENS_CORRECTION_ADJUSTMENTS) {
      expect(isManualLensCorrectionAdjustment(field)).toBeTrue();
    }
    expect(isManualLensCorrectionAdjustment('lensMaker')).toBeFalse();

    const noOp = state.applyEditTransaction(
      buildLensCorrectionEditTransaction(state, identity(), 'lensVignetteAmount', 100, 'lens-no-op'),
    );
    expect(noOp.noOp).toBe(true);
    expect(useEditorStore.getState().adjustmentRevision).toBe(0);
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toBeNull();

    expect(() =>
      buildLensCorrectionEditTransaction(
        state,
        identity({ sourceIdentity: '/fixture/stale.ARW' }),
        'lensVignetteAmount',
        110,
        'stale-source',
      ),
    ).toThrow('lens_correction_transaction.stale_source');
    expect(() =>
      buildLensCorrectionEditTransaction(
        state,
        identity({ imageSessionId: 'editor-image-session:stale' }),
        'lensVignetteAmount',
        110,
        'stale-session',
      ),
    ).toThrow('lens_correction_transaction.stale_session');
    expect(() =>
      buildLensCorrectionEditTransaction(
        state,
        identity({ adjustmentRevision: 1 }),
        'lensVignetteAmount',
        110,
        'stale-revision',
      ),
    ).toThrow('lens_correction_transaction.stale_revision');
  });
});
