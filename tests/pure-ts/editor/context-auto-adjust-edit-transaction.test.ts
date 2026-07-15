import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildContextAutoAdjustEditTransaction,
  type ContextAutoAdjustPatch,
  captureContextAutoAdjustBase,
  contextAutoAdjustPatchSchema,
  isCurrentContextAutoAdjustRequest,
} from '../../../src/utils/contextAutoAdjustEditTransaction';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

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
  sectionVisibility: { basic: true, color: true, effects: true },
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
    adjustments.sectionVisibility.curves = false;
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

  test('commits validated native output as one persistent Auto Edit revision with Undo', () => {
    const state = useEditorStore.getState();
    const base = captureContextAutoAdjustBase(state);
    if (base === null) throw new Error('Expected context Auto Adjust base');
    const result = state.applyEditTransaction(
      buildContextAutoAdjustEditTransaction(state, base, patch, 'context-auto-adjust'),
    );

    expect(result.after).toMatchObject({ contrast: 18, exposure: 0.35, whiteBalanceMigration: 'native_v1' });
    expect(result.after.whiteBalanceTechnical.inputSemantics).toBe('raw_scene_linear');
    expect(result.after.sectionVisibility).toMatchObject({ basic: true, color: true, curves: false, effects: true });
    expect(result.applicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'auto-edit',
      transactionId: 'context-auto-adjust',
    });
    expect(useEditorStore.getState()).toMatchObject({ adjustmentRevision: 1, historyIndex: 1 });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments).toMatchObject({ contrast: 0, exposure: 0 });
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
    const state = useEditorStore.getState();
    const base = captureContextAutoAdjustBase(state);
    if (base === null) throw new Error('Expected context Auto Adjust base');
    const currentPatch = contextAutoAdjustPatchSchema.parse({
      ...patch,
      blacks: state.adjustments.blacks,
      brightness: state.adjustments.brightness,
      clarity: state.adjustments.clarity,
      contrast: state.adjustments.contrast,
      dehaze: state.adjustments.dehaze,
      exposure: state.adjustments.exposure,
      highlights: state.adjustments.highlights,
      shadows: state.adjustments.shadows,
      vibrance: state.adjustments.vibrance,
      vignetteAmount: state.adjustments.vignetteAmount,
      whiteBalanceMigration: state.adjustments.whiteBalanceMigration,
      whiteBalanceTechnical: state.adjustments.whiteBalanceTechnical,
      whites: state.adjustments.whites,
      centré: state.adjustments.centré,
    });
    const result = state.applyEditTransaction(
      buildContextAutoAdjustEditTransaction(state, base, currentPatch, 'context-auto-no-op'),
    );
    expect(result.noOp).toBe(true);
    expect(useEditorStore.getState()).toMatchObject({ adjustmentRevision: 0, historyIndex: 0 });
  });
});
