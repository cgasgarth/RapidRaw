import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildContextAutoAdjustEditTransaction,
  type ContextAutoAdjustPatch,
  captureContextAutoAdjustBase,
  contextAutoAdjustPatchSchema,
  isCurrentContextAutoAdjustRequest,
} from '../../../src/utils/contextAutoAdjustEditTransaction';
import { legacyAdjustmentsToEditDocumentV2, setEditDocumentV2NodeEnabled } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixture/context-auto-adjust.ARW';
const session = createEditorImageSession({ generation: 61, path: sourcePath, source: 'cache' });
const selectedImage = {
  height: 3000,
  isReady: true,
  path: sourcePath,
  rawDevelopmentReport: { contract: 'runtime-proof' },
};
const patch = {
  blacks: -4,
  brightness: 1.2,
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
  centré: 2,
} satisfies ContextAutoAdjustPatch;

describe('context Auto Adjust edit transaction', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    adjustments.effectsEnabled = false;
    const editDocumentV2 = setEditDocumentV2NodeEnabled(
      legacyAdjustmentsToEditDocumentV2(adjustments),
      'scene_curve',
      false,
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

  test('commits validated native output as one persistent Auto Edit revision with Undo', () => {
    const state = useEditorStore.getState();
    const base = captureContextAutoAdjustBase(state);
    if (base === null) throw new Error('Expected context Auto Adjust base');
    const result = state.applyEditTransaction(
      buildContextAutoAdjustEditTransaction(state, base, patch, 'context-auto-adjust'),
    );

    expect(result.after).toMatchObject({ contrast: 18, exposure: 0.35, whiteBalanceMigration: 'native_v1' });
    expect(result.after.whiteBalanceTechnical.inputSemantics).toBe('raw_scene_linear');
    expect(result.after).not.toHaveProperty('sectionVisibility');
    expect(result.afterEditDocumentV2.nodes.scene_curve.enabled).toBeFalse();
    expect(result.after.effectsEnabled).toBeFalse();
    expect(result.afterEditDocumentV2.nodes.display_creative.enabled).toBeFalse();
    expect(result.applicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'auto-edit',
      transactionId: 'context-auto-adjust',
    });
    expect(useEditorStore.getState()).toMatchObject({ adjustmentRevision: 1, historyIndex: 1 });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value).toMatchObject({ contrast: 0, exposure: 0 });
  });

  test('rejects stale source, session, revision, and superseded request generations', () => {
    const state = useEditorStore.getState();
    const base = captureContextAutoAdjustBase(state);
    if (base === null) throw new Error('Expected context Auto Adjust base');

    expect(isCurrentContextAutoAdjustRequest(state, base, 2, 2)).toBe(true);
    expect(isCurrentContextAutoAdjustRequest(state, base, 1, 2)).toBe(false);
    expect(() =>
      buildContextAutoAdjustEditTransaction(
        { ...state, selectedImage: { isReady: true, path: '/fixture/B.ARW', rawDevelopmentReport: null } },
        base,
        patch,
        'stale-source',
      ),
    ).toThrow('context_auto_adjust_transaction.stale_source');
    expect(() =>
      buildContextAutoAdjustEditTransaction(
        { ...state, imageSession: { id: 'successor' } },
        base,
        patch,
        'stale-session',
      ),
    ).toThrow('context_auto_adjust_transaction.stale_session');
    expect(() =>
      buildContextAutoAdjustEditTransaction({ ...state, adjustmentRevision: 1 }, base, patch, 'stale-revision'),
    ).toThrow('context_auto_adjust_transaction.stale_revision');
  });

  test('fails closed on malformed native output and preserves exact no-ops', () => {
    expect(contextAutoAdjustPatchSchema.safeParse({ ...patch, exposure: Number.NaN }).success).toBe(false);
    expect(contextAutoAdjustPatchSchema.safeParse({ ...patch, brightness: 5.01 }).success).toBe(false);
    expect(contextAutoAdjustPatchSchema.safeParse({ ...patch, unexpected: true }).success).toBe(false);
    expect(contextAutoAdjustPatchSchema.safeParse({ ...patch, sectionVisibility: { effects: true } }).success).toBe(
      false,
    );
    const state = useEditorStore.getState();
    const base = captureContextAutoAdjustBase(state);
    if (base === null) throw new Error('Expected context Auto Adjust base');
    const currentPatch = contextAutoAdjustPatchSchema.parse({
      ...patch,
      blacks: state.adjustmentSnapshot.value.blacks,
      brightness: state.adjustmentSnapshot.value.brightness,
      clarity: state.adjustmentSnapshot.value.clarity,
      contrast: state.adjustmentSnapshot.value.contrast,
      dehaze: state.adjustmentSnapshot.value.dehaze,
      exposure: state.adjustmentSnapshot.value.exposure,
      highlights: state.adjustmentSnapshot.value.highlights,
      shadows: state.adjustmentSnapshot.value.shadows,
      vibrance: state.adjustmentSnapshot.value.vibrance,
      vignetteAmount: state.adjustmentSnapshot.value.vignetteAmount,
      whiteBalanceMigration: state.adjustmentSnapshot.value.whiteBalanceMigration,
      whiteBalanceTechnical: state.adjustmentSnapshot.value.whiteBalanceTechnical,
      whites: state.adjustmentSnapshot.value.whites,
      centré: state.adjustmentSnapshot.value.centré,
    });
    const result = state.applyEditTransaction(
      buildContextAutoAdjustEditTransaction(state, base, currentPatch, 'context-auto-no-op'),
    );
    expect(result.noOp).toBe(true);
    expect(useEditorStore.getState()).toMatchObject({ adjustmentRevision: 0, historyIndex: 0 });
  });

  test('commits through fallback authority and rejects delayed A to B to A requests', () => {
    useEditorStore.setState({
      finalPreviewUrl: 'blob:fallback-context-auto-before',
      imageSession: null,
      imageSessionId: 121,
    });
    const state = useEditorStore.getState();
    const base = captureContextAutoAdjustBase(state);
    if (base === null) throw new Error('Expected fallback context Auto Adjust base');
    expect(base.imageSessionId).toBe('editor-image-session:121');
    expect(isCurrentContextAutoAdjustRequest(state, base, 4, 4)).toBeTrue();
    expect(isCurrentContextAutoAdjustRequest(state, base, 3, 4)).toBeFalse();
    expect(
      isCurrentContextAutoAdjustRequest(
        {
          ...state,
          imageSessionId: 122,
          selectedImage: { isReady: true, path: '/fixture/B.ARW', rawDevelopmentReport: null },
        },
        base,
        4,
        4,
      ),
    ).toBeFalse();
    expect(isCurrentContextAutoAdjustRequest({ ...state, imageSessionId: 123 }, base, 4, 4)).toBeFalse();
    expect(isCurrentContextAutoAdjustRequest({ ...state, adjustmentRevision: 1 }, base, 4, 4)).toBeFalse();

    const result = state.applyEditTransaction(
      buildContextAutoAdjustEditTransaction(state, base, patch, 'fallback-context-auto'),
    );
    expect(result).toMatchObject({ nextAdjustmentRevision: 1, noOp: false, source: 'auto-edit' });
    expect(useEditorStore.getState()).toMatchObject({
      finalPreviewUrl: null,
      historyIndex: 1,
      lastEditApplicationReceipt: {
        imageSessionId: base.imageSessionId,
        transactionId: 'fallback-context-auto',
      },
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.exposure).toBe(0);
    expect(() =>
      buildContextAutoAdjustEditTransaction({ ...state, imageSessionId: 123 }, base, patch, 'stale-reopened-a'),
    ).toThrow('context_auto_adjust_transaction.stale_session');
  });
});
