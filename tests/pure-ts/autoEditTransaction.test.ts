import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../src/utils/adjustmentSnapshots';
import { type Adjustments, INITIAL_ADJUSTMENTS } from '../../src/utils/adjustments';
import {
  type AutoEditProposalBase,
  buildAutoEditTransactionRequest,
  captureAutoEditProposalBase,
  clearAutoEditPreviewSession,
  createAutoEditPreviewSession,
  isCurrentAutoEditProposalBase,
  isCurrentAutoEditProposalRequest,
  resolveAutoEditRenderSnapshot,
  setAutoEditPreviewBypass,
} from '../../src/utils/autoEditTransaction';

const path = '/fixtures/auto-edit.raw';
const session = createEditorImageSession({ generation: 7, path, source: 'cache' });
const committed = structuredClone(INITIAL_ADJUSTMENTS);
const committedSnapshot = publishAdjustmentSnapshot(null, committed);
const base: AutoEditProposalBase = {
  adjustmentRevision: 0,
  adjustments: committed,
  graphRevision: 'history_0',
  imageSessionId: session.id,
  path,
};

const preview = (exposure = 0.75) =>
  createAutoEditPreviewSession({
    adjustments: { ...committed, exposure },
    base,
    committedSnapshot,
    currentAdjustmentRevision: 0,
    previewIdentity: 'blake3:auto-edit-preview',
    proposalId: 'blake3:auto-edit-proposal',
  });

beforeEach(() => {
  const adjustments = structuredClone(INITIAL_ADJUSTMENTS);
  useEditorStore.getState().hydrateEditorRenderAuthority({
    adjustmentRevision: 0,
    adjustmentSnapshot: publishAdjustmentSnapshot(null, adjustments),
    adjustments,
    autoEditPreviewSession: null,
    history: [adjustments],
    historyCheckpoints: [],
    historyIndex: 0,
    imageSession: session,
    imageSessionId: session.generation,
    lastEditApplicationReceipt: null,
    selectedImage: null,
  });
});

afterEach(() => {
  useEditorStore.setState({ imageSession: null, imageSessionId: 1 });
});

describe('Auto Edit preview transaction authority', () => {
  test('publishes a preview-only snapshot without mutating the committed snapshot', () => {
    const proposal = preview();

    expect(proposal.snapshot.value.exposure).toBe(0.75);
    expect(committedSnapshot.value.exposure).toBe(INITIAL_ADJUSTMENTS.exposure);
    expect(resolveAutoEditRenderSnapshot(committedSnapshot, proposal, { imageSessionId: session.id, path })).toBe(
      proposal.snapshot,
    );
    expect(resolveAutoEditRenderSnapshot(committedSnapshot, proposal, { imageSessionId: 'stale-session', path })).toBe(
      committedSnapshot,
    );
    expect(
      resolveAutoEditRenderSnapshot(committedSnapshot, proposal, { imageSessionId: session.id, path: '/other.raw' }),
    ).toBe(committedSnapshot);
  });

  test('compare bypass and cancel only affect the keyed proposal', () => {
    const proposal = preview();
    const bypassed = setAutoEditPreviewBypass(proposal, proposal.key, true);

    expect(bypassed?.bypassed).toBe(true);
    expect(resolveAutoEditRenderSnapshot(committedSnapshot, bypassed, { imageSessionId: session.id, path })).toBe(
      committedSnapshot,
    );
    expect(clearAutoEditPreviewSession(proposal, 'another-key')).toBe(proposal);
    expect(clearAutoEditPreviewSession(proposal, proposal.key)).toBeNull();
  });

  test('stale async completion fails closed after a canonical revision changes', () => {
    const proposal = preview();
    const changed = publishAdjustmentSnapshot(committedSnapshot, { ...committed, contrast: 1 });

    expect(resolveAutoEditRenderSnapshot(changed, proposal, { imageSessionId: session.id, path })).toBe(changed);
    expect(() =>
      createAutoEditPreviewSession({
        adjustments: { ...committed, exposure: 1 },
        base,
        committedSnapshot: changed,
        currentAdjustmentRevision: 1,
        previewIdentity: 'blake3:late-preview',
        proposalId: 'blake3:late-proposal',
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

    expect(result).toMatchObject({ changedKeys: ['exposure'], noOp: false, source: 'auto-edit' });
    expect(state.adjustments.exposure).toBe(0.75);
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
    useEditorStore.setState((state) => ({
      autoEditPreviewSession: clearAutoEditPreviewSession(state.autoEditPreviewSession, proposal.key),
    }));
    const after = useEditorStore.getState();

    expect(result.noOp).toBe(true);
    expect(after.adjustmentRevision).toBe(before.adjustmentRevision);
    expect(after.history).toBe(before.history);
    expect(after.historyIndex).toBe(before.historyIndex);
    expect(after.lastEditApplicationReceipt).toBeNull();
    expect(after.autoEditPreviewSession).toBeNull();
  });

  test('fallback proposal stays preview-only, cancels cleanly, and rejects delayed A to B to A completion', () => {
    useEditorStore.setState({
      finalPreviewUrl: 'blob:fallback-auto-edit-before',
      imageSession: null,
      imageSessionId: 127,
      selectedImage: {
        exif: null,
        height: 3000,
        isRaw: true,
        isReady: true,
        metadata: null,
        originalUrl: null,
        path,
        rawDevelopmentReport: null,
        thumbnailUrl: '',
        width: 4000,
      },
    });
    const state = useEditorStore.getState();
    const fallbackBase = captureAutoEditProposalBase(state);
    if (fallbackBase === null) throw new Error('Expected fallback Auto Edit base');
    expect(fallbackBase.imageSessionId).toBe('editor-image-session:127');
    expect(isCurrentAutoEditProposalBase(state, fallbackBase)).toBeTrue();
    expect(isCurrentAutoEditProposalRequest(state, fallbackBase, 5, 5)).toBeTrue();
    expect(isCurrentAutoEditProposalRequest(state, fallbackBase, 4, 5)).toBeFalse();
    expect(
      isCurrentAutoEditProposalBase(
        {
          ...state,
          imageSessionId: 128,
          selectedImage: { isReady: true, path: '/fixtures/B.raw' },
        },
        fallbackBase,
      ),
    ).toBeFalse();
    expect(isCurrentAutoEditProposalBase({ ...state, imageSessionId: 129 }, fallbackBase)).toBeFalse();
    expect(isCurrentAutoEditProposalBase({ ...state, adjustmentRevision: 1 }, fallbackBase)).toBeFalse();

    const proposal = createAutoEditPreviewSession({
      adjustments: { ...state.adjustments, exposure: 0.9 },
      base: fallbackBase,
      committedSnapshot: state.adjustmentSnapshot,
      currentAdjustmentRevision: state.adjustmentRevision,
      previewIdentity: 'blake3:fallback-preview',
      proposalId: 'blake3:fallback-proposal',
    });
    useEditorStore.setState({ autoEditPreviewSession: proposal });
    const previewState = useEditorStore.getState();
    expect(previewState.adjustments.exposure).toBe(INITIAL_ADJUSTMENTS.exposure);
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
    expect(result).toMatchObject({ changedKeys: ['exposure'], nextAdjustmentRevision: 1, noOp: false });
    expect(useEditorStore.getState()).toMatchObject({
      finalPreviewUrl: null,
      historyIndex: 1,
      lastEditApplicationReceipt: {
        imageSessionId: fallbackBase.imageSessionId,
        transactionId: 'fallback-auto-apply',
      },
    });
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.exposure).toBe(INITIAL_ADJUSTMENTS.exposure);
  });
});
