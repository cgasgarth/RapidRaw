import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';
import {
  assertResetAdjustmentsResultCoverage,
  buildResetEditTransaction,
  captureResetEditCommitIdentity,
  isCurrentResetEditCommitIdentity,
  resetAdjustmentsResultsSchema,
} from '../../../src/utils/resetEditTransaction';

const sourcePath = '/fixture/reset.ARW';
const session = createEditorImageSession({ generation: 71, path: sourcePath, source: 'cache' });
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
  width: 4500,
};
const receipt = resetAdjustmentsResultsSchema.parse([
  {
    adjustments: {},
    path: sourcePath,
    renderGeneration: 9,
    revision: `sha256:${'a'.repeat(64)}`,
  },
])[0];

if (receipt === undefined) throw new Error('Expected Reset receipt fixture');

describe('Reset edit transaction', () => {
  beforeEach(() => {
    const adjustments = {
      ...structuredClone(INITIAL_ADJUSTMENTS),
      effectsEnabled: false,
      exposure: 1.25,
      sectionVisibility: { basic: true, color: true, curves: true, details: false },
    };
    const editDocumentV2 = legacyAdjustmentsToEditDocumentV2(adjustments);
    useEditorStore.setState({
      adjustmentRevision: 4,
      adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments, editDocumentV2),
      adjustments,
      editDocumentV2,
      editDocumentHistory: [legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS), editDocumentV2],
      history: [structuredClone(INITIAL_ADJUSTMENTS), adjustments],
      historyCheckpoints: [],
      historyIndex: 1,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage,
    });
  });

  test('installs one validated native-committed Reset revision without a duplicate persistence request', () => {
    const state = useEditorStore.getState();
    const identity = captureResetEditCommitIdentity(state, sourcePath);
    if (identity === null) throw new Error('Expected Reset identity');
    const request = buildResetEditTransaction(state, identity, receipt, selectedImage, 'reset-native');
    const result = state.applyEditTransaction(request);

    expect(request).toMatchObject({ history: 'reset', persistence: 'native-committed', source: 'reset' });
    expect(result.after).toMatchObject({
      aiPatches: [],
      aspectRatio: 1.5,
      effectsEnabled: false,
      exposure: 0,
    });
    expect(result.after).not.toHaveProperty('sectionVisibility');
    expect(result.applicationReceipt).toMatchObject({
      adjustmentRevision: 5,
      baseAdjustmentRevision: 4,
      persistence: 'native-committed',
      transactionId: 'reset-native',
    });
    expect(useEditorStore.getState()).toMatchObject({ adjustmentRevision: 5, historyIndex: 0 });
    expect(useEditorStore.getState().history).toEqual([result.after]);
  });

  test('rejects stale source, session, revision, and mismatched native receipts', () => {
    const state = useEditorStore.getState();
    const identity = captureResetEditCommitIdentity(state, sourcePath);
    if (identity === null) throw new Error('Expected Reset identity');

    expect(isCurrentResetEditCommitIdentity(state, identity)).toBeTrue();
    expect(isCurrentResetEditCommitIdentity({ ...state, adjustmentRevision: 5 }, identity)).toBeFalse();
    expect(() =>
      buildResetEditTransaction(
        { ...state, selectedImage: { isReady: true, path: '/fixture/B.ARW' } },
        identity,
        receipt,
        selectedImage,
        'stale-source',
      ),
    ).toThrow('reset_edit_transaction.stale_source');
    expect(() =>
      buildResetEditTransaction(
        { ...state, imageSession: { id: 'successor' } },
        identity,
        receipt,
        selectedImage,
        'stale-session',
      ),
    ).toThrow('reset_edit_transaction.stale_session');
    expect(() =>
      buildResetEditTransaction(
        { ...state, adjustmentRevision: 5 },
        identity,
        receipt,
        selectedImage,
        'stale-revision',
      ),
    ).toThrow('reset_edit_transaction.stale_revision');
    expect(() =>
      buildResetEditTransaction(
        state,
        identity,
        { ...receipt, path: '/fixture/B.ARW' },
        selectedImage,
        'wrong-receipt',
      ),
    ).toThrow('reset_edit_transaction.receipt_source');
  });

  test('fails closed on malformed native Reset receipts and preserves exact no-ops', () => {
    expect(
      resetAdjustmentsResultsSchema.safeParse([{ ...receipt, revision: 'unsealed', unexpected: true }]).success,
    ).toBeFalse();
    expect(() => assertResetAdjustmentsResultCoverage([receipt, receipt], [sourcePath])).toThrow(
      'reset_edit_transaction.duplicate_receipt',
    );
    expect(() => assertResetAdjustmentsResultCoverage([receipt], [sourcePath, '/fixture/B.ARW'])).toThrow(
      'reset_edit_transaction.receipt_coverage',
    );
    useEditorStore.setState({
      adjustmentRevision: 0,
      adjustments: structuredClone(INITIAL_ADJUSTMENTS),
      editDocumentV2: legacyAdjustmentsToEditDocumentV2(INITIAL_ADJUSTMENTS),
      history: [structuredClone(INITIAL_ADJUSTMENTS)],
      historyIndex: 0,
    });
    const state = useEditorStore.getState();
    const identity = captureResetEditCommitIdentity(state, sourcePath);
    if (identity === null) throw new Error('Expected Reset identity');
    const result = state.applyEditTransaction(
      buildResetEditTransaction(
        state,
        identity,
        { ...receipt, adjustments: structuredClone(INITIAL_ADJUSTMENTS) },
        { height: 0, width: 0 },
        'reset-no-op',
      ),
    );
    expect(result.noOp).toBeTrue();
    expect(useEditorStore.getState()).toMatchObject({ adjustmentRevision: 0, historyIndex: 0 });
  });

  test('commits a native fallback Reset and rejects A to B to A reopen', () => {
    useEditorStore.setState({
      finalPreviewUrl: 'blob:fallback-reset-before',
      imageSession: null,
      imageSessionId: 124,
    });
    const state = useEditorStore.getState();
    const identity = captureResetEditCommitIdentity(state, sourcePath);
    if (identity === null) throw new Error('Expected fallback Reset identity');
    expect(identity.imageSessionId).toBe('editor-image-session:124');
    expect(isCurrentResetEditCommitIdentity(state, identity)).toBeTrue();
    expect(
      isCurrentResetEditCommitIdentity(
        { ...state, imageSessionId: 125, selectedImage: { isReady: true, path: '/fixture/B.ARW' } },
        identity,
      ),
    ).toBeFalse();
    expect(isCurrentResetEditCommitIdentity({ ...state, imageSessionId: 126 }, identity)).toBeFalse();
    expect(isCurrentResetEditCommitIdentity({ ...state, adjustmentRevision: 5 }, identity)).toBeFalse();

    const request = buildResetEditTransaction(state, identity, receipt, selectedImage, 'fallback-reset-native');
    const result = state.applyEditTransaction(request);
    expect(request).toMatchObject({ history: 'reset', persistence: 'native-committed' });
    expect(result).toMatchObject({ nextAdjustmentRevision: 5, noOp: false, source: 'reset' });
    expect(useEditorStore.getState()).toMatchObject({
      finalPreviewUrl: null,
      historyIndex: 0,
      lastEditApplicationReceipt: {
        imageSessionId: identity.imageSessionId,
        transactionId: 'fallback-reset-native',
      },
    });
    expect(useEditorStore.getState().history).toHaveLength(1);
    expect(() =>
      buildResetEditTransaction(
        { ...state, imageSessionId: 126 },
        identity,
        receipt,
        selectedImage,
        'stale-reopened-a',
      ),
    ).toThrow('reset_edit_transaction.stale_session');
  });
});
