import { beforeEach, describe, expect, test } from 'bun:test';

import { createEditorImageSession, useEditorStore } from '../../../src/store/useEditorStore';
import { INITIAL_ADJUSTMENTS } from '../../../src/utils/adjustments';
import {
  buildChannelMixerEditTransaction,
  type ChannelMixerCommitIdentity,
  isCurrentChannelMixerIdentity,
} from '../../../src/utils/channelMixerEditTransaction';
import { selectEditDocumentNode } from '../../../src/utils/editDocumentSelectors';
import { createDefaultEditDocumentV2, patchEditDocumentV2Node } from '../../../src/utils/editDocumentV2';

const sourcePath = '/fixture/channel-mixer.ARW';
const session = createEditorImageSession({ generation: 31, path: sourcePath, source: 'cache' });
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
const identity = (overrides: Partial<ChannelMixerCommitIdentity> = {}): ChannelMixerCommitIdentity => ({
  adjustmentRevision: 0,
  imageSessionId: session.id,
  sourceIdentity: sourcePath,
  ...overrides,
});
const currentChannelMixer = () =>
  structuredClone(
    selectEditDocumentNode(useEditorStore.getState().editDocumentV2, 'channel_mixer').params.channelMixer,
  );

describe('channel mixer edit transaction', () => {
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

  test('commits one authoritative mixer node revision with structural sharing and Undo', () => {
    const state = useEditorStore.getState();
    const baseline = currentChannelMixer();
    const channelMixer = {
      ...baseline,
      enabled: true,
      red: { ...baseline.red, green: 24 },
    };
    const request = buildChannelMixerEditTransaction(state, identity(), channelMixer, 'channel-mixer-red-green');
    const result = state.applyEditTransaction(request);

    expect(request.operations).toEqual([
      { nodeType: 'channel_mixer', patch: { channelMixer }, type: 'patch-edit-document-node' },
    ]);
    expect(result).toMatchObject({
      changedKeys: ['channelMixer'],
      nextAdjustmentRevision: 1,
      noOp: false,
      source: 'manual-control',
    });
    expect(result.afterEditDocumentV2.nodes['channel_mixer']?.params).toMatchObject({ channelMixer });
    expect(result.afterEditDocumentV2.nodes['scene_global_color_tone']).toBe(
      result.beforeEditDocumentV2.nodes['scene_global_color_tone'],
    );
    expect(useEditorStore.getState().history).toHaveLength(2);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.nodes['channel_mixer']!.params['channelMixer']).toEqual(baseline);
    expect(useEditorStore.getState().editDocumentV2.nodes['scene_global_color_tone']!.params['exposure']).toBe(0.4);
  });

  test('rejects stale source, session, and revision identities', () => {
    const state = useEditorStore.getState();
    const next = currentChannelMixer();
    expect(() =>
      buildChannelMixerEditTransaction(state, identity({ sourceIdentity: '/fixture/stale.ARW' }), next, 'stale-source'),
    ).toThrow('channel_mixer_transaction.stale_source');
    expect(() =>
      buildChannelMixerEditTransaction(
        state,
        identity({ imageSessionId: 'editor-image-session:stale' }),
        next,
        'stale-session',
      ),
    ).toThrow('channel_mixer_transaction.stale_session');
    expect(() =>
      buildChannelMixerEditTransaction(state, identity({ adjustmentRevision: 1 }), next, 'stale-revision'),
    ).toThrow('channel_mixer_transaction.stale_revision');
  });

  test('preserves distinct enable and coefficient Undo boundaries', () => {
    const state = useEditorStore.getState();
    const baseline = currentChannelMixer();
    const enabled = {
      ...baseline,
      enabled: true,
      red: { ...baseline.red, red: 110 },
    };
    const first = state.applyEditTransaction(
      buildChannelMixerEditTransaction(state, identity(), enabled, 'channel-mixer-enable'),
    );
    const adjusted = { ...enabled, red: { ...enabled.red, green: 1 } };
    useEditorStore
      .getState()
      .applyEditTransaction(
        buildChannelMixerEditTransaction(
          useEditorStore.getState(),
          identity({ adjustmentRevision: first.nextAdjustmentRevision }),
          adjusted,
          'channel-mixer-green',
        ),
      );

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.nodes['channel_mixer']!.params['channelMixer']).toEqual(enabled);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.nodes['channel_mixer']!.params['channelMixer']).toEqual(baseline);
  });

  test('commits through fallback authority and rejects stale A to B to A identities', () => {
    useEditorStore.setState({
      finalPreviewUrl: 'blob:fallback-channel-before',
      imageSession: null,
      imageSessionId: 84,
    });
    const state = useEditorStore.getState();
    const baseline = currentChannelMixer();
    const fallbackIdentity: ChannelMixerCommitIdentity = {
      adjustmentRevision: 0,
      imageSessionId: 'editor-image-session:84',
      sourceIdentity: sourcePath,
    };
    const noOp = state.applyEditTransaction(
      buildChannelMixerEditTransaction(state, fallbackIdentity, baseline, 'fallback-channel-no-op'),
    );
    expect(noOp.noOp).toBeTrue();
    expect(useEditorStore.getState()).toMatchObject({
      adjustmentRevision: 0,
      finalPreviewUrl: 'blob:fallback-channel-before',
      historyIndex: 0,
      lastEditApplicationReceipt: null,
    });

    const next = {
      ...baseline,
      enabled: true,
      red: { ...baseline.red, green: 18 },
    };
    const result = state.applyEditTransaction(
      buildChannelMixerEditTransaction(state, fallbackIdentity, next, 'fallback-channel'),
    );
    expect(result).toMatchObject({ changedKeys: ['channelMixer'], nextAdjustmentRevision: 1, noOp: false });
    expect(useEditorStore.getState()).toMatchObject({
      finalPreviewUrl: null,
      historyIndex: 1,
      lastEditApplicationReceipt: {
        imageSessionId: fallbackIdentity.imageSessionId,
        transactionId: 'fallback-channel',
      },
    });
    expect(useEditorStore.getState().history).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().editDocumentV2.nodes['channel_mixer']!.params['channelMixer']).toEqual(baseline);

    expect(isCurrentChannelMixerIdentity(state, fallbackIdentity)).toBeTrue();
    expect(
      isCurrentChannelMixerIdentity(
        { ...state, imageSessionId: 85, selectedImage: { path: '/fixture/B.ARW' } },
        fallbackIdentity,
      ),
    ).toBeFalse();
    expect(isCurrentChannelMixerIdentity({ ...state, imageSessionId: 86 }, fallbackIdentity)).toBeFalse();
    expect(isCurrentChannelMixerIdentity({ ...state, adjustmentRevision: 1 }, fallbackIdentity)).toBeFalse();
    expect(() =>
      buildChannelMixerEditTransaction({ ...state, imageSessionId: 86 }, fallbackIdentity, next, 'stale-reopened-a'),
    ).toThrow('channel_mixer_transaction.stale_session');
  });
});
