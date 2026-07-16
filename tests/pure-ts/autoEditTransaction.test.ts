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

  test('commits the proposal atomically through typed node operations', () => {
    const result = reduceEditTransaction(
      document,
      0,
      buildAutoEditTransactionRequest(base, proposal(), 'auto-edit:apply'),
      imageSessionId,
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
  });
});
