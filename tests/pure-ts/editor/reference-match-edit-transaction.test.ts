import { beforeEach, describe, expect, test } from 'bun:test';

import {
  editDocumentCameraInputV2Schema,
  editDocumentLayersV2Schema,
} from '../../../packages/rawengine-schema/src/editDocumentV2';
import { matchLookProposalV1Schema } from '../../../packages/rawengine-schema/src/referenceMatchRuntime';
import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  buildReferenceMatchGlobalEditTransaction,
  buildReferenceMatchLayerEditTransaction,
  captureReferenceMatchCommitIdentity,
  type ReferenceMatchCommitIdentity,
} from '../../../src/utils/referenceMatchEditTransaction';

const sourcePath = '/fixture/reference-match.ARW';
const session = createEditorImageSession({ generation: 44, path: sourcePath, source: 'cache' });
const fingerprint = (value: string) => `fnv1a64:${value.repeat(16).slice(0, 16)}`;
const proposal = matchLookProposalV1Schema.parse({
  confidence: 0.9,
  diffs: [{ current: 0, group: 'tone', key: 'exposure', proposed: 0.8 }],
  effectiveReferences: [{ role: 'creative', sourceFingerprint: fingerprint('4'), weight: 1 }],
  mode: 'match-look',
  processVersion: 'rapidraw-reference-match-v1',
  proposalFingerprint: fingerprint('6'),
  residualAfter: 0.1,
  residualBefore: 0.5,
  schemaVersion: 1,
  targetAnalysisFingerprint: fingerprint('7'),
  warnings: [],
});
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

const identity = (overrides: Partial<ReferenceMatchCommitIdentity> = {}): ReferenceMatchCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  proposalFingerprint: proposal.proposalFingerprint,
  sourceIdentity: sourcePath,
  targetAnalysisFingerprint: proposal.targetAnalysisFingerprint,
  ...overrides,
});

describe('reference match edit transaction', () => {
  beforeEach(() => {
    const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
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

  test('commits global pixels and provenance as one persistent revision with Undo', () => {
    const state = useEditorStore.getState();
    expect(captureReferenceMatchCommitIdentity(state, proposal)).toEqual(identity());
    const commit = buildReferenceMatchGlobalEditTransaction({
      appliedAt: '2026-07-14T12:00:00.000Z',
      enabledGroups: new Set(['tone']),
      identity: identity(),
      impact: 50,
      proposal,
      state,
      transactionId: 'reference-global',
    });
    if (commit === null) throw new Error('Expected global transaction');

    const result = state.applyEditTransaction(commit.request);
    expect(result.after).toMatchObject({
      exposure: 0.4,
      referenceMatchApplicationReceipt: commit.receipt,
    });
    expect(result.applicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      persistence: 'commit',
      source: 'reference-match',
      transactionId: 'reference-global',
    });
    expect(useEditorStore.getState()).toMatchObject({ historyIndex: 1, adjustmentRevision: 1 });

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value).toMatchObject({
      exposure: 0,
      referenceMatchApplicationReceipt: null,
    });
  });

  test('commits technical white balance as one camera-input patch and preserves reference lock', () => {
    const lockedAdjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      whiteBalanceTechnical: {
        ...structuredClone(INITIAL_ADJUSTMENTS.whiteBalanceTechnical),
        synchronization: { mode: 'locked_reference' as const, referenceSourceIdentity: '/fixture/reference.ARW' },
      },
    };
    const state = useEditorStore.getState();
    const lockedDocument = legacyAdjustmentsToEditDocumentV2(lockedAdjustments);
    state.hydrateEditorRenderAuthority({
      editDocumentV2: lockedDocument,
      history: [lockedDocument],
    });
    const wbProposal = matchLookProposalV1Schema.parse({
      ...proposal,
      diffs: [
        { current: 6_504, group: 'color', key: 'whiteBalanceKelvin', proposed: 7_200 },
        { current: 0, group: 'color', key: 'whiteBalanceDuv', proposed: 0.008 },
      ],
      proposalFingerprint: fingerprint('9'),
    });
    const commitIdentity = captureReferenceMatchCommitIdentity(useEditorStore.getState(), wbProposal);
    if (commitIdentity === null) throw new Error('Expected reference-match identity');
    const commit = buildReferenceMatchGlobalEditTransaction({
      enabledGroups: new Set(['color']),
      identity: commitIdentity,
      impact: 100,
      proposal: wbProposal,
      state: useEditorStore.getState(),
      transactionId: 'reference-global-white-balance',
    });
    if (commit === null) throw new Error('Expected white-balance transaction');

    const result = useEditorStore.getState().applyEditTransaction(commit.request);
    expect(result.after.whiteBalanceTechnical).toMatchObject({
      duv: 0.008,
      kelvin: 7_200,
      mode: 'kelvin_tint',
      source: 'user',
      synchronization: { mode: 'locked_reference', referenceSourceIdentity: '/fixture/reference.ARW' },
    });
    expect(
      editDocumentCameraInputV2Schema.parse(result.afterEditDocumentV2.nodes['camera_input']?.params)
        .whiteBalanceTechnical,
    ).toEqual(result.after.whiteBalanceTechnical);
    expect(commit.receipt.appliedDiffs.map((diff) => diff.key)).toEqual(['whiteBalanceDuv', 'whiteBalanceKelvin']);
  });

  test('commits a reference layer through the Layers node without changing global exposure', () => {
    const state = useEditorStore.getState();
    const commit = buildReferenceMatchLayerEditTransaction({
      appliedAt: '2026-07-14T12:00:00.000Z',
      enabledGroups: new Set(['tone']),
      identity: identity(),
      impact: 75,
      layerId: 'reference-layer',
      layerName: 'Reference Match',
      proposal,
      state,
      transactionId: 'reference-layer-transaction',
    });
    if (commit === null) throw new Error('Expected layer transaction');

    const result = state.applyEditTransaction(commit.request);
    expect(result.after.exposure).toBe(0);
    expect(result.after.masks[0]).toMatchObject({
      id: 'reference-layer',
      opacity: 100,
      referenceMatchApplicationReceipt: commit.receipt,
    });
    expect(result.after.masks[0]?.adjustments.exposure).toBeCloseTo(0.6, 8);
    expect(editDocumentLayersV2Schema.parse(result.afterEditDocumentV2.nodes['layers']?.params).masks).toHaveLength(1);
    expect(result.applicationReceipt).toMatchObject({ persistence: 'commit', source: 'reference-match' });
    expect(useEditorStore.getState()).toMatchObject({ historyIndex: 1, adjustmentRevision: 1 });
  });

  test('fails closed on stale source, session, revision, or proposal and preserves exact no-ops', () => {
    const state = useEditorStore.getState();
    const build = (commitIdentity: ReferenceMatchCommitIdentity, candidate = proposal) =>
      buildReferenceMatchGlobalEditTransaction({
        enabledGroups: new Set(['tone']),
        identity: commitIdentity,
        impact: 100,
        proposal: candidate,
        state,
        transactionId: 'rejected',
      });

    expect(() => build(identity({ sourceIdentity: '/fixture/stale.ARW' }))).toThrow(
      'reference_match_transaction.stale_source',
    );
    expect(() => build(identity({ imageSessionId: 'stale-session' }))).toThrow(
      'reference_match_transaction.stale_session',
    );
    expect(() => build(identity({ adjustmentRevision: 9 }))).toThrow('reference_match_transaction.stale_revision');
    expect(() => build(identity(), { ...proposal, proposalFingerprint: fingerprint('8') })).toThrow(
      'reference_match_transaction.stale_proposal',
    );
    expect(
      buildReferenceMatchGlobalEditTransaction({
        enabledGroups: new Set(['tone']),
        identity: identity(),
        impact: 0,
        proposal,
        state,
        transactionId: 'no-op',
      }),
    ).toBeNull();
    expect(useEditorStore.getState()).toMatchObject({ adjustmentRevision: 0, historyIndex: 0 });
  });
});
