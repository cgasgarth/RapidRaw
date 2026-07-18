import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  type BlackWhiteMixerCommitIdentity,
  buildBlackWhiteMixerEditTransaction,
  isCurrentBlackWhiteMixerIdentity,
} from '../../../src/utils/blackWhiteMixerEditTransaction';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';

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
    const editDocumentV2 = patchEditDocumentV2Node(createDefaultEditDocumentV2(), 'scene_global_color_tone', {
      exposure: adjustments.exposure,
    });
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
      changedKeys: ['nodes.black_white_mixer.params.blackWhiteMixer'],
      nextAdjustmentRevision: 1,
      noOp: false,
      source: 'manual-control',
    });
    expect(result.after.nodes['black_white_mixer']?.params).toMatchObject({ blackWhiteMixer });
    expect(result.after.nodes['scene_global_color_tone']).toBe(result.before.nodes['scene_global_color_tone']);
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(
      selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'black_white_mixer').params.blackWhiteMixer,
    ).toEqual(INITIAL_ADJUSTMENTS.blackWhiteMixer);
    expect(
      selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'scene_global_color_tone').params.exposure,
    ).toBe(0.4);
  });

  test('coalesces B&W slider updates into one completed interaction history entry', () => {
    const state = useEditorStore.getState();
    const first = {
      ...structuredClone(INITIAL_ADJUSTMENTS.blackWhiteMixer),
      enabled: true,
      weights: { ...INITIAL_ADJUSTMENTS.blackWhiteMixer.weights, reds: 12 },
    };
    const firstResult = state.applyEditTransaction(
      buildBlackWhiteMixerEditTransaction(state, identity(), first, 'black-white-red-drag', 'coalesced-interaction'),
    );
    const second = { ...first, weights: { ...first.weights, reds: 36 } };
    useEditorStore
      .getState()
      .applyEditTransaction(
        buildBlackWhiteMixerEditTransaction(
          useEditorStore.getState(),
          identity({ adjustmentRevision: firstResult.nextAdjustmentRevision }),
          second,
          'black-white-red-drag',
          'coalesced-interaction',
        ),
      );

    expect(useEditorStore.getState().history).toHaveLength(2);
    expect(useEditorStore.getState().lastEditApplicationReceipt).toMatchObject({
      baseAdjustmentRevision: 0,
      transactionId: 'black-white-red-drag',
    });
    expect(selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'black_white_mixer').params).toMatchObject({
      blackWhiteMixer: { weights: { reds: 36 } },
    });
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
    expect(result).toMatchObject({
      changedKeys: ['nodes.black_white_mixer.params.blackWhiteMixer'],
      nextAdjustmentRevision: 1,
      noOp: false,
    });
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
    expect(
      selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'black_white_mixer').params.blackWhiteMixer,
    ).toEqual(INITIAL_ADJUSTMENTS.blackWhiteMixer);

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
