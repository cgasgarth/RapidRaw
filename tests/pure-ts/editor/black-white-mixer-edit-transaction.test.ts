import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  type BlackWhiteMixerCommitIdentity,
  buildBlackWhiteMixerEditTransaction,
} from '../../../src/utils/blackWhiteMixerEditTransaction';
import { legacyAdjustmentsToEditDocumentV2 } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixture/black-white-mixer.ARW';
const session = createEditorImageSession({ generation: 23, path: sourcePath, source: 'cache' });
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
const identity = (overrides: Partial<BlackWhiteMixerCommitIdentity> = {}): BlackWhiteMixerCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});

describe('black-and-white mixer edit transaction', () => {
  beforeEach(() => {
    const adjustments = { ...structuredClone(INITIAL_ADJUSTMENTS), exposure: 0.4 };
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

  test('commits one authoritative monochrome node revision with structural sharing and Undo', () => {
    const state = useEditorStore.getState();
    const blackWhiteMixer = {
      ...structuredClone(INITIAL_ADJUSTMENTS.blackWhiteMixer),
      enabled: true,
      process: 'continuous_sensitivity_v1' as const,
      weights: { ...INITIAL_ADJUSTMENTS.blackWhiteMixer.weights, reds: 32 },
    };
    const request = buildBlackWhiteMixerEditTransaction(state, identity(), blackWhiteMixer, 'black-white-red-response');
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      { nodeType: 'black_white_mixer', patch: { blackWhiteMixer }, type: 'patch-edit-document-node' },
    ]);
    expect(result).toMatchObject({
      changedKeys: ['blackWhiteMixer'],
      nextAdjustmentRevision: 1,
      noOp: false,
      source: 'manual-control',
    });
    expect(result.afterEditDocumentV2.nodes.black_white_mixer.params.blackWhiteMixer).toEqual(blackWhiteMixer);
    expect(result.afterEditDocumentV2.nodes.scene_global_color_tone).toBe(
      result.beforeEditDocumentV2.nodes.scene_global_color_tone,
    );
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustments.blackWhiteMixer).toEqual(INITIAL_ADJUSTMENTS.blackWhiteMixer);
    expect(useEditorStore.getState().adjustments.exposure).toBe(0.4);
  });

  test('rejects stale source, session, and revision identities', () => {
    const state = useEditorStore.getState();
    const next = structuredClone(INITIAL_ADJUSTMENTS.blackWhiteMixer);
    expect(() =>
      buildBlackWhiteMixerEditTransaction(
        state,
        identity({ sourceIdentity: '/fixture/stale.ARW' }),
        next,
        'stale-source',
      ),
    ).toThrow('black_white_mixer_transaction.stale_source');
    expect(() =>
      buildBlackWhiteMixerEditTransaction(
        state,
        identity({ imageSessionId: 'editor-image-session:stale' }),
        next,
        'stale-session',
      ),
    ).toThrow('black_white_mixer_transaction.stale_session');
    expect(() =>
      buildBlackWhiteMixerEditTransaction(state, identity({ adjustmentRevision: 1 }), next, 'stale-revision'),
    ).toThrow('black_white_mixer_transaction.stale_revision');
  });
});
