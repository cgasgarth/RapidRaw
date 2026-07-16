import { describe, expect, test } from 'bun:test';

import { publishAdjustmentSnapshot } from '../../src/utils/adjustmentSnapshots';
import {
  buildAutoEditTransactionRequest,
  clearAutoEditPreviewSession,
  createAutoEditPreviewSession,
  isCurrentAutoEditProposalBase,
  resolveAutoEditRenderSnapshot,
  selectAutoEditAdjustmentProposal,
  setAutoEditPreviewBypass,
} from '../../src/utils/autoEditTransaction';
import { selectEditDocumentNode } from '../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2 } from '../../src/utils/editDocumentV2';
import { reduceEditTransaction } from '../../src/utils/editTransaction';

const path = '/fixtures/auto-edit.raw';
const imageSessionId = 'session:auto-edit';
const document = createDefaultEditDocumentV2();
const committedSnapshot = publishAdjustmentSnapshot(null, document);
const base = {
  adjustmentRevision: 0,
  editDocumentV2: document,
  graphRevision: 'history_0',
  imageSessionId,
  path,
};

const proposal = (exposure = 0.75) => ({ ...selectAutoEditAdjustmentProposal(document), exposure });

const preview = (exposure = 0.75) =>
  createAutoEditPreviewSession({
    adjustments: proposal(exposure),
    base,
    committedSnapshot,
    currentAdjustmentRevision: 0,
    previewIdentity: 'blake3:auto-edit-preview',
    proposalId: `proposal:${String(exposure)}`,
  });

describe('Auto Edit current-document transaction authority', () => {
  test('publishes a preview-only current document without mutating the committed snapshot', () => {
    const session = preview();
    expect(selectEditDocumentNode(session.snapshot.editDocumentV2, 'scene_global_color_tone').params['exposure']).toBe(
      0.75,
    );
    expect(selectEditDocumentNode(committedSnapshot.editDocumentV2, 'scene_global_color_tone').params['exposure']).toBe(
      0,
    );
    expect(resolveAutoEditRenderSnapshot(committedSnapshot, session, { imageSessionId, path })).toBe(session.snapshot);
    expect(resolveAutoEditRenderSnapshot(committedSnapshot, session, { imageSessionId: 'stale', path })).toBe(
      committedSnapshot,
    );
  });

  test('compare bypass and cancellation are proposal-key scoped', () => {
    const session = preview();
    const bypassed = setAutoEditPreviewBypass(session, session.key, true);
    expect(resolveAutoEditRenderSnapshot(committedSnapshot, bypassed, { imageSessionId, path })).toBe(
      committedSnapshot,
    );
    expect(clearAutoEditPreviewSession(session, 'other')).toBe(session);
    expect(clearAutoEditPreviewSession(session, session.key)).toBeNull();
  });

  test('rejects stale preview bases', () => {
    expect(() =>
      createAutoEditPreviewSession({
        adjustments: proposal(1),
        base,
        committedSnapshot,
        currentAdjustmentRevision: 1,
        previewIdentity: 'blake3:late-preview',
        proposalId: 'late',
      }),
    ).toThrow('auto_edit_preview.stale_base:0:1');
  });

  test('unmount disposal clears the owned preview but cannot clear a successor proposal', () => {
    const owned = preview();
    const successor = { ...preview(1), key: 'successor-key' };

    expect(clearAutoEditPreviewSession(owned, owned.key)).toBeNull();
    expect(clearAutoEditPreviewSession(successor, owned.key)).toBe(successor);
  });

  test('accept commits exactly one history boundary and publishes one receipt', () => {
    const proposal = preview();
    useEditorStore.setState({ autoEditPreviewSession: proposal });
    const result = useEditorStore
      .getState()
      .applyEditTransaction(
        buildAutoEditTransactionRequest(base, proposal.snapshot.value as typeof committed, 'blake3:auto-edit-apply'),
      );
    const state = useEditorStore.getState();

    expect(result).toMatchObject({
      changedKeys: ['nodes.scene_global_color_tone.params.exposure'],
      noOp: false,
      source: 'auto-edit',
    });
    expect(state.adjustmentSnapshot.value.exposure).toBe(0.75);
    expect(state.adjustmentRevision).toBe(1);
    expect(state.history).toHaveLength(2);
    expect(state.historyIndex).toBe(1);
    expect(state.autoEditPreviewSession).toBeNull();
    expect(state.lastEditApplicationReceipt).toMatchObject({
      adjustmentRevision: 1,
      source: 'auto-edit',
      transactionId: 'blake3:auto-edit-apply',
    });
  });

  test('accepted exact no-op clears only the preview and creates no history, revision, or receipt', () => {
    const proposal = preview(INITIAL_ADJUSTMENTS.exposure);
    useEditorStore.setState({ autoEditPreviewSession: proposal });
    const before = useEditorStore.getState();
    const result = before.applyEditTransaction(
      buildAutoEditTransactionRequest(base, committed, 'blake3:auto-edit-no-op'),
    );
    expect(result.noOp).toBeFalse();
    expect(result.changedKeys).toEqual(['nodes.scene_global_color_tone.params.exposure']);
    expect(selectEditDocumentNode(result.after, 'scene_global_color_tone').params['exposure']).toBe(0.75);
  });

  test('proposal base identity fails closed when any authority coordinate changes', () => {
    const state = {
      adjustmentRevision: 0,
      editDocumentV2: document,
      historyIndex: 0,
      imageSession: { id: imageSessionId },
      imageSessionId: 1,
      selectedImage: { isReady: true, path },
    };
    expect(isCurrentAutoEditProposalBase(state, base)).toBeTrue();
    expect(isCurrentAutoEditProposalBase({ ...state, adjustmentRevision: 1 }, base)).toBeFalse();
    expect(isCurrentAutoEditProposalBase({ ...state, historyIndex: 1 }, base)).toBeFalse();
    expect(
      isCurrentAutoEditProposalBase({ ...state, selectedImage: { isReady: true, path: '/other.raw' } }, base),
    ).toBeFalse();
    expect(isCurrentAutoEditProposalBase({ ...state, imageSessionId: 129 }, fallbackBase)).toBeFalse();
    expect(isCurrentAutoEditProposalBase({ ...state, adjustmentRevision: 1 }, fallbackBase)).toBeFalse();

    const proposal = createAutoEditPreviewSession({
      adjustments: { ...state.adjustmentSnapshot.value, exposure: 0.9 },
      base: fallbackBase,
      committedSnapshot: state.adjustmentSnapshot,
      currentAdjustmentRevision: state.adjustmentRevision,
      previewIdentity: 'blake3:fallback-preview',
      proposalId: 'blake3:fallback-proposal',
    });
    useEditorStore.setState({ autoEditPreviewSession: proposal });
    const previewState = useEditorStore.getState();
    expect(previewState.adjustmentSnapshot.value.exposure).toBe(INITIAL_ADJUSTMENTS.exposure);
    expect(previewState.history).toHaveLength(1);
    expect(previewState.adjustmentRevision).toBe(0);
    expect(previewState.finalPreviewUrl).toBe('blob:fallback-auto-edit-before');
    useEditorStore.setState((current) => ({
      autoEditPreviewSession: clearAutoEditPreviewSession(current.autoEditPreviewSession, proposal.key),
    }));
    expect(useEditorStore.getState().autoEditPreviewSession).toBeNull();

    const result = useEditorStore
      .getState()
      .applyEditTransaction(
        buildAutoEditTransactionRequest(fallbackBase, proposal.snapshot.value as Adjustments, 'fallback-auto-apply'),
      );
    expect(result).toMatchObject({
      changedKeys: ['nodes.scene_global_color_tone.params.exposure'],
      nextAdjustmentRevision: 1,
      noOp: false,
    });
    expect(useEditorStore.getState()).toMatchObject({
      finalPreviewUrl: null,
      historyIndex: 1,
      lastEditApplicationReceipt: {
        imageSessionId: fallbackBase.imageSessionId,
        transactionId: 'fallback-auto-apply',
      },
    });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.exposure).toBe(INITIAL_ADJUSTMENTS.exposure);
  });
});
