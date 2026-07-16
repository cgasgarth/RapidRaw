import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  createDefaultEditDocumentV2,
  patchEditDocumentV2Node,
  setEditDocumentV2NodeEnabled,
} from '../../../src/utils/editDocumentV2';
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
    editDocumentV2: setEditDocumentV2NodeEnabled(
      patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'geometry', { aspectRatio: 1.5 }),
      'display_creative',
      false,
    ),
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
    const editDocumentV2 = setEditDocumentV2NodeEnabled(
      patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
        exposure: adjustments.exposure,
      }),
      'display_creative',
      adjustments.effectsEnabled,
    );
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 4,
      editDocumentV2,
      historyCheckpoints: [],
      historyIndex: 1,
      imageSession: session,
      lastEditApplicationReceipt: null,
      selectedImage,
      history: [createDefaultEditDocumentV2(), editDocumentV2],
    });
  });

  test('installs one validated native-committed Reset revision without a duplicate persistence request', () => {
    const state = useEditorStore.getState();
    const identity = captureResetEditCommitIdentity(state, sourcePath);
    if (identity === null) throw new Error('Expected Reset identity');
    const request = buildResetEditTransaction(state, identity, receipt, 'reset-native');
    const result = state.applyEditTransaction(request);

    expect(request).toMatchObject({ history: 'reset', persistence: 'native-committed', source: 'reset' });
    expect(result.after.sourceArtifacts.aiPatches).toEqual([]);
    expect(result.after.geometry.aspectRatio).toBe(1.5);
    expect(result.after.nodes['display_creative']?.enabled).toBeFalse();
    expect(result.after.nodes['scene_global_color_tone']?.params['exposure']).toBe(0);
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
        'stale-source',
      ),
    ).toThrow('reset_edit_transaction.stale_source');
    expect(() =>
      buildResetEditTransaction({ ...state, imageSession: { id: 'successor' } }, identity, receipt, 'stale-session'),
    ).toThrow('reset_edit_transaction.stale_session');
    expect(() =>
      buildResetEditTransaction({ ...state, adjustmentRevision: 5 }, identity, receipt, 'stale-revision'),
    ).toThrow('reset_edit_transaction.stale_revision');
    expect(() =>
      buildResetEditTransaction(state, identity, { ...receipt, path: '/fixture/B.ARW' }, 'wrong-receipt'),
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
    useEditorStore.getState().hydrateEditorRenderAuthority({
      adjustmentRevision: 0,
      editDocumentV2: createDefaultEditDocumentV2(),
      historyIndex: 0,
      history: [createDefaultEditDocumentV2()],
    });
    const state = useEditorStore.getState();
    const identity = captureResetEditCommitIdentity(state, sourcePath);
    if (identity === null) throw new Error('Expected Reset identity');
    const result = state.applyEditTransaction(
      buildResetEditTransaction(
        state,
        identity,
        { ...receipt, editDocumentV2: createDefaultEditDocumentV2() },
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

    const request = buildResetEditTransaction(state, identity, receipt, 'fallback-reset-native');
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
      buildResetEditTransaction({ ...state, imageSessionId: 126 }, identity, receipt, 'stale-reopened-a'),
    ).toThrow('reset_edit_transaction.stale_session');
  });
});
