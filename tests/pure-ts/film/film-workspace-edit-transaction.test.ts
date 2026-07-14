import { afterEach, describe, expect, test } from 'bun:test';

import { matchLookApplicationReceiptV1Schema } from '../../../packages/rawengine-schema/src/referenceMatchRuntime';
import { useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { buildEditTransactionPersistenceContext } from '../../../src/utils/editTransaction';
import {
  hydrateFilmEmulationTargetState,
  REFERENCE_FILM_PROFILE_REF,
} from '../../../src/utils/film-look/filmEmulationOperation';
import { buildFilmWorkspaceEditTransactionRequest } from '../../../src/utils/film-look/filmWorkspaceEditTransaction';

const fingerprint = (digit: string): `fnv1a64:${string}` => `fnv1a64:${digit.repeat(16)}`;
const receipt = matchLookApplicationReceiptV1Schema.parse({
  appliedDiffs: [{ after: 12, before: 0, key: 'saturation' }],
  appliedAt: '2026-07-14T12:00:00.000Z',
  baseGraphFingerprint: fingerprint('0'),
  destination: 'global-adjustments',
  effectiveReferences: [{ role: 'creative', sourceFingerprint: fingerprint('4'), weight: 1 }],
  enabledGroups: ['color'],
  historyEntriesAdded: 1,
  impact: 100,
  proposalFingerprint: fingerprint('1'),
  resultingGraphFingerprint: fingerprint('2'),
  schemaVersion: 1,
  targetAnalysisFingerprint: fingerprint('3'),
});

const seedStore = () => {
  const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
  useEditorStore.setState({
    adjustmentRevision: 0,
    adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments),
    adjustments,
    exportSoftProofTransform: {
      blackPointCompensation: 'enabled',
      colorManagedTransform: 'display-p3-preview',
      effectiveColorProfile: 'Display P3',
      effectiveRenderingIntent: 'relative_colorimetric',
      policyStatus: 'active',
      policyVersion: 'test-v1',
      sourcePrecisionPath: 'preview',
      transformApplied: true,
      transformPolicyFingerprint: 'film-before',
    },
    finalPreviewUrl: 'blob:film-before',
    history: [adjustments],
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: null,
    imageSessionId: 9,
    lastEditApplicationReceipt: null,
    transformedOriginalUrl: 'blob:film-original-before',
  });
};

afterEach(seedStore);

describe('Film workspace EditTransaction boundary', () => {
  test('commits a node-scoped edit with one history boundary and persistence identity', () => {
    seedStore();
    const state = useEditorStore.getState();
    const request = buildFilmWorkspaceEditTransactionRequest(state, { filmLookStrength: 72 }, 'film-tx-1');
    const result = state.applyEditTransaction(request);
    const committed = useEditorStore.getState();

    expect(request).toMatchObject({
      baseAdjustmentRevision: 0,
      history: 'single-entry',
      imageSessionId: 'editor-image-session:9',
      persistence: 'commit',
      source: 'film-workspace',
    });
    expect(result.changedKeys).toEqual(['filmLookStrength']);
    expect(result.invalidatedProvenance).toEqual(['reference-match', 'auto-edit', 'derived-render']);
    expect(result.invalidatedStages).toEqual(['preview', 'navigator', 'thumbnail']);
    expect(committed.adjustmentRevision).toBe(1);
    expect(committed.adjustmentSnapshot.value.filmLookStrength).toBe(72);
    expect(committed.history).toHaveLength(2);
    expect(committed.historyIndex).toBe(1);
    expect(committed.finalPreviewUrl).toBeNull();
    expect(committed.transformedOriginalUrl).toBeNull();
    expect(committed.exportSoftProofTransform).toBeNull();
    expect(buildEditTransactionPersistenceContext(request, result)).toEqual({
      transactionId: 'film-tx-1',
      imageSessionId: 'editor-image-session:9',
      baseAdjustmentRevision: 0,
      nextAdjustmentRevision: 1,
    });
  });

  test('exact no-ops preserve revision, history, previews, and persistence authority', () => {
    seedStore();
    const state = useEditorStore.getState();
    const request = buildFilmWorkspaceEditTransactionRequest(
      state,
      { filmLookStrength: state.adjustments.filmLookStrength },
      'film-no-op',
    );
    const result = state.applyEditTransaction(request);
    const committed = useEditorStore.getState();

    expect(result.noOp).toBe(true);
    expect(result.changedKeys).toEqual([]);
    expect(result.invalidatedStages).toEqual([]);
    expect(committed.adjustmentRevision).toBe(0);
    expect(committed.history).toHaveLength(1);
    expect(committed.historyIndex).toBe(0);
    expect(committed.finalPreviewUrl).toBe('blob:film-before');
    expect(committed.lastEditApplicationReceipt).toBeNull();
  });

  test('coalesces a multi-step interaction into one undo boundary and persistence authority', () => {
    seedStore();
    const transactionId = 'film-mix-gesture';
    for (const filmLookStrength of [90, 75, 40]) {
      const state = useEditorStore.getState();
      state.applyEditTransaction(
        buildFilmWorkspaceEditTransactionRequest(state, { filmLookStrength }, transactionId, 'coalesced-interaction'),
      );
    }
    const committed = useEditorStore.getState();
    const persistenceReceipt = committed.lastEditApplicationReceipt;

    expect(committed.adjustments.filmLookStrength).toBe(40);
    expect(committed.adjustmentRevision).toBe(3);
    expect(committed.history).toHaveLength(2);
    expect(committed.historyIndex).toBe(1);
    expect(committed.history[0]?.filmLookStrength).toBe(100);
    expect(committed.history[1]?.filmLookStrength).toBe(40);
    expect(persistenceReceipt).toMatchObject({
      transactionId,
      baseAdjustmentRevision: 0,
      adjustmentRevision: 3,
      changedKeys: ['filmLookStrength'],
    });
    if (!persistenceReceipt) throw new Error('Expected coalesced Film persistence receipt');
    expect(buildEditTransactionPersistenceContext(persistenceReceipt, persistenceReceipt)).toEqual({
      transactionId,
      imageSessionId: 'editor-image-session:9',
      baseAdjustmentRevision: 0,
      nextAdjustmentRevision: 3,
    });

    committed.undo();
    expect(useEditorStore.getState().adjustments.filmLookStrength).toBe(100);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().adjustments.filmLookStrength).toBe(40);
  });

  test('starts a new coalesced boundary when undo moved away from the latest gesture entry', () => {
    seedStore();
    const transactionId = 'film-mix-interrupted-gesture';
    const first = useEditorStore.getState();
    first.applyEditTransaction(
      buildFilmWorkspaceEditTransactionRequest(first, { filmLookStrength: 90 }, transactionId, 'coalesced-interaction'),
    );
    const abandonedGestureEntry = useEditorStore.getState().history[1];

    useEditorStore.getState().undo();
    const resumed = useEditorStore.getState();
    resumed.applyEditTransaction(
      buildFilmWorkspaceEditTransactionRequest(
        resumed,
        { filmLookStrength: 70 },
        transactionId,
        'coalesced-interaction',
      ),
    );

    const committed = useEditorStore.getState();
    expect(committed.history).toHaveLength(2);
    expect(committed.historyIndex).toBe(1);
    expect(committed.history[1]).not.toBe(abandonedGestureEntry);
    expect(committed.history[1]?.filmLookStrength).toBe(70);
    expect(committed.lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 2,
      baseAdjustmentRevision: 1,
      transactionId,
    });
    committed.undo();
    expect(useEditorStore.getState().adjustments.filmLookStrength).toBe(100);
  });

  test('rejects a stale base without publishing partial Film state', () => {
    seedStore();
    const stale = buildFilmWorkspaceEditTransactionRequest(
      useEditorStore.getState(),
      { filmLookStrength: 35 },
      'film-stale',
    );
    const current = useEditorStore.getState();
    current.applyEditTransaction(
      buildFilmWorkspaceEditTransactionRequest(current, { filmLookStrength: 60 }, 'film-current'),
    );
    const beforeStaleApply = useEditorStore.getState();

    expect(() => useEditorStore.getState().applyEditTransaction(stale)).toThrow('edit_transaction.stale_base:0:1');
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: beforeStaleApply.adjustmentRevision,
      adjustments: { filmLookStrength: 60 },
      historyIndex: beforeStaleApply.historyIndex,
    });
  });

  test('carries reference-match invalidation and deterministically hydrates canonical Film nodes', () => {
    const adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      referenceMatchApplicationReceipt: receipt,
      saturation: 12,
    };
    const request = buildFilmWorkspaceEditTransactionRequest(
      { adjustmentRevision: 4, adjustments, imageSessionId: 2 },
      { saturation: -20 },
      'film-provenance',
    );
    expect(request.operations).toEqual([
      { type: 'patch-adjustments', patch: { referenceMatchApplicationReceipt: null, saturation: -20 } },
    ]);

    const node = {
      contractVersion: 1 as const,
      enabled: true,
      mix: 1,
      nodeType: 'film_emulation' as const,
      profileRef: REFERENCE_FILM_PROFILE_REF,
      seedPolicy: 'source_stable_v1' as const,
      workingSpace: 'acescg_linear_v1' as const,
    };
    const first = hydrateFilmEmulationTargetState({ kind: 'image', variantId: 'editor' }, node);
    const second = hydrateFilmEmulationTargetState({ kind: 'image', variantId: 'editor' }, structuredClone(node));
    expect(first.node).toEqual(node);
    expect(first.graphRevision).toBe(second.graphRevision);
    expect(first.graphHash).toBe(second.graphHash);
    expect(first.history).toEqual([]);
  });
});
