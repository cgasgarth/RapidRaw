import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { publishAdjustmentSnapshot } from '../../../src/utils/adjustmentSnapshots';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  type BlackWhiteMixerCommitIdentity,
  buildBlackWhiteMixerEditTransaction,
  isCurrentBlackWhiteMixerIdentity,
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
    expect(useEditorStore.getState().adjustmentSnapshot.value.blackWhiteMixer).toEqual(
      INITIAL_ADJUSTMENTS.blackWhiteMixer,
    );
    expect(useEditorStore.getState().adjustmentSnapshot.value.exposure).toBe(0.4);
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

  test('commits through fallback authority and rejects stale A to B to A identities', () => {
    useEditorStore.setState({
      finalPreviewUrl: 'blob:fallback-black-white-before',
      imageSession: null,
      imageSessionId: 81,
    });
    const state = useEditorStore.getState();
    const fallbackIdentity: BlackWhiteMixerCommitIdentity = {
      adjustmentRevision: 0,
      imageSessionId: 'editor-image-session:81',
      sourceIdentity: sourcePath,
    };
    const noOp = state.applyEditTransaction(
      buildBlackWhiteMixerEditTransaction(
        state,
        fallbackIdentity,
        structuredClone(INITIAL_ADJUSTMENTS.blackWhiteMixer),
        'fallback-black-white-no-op',
      ),
    );
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 0,
      finalPreviewUrl: 'blob:fallback-black-white-before',
      historyIndex: 0,
      lastEditApplicationReceipt: null,
    });

    const next = {
      ...structuredClone(INITIAL_ADJUSTMENTS.blackWhiteMixer),
      enabled: true,
      process: 'continuous_sensitivity_v1' as const,
      weights: { ...INITIAL_ADJUSTMENTS.blackWhiteMixer.weights, reds: 20 },
    };
    const result = state.applyEditTransaction(
      buildBlackWhiteMixerEditTransaction(state, fallbackIdentity, next, 'fallback-black-white'),
    );
    expect(result).toMatchObject({ changedKeys: ['blackWhiteMixer'], nextAdjustmentRevision: 1, noOp: false });
    expect(useEditorStore.getState()).toMatchObject({
      finalPreviewUrl: null,
      historyIndex: 1,
      lastEditApplicationReceipt: {
        imageSessionId: fallbackIdentity.imageSessionId,
        transactionId: 'fallback-black-white',
      },
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().adjustmentSnapshot.value.blackWhiteMixer).toEqual(
      INITIAL_ADJUSTMENTS.blackWhiteMixer,
    );

    expect(isCurrentBlackWhiteMixerIdentity(state, fallbackIdentity)).toBeTrue();
    expect(
      isCurrentBlackWhiteMixerIdentity(
        { ...state, imageSessionId: 82, selectedImage: { path: '/fixture/B.ARW' } },
        fallbackIdentity,
      ),
    ).toBeFalse();
    expect(isCurrentBlackWhiteMixerIdentity({ ...state, imageSessionId: 83 }, fallbackIdentity)).toBeFalse();
    expect(isCurrentBlackWhiteMixerIdentity({ ...state, adjustmentRevision: 1 }, fallbackIdentity)).toBeFalse();
    expect(() =>
      buildBlackWhiteMixerEditTransaction({ ...state, imageSessionId: 83 }, fallbackIdentity, next, 'stale-reopened-a'),
    ).toThrow('black_white_mixer_transaction.stale_session');
  });
});
