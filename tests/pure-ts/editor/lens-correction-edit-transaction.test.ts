import { beforeEach, describe, expect, test } from 'bun:test';

import { editDocumentLensCorrectionV2Schema } from '../../../packages/rawengine-schema/src/editDocumentV2';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';
import {
  EditorPersistenceEffectRunner,
  type EditorPersistenceExecution,
} from '../../../src/utils/editorPersistenceEffectRunner';
import { hydrateImageOpenEditDocumentV2 } from '../../../src/utils/imageOpenAdjustmentHydration';
import {
  buildLensCorrectionEditTransaction,
  buildLensProfileEditTransaction,
  captureLensCorrectionCommitIdentity,
  isCurrentLensProfileRequest,
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
    const editDocumentV2 = patchEditDocumentV2Node(
      patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
        exposure: adjustments.exposure,
      }),
      'geometry',
      { flipHorizontal: adjustments.flipHorizontal },
    );
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
      changedKeys: ['nodes.lens_correction.params.lensVignetteAmount'],
      invalidatedStages: ['preview', 'navigator', 'thumbnail', 'geometry'],
      nextAdjustmentRevision: 1,
      noOp: false,
    });
    expect(
      editDocumentLensCorrectionV2Schema.parse(result.after.nodes['lens_correction']?.params).lensVignetteAmount,
    ).toBe(135);
    expect(result.after.nodes['geometry']).toEqual(result.before.nodes['geometry']);
    expect(result.after.nodes['scene_global_color_tone']).toEqual(result.before.nodes['scene_global_color_tone']);
    expect(result.after.extensions['legacyAdjustments']).not.toHaveProperty('lensVignetteAmount');
    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'manual-control',
    });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.nodes['lens_correction']!.params['lensVignetteAmount']).toBe(100);
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0.4);
    expect(useEditorStore.getState().editDocumentV2.geometry.flipHorizontal).toBe(true);
  });

  test('owns all manual controls, exact no-ops, and stale source/session/revision rejection', () => {
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

  test('commits manual chromatic aberration through lens node authority and Undo', () => {
    const state = useEditorStore.getState();
    const beforeLens = state.editDocumentV2.nodes['lens_correction'];
    const beforeTone = state.editDocumentV2.nodes['scene_global_color_tone'];
    const result = state.applyEditTransaction(
      buildLensCorrectionEditTransaction(state, identity(), 'chromaticAberrationRedCyan', 22, 'manual-ca-red-cyan'),
    );

    expect(result.changedKeys).toEqual(['nodes.lens_correction.params.chromaticAberrationRedCyan']);
    expect(
      editDocumentLensCorrectionV2Schema.parse(result.after.nodes['lens_correction']?.params)
        .chromaticAberrationRedCyan,
    ).toBe(22);
    expect(result.after.nodes['lens_correction']).not.toBe(beforeLens);
    expect(result.after.nodes['scene_global_color_tone']).toBe(beforeTone);
    expect(useEditorStore.getState().adjustmentSnapshot.value.chromaticAberrationRedCyan).toBe(22);

    useEditorStore.getState().undo();
    expect(
      useEditorStore.getState().editDocumentV2.nodes['lens_correction']!.params['chromaticAberrationRedCyan'],
    ).toBe(0);
    expect(
      editDocumentLensCorrectionV2Schema.parse(
        useEditorStore.getState().editDocumentV2.nodes['lens_correction']?.params,
      ).chromaticAberrationRedCyan,
    ).toBe(0);
  });

  test('carries manual chromatic aberration node authority through save execution and reopen', async () => {
    const before = useEditorStore.getState();
    const beforeDocument = before.editDocumentV2;
    before.applyEditTransaction(
      buildLensCorrectionEditTransaction(before, identity(), 'chromaticAberrationBlueYellow', -14, 'save-manual-ca'),
    );
    const committed = useEditorStore.getState();
    const executions: EditorPersistenceExecution[] = [];
    const runner = new EditorPersistenceEffectRunner({
      clearTimer: () => {},
      execute: async (execution) => {
        executions.push(execution);
        return { path: execution.path, sidecarRevision: `sha256:${'a'.repeat(64)}` };
      },
      onAccepted: () => {},
      setTimer: (callback, _delayMs) => {
        callback();
        return setTimeout(() => {}, 0);
      },
    });
    runner.installSession({
      adjustmentRevision: 0,
      editDocumentV2: beforeDocument,
      imageSessionId: session.id,
      path: sourcePath,
      sessionGeneration: session.generation,
    });
    if (committed.lastEditApplicationReceipt === null) throw new Error('missing committed lens receipt');
    runner.submitCommitted({
      adjustmentRevision: committed.adjustmentRevision,
      editDocumentV2: committed.editDocumentV2,
      imageSessionId: session.id,
      interactionActive: false,
      multiSelection: null,
      path: sourcePath,
      receipt: committed.lastEditApplicationReceipt,
      sessionGeneration: session.generation,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(executions).toHaveLength(1);
    const execution = executions[0];
    if (execution === undefined) throw new Error('Expected one lens persistence execution.');
    expect(
      editDocumentLensCorrectionV2Schema.parse(execution.editDocumentV2.nodes['lens_correction']?.params)
        .chromaticAberrationBlueYellow,
    ).toBe(-14);
    const reopened = hydrateImageOpenEditDocumentV2({ editDocumentV2: execution.editDocumentV2 });
    expect(
      editDocumentLensCorrectionV2Schema.parse(reopened.nodes['lens_correction']?.params).chromaticAberrationBlueYellow,
    ).toBe(-14);
    expect(reopened).toEqual(committed.editDocumentV2);
  });

  test('commits complete profile identity atomically and rejects orphan or stale profile results', () => {
    const lensDistortionParams = {
      k1: 0.1,
      k2: -0.02,
      k3: 0.003,
      model: 1,
      tca_vb: 0.99,
      tca_vr: 1.01,
      vig_k1: 0.2,
      vig_k2: 0.01,
      vig_k3: 0,
    };
    const state = useEditorStore.getState();
    const request = buildLensProfileEditTransaction(
      state,
      identity(),
      {
        lensCorrectionMode: 'manual',
        lensDistortionParams,
        lensMaker: 'Harness Optics',
        lensModel: '35mm Prime',
      },
      'lens-profile',
    );
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      {
        nodeType: 'lens_correction',
        patch: {
          lensCorrectionMode: 'manual',
          lensDistortionParams,
          lensMaker: 'Harness Optics',
          lensModel: '35mm Prime',
        },
        type: 'patch-edit-document-node',
      },
    ]);
    expect(editDocumentLensCorrectionV2Schema.parse(result.after.nodes['lens_correction']?.params)).toMatchObject({
      lensCorrectionMode: 'manual',
      lensDistortionParams,
      lensMaker: 'Harness Optics',
      lensModel: '35mm Prime',
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.nodes['lens_correction']?.params).toMatchObject({
      lensMaker: null,
      lensModel: null,
    });

    const restored = useEditorStore.getState();
    expect(() =>
      restored.applyEditTransaction(
        buildLensProfileEditTransaction(restored, identity(), { lensModel: 'Orphan model' }, 'orphan'),
      ),
    ).toThrow();
    expect(() =>
      buildLensProfileEditTransaction(
        restored,
        identity({ adjustmentRevision: 1 }),
        { lensCorrectionMode: 'auto' },
        'stale-profile',
      ),
    ).toThrow('lens_correction_transaction.stale_revision');

    expect(isCurrentLensProfileRequest(restored, identity({ adjustmentRevision: 2 }), 4, 4)).toBe(true);
    expect(isCurrentLensProfileRequest(restored, identity({ adjustmentRevision: 2 }), 3, 4)).toBe(false);
    expect(isCurrentLensProfileRequest(restored, identity({ adjustmentRevision: 1 }), 4, 4)).toBe(false);
    expect(
      isCurrentLensProfileRequest(
        { ...restored, selectedImage: { path: '/fixtures/other.ARW' } },
        identity({ adjustmentRevision: 2 }),
        4,
        4,
      ),
    ).toBe(false);
    expect(
      isCurrentLensProfileRequest(
        { ...restored, imageSession: { id: 'other-session' } },
        identity({ adjustmentRevision: 2 }),
        4,
        4,
      ),
    ).toBe(false);
  });

  test('routes fallback profile and manual edits while rejecting delayed A to B to A results', () => {
    useEditorStore.setState({
      finalPreviewUrl: 'blob:fallback-lens-before',
      imageSession: null,
      imageSessionId: 61,
    });
    const state = useEditorStore.getState();
    const fallbackIdentity: LensCorrectionCommitIdentity = {
      adjustmentRevision: 0,
      imageSessionId: 'editor-image-session:61',
      sourceIdentity: sourcePath,
    };
    expect(captureLensCorrectionCommitIdentity(state)).toEqual(fallbackIdentity);

    const profileResult = state.applyEditTransaction(
      buildLensProfileEditTransaction(
        state,
        fallbackIdentity,
        { lensCorrectionMode: 'manual', lensMaker: 'Fallback Optics', lensModel: null },
        'fallback-profile',
      ),
    );
    expect(profileResult).toMatchObject({
      changedKeys: ['nodes.lens_correction.params.lensMaker'],
      nextAdjustmentRevision: 1,
      noOp: false,
    });
    expect(useEditorStore.getState()).toMatchObject({
      finalPreviewUrl: null,
      historyIndex: 1,
      lastEditApplicationReceipt: {
        imageSessionId: fallbackIdentity.imageSessionId,
        transactionId: 'fallback-profile',
      },
    });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.nodes['lens_correction']!.params['lensMaker']).toBeNull();

    useEditorStore.setState({ finalPreviewUrl: 'blob:fallback-manual-before' });
    const restored = useEditorStore.getState();
    const restoredIdentity = captureLensCorrectionCommitIdentity(restored);
    if (restoredIdentity === null) throw new Error('missing fallback lens identity after Undo');
    const receiptBeforeNoOp = restored.lastEditApplicationReceipt;
    const noOp = restored.applyEditTransaction(
      buildLensCorrectionEditTransaction(
        restored,
        restoredIdentity,
        'lensVignetteAmount',
        100,
        'fallback-manual-no-op',
      ),
    );
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState()).toMatchObject({
      finalPreviewUrl: 'blob:fallback-manual-before',
      historyIndex: 0,
    });
    expect(useEditorStore.getState().lastEditApplicationReceipt).toEqual(receiptBeforeNoOp);
    const manualResult = restored.applyEditTransaction(
      buildLensCorrectionEditTransaction(restored, restoredIdentity, 'lensVignetteAmount', 145, 'fallback-manual'),
    );
    expect(manualResult).toMatchObject({
      changedKeys: ['nodes.lens_correction.params.lensVignetteAmount'],
      noOp: false,
    });
    expect(useEditorStore.getState()).toMatchObject({ finalPreviewUrl: null, historyIndex: 1 });
    expect(useEditorStore.getState().history).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.nodes['lens_correction']!.params['lensVignetteAmount']).toBe(100);

    expect(isCurrentLensProfileRequest(state, fallbackIdentity, 7, 7)).toBeTrue();
    expect(isCurrentLensProfileRequest(state, fallbackIdentity, 6, 7)).toBeFalse();
    expect(
      isCurrentLensProfileRequest(
        { ...state, imageSessionId: 62, selectedImage: { path: '/fixture/B.ARW' } },
        fallbackIdentity,
        7,
        7,
      ),
    ).toBeFalse();
    expect(isCurrentLensProfileRequest({ ...state, imageSessionId: 63 }, fallbackIdentity, 7, 7)).toBeFalse();
    expect(isCurrentLensProfileRequest({ ...state, adjustmentRevision: 1 }, fallbackIdentity, 7, 7)).toBeFalse();
    expect(() =>
      buildLensProfileEditTransaction(
        { ...state, imageSessionId: 63 },
        fallbackIdentity,
        { lensCorrectionMode: 'auto' },
        'stale-reopened-a',
      ),
    ).toThrow('lens_correction_transaction.stale_session');
  });
});
